import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from '../cli/bundle.ts';

// Closed-loop ascent test: the real bundled worker flies a simplified
// point-mass rocket with an exponential atmosphere, two engine groups, and
// crossfeed-free propellant pools. This is NOT KSP physics — no part drag, no
// gimbal, no aerodynamic stability — but it exercises the guidance law,
// staging signals, and phase machine end to end and proves the worker reaches
// a stable orbit instead of merely producing finite numbers.

const entry = fileURLToPath(new URL('../workers/samples/ascent.ts', import.meta.url));
const bundled = await bundleWorker(entry);
let run = 0;

// A deployed worker gets a fresh runtime and fresh module state. Bundling is
// done once, but each simulation imports a distinct copy of the code so the
// module-level phase machine starts clean.
async function loadWorker(): Promise<{ flightTick(context: any): void }> {
    const code = bundled + '\n// run ' + run++;
    return (await import('data:text/javascript;base64,' +
        Buffer.from(code).toString('base64'))).default as { flightTick(context: any): void };
}

const R = 600_000;
const MU = 3.5316e12;            // Kerbin
const G0 = 9.80665;
const ATMO_DEPTH = 70_000;
const RHO0 = 1.225;
const SCALE_HEIGHT = 5_600;
const DRAG_AREA = 4.5;
const ROTATION = 2 * Math.PI / 21_549.4; // sidereal day, eastward

interface Vec3 { x: number; y: number; z: number; }
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const magnitude = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const rotate = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
    const speed = magnitude(axis);
    if (speed < 1e-12 || angle === 0) return v;
    const k = scale(axis, 1 / speed);
    const c = Math.cos(angle), s = Math.sin(angle);
    // Rodrigues' rotation.
    return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
};

interface EngineGroup {
    name: string;
    thrust: number;      // kN, vacuum
    isp: number;         // s
    fuel: number;        // kg
    active: boolean;     // ignition state
    flameout: boolean;
    attached: boolean;
    thrustNow: number;   // kN this tick
}

function orbitElements(pos: Vec3, vel: Vec3) {
    const r = magnitude(pos);
    const v2 = dot(vel, vel);
    const energy = v2 / 2 - MU / r;
    const h = pos.x * vel.y - pos.y * vel.x;
    const a = -MU / (2 * energy);
    const eccentricity = Math.sqrt(Math.max(0, 1 + 2 * energy * h * h / (MU * MU)));
    const apoapsisRadius = a * (1 + eccentricity);
    const periapsisRadius = a * (1 - eccentricity);
    let timeToApoapsis = Number.NaN;
    if (eccentricity < 1 && eccentricity > 1e-8) {
        // True anomaly from the eccentricity vector, keeping the quadrant via
        // atan2 and the orbit's handedness. Then Kepler's equation gives the
        // mean anomaly, and apoapsis is the mean anomaly of pi.
        const radial = dot(pos, vel);
        const evec = scale(add(scale(pos, v2 - MU / r), scale(vel, -radial)), 1 / MU);
        const trueAnomaly = Math.atan2((evec.x * pos.y - evec.y * pos.x) * Math.sign(h), dot(evec, pos));
        const eccentricAnomaly = 2 * Math.atan2(Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
            Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2));
        const meanAnomaly = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
        const n = Math.sqrt(MU / (a * a * a));
        const twoPi = 2 * Math.PI;
        timeToApoapsis = ((Math.PI - meanAnomaly) % twoPi + twoPi) % twoPi / n;
    }
    return {
        apoapsis: apoapsisRadius - R,
        periapsis: periapsisRadius - R,
        timeToApoapsis,
        timeToPeriapsis: Number.NaN,
        inclination: 0,
        eccentricity,
        semiMajorAxis: a,
        period: eccentricity < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / MU) : Number.NaN,
    };
}

interface Snapshot {
    pos: Vec3;
    vel: Vec3;
    nose: Vec3;
    right: Vec3;
    belly: Vec3;
    omega: Vec3;
    time: number;
    stageIndex: number;
    lastThrottle: number;
    groups: { fuel: number; active: boolean; flameout: boolean; attached: boolean }[];
}

interface SimOptions {
    maxSeconds?: number;
    dt?: number;
    /** Persistent storage object; reuse across runs to model a part's saved state. */
    storage?: Record<string, unknown>;
    /** Dynamic state to continue from, as returned in SimResult.snapshot. */
    resume?: Snapshot;
    /** Stop after this many simulated seconds (for a two-segment resume test). */
    stopAfter?: number;
}

interface SimResult {
    logs: string[];
    stages: number;
    engineGroups: string[];
    orbit: ReturnType<typeof orbitElements>;
    finalAltitude: number;
    finalSpeed: number;
    minThrottle: number;
    maxDynamicPressure: number;
    maxAltitude: number;
    samples: number;
    trace: string[];
    snapshot: Snapshot;
}

async function simulate(options: SimOptions = {}): Promise<SimResult> {
    const dt = options.dt ?? 0.02;
    const maxSeconds = options.maxSeconds ?? 900;
    const storage = options.storage ?? {};
    const worker = await loadWorker();
    const logs: string[] = [];
    const trace: string[] = [];
    let clock = 0;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(clock.toFixed(1) + 's ' + args.join(' ')); };

    try {
        const resumed = options.resume;
        const fresh: EngineGroup[] = [
            { name: 'LFB', thrust: 1_230, isp: 300, fuel: 30_000, active: false, flameout: false, attached: true, thrustNow: 0 },
            { name: 'Skipper', thrust: 650, isp: 340, fuel: 40_000, active: false, flameout: false, attached: true, thrustNow: 0 },
        ];
        const groups: EngineGroup[] = resumed
            ? fresh.map((group, i) => ({ ...group, ...resumed.groups[i] }))
            : fresh;
        const structureMass = 10_000, boosterDry = 6_000, coreDry = 4_000;
        let stageIndex = resumed?.stageIndex ?? 2; // KSP currentStage: 2 -> 1 -> 0
        let pendingStage = false;
        let stages = 0;

        let pos: Vec3 = resumed?.pos ?? { x: 0, y: R + 70, z: 0 };
        // Launch from rest relative to the rotating surface.
        let vel: Vec3 = resumed?.vel ?? { x: ROTATION * pos.y, y: -ROTATION * pos.x, z: 0 };
        let nose: Vec3 = resumed?.nose ?? { x: 0, y: 1, z: 0 };
        let right: Vec3 = resumed?.right ?? { x: 0, y: 0, z: 1 };
        let belly: Vec3 = resumed?.belly ?? cross(right, nose);
        let omega: Vec3 = resumed?.omega ?? { x: 0, y: 0, z: 0 };
        let lastThrottle = resumed?.lastThrottle ?? 0;
        let minThrottle = 1;
        let maxDynamicPressure = 0;
        let maxAltitude = 0;
        let time = resumed?.time ?? 0;
        let samples = 0;

        const mass = (): number => structureMass +
            (groups[0].attached ? boosterDry : 0) + (groups[1].attached ? coreDry : 0) +
            groups[0].fuel + groups[1].fuel;
        const altitude = (): number => magnitude(pos) - R;
        const upWorld = (): Vec3 => scale(pos, 1 / magnitude(pos));

        for (let tick = 0; tick < maxSeconds / dt; tick++) {
            const alt = altitude();
            maxAltitude = Math.max(maxAltitude, alt);
            const rho = alt < ATMO_DEPTH ? RHO0 * Math.exp(-alt / SCALE_HEIGHT) : 0;
            const up = upWorld();
            const east = { x: up.y, y: -up.x, z: 0 };
            // Surface-relative velocity: the atmosphere co-rotates with the body.
            const rotationVelocity = { x: ROTATION * pos.y, y: -ROTATION * pos.x, z: 0 };
            const surfaceVel = add(vel, scale(rotationVelocity, -1));
            const surfaceSpeed = magnitude(surfaceVel);
            const dynamicPressure = 0.5 * rho * surfaceSpeed * surfaceSpeed; // Pa
            maxDynamicPressure = Math.max(maxDynamicPressure, dynamicPressure / 1000);

            // Engines burn at last tick's throttle setting.
            let currentThrust = 0, availableThrust = 0;
            for (const group of groups) {
                group.thrustNow = 0;
                if (!group.attached) continue;
                if (group.active && !group.flameout) {
                    availableThrust += group.thrust;
                    if (group.fuel <= 0) {
                        group.flameout = true;
                    } else {
                        const thrust = lastThrottle * group.thrust;
                        const massFlow = thrust * 1000 / (group.isp * G0);
                        group.fuel = Math.max(0, group.fuel - massFlow * dt);
                        if (group.fuel <= 1e-6) { group.fuel = 0; group.flameout = true; }
                        group.thrustNow = thrust;
                        currentThrust += thrust;
                    }
                }
            }

            const local = (world: Vec3): Vec3 => ({
                x: dot(world, right), y: dot(world, nose), z: dot(world, belly),
            });
            const partList = groups.filter(g => g.attached).map(g => ({
                engines: {
                    count: 1,
                    get: () => ({
                        name: g.name,
                        thrust: g.thrustNow,
                        flameout: g.flameout,
                        ignited: g.active,
                        operational: g.active && !g.flameout,
                    }),
                },
            }));
            const vessel: any = {
                id: 'kerbal-x', name: 'Kerbal X', situation: (!groups[0].active && surfaceSpeed < 1)
                    ? 'PRELAUNCH' : (orbitElements(pos, vel).periapsis > 1_000 ? 'ORBITING' : 'FLYING'),
                mass: mass(), altitude: alt, latitude: 0, longitude: 0,
                engineCount: partList.length,
                flameoutEngines: groups.filter(g => g.attached && g.flameout).length,
                verticalSpeed: dot(surfaceVel, up), surfaceSpeed, horizontalSpeed: dot(surfaceVel, east),
                orbitalSpeed: magnitude(vel),
                staticPressure: 101.325 * Math.exp(-alt / SCALE_HEIGHT),
                dynamicPressure: dynamicPressure / 1000, atmosphericDensity: rho,
                mach: surfaceSpeed / 343, geeForce: currentThrust * 1000 / (mass() * G0),
                currentThrust, availableThrust, currentStage: stageIndex,
                body: { name: 'Kerbin', radius: R, gravitationalParameter: MU, atmosphereDepth: ATMO_DEPTH, hasAtmosphere: true },
                attitude: {
                    up: local(up), north: local({ x: 0, y: 0, z: 1 }), east: local(east),
                    angularVelocity: local(omega),
                },
                velocity: {
                    orbital: vel, surface: surfaceVel,
                    localSurface: local(surfaceVel), localOrbital: local(vel),
                },
                orbit: orbitElements(pos, vel),
                parts: { count: partList.length, get: (i: number) => partList[i] },
                control: {} as Record<string, number | boolean>,
                stage: () => { pendingStage = true; },
            };

            samples++;
            worker.flightTick({ vessel, universalTime: time, deltaTime: dt, storage, mechjeb: { available: false } });
            const control = vessel.control as { throttle: number; pitch: number; yaw: number; roll: number };
            assert.ok(Number.isFinite(control.throttle) && control.throttle >= 0 && control.throttle <= 1,
                'throttle in range at t=' + time.toFixed(1));
            for (const key of ['pitch', 'yaw', 'roll'] as const)
                assert.ok(Number.isFinite(control[key]) && Math.abs(control[key]) <= 0.4,
                    key + ' in range at t=' + time.toFixed(1));
            minThrottle = Math.min(minThrottle, control.throttle);
            lastThrottle = control.throttle;

            // Staging is queued and runs only after a successful tick.
            if (pendingStage && stageIndex > 0) {
                stageIndex--;
                stages++;
                pendingStage = false;
                if (stageIndex === 1) {
                    groups[0].active = groups[1].active = true;
                } else if (stageIndex === 0) {
                    groups[0].attached = false;
                    groups[0].fuel = 0;
                }
            } else {
                pendingStage = false;
            }

            // Integrate attitude.
            const torque = add(add(scale(right, -control.pitch), scale(nose, -control.roll)), scale(belly, -control.yaw));
            omega = add(omega, scale(add(scale(torque, 3), scale(omega, -0.2)), dt));
            nose = rotate(nose, omega, dt); right = rotate(right, omega, dt); belly = rotate(belly, omega, dt);

            // Integrate translation. Thrust is along the nose, gravity points to
            // the body centre, and drag opposes the surface-relative velocity.
            const acceleration = scale(nose, currentThrust * 1000 / mass());
            const gravityAcceleration = scale(up, -MU / (magnitude(pos) ** 2));
            const drag = 0.5 * rho * DRAG_AREA * surfaceSpeed / mass();
            const dragAcceleration = scale(surfaceVel, -drag);
            const totalAcceleration = add(add(acceleration, gravityAcceleration), dragAcceleration);
            vel = add(vel, scale(totalAcceleration, dt));
            pos = add(pos, scale(vel, dt));
            time += dt;
            clock = time;
            if (tick % Math.round(5 / dt) === 0) {
                const elements = orbitElements(pos, vel);
                trace.push(time.toFixed(0) + 's alt=' + Math.round(altitude()) + ' spd=' + Math.round(magnitude(vel)) +
                    ' thr=' + control.throttle.toFixed(2) + ' ap=' + Math.round(elements.apoapsis) +
                    ' pe=' + Math.round(elements.periapsis) + ' tAp=' + Math.round(elements.timeToApoapsis) +
                    ' a=' + Math.round(elements.semiMajorAxis) + ' m=' + Math.round(mass() / 1000) + 't');
            }

            if (logs.some(line => line.startsWith('Ascent: DONE'))) break;
            if (logs.some(line => line.startsWith('Ascent: ABORT'))) break;
            if (altitude() < 0) break;
            if (options.stopAfter !== undefined && time >= options.stopAfter) break;
        }

        const engineGroups = groups.filter(g => g.attached).map(g => g.name);
        const snapshot: Snapshot = {
            pos, vel, nose, right, belly, omega, time, stageIndex, lastThrottle,
            groups: groups.map(g => ({ fuel: g.fuel, active: g.active, flameout: g.flameout, attached: g.attached })),
        };
        return {
            logs, stages, engineGroups, orbit: orbitElements(pos, vel),
            finalAltitude: altitude(), finalSpeed: magnitude(vel),
            minThrottle, maxDynamicPressure, maxAltitude, samples, trace, snapshot,
        };
    } finally {
        console.log = originalLog;
    }
}

test('Kerbal X ascent worker reaches a stable low Kerbin orbit', async () => {
    const result = await simulate();
    assert.ok(!result.logs.some(line => line.includes('Ascent: ABORT')), 'aborted with orbit ' +
        JSON.stringify({ apoapsis: Math.round(result.orbit.apoapsis), periapsis: Math.round(result.orbit.periapsis), e: result.orbit.eccentricity, stages: result.stages, maxQ: Math.round(result.maxDynamicPressure), minThrottle: result.minThrottle, samples: result.samples }) +
        '\nlogs:\n' + result.logs.join('\n') + '\ntrace:\n' + result.trace.join('\n'));
    const phases = ['GRAVITY_TURN', 'COAST', 'CIRCULARIZE', 'DONE'];
    for (const phase of phases)
        assert.ok(result.logs.some(line => line.includes('Ascent: ' + phase)), 'missing phase ' + phase +
            '\nlogs:\n' + result.logs.join('\n'));
    // Two stage events: the initial ignition and the booster jettison on
    // flameout. The core stage flies to orbit.
    assert.equal(result.stages, 2, 'expected ignition plus one autostage, got ' + result.stages);
    assert.deepEqual(result.engineGroups, ['Skipper']);
    const detail = '\nfinal alt ' + Math.round(result.finalAltitude) + ' m, speed ' + Math.round(result.finalSpeed) +
        ' m/s, orbit ' + JSON.stringify({ ap: Math.round(result.orbit.apoapsis), pe: Math.round(result.orbit.periapsis), e: result.orbit.eccentricity, a: Math.round(result.orbit.semiMajorAxis) }) +
        '\nlogs:\n' + result.logs.join('\n') + '\ntrace:\n' + result.trace.join('\n');
    // Circularised by burning the computed node, so periapsis ends well clear
    // of the 70 km atmosphere and the orbit is near-circular.
    assert.ok(result.orbit.periapsis > 70_000, 'periapsis ' + result.orbit.periapsis + detail);
    assert.ok(result.orbit.eccentricity < 0.01, 'eccentricity ' + result.orbit.eccentricity + detail);
    assert.ok(Math.abs(result.orbit.apoapsis - result.orbit.periapsis) < 12_000,
        'apoapsis - periapsis ' + (result.orbit.apoapsis - result.orbit.periapsis) + detail);
});

test('ascent worker throttles down under dynamic pressure and acceleration limits', async () => {
    const result = await simulate();
    assert.ok(result.maxDynamicPressure > 10, 'expected a meaningful Max-Q, got ' + result.maxDynamicPressure);
    assert.ok(result.minThrottle < 1, 'expected the throttle to be limited at some point');
});

test('ascent worker rejects physics warp', async () => {
    const warpWorker = await loadWorker();
    const context = {
        vessel: {
            body: { gravitationalParameter: MU, radius: R },
            attitude: { up: { x: 0, y: 1, z: 0 } },
        },
        universalTime: 0,
        deltaTime: 0.5,
    } as any;
    assert.throws(() => warpWorker.flightTick(context), /physics warp|invalid telemetry/i);
});

test('ascent state is checkpointed to storage and resumes in a fresh runtime', async () => {
    const storage: Record<string, unknown> = {};
    const first = await simulate({ storage, stopAfter: 60 });
    assert.ok(first.logs.some(line => line.includes('Ascent: GRAVITY_TURN')), first.logs.join('\n'));
    assert.ok(!first.logs.some(line => line.includes('Ascent: DONE')));
    const saved = storage.ascent as Record<string, unknown>;
    assert.ok(saved, 'storage checkpoint was written');
    assert.equal(saved.version, 1);
    assert.ok(['LIFTOFF', 'GRAVITY_TURN'].includes(saved.phase as string), 'saved phase ' + saved.phase);
    assert.equal(saved.vesselId, 'kerbal-x');
    assert.ok(Number.isFinite(saved.launchTime) && Number.isFinite(saved.lastTime));

    // A fresh runtime (new module state, same part storage) continues the flight
    // instead of re-arming on the pad.
    const second = await simulate({ storage, resume: first.snapshot });
    assert.ok(second.logs.some(line => line.includes('Ascent: resuming')), second.logs.join('\n'));
    assert.ok(!second.logs.some(line => line.includes('Ascent: ABORT')), second.logs.join('\n'));
    assert.ok(second.orbit.periapsis > 60_000, 'resumed periapsis ' + second.orbit.periapsis +
        '\nlogs:\n' + second.logs.join('\n'));
    assert.ok(second.orbit.eccentricity < 0.05, 'resumed eccentricity ' + second.orbit.eccentricity);
});

test('a completed flight restarts fresh instead of resuming', async () => {
    const storage: Record<string, unknown> = {};
    const first = await simulate({ storage });
    assert.ok(first.logs.some(line => line.includes('Ascent: DONE')), first.logs.join('\n'));
    assert.equal((storage.ascent as Record<string, unknown>).phase, 'DONE');
    const second = await simulate({ storage });
    assert.ok(second.logs.some(line => line.includes('Ascent: armed')), second.logs.join('\n'));
    assert.ok(!second.logs.some(line => line.includes('resuming')), second.logs.join('\n'));
});

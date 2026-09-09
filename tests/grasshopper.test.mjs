import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../GameData/Klanker/Workers/grasshopper.js', import.meta.url), 'utf8');
function load() {
    const logs = [];
    const sandbox = { console: { log: (...args) => logs.push(args.join(' ')) } };
    vm.runInNewContext(source.replace('export default', 'globalThis.worker =') +
        '\n globalThis.PID = PID; globalThis.state = () => phase; globalThis.setPhase = transition; globalThis.horizontal = [northPID, eastPID];', sandbox);
    return { worker: sandbox.worker, logs, PID: sandbox.PID, state: sandbox.state,
        setPhase: sandbox.setPhase, horizontal: sandbox.horizontal };
}
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const magnitude = a => Math.hypot(...a);
const scale = (a, s) => a.map(x => x * s);
const add = (a, b) => a.map((x, i) => x + b[i]);
function rotate(v, omega, dt) {
    const speed = magnitude(omega);
    if (speed < 1e-12) return v;
    const axis = scale(omega, 1 / speed), angle = speed * dt;
    return add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
        scale(axis, dot(axis, v) * (1 - Math.cos(angle))));
}

// A rigid point-mass/torque model, NOT KSP physics, aerodynamics, gimbal, or landing legs.
function simulate({ dt = 0.02, authority = 3, roll = 0, actualHover = 0.5, disturbance = false } = {}) {
    const { worker, logs, state } = load();
    let disturbed = false;
    let right = [Math.cos(roll), 0, -Math.sin(roll)];
    let nose = [0, 1, 0], belly = cross(right, nose);
    let omega = [0, 0, 0], position = [0, 0, 0], velocity = [0, 0, 0];
    let airborne = false, maxHeight = 0, touchdownSpeed = Infinity;
    const local = world => ({ x: dot(world, right), y: dot(world, nose), z: dot(world, belly) });
    const radius = 600000;
    const vessel = {
        id: 'hopper', body: { name: 'Kerbin', radius, gravitationalParameter: 9.81 * radius ** 2 },
        control: {}, attitude: {}, velocity: {},
    };
    for (let time = 0; time < 180; time += dt) {
        if (disturbance && !disturbed && state() === 'descend' && position[1] < 20) {
            velocity = add(velocity, [1, 0, -0.5]);
            disturbed = true;
        }
        const massFraction = 1 - 0.0005 * time;
        Object.assign(vessel, {
            mass: 2000 * massFraction, latitude: position[2] / radius * 180 / Math.PI,
            longitude: position[0] / radius * 180 / Math.PI, altitude: 103 + position[1],
            heightAboveTerrain: 3 + position[1], verticalSpeed: velocity[1],
            surfaceSpeed: magnitude(velocity),
            situation: position[1] > 0 ? 'FLYING' : airborne ? 'LANDED' : 'PRELAUNCH',
            attitude: { up: local([0, 1, 0]), north: local([0, 0, 1]), east: local([1, 0, 0]), angularVelocity: local(omega) },
            velocity: { localSurface: local(velocity) },
        });
        worker.flightTick({ vessel, universalTime: time, deltaTime: dt });
        const c = vessel.control;
        assert.ok(Object.values(c).every(Number.isFinite));
        assert.ok(c.throttle >= 0 && c.throttle <= 1);
        for (const key of ['pitch', 'yaw', 'roll']) assert.ok(Math.abs(c[key]) <= 0.35);
        if (logs.includes('Grasshopper: landed')) {
            assert.equal(c.throttle, 0);
            return { logs, position, velocity, maxHeight, touchdownSpeed, disturbed };
        }
        const torque = add(add(scale(right, -c.pitch), scale(nose, -c.roll)), scale(belly, -c.yaw));
        omega = add(omega, scale(add(scale(torque, authority), scale(omega, -0.2)), dt));
        right = rotate(right, omega, dt); nose = rotate(nose, omega, dt); belly = rotate(belly, omega, dt);
        const gravity = vessel.body.gravitationalParameter / (radius + vessel.altitude) ** 2;
        const acceleration = add(scale(nose, 9.81 * c.throttle / actualHover / massFraction), [0, -gravity, 0]);
        velocity = add(velocity, scale(acceleration, dt));
        position = add(position, scale(velocity, dt));
        if (position[1] > 1) airborne = true;
        maxHeight = Math.max(maxHeight, position[1]);
        if (position[1] <= 0) {
            if (airborne) touchdownSpeed = -velocity[1];
            position[1] = 0; velocity[1] = 0;
        }
    }
    assert.fail('hopper did not land');
}

for (const options of [
    {}, { dt: 0.01, roll: Math.PI / 2 }, { dt: 0.04, authority: 1.5, roll: -0.7 },
    { actualHover: 0.55, authority: 6 },
    { disturbance: true },
]) {
    test('grasshopper closed-loop hop ' + JSON.stringify(options), () => {
        const result = simulate(options);
        for (const phase of ['translate', 'brake', 'descend', 'landed'])
            assert.ok(result.logs.includes('Grasshopper: ' + phase), phase);
        assert.ok(result.maxHeight >= 29 && result.maxHeight < 35, '30 m climb');
        // Velocity cancellation intentionally allows positional drift after braking.
        assert.ok(result.position[0] > 12 && result.position[0] < 28 && Math.abs(result.position[2]) < 1,
            'approximate eastward hop: ' + JSON.stringify(result));
        assert.ok(result.touchdownSpeed < 0.6, 'slow touchdown: ' + JSON.stringify(result));
        assert.ok(Math.hypot(result.velocity[0], result.velocity[2]) < 0.4, 'horizontal braking');
        if (options.disturbance) assert.ok(result.disturbed, 'descent disturbance was applied');
    });
}

test('grasshopper refuses an airborne start and bad timing', () => {
    const vessel = {
        mass: 1000, latitude: 0, longitude: 0, altitude: 100, heightAboveTerrain: 100,
        verticalSpeed: 0, surfaceSpeed: 0, situation: 'FLYING',
        body: { radius: 600000, gravitationalParameter: 3.53e12 },
        attitude: { up: { x: 0, y: 1, z: 0 }, north: { x: 0, y: 0, z: 1 },
            east: { x: 1, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } },
        velocity: { localSurface: { x: 0, y: 0, z: 0 } }, control: {},
    };
    assert.throws(() => load().worker.flightTick({ vessel, universalTime: 0, deltaTime: 0.02 }), /start stationary/);
    assert.throws(() => load().worker.flightTick({ vessel, universalTime: 0, deltaTime: 0.2 }), /physics warp/);
    assert.deepEqual(vessel.control, {});
});

test('PID uses simulation dt, filtered derivative on measurement, and reset', () => {
    const { PID } = load();
    for (const dt of [0.01, 0.02, 0.04]) {
        const pid = new PID(0, 1, 0);
        for (let i = 0; i < Math.round(4 / dt); i++) pid.update(0.01, 0, dt, 1);
        assert.ok(Math.abs(pid.integral - 0.04) < 1e-10);
    }
    const pid = new PID(0, 0, 1);
    assert.equal(pid.update(0, 0, 0.02, 100), 0);
    assert.equal(pid.update(10, 0, 0.02, 100), 0, 'no setpoint derivative kick');
    const output = pid.update(10, 1, 0.02, 100);
    assert.ok(output < 0 && output > -3, 'measurement derivative filtered, not raw -50');
    pid.reset();
    assert.equal(pid.update(10, 1, 0.02, 100), 0, 'reset clears derivative history');
});

test('PID anti-windup covers scalar and shared-vector saturation', () => {
    const { PID } = load();
    const pid = new PID(1, 1, 0);
    for (let i = 0; i < 1000; i++) assert.equal(pid.update(10, 0, 0.02, 0.1), 0.1);
    assert.equal(pid.integral, 0, 'no integration into saturation');
    assert.equal(pid.update(0, 0, 0.02, 0.1), 0);
    pid.update(0.05, 0, 0.02, 1);
    const before = pid.integral;
    pid.track(0, 0.02);
    assert.ok(pid.integral < before, 'back-calculation tracks actual vector-limited output');
    pid.reset();
    assert.equal(pid.update(0, 0.02, 0.02, 1, 0.05), 0, 'small speed deadband');
});

test('brake and descent request zero speed regardless of landing-position error', () => {
    const { worker, setPhase, horizontal } = load();
    const vessel = {
        id: 'test', mass: 1000, latitude: 0, longitude: 0, altitude: 103,
        heightAboveTerrain: 3, verticalSpeed: 0, surfaceSpeed: 0, situation: 'PRELAUNCH',
        body: { name: 'Kerbin', radius: 600000, gravitationalParameter: 3.53e12 },
        attitude: { up: { x: 0, y: 1, z: 0 }, north: { x: 0, y: 0, z: 1 },
            east: { x: 1, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } },
        velocity: { localSurface: { x: 0, y: 0, z: 0 } }, control: {},
    };
    worker.flightTick({ vessel, universalTime: 0, deltaTime: 0.02 });
    const targets = [];
    for (const pid of horizontal) {
        const update = pid.update.bind(pid);
        pid.update = (target, ...args) => { targets.push(target); return update(target, ...args); };
    }
    vessel.situation = 'FLYING'; vessel.heightAboveTerrain = 33;
    vessel.longitude = -30 / 600000 * 180 / Math.PI; // Far west of the eastward goal.
    let time = 0;
    for (const phase of ['brake', 'descend']) {
        setPhase(phase);
        worker.flightTick({ vessel, universalTime: time += 0.02, deltaTime: 0.02 });
    }
    assert.deepEqual(targets, [0, 0, 0, 0]);
});

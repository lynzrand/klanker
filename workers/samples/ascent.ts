// Launch-to-orbit autopilot for a stock multi-stage liquid rocket (the stock
// Kerbal X is the reference craft). No MechJeb: it steers with the Klanker
// attitude and orbit helpers, throttles for Max-Q and acceleration limits, and
// autostages on engine flameout. Crossfeed is KSP's problem, not ours — the
// per-engine flameout signal already accounts for fuel lines.
//
// Fly it on an untweaked Kerbal X from the pad:
//   pnpm klanker deploy workers/samples/ascent.ts --to ascent --run
// Leave SAS off; this worker owns pitch/yaw/roll. It releases the clamps and
// ignites the first stage itself, so do not press Space first.
import { AttitudeHold, frame, orbit, vec } from 'klanker';

const config = Object.freeze({
    // Circularise at apoapsis by executing a computed prograde node: burn the
    // vis-viva delta-v and stop when it has been delivered. Apoapsis and
    // periapsis swap roles during the burn, so a periapsis-vs-apoapsis test is
    // unstable; a burned-delta-v test is monotonic. The tolerance is the
    // remaining delta-v at which the node counts as complete.
    targetApoapsis: 80_000,
    circularDvTolerance: 5,

    // Gravity turn: hold vertical to turnStartAltitude, then pitch over on an
    // exponential curve — quick while the air is thin and the rocket is slow,
    // flattening as it climbs. `turnScale` is the altitude constant of the
    // curve; larger values pitch over later.
    turnStartAltitude: 1_000,
    turnStartPitch: 8,
    finalPitch: 90,
    turnScale: 9_000,

    // Keep the angle of attack bounded in air; relax it in vacuum where there
    // is no aerodynamic reason to follow prograde exactly. Allowing a few
    // degrees of AoA early is what actually starts the turn — a tight cap makes
    // the vehicle hold its initial vertical attitude indefinitely.
    maxAngleOfAttack: 15,
    vacuumAngleOfAttack: 25,

    // Throttle limits. Kerbin's worst dynamic pressure on a typical ascent is
    // roughly 30 kPa; the acceleration cap keeps the crew under about 3 g.
    maxDynamicPressure: 30, // kPa, matching vessel.dynamicPressure
    maxAcceleration: 30,    // m/s^2
    minThrottle: 0.35,
    // The apoapsis taper below is proportional, so apoapsis approaches the
    // target asymptotically. Cut this far short of it and let the coast carry
    // the rest.
    mecoMargin: 250,

    // Autostaging: how long a flameout must persist before firing the next
    // stage, and the minimum gap between stages.
    stageDelay: 0.35,
    stageCooldown: 1.0,

    liftoffTimeout: 20,
    launchTimeout: 600,
});

type Phase = 'PRELAUNCH' | 'LIFTOFF' | 'GRAVITY_TURN' | 'COAST' | 'CIRCULARIZE' | 'DONE' | 'ABORT';

const radians = Math.PI / 180;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

const hold = new AttitudeHold({ kp: 1.6, kd: 2.4, rollKd: 1.0, maxInput: 0.4 });

// Flight state lives in ctx.storage, not just module variables, so an ascent
// survives a quicksave/reload, a control-point change, or redeploying a fixed
// script mid-flight. Module variables stay the hot copy; storage is the
// durable one, rewritten each tick (writes are in-memory until KSP saves).
// Storage is per-part, so it is namespaced and version-tagged against schema
// drift and reused computers. Only finite JSON values may be stored, so
// "never staged" is a launch time rather than -Infinity.
const STORAGE_KEY = 'ascent';
const SCHEMA_VERSION = 1;
// Phases that a resumed flight may legitimately be in; DONE and ABORT restart.
const RESUMABLE_PHASES: readonly Phase[] = ['PRELAUNCH', 'LIFTOFF', 'GRAVITY_TURN', 'COAST', 'CIRCULARIZE'];

let initialized = false;
let phase: Phase = 'PRELAUNCH';
let vesselId = '', bodyName = '';
let launchTime = 0, lastTime = 0, startAltitude = 0;
let ignitionCommanded = false, liftoffDetected = false;
let lastStageTime = 0, stageDemand = 0;
let finishedLogged = false;
let targetApoapsis: number = config.targetApoapsis;
let circularizeDv = 0, circularizeBurned = 0;
// Storage is rebuilt only when the state actually changes, not every tick, so
// the steady-state handler allocates almost nothing.
let lastPersistTime = Number.NEGATIVE_INFINITY;
let persistDirty = true;

function isJsonObject(value: Klanker.JsonValue | undefined): value is Klanker.Storage {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function persist(storage: Klanker.Storage, now: number): void {
    if (!persistDirty && now - lastPersistTime < 0.5) return;
    lastPersistTime = now;
    persistDirty = false;
    storage[STORAGE_KEY] = {
        version: SCHEMA_VERSION,
        phase, targetApoapsis, launchTime, lastTime, startAltitude,
        vesselId, bodyName, ignitionCommanded, liftoffDetected,
        lastStageTime, stageDemand, finishedLogged, circularizeDv, circularizeBurned,
    };
}

// Returns true when a compatible in-flight state was restored. A finished or
// faulted flight, a different vessel, and a stale schema all start fresh.
function restore(storage: Klanker.Storage, vessel: Klanker.VesselView, now: number): boolean {
    const raw = storage[STORAGE_KEY];
    if (!isJsonObject(raw) || raw.version !== SCHEMA_VERSION) return false;
    if (raw.vesselId !== vessel.id || raw.bodyName !== vessel.body.name) return false;
    if (raw.phase === 'DONE' || raw.phase === 'ABORT') return false;
    const values = [raw.targetApoapsis, raw.launchTime, raw.lastTime, raw.startAltitude,
        raw.lastStageTime, raw.stageDemand];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return false;
    if (typeof raw.phase !== 'string' || typeof raw.vesselId !== 'string' || typeof raw.bodyName !== 'string')
        return false;
    if (!RESUMABLE_PHASES.includes(raw.phase as Phase)) return false;
    if (!(now >= (raw.lastTime as number))) return false; // loaded an older save; restart
    phase = raw.phase as Phase;
    targetApoapsis = raw.targetApoapsis as number;
    circularizeDv = typeof raw.circularizeDv === 'number' && Number.isFinite(raw.circularizeDv) ? raw.circularizeDv : 0;
    circularizeBurned = typeof raw.circularizeBurned === 'number' && Number.isFinite(raw.circularizeBurned)
        ? raw.circularizeBurned : 0;
    launchTime = raw.launchTime as number;
    lastTime = raw.lastTime as number;
    startAltitude = raw.startAltitude as number;
    lastStageTime = raw.lastStageTime as number;
    stageDemand = raw.stageDemand as number;
    vesselId = raw.vesselId;
    bodyName = raw.bodyName;
    ignitionCommanded = raw.ignitionCommanded === true;
    liftoffDetected = raw.liftoffDetected === true;
    finishedLogged = raw.finishedLogged === true;
    return true;
}

// Touch every host member a later phase reads, during the first tick's larger
// budget. ClearScript binds a host member on first access; with dynamic binding
// disabled that first-touch cost (reflection cache and Mono JIT) can exceed the
// steady-state 20 ms budget exactly when the phase changes, which looks like a
// stall at the gravity turn. Pre-reading them once moves that cost into the
// 250 ms first tick.
let warmupSink: (number | boolean)[] = [];
function warmup(context: Klanker.FlightContext): void {
    const { vessel } = context;
    warmupSink = [
        vessel.velocity.localSurface.x, vessel.velocity.localOrbital.x,
        vessel.staticPressure, vessel.dynamicPressure, vessel.atmosphericDensity,
        vessel.mach, vessel.geeForce, vessel.engineCount, vessel.flameoutEngines,
        vessel.orbit.apoapsis, vessel.orbit.periapsis, vessel.orbit.timeToApoapsis,
        vessel.orbit.eccentricity, vessel.orbit.semiMajorAxis,
        vessel.body.hasAtmosphere, vessel.body.atmosphereDepth,
        vessel.attitude.north.x, vessel.attitude.east.x,
    ];
}

// Prograde in control axes. In air the surface-relative direction is what the
// fins and drag see; in vacuum the inertial orbital direction is correct. Use
// the host's local vectors rather than converting world axes by hand: KSP's
// world axes are not east/north/up, so a manual frame conversion is wrong.
function progradeDirection(context: Klanker.FlightContext, inAtmosphere: boolean): { x: number; y: number; z: number } {
    const reference = inAtmosphere ? context.vessel.velocity.localSurface : context.vessel.velocity.localOrbital;
    return vec.length(reference) > 1e-3 ? vec.normalize(reference) : { x: 0, y: 1, z: 0 };
}

function enter(next: Phase, now: number, detail = ''): void {
    phase = next;
    stageDemand = 0;
    persistDirty = true;
    console.log('Ascent:', next + (detail ? ' — ' + detail : ''));
}

export default {
    flightTick(context) {
        const { vessel, storage, universalTime: now, deltaTime: dt } = context;
        const mu = vessel.body.gravitationalParameter;
        const radius = vessel.body.radius + vessel.altitude;
        const gravity = mu / (radius * radius);
        const numbers = [now, dt, vessel.mass, vessel.altitude, vessel.verticalSpeed,
            vessel.surfaceSpeed, vessel.dynamicPressure, vessel.currentThrust, gravity,
            vessel.attitude.up.x, vessel.attitude.up.y, vessel.attitude.up.z];
        if (!numbers.every(Number.isFinite) || !(dt > 0) || dt > 0.1 || !(gravity > 0) || !(vessel.mass > 0))
            throw new Error('Ascent: invalid telemetry or physics warp; fly at 1x.');

        if (!initialized) {
            initialized = true;
            warmup(context);
            // A fresh runtime may be attached on the pad or mid-flight (a
            // redeploy, a fault recovery, a control-point change). Only a
            // prelaunch vessel gets the ignition stage; an airborne one is
            // picked up in the phase its state implies, so nothing is
            // jettisoned by surprise. Stored state is only trusted while
            // airborne, so a revert to the pad cannot resurrect an old ascent.
            const onPad = vessel.situation === 'PRELAUNCH' || vessel.situation === 'LANDED';
            if (!onPad && restore(storage, vessel, now)) {
                console.log('Ascent: resuming', phase, 'at', Math.round(vessel.altitude), 'm from storage.');
            } else {
                launchTime = lastTime = now;
                lastStageTime = now;
                startAltitude = vessel.altitude;
                vesselId = vessel.id;
                bodyName = vessel.body.name;
                targetApoapsis = config.targetApoapsis;
                stageDemand = 0;
                finishedLogged = false;
                if (onPad) {
                    phase = 'PRELAUNCH';
                    ignitionCommanded = liftoffDetected = false;
                    console.log('Ascent: armed for', targetApoapsis, 'm apoapsis; releasing clamps and igniting.');
                } else {
                    ignitionCommanded = liftoffDetected = true;
                    const inAir = vessel.body.hasAtmosphere && vessel.altitude < vessel.body.atmosphereDepth;
                    phase = inAir ? 'GRAVITY_TURN' : 'COAST';
                    console.log('Ascent: mid-flight start in', phase, 'at', Math.round(vessel.altitude), 'm.');
                }
            }
        } else if (now <= lastTime) {
            if (now < lastTime) throw new Error('Ascent: simulation time went backwards.');
            return;
        }
        if (now - lastTime > 0.5 || vessel.id !== vesselId || vessel.body.name !== bodyName)
            throw new Error('Ascent: interrupted flight context.');
        lastTime = now;

        const height = vessel.altitude - startAltitude;
        const hasAtmosphere = vessel.body.hasAtmosphere;
        const inAtmosphere = hasAtmosphere && vessel.altitude < vessel.body.atmosphereDepth;
        const engineCount = vessel.engineCount;
        const engineFlameout = vessel.flameoutEngines;
        const engineThrust = vessel.currentThrust;
        const engineAvailable = vessel.availableThrust;
        if (!liftoffDetected && (vessel.verticalSpeed > 1 || height > 5)) liftoffDetected = true;

        // --- Staging ------------------------------------------------------
        // A dry stage shows up either as every engine out of thrust (available
        // thrust collapses) or as some engines flaming out while others still
        // push. Both mean the current stage is done; drop it.
        const allDead = engineCount > 0 && engineAvailable < 1;
        const partialFlameout = engineFlameout > 0 && engineThrust > 1;
        const mayStage = liftoffDetected && vessel.currentStage > 0 && now - launchTime < config.launchTimeout;
        const wantsStage = mayStage && phase !== 'PRELAUNCH' && phase !== 'DONE' && phase !== 'ABORT' &&
            (allDead || partialFlameout);
        if (wantsStage) {
            stageDemand += dt;
            if (now - lastStageTime > config.stageCooldown && stageDemand >= config.stageDelay) {
                vessel.stage();
                lastStageTime = now;
                stageDemand = 0;
                persistDirty = true;
            }
        } else {
            stageDemand = 0;
        }

        // A launch that never reaches orbit in the time budget is stuck; abort
        // before the phase work so the abort branch owns the controls.
        if (phase !== 'DONE' && phase !== 'ABORT' && phase !== 'COAST' &&
            now - launchTime > config.launchTimeout)
            enter('ABORT', now, 'launch timeout');

        // --- Guidance target and throttle, by phase -----------------------
        let target = vessel.attitude.up;
        let throttle = 1;

        if (phase === 'PRELAUNCH') {
            target = frame.tilt(context, 0);
            throttle = 0;
            if (!ignitionCommanded) {
                ignitionCommanded = true;
                vessel.stage();
                enter('LIFTOFF', now);
            }
        } else if (phase === 'LIFTOFF') {
            target = frame.tilt(context, 0);
            if (vessel.altitude >= config.turnStartAltitude) enter('GRAVITY_TURN', now);
            else if (now - launchTime > config.liftoffTimeout && height < 5)
                enter('ABORT', now, 'no liftoff; check engine, clamps and TWR');
        } else if (phase === 'GRAVITY_TURN') {
            const climbed = Math.max(0, vessel.altitude - config.turnStartAltitude);
            const progress = 1 - Math.exp(-climbed / config.turnScale);
            const pitch = config.turnStartPitch + (config.finalPitch - config.turnStartPitch) * progress;
            target = frame.tilt(context, pitch);
            // Limit the angle of attack by biasing the target toward prograde.
            const prograde = progradeDirection(context, inAtmosphere);
            const limit = (inAtmosphere ? config.maxAngleOfAttack : config.vacuumAngleOfAttack) * radians;
            const error = vec.angle(target, prograde);
            if (error > limit && error > 1e-6)
                target = vec.normalize(vec.lerp(target, prograde, (error - limit) / error)) as Klanker.LocalVectorView;

            throttle = 1;
            if (inAtmosphere && vessel.dynamicPressure > config.maxDynamicPressure)
                throttle = Math.min(throttle, clamp(config.maxDynamicPressure / vessel.dynamicPressure,
                    config.minThrottle, 1));
            const acceleration = engineThrust * 1000 / vessel.mass;
            if (acceleration > config.maxAcceleration)
                throttle = Math.min(throttle, clamp(config.maxAcceleration / acceleration, config.minThrottle, 1));
            const taper = Math.max(2_000, targetApoapsis * 0.08);
            if (vessel.orbit.apoapsis > targetApoapsis - taper)
                throttle = Math.min(throttle, clamp((targetApoapsis - vessel.orbit.apoapsis) / taper, 0, 1));

            if (vessel.orbit.apoapsis >= targetApoapsis - config.mecoMargin) {
                throttle = 0;
                enter('COAST', now, 'apoapsis ' + Math.round(vessel.orbit.apoapsis) + ' m');
            } else if (vessel.verticalSpeed < -100 && vessel.altitude < 5_000) {
                enter('ABORT', now, 'losing altitude under power');
            }
        } else if (phase === 'COAST') {
            target = progradeDirection(context, inAtmosphere);
            throttle = 0;
            const apoapsisRadius = vessel.body.radius + vessel.orbit.apoapsis;
            const deltaV = Math.max(0, orbit.circularizationDeltaV(mu, apoapsisRadius, vessel.orbit.semiMajorAxis));
            const burn = Math.max(2, orbit.burnTime(vessel.mass, deltaV, Math.max(engineAvailable, 1)));
            // Near apoapsis, or already past it and falling, so a warp or a
            // missed window cannot strand the node.
            const nearApoapsis = vessel.verticalSpeed <= 0 && vessel.altitude >= vessel.orbit.apoapsis - 5_000;
            const alreadyCircular = vessel.orbit.eccentricity < 0.005 &&
                vessel.orbit.periapsis > vessel.body.atmosphereDepth;
            if (deltaV <= config.circularDvTolerance || alreadyCircular)
                enter('DONE', now, 'orbit already circular');
            else if ((Number.isFinite(vessel.orbit.timeToApoapsis) &&
                vessel.orbit.timeToApoapsis <= burn / 2) || nearApoapsis) {
                circularizeDv = deltaV;
                circularizeBurned = 0;
                enter('CIRCULARIZE', now, 'node ' + Math.round(deltaV) + ' m/s, ' + burn.toFixed(1) + ' s');
            } else if (engineAvailable < 1)
                enter('ABORT', now, 'propellant exhausted before apoapsis');
        } else if (phase === 'CIRCULARIZE') {
            target = progradeDirection(context, false);
            throttle = 1;
            const acceleration = engineThrust * 1000 / vessel.mass;
            if (acceleration > config.maxAcceleration)
                throttle = Math.max(config.minThrottle, clamp(config.maxAcceleration / acceleration, 0, 1));
            // Track the delta-v actually delivered; a node is done when its
            // target has been burned, independent of how the apsides relabel.
            circularizeBurned += Math.max(0, acceleration) * dt;
            if (circularizeBurned >= circularizeDv - config.circularDvTolerance) {
                throttle = 0;
                enter('DONE', now, 'burned ' + Math.round(circularizeBurned) + ' m/s');
            } else if (engineAvailable < 1 && vessel.currentStage === 0) {
                enter('ABORT', now, 'propellant exhausted before circularization');
            }
        } else if (phase === 'DONE' || phase === 'ABORT') {
            throttle = 0;
            target = phase === 'DONE' ? progradeDirection(context, false) : vessel.attitude.up;
            if (phase === 'DONE' && !finishedLogged) {
                finishedLogged = true;
                console.log('Ascent: orbit apoapsis', Math.round(vessel.orbit.apoapsis),
                    'm periapsis', Math.round(vessel.orbit.periapsis), 'm');
            }
        }

        // Steering and throttle are buffered; SAS stays off so nothing fights us.
        vessel.control.sas = false;
        hold.aim(context, target);
        vessel.control.throttle = clamp(throttle, 0, 1);
        // Checkpoint the durable state; KSP serializes it at its save hook.
        persist(storage, now);
    },
} satisfies Klanker.Worker;

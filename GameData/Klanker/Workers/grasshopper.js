// @ts-check
/// <reference path="./klanker.d.ts" />
// Experimental low-altitude hopper. Read docs/grasshopper.md before flying.
// Upright liquid rocket, landing legs down, SAS OFF, no other autopilot.
// Start on the ground; activate the engine/release clamps manually.
const config = Object.freeze({
    hopHeight: 30,             // metres above the initial ground clearance
    eastDistance: 20,          // metres east; negative goes west
    hoverThrottle: 0.5,        // approximately 1 / launch TWR at current engine limiter
    climbSpeed: 3,             // m/s
    sidewaysSpeed: 2,          // m/s
    descentSpeed: 1,           // m/s, slows to 0.3 near the ground
    maxTiltDegrees: 8,
    descentTiltDegrees: 3,     // tapers to 1 degree in the last 5 m
    horizontalKp: 0.45,
    horizontalKi: 0.04,
    horizontalKd: 0.2,
    attitudeGain: 1.5,         // control fraction per radian of direction error
    dampingGain: 2.0,          // control fraction per rad/s
    maxAttitudeInput: 0.25,
});

let initialized = false;
let phase = 'climb';
let airborne = false;
let startTime = 0, lastTime = 0, stableFor = 0;
let startLat = 0, startLon = 0, startClearance = 0, startMass = 0, startGravity = 0;
let verticalIntegral = 0;
let vesselId = '', bodyName = '';
const radians = Math.PI / 180;

/** @param {number} value @param {number} low @param {number} high */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
/** @param {{x:number,y:number,z:number}} a @param {{x:number,y:number,z:number}} b */
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// Self-contained because saved workers currently contain a single JS module.
// Derivative on measurement avoids setpoint kick. Integral is in output units.
class PID {
    /** @param {number} kp @param {number} ki @param {number} kd */
    constructor(kp, ki, kd) {
        this.kp = kp; this.ki = ki; this.kd = kd;
        this.integral = 0; this.derivative = 0;
        /** @type {number | null} */
        this.previous = null;
        this.output = 0;
    }
    reset() {
        this.integral = 0; this.derivative = 0; this.previous = null; this.output = 0;
    }
    /** @param {number} target @param {number} measurement @param {number} dt
     * @param {number} limit @param {number} deadband */
    update(target, measurement, dt, limit, deadband = 0) {
        const rawDerivative = this.previous === null ? 0 : (measurement - this.previous) / dt;
        this.previous = measurement;
        this.derivative += dt / (0.35 + dt) * (rawDerivative - this.derivative);
        const rawError = target - measurement;
        const error = Math.sign(rawError) * Math.max(0, Math.abs(rawError) - deadband);
        const base = this.kp * error - this.kd * this.derivative;
        const candidate = clamp(this.integral + this.ki * error * dt, -0.2, 0.2);
        // Conditional integration: permit unwinding, not accumulation into saturation.
        if ((base + candidate <= limit || error < 0) && (base + candidate >= -limit || error > 0))
            this.integral = candidate;
        this.output = clamp(base + this.integral, -limit, limit);
        return this.output;
    }
    /** Back-calculation for the shared two-axis acceleration/tilt limit.
     * @param {number} applied @param {number} dt */
    track(applied, dt) {
        this.integral = clamp(this.integral + (applied - this.output) * Math.min(1, dt), -0.2, 0.2);
    }
}
const northPID = new PID(config.horizontalKp, config.horizontalKi, config.horizontalKd);
const eastPID = new PID(config.horizontalKp, config.horizontalKi, config.horizontalKd);

/** @param {string} next */
function transition(next) {
    phase = next;
    stableFor = 0;
    northPID.reset(); eastPID.reset();
    console.log('Grasshopper:', next);
}

/** @satisfies {Klanker.Worker} */
export default {
    flightTick({ vessel, universalTime: now, deltaTime: dt }) {
        const up = vessel.attitude.up;
        const north = vessel.attitude.north;
        const east = vessel.attitude.east;
        const velocity = vessel.velocity.localSurface;
        const omega = vessel.attitude.angularVelocity;
        const gravity = vessel.body.gravitationalParameter / (vessel.body.radius + vessel.altitude) ** 2;
        const landed = vessel.situation === 'LANDED' || vessel.situation === 'PRELAUNCH';
        const numbers = [now, dt, vessel.mass, vessel.latitude, vessel.longitude,
            vessel.heightAboveTerrain, vessel.verticalSpeed, vessel.surfaceSpeed,
            gravity, up.x, up.y, up.z, north.x, north.y, north.z, east.x, east.y, east.z,
            velocity.x, velocity.y, velocity.z, omega.x, omega.y, omega.z];
        if (!numbers.every(Number.isFinite) || dt <= 0 || dt > 0.1 || gravity <= 0 || vessel.mass <= 0)
            throw new Error('Grasshopper: invalid telemetry or physics warp; use normal 1x flight.');

        if (!initialized) {
            if (!landed || up.y < 0.98 || vessel.surfaceSpeed > 0.5 || Math.abs(vessel.latitude) > 85)
                throw new Error('Grasshopper: start stationary, upright, on land, away from the poles. Do not reload in midair.');
            initialized = true;
            startTime = lastTime = now;
            startLat = vessel.latitude; startLon = vessel.longitude;
            startClearance = vessel.heightAboveTerrain;
            startMass = vessel.mass; startGravity = gravity;
            vesselId = vessel.id; bodyName = vessel.body.name;
            console.log('Grasshopper: climb; launch hover throttle =', config.hoverThrottle);
        } else if (now <= lastTime) {
            // Do not integrate or change controls twice at the same simulation time.
            if (now < lastTime) throw new Error('Grasshopper: simulation time went backwards; restart on the ground.');
            return;
        }
        if (now - lastTime > 0.2 || vessel.id !== vesselId || vessel.body.name !== bodyName)
            throw new Error('Grasshopper: interrupted flight context; take manual control.');
        lastTime = now;
        const height = vessel.heightAboveTerrain - startClearance;
        const radius = vessel.body.radius;
        const northMetres = (vessel.latitude - startLat) * radians * radius;
        const longitudeDelta = ((vessel.longitude - startLon + 540) % 360) - 180;
        const eastMetres = longitudeDelta * radians * radius * Math.cos(startLat * radians);
        const northSpeed = dot(velocity, north);
        const eastSpeed = dot(velocity, east);
        const horizontalSpeed = Math.hypot(northSpeed, eastSpeed);
        if (height > 1 && !landed) airborne = true;

        if (phase === 'landed' || (airborne && landed)) {
            if (phase !== 'landed') transition('landed');
            vessel.control.throttle = 0;
            vessel.control.pitch = vessel.control.yaw = vessel.control.roll = 0;
            return;
        }
        if (up.y < Math.cos(45 * radians) || height > 100 ||
            Math.hypot(northMetres, eastMetres) > 100 || now - startTime > 180)
            throw new Error('Grasshopper: test envelope exceeded; take manual control or revert flight.');
        if (!airborne && now - startTime > 15)
            throw new Error('Grasshopper: no liftoff; check engine, clamps, and launch TWR.');

        const targetEast = phase === 'climb' ? 0 : config.eastDistance;
        const distance = Math.hypot(northMetres, targetEast - eastMetres);
        const heightSettled = Math.abs(height - config.hopHeight) < 1 && Math.abs(vessel.verticalSpeed) < 0.3;
        if (phase === 'climb') {
            stableFor = heightSettled && horizontalSpeed < 0.3 ? stableFor + dt : 0;
            if (stableFor >= 2) transition('translate');
        } else if (phase === 'translate' && distance < 5) {
            transition('brake');
        } else if (phase === 'brake') {
            stableFor = horizontalSpeed < 0.25 && heightSettled ? stableFor + dt : 0;
            if (stableFor >= 2) transition('descend');
        }

        // Position guides climb/translation only. Brake/descent cancel velocity,
        // accepting landing drift instead of chasing an exact coordinate.
        const cancelVelocity = phase === 'brake' || phase === 'descend';
        const northTarget = cancelVelocity ? 0 : clamp(-0.4 * northMetres, -config.sidewaysSpeed, config.sidewaysSpeed);
        const eastTarget = cancelVelocity ? 0 : clamp(0.4 * ((phase === 'climb' ? 0 : config.eastDistance) - eastMetres), -config.sidewaysSpeed, config.sidewaysSpeed);
        const tilt = phase === 'descend'
            ? 1 + (config.descentTiltDegrees - 1) * clamp(height / 5, 0, 1)
            : phase === 'brake' ? config.descentTiltDegrees : config.maxTiltDegrees;
        const maxHorizontalAcceleration = gravity * Math.tan(tilt * radians);
        const deadband = cancelVelocity ? 0.05 : 0;
        let northAcceleration = northPID.update(northTarget, northSpeed, dt, maxHorizontalAcceleration, deadband);
        let eastAcceleration = eastPID.update(eastTarget, eastSpeed, dt, maxHorizontalAcceleration, deadband);
        const horizontalAcceleration = Math.hypot(northAcceleration, eastAcceleration);
        if (horizontalAcceleration > maxHorizontalAcceleration) {
            northAcceleration *= maxHorizontalAcceleration / horizontalAcceleration;
            eastAcceleration *= maxHorizontalAcceleration / horizontalAcceleration;
        }
        northPID.track(northAcceleration, dt); eastPID.track(eastAcceleration, dt);
        const targetVerticalSpeed = phase === 'descend'
            ? -clamp(0.2 * Math.max(0, height), 0.3, config.descentSpeed)
            : clamp(0.6 * (config.hopHeight - height), -config.descentSpeed, config.climbSpeed);
        // Vertical-speed PI controller, expressed as acceleration above gravity.
        const verticalError = targetVerticalSpeed - vessel.verticalSpeed;
        const acceleration = clamp(1.4 * verticalError + verticalIntegral, -0.4 * gravity, 0.4 * gravity);
        const hover = config.hoverThrottle * vessel.mass / startMass * gravity / startGravity;
        const requestedThrottle = hover * (1 + acceleration / gravity) / Math.max(0.5, up.y);
        // Anti-windup and no learning while an unlit/clamped rocket is still on the ground.
        if (airborne && requestedThrottle > 0 && requestedThrottle < 1)
            verticalIntegral = clamp(verticalIntegral + 0.4 * verticalError * dt, -0.3 * gravity, 0.3 * gravity);

        // Attitude PD controller. Measured angular velocity supplies the D term,
        // avoiding numerical differentiation of angles and derivative kick.
        // Nose is local +Y. Cross(nose, target) = (target.z, 0, -target.x).
        // KSP inputs use the opposite sign to geometric angular velocity.
        const target = {
            x: gravity * up.x + northAcceleration * north.x + eastAcceleration * east.x,
            y: gravity * up.y + northAcceleration * north.y + eastAcceleration * east.y,
            z: gravity * up.z + northAcceleration * north.z + eastAcceleration * east.z,
        };
        const length = Math.hypot(target.x, target.y, target.z);
        const limit = config.maxAttitudeInput;
        vessel.control.pitch = clamp(-config.attitudeGain * target.z / length + config.dampingGain * omega.x, -limit, limit);
        vessel.control.yaw = clamp(config.attitudeGain * target.x / length + config.dampingGain * omega.z, -limit, limit);
        vessel.control.roll = clamp(config.dampingGain * omega.y, -limit, limit);
        vessel.control.throttle = clamp(requestedThrottle, 0, 1);
    },
};

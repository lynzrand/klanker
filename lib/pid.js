// PID controller with derivative on measurement, a filtered derivative,
// conditional integration and optional back-calculation for shared limits.
// Import as: import { PID } from 'klanker:pid'.

export class PID {
    constructor(kp = 0, ki = 0, kd = 0) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.reset();
    }

    reset() {
        this.integral = 0;
        this.derivative = 0;
        this.previous = null;
        this.output = 0;
    }

    /**
     * @param {number} target
     * @param {number} measurement
     * @param {number} dt seconds
     * @param {number} limit symmetric output limit
     * @param {number} [deadband]
     */
    update(target, measurement, dt, limit, deadband = 0) {
        const rawDerivative = this.previous === null ? 0 : (measurement - this.previous) / dt;
        this.previous = measurement;
        this.derivative += dt / (0.35 + dt) * (rawDerivative - this.derivative);
        const rawError = target - measurement;
        const error = Math.sign(rawError) * Math.max(0, Math.abs(rawError) - deadband);
        const base = this.kp * error - this.kd * this.derivative;
        const candidate = Math.max(-0.2, Math.min(0.2, this.integral + this.ki * error * dt));
        // Conditional integration: permit unwinding, not accumulation into saturation.
        if ((base + candidate <= limit || error < 0) && (base + candidate >= -limit || error > 0))
            this.integral = candidate;
        this.output = Math.max(-limit, Math.min(limit, base + this.integral));
        return this.output;
    }

    /** Back-calculation for a separately applied (e.g. vector-limited) output. */
    track(applied, dt) {
        this.integral = Math.max(-0.2, Math.min(0.2, this.integral + (applied - this.output) * Math.min(1, dt)));
    }
}

export const create = (kp, ki, kd) => new PID(kp, ki, kd);
export default { PID, create };

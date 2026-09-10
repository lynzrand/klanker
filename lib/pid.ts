// PID controller with derivative on measurement, a filtered derivative,
// conditional integration and optional back-calculation for shared limits.
// Import as: import { PID } from 'klanker:pid'.

export class PID {
    kp: number;
    ki: number;
    kd: number;
    integral = 0;
    derivative = 0;
    previous: number | null = null;
    output = 0;

    constructor(kp = 0, ki = 0, kd = 0) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.reset();
    }

    reset(): void {
        this.integral = 0;
        this.derivative = 0;
        this.previous = null;
        this.output = 0;
    }

    /**
     * @param target desired value
     * @param measurement current value
     * @param dt seconds
     * @param limit symmetric output limit
     * @param deadband error below which no action is taken
     */
    update(target: number, measurement: number, dt: number, limit: number, deadband = 0): number {
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
    track(applied: number, dt: number): void {
        this.integral = Math.max(-0.2, Math.min(0.2, this.integral + (applied - this.output) * Math.min(1, dt)));
    }
}

export const create = (kp: number, ki: number, kd: number): PID => new PID(kp, ki, kd);
export default { PID, create };

// Attitude helpers. The active control frame is x=right, y=nose, z=belly, and
// vessel.attitude.* are directions in that frame. Import as:
//   import { AttitudeHold } from 'klanker:attitude';
import type { Vec3 } from './vec';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const normalize = (a: Vec3): Vec3 => {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 1, z: 0 };
};

export interface AttitudeOptions {
    kp?: number;
    kd?: number;
    rollKd?: number;
    maxInput?: number;
}

export interface AttitudeContext {
    vessel: {
        attitude: { angularVelocity: Vec3; up: Vec3 };
        control: { pitch: number; yaw: number; roll: number };
    };
}

export class AttitudeHold {
    kp: number;
    kd: number;
    rollKd: number;
    maxInput: number;
    target: Vec3 | null;

    constructor({ kp = 1.5, kd = 2, rollKd = 2, maxInput = 0.25 }: AttitudeOptions = {}) {
        this.kp = kp;
        this.kd = kd;
        this.rollKd = rollKd;
        this.maxInput = maxInput;
        this.target = null;
    }

    reset(): void {
        this.target = null;
    }

    /** Point the nose at a direction expressed in the control frame. */
    aim({ vessel }: AttitudeContext, direction: Vec3): Vec3 {
        const d = normalize(direction);
        const omega = vessel.attitude.angularVelocity;
        vessel.control.pitch = clamp(-this.kp * d.z + this.kd * omega.x, -this.maxInput, this.maxInput);
        vessel.control.yaw = clamp(this.kp * d.x + this.kd * omega.z, -this.maxInput, this.maxInput);
        vessel.control.roll = clamp(this.rollKd * omega.y, -this.maxInput, this.maxInput);
        this.target = d;
        return d;
    }

    /**
     * Re-apply the last control-local direction, or straight ahead if none was
     * set. Recompute world-fixed targets each tick as the control frame rotates.
     */
    hold(context: AttitudeContext): Vec3 {
        return this.aim(context, this.target ?? { x: 0, y: 1, z: 0 });
    }

    /** Keep the nose radial-out (local up). */
    holdUp(context: AttitudeContext): Vec3 {
        return this.aim(context, context.vessel.attitude.up);
    }

    /** Damp rotation only, without a target. */
    killRotation({ vessel }: AttitudeContext): void {
        const omega = vessel.attitude.angularVelocity;
        vessel.control.pitch = clamp(-this.kd * omega.x, -this.maxInput, this.maxInput);
        vessel.control.yaw = clamp(-this.kd * omega.z, -this.maxInput, this.maxInput);
        vessel.control.roll = clamp(-this.rollKd * omega.y, -this.maxInput, this.maxInput);
    }
}

export default { AttitudeHold };

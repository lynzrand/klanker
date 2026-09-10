// Attitude helpers. The active control frame is x=right, y=nose, z=belly, and
// vessel.attitude.* are directions in that frame. Import as:
//   import { AttitudeHold } from 'klanker:attitude';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const normalize = a => {
    const l = Math.hypot(a.x, a.y, a.z);
    return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 1, z: 0 };
};

export class AttitudeHold {
    constructor({ kp = 1.5, kd = 2, rollKd = 2, maxInput = 0.25 } = {}) {
        this.kp = kp;
        this.kd = kd;
        this.rollKd = rollKd;
        this.maxInput = maxInput;
        this.target = null;
    }

    reset() {
        this.target = null;
    }

    /**
     * Point the nose at a direction expressed in the control frame.
     * @param {{ vessel: any }} context flightTick context
     * @param {{ x: number, y: number, z: number }} direction
     * @returns the normalized target direction
     */
    aim({ vessel }, direction) {
        const d = normalize(direction);
        const omega = vessel.attitude.angularVelocity;
        vessel.control.pitch = clamp(-this.kp * d.z + this.kd * omega.x, -this.maxInput, this.maxInput);
        vessel.control.yaw = clamp(this.kp * d.x + this.kd * omega.z, -this.maxInput, this.maxInput);
        vessel.control.roll = clamp(this.rollKd * omega.y, -this.maxInput, this.maxInput);
        this.target = d;
        return d;
    }

    /** Re-aim at the last target, or local up if no target was set. */
    hold(context) {
        return this.aim(context, this.target ?? { x: 0, y: 1, z: 0 });
    }

    /** Keep the nose radial-out (local up). */
    holdUp(context) {
        return this.aim(context, { x: 0, y: 1, z: 0 });
    }

    /** Damp rotation only, without a target. */
    killRotation({ vessel }) {
        const omega = vessel.attitude.angularVelocity;
        vessel.control.pitch = clamp(-this.kd * omega.x, -this.maxInput, this.maxInput);
        vessel.control.yaw = clamp(-this.kd * omega.z, -this.maxInput, this.maxInput);
        vessel.control.roll = clamp(-this.rollKd * omega.y, -this.maxInput, this.maxInput);
    }
}

export default { AttitudeHold };

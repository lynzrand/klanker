// Vector3 algebra over plain { x, y, z } objects.
// Import as: import vec from 'klanker:vec' or { dot, cross } from 'klanker:vec'.

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

const finite = (value: unknown): number => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Vector components must be finite numbers.');
    return number;
};
const isVector = (value: unknown): value is Partial<Vec3> => value !== null && typeof value === 'object';

/** Coerce components or a vector-like object into a fresh { x, y, z }. */
export function vec(x: number | Partial<Vec3> = 0, y = 0, z = 0): Vec3 {
    return isVector(x)
        ? { x: finite(x.x), y: finite(x.y), z: finite(x.z) }
        : { x: finite(x), y: finite(y), z: finite(z) };
}
export const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const negate = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const mul = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
export const lengthSquared = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(lengthSquared(a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
    const l = length(a);
    return l > 0 ? scale(a, 1 / l) : zero();
};
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
});
export const limit = (a: Vec3, maximum: number): Vec3 => {
    const l = length(a);
    return l > maximum && l > 0 ? scale(a, maximum / l) : { x: a.x, y: a.y, z: a.z };
};
export const project = (a: Vec3, b: Vec3): Vec3 => {
    const d = dot(b, b);
    return d === 0 ? zero() : scale(b, dot(a, b) / d);
};
export const reject = (a: Vec3, b: Vec3): Vec3 => sub(a, project(a, b));
export const angle = (a: Vec3, b: Vec3): number => {
    const d = length(a) * length(b);
    return d === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot(a, b) / d)));
};
/** Rotate `a` around `axis` by `radians` (Rodrigues' rotation formula). */
export const rotateAround = (a: Vec3, axis: Vec3, radians: number): Vec3 => {
    if (lengthSquared(axis) === 0) return { x: a.x, y: a.y, z: a.z };
    const k = normalize(axis);
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return add(add(scale(a, c), scale(cross(k, a), s)), scale(k, dot(k, a) * (1 - c)));
};
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export default {
    vec, zero, add, sub, scale, negate, mul, dot, cross, lengthSquared, length,
    distance, normalize, lerp, limit, project, reject, angle, rotateAround, clamp,
};

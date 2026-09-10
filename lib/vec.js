// Vector3 algebra over plain { x, y, z } objects.
// Import as: import vec from 'klanker:vec' or { dot, cross } from 'klanker:vec'.

const finite = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Vector components must be finite numbers.');
    return number;
};
const isVector = value => value !== null && typeof value === 'object';

/** Coerce components or a vector-like object into a fresh { x, y, z }. */
export function vec(x = 0, y = 0, z = 0) {
    return isVector(x)
        ? { x: finite(x.x), y: finite(x.y), z: finite(x.z) }
        : { x: finite(x), y: finite(y), z: finite(z) };
}
export const zero = () => ({ x: 0, y: 0, z: 0 });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const negate = a => ({ x: -a.x, y: -a.y, z: -a.z });
export const mul = (a, b) => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const lengthSquared = a => dot(a, a);
export const length = a => Math.sqrt(lengthSquared(a));
export const distance = (a, b) => length(sub(a, b));
export const normalize = a => {
    const l = length(a);
    return l > 0 ? scale(a, 1 / l) : zero();
};
export const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
});
export const limit = (a, maximum) => {
    const l = length(a);
    return l > maximum && l > 0 ? scale(a, maximum / l) : { x: a.x, y: a.y, z: a.z };
};
export const project = (a, b) => {
    const d = dot(b, b);
    return d === 0 ? zero() : scale(b, dot(a, b) / d);
};
export const reject = (a, b) => sub(a, project(a, b));
export const angle = (a, b) => {
    const d = length(a) * length(b);
    return d === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot(a, b) / d)));
};
/** Rotate `a` around `axis` by `radians` (Rodrigues' rotation formula). */
export const rotateAround = (a, axis, radians) => {
    const k = normalize(axis);
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return add(add(scale(a, c), scale(cross(k, a), s)), scale(k, dot(k, a) * (1 - c)));
};
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export default {
    vec, zero, add, sub, scale, negate, mul, dot, cross, lengthSquared, length,
    distance, normalize, lerp, limit, project, reject, angle, rotateAround, clamp,
};

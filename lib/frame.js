// Coordinate frames. Klanker telemetry vectors (velocity.orbital/surface,
// body) use KSP Unity world axes; writable controls and vessel.attitude.* use
// the active control frame (x=right, y=nose, z=belly). These helpers convert
// between them and build the usual orbital/surface directions.
// Import as: import frame from 'klanker:frame'.
import { add, scale, dot, cross, normalize } from './vec.js';

/** Orientation of the control frame as the world east/north/up axes. */
export const basis = ({ vessel }) => ({
    east: vessel.attitude.east,
    north: vessel.attitude.north,
    up: vessel.attitude.up,
});

/** Convert a world-axis vector (e.g. velocity.orbital) to control-frame axes. */
export function toLocal(context, world) {
    const { east, north, up } = basis(context);
    return add(add(scale(east, world.x), scale(north, world.y)), scale(up, world.z));
}

/** Convert a control-frame vector (e.g. attitude.up) to world axes. */
export function toWorld(context, local) {
    const { east, north, up } = basis(context);
    return { x: dot(local, east), y: dot(local, north), z: dot(local, up) };
}

export const localize = toLocal;
export const globalize = toWorld;

export function prograde(context) {
    return normalize(context.vessel.velocity.orbital);
}
export function retrograde(context) {
    return scale(prograde(context), -1);
}
export function surfacePrograde(context) {
    return normalize(context.vessel.velocity.surface);
}
export function surfaceRetrograde(context) {
    return scale(surfacePrograde(context), -1);
}
export function radialOut(context) {
    return toWorld(context, context.vessel.attitude.up);
}
export function radialIn(context) {
    return scale(radialOut(context), -1);
}
export function northUp(context) {
    return toWorld(context, context.vessel.attitude.north);
}
export function east(context) {
    return toWorld(context, context.vessel.attitude.east);
}
/** Orbit normal h = r x v, normalized. */
export function normal(context) {
    return normalize(cross(radialOut(context), prograde(context)));
}
export function antiNormal(context) {
    return scale(normal(context), -1);
}

export function orbitalBasis(context) {
    const p = prograde(context);
    const radial = radialOut(context);
    return { prograde: p, radialOut: radial, normal: normalize(cross(radial, p)) };
}

export function surfaceBasis(context) {
    return { prograde: surfacePrograde(context), north: northUp(context), up: radialOut(context) };
}

export default {
    basis, toLocal, toWorld, localize, globalize, prograde, retrograde,
    surfacePrograde, surfaceRetrograde, radialOut, radialIn, northUp, east,
    normal, antiNormal, orbitalBasis, surfaceBasis,
};

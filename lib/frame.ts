// Coordinate frames. Klanker telemetry vectors (velocity.orbital/surface,
// body) use KSP Unity world axes; writable controls and vessel.attitude.* use
// the active control frame (x=right, y=nose, z=belly). These helpers convert
// between them and build the usual orbital/surface directions.
// Import as: import frame from 'klanker:frame'.
import { add, cross, dot, normalize, scale, type Vec3 } from './vec';

export interface FrameContext {
    vessel: {
        attitude: { east: Vec3; north: Vec3; up: Vec3 };
        velocity: { orbital: Vec3; surface: Vec3 };
    };
}

export interface Basis {
    east: Vec3;
    north: Vec3;
    up: Vec3;
}

/** Orientation of the control frame as the world east/north/up axes. */
export const basis = ({ vessel }: FrameContext): Basis => ({
    east: vessel.attitude.east,
    north: vessel.attitude.north,
    up: vessel.attitude.up,
});

/** Convert a world-axis vector (e.g. velocity.orbital) to control-frame axes. */
export function toLocal(context: FrameContext, world: Vec3): Vec3 {
    const { east, north, up } = basis(context);
    return add(add(scale(east, world.x), scale(north, world.y)), scale(up, world.z));
}

/** Convert a control-frame vector (e.g. attitude.up) to world axes. */
export function toWorld(context: FrameContext, local: Vec3): Vec3 {
    const { east, north, up } = basis(context);
    return { x: dot(local, east), y: dot(local, north), z: dot(local, up) };
}

const radians = Math.PI / 180;

/**
 * A direction in control-frame axes from a pitch above the local horizon and a
 * compass azimuth. `pitch` 0 is straight up (radial out) and 90 is horizontal;
 * `azimuth` is measured from north toward east, so the default 90 is due east —
 * the usual launch heading for a prograde equatorial orbit. Feed the result
 * straight to AttitudeHold.aim. Up/north/east are already control-frame
 * directions, so no world conversion is needed.
 */
export function tilt(context: FrameContext, pitchDegrees: number, azimuthDegrees = 90): Vec3 {
    const { east, north, up } = basis(context);
    const pitch = pitchDegrees * radians;
    const azimuth = azimuthDegrees * radians;
    const horizontal = add(scale(north, Math.cos(azimuth)), scale(east, Math.sin(azimuth)));
    return normalize(add(scale(up, Math.cos(pitch)), scale(horizontal, Math.sin(pitch))));
}

export const localize = toLocal;
export const globalize = toWorld;

export function prograde(context: FrameContext): Vec3 {
    return normalize(context.vessel.velocity.orbital);
}
export function retrograde(context: FrameContext): Vec3 {
    return scale(prograde(context), -1);
}
export function surfacePrograde(context: FrameContext): Vec3 {
    return normalize(context.vessel.velocity.surface);
}
export function surfaceRetrograde(context: FrameContext): Vec3 {
    return scale(surfacePrograde(context), -1);
}
export function radialOut(context: FrameContext): Vec3 {
    return toWorld(context, context.vessel.attitude.up);
}
export function radialIn(context: FrameContext): Vec3 {
    return scale(radialOut(context), -1);
}
export function northUp(context: FrameContext): Vec3 {
    return toWorld(context, context.vessel.attitude.north);
}
export function east(context: FrameContext): Vec3 {
    return toWorld(context, context.vessel.attitude.east);
}
/** Orbit normal h = r x v, normalized. */
export function normal(context: FrameContext): Vec3 {
    return normalize(cross(radialOut(context), prograde(context)));
}
export function antiNormal(context: FrameContext): Vec3 {
    return scale(normal(context), -1);
}

export function orbitalBasis(context: FrameContext): { prograde: Vec3; radialOut: Vec3; normal: Vec3 } {
    const p = prograde(context);
    const radial = radialOut(context);
    return { prograde: p, radialOut: radial, normal: normalize(cross(radial, p)) };
}

export function surfaceBasis(context: FrameContext): { prograde: Vec3; north: Vec3; up: Vec3 } {
    return { prograde: surfacePrograde(context), north: northUp(context), up: radialOut(context) };
}

export default {
    basis, toLocal, toWorld, localize, globalize, prograde, retrograde,
    surfacePrograde, surfaceRetrograde, radialOut, radialIn, northUp, east,
    normal, antiNormal, orbitalBasis, surfaceBasis, tilt,
};

// Coordinate frames. Writable controls, vessel.attitude.*, and the local
// velocity fields use the active control frame (x=right, y=nose, z=belly).
// Raw velocity.orbital/surface vectors use KSP's Unity world axes. The host is
// the only reliable place to convert those raw vectors; these helpers build
// control-local directions and convert between local and east/north/up (ENU)
// components.
// Import as: import frame from 'klanker:frame'.
import { add, cross, dot, normalize, scale, type Vec3 } from './vec';

export interface FrameContext {
    vessel: {
        attitude: { east: Vec3; north: Vec3; up: Vec3 };
        velocity: { orbital: Vec3; surface: Vec3; localOrbital: Vec3; localSurface: Vec3 };
    };
}

export interface Basis {
    east: Vec3;
    north: Vec3;
    up: Vec3;
}

/** World east/north/up directions expressed in control-local axes. */
export const basis = ({ vessel }: FrameContext): Basis => ({
    east: vessel.attitude.east,
    north: vessel.attitude.north,
    up: vessel.attitude.up,
});

/** Convert east/north/up components to control-local axes. */
export function enuToLocal(context: FrameContext, enu: Vec3): Vec3 {
    const { east, north, up } = basis(context);
    return add(add(scale(east, enu.x), scale(north, enu.y)), scale(up, enu.z));
}

/** Convert a control-local vector to east/north/up components. */
export function localToEnu(context: FrameContext, local: Vec3): Vec3 {
    const { east, north, up } = basis(context);
    return { x: dot(local, east), y: dot(local, north), z: dot(local, up) };
}

/** @deprecated Use enuToLocal; this does not accept raw Unity-world vectors. */
export const toLocal = enuToLocal;
/** @deprecated Use localToEnu; this returns ENU components, not Unity-world axes. */
export const toWorld = localToEnu;

const radians = Math.PI / 180;

/**
 * A direction in control-frame axes tilted from radial-out toward the local
 * horizon at a compass azimuth. `pitch` 0 is straight up and 90 is horizontal;
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

/** @deprecated Use enuToLocal. */
export const localize = enuToLocal;
/** @deprecated Use localToEnu. */
export const globalize = localToEnu;

/** Orbital prograde expressed in control-local axes. */
export function prograde(context: FrameContext): Vec3 {
    return normalize(context.vessel.velocity.localOrbital);
}
export function retrograde(context: FrameContext): Vec3 {
    return scale(prograde(context), -1);
}
/** Surface prograde expressed in control-local axes. */
export function surfacePrograde(context: FrameContext): Vec3 {
    return normalize(context.vessel.velocity.localSurface);
}
export function surfaceRetrograde(context: FrameContext): Vec3 {
    return scale(surfacePrograde(context), -1);
}
export function radialOut(context: FrameContext): Vec3 {
    return normalize(context.vessel.attitude.up);
}
export function radialIn(context: FrameContext): Vec3 {
    return scale(radialOut(context), -1);
}
export function northUp(context: FrameContext): Vec3 {
    return normalize(context.vessel.attitude.north);
}
export function east(context: FrameContext): Vec3 {
    return normalize(context.vessel.attitude.east);
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
    basis, enuToLocal, localToEnu, toLocal, toWorld, localize, globalize, prograde, retrograde,
    surfacePrograde, surfaceRetrograde, radialOut, radialIn, northUp, east,
    normal, antiNormal, orbitalBasis, surfaceBasis, tilt,
};

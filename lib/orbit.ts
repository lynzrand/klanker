// Orbital mechanics helpers for guidance: the standard two-body formulas a
// launch or transfer autopilot needs, over plain numbers and { radius,
// gravitationalParameter } bodies. Import as: import orbit from 'klanker:orbit'.
//
// All distances are metres, speeds metres/second, masses kilograms, and thrust
// kilonewtons (matching vessel.mass and vessel.availableThrust). Angles are
// radians unless a function name says degrees.

export interface BodyLike {
    /** Sea-level reference radius, metres. */
    radius: number;
    /** Standard gravitational parameter, m^3/s^2. */
    gravitationalParameter: number;
}

/** Standard gravity, m/s^2, for specific-impulse conversions. */
export const standardGravity = 9.80665;

/** Local gravitational acceleration at a radius from the body centre. */
export const gravity = (mu: number, radius: number): number => mu / (radius * radius);

/** Speed of a circular orbit at a radius. */
export const circularSpeed = (mu: number, radius: number): number => Math.sqrt(mu / radius);

/** Escape speed at a radius. */
export const escapeSpeed = (mu: number, radius: number): number => Math.sqrt(2 * mu / radius);

/**
 * Speed at a radius on an orbit of the given semi-major axis (the vis-viva
 * equation). `radius` may be the apoapsis or periapsis radius. The argument
 * under the root can go slightly negative from round-off on a circular orbit,
 * so it is clamped at zero.
 */
export const visViva = (mu: number, radius: number, semiMajorAxis: number): number =>
    Math.sqrt(Math.max(0, mu * (2 / radius - 1 / semiMajorAxis)));

/** Speed at apoapsis on an orbit of the given semi-major axis. */
export const apoapsisSpeed = (mu: number, apoapsisRadius: number, semiMajorAxis: number): number =>
    visViva(mu, apoapsisRadius, semiMajorAxis);

/** Speed at periapsis on an orbit of the given semi-major axis. */
export const periapsisSpeed = (mu: number, periapsisRadius: number, semiMajorAxis: number): number =>
    visViva(mu, periapsisRadius, semiMajorAxis);

/** Orbital period, seconds. */
export const period = (mu: number, semiMajorAxis: number): number =>
    2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu);

/** Radius from a body's sea-level reference radius: body.radius + altitude. */
export const altitudeToRadius = (body: BodyLike, altitude: number): number => body.radius + altitude;

/** Altitude above a body's sea-level reference radius: radius - body.radius. */
export const radiusToAltitude = (body: BodyLike, radius: number): number => radius - body.radius;

/**
 * Speed change to circularise at a radius, from a radius on an orbit of the
 * given semi-major axis. Positive means the burn must add speed (the usual
 * case when circularising from an elliptical ascent).
 */
export const circularizationDeltaV = (mu: number, radius: number, semiMajorAxis: number): number =>
    circularSpeed(mu, radius) - visViva(mu, radius, semiMajorAxis);

/**
 * Approximate burn time for a delta-v, seconds, treating thrust as constant.
 * Conservative: because mass falls during the burn, the real burn is slightly
 * shorter, so a guidance loop that starts at half this time fires a little early.
 */
export const burnTime = (massKg: number, deltaV: number, thrustKN: number): number =>
    thrustKN > 0 ? massKg * deltaV / (thrustKN * 1000) : Number.POSITIVE_INFINITY;

/**
 * Burn time from the rocket equation, seconds, given a specific impulse. More
 * accurate than `burnTime` because it accounts for the mass lost during the
 * burn. Returns Infinity without usable thrust or impulse.
 */
export const rocketBurnTime = (massKg: number, deltaV: number, thrustKN: number, isp: number): number => {
    if (!(thrustKN > 0) || !(isp > 0) || !(massKg > 0)) return Number.POSITIVE_INFINITY;
    const exhaustVelocity = isp * standardGravity;
    const massFlow = thrustKN * 1000 / exhaustVelocity;
    const finalMass = massKg * Math.exp(-deltaV / exhaustVelocity);
    return (massKg - finalMass) / massFlow;
};

export default {
    standardGravity, gravity, circularSpeed, escapeSpeed, visViva, apoapsisSpeed,
    periapsisSpeed, period, altitudeToRadius, radiusToAltitude,
    circularizationDeltaV, burnTime, rocketBurnTime,
};

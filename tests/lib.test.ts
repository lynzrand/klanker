import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule } from '../cli/bundle.ts';

const load = async (name: string): Promise<any> =>
    import('data:text/javascript;base64,' + Buffer.from(await bundleModule(name)).toString('base64'));

const vec = await load('vec');
const { PID } = await load('pid');
const { AttitudeHold } = await load('attitude');
const frame = await load('frame');
const orbit = await load('orbit');

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;

test('vector algebra', () => {
    assert.equal(vec.dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 0);
    assert.deepEqual(vec.cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 });
    assert.ok(close(vec.length(vec.normalize({ x: 3, y: 4, z: 0 })), 1));
    const rotated = vec.rotateAround({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
    assert.ok(close(rotated.x, 0) && close(rotated.y, 1));
});

test('PID regulates, rejects windup, and tracks', () => {
    const pid = new PID(1, 1, 0);
    const output = pid.update(1, 0, 0.02, 1);
    assert.ok(output > 0 && output <= 1);
    const saturated = new PID(1, 1, 0);
    for (let i = 0; i < 1000; i++) assert.equal(saturated.update(10, 0, 0.02, 0.1), 0.1);
    assert.equal(saturated.integral, 0);
    saturated.track(0, 0.02);
    assert.ok(saturated.integral <= 0);
});

test('attitude hold aims and damps', () => {
    const hold = new AttitudeHold({ kp: 1, kd: 0, maxInput: 0.25 });
    const vessel = { attitude: { angularVelocity: { x: 0, y: 0, z: 0 } }, control: {} as Record<string, number> };
    hold.aim({ vessel }, { x: 1, y: 0, z: 0 });
    assert.equal(vessel.control.yaw, 0.25);
    assert.equal(vessel.control.pitch, 0);
    const damping = new AttitudeHold({ kp: 0, kd: 1, maxInput: 0.25 });
    const spinning = { attitude: { angularVelocity: { x: 0.5, y: 0, z: 0 } }, control: {} as Record<string, number> };
    damping.aim({ vessel: spinning }, { x: 0, y: 1, z: 0 });
    assert.equal(spinning.control.pitch, 0.25);
});

test('frames convert between world and control axes', () => {
    const identity = {
        vessel: {
            attitude: { east: { x: 1, y: 0, z: 0 }, north: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
            velocity: { orbital: { x: 0, y: 1, z: 0 }, surface: { x: 1, y: 0, z: 0 } },
        },
    };
    assert.deepEqual(frame.toLocal(identity, { x: 2, y: 3, z: 4 }), { x: 2, y: 3, z: 4 });
    assert.deepEqual(frame.toWorld(identity, { x: 5, y: 6, z: 7 }), { x: 5, y: 6, z: 7 });
    assert.deepEqual(frame.prograde(identity), { x: 0, y: 1, z: 0 });
    assert.deepEqual(frame.radialOut(identity), { x: 0, y: 0, z: 1 });
    // r x v = (0,0,1) x (0,1,0) = (-1,0,0)
    assert.deepEqual(frame.normal(identity), { x: -1, y: 0, z: 0 });

    const rotated = {
        vessel: {
            attitude: { east: { x: 0, y: 0, z: -1 }, north: { x: 0, y: 1, z: 0 }, up: { x: 1, y: 0, z: 0 } },
            velocity: { orbital: { x: 1, y: 0, z: 0 }, surface: { x: 0, y: 0, z: 1 } },
        },
    };
    const world = { x: 1, y: 2, z: 3 };
    const back = frame.toWorld(rotated, frame.toLocal(rotated, world));
    assert.ok(close(back.x, world.x) && close(back.y, world.y) && close(back.z, world.z));
});

test('frame tilt builds pitch and azimuth in control axes', () => {
    const upright = {
        vessel: {
            attitude: { east: { x: 1, y: 0, z: 0 }, north: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
            velocity: { orbital: { x: 0, y: 1, z: 0 }, surface: { x: 0, y: 1, z: 0 } },
        },
    };
    const up = frame.tilt(upright, 0);
    assert.ok(close(up.x, 0) && close(up.y, 1) && close(up.z, 0));
    const horizonEast = frame.tilt(upright, 90);
    assert.ok(close(horizonEast.x, 1) && close(horizonEast.y, 0) && close(horizonEast.z, 0));
    const fortyFive = frame.tilt(upright, 45);
    // x = east component, y = radial-out component, both sin/cos of 45 degrees.
    assert.ok(close(fortyFive.x, Math.SQRT1_2) && close(fortyFive.y, Math.SQRT1_2));
    const north = frame.tilt(upright, 90, 0);
    assert.ok(close(north.z, 1) && close(north.x, 0));
});

test('orbital mechanics helpers', () => {
    const mu = 3.5316e12; // Kerbin
    const radius = 600000 + 100000;
    const circular = orbit.circularSpeed(mu, radius);
    assert.ok(close(orbit.gravity(mu, radius), mu / (radius * radius)));
    assert.ok(close(orbit.escapeSpeed(mu, radius), circular * Math.SQRT2));
    // A circular orbit has semi-major axis equal to its radius, so vis-viva
    // reproduces the circular speed and the circularisation burn is zero.
    assert.ok(close(orbit.visViva(mu, radius, radius), circular));
    assert.ok(close(orbit.circularizationDeltaV(mu, radius, radius), 0));
    assert.ok(close(orbit.period(mu, radius), 2 * Math.PI * Math.sqrt(radius ** 3 / mu)));
    const body = { radius: 600000, gravitationalParameter: mu };
    assert.equal(orbit.altitudeToRadius(body, 100000), radius);
    assert.equal(orbit.radiusToAltitude(body, radius), 100000);
    // Rocket-equation burn time matches the linear estimate for a tiny burn and
    // is shorter for a large one, since mass falls as propellant is spent.
    assert.equal(orbit.rocketBurnTime(10000, 0, 200, 350), 0);
    assert.equal(orbit.burnTime(10000, 100, 0), Number.POSITIVE_INFINITY);
    assert.equal(orbit.rocketBurnTime(10000, 100, 200, 0), Number.POSITIVE_INFINITY);
    const smallLinear = orbit.burnTime(10000, 0.001, 200);
    const smallRocket = orbit.rocketBurnTime(10000, 0.001, 200, 350);
    assert.ok(Math.abs(smallRocket - smallLinear) < 1e-4 * smallLinear);
    const largeLinear = orbit.burnTime(10000, 1000, 200);
    const largeRocket = orbit.rocketBurnTime(10000, 1000, 200, 350);
    assert.ok(largeRocket > 0 && largeRocket < largeLinear);
});

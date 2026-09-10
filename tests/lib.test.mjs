import assert from 'node:assert/strict';
import test from 'node:test';
import { AttitudeHold } from '../lib/attitude.js';
import frame from '../lib/frame.js';
import { PID } from '../lib/pid.js';
import { cross, dot, length, normalize, rotateAround } from '../lib/vec.js';

const close = (a, b) => Math.abs(a - b) < 1e-12;

test('vector algebra', () => {
    assert.equal(dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 0);
    assert.deepEqual(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 });
    assert.ok(close(length(normalize({ x: 3, y: 4, z: 0 })), 1));
    const rotated = rotateAround({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
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
    const vessel = { attitude: { angularVelocity: { x: 0, y: 0, z: 0 } }, control: {} };
    hold.aim({ vessel }, { x: 1, y: 0, z: 0 });
    assert.equal(vessel.control.yaw, 0.25);
    assert.equal(vessel.control.pitch, 0);
    const damping = new AttitudeHold({ kp: 0, kd: 1, maxInput: 0.25 });
    const spinning = { attitude: { angularVelocity: { x: 0.5, y: 0, z: 0 } }, control: {} };
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

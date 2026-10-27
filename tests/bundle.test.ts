import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bundleWorker } from '../cli/bundle.ts';

test('bundles klanker: modules and relative imports into one ESM default export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-bundle-'));
    try {
        await writeFile(join(directory, 'worker.ts'), `
            import vec, { type Vec3 } from 'klanker:vec';
            import frame from 'klanker:frame';
            import { AttitudeHold } from 'klanker:attitude';
            const hold = new AttitudeHold();
            const limit: number = 1;
            export default class { flightTick(ctx: { vessel: any; deltaTime: number }): void {
                const target: Vec3 = frame.prograde(ctx);
                hold.aim(ctx, target);
                if (Math.abs(vec.length(target) - limit) > 1e-9) throw new Error('bad target length');
            } };
        `);
        const bundled = await bundleWorker(join(directory, 'worker.ts'));
        assert.match(bundled, /as default/);
        assert.doesNotMatch(bundled, /from\s*['"]klanker:/);

        // The bundle must be valid ESM with a runnable default export.
        const module = await import('data:text/javascript;base64,' + Buffer.from(bundled).toString('base64')) as any;
        const vessel = {
            attitude: {
                east: { x: 1, y: 0, z: 0 }, north: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 },
                angularVelocity: { x: 0, y: 0, z: 0 },
            },
            velocity: {
                orbital: { x: 0, y: 1, z: 0 }, surface: { x: 0, y: 1, z: 0 },
                localOrbital: { x: 0, y: 1, z: 0 }, localSurface: { x: 0, y: 1, z: 0 },
            },
            control: {} as Record<string, number>,
        };
        new module.default().flightTick({ vessel, deltaTime: 0.02 });
        assert.ok(Number.isFinite(vessel.control.yaw));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('bundles bare klanker and klanker/<name> specifiers too', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-bundle-'));
    try {
        await writeFile(join(directory, 'worker.ts'), `
            import { PID } from 'klanker/pid';
            import { vec } from 'klanker';
            export default class { flightTick(): void {
                const pid = new PID(1, 0, 0);
                pid.update(vec.length({ x: 1, y: 0, z: 0 }), 0, 0.02, 1);
            } };
        `);
        const bundled = await bundleWorker(join(directory, 'worker.ts'));
        assert.doesNotMatch(bundled, /from\s*['"]klanker/);
        const module = await import('data:text/javascript;base64,' + Buffer.from(bundled).toString('base64')) as any;
        new module.default().flightTick();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('an unknown klanker: module fails the bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-bundle-'));
    try {
        await writeFile(join(directory, 'bad.js'), "import x from 'klanker:nope'; export default x;");
        await assert.rejects(bundleWorker(join(directory, 'bad.js')), /Bundle failed/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

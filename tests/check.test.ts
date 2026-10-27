import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWorker } from '../cli/check.ts';

test('type-checks a typed worker against the host API and libraries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-check-'));
    try {
        const good = join(directory, 'good.ts');
        await writeFile(good, `
            import vec from 'klanker:vec';
            export default class Worker implements Klanker.Worker {
                flightTick({ vessel }: Klanker.FlightContext) {
                    vessel.control.throttle = vec.length(vessel.velocity.orbital) >= 0 ? 1 : 0;
                }
            };

        `);
        const goodResult = await checkWorker(good);
        assert.equal(goodResult.code, 0, goodResult.output);

        const bare = join(directory, 'bare.ts');
        await writeFile(bare, `
            import { PID, vec } from 'klanker';
            export default class Worker implements Klanker.Worker {
                flightTick({ vessel }: Klanker.FlightContext) {
                    vessel.control.throttle = vec.length(vessel.velocity.orbital) > 0 ? 1 : 0;
                    new PID(1, 0, 0);
                }
            };

        `);
        const bareResult = await checkWorker(bare);
        assert.equal(bareResult.code, 0, bareResult.output);

        const bad = join(directory, 'bad.ts');
        await writeFile(bad, `
            export default class Worker implements Klanker.Worker {
                flightTick({ vessel }: Klanker.FlightContext) {
                    vessel.control.throttle = 'full';
                }
            };

        `);
        const badResult = await checkWorker(bad);
        assert.notEqual(badResult.code, 0);
        assert.match(badResult.output, /not assignable to type 'number'/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

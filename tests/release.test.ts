import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotSource, packageRelease } from '../scripts/package.ts';

test('release source snapshot includes build inputs, not local configuration or caches', async () => {
    const snapshot = await snapshotSource();
    for (const path of ['src/Klanker/Klanker.csproj', 'GameData/Klanker/Workers/grasshopper.js',
        'scripts/package.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'docs/proposal.md', 'tsconfig.json',
        'lib/vec.ts', 'lib/frame.ts', 'lib/index.ts', 'lib/package.json',
        'cli/klanker.ts', 'cli/check.ts', 'cli/package.json'])
        assert.ok(snapshot.files[path], path);
    for (const path of Object.keys(snapshot.files))
        assert.ok(!/(^|\/)(\.git|\.jj|\.cache|\.nuget|node_modules|bin|obj|dist|klanker\.local\.json)(\/|$)/.test(path), path);
    assert.match(snapshot.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal((await snapshotSource()).fingerprint, snapshot.fingerprint);
    await assert.rejects(packageRelease({ ...snapshot, fingerprint: 'changed' }), /Source changed during build/);
});

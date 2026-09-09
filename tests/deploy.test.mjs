import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { configureLocal, deploy, deploymentPath } from '../scripts/deploy.mjs';

test('deploy validates the target, preserves workers, replaces binaries, and backs up outside GameData', async () => {
    const cache = resolve(import.meta.dirname, '..', '.cache');
    await mkdir(cache, { recursive: true });
    const fixture = await mkdtemp(join(cache, 'deploy-test-'));
    try {
        const game = join(fixture, 'KSP with spaces');
        const source = join(fixture, 'package');
        await mkdir(join(game, 'GameData', 'Squad'), { recursive: true });
        await mkdir(join(source, 'Plugins'), { recursive: true });
        await mkdir(join(source, 'Workers'), { recursive: true });
        await mkdir(join(source, 'Patches'), { recursive: true });
        await writeFile(join(source, 'Patches', 'command-computers.cfg'), 'new patch');
        await writeFile(join(source, 'Plugins', 'Klanker.dll'), 'new binary');
        await writeFile(join(source, 'Workers', 'observe.js'), 'shipped example');
        await writeFile(join(source, 'Workers', 'klanker.d.ts'), 'new API');
        await assert.rejects(deploy(undefined, source), /Locate your KSP/);
        await assert.rejects(deploy(game, source), /Not a recognized KSP/);
        await writeFile(join(game, 'KSP_x64.exe'), 'fixture marker');
        const configPath = join(fixture, 'klanker.local.json');
        await assert.rejects(deploymentPath([], configPath), /Set kspPath/);
        await configureLocal(['--ksp', game], configPath);
        assert.equal(await deploymentPath([], configPath), game);
        assert.equal(await deploymentPath(['--ksp', source], configPath), source);
        await assert.rejects(deploymentPath(['--ksp'], configPath), /requires/);
        await writeFile(configPath, JSON.stringify({ kspPath: 'KSP with spaces' }));
        assert.equal(await deploymentPath([], configPath), game);
        const first = await deploy(game, source);
        assert.equal(first.backup, null);
        await writeFile(join(first.destination, 'Workers', 'observe.js'), 'my edited worker');
        await writeFile(join(first.destination, 'Workers', 'klanker.d.ts'), 'old API');
        await writeFile(join(first.destination, 'Plugins', 'obsolete.dll'), 'old library');
        await writeFile(join(first.destination, 'Patches', 'command-computers.cfg'), 'old patch');
        await writeFile(join(first.destination, 'Patches', 'obsolete.cfg'), 'obsolete patch');
        const second = await deploy(game, source);
        assert.equal(await readFile(join(second.destination, 'Workers', 'observe.js'), 'utf8'), 'my edited worker');
        assert.equal(await readFile(join(second.destination, 'Workers', 'klanker.d.ts'), 'utf8'), 'new API');
        assert.equal(await readFile(join(second.backup, 'Workers', 'klanker.d.ts'), 'utf8'), 'old API');
        assert.deepEqual(await readdir(join(second.destination, 'Plugins')), ['Klanker.dll']);
        assert.deepEqual(await readdir(join(second.destination, 'Patches')), ['command-computers.cfg']);
        assert.equal(await readFile(join(second.destination, 'Patches', 'command-computers.cfg'), 'utf8'), 'new patch');
        assert.equal(await readFile(join(second.backup, 'Patches', 'command-computers.cfg'), 'utf8'), 'old patch');
        assert.equal(await readFile(join(second.backup, 'Plugins', 'obsolete.dll'), 'utf8'), 'old library');
        assert.equal(await readFile(join(second.backup, 'Workers', 'observe.js'), 'utf8'), 'my edited worker');
        assert.deepEqual((await readdir(join(game, 'GameData'))).sort(), ['Klanker', 'Squad']);
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

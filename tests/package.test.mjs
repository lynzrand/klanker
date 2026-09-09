import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const configuration = process.env.KLANKER_TEST_CONFIGURATION ?? 'Release';
const checker = join(root, 'tests', 'Klanker.PackageCheck', 'bin', configuration, 'net9.0', 'Klanker.PackageCheck.dll');
const plugins = join(root, 'build', 'GameData', 'Klanker', 'Plugins');
const ksp = join(root, '.cache', 'ksp', '1.12.5');

function check(path) {
    const result = spawnSync('dotnet', [checker, path, ksp], { encoding: 'utf8', timeout: 10_000 });
    if (result.error) throw result.error;
    return { code: result.status, output: result.stdout + result.stderr };
}

test('command-part patch is packaged with the ModuleCommand selector and duplicate guard', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(join(root, 'GameData', 'Klanker', 'Patches', 'command-computers.cfg'), 'utf8');
    const packaged = await readFile(join(root, 'build', 'GameData', 'Klanker', 'Patches', 'command-computers.cfg'), 'utf8');
    assert.equal(packaged, source);
    assert.match(source, /HAS\[@MODULE\[ModuleCommand\],!MODULE\[KlankerComputer\]\]/);
    assert.match(source, /name\s*=\s*KlankerComputer/);
});

test('package gate rejects missing framework DLLs, reference DLLs and exposed native DLLs', async () => {
    const fixture = await mkdtemp(join(root, '.cache', 'package-test-'));
    assert.equal(await realpath(fixture), resolve(fixture));
    try {
        // Native libraries are large; the metadata checker scans only managed files.
        await cp(plugins, fixture, { recursive: true, filter: path => !path.includes('PluginData') });
        assert.equal(check(fixture).code, 0);
        await rm(join(fixture, 'Microsoft.CSharp.dll'));
        const missing = check(fixture);
        assert.equal(missing.code, 1);
        assert.match(missing.output, /missing Microsoft.CSharp/);
        const reference = join(root, '.nuget', 'packages', 'microsoft.netframework.referenceassemblies.net472',
            '1.0.3', 'build', '.NETFramework', 'v4.7.2', 'Microsoft.CSharp.dll');
        await copyFile(reference, join(fixture, 'Microsoft.CSharp.dll'));
        const stub = check(fixture);
        assert.equal(stub.code, 1);
        assert.match(stub.output, /reference assembly shipped as runtime/);
        await copyFile(join(plugins, 'Microsoft.CSharp.dll'), join(fixture, 'Microsoft.CSharp.dll'));
        await copyFile(join(plugins, 'PluginData', 'ClearScriptV8.win-x64.dll'), join(fixture, 'ClearScriptV8.win-x64.dll'));
        const native = check(fixture);
        assert.equal(native.code, 1);
        assert.match(native.output, /Native library exposed/);
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

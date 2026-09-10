import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(command, args, timeout) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { cwd: root, shell: false, stdio: 'inherit', timeout });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`${command} failed (${signal ?? code}).`));
        });
    });
}

export async function smokeTest(configuration) {
    process.env.KLANKER_TEST_CONFIGURATION = configuration;
    await run(process.execPath, ['--test', 'tests/lib.test.mjs'], 20_000);
    await run(process.execPath, ['--test', 'tests/bundle.test.mjs'], 30_000);
    await run(process.execPath, ['--test', 'tests/check.test.mjs'], 90_000);
    await run(process.execPath, ['--test', 'tests/bridge-cli.test.mjs'], 15_000);
    await run(process.execPath, ['--test', 'tests/deploy.test.mjs'], 15_000);
    await run(process.execPath, ['--test', 'tests/grasshopper.test.mjs'], 15_000);
    await run(process.execPath, ['--test', 'tests/release.test.mjs'], 15_000);
    await run(process.execPath, ['--test', 'tests/package.test.mjs'], 30_000);
    const project = join(root, 'tests', 'Klanker.Smoke');
    const plugins = join(root, 'build', 'GameData', 'Klanker', 'Plugins');
    await run('dotnet', ['build', project, '-c', configuration], 120_000);
    await run('dotnet', [join(project, 'bin', configuration, 'net9.0', 'Klanker.Smoke.dll'), plugins], 15_000);
    if (process.platform === 'win32') {
        await run(join(project, 'bin', configuration, 'net472', 'Klanker.Smoke.exe'), [plugins], 15_000);
    }
}

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { bootstrap, kspRoot } from './bootstrap.mjs';

const configurationIndex = process.argv.indexOf('--configuration');
const configuration = configurationIndex === -1 ? 'Debug' : process.argv[configurationIndex + 1];

if (!configuration || !['Debug', 'Release'].includes(configuration)) {
    throw new Error('Use --configuration Debug or --configuration Release.');
}

await bootstrap();

const managedPath = join(kspRoot, 'KSP_Data', 'Managed');
const arguments_ = [
    'build',
    join(import.meta.dirname, '..', 'Klanker.sln'),
    '--configuration',
    configuration,
    `--property:KSPBT_GameRoot=${kspRoot}`,
    `--property:KSPBT_ManagedPath=${managedPath}`,
];

const exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn('dotnet', arguments_, { shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
        if (signal) {
            reject(new Error(`dotnet was terminated by ${signal}.`));
        } else {
            resolvePromise(code);
        }
    });
});

if (exitCode !== 0) {
    process.exitCode = exitCode;
}


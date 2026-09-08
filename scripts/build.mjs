import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
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
} else {
    await copyClearScriptNativeLibraries(configuration);
}

async function copyClearScriptNativeLibraries(buildConfiguration) {
    const projectDirectory = join(import.meta.dirname, '..', 'src', 'Klanker');
    const assets = JSON.parse(await readFile(join(projectDirectory, 'obj', 'project.assets.json'), 'utf8'));
    const packageRoot = Object.keys(assets.packageFolders)[0];
    const pluginDirectory = join(import.meta.dirname, '..', 'build', 'GameData', 'Klanker', 'Plugins');
    const runtimes = [
        ['Microsoft.ClearScript.V8.Native.win-x64', 'win-x64', 'ClearScriptV8.win-x64.dll'],
        ['Microsoft.ClearScript.V8.Native.linux-x64', 'linux-x64', 'ClearScriptV8.linux-x64.so'],
        ['Microsoft.ClearScript.V8.Native.osx-x64', 'osx-x64', 'ClearScriptV8.osx-x64.dylib'],
    ];

    await mkdir(pluginDirectory, { recursive: true });

    const findPackage = (packageName) => {
        const packageEntry = Object.entries(assets.libraries)
            .find(([name]) => name.toLowerCase().startsWith(`${packageName.toLowerCase()}/`));

        if (!packageEntry) {
            throw new Error(`${packageName} is missing from the ${buildConfiguration} restore graph.`);
        }

        return join(packageRoot, packageEntry[1].path);
    };

    for (const [packageName, runtime, fileName] of runtimes) {
        await copyFile(
            join(findPackage(packageName), 'runtimes', runtime, 'native', fileName),
            join(pluginDirectory, fileName),
        );
    }

    const clearScriptPackage = findPackage('Microsoft.ClearScript.V8');
    const licenseDirectory = join(import.meta.dirname, '..', 'build', 'GameData', 'Klanker', 'Licenses');
    const licenses = [
        ['licenses', 'ClearScript', 'License.txt'],
        ['licenses', 'V8', 'LICENSE'],
        ['licenses', 'V8', 'LICENSE.fdlibm'],
        ['licenses', 'V8', 'LICENSE.strongtalk'],
        ['licenses', 'V8', 'LICENSE.v8'],
    ];

    await mkdir(licenseDirectory, { recursive: true });
    for (const license of licenses) {
        await copyFile(join(clearScriptPackage, ...license), join(licenseDirectory, license.at(-1)));
    }
}

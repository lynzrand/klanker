import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { kspRoot } from './bootstrap.ts';
import { copyMonoRuntime } from './mono-runtime.ts';

export async function compile(configuration: string): Promise<void> {
    if (!configuration || !['Debug', 'Release'].includes(configuration)) {
        throw new Error('Use --configuration Debug or --configuration Release.');
    }

    // This is only the generated plugin subtree, never GameData source or a KSP
    // installation. Recreate it so removed dependencies cannot survive a build.
    const generated = join(import.meta.dirname, '..', 'build', 'GameData', 'Klanker');
    try {
        if (await realpath(generated) !== resolve(generated))
            throw new Error(`Refusing to clean a linked build directory: ${generated}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rm(generated, { recursive: true, force: true });

    const managedPath = join(kspRoot, 'KSP_Data', 'Managed');
    const arguments_ = [
        'build',
        join(import.meta.dirname, '..', 'Klanker.sln'),
        '--configuration',
        configuration,
        '--no-incremental',
        `--property:KSPBT_GameRoot=${kspRoot}`,
        `--property:KSPBT_ManagedPath=${managedPath}`,
    ];

    const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
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
        throw new Error(`dotnet build failed with exit code ${exitCode}.`);
    }
}

interface ProjectAssets {
    packageFolders: Record<string, string>;
    libraries: Record<string, { path: string }>;
}

export async function copyClearScriptNativeLibraries(buildConfiguration: string): Promise<void> {
    await cp(join(import.meta.dirname, '..', 'GameData'), join(import.meta.dirname, '..', 'build', 'GameData'), { recursive: true });
    const projectDirectory = join(import.meta.dirname, '..', 'src', 'Klanker');
    const assets = JSON.parse(await readFile(join(projectDirectory, 'obj', 'project.assets.json'), 'utf8')) as ProjectAssets;
    const packageRoots = Object.keys(assets.packageFolders);
    const pluginDirectory = join(import.meta.dirname, '..', 'build', 'GameData', 'Klanker', 'Plugins');
    const nativeDirectory = join(pluginDirectory, 'PluginData');
    const runtimes: [string, string, string][] = [
        ['Microsoft.ClearScript.V8.Native.win-x64', 'win-x64', 'ClearScriptV8.win-x64.dll'],
        ['Microsoft.ClearScript.V8.Native.linux-x64', 'linux-x64', 'ClearScriptV8.linux-x64.so'],
        ['Microsoft.ClearScript.V8.Native.osx-x64', 'osx-x64', 'ClearScriptV8.osx-x64.dylib'],
    ];

    await mkdir(pluginDirectory, { recursive: true });
    await mkdir(nativeDirectory, { recursive: true });
    // Remove the old native layout; KSP attempts to scan every visible .dll as IL.
    // Exact generated filenames only, never anything in the user's installation.
    for (const [, , fileName] of runtimes) await rm(join(pluginDirectory, fileName), { force: true });

    const findPackage = (packageName: string): string => {
        const packageEntry = Object.entries(assets.libraries)
            .find(([name]) => name.toLowerCase().startsWith(`${packageName.toLowerCase()}/`));

        if (!packageEntry) {
            throw new Error(`${packageName} is missing from the ${buildConfiguration} restore graph.`);
        }

        // NuGet can report more than one package folder; locate the one that
        // actually contains the restored package instead of assuming the first.
        for (const root of packageRoots) {
            const candidate = join(root, packageEntry[1].path);
            if (existsSync(candidate)) return candidate;
        }

        throw new Error(`${packageName} is not present in any configured restore folder.`);
    };

    for (const [packageName, runtime, fileName] of runtimes) {
        await copyFile(
            join(findPackage(packageName), 'runtimes', runtime, 'native', fileName),
            join(nativeDirectory, fileName),
        );
    }

    const clearScriptPackage = findPackage('Microsoft.ClearScript.V8');
    const licenseDirectory = join(import.meta.dirname, '..', 'build', 'GameData', 'Klanker', 'Licenses');
    const licenses: string[][] = [
        ['licenses', 'ClearScript', 'License.txt'],
        ['licenses', 'V8', 'LICENSE'],
        ['licenses', 'V8', 'LICENSE.fdlibm'],
        ['licenses', 'V8', 'LICENSE.strongtalk'],
        ['licenses', 'V8', 'LICENSE.v8'],
    ];

    await mkdir(licenseDirectory, { recursive: true });
    for (const license of licenses) {
        await copyFile(join(clearScriptPackage, ...license), join(licenseDirectory, license.at(-1)!));
    }
    await copyMonoRuntime(pluginDirectory, licenseDirectory);
    await checkPackage(buildConfiguration, pluginDirectory);
}

export async function checkPackage(configuration: string, pluginDirectory: string): Promise<void> {
    const project = join(import.meta.dirname, '..', 'tests', 'Klanker.PackageCheck');
    const args = ['run', '--project', project, '--configuration', configuration, '--', pluginDirectory, kspRoot];
    await new Promise<void>((resolvePromise, reject) => {
        const child = spawn('dotnet', args, { shell: false, stdio: 'inherit', timeout: 120_000 });
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Package validation failed (${signal ?? code}).`)));
    });
}

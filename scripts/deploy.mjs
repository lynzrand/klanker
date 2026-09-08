import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const localConfigPath = resolve(import.meta.dirname, '..', 'klanker.local.json');

async function exists(path) {
    try { await access(path); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function requireInside(parent, path) {
    const child = relative(parent, path);
    if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
        throw new Error(`Deployment path must be inside ${parent}: ${path}`);
    }
}

async function rejectLinks(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Deployment does not follow symlinks or junctions: ${path}`);
    if (info.isDirectory()) {
        for (const name of await readdir(path)) await rejectLinks(join(path, name));
    }
}

async function validateKsp(kspPath) {
    if (!kspPath) throw new Error('Locate your KSP installation: pnpm make configure --ksp "path/to/KSP"');
    const root = await realpath(resolve(kspPath));
    const gameData = join(root, 'GameData');
    const markers = ['KSP_x64.exe', 'KSP.x86_64', 'KSP.app/Contents/MacOS/KSP'];
    if (!(await exists(join(gameData, 'Squad'))) || !(await Promise.all(markers.map(file => exists(join(root, file))))).some(Boolean)) {
        throw new Error('Not a recognized KSP installation: expected GameData/Squad and a KSP executable.');
    }
    if ((await lstat(gameData)).isSymbolicLink()) throw new Error('GameData must not be a symlink or junction.');
    requireInside(root, await realpath(gameData));
    return root;
}

export async function deploy(kspPath, source = resolve(import.meta.dirname, '..', 'build', 'GameData', 'Klanker')) {
    const root = await validateKsp(kspPath);
    const gameData = join(root, 'GameData');
    if (!(await exists(join(source, 'Plugins', 'Klanker.dll')))) throw new Error('Build Klanker before deploying.');
    await rejectLinks(source);

    const destination = join(gameData, 'Klanker');
    const upgrading = await exists(destination);
    if (upgrading) await rejectLinks(destination);
    const backups = join(root, '.klanker-backups');
    if (await exists(backups)) {
        if ((await lstat(backups)).isSymbolicLink()) throw new Error('Backup directory must not be a symlink or junction.');
    }
    await mkdir(backups, { recursive: true });
    requireInside(root, await realpath(backups));

    // Stage and back up outside GameData so KSP cannot load duplicate assemblies.
    const staging = await mkdtemp(join(root, '.klanker-stage-'));
    const backup = join(backups, staging.split(sep).at(-1));
    requireInside(root, staging);
    requireInside(backups, backup);
    let movedOld = false;
    try {
        await cp(source, staging, { recursive: true });
        if (upgrading) {
            // Replace binaries and upstream notices completely; retain local workers
            // and other user data, including files added by future runtime versions.
            for (const name of await readdir(destination)) {
                if (name !== 'Plugins' && name !== 'Licenses') {
                    await cp(join(destination, name), join(staging, name), { recursive: true });
                }
            }
            await rename(destination, backup);
            movedOld = true;
        }
        try {
            await rename(staging, destination);
        } catch (error) {
            if (movedOld) await rename(backup, destination);
            throw error;
        }
        console.log(`Deployed Klanker to ${destination}`);
        if (movedOld) console.log(`Previous installation saved at ${backup}`);
        return { destination, backup: movedOld ? backup : null };
    } finally {
        // Only this invocation's freshly created, validated staging directory.
        await rm(staging, { recursive: true, force: true });
    }
}

function pathArgument(args) {
    const index = args.indexOf('--ksp');
    if (index === -1) return undefined;
    const path = args[index + 1];
    if (!path || path.startsWith('--')) throw new Error('--ksp requires the KSP installation directory.');
    return path;
}

async function readConfig(path) {
    if (!(await exists(path))) return {};
    const config = JSON.parse(await readFile(path, 'utf8'));
    if (config === null || typeof config !== 'object' || Array.isArray(config))
        throw new Error(`${path} must contain a JSON object.`);
    return config;
}

export async function deploymentPath(args = process.argv.slice(2), configPath = localConfigPath) {
    const override = pathArgument(args);
    if (override) return resolve(override);
    const config = await readConfig(configPath);
    if (typeof config.kspPath !== 'string' || !config.kspPath.trim())
        throw new Error('Set kspPath in klanker.local.json or run: pnpm make configure --ksp "path/to/KSP"');
    return resolve(dirname(configPath), config.kspPath);
}

export async function configureLocal(args = process.argv.slice(2), configPath = localConfigPath) {
    const root = await validateKsp(pathArgument(args));
    const config = await readConfig(configPath);
    config.kspPath = root;
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`Saved KSP path in ${configPath}: ${root}`);
}

export async function deployFromArguments() {
    return deploy(await deploymentPath());
}

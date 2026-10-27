import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { zipSync, unzipSync, type Zippable } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const epoch = new Date('2000-01-01T00:00:00Z');
function git(args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.toString());
    return result.stdout.toString();
}
function archive(files: Record<string, Uint8Array>): Uint8Array {
    return zipSync(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
        .map(([path, data]) => [path, [data, { mtime: epoch }]])) as Zippable, { level: 6 });
}
async function collect(directory: string, prefix: string, files: Record<string, Uint8Array>): Promise<void> {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked package input: ' + directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Linked package input: ' + entry.name);
        const target = prefix + '/' + entry.name;
        if (entry.isDirectory()) await collect(join(directory, entry.name), target, files);
        else files[target] = await readFile(join(directory, entry.name));
    }
}

export interface SourceSnapshot {
    files: Record<string, Buffer>;
    fingerprint: string;
    commit: string;
    dirty: boolean;
}

// Snapshot actual build inputs, including uncommitted work, never ignored local files.
// Explicit roots avoid accidentally including unrelated untracked files in releases.
export async function snapshotSource(): Promise<SourceSnapshot> {
    const candidates = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
    const files: Record<string, Buffer> = {};
    for (const path of [...new Set(candidates)].sort()) {
        if (!/^(GameData|src|scripts|tests|docs|cli|lib|workers)\//.test(path) &&
            !['README.md', 'LICENSE', '.gitignore', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
                'Herebyfile.ts', 'herebyfile.ts', 'tsconfig.json', 'tsconfig.build.json', 'Klanker.sln', 'global.json',
                'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config', 'nuget.config',
                'klanker.local.example.json'].includes(path)) continue;
        if (/(^|\/)(\.env(?:\..*)?|klanker\.local\.json|bin|obj|dist|node_modules|\.cache|\.nuget)(\/|$)/i.test(path))
            throw new Error('Private/generated path in source inputs: ' + path);
        let info;
        try { info = await lstat(join(root, path)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Non-regular source input: ' + path);
        files[path] = await readFile(join(root, path));
    }
    const fingerprint = hash(Buffer.from(JSON.stringify(Object.entries(files).map(([path, data]) => [path, hash(data)]))));
    return { files, fingerprint, commit: git(['rev-parse', 'HEAD']).trim(),
        dirty: git(['status', '--porcelain', '--untracked-files=normal']).trim().length > 0 };
}

interface NugetAssets {
    targets: Record<string, Record<string, { runtime?: Record<string, unknown> }>>;
    libraries: Record<string, { type?: string; sha512?: string; path?: string }>;
    packageFolders: Record<string, string>;
}

async function notices(files: Record<string, Uint8Array>): Promise<Record<string, unknown>> {
    const assets = JSON.parse(await readFile(join(root, 'src/Klanker/obj/project.assets.json'), 'utf8')) as NugetAssets;
    const provenance: Record<string, unknown> = {};
    for (const [id, target] of Object.entries(Object.values(assets.targets)[0])) {
        if (!target.runtime && !id.includes('ClearScript.V8.Native')) continue;
        const library = assets.libraries[id];
        if (!library || library.type !== 'package') continue;
        provenance[id] = library.sha512;
        let directory: string | undefined;
        for (const folder of Object.keys(assets.packageFolders)) {
            const candidate = join(folder, library.path ?? '');
            try { if ((await lstat(candidate)).isDirectory()) { directory = candidate; break; } }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const prefix = 'GameData/Klanker/Licenses/NuGet/' + id.replace('/', '-');
        if (directory) {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                if (!/license|notice|copyright|\.nuspec$/i.test(entry.name)) continue;
                if (entry.isSymbolicLink()) throw new Error('Linked license input.');
                if (entry.isDirectory()) await collect(join(directory, entry.name), prefix + '/' + entry.name, files);
                else files[prefix + '/' + entry.name] = await readFile(join(directory, entry.name));
            }
        } else {
            const [name, version] = id.toLowerCase().split('/');
            const response = await fetch(`https://api.nuget.org/v3-flatcontainer/${name}/${version}/${name}.${version}.nupkg`);
            if (!response.ok) throw new Error(`Notice download for ${id}: HTTP ${response.status}`);
            const data = Buffer.from(await response.arrayBuffer());
            const contents = unzipSync(data);
            for (const path of Object.keys(target.runtime ?? {})) {
                if (!path.endsWith('.dll')) continue;
                const shipped = files['GameData/Klanker/Plugins/' + path.split('/').at(-1)!];
                if (!shipped || !contents[path] || hash(shipped) !== hash(contents[path]))
                    throw new Error('Notice archive runtime differs from shipped DLL: ' + id);
            }
            provenance[id] = { restore: library.sha512, noticesArchive: createHash('sha512').update(data).digest('base64') };
            for (const [path, content] of Object.entries(contents)) {
                if (path.endsWith('/') || !/license|notice|copyright|\.nuspec$/i.test(path)) continue;
                if (path.split('/').includes('..') || path.startsWith('/') || path.includes('\\'))
                    throw new Error('Unsafe notice archive path.');
                files[prefix + '/' + path] = content;
            }
        }
    }
    return provenance;
}

export async function packageRelease(before: SourceSnapshot | undefined): Promise<string> {
    const after = await snapshotSource();
    if (!before || before.fingerprint !== after.fingerprint || before.commit !== after.commit)
        throw new Error('Source changed during build/tests. Run pnpm make package again.');
    const version = before.files['src/Klanker/Klanker.csproj'].toString().match(/<Version>([^<]+)<\/Version>/)?.[1];
    if (!version || !/^[0-9A-Za-z.-]+$/.test(version)) throw new Error('Invalid project version.');
    const name = `Klanker-${version}-${before.commit.slice(0, 8)}-${before.fingerprint.slice(0, 8)}`;
    const files: Record<string, Uint8Array> = {};
    await collect(join(root, 'build/GameData/Klanker'), 'GameData/Klanker', files);
    for (const [path, data] of Object.entries(before.files))
        if (path.startsWith('docs/') || path === 'README.md' || path === 'LICENSE') files[path] = data;
    files['Klanker-source.zip'] = archive(before.files);
    const nugetPackages = await notices(files);
    files['START-HERE.txt'] = Buffer.from(`Klanker ${version} - tester build

Use KSP 1.12.5 with ModuleManager 4.2.3 and MechJeb 2.14.3
(CKAN version 2.14.3.0), deliberately not a newer MechJeb.
Those mods and KSP itself are NOT included.

Close KSP. Copy this ZIP's GameData/Klanker into your KSP GameData.
On upgrade, first move the old Klanker folder OUTSIDE GameData.
Restore your edited Workers/*.js as needed, but use the new klanker.d.ts.
Keep Plugins/PluginData intact. No Node, pnpm, SDK, or separate V8 install
is needed to play.

Right-click a command pod/probe core, choose Klanker worker..., assign
observe.js, and enable Run when active. In flight, F8 toggles the UI.
Read docs/workers.md for scripting and docs/grasshopper.md BEFORE trying
the hopper; it requires craft-specific setup and SAS off.

Windows x64 has in-game testing. Linux/macOS x64 libraries are included
but in-game testing on those platforms remains outstanding.
Use trusted scripts and backed-up test saves.

Complete source for these build inputs: Klanker-source.zip (MPL 2.0).
Base commit: ${before.commit}
Working-tree changes included: ${before.dirty}
Source fingerprint: ${before.fingerprint}
Third-party notices: GameData/Klanker/Licenses.
See manifest.json for file hashes and dependency provenance.
`);
    files['manifest.json'] = Buffer.from(JSON.stringify({
        version, configuration: 'Release', baseCommit: before.commit, dirty: before.dirty,
        sourceFingerprint: before.fingerprint, ksp: '1.12.5',
        requiredMods: { ModuleManager: '4.2.3', MechJeb2: '2.14.3.0' },
        nativeIncluded: ['win-x64', 'linux-x64', 'osx-x64'], nugetPackages,
        files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, hash(data)])),
    }, null, 2) + '\n');
    const zip = archive(files), restored = unzipSync(zip);
    for (const [path, data] of Object.entries(files))
        if (!restored[path] || hash(data) !== hash(restored[path])) throw new Error('ZIP verification failed: ' + path);
    const output = join(root, 'build/releases');
    await mkdir(output, { recursive: true });
    const path = join(output, name + '.zip');
    // Repeat packaging of unchanged inputs is allowed only when the result is identical.
    for (const [target, data] of [[path, zip], [path + '.sha256', Buffer.from(hash(zip) + '  ' + name + '.zip\n')]] as [string, Uint8Array][]) {
        try { await writeFile(target, data, { flag: 'wx' }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || hash(await readFile(target)) !== hash(data)) throw error;
        }
    }
    console.log(`Package: ${path}\nBytes: ${zip.length}\nSHA256: ${hash(zip)}`);
    return path;
}

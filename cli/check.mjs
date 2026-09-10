import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const hostTypes = join(root, 'GameData', 'Klanker', 'Workers', 'klanker.d.ts');

const paths = Object.fromEntries(
    ['vec', 'pid', 'attitude', 'frame', 'mechjeb'].map(name => [`klanker:${name}`, [`lib/${name}.ts`]]),
);

/** Type-check a worker entry against the host API and the Klanker libraries. */
export async function checkWorker(entry) {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-check-'));
    try {
        const configPath = join(directory, 'tsconfig.json');
        await writeFile(configPath, JSON.stringify({
            compilerOptions: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'Bundler',
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                types: [],
                baseUrl: root,
                paths,
            },
            files: [resolve(entry), hostTypes],
        }, null, 2));
        const result = spawnSync(process.execPath, [tsc, '-p', configPath], { encoding: 'utf8', timeout: 120_000 });
        if (result.error) throw result.error;
        return { code: result.status ?? 1, output: (result.stdout ?? '') + (result.stderr ?? '') };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

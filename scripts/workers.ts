import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from '../cli/bundle.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'workers', 'samples');
const declaration = join(root, 'lib', 'klanker.d.ts');

/**
 * Bundle every workers/samples/*.ts into a self-contained module and copy the
 * host API declaration beside it. This is what the game's in-game
 * Assign / reload window reads, which does not bundle sources itself.
 */
export async function buildWorkers(destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    await copyFile(declaration, join(destination, 'klanker.d.ts'));
    let bundled = 0;
    for (const entry of await readdir(samples, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const name = entry.name.slice(0, -'.ts'.length);
        await writeFile(join(destination, `${name}.js`), await bundleWorker(join(samples, entry.name)));
        bundled++;
    }
    console.log(`Bundled ${bundled} worker samples into ${destination}`);
}

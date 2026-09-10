import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds the publishable CLI package: compiled JavaScript under cli/dist plus the
// shipped host API declaration that `klanker check` type-checks workers against.
// The `klanker` standard library in lib/ stays TypeScript and is bundled on demand.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const dist = join(root, 'cli', 'dist');
await rm(dist, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`tsc failed with exit code ${result.status}.`);

await mkdir(join(dist, 'api'), { recursive: true });
await copyFile(join(root, 'GameData', 'Klanker', 'Workers', 'klanker.d.ts'), join(dist, 'api', 'klanker.d.ts'));
console.log('Built cli/dist: klanker bin and host API types.');

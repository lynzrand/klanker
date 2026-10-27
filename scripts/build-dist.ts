import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds the publishable CLI package: compiled JavaScript under cli/dist. The
// `klanker` standard library in lib/ stays TypeScript and ships the host API
// declaration, so the CLI resolves both from that package at runtime.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const dist = join(root, 'cli', 'dist');
await rm(dist, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`tsc failed with exit code ${result.status}.`);

console.log('Built cli/dist: the klanker bin and its support modules.');

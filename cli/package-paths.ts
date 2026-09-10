import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Package root of this CLI: cli/ in the repository, or the installed package. */
export function packageRoot(): string {
    let directory = moduleDirectory;
    for (;;) {
        if (existsSync(join(directory, 'package.json'))) return directory;
        const parent = dirname(directory);
        if (parent === directory) throw new Error('Could not locate the klanker-cli package root.');
        directory = parent;
    }
}

/** Directory of the `klanker` standard library package that ships the worker libraries. */
export function stdlibRoot(): string {
    try {
        return dirname(require.resolve('klanker/package.json'));
    } catch {
        // Fallback for running from a checkout before `pnpm install` links workspaces.
        return resolve(packageRoot(), '..', 'lib');
    }
}

/** Bundled worker libraries, resolved from the standard library package. */
export const libRoot = stdlibRoot();

/**
 * The host API declaration used to type-check workers. It lives in GameData
 * while developing and is copied into dist/api when the CLI is built.
 */
export function hostTypes(): string {
    const root = packageRoot();
    const candidates = [
        join(root, 'dist', 'api', 'klanker.d.ts'),
        join(root, '..', 'GameData', 'Klanker', 'Workers', 'klanker.d.ts'),
    ];
    for (const candidate of candidates) if (existsSync(candidate)) return candidate;
    return candidates[0];
}

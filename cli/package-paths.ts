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
 * The host API declaration used to type-check workers. It ships with the
 * `klanker` standard library package, next to the modules it describes.
 */
export function hostTypes(): string {
    const declaration = join(libRoot, 'klanker.d.ts');
    if (!existsSync(declaration)) throw new Error(`The klanker host API declaration is missing: ${declaration}`);
    return declaration;
}

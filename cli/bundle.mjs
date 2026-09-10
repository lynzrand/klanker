import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const libRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib');

// Resolve `klanker:<name>` imports to lib/<name>.js at bundle time, so the
// runtime still receives one self-contained module saved into the part.
const klankerModules = {
    name: 'klanker-modules',
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^klanker:/ }, args => {
            const name = args.path.slice('klanker:'.length);
            if (!/^[a-z][a-z0-9-]*$/.test(name))
                return { errors: [{ text: `Invalid Klanker module name: ${args.path}` }] };
            return { path: resolve(libRoot, `${name}.js`) };
        });
    },
};

/** Bundle a worker entry (and its local/npm/klanker: imports) into one ESM string. */
export async function bundleWorker(entryPath) {
    let result;
    try {
        result = await build({
            entryPoints: [entryPath],
            bundle: true,
            write: false,
            format: 'esm',
            platform: 'neutral',
            target: 'es2020',
            plugins: [klankerModules],
            logLevel: 'silent',
        });
    } catch (error) {
        const detail = error.errors
            ?.map(issue => `${issue.location?.file ?? entryPath}:${issue.location?.line ?? '?'} ${issue.text}`)
            .join('\n') ?? error.message;
        throw new Error(`Bundle failed:\n${detail}`);
    }
    return result.outputFiles[0].text;
}

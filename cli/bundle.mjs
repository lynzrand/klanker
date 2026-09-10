import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const libRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib');

// Resolve `klanker:<name>` imports to lib/<name>.ts (or .js) at bundle time, so
// the runtime still receives one self-contained module saved into the part.
const klankerModules = {
    name: 'klanker-modules',
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^klanker:/ }, args => {
            const name = args.path.slice('klanker:'.length);
            if (!/^[a-z][a-z0-9-]*$/.test(name))
                return { errors: [{ text: `Invalid Klanker module name: ${args.path}` }] };
            for (const extension of ['.ts', '.js']) {
                const path = resolve(libRoot, `${name}${extension}`);
                if (existsSync(path)) return { path };
            }
            return { errors: [{ text: `Unknown Klanker module: ${args.path}` }] };
        });
    },
};

async function bundle(entryPath) {
    try {
        const result = await build({
            entryPoints: [entryPath],
            bundle: true,
            write: false,
            format: 'esm',
            platform: 'neutral',
            target: 'es2020',
            plugins: [klankerModules],
            logLevel: 'silent',
        });
        return result.outputFiles[0].text;
    } catch (error) {
        const detail = error.errors
            ?.map(issue => `${issue.location?.file ?? entryPath}:${issue.location?.line ?? '?'} ${issue.text}`)
            .join('\n') ?? error.message;
        throw new Error(`Bundle failed:\n${detail}`);
    }
}

/** Bundle a worker entry (TypeScript or JavaScript, plus its imports) into one ESM string. */
export const bundleWorker = entryPath => bundle(resolve(entryPath));

/** Bundle a built-in library by short name, e.g. bundleModule('vec'). */
export const bundleModule = name => bundle(resolve(libRoot, `${name}.ts`));

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, transform, type OnResolveArgs, type OnResolveResult, type Plugin } from 'esbuild';
import { libRoot } from './package-paths.ts';

export { libRoot } from './package-paths.ts';

const moduleName = /^[a-z][a-z0-9-]*$/;

/** Resolve a built-in library short name to its source file, or undefined. */
function libraryEntry(name: string): string | undefined {
    for (const extension of ['.ts', '.js']) {
        const path = resolve(libRoot, `${name}${extension}`);
        if (existsSync(path)) return path;
    }
    return undefined;
}

// Resolve `klanker:<name>` and bare `klanker`/`klanker/<name>` imports to the
// built-in libraries at bundle time, so the runtime still receives one
// self-contained module saved into the part.
const klankerModules: Plugin = {
    name: 'klanker-modules',
    setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^klanker(?::|\/|$)/ }, (args: OnResolveArgs): OnResolveResult => {
            const specifier = args.path;
            const name = specifier === 'klanker' || specifier === 'klanker:'
                ? 'index'
                : specifier.startsWith('klanker:') || specifier.startsWith('klanker/')
                    ? specifier.slice('klanker'.length + 1)
                    : undefined;
            if (name === undefined || !moduleName.test(name))
                return { errors: [{ text: `Invalid Klanker module name: ${specifier}` }] };
            const path = libraryEntry(name);
            if (path) return { path };
            return { errors: [{ text: `Unknown Klanker module: ${specifier}` }] };
        });
    },
};

async function bundle(entryPath: string): Promise<string> {
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
        const output = result.outputFiles?.[0];
        if (!output) throw new Error('esbuild produced no output.');
        return output.text;
    } catch (error) {
        const issues = (error as { errors?: { location?: { file?: string; line?: number }; text: string }[] }).errors;
        const detail = issues
            ?.map(issue => `${issue.location?.file ?? entryPath}:${issue.location?.line ?? '?'} ${issue.text}`)
            .join('\n') ?? (error instanceof Error ? error.message : String(error));
        throw new Error(`Bundle failed:\n${detail}`);
    }
}

/** Bundle a worker entry (TypeScript or JavaScript, plus its imports) into one ESM string. */
export const bundleWorker = (entryPath: string): Promise<string> => bundle(resolve(entryPath));

/**
 * Strip types from a single self-contained module without bundling or renaming
 * anything. Useful for tools that need to read a worker's top-level names.
 */
export async function transpileWorker(source: string, loader: 'ts' | 'js' = 'ts'): Promise<string> {
    const result = await transform(source, { loader, format: 'esm', target: 'es2020' });
    return result.code;
}

/** Bundle a built-in library by short name, e.g. bundleModule('vec'). */
export function bundleModule(name: string): Promise<string> {
    if (!moduleName.test(name)) throw new Error(`Invalid Klanker module name: ${name}`);
    const path = libraryEntry(name);
    if (!path) throw new Error(`Unknown Klanker module: ${name}`);
    return bundle(path);
}

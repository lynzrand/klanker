import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hostTypes, libRoot } from './package-paths.ts';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const libraryModules = ['vec', 'pid', 'attitude', 'frame', 'orbit', 'mechjeb'];

export interface CheckResult {
    code: number;
    output: string;
}

/** Type-check a worker entry against the host API and the Klanker libraries. */
export async function checkWorker(entry: string): Promise<CheckResult> {
    for (const name of libraryModules) {
        if (!existsSync(join(libRoot, `${name}.ts`)))
            throw new Error(`Klanker library is missing: ${name}.ts`);
    }

    const paths: Record<string, string[]> = {
        'klanker': ['index.ts'],
        'klanker/*': ['*.ts'],
        'klanker:*': ['*.ts'],
    };

    const temporary = await mkdtemp(join(tmpdir(), 'klanker-check-'));
    try {
        const configPath = join(temporary, 'tsconfig.json');
        await writeFile(configPath, JSON.stringify({
            compilerOptions: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'Bundler',
                strict: true,
                noEmit: true,
                allowJs: true,
                skipLibCheck: true,
                types: [],
                baseUrl: libRoot,
                paths,
            },
            files: [resolve(entry), hostTypes()],
        }, null, 2));
        const result = spawnSync(process.execPath, [tsc, '-p', configPath], { encoding: 'utf8', timeout: 120_000 });
        if (result.error) throw result.error;
        return { code: result.status ?? 1, output: (result.stdout ?? '') + (result.stderr ?? '') };
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

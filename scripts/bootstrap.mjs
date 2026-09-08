import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync } from 'fflate';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(repositoryRoot, '.cache');
export const kspRoot = join(cacheRoot, 'ksp', '1.12.5');

const archives = [
    {
        name: 'stripped KSP 1.12.5 definitions',
        fileName: 'ksp-1.12.5-5e23ea299dbd7d4219a7b27af2e805b5242de4c2.zip',
        sha256: 'e3de286fd4bf2993e23cc996a8fe3426aa575ea0a296376b43dd2fe289826ad8',
        destination: kspRoot,
        requiredFiles: [
            'KSP_Data/Managed/Assembly-CSharp.dll',
            'KSP_Data/Managed/Assembly-CSharp-firstpass.dll',
            'KSP_Data/Managed/mscorlib.dll',
            'KSP_Data/Managed/UnityEngine.dll',
            'KSP_Data/Managed/UnityEngine.CoreModule.dll',
        ],
        sources: async () => [
            'https://github.com/krpc/ksp-lib/raw/5e23ea299dbd7d4219a7b27af2e805b5242de4c2/ksp/ksp-1.12.5.zip',
        ],
    },
    {
        name: 'MechJeb 2.14.3.0',
        fileName: 'MechJeb2-2.14.3.0.zip',
        sha256: '56e9bedde34aaf7db82f1a875c8b7f61763d81fbac5d3a100cee238606752bd0',
        destination: join(kspRoot, 'GameData'),
        requiredFiles: ['MechJeb2/Plugins/MechJeb2.dll'],
        sources: mechJebSources,
    },
];

async function mechJebSources() {
    const item = 'MechJeb2-2.14.3.0';
    const file = '65D2DF5E-MechJeb2-2.14.3.0.zip';
    const sources = [
        'https://ksp.sarbian.com/jenkins/job/MechJeb2-Release/42/artifact/MechJeb2-2.14.3.0.zip',
        `https://archive.org/download/${item}/${file}`,
    ];

    try {
        const response = await fetch(`https://archive.org/metadata/${item}`);
        if (response.ok) {
            const metadata = await response.json();
            const servers = [metadata.d1, metadata.d2, ...(metadata.workable_servers ?? [])];
            for (const server of servers) {
                if (server) {
                    sources.push(`https://${server}${metadata.dir}/${file}`);
                }
            }
        }
    } catch (error) {
        console.warn(`Could not resolve Internet Archive storage nodes: ${error.message}`);
    }

    return [...new Set(sources)];
}

function hasRequiredFiles(archive) {
    return archive.requiredFiles.every((file) => existsSync(join(archive.destination, file)));
}

function digest(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

async function download(archive, archivePath) {
    const failures = [];

    for (const source of await archive.sources()) {
        try {
            console.log(`Downloading ${archive.name} from ${source}`);
            const response = await fetch(source, { redirect: 'follow' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const actualSha256 = digest(buffer);
            if (actualSha256 !== archive.sha256) {
                throw new Error(`SHA-256 mismatch: expected ${archive.sha256}, got ${actualSha256}`);
            }

            await writeFile(archivePath, buffer);
            return buffer;
        } catch (error) {
            failures.push(`${source}: ${error.message}`);
        }
    }

    throw new Error(`Unable to download ${archive.name}:\n${failures.join('\n')}`);
}

async function readOrDownload(archive) {
    const archivePath = join(cacheRoot, 'downloads', archive.fileName);
    await mkdir(dirname(archivePath), { recursive: true });

    if (existsSync(archivePath)) {
        const buffer = await readFile(archivePath);
        const actualSha256 = digest(buffer);
        if (actualSha256 !== archive.sha256) {
            throw new Error(
                `${archive.name} cache checksum mismatch: expected ${archive.sha256}, got ${actualSha256}. ` +
                `Delete ${archivePath} and retry.`,
            );
        }
        return buffer;
    }

    return download(archive, archivePath);
}

async function extract(buffer, destination) {
    const destinationRoot = resolve(destination);
    const entries = unzipSync(buffer);

    for (const [entryName, content] of Object.entries(entries)) {
        const normalizedName = normalize(entryName.replaceAll('\\', '/'));
        const outputPath = resolve(destinationRoot, normalizedName);
        const pathFromDestination = relative(destinationRoot, outputPath);

        if (isAbsolute(pathFromDestination) || pathFromDestination === '..' || pathFromDestination.startsWith(`..${sep}`)) {
            throw new Error(`Unsafe ZIP entry: ${entryName}`);
        }

        if (entryName.endsWith('/')) {
            await mkdir(outputPath, { recursive: true });
        } else {
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, content);
        }
    }
}

export async function bootstrap() {
    for (const archive of archives) {
        if (hasRequiredFiles(archive)) {
            continue;
        }

        const buffer = await readOrDownload(archive);
        console.log(`Extracting ${archive.name} to ${archive.destination}`);
        await extract(buffer, archive.destination);

        if (!hasRequiredFiles(archive)) {
            throw new Error(`${archive.name} did not contain all required files.`);
        }
    }

    return kspRoot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await bootstrap();
    console.log(kspRoot);
}


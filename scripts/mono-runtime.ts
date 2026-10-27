import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import xz from 'xz-decompress';

const cache = resolve(import.meta.dirname, '..', '.cache', 'mono-runtime');
const unityUrl = 'https://unity.bepinex.dev/corlibs/2019.4.18.zip';
const monoPackages: [string, string, string, string][] = [
    ['microsoft-csharp4.0', 'Microsoft.CSharp', '4.0.0.0__b03f5f7f11d50a3a', 'dda91c0445082a41e0e116c61b23d585030a301dedbbec3892edd30b19a9006d'],
    ['system-componentmodel-composition4.0', 'System.ComponentModel.Composition', '4.0.0.0__b77a5c561934e089', 'f489fc0cac7eaad1ce05504b482f2dccf0b1eefe1104b1a6cfd4eda28a15843a'],
    ['system-servicemodel-internals0.0', 'System.ServiceModel.Internals', '0.0.0.0__b77a5c561934e089', '0e8d48bee2848c3365dff3e2b118b2bcf679ae3d91f6df9a7c5f449d1895d33d'],
    ['system-transactions4.0', 'System.Transactions', '4.0.0.0__b77a5c561934e089', '474f0830d0449068e7920c876f04d7d77967f7f44428899743461bd1084f0b8b'],
    ['system-enterpriseservices4.0', 'System.EnterpriseServices', '4.0.0.0__b03f5f7f11d50a3a', '93b6e44372333b2bf30a4fd274450b8f9921003ce8b3d332eb131bad57edb645'],
];

async function pinnedDownload(url: string, sha256: string, fileName: string): Promise<Buffer> {
    await mkdir(cache, { recursive: true });
    const path = join(cache, fileName);
    let buffer: Buffer;
    try { buffer = await readFile(path); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        console.log(`Downloading runtime support: ${url}`);
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
    }
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== sha256) throw new Error(`${fileName}: expected SHA-256 ${sha256}, got ${actual}`);
    await writeFile(path, buffer);
    return buffer;
}

// Read only explicitly selected regular files, never extract archive paths to disk.
export async function debFiles(buffer: Buffer): Promise<Map<string, Uint8Array>> {
    if (buffer.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Invalid Debian archive');
    let compressed: Buffer | undefined;
    for (let offset = 8; offset + 60 <= buffer.length;) {
        const name = buffer.subarray(offset, offset + 16).toString().trim();
        const size = Number(buffer.subarray(offset + 48, offset + 58).toString().trim());
        if (!Number.isSafeInteger(size) || size < 0 || offset + 60 + size > buffer.length)
            throw new Error('Invalid Debian member size');
        if (name === 'data.tar.xz') compressed = buffer.subarray(offset + 60, offset + 60 + size);
        offset += 60 + size + size % 2;
    }
    if (!compressed) throw new Error('Debian package has no data.tar.xz');
    const stream = new xz.XzReadableStream(new Blob([new Uint8Array(compressed)]).stream());
    const tar = Buffer.from(await new Response(stream).arrayBuffer());
    const files = new Map<string, Uint8Array>();
    let longName: string | undefined;
    for (let offset = 0; offset + 512 <= tar.length;) {
        const name = tar.subarray(offset, offset + 100).toString().split('\0')[0]!;
        if (!name) break;
        const size = parseInt(tar.subarray(offset + 124, offset + 136).toString(), 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
            throw new Error('Invalid tar member size');
        const type = tar[offset + 156];
        const content = tar.subarray(offset + 512, offset + 512 + size);
        if (type === 76) longName = content.toString().split('\0')[0]; // GNU LongLink
        else {
            if (type === 0 || type === 48) files.set(longName ?? name, content);
            longName = undefined;
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}

export async function copyMonoRuntime(pluginDirectory: string, licenseDirectory: string): Promise<void> {
    const unity = unzipSync(await pinnedDownload(unityUrl,
        '39ec690c3934b9de2d6814db0673ff1ecbb81aa746eb17c37c2ea6efab16e0b8', 'unity-2019.4.18.zip'));
    // Actual executable UnityMono libraries, NOT the compile-only reference pack.
    // Never replace KSP's mscorlib, System, System.Core or Unity assemblies.
    for (const name of ['System.Numerics.dll', 'System.Xml.Linq.dll', 'System.Runtime.Serialization.dll', 'System.Data.dll']) {
        if (!unity[name]) throw new Error(`UnityMono archive is missing ${name}`);
        await writeFile(join(pluginDirectory, name), unity[name]);
    }
    await mkdir(licenseDirectory, { recursive: true });
    for (const [id, assembly, identity, hash] of monoPackages) {
        const packageName = `libmono-${id}-cil`;
        const fileName = `${packageName}_6.8.0.105+dfsg-3.3+deb12u1_all.deb`;
        const url = `https://deb.debian.org/debian/pool/main/m/mono/${fileName}`;
        const mono = await debFiles(await pinnedDownload(url, hash, fileName));
        const dll = mono.get(`./usr/lib/mono/gac/${assembly}/${identity}/${assembly}.dll`);
        const copyright = mono.get(`./usr/share/doc/${packageName}/copyright`);
        if (!dll || !copyright) throw new Error(`${packageName} is missing runtime DLL or copyright notice`);
        await writeFile(join(pluginDirectory, `${assembly}.dll`), dll);
        await writeFile(join(licenseDirectory, `${assembly}-copyright.txt`), copyright);
    }
    const notices: [string, string][] = [
        ['LICENSE', '3b40a54878b5ac2767a764bd082f8772ab27c03b9da9c7328c4c4935725556f7'],
        ['PATENTS.TXT', '4d764e3d098f8aad23f70f29e34165c7836b7e1cc49ced2a73b175edb89e4891'],
    ];
    for (const [name, hash] of notices) {
        const url = `https://raw.githubusercontent.com/Unity-Technologies/mono/d9ad36f4a70e55923604172a47f2223f4f6df5b6/${name}`;
        await writeFile(join(licenseDirectory, `UnityMono-${name}.txt`),
            await pinnedDownload(url, hash, `UnityMono-${name}.txt`));
    }
}

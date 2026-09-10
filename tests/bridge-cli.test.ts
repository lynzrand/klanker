import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BridgeClient, readEndpoint } from '../cli/klanker.ts';

// Minimal server that speaks the same JSONL protocol as BridgeServer.
function mockBridge(token: string): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    return new Promise(resolve => {
        const server = createServer((socket: Socket) => {
            socket.setEncoding('utf8');
            let buffer = '';
            socket.on('data', (chunk) => {
                buffer += chunk.toString();
                let index;
                while ((index = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, index);
                    buffer = buffer.slice(index + 1);
                    if (!line.trim()) continue;
                    const request = JSON.parse(line) as { id: number; token: string; method: string };
                    if (request.token !== token) {
                        socket.write(JSON.stringify({ id: request.id, ok: false, error: 'Unauthorized.' }) + '\n');
                        continue;
                    }
                    const result = request.method === 'ping'
                        ? { pong: true }
                        : { actors: [{ alias: 'guidance', workerId: 'abc', status: 'Running.' }] };
                    socket.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
                }
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
    });
}

test('bridge client resolves a discovery file and speaks the protocol', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'klanker-cli-'));
    const { server, port } = await mockBridge('tok');
    try {
        const path = join(directory, 'bridge.json');
        await writeFile(path, JSON.stringify({ version: 1, port, token: 'tok', pid: 1 }));
        const endpoint = readEndpoint(path);
        assert.equal(endpoint.port, port);
        const client = new BridgeClient(endpoint);
        await client.connect();
        assert.deepEqual(await client.request('ping', {}), { pong: true });
        assert.equal(((await client.request('list', {})) as { actors: { alias: string }[] }).actors[0].alias, 'guidance');
        client.close();
    } finally {
        await new Promise(resolve => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
    }
});

test('a missing discovery file is reported clearly', () => {
    assert.throws(() => readEndpoint(join(tmpdir(), 'klanker-missing-bridge.json')), /No running bridge/);
});

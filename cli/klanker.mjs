#!/usr/bin/env node
// Klanker CLI: talks to the in-game bridge over a loopback JSONL socket.
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { bundleWorker } from './bundle.mjs';

export function discoveryCandidates() {
    const home = homedir();
    const candidates = [];
    if (process.platform === 'win32') {
        if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'klanker', 'bridge.json'));
    } else {
        const config = process.env.XDG_CONFIG_HOME || join(home, '.config');
        candidates.push(join(config, 'klanker', 'bridge.json'));
        // .NET may map ApplicationData here on macOS.
        candidates.push(join(home, 'Library', 'Application Support', 'klanker', 'bridge.json'));
    }
    candidates.push(join(home, '.config', 'klanker', 'bridge.json'));
    return [...new Set(candidates)];
}

export function readEndpoint(explicit) {
    const paths = explicit ? [explicit] : discoveryCandidates();
    for (const path of paths) {
        if (!existsSync(path)) continue;
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || !Number.isInteger(parsed.port) || typeof parsed.token !== 'string')
            throw new Error(`Invalid bridge endpoint: ${path}`);
        return { port: parsed.port, token: parsed.token, path };
    }
    throw new Error('No running bridge found. Start KSP with Klanker, or pass --endpoint <bridge.json>.');
}

export class BridgeClient {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.nextId = 1;
        this.pending = new Map();
        this.handlers = new Set();
        this.buffer = '';
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = connect(this.endpoint.port, '127.0.0.1');
            this.socket.setEncoding('utf8');
            this.socket.once('connect', resolve);
            this.socket.once('error', reject);
            this.socket.on('data', chunk => this.receive(chunk));
            this.socket.on('close', () => {
                for (const { reject: rejectPending } of this.pending.values())
                    rejectPending(new Error('Bridge connection closed.'));
                this.pending.clear();
            });
        });
    }

    receive(chunk) {
        this.buffer += chunk;
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (message.event) {
                for (const handler of this.handlers) handler(message);
                continue;
            }
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            this.pending.delete(message.id);
            if (message.ok) pending.resolve(message.result);
            else pending.reject(new Error(message.error));
        }
    }

    request(method, params) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.write(JSON.stringify({ id, token: this.endpoint.token, method, params }) + '\n');
        });
    }

    onEvent(handler) { this.handlers.add(handler); }

    close() { this.socket?.end(); }
}

function parse(argv) {
    const flags = {};
    const positionals = [];
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--endpoint') flags.endpoint = argv[++index];
        else if (argument === '--id') flags.id = argv[++index];
        else if (argument === '--to' || argument === '--alias') flags.to = argv[++index];
        else if (argument === '--run') flags.run = true;
        else if (argument === '-f' || argument === '--follow') flags.follow = true;
        else if (argument === '-h' || argument === '--help') flags.help = true;
        else positionals.push(argument);
    }
    return { flags, positionals };
}

function target(flags, positional) {
    if (flags.id) return { id: flags.id };
    if (flags.to) return { alias: flags.to };
    if (positional) return /^[0-9a-f]{32}$/i.test(positional) ? { id: positional } : { alias: positional };
    throw new Error('Specify a target with --to <alias> or --id <workerId>.');
}

function describe(actor) {
    const name = actor.alias ? `${actor.alias} (${actor.workerId})` : actor.workerId || '(unidentified)';
    return `${name}  ${actor.status}  file=${actor.file || 'none'}  ticks=${actor.successfulTicks}  vessel=${actor.vessel}`;
}

function usage() {
    console.log(`Usage: klanker [--endpoint <bridge.json>] <command>

  ping                         Check the bridge.
  ls                           List onboard actors.
  build <file>                 Bundle a worker and print it (no game needed).
  deploy <file> --to <alias>   Bundle and deploy a .js file (--id <workerId> works too).
              [--run]          Start it after deploying.
  restart <alias|workerId>     Restart an actor.
  stop <alias|workerId>        Stop an actor.
  alias <alias|workerId> <name> Set an actor alias (empty name clears it).
  state <alias|workerId>       Print the actor's saved storage JSON.
  state-reset <alias|workerId> Clear the actor's saved storage.
  logs [-f] [--to <alias>]     Stream worker logs (Ctrl-C to stop).`);
}

function streamLogs(flags) {
    return new Promise((resolve, reject) => {
        let client;
        try {
            client = new BridgeClient(readEndpoint(flags.endpoint));
        } catch (error) {
            reject(error);
            return;
        }
        const filter = flags.to || flags.id;
        client.onEvent(message => {
            if (message.event !== 'log') return;
            const data = message.data || {};
            if (filter && data.workerId !== filter && data.file !== filter) return;
            console.log(`[${data.file}] ${data.message}`);
        });
        client.connect().then(() => {
            if (!flags.follow) setTimeout(() => { client.close(); resolve(); }, 200);
        }, reject);
        process.on('SIGINT', () => { client.close(); resolve(); });
    });
}

export async function main(argv = process.argv.slice(2)) {
    const { flags, positionals } = parse(argv);
    const command = positionals.shift();
    if (!command || flags.help) { usage(); return; }
    if (command === 'logs') return streamLogs(flags);
    if (command === 'build') {
        const file = positionals.shift();
        if (!file) throw new Error('build needs a .js file.');
        process.stdout.write(await bundleWorker(file));
        return;
    }

    const client = new BridgeClient(readEndpoint(flags.endpoint));
    await client.connect();
    try {
        switch (command) {
            case 'ping':
                console.log(JSON.stringify(await client.request('ping', {})));
                break;
            case 'ls':
                for (const actor of (await client.request('list', {})).actors) console.log(describe(actor));
                break;
            case 'deploy': {
                const file = positionals.shift();
                if (!file) throw new Error('deploy needs a .js file.');
                const result = await client.request('deploy', {
                    target: target(flags),
                    file: basename(file),
                    source: await bundleWorker(file),
                    run: flags.run === true,
                });
                console.log(describe(result));
                break;
            }
            case 'restart':
                console.log(describe(await client.request('restart', { target: target(flags, positionals.shift()) })));
                break;
            case 'stop':
                console.log(describe(await client.request('stop', { target: target(flags, positionals.shift()) })));
                break;
            case 'alias': {
                const name = positionals.shift() ?? '';
                console.log(describe(await client.request('alias', { target: target(flags, positionals.shift()), alias: name })));
                break;
            }
            case 'state': {
                const state = await client.request('state.get', { target: target(flags, positionals.shift()) });
                console.log(state.storage);
                if (state.error) console.error(state.error);
                break;
            }
            case 'state-reset':
                console.log(describe(await client.request('state.reset', { target: target(flags, positionals.shift()) })));
                break;
            default:
                throw new Error('Unknown command: ' + command);
        }
    } finally {
        client.close();
    }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

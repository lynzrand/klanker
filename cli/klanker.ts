#!/usr/bin/env node
// Klanker CLI: talks to the in-game bridge over a loopback JSONL socket.
import { existsSync, readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleWorker } from './bundle.ts';
import { checkWorker } from './check.ts';

export interface BridgeEndpoint {
    port: number;
    token: string;
    path: string;
}

export interface BridgeEvent {
    event: string;
    data?: { workerId?: string; file?: string; message?: string };
}

export interface Actor {
    alias?: string;
    workerId?: string;
    status?: string;
    file?: string;
    successfulTicks?: number;
    vessel?: string;
}

interface BridgeMessage extends Partial<BridgeEvent> {
    id?: number;
    ok?: boolean;
    result?: unknown;
    error?: string;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

export function discoveryCandidates(): string[] {
    const home = homedir();
    const candidates: string[] = [];
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

export function readEndpoint(explicit?: string): BridgeEndpoint {
    const paths = explicit ? [explicit] : discoveryCandidates();
    for (const path of paths) {
        if (!existsSync(path)) continue;
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { port?: unknown; token?: unknown };
        if (!parsed || !Number.isInteger(parsed.port) || typeof parsed.token !== 'string')
            throw new Error(`Invalid bridge endpoint: ${path}`);
        return { port: parsed.port as number, token: parsed.token, path };
    }
    throw new Error('No running bridge found. Start KSP with Klanker, or pass --endpoint <bridge.json>.');
}

export class BridgeClient {
    endpoint: BridgeEndpoint;
    nextId = 1;
    pending = new Map<number, PendingRequest>();
    handlers = new Set<(message: BridgeEvent) => void>();
    buffer = '';
    socket?: Socket;

    constructor(endpoint: BridgeEndpoint) {
        this.endpoint = endpoint;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = connect(this.endpoint.port, '127.0.0.1');
            this.socket.setEncoding('utf8');
            this.socket.once('connect', () => resolve());
            this.socket.once('error', reject);
            this.socket.on('data', chunk => this.receive(chunk.toString()));
            this.socket.on('close', () => {
                for (const { reject: rejectPending } of this.pending.values())
                    rejectPending(new Error('Bridge connection closed.'));
                this.pending.clear();
            });
        });
    }

    receive(chunk: string): void {
        this.buffer += chunk;
        let index: number;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            if (!line.trim()) continue;
            const message = JSON.parse(line) as BridgeMessage;
            if (message.event) {
                for (const handler of this.handlers) handler(message as BridgeEvent);
                continue;
            }
            const pending = this.pending.get(message.id ?? -1);
            if (!pending) continue;
            this.pending.delete(message.id ?? -1);
            if (message.ok) pending.resolve(message.result);
            else pending.reject(new Error(message.error));
        }
    }

    request(method: string, params: unknown): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket?.write(JSON.stringify({ id, token: this.endpoint.token, method, params }) + '\n');
        });
    }

    onEvent(handler: (message: BridgeEvent) => void): void { this.handlers.add(handler); }

    close(): void { this.socket?.end(); }
}

interface Flags {
    endpoint?: string;
    id?: string;
    to?: string;
    run?: boolean;
    follow?: boolean;
    help?: boolean;
}

function parse(argv: string[]): { flags: Flags; positionals: string[] } {
    const flags: Flags = {};
    const positionals: string[] = [];
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

type Target = { id: string } | { alias: string } | { active: true };

// `fallbackActive` lets deploy omit the selector and target the active part.
function target(flags: Flags, positional?: string, fallbackActive = false): Target {
    if (flags.id) return { id: flags.id };
    if (flags.to) return { alias: flags.to };
    if (positional) return /^[0-9a-f]{32}$/i.test(positional) ? { id: positional } : { alias: positional };
    if (fallbackActive) return { active: true };
    throw new Error('Specify a target with --to <alias> or --id <workerId>.');
}

function describe(actor: Actor): string {
    const name = actor.alias ? `${actor.alias} (${actor.workerId})` : actor.workerId || '(unidentified)';
    return `${name}  ${actor.status}  file=${actor.file || 'none'}  ticks=${actor.successfulTicks}  vessel=${actor.vessel}`;
}

function usage(): void {
    console.log(`Usage: klanker [--endpoint <bridge.json>] <command>

  ping                         Check the bridge.
  ls                           List onboard actors.
  build <file>                 Bundle a worker (.ts or .js) and print it (no game needed).
  check <file>                 Type-check a worker against the host API and libraries.
  deploy <file>                Bundle and deploy to the active part (--to <alias>
              [--to <alias>]   or --id <workerId> selects another actor).
              [--run]          Start it after deploying.
  restart <alias|workerId>     Restart an actor.
  stop <alias|workerId>        Stop an actor.
  alias <alias|workerId> <name> Set an actor alias (empty name clears it).
  state <alias|workerId>       Print the actor's saved storage JSON.
  state-reset <alias|workerId> Clear the actor's saved storage.
  logs [-f] [--to <alias>]     Stream worker logs (Ctrl-C to stop).`);
}

function streamLogs(flags: Flags): Promise<void> {
    return new Promise((resolve, reject) => {
        let client: BridgeClient;
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

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    const { flags, positionals } = parse(argv);
    const command = positionals.shift();
    if (!command || flags.help) { usage(); return; }
    if (command === 'logs') return streamLogs(flags);
    if (command === 'build') {
        const file = positionals.shift();
        if (!file) throw new Error('build needs a .ts or .js file.');
        process.stdout.write(await bundleWorker(file));
        return;
    }
    if (command === 'check') {
        const file = positionals.shift();
        if (!file) throw new Error('check needs a .ts or .js file.');
        const result = await checkWorker(file);
        if (result.output) process.stdout.write(result.output);
        process.exitCode = result.code;
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
                for (const actor of ((await client.request('list', {})) as { actors: Actor[] }).actors) console.log(describe(actor));
                break;
            case 'deploy': {
                const file = positionals.shift();
                if (!file) throw new Error('deploy needs a .ts or .js file.');
                const result = await client.request('deploy', {
                    target: target(flags, undefined, true),
                    file: basename(file).replace(/\.[^.]+$/, '') + '.js',
                    source: await bundleWorker(file),
                    run: flags.run === true,
                }) as Actor;
                console.log(describe(result));
                break;
            }
            case 'restart':
                console.log(describe(await client.request('restart', { target: target(flags, positionals.shift()) }) as Actor));
                break;
            case 'stop':
                console.log(describe(await client.request('stop', { target: target(flags, positionals.shift()) }) as Actor));
                break;
            case 'alias': {
                const selected = target(flags, positionals.shift());
                const name = positionals.shift() ?? '';
                console.log(describe(await client.request('alias', { target: selected, alias: name }) as Actor));
                break;
            }
            case 'state': {
                const state = await client.request('state.get', { target: target(flags, positionals.shift()) }) as { storage: string; error?: string };
                console.log(state.storage);
                if (state.error) console.error(state.error);
                break;
            }
            case 'state-reset':
                console.log(describe(await client.request('state.reset', { target: target(flags, positionals.shift()) }) as Actor));
                break;
            default:
                throw new Error('Unknown command: ' + command);
        }
    } finally {
        client.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

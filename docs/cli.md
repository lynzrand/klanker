# Klanker CLI

The CLI deploys and controls workers on a running game through a loopback-only
bridge. It is the intended authoring path: worker sources live in
[`workers/`](../workers), and `GameData/Klanker/Workers` is generated at build
time for the in-game window, not a runtime requirement. The in-game window
remains the fallback and is still how you set aliases without the CLI.

## Setup

The bridge starts automatically with the scene. It listens on `127.0.0.1` with an
ephemeral port and a random per-session token, written to
`<ApplicationData>/klanker/bridge.json` (`~/.config/klanker/bridge.json` on
Linux, `%APPDATA%\klanker\bridge.json` on Windows). The file is deleted when the
scene unloads. No configuration is needed.

In this repository, run the CLI from source with the pnpm script. The same
command ships as the `klanker-cli` package, whose `klanker` bin can be installed
globally (`npm install -g klanker-cli`) and invoked as `klanker`:

```sh
pnpm klanker ls
pnpm klanker deploy ascent.ts --to guidance --run
pnpm klanker logs -f --to guidance
```

If the game is elsewhere or you moved the endpoint file, pass
`--endpoint /path/to/bridge.json`.

## Commands

```text
klanker ping                         Check the bridge.
klanker ls                           List onboard actors.
klanker build <file>                 Bundle a worker and print it (no game needed).
klanker check <file>                 Type-check a worker against the host API and libs.
klanker deploy <file> --to <alias>   Bundle and deploy a worker to an actor.
                      --id <id>      Address the actor by workerId instead.
                      [--run]        Start it after deploying.
klanker restart <alias|workerId>     Restart an actor.
klanker stop <alias|workerId>        Stop an actor.
klanker alias <alias|workerId> <name> Set or clear an actor alias.
klanker state <alias|workerId>       Print the actor's saved storage JSON.
klanker state-reset <alias|workerId> Clear the actor's saved storage.
klanker logs [-f] [--to <alias>]     Stream worker logs (Ctrl-C to stop).
```

`<file>` may be TypeScript (`.ts`) or JavaScript. `build`/`deploy` bundle it
with esbuild, inlining local, npm, and standard-library imports into one module;
the deployed file is always named `<name>.js`. The library can be imported either
through the `klanker:<name>` scheme or as the `klanker` package (`klanker` or
`klanker/<name>`). `check` runs the TypeScript compiler against the host API
declaration and the libraries, so you catch mistakes before deploying. See
[Worker libraries](libraries.md).

Aliases are human selectors and need not be unique; if one matches several
actors, the CLI reports the ambiguity and you should use the `workerId` from
`ls`. Identities stay on the part: `deploy` replaces the saved script and its
storage is preserved, exactly like an in-game reload. The deployed source is
embedded in the save, so a craft keeps working without the CLI or any local
file.

## Protocol and security

The bridge speaks newline-delimited JSON: each request is
`{ "id", "token", "method", "params" }` and each response is
`{ "id", "ok", "result" | "error" }`. Worker log lines arrive as unsolicited
`{ "event": "log", "data": { workerId, file, message } }` events, which is what
`logs` consumes.

`deploy` sends arbitrary JavaScript that the game then executes, so the endpoint
is a local code-execution surface. It binds to loopback only, requires the
token, restricts the endpoint file to the owner where the platform allows it,
and is removed at scene teardown. Do not expose the port through a proxy or
firewall rule.

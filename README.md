# Klanker

> A suspiciously modern piece of flight software.
>
> Manage your spacecraft like web workers.

Klanker embeds a V8 engine in Kerbal Space Program and runs your TypeScript on
every physics tick. Read your vessel's telemetry, command its throttle, attitude,
staging, and action groups, and redeploy a new script without leaving flight.
It's a kOS for people who write JavaScript.

```ts
// ascent.ts — full throttle below a 100 km apoapsis, then cut it.
import { PID } from 'klanker';

const worker: Klanker.Worker = {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
};

export default worker;
```

```sh
pnpm klanker deploy ascent.ts --to guidance --run
pnpm klanker logs -f --to guidance
```

Deploy bundles the file and everything it imports into one self-contained
module, sends it over a loopback bridge to the running game, and starts it. Edit,
deploy again — no reload, no restart, no alt-tab.

## What you get

- **V8 in the flight loop.** One shared V8 runtime per scene, one isolated
  context per computer, warmed at scene load. Handlers are synchronous and get a
  20 ms budget, with a watchdog that interrupts runaway loops.
- **Computers on parts.** Command pods and probe cores carry their own script
  assignment, run setting, storage, and identity. Only the active control point
  runs; the rest wait on standby and resume where they left off.
- **TypeScript first.** The standard library (`vec`, `pid`, `attitude`, `frame`,
  `mechjeb`) ships as TypeScript, so `import { PID } from 'klanker'` gives full
  editor completion and `pnpm klanker check` type-checks against the real host
  API before you launch.
- **Persistence that survives the save.** `ctx.storage` is JSON stored on the
  part, so counters and state live through quicksaves, reloads, and script
  replacement.
- **Live telemetry and control.** Vessel, orbit, body, resources, parts and
  engines; throttle, pitch/yaw/roll, RCS translation, and SAS/RCS/gear/brakes/
  lights/abort.
- **An experimental MechJeb bridge.** Drive SmartASS, maneuver nodes, and landing
  guidance when MechJeb is on the vessel.
- **A scriptable CLI.** `ping`, `ls`, `build`, `check`, `deploy`, `restart`,
  `stop`, `alias`, `state`, and streaming `logs` over a token-guarded loopback
  socket.

## Install

You need KSP **1.12.5**, [ModuleManager](https://github.com/sarbian/ModuleManager)
**4.2.3**, and MechJeb **2.14.3** (CKAN `2.14.3.0`). ModuleManager adds the
computer to command parts; MechJeb is a required dependency for now. Newer
MechJeb releases are deliberately not the target.

From a release ZIP, copy `GameData/Klanker` into your KSP `GameData` and keep its
subdirectories intact. To build from source you also need Node.js 22+, pnpm, and
the .NET 9 SDK:

```sh
pnpm install --frozen-lockfile
pnpm make test --configuration Release
pnpm make configure --ksp "path/to/KSP"
pnpm make deploy --configuration Release
```

Close KSP before deploying. Builds fetch their own dependencies and never read
libraries out of your installation; deployment preserves edited workers and backs
up the previous Klanker folder.

## Hello, autopilot

1. In the editor, right-click a pod or probe core and choose **Klanker worker…**,
   enter `observe.js`, and click **Assign / reload file**.
2. Enable **Run when active**, save the craft, and launch. The successful-tick
   count rises without touching the controls. **F8** toggles the window in flight.
3. Try `apoapsis.js` for a throttle controller, the [Grasshopper
   hopper](docs/grasshopper.md) for a climb-and-land example, or `ascent.js` for a
   full launch-to-orbit autopilot (gravity turn, Max-Q throttle limiting,
   autostaging on flameout, and circularisation) that runs on a stock Kerbal X
   without MechJeb.

From the CLI instead:

```sh
pnpm klanker ls                                  # what's flying
pnpm klanker deploy workers/samples/observe.ts --to guidance --run
pnpm klanker deploy workers/samples/ascent.ts --to ascent --run
pnpm klanker logs -f --to ascent
```

The example sources live in [`workers/samples/`](workers); `pnpm make build`
bundles them into the game folder for the in-game window. See the
[worker guide](docs/workers.md) for the API, [standard
library](docs/libraries.md) for the modules, and the [CLI guide](docs/cli.md) for
the full command list.

## The packages

Klanker ships two npm packages:

- **`klanker`** — the worker standard library. Import `klanker`, `klanker/pid`,
  `klanker/frame`, and friends from any TypeScript project; the sources are
  TypeScript, so your editor and bundler handle them directly. The
  `Klanker.Worker` host API declaration ships here too (`klanker/api`).
- **`klanker-cli`** — the `klanker` command that bundles and deploys workers.

Inside this repository, `pnpm klanker` runs the CLI from source, and worker
sources live in [`workers/`](workers).

## Project status

Early. It runs, it flies, and it will bite you if you trust it too far.

- Script execution, faults, watchdog interruption, and manual stop have been
  exercised in Windows KSP 1.12.5.
- Part-owned computers pass automated persistence, ownership, and control-handoff
  tests with host fixtures; an in-game editor/save/load pass is still pending
  ([checklist](docs/workers.md#testing-command-part-computers)).
- The [Grasshopper hopper](docs/grasshopper.md) was reported working in Windows
  KSP on 2026-09-09; it remains a craft-specific tuning example.
- Linux x64 and macOS x64 libraries are included, but in-game testing on those
  platforms is still outstanding.
- This is not a general-purpose autopilot, and it is **not** a sandbox for
  untrusted scripts. Use test saves and scripts you trust.

## Documentation

- [Writing workers](docs/workers.md) — API, examples, faults, storage.
- [Standard library](docs/libraries.md) — vector, PID, attitude, frame, MechJeb modules.
- [CLI](docs/cli.md) — deploy and control workers on a running game.
- [Development](docs/development.md) — build tasks, deployment, dependencies, checks.
- [Design notes](docs/design.md) — future plans, not features available today.
- [Original proposal](docs/proposal.md) — the full reference design.

Inspired by [ArmorControl](https://github.com/Armo00/ArmorControl), by
[Armo00](https://github.com/Armo00).

Klanker is licensed under [MPL 2.0](LICENSE). Bundled dependencies carry their own
notices in `GameData/Klanker/Licenses` in the build output.

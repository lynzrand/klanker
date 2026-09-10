# Workers

Worker sources live here. A worker is a module with a default export containing a
synchronous `flightTick` handler; see the [worker guide](../docs/workers.md) and
the [standard library](../docs/libraries.md).

```
workers/
  samples/     Shipped examples, bundled into GameData at build time
```

| Sample | What it does |
| --- | --- |
| `observe.ts` | Reads telemetry and logs once; changes no controls. |
| `apoapsis.ts` | Full throttle below a 100 km apoapsis, then cut. |
| `storage.ts` | Demonstrates `ctx.storage` across quicksave/quickload. |
| `grasshopper.ts` | Experimental climb, translate, and slow descent. Read [its guide](../docs/grasshopper.md) first. |
| `fault.ts` | Intentionally throws after a buffered write (rollback test). |
| `watchdog.ts` | Loops forever (watchdog interruption test). |

## Build and deploy

`pnpm make build` bundles each sample into
`build/GameData/Klanker/Workers/<name>.js` and copies the host API declaration
beside it, so the game's **Assign / reload file** window can load them without a
toolchain. `klanker.d.ts` is generated from `lib/klanker.d.ts`, the declaration
that ships with the `klanker` standard library package.

Deploy a source directly to a running game with the CLI:

```sh
pnpm klanker deploy workers/samples/apoapsis.ts --to guidance --run
```

The build bundles each sample into a self-contained module, so a worker may
import `klanker` or `klanker:*` like any CLI-deployed worker; the current
examples just happen to be standalone. The generated `.js` is what the in-game
assignment path (which does not bundle) reads.

Add a new sample as `workers/samples/<name>.ts` and run `pnpm make build`.

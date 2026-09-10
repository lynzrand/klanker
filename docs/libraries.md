# Worker libraries

A deployed worker is a single self-contained module, so imports are resolved
**before** deployment, not at runtime. Write workers in TypeScript or JavaScript;
`pnpm klanker deploy` bundles the entry with [esbuild](https://esbuild.github.io/),
inlining local files, npm packages, and the built-in `klanker:*` libraries.
`pnpm klanker build <file>` prints the bundle and `pnpm klanker check <file>`
type-checks it, both without contacting the game.

```sh
pnpm install --frozen-lockfile      # once, for esbuild and typescript
pnpm klanker check ascent.ts        # type-check against the API and libraries
pnpm klanker build ascent.ts > ascent.bundle.js
pnpm klanker deploy ascent.ts --to guidance --run
```

The libraries under [`lib/`](../lib) are TypeScript sources; type-checking maps
`klanker:*` onto them. They are not shipped in `GameData`, and the runtime does
not need a module loader. The in-game **Assign / reload file** path does not
bundle, so files assigned there must be self-contained JavaScript (the shipped
examples are).

## klanker:vec

Vector3 algebra over plain `{ x, y, z }` objects: `add`, `sub`, `scale`,
`negate`, `mul`, `dot`, `cross`, `length`, `distance`, `normalize`, `lerp`,
`limit`, `project`, `reject`, `angle`, `rotateAround`, `clamp`, `zero`, and
`vec(...)` to coerce. Named exports and a default namespace object are provided.

## klanker:pid

`PID` with derivative on measurement, a filtered derivative, conditional
integration, and optional back-calculation:

```js
import { PID } from 'klanker:pid';
const vertical = new PID(1.4, 0.4, 0.1);
vertical.update(targetSpeed, vessel.verticalSpeed, ctx.deltaTime, 0.4);
```

## klanker:attitude

`AttitudeHold` points the nose (control-frame +Y) at a direction in the active
control frame, with a damping term on measured angular velocity:

```js
import { AttitudeHold } from 'klanker:attitude';
const hold = new AttitudeHold({ kp: 1.5, kd: 2, maxInput: 0.25 });
hold.aim(ctx, vessel.attitude.up);   // nose radial-out
hold.killRotation(ctx);              // damp only
```

## klanker:frame

Converts between KSP Unity world axes (used by `vessel.velocity.*` and body
telemetry) and the control frame (used by `vessel.attitude.*` and writable
controls), and builds the usual directions.

- `toLocal(ctx, world)` / `localize`, `toWorld(ctx, local)` / `globalize`
- `prograde`, `retrograde`, `surfacePrograde`, `surfaceRetrograde`
- `radialOut`, `radialIn`, `northUp`, `east`, `normal`, `antiNormal`
- `orbitalBasis`, `surfaceBasis`

```js
import frame from 'klanker:frame';
const local = frame.toLocal(ctx, frame.prograde(ctx)); // prograde in control axes
```

The conversion uses `vessel.attitude.east/north/up`, so it is exact for the
current tick's control frame.

## klanker:mechjeb

Thin wrappers over `ctx.mechjeb`. Every call throws when MechJeb is not on the
vessel, so check `available(ctx)` first.

```js
import mj, { SmartAss } from 'klanker:mechjeb';
if (mj.available(ctx)) mj.smartAss(ctx, SmartAss.PROGRADE);
```

`SmartAss` lists the supported modes (`PROGRADE`, `RETROGRADE`, `NORMAL`,
`ANTINORMAL`, `RADIAL`, `ANTIRADIAL`, `TARGET`, `ANTITARGET`, `RELATIVE`,
`ANTIRELATIVE`, `SURFACE_PROGRADE`, `SURFACE_RETROGRADE`, `HORIZONTAL`,
`VERTICAL`, `MANEUVER_NODE`, `KILLROT`, `OFF`). Also `executeNode`/`abortNode`,
`startLanding`/`stopLanding`, and `disableSmartAss`.

The adapter drives MechJeb's SmartASS by setting its target and calling
`Engage()`, exactly like the SmartASS window. It is experimental and has not
been validated in game.

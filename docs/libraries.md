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
`klanker:*` onto them. The same modules are published as the `klanker` npm
package, so any TypeScript project can import them directly and get editor
completion and checking:

```ts
import { PID, vec } from 'klanker';
import frame from 'klanker/frame';
```

The files ship as TypeScript, so your bundler (or `pnpm klanker`) compiles them;
there is no separate runtime build. Imports also work through the original
`klanker:<name>` scheme. The `Klanker.Worker` host API declaration ships here
too, as `klanker/api`. The libraries are not loaded at runtime by the game, and
it does not need a module loader. The in-game **Assign / reload file** path does
not bundle, so files assigned there must be self-contained JavaScript; the
shipped examples are bundled into `GameData/Klanker/Workers` at build time.

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

Builds directions in the active control frame from `vessel.attitude.*` and the
host's exact `velocity.local*` transforms. It also converts between
east/north/up (ENU) components and the control frame.

- `tilt(ctx, pitchDegrees, azimuthDegrees = 90)` — a direction tilted `pitch`
  degrees from radial-out toward the horizon at a compass azimuth from north;
  0 is straight up, 90 is horizontal, and the default azimuth 90 is due east.
  Feed it to `AttitudeHold`.
- `prograde`, `retrograde`, `surfacePrograde`, `surfaceRetrograde` — control-frame
  directions built from `vessel.velocity.localOrbital`/`localSurface`; they can
  be fed directly to `AttitudeHold.aim`.
- `radialOut`, `radialIn`, `northUp`, `east`, `normal`, `antiNormal`
- `orbitalBasis`, `surfaceBasis`
- `enuToLocal(ctx, enu)`, `localToEnu(ctx, local)`

```js
import frame from 'klanker:frame';
const target = frame.tilt(ctx, 45);        // 45 degrees above the eastern horizon
```

The older `toLocal`/`localize` and `toWorld`/`globalize` names remain as
deprecated aliases for `enuToLocal` and `localToEnu`. They are not general Unity
world transforms: KSP's Unity world axes are not east/north/up. For velocity use
the direction helpers or the host's exact `vessel.velocity.localSurface` and
`vessel.velocity.localOrbital` values.

## klanker:orbit

Two-body formulas for launch and transfer guidance: plain numbers and
`{ radius, gravitationalParameter }` bodies, metres and seconds and kilograms,
matching `vessel.mass` and the kN thrust fields.

- `gravity(mu, radius)`, `circularSpeed(mu, radius)`, `escapeSpeed(mu, radius)`
- `visViva(mu, radius, semiMajorAxis)`, `apoapsisSpeed(...)`, `periapsisSpeed(...)`
- `period(mu, semiMajorAxis)`
- `altitudeToRadius(body, altitude)`, `radiusToAltitude(body, radius)`
- `circularizationDeltaV(mu, radius, semiMajorAxis)`
- `burnTime(massKg, deltaV, thrustKN)` — constant-thrust estimate
- `rocketBurnTime(massKg, deltaV, thrustKN, isp)` — from the rocket equation
- `standardGravity`

```js
import orbit from 'klanker:orbit';
const apR = orbit.altitudeToRadius(vessel.body, vessel.orbit.apoapsis);
const dv = orbit.circularizationDeltaV(vessel.body.gravitationalParameter, apR, vessel.orbit.semiMajorAxis);
const seconds = orbit.rocketBurnTime(vessel.mass, dv, vessel.availableThrust, vacuumIsp);
```

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

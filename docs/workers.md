# Writing workers

A worker is a JavaScript module with a default export containing a synchronous
`flightTick` function:

```js
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
};
```

Deploy it with `pnpm klanker deploy <file> --to <alias>` (see the
[CLI](cli.md)); the CLI bundles imports into one self-contained module and
includes the built-in [worker libraries](libraries.md). Files assigned from the
in-game window are embedded as-is and must be self-contained.
`GameData/Klanker/Workers` holds the examples and the shipped `klanker.d.ts`.

Klanker calls this handler through KSP's flight-control callback on the active,
unpacked vessel. It does not invoke the worker while the pause menu is open.
Only the worker on the active vessel's **Control from Here** part runs. Every
other computer retains its assignment on standby. A docking port or other
reference part without a computer grants no worker flight authority. See the
[README](../README.md) for installation.

## Available properties

The full interface, including units and edge cases, is in
[`klanker.d.ts`](../GameData/Klanker/Workers/klanker.d.ts). It ships beside the
example workers. Add these lines to a script for editor completion and checking:

~~~js
// @ts-check
/// <reference path="./klanker.d.ts" />

/** @satisfies {Klanker.Worker} */
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
};
~~~

Telemetry includes vessel identity and situation, mass in kilograms, location,
surface/orbital speeds, orbit elements, body properties, velocity components,
and resource totals. Writable state is `vessel.control.throttle` (0..1),
`pitch`/`yaw`/`roll` (-1..1), the RCS `translation` axes (-1..1), and the
`sas`/`rcs`/`gear`/`brakes`/`lights`/`abort` action groups.

These are C# views exposed through ClearScript, not raw KSP objects or plain
JavaScript records. Read properties directly; copy the fields you want into an
ordinary JS object for serialization. Nested views retained between ticks follow
the current tick's vessel. Reads outside a tick fail.

`vessel.resources.get('ElectricCharge')` returns a read-only, detached
`{ name, amount, capacity }` view. It totals every tank on the vessel, including
locked tanks; it does not predict engine accessibility or crossfeed. Missing
resources return zero totals. Resource quantities use KSP resource units.

## Parts

`vessel.parts` queries the current vessel's parts. Results are count/get views,
not JavaScript arrays, because host arrays cannot be iterated under Klanker's
restricted access model:

~~~js
const main = vessel.parts.byTag('main-engine');
for (let i = 0; i < main.count; i++) {
    const part = main.get(i);
    console.log(part.title, part.engines.count);
}
~~~

`parts.count`, `parts.get(i)`, `parts.byName(name)` (part config name),
`parts.byTag(tag)` (name tags from `ModuleNameTag` or `KOSNameTag`, if
installed), and `parts.withModule(name)` are available; `parts.byId(id)`
resolves a stable `part.id` (KSP `persistentId`) and throws if the part is gone.
References are live for the current tick only: store `part.id` in `ctx.storage`
and re-query with `parts.byId` to follow a part across ticks, staging, or
docking.

A part exposes `id`, `name`, `title`, `stage`, `tags`, `resources.get(name)`
(single-part totals), and `engines` (`count`/`get(i)`). Each engine exposes
`name`, `maxThrust`, `thrust`, `ignited`, `operational`, a buffered
`thrustLimiter` (0..1), and queued `activate()`/`shutdown()` actions.

## MechJeb (experimental)

`ctx.mechjeb` is a small, experimental bridge to MechJeb when it is present on
the vessel. Check `mechjeb.available` first; every other member throws when
MechJeb is absent.

~~~js
export default {
    flightTick({ mechjeb }) {
        if (!mechjeb.available) return;
        mechjeb.attitude.enabled = true;
        mechjeb.attitude.reference = 'ORBIT';
        mechjeb.node.execute();
    },
};
~~~

Available operations: `attitude.enabled`, `attitude.reference` (a MechJeb
`AttitudeReference` name such as `ORBIT`, `SURFACE_NORTH`, `TARGET`,
`RELATIVE_VELOCITY`, or `MANEUVER_NODE`), `node.execute()`/`node.abort()`, and
`landing.start()`/`landing.stop()`. The adapter reaches MechJeb through
reflection, so a new MechJeb release can rename these members, and it has not
been validated in game. `attitude.reference` selects a frame only; MechJeb's
SmartASS also chooses a target direction, so this is a lower-level control.

Both velocity vectors use KSP's current Unity world axes, not vessel-local axes
or north/east/up. Don't treat these axes as a persistent inertial frame.
Unavailable orbital values can be nonfinite; period and time to apoapsis are
explicitly `NaN` for open trajectories.

Reads use the live vessel state. Writes are buffered until the handler returns
successfully; reading a control after writing it returns the buffered value.
Only controls you write are applied. If the handler throws or exceeds its time
budget, its buffered writes are discarded.

Action-group assignments use the same buffer, so a failed tick leaves
`sas`/`rcs`/`gear`/`brakes`/`lights`/`abort` unchanged. `vessel.stage()` is a
discrete action instead: it is queued and run only after the handler returns
successfully, because an activated stage cannot be rolled back. A handler that
throws or times out does not stage.

Nonfinite numbers and values outside the allowed range cause a fault rather
than being clamped. `async` handlers and returned promises are rejected. Vessel
access is only valid during `flightTick`; raw KSP objects and general CLR access
are not exposed.

## Persistent storage

Each command part has its own mutable `ctx.storage` object:

~~~js
export default {
    flightTick({ storage, vessel }) {
        storage.highestAltitude = Math.max(storage.highestAltitude ?? 0, vessel.altitude);
    },
};
~~~

Klanker serializes it as JSON when KSP calls the part's save hook. The JSON is
UTF-8/base64-encoded inside the part's `storageBase64` save field, keeping it
with the craft or game save; it is not a separate file shared across saves.
Older saves without that field start with `{}`.

Storage survives script replacement, stop/start, and control-point changes.
These normal runtime teardown paths also take an in-memory JSON checkpoint;
it reaches disk on the next KSP save. Loading a quicksave restores that save's
snapshot, not changes made afterward. Copying a part copies its saved values
into an independent store. Storage belongs to the part, not the script filename:
use your own namespace or schema version if different scripts share a computer.

The root reference is read-only, but its contents are ordinary JS data. Assign,
delete, and nest properties normally. To clear it, delete its keys:
`for (const key of Object.keys(storage)) delete storage[key]`.
Only finite numbers, strings, booleans, null, plain objects, and dense arrays
are supported. Functions, undefined, BigInt, class/host objects, cycles, symbol
keys, accessors, hidden properties, and sparse arrays are rejected rather than
silently altered by JSON serialization.

Limits are 64 KiB of UTF-8 JSON, 10,000 values, 32 nesting levels, and a 250 ms
serialization budget. Serialization happens at checkpoints, not every tick.
If it fails, the window and log report the error and the save keeps the last
valid snapshot. The worker can repair invalid values before the next save.
A runtime fault discards all storage edits since the last valid checkpoint;
storage is not a per-tick transactional database.

Try `storage.js`: it logs restored counters once, increments them without
controlling the vessel, and lets you verify quicksave/quickload and file reload.
The automated tests cover the save hook and persistence using host fixtures;
real KSP save/load validation for this feature is still pending.

## Logging

`console.log('Altitude:', vessel.altitude)` writes to `KSP.log`, prefixed with
the worker identity and script filename. Ordinary JS objects are JSON-formatted.
Logging also works at module initialization, including assignment validation:
top-level logs can appear once during validation and again when a runtime starts.
Logs already written are not rolled back if a tick fails.

Each runtime allows 20 messages per one-second window. Messages are limited to
32 arguments and 2048 UTF-16 code units. Klanker emits explicit warnings when it
truncates output or drops messages due to the rate limit, once per kind per window.
Those warnings are additional to the 20-message allowance. Prefer logging changes
or occasional samples rather than every physics tick. Only `console.log` is
implemented; this is not the full browser/Node console API.

## Assigning a script to a part

Right-click a command pod or probe core and choose **Klanker worker…** in the
VAB, SPH, or flight. Enter a filename and click **Assign / reload file**. The
window always identifies which part you are editing; selecting it does not
change KSP's control point.

Files must be directly inside `GameData/Klanker/Workers` and no larger than
128 KiB of UTF-8 source. Assignment validates the script and copies it into that
part. Save the craft or game to keep it. The original file is only needed to
assign or reload: an existing assignment still works if the file is moved or
edited. A failed replacement leaves the saved script and old runtime intact.

New computers are stopped by default. Enable **Run when active** to request
execution whenever that part becomes the active control point. This setting is
saved, so you can configure a pod in the editor and have it start on launch.
**Start / restart assigned script** also enables it and explicitly clears a
fault. **Stop worker** disables it without removing the script.

Changing vessels or control points, packing a vessel, and leaving flight dispose
the running context. The assignment stays on its part, and enabled computers
resume when eligible again. JavaScript variables reset when the context is
recreated; use `ctx.storage` for data that should survive. Runtime faults are saved
and remain stopped across reactivation and game reload until explicit recovery.

Worker identities are assigned in flight and saved with the part. Craft templates
and copied parts receive fresh identities, while retaining their script assignments.
A part may also carry a human-readable **alias** (set in the window): aliases are
selectors, not identities—they are not unique, and copies do not inherit them.
There is no shared memory between computers. No power consumption or computer
resource model is implemented yet, and unloaded/background vessels do not run.

Run only scripts—and crafts/saves containing scripts—that you trust. This is
not a sandbox for hostile code. Loading external file/network modules is not enabled.

Stopping or faulting releases Klanker's inputs without changing the throttle
setting; KSP, the player, and SAS continue to handle control.

## Examples and fault tests

- `observe.js` checks that altitude is finite without writing controls.
- `grasshopper.js` performs an experimental climb, sideways translation, and
  slow descent. Read the [setup and tuning guide](grasshopper.md) first.
- `apoapsis.js` demonstrates the throttle controller above. It is not an ascent
  autopilot: launch, steering, staging, and orbital insertion are up to you.
- `fault.js` buffers full throttle and then throws an intentional exception.
- `watchdog.js` buffers full throttle and then loops forever to test interruption.

Run fault tests on a safe test vessel with a known throttle setting. Both should
show **FAULTED**, with zero successful ticks and no throttle change from the
failed tick. They must not restart automatically. Use **Start / restart assigned
script** to retry, or assign a replacement.
After testing the watchdog, assign `observe.js` to check that a fresh worker runs.

The time budget is 20 ms per tick, with 250 ms for the first tick's startup work
and 2 seconds for module initialization. The addon owns one V8 runtime per
editor/flight scene, warmed during scene startup. Each worker still gets a fresh
context with separate globals and its own restored storage. Contexts share a
64 MiB runtime heap limit (not 64 MiB each) and execute serially. These limits
are safeguards, not hard real-time guarantees; startup can cause a brief hitch.

The exception and watchdog displays were verified in Windows KSP on 2026-09-08.
Buffered-write rollback passes the automated tests, but an explicit in-game
observation of throttle during a failed tick is still outstanding.

## If something goes wrong

In the editor, open the window through a command part's right-click menu. In
flight, try F8. Check `KSP.log` for `[Klanker] Computer UI ready`. If it is absent, look earlier
in the log for `AssemblyLoader` errors. For worker failures, the window shows a
short message and log entries prefixed with `[Klanker]` contain the details.

## Testing command-part computers

Use a fresh test craft with two command parts and ModuleManager installed.

1. Open each part's **Klanker worker…** menu in the editor and assign different
   workers. Save and reopen the craft; both assignments should remain distinct.
2. Enable **Run when active**, launch, and check that only the current control
   point's worker ticks. Use **Control from Here** on the other pod: the old one
   should enter standby and the new one should start.
3. Quicksave and reload. The scripts, run settings, and flight worker identities
   should survive. Move the original `.js` files temporarily to confirm the saved
   copies run without them.
4. Duplicate a pod in the editor and launch two copies of the same craft. They
   should retain the configured scripts but get different worker identities.
5. Test docking/separation and switching active vessels. No worker should keep
   writing to a vessel after its owning part moves elsewhere.
6. Assign a broken replacement while a worker is running; its previous assignment
   should remain intact. Trigger a runtime fault, save/reload, and verify that it
   stays faulted until you explicitly restart or replace it.

The automated tests cover these ownership and persistence rules with small KSP
host fixtures, not the game's actual part lifecycle. This checklist is the
remaining in-game validation for the command-part milestone.

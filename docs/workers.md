# Writing workers

A worker is a `.js` file in `GameData/Klanker/Workers` with a default export
containing a synchronous `flightTick` function:

```js
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
};
```

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
and resource totals. Only `vessel.control.throttle` (0..1) and
`pitch`/`yaw`/`roll` (-1..1) are writable.

These are C# views exposed through ClearScript, not raw KSP objects or plain
JavaScript records. Read properties directly; copy the fields you want into an
ordinary JS object for serialization. Nested views retained between ticks follow
the current tick's vessel. Reads outside a tick fail.

`vessel.resources.get('ElectricCharge')` returns a read-only, detached
`{ name, amount, capacity }` view. It totals every tank on the vessel, including
locked tanks; it does not predict engine accessibility or crossfeed. Missing
resources return zero totals. Resource quantities use KSP resource units.

Both velocity vectors use KSP's current Unity world axes, not vessel-local axes
or north/east/up. Don't treat these axes as a persistent inertial frame.
Unavailable orbital values can be nonfinite; period and time to apoapsis are
explicitly `NaN` for open trajectories.

Reads use the live vessel state. Writes are buffered until the handler returns
successfully; reading a control after writing it returns the buffered value.
Only controls you write are applied. If the handler throws or exceeds its time
budget, its buffered writes are discarded.

Nonfinite numbers and values outside the allowed range cause a fault rather
than being clamped. `async` handlers and returned promises are rejected. Vessel
access is only valid during `flightTick`; raw KSP objects and general CLR access
are not exposed.

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
recreated; there is no durable JavaScript state API yet. Runtime faults are saved
and remain stopped across reactivation and game reload until explicit recovery.

Worker identities are assigned in flight and saved with the part. Craft templates
and copied parts receive fresh identities, while retaining their script assignments.
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
and 2 seconds for module initialization. V8 has a 64 MiB heap limit. These limits
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

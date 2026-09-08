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
Only one worker runs at a time. See the [README](../README.md) for installation.

## Available properties

All values are numbers. Telemetry is read-only; control properties can be read
and written.

| Property on `vessel` | Meaning / range |
| --- | --- |
| `altitude` | Metres above sea level |
| `verticalSpeed` | Vertical speed in m/s |
| `surfaceSpeed` | Surface-relative speed in m/s |
| `orbit.apoapsis` | Apoapsis height above the body's surface, in metres |
| `orbit.periapsis` | Periapsis height above the body's surface, in metres |
| `control.throttle` | 0 to 1 |
| `control.pitch` | -1 to 1 |
| `control.yaw` | -1 to 1 |
| `control.roll` | -1 to 1 |

Reads use the live vessel state. Writes are buffered until the handler returns
successfully; reading a control after writing it returns the buffered value.
Only controls you write are applied. If the handler throws or exceeds its time
budget, its buffered writes are discarded.

Nonfinite numbers and values outside the allowed range cause a fault rather
than being clamped. `async` handlers and returned promises are rejected. Vessel
access is only valid during `flightTick`; raw KSP and CLR objects are not exposed.

## Loading and stopping

Enter a filename in the flight window and click **Load / reload worker**.
Files must be directly inside `Workers` and no larger than 128 KiB. Edit them
with your usual editor, then click reload to apply the changes. There is no file
watcher. A replacement that fails to load leaves the previous worker running.

Ordinary JavaScript variables survive between ticks, but not a reload or scene
change. Nothing is saved with the game, and loading other files or network
modules is not enabled. Run only scripts you trust.

**Stop control** detaches the worker. Switching the active vessel also stops it;
leaving flight disposes it. You must load it again to resume.

Stopping or faulting does **not** set throttle to zero or restore earlier input
values. It simply stops Klanker from injecting controls, leaving KSP, the player,
and SAS to continue.

## Examples and fault tests

- `observe.js` checks that altitude is finite without writing controls.
- `apoapsis.js` demonstrates the throttle controller above. It is not an ascent
  autopilot: launch, steering, staging, and orbital insertion are up to you.
- `fault.js` buffers full throttle and then throws an intentional exception.
- `watchdog.js` buffers full throttle and then loops forever to test interruption.

Run fault tests on a safe test vessel with a known throttle setting. Both should
show **FAULTED**, with zero successful ticks and no throttle change from the
failed tick. They must not restart automatically. Click reload to start again.
After testing the watchdog, load `observe.js` to check that a fresh worker runs.

The time budget is 20 ms per tick, with 250 ms for the first tick's startup work
and 2 seconds for module initialization. V8 has a 64 MiB heap limit. These limits
are safeguards, not hard real-time guarantees; startup can cause a brief hitch.

The exception and watchdog displays were verified in Windows KSP on 2026-09-08.
Buffered-write rollback passes the automated tests, but an explicit in-game
observation of throttle during a failed tick is still outstanding.

## If something goes wrong

The window only appears in flight, not the editor or space center. Try F8, then
check `KSP.log` for `[Klanker] Flight addon ready`. If it is absent, look earlier
in the log for `AssemblyLoader` errors. For worker failures, the window shows a
short message and log entries prefixed with `[Klanker]` contain the details.

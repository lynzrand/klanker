# Flight-control proof of concept

This implements the proposal's M0/M1 path: ES-module worker → live vessel reads
→ buffered controls → successful tick → KSP control callback. It is one manually
loaded worker on the active vessel, without a computer part, durable actor state,
CLI deployment, RPC, or MechJeb guidance integration yet.

## Validation status

Manually exercised on Windows KSP 1.12.5 on 2026-09-08: the flight window
loads, the intentional exception and infinite-loop watchdog report sticky
faults, and `apoapsis.js` completed 4,727 successful ticks before being stopped
by the player. Exact fault-tick throttle rollback still needs an explicit
in-game observation. Linux and macOS runtime testing remains outstanding.

## Try it

1. Run `pnpm make test --configuration Release`.
2. Locate KSP once with `pnpm make configure --ksp "path/to/KSP"`.
   Close KSP, then run `pnpm make deploy --configuration Release`.
   Supply the installation root containing `GameData`, not `GameData` itself.
   Alternatively copy the generated `build/GameData/Klanker` folder manually.
   Keep MechJeb 2.14.3 installed as required by the current assembly
   dependency. Build inputs remain independent of that installation.
3. Enter flight with a simple test vessel. The Klanker window opens automatically;
   F8 toggles it. Nothing executes until you click **Load / reload worker**.
4. Load `observe.js` first. Successful ticks should increase without any control
   changes.
5. For a vertical ascent experiment, enable SAS, launch manually, and load
   `apoapsis.js`. It sets throttle to 1 below 100 km apoapsis and 0 above it.
   It does not steer, stage, or insert into orbit.
6. Edit a worker under `GameData/Klanker/Workers`, then reload it in the window.
   Compilation occurs in the UI callback, outside the flight-control callback.
   A rejected replacement leaves the previous worker running.
7. Click **Stop control** to release Klanker's inputs. Changing the active vessel
   stops the worker; changing scenes disposes it. Load explicitly to start again.

Control release means ceasing to inject values. It does not command a throttle
cut or restore a previous throttle setting; KSP/player/SAS resume control.

The configure task validates the installation and saves its path in the
git-ignored `klanker.local.json`. You can also copy `klanker.local.example.json`
and edit `kspPath` yourself; relative paths resolve from the config directory.
`pnpm make deploy --ksp "another/path"` overrides it for one deployment.
The build never reads this installation for references. Deployment replaces Plugins/Licenses,
preserves existing worker edits and other local data, and moves the previous
Klanker folder into `.klanker-backups` under the installation root (outside
GameData). New example workers are added, but existing ones are not overwritten.
To restore, close KSP and replace `GameData/Klanker` with the reported backup.
Other mods are untouched. Symlink/junction deployment layouts are rejected.

## Worker API

```js
export default {
    flightTick({ vessel }) {
        vessel.control.throttle = vessel.orbit.apoapsis < 100_000 ? 1 : 0;
    },
};
```

Reads: `altitude` (sea-level metres), `verticalSpeed` and `surfaceSpeed` (m/s),
`orbit.apoapsis` and `orbit.periapsis` (metres above the body's surface).
Controls: `throttle` (0..1), `pitch`, `yaw`, and `roll` (-1..1). Each getter
observes a staged write first, otherwise the live vessel/control callback.
Only written channels are committed. Nonfinite and out-of-range values fault
the worker; values are not silently clamped. Handlers must be synchronous.

The API wraps numeric host delegates, never raw KSP/Unity objects. These are
trusted local scripts, not an adversarial-code sandbox. External file/network
module loading is not enabled. JavaScript heap state lasts only until reload
or runtime destruction and is not saved.

## Fault checks

`fault.js` stages throttle and then throws. No controls from that tick should
commit. `watchdog.js` stages throttle and enters an infinite loop; V8's explicit
interrupt is called by a timer. Both should produce a visible sticky fault with
no automatic retry. Loading a worker is the explicit restart action.

The deadline is 20 ms per tick, with 250 ms for the first tick's CLR/JIT setup
and 2 seconds for module initialization. These are interruption targets, not
hard real-time guarantees. There is also a 64 MiB V8 heap limit. First-tick
startup may cause a noticeable hitch in this PoC.

`pnpm make test` runs native V8 smoke tests on modern .NET, plus the same source
and net472 ClearScript assemblies on Windows .NET Framework. It checks live
reads, write overlay, rollback on exceptions, invalid values, synchronous-only
handlers, watchdog interruption, rejected deployments, and recreation. Tests
load the native binaries from the generated `Plugins/PluginData` folder and have an outer
process timeout. They do not substitute for testing KSP's Unity/Mono runtime
and flight callbacks on Windows, Linux, and macOS.

Every build also checks packaged assembly-reference names against the online KSP
definitions and bundled runtime libraries, rejects reference-only DLLs and exposed
native DLLs, and compares Klanker's MechJeb dependency attribute to the pinned
MechJeb DLL's actual KSP API identity. The test task deliberately breaks packages
to verify that this gate rejects them. See [runtime packaging](runtime-packaging.md).

If the window is missing, enter a flight scene (not the editor or space center),
then try F8. `KSP.log` should contain `[Klanker] Flight addon ready`. Its absence
means the addon did not initialize; inspect earlier `AssemblyLoader` errors before
testing workers. MechJeb release **2.14.3.0** declares KSP API identity **2.5.0**;
these are different version systems, not a request to install another release.

## Part tags: reuse the ecosystem

The flight-only PoC does not expose parts yet. When that API is added, tags
should use the existing part name-tag module, not a Klanker-owned tag field.
Current kRPC source reads/writes `KOSNameTag.nameTag`; kOS exposes the same
value as `Part:TAG`. Users right-click a part and select **Change Name Tag**
in the VAB/SPH or flight. Tags persist in craft files or saves and need not be
unique (symmetry copies commonly share them).

KSPCommunityPartModules also provides `ModuleNameTag.nameTag` with legacy
migration. Compatibility should recognize both module names, while letting
the installed provider own the editing UI and persistence. We should use a
list-returning `withTag` query; a singular `byTag` must reject ambiguity rather
than silently pick the first part. Tags are selectors, not stable part IDs.

References:

- [kOS name-tag workflow](https://ksp-kos.github.io/KOS/general/nametag.html)
- [kRPC Part.Tag implementation](https://github.com/krpc/krpc/blob/main/service/SpaceCenter/src/Services/Parts/Part.cs)
- [Shared ModuleNameTag](https://github.com/KSPModdingLibs/KSPCommunityPartModules/blob/main/Source/Modules/ModuleNameTag.cs)
- [ArmorControl](https://github.com/Armo00/ArmorControl): reference for KSP flight-control callback lifecycle and active-vessel control release; no source copied.
- [ClearScript](https://github.com/ClearFoundry/ClearScript): V8 embedding and interruption APIs.

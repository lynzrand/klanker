# Klanker

A suspiciously modern piece of flight software for Kerbal Space Program.

Klanker runs JavaScript inside KSP using V8. Write a `flightTick` handler, read
your vessel's telemetry, and control its throttle, pitch, yaw, and roll. Edit
the script and reload it without leaving flight.

Inspired by [ArmorControl](https://github.com/Armo00/ArmorControl),
by [Armo00](https://github.com/Armo00).

Workers now belong to command pods and probe cores. Each part keeps its own
script assignment; the current control point runs its worker while the others
wait on standby. Scripts and explicit `ctx.storage` JSON data are stored with
the craft/save; ordinary JavaScript variables still reset with the runtime.
Part APIs, remote connections, and MechJeb guidance bindings
are still future work. Try this early build in a test save.

## Try it

You need KSP **1.12.5**, ModuleManager **4.2.3**, and MechJeb **2.14.3**
(CKAN version `2.14.3.0`). ModuleManager adds computers to command parts.
MechJeb is a required dependency for now, even though the PoC does not call its
guidance APIs. Newer MechJeb releases are deliberately not the target.

To build from source, install Node.js 22+, pnpm, and the .NET 9 SDK. Then run:

```sh
pnpm install --frozen-lockfile
pnpm make test --configuration Release
pnpm make configure --ksp "path/to/KSP"
pnpm make deploy --configuration Release
```

Close KSP before deploying. Give `configure` the installation root containing
`GameData`; it saves the path in a git-ignored local config. Builds fetch their
dependencies online and never use your installation as a source of libraries.
Deployment preserves edited workers and backs up the previous Klanker folder.

If installing manually, copy `build/GameData/Klanker` into KSP's `GameData`.
Keep its subdirectories intact.

1. In the editor, right-click a pod or probe core and choose **Klanker worker…**.
   Enter `observe.js` and click **Assign / reload file**.
2. Enable **Run when active**, save the craft, and launch. The successful-tick
   count should rise without changing controls. **F8** toggles the window in flight.
3. Assign `apoapsis.js` for a simple throttle controller. Enable SAS and launch
   manually; it uses full throttle below 100 km apoapsis and cuts it above that.
   It does not steer, stage, or circularize.

## What has been tested?

The original flight-only PoC was exercised in Windows KSP 1.12.5, including
script execution, faults, watchdog interruption, and manual stop. The new
part-owned computers pass automated persistence and control-handoff tests using
host fixtures, but still need an in-game editor/save/load check. Follow the
[computer test checklist](docs/workers.md#testing-command-part-computers).

The revised [Grasshopper hopper](docs/grasshopper.md) was reported working in
Windows KSP on 2026-09-09, after switching descent to horizontal-velocity
cancellation with PID control. It remains a craft-dependent tuning example.

Linux x64 and macOS x64 libraries are included, but in-game testing on those
platforms is still outstanding. This is not a general-purpose autopilot or a
sandbox for untrusted scripts.

## More

- [Writing workers](docs/workers.md): the current API, examples, and fault behavior.
- [Development](docs/development.md): build tasks, deployment, dependencies, and checks.
- [Design notes](docs/design.md): future plans, not features available today.
- [Original proposal](docs/proposal.md): the full reference design.

Klanker is licensed under [MPL 2.0](LICENSE). Bundled dependencies carry their
own notices in `GameData/Klanker/Licenses` in the build output.

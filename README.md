# Klanker

A suspiciously modern piece of flight software for Kerbal Space Program.

Klanker runs JavaScript inside KSP using V8. Write a `flightTick` handler, read
your vessel's telemetry, and control its throttle, pitch, yaw, and roll. Edit
the script and reload it without leaving flight.

This is an early proof of concept: one worker on the active vessel, loaded from
an in-game window. There are no computer parts, saved worker state, part APIs,
remote connections, or MechJeb guidance bindings yet. Try it in a test save.

## Try it

You need KSP **1.12.5** and MechJeb **2.14.3** (CKAN version `2.14.3.0`).
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

1. Enter flight with a simple vessel on the launchpad. The Klanker window should
   appear near the upper-left; **F8** toggles it.
2. Load `observe.js`. The successful-tick count should rise without changing
   any controls.
3. Try `apoapsis.js` for a simple throttle controller. Enable SAS and launch
   manually; it uses full throttle below 100 km apoapsis and cuts it above that.
   It does not steer, stage, or circularize.

## What has been tested?

The flight UI, script execution, exception reporting, watchdog interruption,
and manual stop have been exercised in Windows KSP 1.12.5. The ascent example
ran for thousands of successful ticks. Automated tests cover buffered writes,
fault handling, native V8 loading, and deployment packaging.

Linux x64 and macOS x64 libraries are included, but in-game testing on those
platforms is still outstanding. This is not a flight-proven autopilot or a
sandbox for untrusted scripts.

## More

- [Writing workers](docs/workers.md): the current API, examples, and fault behavior.
- [Development](docs/development.md): build tasks, deployment, dependencies, and checks.
- [Design notes](docs/design.md): future plans, not features available today.
- [Original proposal](docs/proposal.md): the full reference design.

Klanker is licensed under [MPL 2.0](LICENSE). Bundled dependencies carry their
own notices in `GameData/Klanker/Licenses` in the build output.

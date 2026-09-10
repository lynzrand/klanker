# Development

Klanker targets `net472` and uses the latest stable C# language version supported
by the SDK selected in `global.json`. Modern syntax is welcome; the APIs still
need to work in KSP's Unity/Mono runtime.

## Build tasks

Build tooling is TypeScript, run by [Hereby](https://github.com/jakebailey/hereby)
through `pnpm make`; Node 22.18+ executes the `.ts` files directly. No system
`make` or PowerShell scripts are needed.

```sh
pnpm make build --configuration Release  # Produce build/GameData/Klanker
pnpm make test --configuration Release   # Build, validate, and run smoke tests
pnpm tasks                              # List all tasks
pnpm typecheck                          # Check every TypeScript source
pnpm build:js                           # Build the cli/dist package output
```

The CLI and the worker standard library are separate npm packages: `klanker-cli`
(the `klanker` bin) and `klanker` (the importable `lib/` modules). Both live in
this workspace; the root package is private build tooling.

`pnpm make` defaults to a Debug build. `bootstrap` fetches the KSP and MechJeb
definitions; `compile` builds the plugin; `build` adds runtime dependencies and
validates the result. Put task names before options such as `--configuration`.
Generated output lives under `build/`, downloads under `.cache/`, and NuGet
packages under `.nuget/`. None belongs in source control.

## Local deployment

The [README](../README.md) covers the usual configure-and-deploy workflow.
`klanker.local.json` is machine-specific and ignored by version control. You can
also copy `klanker.local.example.json` and edit `kspPath`; relative paths resolve
from the config file's directory. To override it for one deployment:

```sh
pnpm make deploy --configuration Release --ksp "another/path/to/KSP"
```

Close KSP first. Deployment replaces Klanker's `Plugins`, `Licenses`, `Patches`,
and the shipped `Workers/klanker.d.ts` API definition, and preserves
existing worker edits and other local data, and adds any new example workers.
It does not install MechJeb or change other mods. Symlink and junction deployment
layouts are rejected.

The previous Klanker folder is moved to `.klanker-backups` under the KSP root,
outside `GameData` so KSP cannot load duplicate assemblies. To roll back, close
KSP and replace `GameData/Klanker` with the backup path printed by the task.

## Dependency sources

Builds do not read a local KSP installation. Versions and archive checksums are
pinned in the build scripts and central NuGet configuration:

- [kRPC's KSP library archive](https://github.com/krpc/ksp-lib) supplies stripped
  KSP 1.12.5 definitions, for compilation only.
- MechJeb release **2.14.3.0** is fetched by `scripts/bootstrap.ts`. Its internal
  KSP assembly identity is **2.5.0**, which is what Klanker's dependency attribute
  must request. The API identity is not the release version.
- ClearScript **7.5.1.1** comes from NuGet, including V8, ICU data, and native
  libraries for Windows, Linux, and macOS x64.
- `scripts/mono-runtime.ts` fills gaps in KSP's stripped framework libraries
  using executable Mono DLLs from the sources below. Microsoft's .NET reference
  pack is only for compilation and must never be shipped as runtime code.

The [UnityMono 2019.4.18 archive](https://unity.bepinex.dev/) supplies
`System.Numerics`, `System.Xml.Linq`, `System.Runtime.Serialization`, and
`System.Data`. The remaining dependencies—`Microsoft.CSharp`,
`System.ComponentModel.Composition`, `System.ServiceModel.Internals`,
`System.Transactions`, and `System.EnterpriseServices`—come from
[Debian's Mono packages](https://deb.debian.org/debian/pool/main/m/mono/), pinned
to `6.8.0.105+dfsg-3.3+deb12u1`.

These are managed libraries, not an installation of Debian, BepInEx, or another
Mono runtime. Only selected DLLs are copied, with upstream license notices.
KSP's `mscorlib`, `System`, `System.Core`, and Unity assemblies are not replaced.

Managed DLLs go in `Plugins`. Native V8 libraries go in `Plugins/PluginData`,
which the addon supplies to ClearScript as an auxiliary search path. Keep this
layout: KSP otherwise tries to load the Windows native DLL as a managed assembly.

## V8 startup benchmark

After a Release build/test, run:

~~~sh
dotnet tests/Klanker.Smoke/bin/Release/net9.0/Klanker.Smoke.dll build/GameData/Klanker/Plugins --benchmark
~~~

On Windows, the corresponding `net472/Klanker.Smoke.exe` accepts the same
arguments. This reports cold standalone startup, scene-host warmup, and
12-sample warm medians for creation plus first tick with standalone versus
shared runtimes. The comparison exercises real V8 but uses small KSP fixtures,
not Unity Mono. Warmup is measured after the standalone trials, so that number
does not represent a cold scene startup.

On this Windows machine, the 2026-09-09 run measured approximately 1.9 ms
standalone versus 1.0 ms shared warm medians on both desktop .NET targets.
The first cold standalone sample was about 86 ms on .NET 9 and 165 ms on
.NET Framework. These are diagnostic samples, not guaranteed KSP timings.
KSP logs its actual scene initialization as `Scene V8 runtime warmed in ... ms`.

Runtime tests cover separate globals/modules/storage, failed initialization,
watchdog recovery across contexts, and ownership/disposal. The shared runtime
is scene-scoped, not a background-thread execution service.

## Making a tester package

Run `pnpm make package`. This always builds and tests Release, then creates
`build/releases/Klanker-<version>-<base-commit>-<source-fingerprint>.zip` and
a matching `.zip.sha256` file. Explicit Debug packaging is rejected.

The ZIP contains the installable GameData folder, setup instructions, docs,
licenses/notices, a file-hash manifest, and `Klanker-source.zip`. KSP,
ModuleManager, and MechJeb are not bundled; testers install those separately.

The source archive contains the actual working-tree build inputs, including
uncommitted changes, rather than silently archiving an older commit. The
manifest records whether the tree was dirty, its base commit, and its source
fingerprint. Local installation config, caches, and generated files are excluded.
If source inputs change during the build/tests, packaging stops; rerun it.
An existing identically named output is only reused if its bytes match.
This task creates local artifacts; it does not commit, push, or publish a release.

## Checks and their limits

Every build checks packaged assembly-reference names against the downloaded KSP
definitions and bundled libraries, without using the desktop GAC to fill gaps.
It also checks MechJeb's KSP dependency identity and rejects reference-only DLLs
or native DLLs exposed to KSP's assembly scan.

The test task exercises deliberately broken packages, safe deployment and worker
preservation, and real V8 execution. Worker tests cover live reads, buffered writes,
exceptions, invalid controls, synchronous-only handlers, watchdog interruption,
and runtime recreation. They run on .NET 9 and, on Windows, .NET Framework, with
an outer process timeout. Part-computer tests also compile the real module and
coordinator against host fixtures to check save/load, copying, standby, faults,
control-point handoffs, and callback cleanup. View tests check the packaged
`.d.ts` against annotated C# members, types, and writability, and exercise the
actual ClearScript bindings, lifetime guards, and log truncation/rate warnings.
GitHub CI is currently disabled;
run these checks locally.

These checks cannot prove every type, method, or native ABI works in Unity Mono.
See the [README](../README.md#what-has-been-tested) for in-game validation status
and the [worker guide](workers.md#examples-and-fault-tests) for manual fault tests.

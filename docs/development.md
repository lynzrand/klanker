# Development

Klanker targets `net472` and uses the latest stable C# language version supported
by the SDK selected in `global.json`. Modern syntax is welcome; the APIs still
need to work in KSP's Unity/Mono runtime.

## Build tasks

Build tooling is JavaScript, run by [Hereby](https://github.com/jakebailey/hereby)
through `pnpm make`. No system `make` or PowerShell scripts are needed.

```sh
pnpm make build --configuration Release  # Produce build/GameData/Klanker
pnpm make test --configuration Release   # Build, validate, and run smoke tests
pnpm tasks                              # List all tasks
```

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
- MechJeb release **2.14.3.0** is fetched by `scripts/bootstrap.mjs`. Its internal
  KSP assembly identity is **2.5.0**, which is what Klanker's dependency attribute
  must request. The API identity is not the release version.
- ClearScript **7.5.1.1** comes from NuGet, including V8, ICU data, and native
  libraries for Windows, Linux, and macOS x64.
- `scripts/mono-runtime.mjs` fills gaps in KSP's stripped framework libraries
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

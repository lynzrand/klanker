# Klanker

**Klanker** is a piece of suspiciously modern flight software, intended for you
to manage your spacecrafts like serverless workers.

The design proposal lives in
[`docs/Klanker Proposal v2.md`](docs/Klanker%20Proposal%20v2.md), but its
runtime and gameplay behavior are intentionally not implemented yet.

## Build

Requirements:

- Node.js 22 or newer
- pnpm
- .NET SDK 9.0+

```sh
pnpm install
pnpm build
```

[Hereby](https://github.com/jakebailey/hereby) runs the tasks defined in
`Herebyfile.mjs`: `bootstrap` → `compile` → `build`. The final build task
assembles the native V8 libraries and license notices into `GameData`.

```sh
pnpm tasks                            # List available tasks
pnpm build --configuration Release    # Build a Release package
pnpm make bootstrap                   # Fetch definitions only
pnpm make build --configuration Release
pnpm make                             # Run the default build task
```

Pass task names before `--configuration`. Multiple requested tasks share their
dependencies, which Hereby runs once per invocation. Build operations use Node
APIs and invoke dotnet directly, without shell-specific build scripts.

The first build downloads stripped KSP 1.12.5 reference assemblies from
[`krpc/ksp-lib`](https://github.com/krpc/ksp-lib). The source revision and
archive checksum are pinned by `scripts/bootstrap.mjs`. The same bootstrap
downloads the exact MechJeb `2.14.3.0` release and references `MechJeb2.dll`
for compilation. Newer MechJeb versions are deliberately not used.

ClearScript `7.5.1.1` is pinned as separate V8, ICU data, and native runtime
packages for KSP's Windows x64, Linux x64, and macOS x64 targets. Windows-only
JScript/VBScript support and native targets that KSP does not ship for are not
included. The generated `GameData` tree also carries the upstream ClearScript
and V8 license notices.

Downloaded dependencies are cached under `.cache/`; the build never reads a
local KSP installation. The resulting KSP `GameData` layout is written to
`build/GameData`.

The plugin targets .NET Framework 4.7.2 (`net472`) for KSP compatibility while
using the latest stable C# language version supported by the pinned .NET 9 SDK,
nullable reference types, and current recommended .NET analyzers. The runtime
target still governs which library APIs are available inside KSP.

## License

MPL 2.0

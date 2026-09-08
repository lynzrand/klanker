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

The first build downloads stripped KSP 1.12.5 reference assemblies from
[`krpc/ksp-lib`](https://github.com/krpc/ksp-lib). The source revision and
archive checksum are pinned by `scripts/bootstrap.mjs`. The same bootstrap
downloads the exact MechJeb `2.14.3.0` release and references `MechJeb2.dll`
for compilation. Newer MechJeb versions are deliberately not used.

Downloaded dependencies are cached under `.cache/`; the build never reads a
local KSP installation. The resulting KSP `GameData` layout is written to
`build/GameData`.

The plugin targets .NET Framework 4.7.2 (`net472`) for KSP compatibility while
using the latest stable C# language version supported by the pinned .NET 9 SDK,
nullable reference types, and current recommended .NET analyzers. The runtime
target still governs which library APIs are available inside KSP.

## License

MPL 2.0

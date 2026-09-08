# Runtime packaging

The build remains independent of a local KSP installation. `net472` reference
assemblies are sufficient for compilation but cannot fill gaps in the game's
stripped Unity/Mono runtime. Do not deploy reference-pack or kRPC stripped DLLs.

`scripts/mono-runtime.mjs` downloads checksum-pinned executable class libraries:

- UnityMono **2019.4.18**, matching KSP 1.12.5's Unity version, from the
  [BepInEx Unity core-library archive](https://unity.bepinex.dev/):
  `System.Numerics`, `System.Xml.Linq`, `System.Runtime.Serialization`, `System.Data`.
- Mono **6.8.0.105+dfsg-3.3+deb12u1** managed packages from
  [Debian's Mono archive](https://deb.debian.org/debian/pool/main/m/mono/):
  `Microsoft.CSharp`, `System.ComponentModel.Composition`,
  `System.ServiceModel.Internals`, `System.Transactions`, `System.EnterpriseServices`.
  These supply the binder and remaining transitive assembly references. The
  packages contain platform-independent managed IL; Debian itself, BepInEx, and
  the standalone Mono runtime are **not** installed or bundled.

Only allowlisted DLLs are copied. KSP's `mscorlib`, `System`, `System.Core`, and
Unity DLLs are never replaced. Upstream Mono notices and Debian copyright records
are packaged in `Licenses`. A portable JS/WASM XZ decoder reads the small Debian
archives; no PowerShell, apt, system xz, or platform-specific extraction tool is
required. Cached downloads are hash-checked on every build.

Managed DLLs live in `GameData/Klanker/Plugins`. The Windows/Linux/macOS x64 native
V8 binaries live in `Plugins/PluginData`, outside KSP's normal assembly scan.
The addon sets ClearScript's `HostSettings.AuxiliarySearchPath` to that directory
before creating an engine. Do not flatten it: the Windows native `.dll` is not a
managed assembly. Deployments replace the entire Plugins subtree, including this
native subdirectory, while preserving edited workers.

MechJeb stays pinned to release **2.14.3.0**. Its KSPAssembly identity is **2.5.0**,
which is the value required by Klanker's KSPAssemblyDependency attribute. This
attribute is declared early in MSBuild evaluation: KSPBuildTools' late generation
can otherwise leave a stale incremental assembly-info file after metadata edits.

Every build runs the metadata-only `Klanker.PackageCheck` gate before deployment.
It checks assembly-name resolution without falling back to the desktop GAC,
MechJeb's KSP API identity, reference-only framework DLLs, and native DLLs exposed
to the assembly scanner. Negative tests exercise missing dependencies,
reference-assembly substitution, and native-library misplacement. Desktop V8
smoke tests use the packaged native directory on .NET 9 and Windows .NET Framework.

These checks do not prove all type/member or native ABI compatibility with Unity
Mono. In-game flight testing is still required on each supported operating system;
cross-platform packaging does not by itself mean cross-platform runtime testing
has passed. This remains a PoC, not a validated release.

# Design notes

This is the direction we want to explore, not the API shipped by the PoC.
The current implementation is documented in [Writing workers](workers.md).
These notes condense the [original design proposal](proposal.md), which is
retained in full for reference.

## Flight software as workers

The aim is to manage onboard flight software as replaceable JavaScript workers.
A command pod or probe core would host a persistent **actor**: a software identity
with an alias, deployment, and saved state. V8 runtimes would be disposable.
Replacing a script or recreating its runtime should not erase the actor's identity.

An actor belongs to a part, not a vessel. After docking or separation, it would
keep its identity and resolve its new vessel context. Stable KSP part identifiers
would anchor this mapping; human-friendly aliases and tags would only be selectors.

Initially, only the actor at the active control point would receive flight-control
authority. Other actors could retain their state and deployments without running
high-frequency handlers. Messaging could come later, without shared JavaScript
memory or special rules to merge state on docking.

## Execution and control

The PoC establishes the basic execution model: synchronous `flightTick` handlers
in KSP's normal flight-control path, live reads, and buffered control writes.
Reading a property after writing it sees the buffered value. A failed invocation
discards its writes and releases control; recovery requires an explicit reload.

The current vessel API uses purpose-built C# views exposed through ClearScript.
Getters read a privately bound KSP vessel directly. Control setters validate and
store nullable pending values in the control view; successful execution applies
only values that were written. A shared tick binding is cleared in `finally`,
along with all pending controls. There is no string-key property dispatcher.
Only annotated view members are exposed, with reflection and extension methods
disabled. The script-facing contract lives in `lib/klanker.d.ts`.

The scene addon owns and warms one ClearScript `V8Runtime`. Worker creation uses
fresh engine contexts within that runtime, avoiding a new isolate for every
assignment, validation, or restart. Globals and JS storage objects are separate;
the runtime heap and execution scheduling are shared. The addon checkpoints and
releases its active worker before disposing the remaining contexts and runtime
at scene teardown. Nothing persists across scenes except part-owned save data.

Future part actions, such as staging or activating an engine, should use the same
buffering model. Their validation and commit behavior still need careful design:
an action that has already changed KSP cannot simply be undone like a number in
a buffer.

A future background executor could handle trajectory planning or expensive
analysis. It should apply the latest useful result rather than queue outdated
physics frames. Same-tick flight control remains the synchronous executor's job.

## Persistence and deployment

Durable state should be ordinary structured data owned by the actor, not a saved
V8 heap. Runtime recreation would bind the actor's state and current vessel before
resuming event delivery. Code caches would be disposable performance aids, not
save-game data.

Deployment now bundles and validates a replacement before it reaches the game,
then constructs the replacement worker before releasing the old one. A failed
replacement leaves the old worker intact. The CLI can list actors, deploy and
control workers, follow logs, and inspect or reset saved state through the
token-guarded loopback bridge. Deployment revisions, source hashes, and explicit
state migrations are still absent.

## Parts and tags

The planned part API should reuse existing name tags instead of inventing a
Klanker-only tagging module. The references examined for the PoC were
[kOS's name tags](https://ksp-kos.github.io/KOS/general/nametag.html),
[kRPC's `Part.Tag`](https://github.com/krpc/krpc/blob/main/service/SpaceCenter/src/Services/Parts/Part.cs),
and [KSPCommunityPartModules' `ModuleNameTag`](https://github.com/KSPModdingLibs/KSPCommunityPartModules/blob/main/Source/Modules/ModuleNameTag.cs).

Compatibility should recognize legacy `KOSNameTag.nameTag` and shared
`ModuleNameTag.nameTag`, leaving editing and persistence to the installed provider.
Tags need not be unique, especially on symmetry copies. A `withTag` query should
return a list; a singular lookup should reject ambiguity. Neither replaces stable
part identity, and references to destroyed parts should fail explicitly.

## Remote access and integrations

Embedded workers and future RPC clients should share one logical spacecraft API.
Read access and permission to change a vessel would be separate capabilities.
Telemetry subscriptions could sample that API at appropriate rates rather than
introduce another vessel model. Remote continuous controls would need latest-value
semantics; discrete commands would need identities and deduplication.

Specialist algorithms should stay in specialist mods. MechJeb is the first likely
integration, through a deliberate adapter rather than automatic exposure of its
CLR objects.

[ArmorControl](https://github.com/Armo00/ArmorControl), made by a friend of the
project's author, inspired Klanker. It also served as a reference for
flight-control integration; no source was copied from it.

RemoteTech compatibility is another future concern. Loss or delay of ground
communication should affect deployments, commands, and telemetry, not stop code
already running onboard. RPC, external workers, multi-actor scheduling, and
unloaded-vessel simulation are all outside this PoC.

## Current boundary and next milestone

The original M0-M2 path is substantially present: command parts have stable
worker identities, aliases, saved deployments and JSON state; the active control
part owns flight authority; workers can be deployed, stopped, restarted and
observed through the CLI; and faults are sticky. Buffered continuous controls
and queued staging/engine actions commit only after a successful tick.

The implementation deliberately uses tick-scoped part wrappers: scripts persist
`part.id` and re-query with `parts.byId()` rather than retaining a stable wrapper
across topology changes. There are still no deployment revisions or hashes,
state migrations, actor mailboxes, background execution, remote spacecraft API
or telemetry subscriptions, multi-actor scheduling, RemoteTech behavior, or
unloaded-vessel simulation. MechJeb has a narrow experimental adapter rather
than the broader provider system from the proposal.

The immediate milestone is confidence rather than more surface area: complete
the in-game editor/save/load/control-handoff checklist, validate MechJeb in game,
and exercise the bundled Linux and macOS native libraries. After that, deployment
metadata and state migration are the smallest coherent additions to the actor
model; RPC and messaging remain separate future projects.

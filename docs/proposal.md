# Reference proposal

This is the original design proposal, retained for reference. It describes a
broader system than the current PoC; use [Writing workers](workers.md) for the
implemented API and [Design notes](design.md) for a shorter overview.

---

# Klanker

> Disclaimer: this proposal was written by an LLM.

> A suspiciously modern piece of flight software.
> Manage your spacecraft like web workers.

## 1. Overview

Klanker is a JavaScript flight automation runtime for Kerbal Space Program.

The central idea is to treat onboard flight software as deployable workers rather than as permanently running virtual machines. Scripts are hosted by command pods or probe cores, observe the spacecraft through a stable KSP-facing API, retain explicit durable state, and may be replaced while the game is running.

The execution model is intentionally closer to serverless workers than to kOS:

- code is deployable and replaceable;
- runtime instances are disposable;
- actor identity and persistent state survive runtime recreation;
- workers execute in response to simulation events;
- reads observe the live KSP state;
- writes are buffered and committed transactionally;
- local embedded workers and remote RPC clients share the same logical spacecraft API;
- authority to modify the spacecraft is capability-gated.

The initial implementation is expected to use V8 through ClearScript.

---

## 2. Core Object Model

Klanker separates hardware, actors, deployments, runtime instances, and vessels.

```text
Hardware
    ↓ hosts
Actor
    ↓ owns
State + Deployment
    ↓ instantiated as
Runtime
    ↓ observes / controls
Vessel
```

### Hardware

A Klanker-capable command pod or probe core hosts an actor.

The underlying KSP part provides the physical identity of the computer. A stable KSP part identifier is used to reconnect Klanker objects to the correct part after docking, undocking, scene changes, or runtime recreation.

### Actor

An actor is the persistent software identity associated with a Klanker-capable computer.

An actor survives:

- script replacement;
- V8 context or isolate recreation;
- vessel docking and undocking;
- vessel topology changes, as long as the owning part survives.

Actor identity is distinct from physical part identity.

Conceptually:

```text
Part
    physical KSP identity

Klanker actor
    actorId
    alias
    durable state
    deployment
```

Human-readable aliases may be assigned:

```text
guidance
booster
lander
payload
```

### Deployment

A deployment is the currently installed worker code for an actor.

Replacing a deployment does not replace the actor or its durable state.

```text
Actor
├── actorId
├── alias
├── durable state
└── deployment
    ├── code
    ├── source hash
    └── revision
```

### Runtime

A runtime is the disposable V8 execution environment used to execute the actor's current deployment.

Runtime lifetime is explicitly not part of the programming model.

> Heap lifetime is an implementation detail.

The host may destroy and recreate the runtime after a scene change, a deployment, a watchdog fault, or for implementation reasons.

### Vessel

A vessel is observed context, not software ownership.

An actor remains attached to its command pod or probe core. If that part separates into a new vessel, the actor remains the same while its current vessel context changes.

---

## 3. Execution Model

Klanker workers are event-driven.

The primary high-frequency event is `flightTick`, associated with the KSP physics control cycle.

A minimal worker may look like:

```js
export default {
  flightTick(ctx) {
    const { vessel } = ctx;

    if (vessel.orbit.apoapsis < 100_000) {
      vessel.control.throttle = 1;
    } else {
      vessel.control.throttle = 0;
    }
  },
};
```

The conceptual execution path is:

```text
KSP physics control cycle
    ↓
invoke active actor
    ↓
worker reads current KSP state
    ↓
worker stages mutations
    ↓
handler completes successfully
    ↓
commit mutations
    ↓
physics continues
```

The preferred integration point is the normal KSP flight-control path rather than an arbitrary independent `FixedUpdate` callback, so the script observes and contributes to one coherent physics control cycle.

---

## 4. Live Reads and Transactional Writes

Klanker does not require the entire vessel to be copied into an immutable snapshot before each local worker invocation.

For a synchronous local worker:

```text
read
    → current live KSP state

write
    → transaction buffer

successful handler completion
    → commit transaction
```

This gives scripts a natural object-oriented API without directly exposing raw CLR or Unity objects.

Example:

```js
const engine = vessel.parts.byTag("main-engine");

console.log(engine.thrust); // live read

engine.thrustLimiter = 0.8; // staged write
vessel.control.throttle = 1; // staged write
```

### Read-after-write

Buffered property writes should be visible to subsequent reads within the same handler.

```js
vessel.control.throttle = 0.7;
console.log(vessel.control.throttle); // 0.7
```

A getter therefore observes:

```text
transaction overlay
    ↓ if absent
live KSP state
```

### Discrete actions

One-shot operations are also staged:

```js
vessel.stage();
engine.activate();
port.undock();
```

They are executed only after the handler completes successfully.

If the worker throws or is terminated by the watchdog, all staged writes and actions from that invocation are discarded.

This gives each worker invocation an atomic mutation boundary.

---

## 5. Stable References and Part Identity

JavaScript-visible references must not depend on CLR object identity.

A `PartRef` represents a stable KSP part identity:

```text
PartRef
├── stable part ID
├── cached JS wrapper
└── optional cached KSP object resolution
```

The KSP object may be cached while the vessel topology remains unchanged.

After docking, undocking, staging, destruction, or another topology revision, the reference is resolved again from its stable identity.

Example:

```js
const engine = vessel.parts.byTag("main-engine");

engine.id;
engine.title;
engine.stage;
engine.thrust;
```

If the underlying part no longer exists, the reference becomes invalid and access should fail explicitly rather than silently producing stale data.

Human-facing queries may include:

```text
stable part ID
tag
part name
module
stage
```

Canonical machine identity remains independent of these selectors.

---

## 6. Unified Spacecraft API

Klanker exposes one logical spacecraft API rather than separating telemetry and control into unrelated interfaces.

The same object graph may contain both readable and writable properties:

```js
vessel.altitude;
vessel.orbit.apoapsis;

vessel.control.throttle = 0.8;
vessel.control.sas = true;

vessel.parts.byTag("antenna").deploy();
```

Whether a particular operation is permitted depends on the caller's capabilities.

Conceptually:

```text
read-only RPC client
    vessel.*                  read
    vessel.control.*          read only
    actions                   unavailable

inactive onboard actor
    vessel.*                  read
    vessel.control.*          read only

active onboard actor
    vessel.*                  read
    vessel.control.*          read/write
    actions                   available
```

The core rule is:

> Klanker exposes one logical read/write spacecraft API. Observation is generally available; mutation requires the appropriate capability.

---

## 7. Telemetry

Telemetry is not a separate world model.

It is an optimized way to observe the same spacecraft API from local tooling or remote RPC clients.

A client may subscribe to selected values:

```text
altitude
velocity
attitude
orbit.apoapsis
resources
```

Different groups may be sampled or transmitted at different frequencies.

Conceptually:

```text
flight state      high frequency
orbit             high frequency
resources         lower frequency
part structure    revision-based
expensive data    provider-specific
```

Telemetry remains available even when no onboard actor currently has flight authority.

This allows Klanker to act as both:

```text
spacecraft API / telemetry bus
+
onboard worker runtime
```

---

## 8. Active and Inactive Actors

Each Klanker-capable command pod or probe core may own its own actor.

The default high-frequency control model is:

```text
Vessel
├── Pod A
│   └── actor A    ACTIVE
├── Probe B
│   └── actor B    STANDBY
└── Probe C
    └── actor C    STANDBY
```

Only the actor associated with the active control point receives high-frequency flight authority.

Inactive actors retain:

- identity;
- durable state;
- deployment;
- mailbox.

They may participate in lower-frequency or explicit event handling in future versions.

The design is compatible with a broader actor model without requiring multi-actor scheduling in the MVP.

---

## 9. Actor Messaging

Multiple onboard actors may communicate through messages.

Conceptually:

```js
ctx.send("booster", {
  type: "arm",
});
```

Actors do not share JavaScript heap state.

Docking does not merge actors.

Undocking does not split actors.

Actors remain attached to their owning parts.

This avoids special state-merging semantics when vessel topology changes.

---

## 10. Persistent State

Durable state belongs to the actor, not to V8.

The JavaScript heap is ephemeral.

On runtime recreation:

```text
create runtime
→ load current deployment
→ bind actor
→ restore durable state
→ bind current vessel context
→ resume event delivery
```

Persistent state should use ordinary structured data rather than a serialized V8 heap or VM snapshot.

V8 startup snapshots or code caches may be used as implementation optimizations, but they are not save-game state.

---

## 11. Hot Deployment

Scripts are expected to be replaceable while the game is running.

Typical workflow:

```bash
klanker deploy ascent.js --to guidance
```

Conceptually:

```text
resolve actor
→ upload deployment
→ compile / validate
→ mark deployment ready
→ switch at a safe execution boundary
→ dispose old runtime
→ instantiate new runtime
→ restore actor state
→ start new deployment
```

Actor identity and durable state remain unchanged.

The lifecycle is therefore:

```text
actor identity    persistent
actor state       persistent
deployment        replaceable
runtime           disposable
```

A future deployment may provide explicit state migration logic.

A user may also explicitly reset state when deploying incompatible code.

---

## 12. Compilation and Deployment Lifecycle

Compilation should not occur unnecessarily inside the physics control path.

Deployment may perform parsing, module resolution, compilation, and code-cache generation in the background.

Conceptually:

```text
klanker deploy
    ↓
upload
    ↓
background compile / validate
    ↓
deployment ready
    ↓
atomic activation at safe boundary
```

Compiled V8 cache data may be stored outside the KSP save file and regenerated after cache invalidation or a V8 upgrade.

The save file should contain only persistent Klanker state and deployment metadata necessary to locate the installed code.

---

## 13. Watchdog and Fault Semantics

A flight worker must not be allowed to freeze KSP indefinitely.

Each high-frequency invocation is protected by a V8 watchdog.

If a handler exceeds the allowed execution time or encounters another fatal runtime condition:

```text
RUNNING
    ↓
FAULTED
```

The watchdog:

1. terminates the current V8 execution;
2. discards all staged mutations from that invocation;
3. releases the actor's injected flight control;
4. marks the actor as faulted;
5. stops invoking it on subsequent flight ticks;
6. emits an explicit visible warning.

A fault is sticky.

Klanker must not automatically retry a broken high-frequency handler every physics tick.

Recovery requires an explicit action:

```bash
klanker restart guidance
```

or:

```bash
klanker deploy ascent-fixed.js --to guidance
```

A watchdog fault may recreate the V8 runtime before execution resumes.

The default fault policy is to stop Klanker from injecting control and return authority to KSP/player/SAS rather than attempting to guess a safe vehicle state.

---

## 14. Local and Background Executors

The semantics of `flightTick` are tied to the KSP physics control cycle.

Where JavaScript executes is an implementation detail.

The initial executor should be synchronous:

```text
physics control cycle
→ execute V8
→ commit control
```

This gives the lowest latency and simplest semantics.

A future background executor may instead pipeline execution:

```text
tick N
    capture state
        ↓
background worker
    compute
        ↓
tick N+1
    apply latest completed result
```

Such an executor must use latest-value semantics and must not accumulate a backlog of obsolete physics frames.

Background execution is especially suitable for:

- trajectory planning;
- expensive analysis;
- inactive actors;
- unloaded vessels;
- telemetry processing.

It is not required for the MVP.

---

## 15. RPC Model

Klanker should expose the same logical spacecraft API remotely.

The remote API is not a separate feature model.

Conceptually:

```text
Domain API
├── Vessel
├── Orbit
├── Part
├── Control
├── Actor
└── providers

Execution frontends
├── Embedded V8
└── RPC
```

A remote client may therefore interact with Klanker in a style similar to an embedded worker:

```python
vessel = klanker.vessels.active

print(vessel.altitude)
vessel.control.throttle = 0.5
```

Capabilities determine whether the remote caller may write.

Telemetry-only clients simply receive read capability.

High-frequency telemetry may use subscriptions rather than repeated request/response calls.

---

## 16. Remote Workers

The architecture leaves room for external workers without making them part of the MVP.

Possible executors include:

```text
V8Executor
RpcExecutor
```

A remote worker may receive spacecraft state and return mutations through the same domain API semantics.

Remote execution does not need to promise same-tick control application.

Continuous control values should use latest-value semantics.

Discrete actions require explicit command identity and deduplication.

---

## 17. Command-Line Interface

The CLI is the primary deployment and development interface.

Initial conceptual commands:

```text
klanker ls
klanker deploy
klanker logs
klanker telemetry
klanker send
klanker restart
```

Examples:

```bash
klanker ls

klanker deploy ascent.js --to guidance

klanker logs guidance -f

klanker telemetry vessel:active

klanker send booster '{"type":"arm"}'

klanker restart guidance
```

A future development mode may watch files and automatically redeploy:

```bash
klanker dev ascent.js --to guidance
```

The CLI resolves human-readable selectors to stable actor identities before issuing operations.

---

## 18. Mod Integration

Klanker should not attempt to reimplement every specialist KSP subsystem.

The preferred model is:

```text
Klanker
    execution / orchestration

specialist mods
    specialist algorithms

providers
    stable Klanker-facing adapters
```

MechJeb is a natural example.

Klanker may provide a stable adapter exposing selected MechJeb capabilities such as:

- maneuver planning;
- maneuver execution;
- landing guidance;
- docking guidance;
- attitude control.

Conceptually:

```js
import mj from "klanker:mechjeb";
```

Klanker scripts can then orchestrate missions while leaving guidance and numerical algorithms to MechJeb.

Arbitrary automatic reflection over every installed mod is explicitly not a core goal.

Third-party integrations should instead be implemented as provider/adaptor assemblies.

---

## 19. RemoteTech Compatibility

Klanker's architecture naturally distinguishes onboard computation from ground communication.

Conceptually:

```text
Ground
    deployment
    mission commands
    telemetry requests
        ↓
communications system
        ↓
Onboard Klanker actor
        ↓
MechJeb / vessel control
```

Communication delay or loss should affect information crossing the ground-spacecraft boundary.

It should not prevent already-deployed onboard software from continuing to execute.

This makes autonomous missions a natural use case:

```text
deploy mission software at KSC
→ launch
→ lose telemetry / communication
→ onboard actors continue autonomously
→ reacquire communication later
```

RemoteTech integration is not part of the MVP, but the architecture should not preclude this model.

---

## 20. V8 / ClearScript

The preferred initial runtime stack is:

```text
KSP / Unity
    ↓
C# host
    ↓
ClearScript
    ↓
V8
```

V8 matches the design because it provides:

- mature JavaScript execution;
- isolate/context-based embedding;
- runtime interruption for watchdogs;
- compilation caching and startup snapshot facilities;
- a natural implementation model for disposable workers.

ClearScript provides the C# integration layer.

Klanker should nevertheless avoid exposing arbitrary C# objects directly to JavaScript. The public API should remain an explicitly designed spacecraft abstraction backed by stable references and transaction-aware property access.

---

## 21. MVP Scope

The MVP should prove that Klanker is useful as flight software, not merely that V8 can run inside KSP.

The minimum complete path is:

```text
Klanker-capable command pod
→ actor
→ deployed JavaScript
→ flightTick
→ live spacecraft reads
→ transactional control writes
→ watchdog
→ persistent actor state
→ hot redeployment
```

### MVP features

```text
one active vessel
one active actor with flight authority
PartModule-backed actor identity
actor alias
V8 / ClearScript runtime
flightTick event
basic Vessel / Orbit API
basic Control API
stable PartRef infrastructure
transactional mutation
durable structured state
watchdog + sticky fault
restart
hot deployment
basic logs
minimal CLI
```

### Explicitly deferred

```text
background executor
multi-actor scheduling
actor messaging beyond basic infrastructure
external flight workers
full remote write API
MechJeb integration
RemoteTech integration
full part/module API
in-game IDE/editor
CPU-performance gameplay limits
unloaded-vessel simulation
```

---

## 22. Initial Milestones

### M0 — Does V8 live?

```text
KSP loads Klanker
→ create V8 runtime
→ evaluate JavaScript
→ dispose / recreate runtime
→ survive scene changes
→ exit game cleanly
```

### M1 — Does it fly?

```text
active flight control cycle
→ invoke flightTick
→ live reads
→ transactional throttle / attitude writes
→ watchdog
→ fault handling
```

A JavaScript controller should be able to complete a simple flight-control task.

### M2 — Is it Klanker?

```text
KlankerComputer PartModule
+ actor identity
+ durable state
+ alias
+ klanker deploy
+ hot replacement
+ logs
+ restart
```

At this point Klanker is an actual deployable onboard software platform rather than an embedded JavaScript experiment.

---

## 23. Design Summary

Klanker treats flight software as deployable workers hosted by persistent onboard actors.

Its core model is:

```text
hardware anchors actors
actors own state
deployments own code
runtimes are disposable
vessels provide live context
reads observe live state
writes commit transactionally
capabilities govern authority
```

Klanker therefore occupies a different space from both kOS and kRPC.

kOS primarily provides an onboard virtual computer running a custom scripting language.

kRPC primarily exposes KSP to external programs.

Klanker aims to provide a modern onboard software platform with JavaScript, live spacecraft APIs, transactional control, hot deployment, persistent actor identity, RPC access, and a clean path to integrating specialist systems such as MechJeb.

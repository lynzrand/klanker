/** Klanker worker API. Live vessel access is only valid during flightTick. */
declare namespace Klanker {
    type JsonValue = null | boolean | number | string | JsonValue[] | Storage;
    /** Mutable JSON object. Values must be finite/JSON-compatible at checkpoint time. */
    interface Storage {
        [key: string]: JsonValue;
    }
    interface Worker {
        /** Synchronous: promises/async handlers are rejected. */
        flightTick(context: FlightContext): void;
    }

    interface FlightContext {
        readonly vessel: VesselView;
        /** Experimental MechJeb bridge; requires MechJeb on the vessel. */
        readonly mechjeb: MechJebContext;
        /** Per-part state: root cannot be replaced, but its properties can be edited/deleted. */
        readonly storage: Storage;
        /** KSP universal time, simulation seconds. Only readable inside flightTick. */
        readonly universalTime: number;
        /** Current physics timestep in simulation seconds, not wall time. */
        readonly deltaTime: number;
    }

    /** A live, read-only C# view, not a plain JS record or raw KSP Vessel. */
    interface VesselView {
        /** KSP vessel UUID; distinct from the command part's worker identity. */
        readonly id: string;
        readonly name: string;
        /** KSP enum name, such as PRELAUNCH, FLYING, ORBITING, or ESCAPING. */
        readonly situation: string;
        /** Current total vessel mass, kilograms. */
        readonly mass: number;
        /** Degrees north. */
        readonly latitude: number;
        /** KSP longitude in degrees; not normalized by Klanker. */
        readonly longitude: number;
        /** Metres above the body's sea-level reference radius. */
        readonly altitude: number;
        /** KSP terrain elevation in metres above the reference radius. May be negative. */
        readonly terrainAltitude: number;
        /** altitude - terrainAltitude, metres; not a water-surface radar altitude. */
        readonly heightAboveTerrain: number;
        /** Metres/second, positive away from the body. */
        readonly verticalSpeed: number;
        /** Surface-relative speed magnitude, metres/second. */
        readonly surfaceSpeed: number;
        /** Horizontal surface-relative speed, metres/second. */
        readonly horizontalSpeed: number;
        /** Body-relative orbital velocity magnitude, metres/second. */
        readonly orbitalSpeed: number;
        readonly orbit: OrbitView;
        readonly body: BodyView;
        readonly velocity: VelocityView;
        readonly resources: ResourcesView;
        readonly parts: PartsView;
        /** The only writable vessel properties. */
        readonly control: ControlView;
        readonly attitude: AttitudeView;
        /**
         * Activates the next stage. Queued, not buffered, and run only after the
         * handler returns successfully; a failed tick does not stage.
         */
        stage(): void;
    }

    interface OrbitView {
        /** Apoapsis height above the reference radius, metres; KSP value on open trajectories. */
        readonly apoapsis: number;
        /** Periapsis height above the reference radius, metres. May be negative. */
        readonly periapsis: number;
        /** Seconds; NaN for eccentricity >= 1. */
        readonly timeToApoapsis: number;
        /** KSP time to periapsis, seconds; may be negative after passage on open trajectories. */
        readonly timeToPeriapsis: number;
        /** Inclination to the body's equatorial plane, degrees. */
        readonly inclination: number;
        readonly eccentricity: number;
        /** Metres; signed KSP orbital element. */
        readonly semiMajorAxis: number;
        /** Seconds; NaN for eccentricity >= 1. */
        readonly period: number;
    }

    interface BodyView {
        /** KSP bodyName, not a localized display label. */
        readonly name: string;
        /** Sea-level reference radius, metres. */
        readonly radius: number;
        /** Standard gravitational parameter, metres cubed / second squared. */
        readonly gravitationalParameter: number;
    }

    interface VelocityView {
        /** Surface-relative velocity in KSP's current Unity world axes, metres/second. */
        readonly surface: VectorView;
        /** Body-relative orbital velocity in the same Unity world axes, metres/second. */
        readonly orbital: VectorView;
        /** Surface-relative velocity in the active control part's local axes, m/s. */
        readonly localSurface: LocalVectorView;
    }

    interface AttitudeView {
        /** Radially outward unit direction in control-part local axes. */
        readonly up: LocalVectorView;
        /** North/east tangent unit directions; ill-defined at the geographical poles. */
        readonly north: LocalVectorView;
        readonly east: LocalVectorView;
        /** Root rigidbody angular velocity expressed in control-part local axes, rad/s. */
        readonly angularVelocity: LocalVectorView;
    }

    /**
     * Active Control from Here frame: x=right, y=nose, z=belly.
     * Angular velocity uses Unity's geometric rotation convention, not control
     * input signs. Values are live and require an active flightTick.
     */
    interface LocalVectorView {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }

    /**
     * Live components, not a Unity vector object. World axes are not vessel-local
     * or north/east/up; do not assume a persistent inertial frame across ticks.
     */
    interface VectorView {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }

    interface ResourcesView {
        /**
         * Detached totals over all current vessel parts, including locked tanks.
         * Uses a case-sensitive resource definition name, e.g. "ElectricCharge".
         * Missing resources return zero amount and capacity, not null.
         * Does not model crossfeed, engine accessibility, or staging.
         */
        get(name: string): ResourceTotals;
    }

    interface ResourceTotals {
        readonly name: string;
        /** Resource units, not kilograms or litres. */
        readonly amount: number;
        /** Resource units. */
        readonly capacity: number;
    }

    /**
     * Live queries over the current vessel's parts. References are valid for the
     * tick that produced them; persist `part.id` and re-query with `byId` to
     * follow a part across ticks, staging, docking, or save/load.
     */
    interface PartsView {
        readonly count: number;
        /** Index into the live part list; throws if out of range. */
        get(index: number): PartRef;
        /** Matches the part config name (AvailablePart.name), not the title. */
        byName(name: string): PartList;
        /** Matches a name tag from ModuleNameTag or KOSNameTag, if installed. */
        byTag(tag: string): PartList;
        /** Matches a PartModule ClassName or moduleName. */
        withModule(module: string): PartList;
        /** Resolves a persistentId; throws if no part on the vessel has it. */
        byId(id: string): PartRef;
    }

    interface PartList {
        readonly count: number;
        get(index: number): PartRef;
    }

    interface PartRef {
        /** Stable KSP persistentId as a string. */
        readonly id: string;
        /** Part config name. */
        readonly name: string;
        /** Display title. */
        readonly title: string;
        /** KSP inverseStage; lower numbers fire earlier. */
        readonly stage: number;
        /** Name tags from ModuleNameTag or KOSNameTag, de-duplicated. */
        readonly tags: string[];
        readonly resources: PartResourcesView;
        readonly engines: EnginesView;
    }

    /** Totals over a single part, matching vessel.resources.get semantics. */
    interface PartResourcesView {
        get(name: string): ResourceTotals;
    }

    interface EnginesView {
        readonly count: number;
        get(index: number): EngineView;
    }

    interface EngineView {
        readonly name: string;
        /** Kilonewtons, the engine's configured maximum. */
        readonly maxThrust: number;
        /** Kilonewtons currently produced. */
        readonly thrust: number;
        readonly ignited: boolean;
        readonly operational: boolean;
        /**
         * 0..1 thrust limiter. Buffered: reads see the pending value, and a
         * failed tick leaves the engine unchanged.
         */
        thrustLimiter: number;
        /** Queued discrete actions, run only after a successful tick. */
        activate(): void;
        shutdown(): void;
    }

    /**
     * Experimental MechJeb bridge. Every member throws when MechJeb is not on the
     * vessel, so check `available` first. The adapter reaches MechJeb through
     * reflection, so a new MechJeb release may require adjusting member names.
     */
    interface MechJebContext {
        readonly available: boolean;
        readonly attitude: MechJebAttitudeView;
        readonly smartAss: MechJebSmartAssView;
        readonly node: MechJebNodeView;
        readonly landing: MechJebLandingView;
    }

    interface MechJebAttitudeView {
        /** Enables/disables MechJeb's attitude controller directly. */
        enabled: boolean;
    }

    interface MechJebSmartAssView {
        /**
         * Point at a SmartASS direction: prograde, retrograde, normal,
         * antinormal, radial, antiradial, target, antitarget, relative,
         * antirelative, surfacePrograde, surfaceRetrograde, horizontal,
         * vertical, killRot, node, surface or off.
         */
        engage(mode: string): void;
        disable(): void;
    }

    interface MechJebNodeView {
        execute(): void;
        abort(): void;
    }

    interface MechJebLandingView {
        start(): void;
        stop(): void;
    }

    interface ControlView {
        /** Finite number, 0..1. Reads return the pending value if written this tick. */
        throttle: number;
        /** Finite number, -1..1. */
        pitch: number;
        /** Finite number, -1..1. */
        yaw: number;
        /** Finite number, -1..1. */
        roll: number;
        /**
         * Action-group toggles. Applied on successful handler completion, so a
         * failed tick leaves the group unchanged. Reads return the pending value
         * if written this tick, otherwise the live KSP group state.
         */
        sas: boolean;
        rcs: boolean;
        gear: boolean;
        brakes: boolean;
        lights: boolean;
        abort: boolean;
        /** RCS translation axes, -1..1, buffered like the rotation axes. */
        readonly translation: TranslationView;
    }

    interface TranslationView {
        /** Finite number, -1..1. Reads return the pending value if written this tick. */
        x: number;
        y: number;
        z: number;
    }
}

// Compatible with editors that already load the standard Console declaration.
interface Console {
    /**
     * Writes to KSP.log with the worker identity and script filename.
     * Works during module initialization (including assignment validation).
     * At most 32 arguments / 2048 UTF-16 code units per message and 20 messages
     * per one-second runtime window. Truncation and rate limiting emit warnings,
     * each at most once per window. Logs are not rolled back on worker faults.
     */
    log(...values: unknown[]): void;
}
declare var console: Console;

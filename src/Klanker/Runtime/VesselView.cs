using System;
using System.Collections.Generic;
using Microsoft.ClearScript;

namespace Klanker.Runtime;

// Live KSP references are private, bound for one tick, and cleared in finally.
internal sealed class TickBinding
{
    private Vessel? vessel;
    private FlightCtrlState? controls;
    private readonly List<Action> pendingActions = new();
    private readonly Dictionary<ModuleEngines, double> pendingLimiters = new();
    internal Vessel Vessel => vessel ?? throw new InvalidOperationException("Vessel access requires flightTick.");
    internal FlightCtrlState Controls => controls ?? throw new InvalidOperationException("Control access requires flightTick.");
    internal void Bind(Vessel activeVessel, FlightCtrlState activeControls)
    {
        if (vessel != null) throw new InvalidOperationException("A flightTick is already active.");
        if (activeVessel == null) throw new ArgumentNullException(nameof(activeVessel));
        if (activeControls == null) throw new ArgumentNullException(nameof(activeControls));
        vessel = activeVessel;
        controls = activeControls;
    }
    // Discrete actions cannot be rolled back like buffered values, so they run
    // only after the handler returns and its buffered controls are committed.
    internal void Queue(Action action)
    {
        _ = Vessel;
        pendingActions.Add(action);
    }
    // Buffered module writes (e.g. thrust limiter) are applied on commit and are
    // visible to reads within the same tick, unlike queued discrete actions.
    internal double? GetPendingLimiter(ModuleEngines engine) =>
        pendingLimiters.TryGetValue(engine, out var value) ? value : null;
    internal void SetPendingLimiter(ModuleEngines engine, double fraction)
    {
        _ = Vessel;
        pendingLimiters[engine] = fraction;
    }
    internal void RunActions()
    {
        foreach (var pair in pendingLimiters) pair.Key.thrustPercentage = (float)(pair.Value * 100.0);
        pendingLimiters.Clear();
        foreach (var action in pendingActions) action();
        pendingActions.Clear();
    }
    internal void Clear() { vessel = null; controls = null; pendingActions.Clear(); pendingLimiters.Clear(); }
}

public sealed class FlightContext
{
    private readonly TickBinding binding = new();
    internal FlightContext()
    {
        Vessel = new VesselView(binding);
        MechJeb = new MechJebContext(binding);
    }
    internal void Begin(Vessel vessel, FlightCtrlState controls)
    {
        binding.Bind(vessel, controls);
        Vessel.Control.Clear();
    }
    internal void Commit()
    {
        Vessel.Control.Apply();
        binding.RunActions();
    }
    internal void End() { Vessel.Control.Clear(); binding.Clear(); }
    [ScriptMember("vessel")] public VesselView Vessel { get; }
    [ScriptMember("mechjeb")] public MechJebContext MechJeb { get; }
    private ScriptObject storage = null!;
    internal void BindStorage(ScriptObject value) => storage = value;
    [ScriptMember("storage")] public ScriptObject Storage => storage;
    [ScriptMember("universalTime")] public double UniversalTime { get { _ = binding.Vessel; return Planetarium.GetUniversalTime(); } }
    [ScriptMember("deltaTime")] public double DeltaTime { get { _ = binding.Vessel; return TimeWarp.fixedDeltaTime; } }
}

public sealed class VesselView
{
    private readonly TickBinding binding;
    internal VesselView(TickBinding binding)
    {
        this.binding = binding;
        Orbit = new OrbitView(binding);
        Body = new BodyView(binding);
        Velocity = new VelocityView(binding);
        Resources = new ResourcesView(binding);
        Parts = new PartsView(binding);
        Control = new ControlView(binding);
        Attitude = new AttitudeView(binding);
    }
    [ScriptMember("id")] public string Id => binding.Vessel.id.ToString("D");
    [ScriptMember("name")] public string Name => binding.Vessel.vesselName;
    [ScriptMember("situation")] public string Situation => binding.Vessel.situation.ToString();
    [ScriptMember("mass")] public double Mass => (double)binding.Vessel.GetTotalMass() * 1000;
    [ScriptMember("latitude")] public double Latitude => binding.Vessel.latitude;
    [ScriptMember("longitude")] public double Longitude => binding.Vessel.longitude;
    [ScriptMember("altitude")] public double Altitude => binding.Vessel.altitude;
    [ScriptMember("terrainAltitude")] public double TerrainAltitude => binding.Vessel.terrainAltitude;
    [ScriptMember("heightAboveTerrain")] public double HeightAboveTerrain => binding.Vessel.altitude - binding.Vessel.terrainAltitude;
    [ScriptMember("verticalSpeed")] public double VerticalSpeed => binding.Vessel.verticalSpeed;
    [ScriptMember("surfaceSpeed")] public double SurfaceSpeed => binding.Vessel.srfSpeed;
    [ScriptMember("horizontalSpeed")] public double HorizontalSpeed => binding.Vessel.horizontalSrfSpeed;
    [ScriptMember("orbitalSpeed")] public double OrbitalSpeed => binding.Vessel.obt_velocity.magnitude;
    [ScriptMember("orbit")] public OrbitView Orbit { get; }
    [ScriptMember("body")] public BodyView Body { get; }
    [ScriptMember("velocity")] public VelocityView Velocity { get; }
    [ScriptMember("resources")] public ResourcesView Resources { get; }
    [ScriptMember("parts")] public PartsView Parts { get; }
    [ScriptMember("control")] public ControlView Control { get; }
    [ScriptMember("attitude")] public AttitudeView Attitude { get; }
    // Queued, not buffered: the next stage fires only after a successful tick.
    [ScriptMember("stage")] public void Stage() => binding.Queue(() => KSP.UI.Screens.StageManager.ActivateNextStage());
}

public sealed class OrbitView
{
    private readonly TickBinding binding;
    internal OrbitView(TickBinding binding)
    {
        this.binding = binding;
    }
    [ScriptMember("apoapsis")] public double Apoapsis => binding.Vessel.orbit.ApA;
    [ScriptMember("periapsis")] public double Periapsis => binding.Vessel.orbit.PeA;
    [ScriptMember("timeToApoapsis")] public double TimeToApoapsis => binding.Vessel.orbit.eccentricity < 1 ? binding.Vessel.orbit.timeToAp : double.NaN;
    [ScriptMember("timeToPeriapsis")] public double TimeToPeriapsis => binding.Vessel.orbit.timeToPe;
    [ScriptMember("inclination")] public double Inclination => binding.Vessel.orbit.inclination;
    [ScriptMember("eccentricity")] public double Eccentricity => binding.Vessel.orbit.eccentricity;
    [ScriptMember("semiMajorAxis")] public double SemiMajorAxis => binding.Vessel.orbit.semiMajorAxis;
    [ScriptMember("period")] public double Period => binding.Vessel.orbit.eccentricity < 1 ? binding.Vessel.orbit.period : double.NaN;
}

public sealed class BodyView
{
    private readonly TickBinding binding;
    internal BodyView(TickBinding binding)
    {
        this.binding = binding;
    }
    [ScriptMember("name")] public string Name => binding.Vessel.mainBody.bodyName;
    [ScriptMember("radius")] public double Radius => binding.Vessel.mainBody.Radius;
    [ScriptMember("gravitationalParameter")] public double GravitationalParameter => binding.Vessel.mainBody.gravParameter;
}

public sealed class VelocityView
{
    internal VelocityView(TickBinding binding)
    {
        Surface = new VectorView(binding, true);
        Orbital = new VectorView(binding, false);
        LocalSurface = new LocalVectorView(binding, LocalVectorKind.SurfaceVelocity);
    }
    [ScriptMember("surface")] public VectorView Surface { get; }
    [ScriptMember("orbital")] public VectorView Orbital { get; }
    [ScriptMember("localSurface")] public LocalVectorView LocalSurface { get; }
}

public sealed class AttitudeView
{
    internal AttitudeView(TickBinding binding)
    {
        Up = new LocalVectorView(binding, LocalVectorKind.Up);
        North = new LocalVectorView(binding, LocalVectorKind.North);
        East = new LocalVectorView(binding, LocalVectorKind.East);
        AngularVelocity = new LocalVectorView(binding, LocalVectorKind.AngularVelocity);
    }
    [ScriptMember("up")] public LocalVectorView Up { get; }
    [ScriptMember("north")] public LocalVectorView North { get; }
    [ScriptMember("east")] public LocalVectorView East { get; }
    [ScriptMember("angularVelocity")] public LocalVectorView AngularVelocity { get; }
}

internal enum LocalVectorKind { Up, North, East, AngularVelocity, SurfaceVelocity }

// Transform values, not handles: x=right, y=nose, z=belly of Control from Here.
public sealed class LocalVectorView
{
    private readonly TickBinding binding;
    private readonly LocalVectorKind kind;
    internal LocalVectorView(TickBinding binding, LocalVectorKind kind) { this.binding = binding; this.kind = kind; }
    private UnityEngine.Vector3 Value
    {
        get
        {
            var vessel = binding.Vessel;
            UnityEngine.Vector3 world = kind switch
            {
                LocalVectorKind.Up => (UnityEngine.Vector3)vessel.upAxis,
                LocalVectorKind.North => (UnityEngine.Vector3)vessel.north,
                LocalVectorKind.East => (UnityEngine.Vector3)vessel.east,
                LocalVectorKind.SurfaceVelocity => (UnityEngine.Vector3)vessel.srf_velocity,
                LocalVectorKind.AngularVelocity => vessel.rootPart.rb.angularVelocity,
                _ => throw new InvalidOperationException("Unknown local vector."),
            };
            return vessel.ReferenceTransform.InverseTransformDirection(world);
        }
    }
    [ScriptMember("x")] public double X => Value.x;
    [ScriptMember("y")] public double Y => Value.y;
    [ScriptMember("z")] public double Z => Value.z;
}

public sealed class VectorView
{
    private readonly TickBinding binding;
    private readonly bool surface;
    internal VectorView(TickBinding binding, bool surface) { this.binding = binding; this.surface = surface; }
    private Vector3d Value => surface ? binding.Vessel.srf_velocity : binding.Vessel.obt_velocity;
    [ScriptMember("x")] public double X => Value.x;
    [ScriptMember("y")] public double Y => Value.y;
    [ScriptMember("z")] public double Z => Value.z;
}

public sealed class ControlView
{
    private readonly TickBinding binding;
    private double? throttle, pitch, yaw, roll;
    private bool? sas, rcs, gear, brakes, lights, abort;
    internal ControlView(TickBinding binding)
    {
        this.binding = binding;
        Translation = new TranslationView(binding);
    }
    [ScriptMember("throttle")] public double Throttle
    {
        get { var controls = binding.Controls; return throttle ?? controls.mainThrottle; }
        set { _ = binding.Controls; Validate(value, 0); throttle = value; }
    }
    [ScriptMember("pitch")] public double Pitch
    {
        get { var controls = binding.Controls; return pitch ?? controls.pitch; }
        set { _ = binding.Controls; Validate(value, -1); pitch = value; }
    }
    [ScriptMember("yaw")] public double Yaw
    {
        get { var controls = binding.Controls; return yaw ?? controls.yaw; }
        set { _ = binding.Controls; Validate(value, -1); yaw = value; }
    }
    [ScriptMember("roll")] public double Roll
    {
        get { var controls = binding.Controls; return roll ?? controls.roll; }
        set { _ = binding.Controls; Validate(value, -1); roll = value; }
    }
    [ScriptMember("sas")] public bool Sas
    {
        get { var vessel = binding.Vessel; return sas ?? vessel.ActionGroups[KSPActionGroup.SAS]; }
        set { _ = binding.Vessel; sas = value; }
    }
    [ScriptMember("rcs")] public bool Rcs
    {
        get { var vessel = binding.Vessel; return rcs ?? vessel.ActionGroups[KSPActionGroup.RCS]; }
        set { _ = binding.Vessel; rcs = value; }
    }
    [ScriptMember("gear")] public bool Gear
    {
        get { var vessel = binding.Vessel; return gear ?? vessel.ActionGroups[KSPActionGroup.Gear]; }
        set { _ = binding.Vessel; gear = value; }
    }
    [ScriptMember("brakes")] public bool Brakes
    {
        get { var vessel = binding.Vessel; return brakes ?? vessel.ActionGroups[KSPActionGroup.Brakes]; }
        set { _ = binding.Vessel; brakes = value; }
    }
    [ScriptMember("lights")] public bool Lights
    {
        get { var vessel = binding.Vessel; return lights ?? vessel.ActionGroups[KSPActionGroup.Light]; }
        set { _ = binding.Vessel; lights = value; }
    }
    [ScriptMember("abort")] public bool Abort
    {
        get { var vessel = binding.Vessel; return abort ?? vessel.ActionGroups[KSPActionGroup.Abort]; }
        set { _ = binding.Vessel; abort = value; }
    }
    [ScriptMember("translation")] public TranslationView Translation { get; }
    private static void Validate(double value, double minimum)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value < minimum || value > 1)
            throw new ArgumentOutOfRangeException(nameof(value), "Throttle must be 0..1; axes must be -1..1.");
    }
    internal void Apply()
    {
        var controls = binding.Controls;
        if (throttle.HasValue) controls.mainThrottle = (float)throttle.Value;
        if (pitch.HasValue) controls.pitch = (float)pitch.Value;
        if (yaw.HasValue) controls.yaw = (float)yaw.Value;
        if (roll.HasValue) controls.roll = (float)roll.Value;
        var vessel = binding.Vessel;
        if (sas.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.SAS, sas.Value);
        if (rcs.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.RCS, rcs.Value);
        if (gear.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.Gear, gear.Value);
        if (brakes.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.Brakes, brakes.Value);
        if (lights.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.Light, lights.Value);
        if (abort.HasValue) vessel.ActionGroups.SetGroup(KSPActionGroup.Abort, abort.Value);
        Translation.Apply();
    }
    internal void Clear() { throttle = null; pitch = null; yaw = null; roll = null; sas = null; rcs = null; gear = null; brakes = null; lights = null; abort = null; Translation.Clear(); }
}

// RCS translation axes, -1..1, buffered like the rotation axes.
public sealed class TranslationView
{
    private readonly TickBinding binding;
    private double? x, y, z;
    internal TranslationView(TickBinding binding) => this.binding = binding;
    [ScriptMember("x")] public double X
    {
        get { var controls = binding.Controls; return x ?? controls.X; }
        set { _ = binding.Controls; Validate(value); x = value; }
    }
    [ScriptMember("y")] public double Y
    {
        get { var controls = binding.Controls; return y ?? controls.Y; }
        set { _ = binding.Controls; Validate(value); y = value; }
    }
    [ScriptMember("z")] public double Z
    {
        get { var controls = binding.Controls; return z ?? controls.Z; }
        set { _ = binding.Controls; Validate(value); z = value; }
    }
    private static void Validate(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value < -1 || value > 1)
            throw new ArgumentOutOfRangeException(nameof(value), "Translation axes must be -1..1.");
    }
    internal void Apply()
    {
        var controls = binding.Controls;
        if (x.HasValue) controls.X = (float)x.Value;
        if (y.HasValue) controls.Y = (float)y.Value;
        if (z.HasValue) controls.Z = (float)z.Value;
    }
    internal void Clear() { x = null; y = null; z = null; }
}

public sealed class ResourcesView
{
    private readonly TickBinding binding;
    internal ResourcesView(TickBinding binding) => this.binding = binding;
    [ScriptMember("get")]
    public ResourceTotals Get(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 128)
            throw new ArgumentException("Use a resource definition name of 1 to 128 characters.", nameof(name));
        var vessel = binding.Vessel;
        double amount = 0, capacity = 0;
        foreach (var part in vessel.parts)
            foreach (PartResource resource in part.Resources)
                if (string.Equals(resource.resourceName, name, StringComparison.Ordinal))
                {
                    amount += resource.amount;
                    capacity += resource.maxAmount;
                }
        return new ResourceTotals(name, amount, capacity);
    }
}

// Detached values: safe to retain between ticks, but not a live resource handle.
public sealed class ResourceTotals
{
    internal ResourceTotals(string name, double amount, double capacity) { Name = name; Amount = amount; Capacity = capacity; }
    [ScriptMember("name")] public string Name { get; }
    [ScriptMember("amount")] public double Amount { get; }
    [ScriptMember("capacity")] public double Capacity { get; }
}

using System;
using System.Reflection;
using Microsoft.ClearScript;

namespace Klanker.Runtime;

// Experimental MechJeb bridge. Member access goes through reflection so the
// build never hard-depends on MechJeb's internal API, which drifts between
// releases; only the member names below are the contract. Verify in-game before
// relying on it. MechJeb is a runtime dependency of Klanker.
public sealed class MechJebContext
{
    private readonly TickBinding binding;
    internal MechJebContext(TickBinding binding)
    {
        this.binding = binding;
        Attitude = new MechJebAttitudeView(binding);
        Node = new MechJebNodeView(binding);
        Landing = new MechJebLandingView(binding);
    }
    [ScriptMember("available")]
    public bool Available { get { _ = binding.Vessel; return MechJebAccess.Core(binding.Vessel) != null; } }
    [ScriptMember("attitude")] public MechJebAttitudeView Attitude { get; }
    [ScriptMember("node")] public MechJebNodeView Node { get; }
    [ScriptMember("landing")] public MechJebLandingView Landing { get; }
}

public sealed class MechJebAttitudeView
{
    private readonly TickBinding binding;
    internal MechJebAttitudeView(TickBinding binding) => this.binding = binding;
    [ScriptMember("enabled")]
    public bool Enabled
    {
        get { _ = binding.Vessel; return MechJebAccess.GetBool(MechJebAccess.Module(binding.Vessel, "attitude"), "enabled"); }
        set { _ = binding.Vessel; MechJebAccess.Set(MechJebAccess.Module(binding.Vessel, "attitude"), "enabled", value); }
    }
    // One of the MechJeb AttitudeReference names, e.g. ORBIT, SURFACE_NORTH,
    // TARGET, RELATIVE_VELOCITY or MANEUVER_NODE.
    [ScriptMember("reference")]
    public string Reference
    {
        get { _ = binding.Vessel; return MechJebAccess.GetEnumName(MechJebAccess.Module(binding.Vessel, "attitude"), "attitudeReference"); }
        set { _ = binding.Vessel; MechJebAccess.SetEnum(MechJebAccess.Module(binding.Vessel, "attitude"), "attitudeReference", value); }
    }
}

public sealed class MechJebNodeView
{
    private readonly TickBinding binding;
    internal MechJebNodeView(TickBinding binding) => this.binding = binding;
    [ScriptMember("execute")] public void Execute()
    {
        _ = binding.Vessel;
        var core = MechJebAccess.RequireCore(binding.Vessel);
        MechJebAccess.Invoke(MechJebAccess.Module(core, "node"), "ExecuteOneNode", core);
    }
    [ScriptMember("abort")] public void Abort()
    {
        _ = binding.Vessel;
        MechJebAccess.Invoke(MechJebAccess.Module(MechJebAccess.RequireCore(binding.Vessel), "node"), "Abort");
    }
}

public sealed class MechJebLandingView
{
    private readonly TickBinding binding;
    internal MechJebLandingView(TickBinding binding) => this.binding = binding;
    [ScriptMember("start")] public void Start()
    {
        _ = binding.Vessel;
        var core = MechJebAccess.RequireCore(binding.Vessel);
        MechJebAccess.Invoke(MechJebAccess.Module(core, "landing"), "LandUntargeted", core);
    }
    [ScriptMember("stop")] public void Stop()
    {
        _ = binding.Vessel;
        MechJebAccess.Invoke(MechJebAccess.Module(MechJebAccess.RequireCore(binding.Vessel), "landing"), "StopLanding");
    }
}

// Reflection gateway. Resolves lazily and retries until MechJeb is loaded.
internal static class MechJebAccess
{
    private static bool resolved;
    private static Type? coreType;
    private static MethodInfo? getMaster;

    internal static object? Core(Vessel vessel)
    {
        Resolve();
        if (!resolved) return null;
        try
        {
            var core = getMaster!.Invoke(null, new object[] { vessel });
            return core != null && coreType!.IsInstanceOfType(core) ? core : null;
        }
        catch (TargetInvocationException) { return null; }
        catch (Exception) { return null; }
    }

    internal static object RequireCore(Vessel vessel) =>
        Core(vessel) ?? throw new InvalidOperationException("MechJeb is not installed on this vessel.");

    internal static object Module(Vessel vessel, string field) => Module(RequireCore(vessel), field);

    internal static object Module(object core, string field)
    {
        var module = GetMember(core, field);
        return module ?? throw new InvalidOperationException($"MechJeb has no '{field}' module.");
    }

    internal static bool GetBool(object instance, string name) => GetMember(instance, name) is bool value && value;

    internal static string GetEnumName(object instance, string name) => GetMember(instance, name)?.ToString() ?? "";

    internal static void Set(object instance, string name, object value)
    {
        var type = instance.GetType();
        var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        if (property != null)
        {
            property.SetValue(instance, value);
            return;
        }
        var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
        if (field != null)
        {
            field.SetValue(instance, value);
            return;
        }
        throw new InvalidOperationException($"MechJeb member '{name}' was not found.");
    }

    internal static void SetEnum(object instance, string name, string enumName)
    {
        var type = instance.GetType();
        var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
        var target = property?.PropertyType ?? field?.FieldType
            ?? throw new InvalidOperationException($"MechJeb member '{name}' was not found.");
        if (!target.IsEnum) throw new InvalidOperationException($"MechJeb member '{name}' is not an enum.");
        object value;
        try { value = Enum.Parse(target, enumName, true); }
        catch (ArgumentException) { throw new ArgumentException($"Unknown MechJeb reference: {enumName}"); }
        Set(instance, name, value);
    }

    internal static void Invoke(object instance, string method, params object[] arguments)
    {
        var info = instance.GetType().GetMethod(method, BindingFlags.Public | BindingFlags.Instance);
        if (info == null) throw new InvalidOperationException($"MechJeb method '{method}' was not found.");
        try { info.Invoke(instance, arguments); }
        catch (TargetInvocationException exception) { throw exception.InnerException ?? exception; }
    }

    private static object? GetMember(object instance, string name)
    {
        var type = instance.GetType();
        var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        if (property != null) return property.GetValue(instance);
        return type.GetField(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(instance);
    }

    private static void Resolve()
    {
        if (resolved) return;
        coreType = Type.GetType("MuMech.MechJebCore, MechJeb2");
        getMaster = Type.GetType("MuMech.VesselExtensions, MechJeb2")?
            .GetMethod("GetMasterMechJeb", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(Vessel) }, null);
        resolved = coreType != null && getMaster != null; // false retries on the next call
    }
}

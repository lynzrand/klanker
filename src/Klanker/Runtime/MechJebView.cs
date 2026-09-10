using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
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
        SmartAss = new MechJebSmartAssView(binding);
        Node = new MechJebNodeView(binding);
        Landing = new MechJebLandingView(binding);
    }
    [ScriptMember("available")]
    public bool Available { get { _ = binding.Vessel; return MechJebAccess.Core(binding.Vessel) != null; } }
    [ScriptMember("attitude")] public MechJebAttitudeView Attitude { get; }
    [ScriptMember("smartAss")] public MechJebSmartAssView SmartAss { get; }
    [ScriptMember("node")] public MechJebNodeView Node { get; }
    [ScriptMember("landing")] public MechJebLandingView Landing { get; }
}

public sealed class MechJebAttitudeView
{
    private readonly TickBinding binding;
    internal MechJebAttitudeView(TickBinding binding) => this.binding = binding;
    // Enables/disables MechJeb's attitude controller directly. Prefer
    // smartAss.engage(mode) to also choose a target direction.
    [ScriptMember("enabled")]
    public bool Enabled
    {
        get { _ = binding.Vessel; return MechJebAccess.GetBool(MechJebAccess.Module(binding.Vessel, "attitude"), "enabled"); }
        set { _ = binding.Vessel; MechJebAccess.Set(MechJebAccess.Module(binding.Vessel, "attitude"), "enabled", value); }
    }
}

// Drives the SmartASS attitude modes. Mirrors the SmartASS window: it sets the
// module's target and calls Engage(), which points the attitude controller at
// the matching frame.
public sealed class MechJebSmartAssView
{
    private readonly TickBinding binding;
    internal MechJebSmartAssView(TickBinding binding) => this.binding = binding;
    [ScriptMember("engage")]
    public void Engage(string mode)
    {
        _ = binding.Vessel;
        MechJebAccess.EngageSmartAss(binding.Vessel, mode);
    }
    [ScriptMember("disable")]
    public void Disable()
    {
        _ = binding.Vessel;
        MechJebAccess.EngageSmartAss(binding.Vessel, "off");
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
    // Friendly aliases (normalized) mapped to MechJebModuleSmartASS.Target names.
    private static readonly Dictionary<string, string> SmartAssModes = new(StringComparer.Ordinal)
    {
        ["OFF"] = "OFF",
        ["KILLROT"] = "KILLROT",
        ["NODE"] = "NODE",
        ["MANEUVERNODE"] = "NODE",
        ["SURFACE"] = "SURFACE",
        ["PROGRADE"] = "PROGRADE",
        ["RETROGRADE"] = "RETROGRADE",
        ["NORMAL"] = "NORMAL_PLUS",
        ["NORMALPLUS"] = "NORMAL_PLUS",
        ["ANTINORMAL"] = "NORMAL_MINUS",
        ["NORMALMINUS"] = "NORMAL_MINUS",
        ["RADIAL"] = "RADIAL_PLUS",
        ["RADIALPLUS"] = "RADIAL_PLUS",
        ["ANTIRADIAL"] = "RADIAL_MINUS",
        ["RADIALMINUS"] = "RADIAL_MINUS",
        ["RELATIVE"] = "RELATIVE_PLUS",
        ["RELATIVEPLUS"] = "RELATIVE_PLUS",
        ["RELATIVEVELOCITY"] = "RELATIVE_PLUS",
        ["ANTIRELATIVE"] = "RELATIVE_MINUS",
        ["RELATIVEMINUS"] = "RELATIVE_MINUS",
        ["TARGET"] = "TARGET_PLUS",
        ["TARGETPLUS"] = "TARGET_PLUS",
        ["ANTITARGET"] = "TARGET_MINUS",
        ["TARGETMINUS"] = "TARGET_MINUS",
        ["PARALLEL"] = "PARALLEL_PLUS",
        ["PARALLELPLUS"] = "PARALLEL_PLUS",
        ["ANTIPARALLEL"] = "PARALLEL_MINUS",
        ["PARALLELMINUS"] = "PARALLEL_MINUS",
        ["SURFACEPROGRADE"] = "SURFACE_PROGRADE",
        ["SURFACERETROGRADE"] = "SURFACE_RETROGRADE",
        ["HORIZONTAL"] = "HORIZONTAL_PLUS",
        ["HORIZONTALPLUS"] = "HORIZONTAL_PLUS",
        ["HORIZONTALMINUS"] = "HORIZONTAL_MINUS",
        ["VERTICAL"] = "VERTICAL_PLUS",
        ["UP"] = "VERTICAL_PLUS",
        ["VERTICALPLUS"] = "VERTICAL_PLUS",
    };

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

    internal static void EngageSmartAss(Vessel vessel, string mode)
    {
        var smartAss = FindSmartAss(vessel);
        var targetType = smartAss.GetType().GetNestedType("Target")
            ?? throw new InvalidOperationException("MechJeb SmartASS has no Target enum.");
        Set(smartAss, "target", Enum.Parse(targetType, TargetName(mode), false));
        Invoke(smartAss, "Engage", true);
    }

    internal static object Module(Vessel vessel, string field) => Module(RequireCore(vessel), field);

    internal static object Module(object core, string field)
    {
        var module = GetMember(core, field);
        return module ?? throw new InvalidOperationException($"MechJeb has no '{field}' module.");
    }

    internal static bool GetBool(object instance, string name) => GetMember(instance, name) is bool value && value;

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

    internal static void Invoke(object instance, string method, params object[] arguments)
    {
        var info = instance.GetType().GetMethod(method, BindingFlags.Public | BindingFlags.Instance);
        if (info == null) throw new InvalidOperationException($"MechJeb method '{method}' was not found.");
        try { info.Invoke(instance, arguments); }
        catch (TargetInvocationException exception) { throw exception.InnerException ?? exception; }
    }

    private static object FindSmartAss(Vessel vessel)
    {
        var core = RequireCore(vessel);
        var find = core.GetType().GetMethod("GetComputerModule", new[] { typeof(string) })
            ?? throw new InvalidOperationException("MechJeb core has no GetComputerModule(string).");
        return find.Invoke(core, new object[] { "MechJebModuleSmartASS" })
            ?? throw new InvalidOperationException("MechJeb has no SmartASS module.");
    }

    private static string TargetName(string mode)
    {
        var normalized = Normalize(mode);
        if (SmartAssModes.TryGetValue(normalized, out var target)) return target;
        throw new ArgumentException(
            $"Unknown SmartASS mode: {mode}. Use prograde, retrograde, normal, antinormal, radial, antiradial, " +
            "target, antitarget, relative, antirelative, surfacePrograde, surfaceRetrograde, horizontal, vertical, " +
            "killRot, node, surface or off.", nameof(mode));
    }

    private static string Normalize(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
            if (char.IsLetterOrDigit(character)) builder.Append(char.ToUpperInvariant(character));
        return builder.ToString();
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

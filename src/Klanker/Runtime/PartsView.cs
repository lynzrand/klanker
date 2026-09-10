using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.ClearScript;

namespace Klanker.Runtime;

// Live queries over the current vessel's parts. References are valid for the tick
// that produced them; persist part.id and re-query with byId to follow a part
// across ticks, staging, docking, or save/load. Results are explicit count/get
// views rather than host arrays, which scripts cannot iterate under the
// restricted host-access model.
public sealed class PartsView
{
    private readonly TickBinding binding;
    internal PartsView(TickBinding binding) => this.binding = binding;

    [ScriptMember("count")] public int Count => binding.Vessel.parts.Count;
    [ScriptMember("get")]
    public PartRef Get(int index)
    {
        var parts = binding.Vessel.parts;
        if (index < 0 || index >= parts.Count)
            throw new ArgumentOutOfRangeException(nameof(index), "Part index is out of range.");
        return new PartRef(binding, parts[index]);
    }
    // Matches the part config name (AvailablePart.name), not the display title.
    [ScriptMember("byName")] public PartList ByName(string name) =>
        Query(part => string.Equals(part.partInfo.name, name, StringComparison.Ordinal));
    [ScriptMember("byTag")] public PartList ByTag(string tag) => Query(part => NameTags.HasTag(part, tag));
    [ScriptMember("withModule")] public PartList WithModule(string module) =>
        Query(part => ModulesContain(part, module));
    [ScriptMember("byId")]
    public PartRef ById(string id)
    {
        if (!uint.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed))
            throw new ArgumentException("Part id must be the numeric persistentId from part.id.", nameof(id));
        var parts = binding.Vessel.parts;
        for (var i = 0; i < parts.Count; i++)
            if (parts[i].persistentId == parsed) return new PartRef(binding, parts[i]);
        throw new InvalidOperationException("No part with that id exists on the current vessel.");
    }

    private PartList Query(Func<Part, bool> predicate)
    {
        _ = binding.Vessel;
        var matches = new List<PartRef>();
        foreach (var part in binding.Vessel.parts)
            if (predicate(part)) matches.Add(new PartRef(binding, part));
        return new PartList(matches.ToArray());
    }

    private static bool ModulesContain(Part part, string module)
    {
        foreach (PartModule candidate in part.Modules)
            if (string.Equals(candidate.ClassName, module, StringComparison.Ordinal) ||
                string.Equals(candidate.moduleName, module, StringComparison.Ordinal)) return true;
        return false;
    }
}

// Count/get result returned by vessel.parts queries.
public sealed class PartList
{
    private readonly PartRef[] items;
    internal PartList(PartRef[] items) => this.items = items;
    [ScriptMember("count")] public int Count => items.Length;
    [ScriptMember("get")]
    public PartRef Get(int index)
    {
        if (index < 0 || index >= items.Length)
            throw new ArgumentOutOfRangeException(nameof(index), "Part index is out of range.");
        return items[index];
    }
}

public sealed class PartRef
{
    private readonly TickBinding binding;
    private readonly Part part;
    internal PartRef(TickBinding binding, Part part)
    {
        this.binding = binding;
        this.part = part;
        Resources = new PartResourcesView(binding, part);
        Engines = new EnginesView(binding, part);
    }

    // Stable KSP persistentId; survives docking, staging and save/load.
    [ScriptMember("id")] public string Id { get { _ = binding.Vessel; return part.persistentId.ToString(CultureInfo.InvariantCulture); } }
    [ScriptMember("name")] public string Name { get { _ = binding.Vessel; return part.partInfo.name; } }
    [ScriptMember("title")] public string Title { get { _ = binding.Vessel; return part.partInfo.title; } }
    // KSP inverseStage: lower numbers fire earlier.
    [ScriptMember("stage")] public int Stage { get { _ = binding.Vessel; return part.inverseStage; } }
    [ScriptMember("tags")] public string[] Tags { get { _ = binding.Vessel; return NameTags.ForPart(part); } }
    [ScriptMember("resources")] public PartResourcesView Resources { get; }
    [ScriptMember("engines")] public EnginesView Engines { get; }
}

// Totals over a single part, matching vessel.resources.get semantics.
public sealed class PartResourcesView
{
    private readonly TickBinding binding;
    private readonly Part part;
    internal PartResourcesView(TickBinding binding, Part part) { this.binding = binding; this.part = part; }
    [ScriptMember("get")]
    public ResourceTotals Get(string name)
    {
        _ = binding.Vessel;
        if (string.IsNullOrWhiteSpace(name) || name.Length > 128)
            throw new ArgumentException("Use a resource definition name of 1 to 128 characters.", nameof(name));
        double amount = 0, capacity = 0;
        foreach (PartResource resource in part.Resources)
            if (string.Equals(resource.resourceName, name, StringComparison.Ordinal))
            {
                amount += resource.amount;
                capacity += resource.maxAmount;
            }
        return new ResourceTotals(name, amount, capacity);
    }
}

public sealed class EnginesView
{
    private readonly TickBinding binding;
    private readonly List<ModuleEngines> engines = new();
    internal EnginesView(TickBinding binding, Part part)
    {
        this.binding = binding;
        foreach (PartModule module in part.Modules)
            if (module is ModuleEngines engine) engines.Add(engine);
    }
    [ScriptMember("count")] public int Count => engines.Count;
    [ScriptMember("get")]
    public EngineView Get(int index)
    {
        if (index < 0 || index >= engines.Count)
            throw new ArgumentOutOfRangeException(nameof(index), "Engine index is out of range.");
        return new EngineView(binding, engines[index]);
    }
}

public sealed class EngineView
{
    private readonly TickBinding binding;
    private readonly ModuleEngines engine;
    internal EngineView(TickBinding binding, ModuleEngines engine) { this.binding = binding; this.engine = engine; }
    [ScriptMember("name")] public string Name { get { _ = binding.Vessel; return engine.engineName; } }
    [ScriptMember("maxThrust")] public double MaxThrust { get { _ = binding.Vessel; return engine.maxThrust; } }
    [ScriptMember("thrust")] public double Thrust { get { _ = binding.Vessel; return engine.finalThrust; } }
    [ScriptMember("ignited")] public bool Ignited { get { _ = binding.Vessel; return engine.getIgnitionState; } }
    [ScriptMember("operational")] public bool Operational { get { _ = binding.Vessel; return engine.isOperational; } }
    // 0..1 thrust limiter, buffered with read-after-write within the tick.
    [ScriptMember("thrustLimiter")]
    public double ThrustLimiter
    {
        get { _ = binding.Vessel; return binding.GetPendingLimiter(engine) ?? engine.thrustPercentage / 100.0; }
        set
        {
            if (double.IsNaN(value) || double.IsInfinity(value) || value < 0 || value > 1)
                throw new ArgumentOutOfRangeException(nameof(value), "Thrust limiter must be 0..1.");
            binding.SetPendingLimiter(engine, value);
        }
    }
    [ScriptMember("activate")] public void Activate() => binding.Queue(engine.Activate);
    [ScriptMember("shutdown")] public void Shutdown() => binding.Queue(engine.Shutdown);
}

// Name tags are provided by optional mods; recognize the two common ones by
// duck typing rather than taking a hard dependency.
internal static class NameTags
{
    private const System.Reflection.BindingFlags Flags =
        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance;

    internal static bool HasTag(Part part, string tag)
    {
        foreach (var token in ForPart(part))
            if (string.Equals(token, tag, StringComparison.Ordinal)) return true;
        return false;
    }

    internal static string[] ForPart(Part part)
    {
        var tags = new List<string>();
        foreach (PartModule module in part.Modules)
            foreach (var token in (Read(module) ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
                if (!tags.Contains(token)) tags.Add(token);
        return tags.ToArray();
    }

    private static string? Read(PartModule module)
    {
        var type = module.GetType();
        if (type.Name != "ModuleNameTag" && type.Name != "KOSNameTag") return null;
        var field = type.GetField("nameTag", Flags);
        if (field != null && field.FieldType == typeof(string)) return field.GetValue(module) as string;
        var property = type.GetProperty("nameTag", Flags);
        if (property != null && property.PropertyType == typeof(string)) return property.GetValue(module) as string;
        return null;
    }
}

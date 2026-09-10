using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using Klanker.Runtime;
using Microsoft.ClearScript;

internal static class ViewTests
{
    internal static void CheckDeclarations(string plugins)
    {
        var definitions = File.ReadAllText(Path.Combine(plugins, "..", "Workers", "klanker.d.ts"));
        definitions = Regex.Replace(definitions, @"/\*[\s\S]*?\*/|//[^\r\n]*", "");
        foreach (var type in new[] { typeof(FlightContext), typeof(VesselView), typeof(OrbitView),
            typeof(BodyView), typeof(VelocityView), typeof(VectorView), typeof(ResourcesView),
            typeof(ResourceTotals), typeof(ControlView), typeof(TranslationView), typeof(AttitudeView),
            typeof(LocalVectorView), typeof(PartsView), typeof(PartList), typeof(PartRef),
            typeof(PartResourcesView), typeof(EnginesView), typeof(EngineView),
            typeof(MechJebContext), typeof(MechJebAttitudeView), typeof(MechJebSmartAssView), typeof(MechJebNodeView), typeof(MechJebLandingView) })
        {
            var match = Regex.Match(definitions, @"interface\s+" + type.Name + @"\s*\{([^}]+)\}");
            Check(match.Success, "packaged declaration " + type.Name);
            var declared = match.Groups[1].Value.Split(';').Select(line => line.Trim()).Where(line => line.Length != 0).OrderBy(line => line).ToArray();
            var actual = new List<string>();
            foreach (var property in type.GetProperties())
            {
                var attribute = property.GetCustomAttribute<ScriptMemberAttribute>();
                if (attribute != null)
                    actual.Add((property.SetMethod == null ? "readonly " : "") + attribute.Name + ": " + TypeName(property.PropertyType));
            }
            foreach (var method in type.GetMethods())
            {
                var attribute = method.GetCustomAttribute<ScriptMemberAttribute>();
                if (attribute != null)
                    actual.Add(attribute.Name + "(" + string.Join(", ", method.GetParameters().Select(p => p.Name + ": " + TypeName(p.ParameterType))) + "): " + TypeName(method.ReturnType));
            }
            Check(declared.SequenceEqual(actual.OrderBy(line => line)), "declaration matches exposed members/types/readonly: " + type.Name);
        }
        var vessel = new Vessel { altitude = 103, terrainAltitude = 100, situation = Vessel.Situations.PRELAUNCH };
        vessel.mainBody.Radius = 600000;
        vessel.mainBody.gravParameter = 9.81 * 600000 * 600000;
        Planetarium.UniversalTime = 1000;
        using var hopper = new FlightWorker(File.ReadAllText(Path.Combine(plugins, "..", "Workers", "grasshopper.js")));
        var controls = new FlightCtrlState();
        hopper.Tick(vessel, controls);
        Check(controls.mainThrottle > 0.5 && controls.mainThrottle < 1 &&
            controls.pitch == 0 && controls.yaw == 0 && controls.roll == 0, "packaged hopper executes against real ClearScript views");
    }

    private static string TypeName(Type type)
    {
        if (type.IsArray) return TypeName(type.GetElementType()!) + "[]";
        if (type == typeof(double) || type == typeof(float) || type == typeof(int) ||
            type == typeof(uint) || type == typeof(long) || type == typeof(short) || type == typeof(byte)) return "number";
        if (type == typeof(bool)) return "boolean";
        if (type == typeof(string)) return "string";
        if (type == typeof(ScriptObject)) return "Storage";
        if (type == typeof(void)) return "void";
        return type.Name;
    }

    internal static void Run()
    {
        var vessel = new Vessel { altitude = 200, terrainAltitude = 50, MassTonnes = 2,
            situation = Vessel.Situations.FLYING, srf_velocity = new Vector3d { x = 3, y = 4, z = 5 },
            obt_velocity = new Vector3d { x = 3, y = 4 } };
        vessel.orbit.ApA = 100000;
        vessel.orbit.timeToAp = 20;
        vessel.mainBody.Radius = 600000;
        var tank = new Part();
        tank.Resources.Add(new PartResource { resourceName = "ElectricCharge", amount = 12, maxAmount = 20 });
        var second = new Part();
        second.Resources.Add(new PartResource { resourceName = "ElectricCharge", amount = 3, maxAmount = 10 });
        vessel.parts.Add(tank); vessel.parts.Add(second);
        var controls = new FlightCtrlState { mainThrottle = 0.4f, pitch = 0.2f };

        // Direct host checks of the same lifetime shared by all nested JS views.
        var context = new FlightContext();
        var orbit = context.Vessel.Orbit;
        var control = context.Vessel.Control;
        Reject(() => _ = orbit.Apoapsis, "unbound nested read");
        Reject(() => control.Throttle = 0, "unbound control write");
        context.Begin(vessel, controls);
        Check(context.Vessel.Mass == 2000 && context.Vessel.HeightAboveTerrain == 150, "SI telemetry conversions");
        control.Throttle = 0;
        Check(control.Throttle == 0 && controls.mainThrottle == 0.4f, "zero is a buffered value, not absence");
        context.Commit(); context.End();
        Check(controls.mainThrottle == 0 && controls.pitch == 0.2f, "commit only written fields");
        Reject(() => _ = control.Throttle, "cleared buffered read");
        Reject(() => _ = orbit.Apoapsis, "cleared nested read");
        context.Begin(new Vessel { orbit = new Orbit { ApA = 123 } }, controls);
        Check(orbit.Apoapsis == 123, "retained nested view follows current binding");
        control.Pitch = -1; context.End(); // Discard without commit.
        context.Begin(vessel, controls); context.Commit(); context.End();
        Check(controls.pitch == 0.2f, "discarded buffers do not leak to next tick");

        // Action groups and RCS translation share the buffered commit/discard model.
        context.Begin(vessel, controls);
        control.Sas = true;
        control.Translation.X = 0.5;
        Check(control.Sas && control.Translation.X == 0.5, "buffered action group and translation reads");
        context.Commit(); context.End();
        Check(vessel.ActionGroups[KSPActionGroup.SAS] && controls.X == 0.5f, "action group and translation committed");
        context.Begin(vessel, controls);
        control.Gear = true;
        control.Brakes = true;
        context.End();
        Check(!vessel.ActionGroups[KSPActionGroup.Gear] && !vessel.ActionGroups[KSPActionGroup.Brakes],
            "discarded action groups do not apply");

        // Discrete staging is queued and runs only after a successful tick.
        var stageManager = KSP.UI.Screens.StageManager.Instance;
        using (var worker = new FlightWorker("export default { flightTick({vessel}) { vessel.stage(); } };"))
        {
            stageManager.Activations = 0;
            worker.Tick(vessel, controls);
            Check(stageManager.Activations == 1, "staging action commits after a successful tick");
        }
        using (var worker = new FlightWorker("export default { flightTick({vessel}) { vessel.stage(); throw new Error('rollback'); } };"))
        {
            stageManager.Activations = 0;
            Reject(() => worker.Tick(vessel, controls), "staging tick fault");
            Check(stageManager.Activations == 0, "staging action is discarded when the tick fails");
        }

        // Parts API: queries, stable ids, per-part resources, engines, limiter commit.
        tank.persistentId = 101; second.persistentId = 202;
        tank.partInfo.name = second.partInfo.name = "fuelTank";
        tank.partInfo.title = "Fuel Tank";
        tank.Modules.Add(new ModuleNameTag { nameTag = "core main" });
        var engine = new ModuleEngines { engineName = "LV-909", maxThrust = 60, finalThrust = 12 };
        second.Modules.Add(engine);
        context.Begin(vessel, controls);
        var parts = context.Vessel.Parts;
        Check(parts.Count == 2 && parts.Get(0).Id == "101", "parts count/get");
        Check(parts.ByName("fuelTank").Count == 2 && parts.ById("202").Title == "Test pod", "parts byName/byId");
        Check(parts.ByTag("main").Count == 1 && parts.ByTag("core").Count == 1 && parts.ByTag("nope").Count == 0, "parts byTag tokens");
        Check(parts.WithModule("ModuleEngines").Count == 1 && parts.WithModule("Nope").Count == 0, "parts withModule");
        var engines = parts.ById("202").Engines;
        Check(engines.Count == 1 && engines.Get(0).Name == "LV-909" && engines.Get(0).Thrust == 12 && !engines.Get(0).Ignited,
            "engine reads");
        var partEngine = engines.Get(0);
        Check(partEngine.ThrustLimiter == 1, "engine limiter live read");
        partEngine.ThrustLimiter = 0.5;
        Check(partEngine.ThrustLimiter == 0.5, "engine limiter read-after-write");
        Reject(() => partEngine.ThrustLimiter = 1.5, "engine limiter range");
        partEngine.Activate();
        Check(!engine.getIgnitionState, "engine activate is queued, not immediate");
        context.Commit(); context.End();
        Check(engine.thrustPercentage == 50 && engine.getIgnitionState, "engine limiter and activate commit");
        context.Begin(vessel, controls);
        partEngine.ThrustLimiter = 0.25;
        context.End();
        Check(engine.thrustPercentage == 50, "engine limiter discarded when no commit");
        context.Begin(vessel, controls);
        Check(context.Vessel.Parts.ById("101").Resources.Get("ElectricCharge").Amount == 12, "per-part resource totals");
        Reject(() => context.Vessel.Parts.ById("999"), "unknown part id");
        context.End();

        // Exercise the parts API through real V8 to confirm arrays and nested
        // views marshal correctly.
        using (var worker = new FlightWorker("""
            export default { flightTick({vessel}) {
                const assert = (ok, message) => { if (!ok) throw new Error(message); };
                assert(vessel.parts.count === 2 && vessel.parts.get(0).id === '101', 'parts count/get');
                assert(vessel.parts.byName('fuelTank').count === 2, 'parts.byName');
                assert(vessel.parts.byTag('main').count === 1, 'parts.byTag');
                assert(vessel.parts.withModule('ModuleEngines').count === 1, 'parts.withModule');
                const engine = vessel.parts.byId('202').engines.get(0);
                assert(engine.name === 'LV-909' && engine.thrust === 12, 'engine reads');
                assert(vessel.parts.byId('202').resources.get('ElectricCharge').amount === 3, 'part resources');
                engine.thrustLimiter = 0.4;
                assert(engine.thrustLimiter === 0.4, 'limiter read-after-write');
            }};
            """))
        {
            worker.Tick(vessel, controls);
        }
        Check(engine.thrustPercentage == 40, "JS parts API and limiter commit");

        // MechJeb is not loaded in the test host, so the adapter reports absent
        // and every operation fails explicitly instead of reaching into the mod.
        context.Begin(vessel, controls);
        Check(!context.MechJeb.Available, "MechJeb reports absent");
        Reject(() => context.MechJeb.Attitude.Enabled = true, "MechJeb attitude requires the mod");
        Reject(() => context.MechJeb.SmartAss.Engage("prograde"), "MechJeb SmartASS requires the mod");
        Reject(() => context.MechJeb.Node.Execute(), "MechJeb node requires the mod");
        Reject(() => context.MechJeb.Landing.Start(), "MechJeb landing requires the mod");
        context.End();
        using (var worker = new FlightWorker("""
            export default { flightTick({mechjeb}) {
                if (mechjeb.available !== false) throw new Error('expected MechJeb absent');
                try { mechjeb.node.execute(); throw new Error('expected throw'); }
                catch (error) { if (String(error).includes('expected throw')) throw error; }
            }};
            """))
        {
            worker.Tick(vessel, controls);
        }
        Check(true, "JS MechJeb availability and guarded failure");

        var logs = new List<string>();
        using (var worker = new FlightWorker("""
            console.log('loaded', {ok: true}, 7);
            let oldOrbit;
            export default { flightTick({vessel}) {
                const assert = (ok, message) => { if (!ok) throw new Error(message); };
                assert(typeof vessel.id === 'string' && vessel.name === 'Test vessel', 'identity');
                assert(vessel.situation === 'FLYING' && vessel.mass === 2000, 'status/mass');
                assert(vessel.heightAboveTerrain === 150 && vessel.body.radius === 600000, 'location/body');
                assert(vessel.velocity.surface.z === 5 && vessel.orbitalSpeed === 5, 'vectors');
                assert(vessel.orbit.apoapsis === 100000 && vessel.orbit.timeToApoapsis === 20, 'orbit');
                oldOrbit ??= vessel.orbit;
                assert(oldOrbit.apoapsis === vessel.orbit.apoapsis, 'retained view');
                const ec = vessel.resources.get('ElectricCharge');
                assert(ec.amount === 15 && ec.capacity === 30, 'resource totals');
                assert(vessel.resources.get('Missing').capacity === 0, 'absent resource');
                for (const change of [
                    () => { vessel.altitude = -99; },
                    () => { vessel.orbit.apoapsis = -99; },
                    () => { vessel.orbit = {}; },
                    () => { ec.amount = -99; },
                    () => { vessel.velocity.surface.x = -99; },
                    () => vessel.GetType()
                ]) {
                    let rejected = false;
                    try { change(); } catch { rejected = true; }
                    assert(rejected, 'read-only/exposure boundary');
                }
                assert(vessel.binding === undefined && vessel.Orbit === undefined, 'private members');
                vessel.control.throttle = 0.5;
                vessel.control.pitch = -0.5;
                assert(vessel.control.throttle === 0.5, 'buffer read');
                console.log('tick', vessel.name, ec.amount);
            }};
            """, logs.Add))
        {
            worker.Tick(vessel, controls);
            worker.Tick(vessel, controls);
            Check(controls.mainThrottle == 0.5f && controls.pitch == -0.5f, "direct C# host view in V8");
            Check(logs.Count == 3 && logs[0] == "loaded {\"ok\":true} 7" && logs[1] == "tick Test vessel 15", "console at initialization and in ticks");
        }
        foreach (var value in new[] { "'0.5'", "null", "undefined", "true", "NaN", "Infinity", "2" })
        {
            using var worker = new FlightWorker("export default { flightTick({vessel}) { vessel.control.throttle = 1; vessel.control.pitch = " + value + "; } };");
            controls.mainThrottle = 0.3f;
            Reject(() => worker.Tick(vessel, controls), "invalid control " + value);
            Check(controls.mainThrottle == 0.3f, "invalid setter rolls back all buffers");
        }
        logs.Clear();
        using (var worker = new FlightWorker("""
            for (let i = 0; i < 100; i++) console.log('x'.repeat(3000));
            export default { flightTick() {} };
            """, logs.Add))
        {
            Check(logs.FindAll(line => line.Length == 2048).Count == 20, "bounded console output");
            Check(logs.FindAll(line => line.Contains("was truncated")).Count == 1, "message truncation warning");
            Check(logs.FindAll(line => line.Contains("rate limit reached")).Count == 1 && logs.Count == 22, "rate limit warning without warning floods");
        }
        // The rate-warning flag can be derived from the count only if the exact
        // limit, repeated overflow, and next-window reset retain their behavior.
        logs.Clear();
        using (var worker = new FlightWorker("""
            export default { flightTick() { for (let i = 0; i < 20; i++) console.log('bounded'); } };
            """, logs.Add))
        {
            worker.Tick(vessel, controls);
            Check(logs.Count == 20, "exact log limit does not warn");
            worker.Tick(vessel, controls);
            worker.Tick(vessel, controls);
            Check(logs.Count == 21 && logs[20].Contains("rate limit reached"), "overflow warns once across ticks");
            System.Threading.Thread.Sleep(1100);
            worker.Tick(vessel, controls);
            Check(logs.Count == 41, "next log window accepts messages again");
            worker.Tick(vessel, controls);
            Check(logs.Count == 42 && logs[41].Contains("rate limit reached"), "next log window can warn again");
        }
        vessel.orbit.eccentricity = 1.2;
        context.Begin(vessel, controls);
        Check(double.IsNaN(orbit.Period) && double.IsNaN(orbit.TimeToApoapsis), "open orbit has no period or next apoapsis");
        context.End();
        var rotated = new Vessel();
        rotated.ReferenceTransform.right = new UnityEngine.Vector3(0, 1, 0);
        rotated.ReferenceTransform.up = new UnityEngine.Vector3(-1, 0, 0);
        rotated.ReferenceTransform.forward = new UnityEngine.Vector3(0, 0, 1);
        rotated.rootPart.rb.angularVelocity = new UnityEngine.Vector3(2, 3, 4);
        rotated.srf_velocity = new Vector3d { x = 5, y = 6, z = 7 };
        context.Begin(rotated, controls);
        Check(context.Vessel.Attitude.Up.X == 1 && context.Vessel.Attitude.Up.Y == 0 &&
            context.Vessel.Attitude.AngularVelocity.Y == -2 &&
            context.Vessel.Velocity.LocalSurface.X == 6, "local telemetry follows the control transform");
        Check(context.UniversalTime == Planetarium.GetUniversalTime() &&
            context.DeltaTime == TimeWarp.fixedDeltaTime, "simulation timing");
        context.End();
        Reject(() => _ = context.UniversalTime, "timing lifetime guard");
        Reject(() => _ = context.Vessel.Attitude.AngularVelocity.X, "attitude lifetime guard");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception("FAIL: " + message);
        Console.WriteLine("PASS: " + message);
    }
    private static void Reject(Action action, string message)
    {
        var failed = false;
        try { action(); } catch { failed = true; }
        Check(failed, message);
    }
}

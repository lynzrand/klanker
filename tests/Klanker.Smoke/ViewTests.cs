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
            typeof(ResourceTotals), typeof(ControlView), typeof(AttitudeView), typeof(LocalVectorView) })
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

    private static string TypeName(Type type) => type == typeof(double) ? "number" : type == typeof(string) ? "string" : type.Name;

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

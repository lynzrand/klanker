using System;
using System.Diagnostics;
using Klanker.Runtime;
using Microsoft.ClearScript;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1 || args.Length > 2) throw new ArgumentException("Pass the packaged Plugins directory and optional --benchmark.");
            HostSettings.AuxiliarySearchPath = System.IO.Path.Combine(System.IO.Path.GetFullPath(args[0]), "PluginData");
            if (args.Length == 2)
            {
                if (args[1] != "--benchmark") throw new ArgumentException("Unknown option: " + args[1]);
                RuntimeTests.Benchmark();
                return 0;
            }
            var vessel = new Vessel { altitude = 10 };
            var controls = new FlightCtrlState();
            using (var worker = new FlightWorker("""
                export default { flightTick({vessel}) {
                    vessel.control.throttle = vessel.altitude < 100 ? 0.7 : 0;
                    if (vessel.control.throttle !== (vessel.altitude < 100 ? 0.7 : 0))
                        throw new Error('read-after-write failed');
                }};
                """))
            {
                worker.Tick(vessel, controls);
                Check(controls.mainThrottle == 0.7f, "staged throttle");
                vessel.altitude = 200;
                worker.Tick(vessel, controls);
                Check(controls.mainThrottle == 0, "live reads between ticks");
            }

            ExpectFault("export default { flightTick({vessel}) { vessel.control.throttle = 1; throw new Error('rollback'); } }", "rollback");
            ExpectFault("export default { flightTick({vessel}) { vessel.control.pitch = 2; } }", "invalid control");
            ExpectFault("export default { async flightTick() {} }", "async handler");
            var watch = Stopwatch.StartNew();
            ExpectFault("export default { flightTick({vessel}) { vessel.control.throttle = 1; while(true) {} } }", "watchdog");
            Check(watch.Elapsed.TotalSeconds < 5, "watchdog returned within 5 seconds");

            var rejected = false;
            try { using var invalid = new FlightWorker("export default {};"); }
            catch { rejected = true; }
            Check(rejected, "invalid deployment rejected");
            watch.Restart();
            rejected = false;
            try { using var stuck = new FlightWorker("while (true) {} export default { flightTick() {} };"); }
            catch { rejected = true; }
            Check(rejected && watch.Elapsed.TotalSeconds < 5, "module initialization watchdog");
            using (var recreated = new FlightWorker("export default { flightTick() {} };"))
            {
                controls.mainThrottle = 0.3f;
                recreated.Tick(vessel, controls);
                Check(controls.mainThrottle == 0.3f, "dispose/recreate and untouched controls");
            }

            ViewTests.CheckDeclarations(args[0]);
            ViewTests.Run();
            ComputerTests.Run(args[0]);
            StorageTests.Run();
            RuntimeTests.Run();

            Console.WriteLine("PASS: native V8, live reads, overlay, rollback, ranges, sync-only, watchdog, validation, recreation.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    private static void ExpectFault(string source, string label)
    {
        using var worker = new FlightWorker(source);
        var faulted = false;
        var committed = false;
        var controls = new FlightCtrlState { mainThrottle = 0.3f };
        try
        {
            worker.Tick(new Vessel(), controls);
            committed = true;
        }
        catch { faulted = true; }
        Check(faulted && !committed && controls.mainThrottle == 0.3f, label);
    }

    private static void Check(bool condition, string label)
    {
        if (!condition) throw new InvalidOperationException("FAIL: " + label);
        Console.WriteLine("PASS: " + label);
    }
}

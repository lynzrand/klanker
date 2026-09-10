using System;
using System.Diagnostics;
using Klanker.Runtime;

internal static class RuntimeTests
{
    internal static void Run()
    {
        using var host = new WorkerRuntime();
        Check(host.ContextCount == 0, "warmup leaves no worker context");
        using var first = host.CreateWorker("""
            globalThis.secret = 123; Object.prototype.secret = 456;
            export default { flightTick({storage, vessel}) {
                storage.count = (storage.count ?? 0) + 1;
                vessel.control.throttle = 0.25;
            }};
            """);
        using var second = host.CreateWorker("""
            if (globalThis.secret !== undefined || ({}).secret !== undefined) throw new Error('globals leaked');
            export default { flightTick({storage, vessel}) {
                if (storage.count !== undefined) throw new Error('storage leaked');
                vessel.control.throttle = 0.75;
            }};
            """);
        var vessel = new Vessel();
        var controls = new FlightCtrlState();
        first.Tick(vessel, controls);
        Check(controls.mainThrottle == 0.25f, "first shared-runtime context");
        second.Tick(vessel, controls);
        Check(controls.mainThrottle == 0.75f && host.ContextCount == 2, "isolated globals/modules/storage in shared runtime");
        first.Dispose();
        Check(host.ContextCount == 1, "disposing context unregisters it");
        Reject(() => host.CreateWorker("throw new Error('bad init'); export default {};"), "failed initialization");
        Check(host.ContextCount == 1, "failed initialization does not leak a context");
        using (var stuck = host.CreateWorker("export default { flightTick() { while(true) {} } };"))
            Reject(() => stuck.Tick(vessel, controls), "shared-runtime watchdog");
        second.Tick(vessel, controls);
        Check(controls.mainThrottle == 0.75f, "watchdog fault does not poison another context");
        using var fresh = host.CreateWorker("export default { flightTick({vessel}) { vessel.control.throttle = 0; } };");
        fresh.Tick(vessel, controls);
        Check(controls.mainThrottle == 0, "fresh context after watchdog fault");
        // Keep first-tick grace distinct from steady-state and storage budgets
        // when moving timeout bookkeeping out of persistent worker fields.
        using (var budgeted = host.CreateWorker("""
            export default { flightTick({vessel}) { console.log('wait'); vessel.control.throttle = 0.5; } };
            """, _ => System.Threading.Thread.Sleep(40)))
        {
            budgeted.Tick(vessel, controls);
            Check(controls.mainThrottle == 0.5f, "first tick permits host setup beyond steady-state budget");
            Check(budgeted.SnapshotStorage() == "{}", "storage snapshot between flight ticks");
            // An isolated over-budget tick is tolerated (it can be a GC or OS
            // stall); a second consecutive one faults and must not commit.
            controls.mainThrottle = 0.1f;
            budgeted.Tick(vessel, controls);
            Check(controls.mainThrottle == 0.5f, "isolated over-budget tick is tolerated");
            controls.mainThrottle = 0.1f;
            Reject(() => budgeted.Tick(vessel, controls), "consecutive over-budget ticks fault");
            Check(controls.mainThrottle == 0.1f, "over-budget tick cannot commit controls");
        }
        host.Dispose();
        Check(second.IsDisposed && fresh.IsDisposed && host.ContextCount == 0, "owner disposes remaining contexts");
        Reject(() => host.CreateWorker("export default {};"), "disposed owner cannot create contexts");
    }

    internal static void Benchmark()
    {
        const string source = "export default { flightTick({vessel,storage}) { storage.count = (storage.count ?? 0) + 1; vessel.control.throttle = 0.5; } };";
        var vessel = new Vessel();
        var controls = new FlightCtrlState();
        double Measure(Func<FlightWorker> create)
        {
            var watch = Stopwatch.StartNew();
            using var worker = create();
            worker.Tick(vessel, controls);
            return watch.Elapsed.TotalMilliseconds;
        }
        Console.WriteLine($"Cold standalone init + first tick: {Measure(() => new FlightWorker(source)):F2} ms");
        var standalone = new double[12];
        for (var i = 0; i < standalone.Length; i++) standalone[i] = Measure(() => new FlightWorker(source));
        var warmup = Stopwatch.StartNew();
        using var host = new WorkerRuntime();
        Console.WriteLine($"Scene runtime creation/warmup: {warmup.Elapsed.TotalMilliseconds:F2} ms");
        var shared = new double[12];
        for (var i = 0; i < shared.Length; i++) shared[i] = Measure(() => host.CreateWorker(source));
        Array.Sort(standalone); Array.Sort(shared);
        Console.WriteLine($"Median init + first tick, 12 samples: standalone={standalone[6]:F2} ms; shared={shared[6]:F2} ms");
    }

    private static void Check(bool condition, string label)
    {
        if (!condition) throw new Exception("FAIL: " + label);
        Console.WriteLine("PASS: " + label);
    }
    private static void Reject(Action action, string label)
    {
        var rejected = false;
        try { action(); } catch { rejected = true; }
        Check(rejected, label);
    }
}

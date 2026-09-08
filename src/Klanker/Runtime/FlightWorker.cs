using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using Microsoft.ClearScript;
using Microsoft.ClearScript.JavaScript;
using Microsoft.ClearScript.V8;

namespace Klanker.Runtime;

// Owns no KSP objects. Reads are scoped to the current synchronous control callback.
internal sealed class FlightWorker : IDisposable
{
    private readonly V8ScriptEngine engine;
    private readonly Stopwatch clock = new();
    private readonly Dictionary<string, double> pending = new(StringComparer.Ordinal);
    private Func<string, double>? reader;
    private double budgetMilliseconds;
    private bool firstTick = true;
    private readonly object interruptGate = new();
    private long invocation;

    internal FlightWorker(string source)
    {
        engine = new V8ScriptEngine();
        try
        {
            engine.MaxRuntimeHeapSize = (UIntPtr)(64UL * 1024 * 1024);
            engine.AddHostObject("__read", new Func<string, double>(Read));
            engine.AddHostObject("__write", new Action<string, double>(Write));
            engine.DocumentSettings.AddSystemDocument("worker", ModuleCategory.Standard, source);
            budgetMilliseconds = 2000;
            clock.Restart();
            using var watchdog = StartWatchdog();
            engine.Execute(new DocumentInfo("klanker-entry") { Category = ModuleCategory.Standard }, """
                import worker from 'worker';
                if (!worker || typeof worker.flightTick !== 'function')
                    throw new TypeError('Worker must export default { flightTick(ctx) { ... } }');
                const read = globalThis.__read;
                const write = globalThis.__write;
                delete globalThis.__read;
                delete globalThis.__write;
                const control = {};
                for (const key of ['throttle', 'pitch', 'yaw', 'roll']) {
                    Object.defineProperty(control, key, {
                        get: () => read('control.' + key),
                        set: value => {
                            if (typeof value !== 'number' || !Number.isFinite(value))
                                throw new TypeError(key + ' must be a finite number');
                            write('control.' + key, value);
                        }
                    });
                }
                const orbit = {};
                for (const key of ['apoapsis', 'periapsis'])
                    Object.defineProperty(orbit, key, { get: () => read('orbit.' + key) });
                const vessel = { control: Object.freeze(control), orbit: Object.freeze(orbit) };
                for (const key of ['altitude', 'verticalSpeed', 'surfaceSpeed'])
                    Object.defineProperty(vessel, key, { get: () => read(key) });
                const ctx = Object.freeze({ vessel: Object.freeze(vessel) });
                globalThis.__flightTick = () => {
                    const result = worker.flightTick(ctx);
                    if (result && typeof result.then === 'function')
                        throw new TypeError('flightTick must be synchronous');
                };
                """);
        }
        catch
        {
            EndInvocation();
            engine.Dispose();
            throw;
        }
        finally
        {
            EndInvocation();
            clock.Stop();
        }
    }

    internal IReadOnlyDictionary<string, double> Tick(Func<string, double> liveRead)
    {
        reader = liveRead;
        pending.Clear();
        // Allow CLR/JIT and host binding setup once, while still bounding startup.
        budgetMilliseconds = firstTick ? 250 : 20;
        firstTick = false;
        clock.Restart();
        using var watchdog = StartWatchdog();
        try
        {
            engine.Invoke("__flightTick");
            // Also reject an over-budget invocation that finished between watchdog polls.
            if (clock.Elapsed.TotalMilliseconds > budgetMilliseconds)
                throw new TimeoutException($"flightTick exceeded its {budgetMilliseconds} ms budget.");
            return new Dictionary<string, double>(pending, StringComparer.Ordinal);
        }
        catch
        {
            pending.Clear();
            throw;
        }
        finally
        {
            EndInvocation();
            reader = null;
            clock.Stop();
        }
    }

    private Timer StartWatchdog()
    {
        long current;
        lock (interruptGate) current = ++invocation;
        return new Timer(_ =>
        {
            lock (interruptGate)
            {
                if (invocation == current) engine.Interrupt();
            }
        }, null, (int)budgetMilliseconds, Timeout.Infinite);
    }

    private void EndInvocation()
    {
        lock (interruptGate) invocation++;
    }

    private double Read(string key)
    {
        if (reader == null)
            throw new InvalidOperationException("Vessel access is only available during flightTick.");
        return pending.TryGetValue(key, out var value) ? value : reader(key);
    }

    private void Write(string key, double value)
    {
        if (reader == null)
            throw new InvalidOperationException("Control writes require a flightTick invocation.");
        var minimum = key == "control.throttle" ? 0 : -1;
        if (double.IsNaN(value) || double.IsInfinity(value) || value < minimum || value > 1)
            throw new ArgumentOutOfRangeException(nameof(value), "Throttle must be 0..1; axes must be -1..1.");
        pending[key] = value;
    }

    public void Dispose() => engine.Dispose();
}

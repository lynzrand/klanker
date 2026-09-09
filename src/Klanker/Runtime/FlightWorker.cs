using System;
using System.Diagnostics;
using System.Threading;
using Microsoft.ClearScript;
using Microsoft.ClearScript.JavaScript;
using Microsoft.ClearScript.V8;

namespace Klanker.Runtime;

// Binds the view for one synchronous callback; commits buffers only on success.
internal sealed class FlightWorker : IDisposable
{
    private readonly V8ScriptEngine engine;
    private readonly Stopwatch clock = new();
    private readonly FlightContext context = new();
    private readonly Action<string>? log;
    private readonly Stopwatch logWindow = Stopwatch.StartNew();
    private int logCount;
    private bool truncationReported;
    private bool rateLimitReported;
    private double budgetMilliseconds;
    private bool firstTick = true;
    private readonly object interruptGate = new();
    private long invocation;

    internal FlightWorker(string source, Action<string>? log = null)
    {
        this.log = log;
        engine = new V8ScriptEngine();
        try
        {
            engine.DefaultAccess = ScriptAccess.None;
            engine.AllowReflection = false;
            engine.ExposeHostObjectStaticMembers = false;
            engine.DisableExtensionMethods = true;
            engine.MaxRuntimeHeapSize = (UIntPtr)(64UL * 1024 * 1024);
            engine.AddHostObject("__context", context);
            engine.AddHostObject("__log", new Action<string, bool>(Log));
            engine.DocumentSettings.AddSystemDocument("worker", ModuleCategory.Standard, source);
            budgetMilliseconds = 2000;
            clock.Restart();
            using var watchdog = StartWatchdog();
            // Install before the worker module runs, so top-level logs work too.
            engine.Execute("""
                (() => {
                    const emit = globalThis.__log;
                    delete globalThis.__log;
                    const format = value => {
                        if (typeof value === 'string') return value;
                        try { return JSON.stringify(value) ?? String(value); }
                        catch { return String(value); }
                    };
                    Object.defineProperty(globalThis, 'console', {
                        value: Object.freeze({
                            log: (...args) => {
                                const text = args.slice(0, 32).map(format).join(' ');
                                emit(text.slice(0, 2048), text.length > 2048 || args.length > 32);
                            }
                        }),
                        writable: false, configurable: false
                    });
                })();
                """);
            engine.Execute(new DocumentInfo("klanker-entry") { Category = ModuleCategory.Standard }, """
                import worker from 'worker';
                if (!worker || typeof worker.flightTick !== 'function')
                    throw new TypeError('Worker must export default { flightTick(ctx) { ... } }');
                const ctx = globalThis.__context;
                delete globalThis.__context;
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

    internal void Tick(Vessel vessel, FlightCtrlState controls)
    {
        context.Begin(vessel, controls);
        // Allow CLR/JIT and host binding setup once, while still bounding startup.
        budgetMilliseconds = firstTick ? 250 : 20;
        firstTick = false;
        clock.Restart();
        try
        {
            using var watchdog = StartWatchdog();
            engine.Invoke("__flightTick");
            // Also reject an over-budget invocation that finished between watchdog polls.
            if (clock.Elapsed.TotalMilliseconds > budgetMilliseconds)
                throw new TimeoutException($"flightTick exceeded its {budgetMilliseconds} ms budget.");
            context.Commit();
        }
        finally
        {
            EndInvocation();
            context.End();
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

    private void Log(string message, bool truncated)
    {
        if (logWindow.Elapsed.TotalSeconds >= 1)
        {
            logWindow.Restart();
            logCount = 0;
            truncationReported = false;
            rateLimitReported = false;
        }
        if (logCount >= 20)
        {
            if (!rateLimitReported)
            {
                rateLimitReported = true;
                log?.Invoke("WARNING: console.log rate limit reached (20 messages/second); further messages are dropped until the next window.");
            }
            return;
        }
        logCount++;
        log?.Invoke(message.Length > 2048 ? message.Substring(0, 2048) : message);
        if ((truncated || message.Length > 2048) && !truncationReported)
        {
            truncationReported = true;
            log?.Invoke("WARNING: console.log output was truncated (2048 UTF-16 code units / 32 arguments per message).");
        }
    }

    public void Dispose() => engine.Dispose();
}

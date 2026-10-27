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
    private readonly FlightContext context = new();
    private readonly Action<string>? log;
    private readonly Stopwatch logWindow = Stopwatch.StartNew();
    private int logCount;
    private bool truncationReported;
    private bool firstTick = true;
    private int consecutiveOverruns;
    private readonly object interruptGate = new();
    private long invocation;
    private readonly Action<FlightWorker>? onDisposed;
    internal bool IsDisposed { get; private set; }

    // Standalone mode remains for isolated smoke tests and the startup benchmark.
    // Production workers are created through the addon-owned WorkerRuntime.
    internal FlightWorker(string source, Action<string>? log = null, string storageJson = "{}",
        V8Runtime? sharedRuntime = null, Action<FlightWorker>? onDisposed = null)
    {
        this.log = log;
        this.onDisposed = onDisposed;
        engine = sharedRuntime == null ? new V8ScriptEngine() : sharedRuntime.CreateScriptEngine();
        try
        {
            engine.DefaultAccess = ScriptAccess.None;
            engine.AllowReflection = false;
            // Use reflection-based host binding instead of the DLR. ClearScript's
            // dynamic path loads Microsoft.CSharp.dll, and the Mono build KSP
            // 1.12 runs ships a Microsoft.CSharp that calls
            // String.Split(char, StringSplitOptions), an overload Unity 2019.4's
            // mscorlib lacks, so any host method call (vessel.stage(),
            // vessel.parts.get(i)) faults with MissingMethodException. Reflection
            // binding never engages that assembly. Access is still gated by
            // DefaultAccess=None: only [ScriptMember] members are reachable.
            engine.DisableDynamicBinding = true;
            engine.ExposeHostObjectStaticMembers = false;
            engine.DisableExtensionMethods = true;
            if (sharedRuntime == null) engine.MaxRuntimeHeapSize = (UIntPtr)(64UL * 1024 * 1024);
            engine.AddHostObject("__context", context);
            engine.AddHostObject("__log", new Action<string, bool>(Log));
            engine.AddHostObject("__loadStorage", new Func<string>(() => storageJson));
            engine.DocumentSettings.AddSystemDocument("worker", ModuleCategory.Standard, source);
            using var watchdog = StartWatchdog(2000);
            engine.Execute(StorageBootstrap);
            context.BindStorage((ScriptObject)engine.Evaluate("__storage"));
            engine.Execute("delete globalThis.__storage");
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
                import definition from 'worker';
                if (typeof definition !== 'function')
                    throw new TypeError('Worker must export a zero-argument class constructor; object exports were removed in 0.2.0');
                const worker = new definition();
                if (!worker || typeof worker.flightTick !== 'function')
                    throw new TypeError('Worker constructor must produce an instance with flightTick(ctx)');
                for (const name of ['onLoad', 'onSave']) {
                    if (worker[name] !== undefined && typeof worker[name] !== 'function')
                        throw new TypeError(name + ' must be a function');
                }
                const ctx = globalThis.__context;
                delete globalThis.__context;
                const lifecycle = Object.freeze({ storage: ctx.storage });
                const synchronous = (result, name) => {
                    if (result && typeof result.then === 'function')
                        throw new TypeError(name + ' must be synchronous');
                };
                if (worker.onLoad) synchronous(worker.onLoad(lifecycle), 'onLoad');
                const snapshot = globalThis.__snapshotStorage;
                globalThis.__snapshotStorage = () => {
                    if (worker.onSave) synchronous(worker.onSave(lifecycle), 'onSave');
                    return snapshot();
                };
                globalThis.__flightTick = () => {
                    synchronous(worker.flightTick(ctx), 'flightTick');
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
        }
    }

    // Captured before user code runs. Serialization is bounded separately from flightTick,
    // with no vessel binding, so an accidental getter cannot read stale flight state.
    private const string StorageBootstrap = """
        (() => {
            const parse = JSON.parse, stringify = JSON.stringify;
            const prototype = Object.getPrototypeOf, descriptors = Object.getOwnPropertyDescriptors;
            const keys = Reflect.ownKeys, isArray = Array.isArray, finite = Number.isFinite;
            const plain = Object.prototype, arrayPrototype = Array.prototype;
            const create = Object.create, setPrototype = Object.setPrototypeOf;
            const storage = parse(globalThis.__loadStorage());
            delete globalThis.__loadStorage;
            if (!storage || isArray(storage) || prototype(storage) !== plain)
                throw new TypeError('Saved storage must be a JSON object.');
            globalThis.__storage = storage;
            globalThis.__snapshotStorage = () => {
                const ancestors = new Set();
                let nodes = 0;
                let characters = 0;
                function copy(value, depth) {
                    if (++nodes > 10000 || depth > 32)
                        throw new RangeError('Storage is limited to 10000 values and 32 nesting levels.');
                    if (value === null || typeof value === 'boolean') return value;
                    if (typeof value === 'string') {
                        characters += value.length;
                        if (characters > 65536) throw new RangeError('Storage text exceeds 64 KiB.');
                        return value;
                    }
                    if (typeof value === 'number' && finite(value)) return value;
                    if (typeof value !== 'object')
                        throw new TypeError('Storage accepts only JSON values: no undefined, functions, symbols, BigInt or nonfinite numbers.');
                    const array = isArray(value), proto = prototype(value);
                    if (array ? proto !== arrayPrototype : proto !== plain && proto !== null)
                        throw new TypeError('Storage accepts only plain objects and arrays, not host objects or class instances.');
                    if (ancestors.has(value)) throw new TypeError('Storage cannot contain cycles.');
                    ancestors.add(value);
                    const properties = descriptors(value);
                    const result = array ? setPrototype([], null) : create(null);
                    if (array && value.length > 10000) throw new RangeError('Storage array exceeds 10000 elements.');
                    for (const key of keys(properties)) {
                        if (array && key === 'length') continue;
                        if (typeof key !== 'string') throw new TypeError('Storage cannot contain symbol keys.');
                        characters += key.length;
                        if (characters > 65536) throw new RangeError('Storage text exceeds 64 KiB.');
                        const property = properties[key];
                        if (!('value' in property) || !property.enumerable)
                            throw new TypeError('Storage cannot contain accessors or hidden properties.');
                        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
                            throw new TypeError('Storage arrays cannot contain named properties.');
                        result[key] = copy(property.value, depth + 1);
                    }
                    if (array && keys(properties).length !== value.length + 1)
                        throw new TypeError('Storage arrays cannot contain holes.');
                    ancestors.delete(value);
                    return result;
                }
                return stringify(copy(storage, 0));
            };
        })();
        """;

    internal string SnapshotStorage()
    {
        const int budgetMilliseconds = 250;
        var started = Stopwatch.GetTimestamp();
        try
        {
            using var watchdog = StartWatchdog(budgetMilliseconds);
            var json = (string)engine.Invoke("__snapshotStorage");
            if ((Stopwatch.GetTimestamp() - started) * 1000d / Stopwatch.Frequency > budgetMilliseconds)
                throw new TimeoutException("Storage serialization exceeded 250 ms.");
            return json;
        }
        finally { EndInvocation(); }
    }

    internal void Tick(Vessel vessel, FlightCtrlState controls)
    {
        context.Begin(vessel, controls);
        // Allow CLR/JIT and host binding setup once, while still bounding startup.
        var first = firstTick;
        var budgetMilliseconds = first ? 250 : 20;
        // The interrupt is a runaway backstop, not the soft budget: it fires well
        // after the budget so a GC or OS stall cannot be mistaken for a stuck
        // handler. A real hang is still stopped in a fraction of a second.
        var interruptAfter = first ? 250 : 200;
        firstTick = false;
        var started = Stopwatch.GetTimestamp();
        try
        {
            using var watchdog = StartWatchdog(interruptAfter);
            engine.Invoke("__flightTick");
            if ((Stopwatch.GetTimestamp() - started) * 1000d / Stopwatch.Frequency > budgetMilliseconds)
            {
                // A single over-budget tick is usually a GC or OS stall, not
                // worker code. Tolerate an isolated one; two in a row mean the
                // handler itself is too heavy, and a real hang is already
                // stopped by the interrupt above.
                if (++consecutiveOverruns >= 2)
                    throw new TimeoutException(
                        $"flightTick exceeded its {budgetMilliseconds} ms budget on consecutive ticks.");
            }
            else
            {
                consecutiveOverruns = 0;
            }
            context.Commit();
        }
        finally
        {
            EndInvocation();
            context.End();
        }
    }

    private Timer StartWatchdog(int budgetMilliseconds)
    {
        long current;
        lock (interruptGate) current = ++invocation;
        return new Timer(_ =>
        {
            lock (interruptGate)
            {
                if (invocation == current) engine.Interrupt();
            }
        }, null, budgetMilliseconds, Timeout.Infinite);
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
        }
        if (logCount >= 20)
        {
            if (logCount == 20)
            {
                // Saturate at 21 to record that this window has already warned.
                logCount++;
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

    public void Dispose()
    {
        if (IsDisposed) return;
        IsDisposed = true;
        EndInvocation();
        context.End();
        try { engine.Dispose(); }
        finally { onDisposed?.Invoke(this); }
    }
}

using System;
using System.Collections.Generic;
using Microsoft.ClearScript.V8;

namespace Klanker.Runtime;

// One isolate per addon scene. Contexts have separate globals but share this heap.
internal sealed class WorkerRuntime : IDisposable
{
    private readonly V8Runtime runtime = new("Klanker scene");
    private readonly HashSet<FlightWorker> workers = new();
    private bool disposed;
    internal int ContextCount => workers.Count;

    internal WorkerRuntime()
    {
        runtime.MaxHeapSize = (UIntPtr)(64UL * 1024 * 1024);
        try
        {
            // Load V8 and exercise our bindings/module bootstrap before the user
            // clicks Assign. Keep the isolate alive after discarding this context.
            using var warmup = CreateWorker("export default class { flightTick() {} };");
        }
        catch { runtime.Dispose(); throw; }
    }

    internal FlightWorker CreateWorker(string source, Action<string>? log = null, string storageJson = "{}")
    {
        if (disposed) throw new ObjectDisposedException(nameof(WorkerRuntime));
        var worker = new FlightWorker(source, log, storageJson, runtime, released => workers.Remove(released));
        workers.Add(worker);
        return worker;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        var remaining = new FlightWorker[workers.Count];
        workers.CopyTo(remaining);
        foreach (var worker in remaining) worker.Dispose();
        runtime.Dispose();
    }
}

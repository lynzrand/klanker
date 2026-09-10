using System;
using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Threading;
using Klanker.Runtime;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Klanker.Bridge;

// Owns the local bridge for the scene and runs its commands on the main thread.
[KSPAddon(KSPAddon.Startup.FlightAndEditor, false)]
[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
    Justification = "Unity owns the addon lifetime; OnDestroy disposes the bridge.")]
public sealed class KlankerBridge : MonoBehaviour
{
    private sealed class Pending
    {
        internal Pending(string method, JObject parameters)
        {
            Method = method;
            Parameters = parameters;
        }
        internal string Method { get; }
        internal JObject Parameters { get; }
        internal JObject? Result { get; set; }
        internal Exception? Error { get; set; }
        internal ManualResetEventSlim Completed { get; } = new(false);
    }

    private readonly ConcurrentQueue<Pending> pending = new();
    private BridgeServer? server;

    public void Awake()
    {
        KlankerLog.Message += OnLog;
        try
        {
            server = new BridgeServer(Handle, BridgePaths.NewToken(), BridgePaths.DiscoveryPath);
            Debug.Log($"[Klanker] Bridge listening on 127.0.0.1:{server.Port}. Endpoint: {server.DiscoveryPath}");
        }
        catch (Exception exception)
        {
            Debug.LogError("[Klanker] Bridge failed to start: " + exception);
        }
    }

    // Called on a listener thread; blocks until Update processes the command.
    private JObject Handle(string method, JObject parameters)
    {
        var command = new Pending(method, parameters);
        pending.Enqueue(command);
        if (!command.Completed.Wait(TimeSpan.FromSeconds(10)))
            throw new TimeoutException("The game did not process the request in time.");
        if (command.Error != null) throw command.Error;
        return command.Result ?? new JObject();
    }

    public void Update()
    {
        while (pending.TryDequeue(out var command))
        {
            try { command.Result = BridgeDispatcher.Execute(command.Method, command.Parameters); }
            catch (Exception exception) { command.Error = exception; }
            finally { command.Completed.Set(); }
        }
    }

    private void OnLog(string workerId, string fileName, string message) =>
        server?.Broadcast("log", new JObject { ["workerId"] = workerId, ["file"] = fileName, ["message"] = message });

    public void OnDestroy()
    {
        KlankerLog.Message -= OnLog;
        server?.Dispose();
        server = null;
    }
}

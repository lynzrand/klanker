using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Klanker.Bridge;

// Loopback-only JSONL command bridge. Each connection authenticates with the
// per-session token, sends one request per line, and receives one response per
// request plus unsolicited events (worker logs). The command handler runs on a
// listener thread; in-game it marshals to the Unity main thread and blocks until
// that frame processes the command.
internal sealed class BridgeServer : IDisposable
{
    private readonly Func<string, JObject, JObject> handler;
    private readonly TcpListener listener;
    private readonly List<Client> clients = new();
    private readonly object clientsLock = new();
    private readonly ConcurrentQueue<string> events = new();
    private readonly AutoResetEvent eventSignal = new(false);
    private readonly Thread acceptThread;
    private readonly Thread eventThread;
    private volatile bool disposed;

    internal BridgeServer(Func<string, JObject, JObject> handler, string token, string discoveryPath)
    {
        this.handler = handler ?? throw new ArgumentNullException(nameof(handler));
        Token = token ?? throw new ArgumentNullException(nameof(token));
        DiscoveryPath = discoveryPath ?? throw new ArgumentNullException(nameof(discoveryPath));
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "Klanker bridge accept" };
        eventThread = new Thread(EventLoop) { IsBackground = true, Name = "Klanker bridge events" };
        acceptThread.Start();
        eventThread.Start();
        WriteDiscovery();
    }

    internal int Port { get; }
    internal string Token { get; }
    internal string DiscoveryPath { get; }

    // Events are queued, so a slow client never stalls the main thread.
    internal void Broadcast(string eventName, JObject data) =>
        events.Enqueue(new JObject { ["event"] = eventName, ["data"] = data }.ToString(Formatting.None));

    private void AcceptLoop()
    {
        while (!disposed)
        {
            TcpClient tcp;
            try { tcp = listener.AcceptTcpClient(); }
            catch (SocketException) { if (disposed) return; continue; }
            catch (ObjectDisposedException) { return; }
            catch (InvalidOperationException) { return; }
            tcp.NoDelay = true;
            var client = new Client(tcp);
            lock (clientsLock) clients.Add(client);
            new Thread(() => Serve(client)) { IsBackground = true, Name = "Klanker bridge client" }.Start();
        }
    }

    private void Serve(Client client)
    {
        try
        {
            using var reader = new StreamReader(client.Stream, new UTF8Encoding(false), false, 4096, true);
            string? line;
            while ((line = reader.ReadLine()) != null)
            {
                JToken? id = null;
                try
                {
                    var request = JObject.Parse(line);
                    id = request["id"];
                    if ((string?)request["token"] != Token)
                    {
                        client.Send(Response(id, false, "Unauthorized.", null));
                        continue;
                    }
                    var method = (string?)request["method"] ?? "";
                    var parameters = request["params"] as JObject ?? new JObject();
                    client.Send(Response(id, true, null, handler(method, parameters)));
                }
                catch (JsonException)
                {
                    client.Send(Response(id, false, "Invalid JSON.", null));
                }
                catch (Exception exception)
                {
                    client.Send(Response(id, false, exception.Message, null));
                }
            }
        }
        catch (Exception)
        {
            // Connection dropped; fall through to cleanup.
        }
        finally
        {
            lock (clientsLock) clients.Remove(client);
            client.Dispose();
        }
    }

    private void EventLoop()
    {
        while (!disposed)
        {
            eventSignal.WaitOne(200);
            while (events.TryDequeue(out var message))
            {
                Client[] snapshot;
                lock (clientsLock) snapshot = clients.ToArray();
                foreach (var client in snapshot) client.Send(message);
            }
        }
    }

    private void WriteDiscovery()
    {
        var directory = Path.GetDirectoryName(DiscoveryPath);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        var payload = new JObject
        {
            ["version"] = 1,
            ["port"] = Port,
            ["token"] = Token,
            ["pid"] = Process.GetCurrentProcess().Id,
        };
        File.WriteAllText(DiscoveryPath, payload.ToString(Formatting.None));
        BridgePaths.RestrictToOwner(DiscoveryPath);
    }

    private static string Response(JToken? id, bool ok, string? error, JObject? result)
    {
        var response = new JObject { ["id"] = id == null ? JValue.CreateNull() : id.DeepClone(), ["ok"] = ok };
        if (error != null) response["error"] = error;
        else response["result"] = result ?? new JObject();
        return response.ToString(Formatting.None);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        try { listener.Stop(); } catch (Exception) { }
        eventSignal.Set();
        Client[] snapshot;
        lock (clientsLock)
        {
            snapshot = clients.ToArray();
            clients.Clear();
        }
        foreach (var client in snapshot) client.Dispose();
        try { if (File.Exists(DiscoveryPath)) File.Delete(DiscoveryPath); } catch (Exception) { }
        eventSignal.Dispose();
    }

    private sealed class Client : IDisposable
    {
        private readonly object writeLock = new();
        internal Client(TcpClient tcp)
        {
            Tcp = tcp;
            Stream = tcp.GetStream();
        }
        internal TcpClient Tcp { get; }
        internal NetworkStream Stream { get; }
        internal void Send(string json)
        {
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            lock (writeLock)
            {
                try
                {
                    Stream.Write(bytes, 0, bytes.Length);
                    Stream.Flush();
                }
                catch (Exception)
                {
                    // Client went away; the read loop will clean up.
                }
            }
        }
        public void Dispose() { try { Tcp.Close(); } catch (Exception) { } }
    }
}

using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Klanker;
using Klanker.Bridge;
using Klanker.Runtime;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class BridgeTests
{
    internal static void Run(string plugins)
    {
        KSPUtil.ApplicationRootPath = Path.GetFullPath(Path.Combine(plugins, "..", "..", ".."));
        HighLogic.LoadedSceneIsFlight = true;
        var addon = new FlightAddon();
        addon.Awake();
        var vessel = new Vessel();
        var pod = new KlankerComputer();
        pod.part.vessel = vessel;
        pod.AssignScript("bridge.js", "export default class { flightTick() {} };");
        pod.OnStart(PartModule.StartState.Flying);
        pod.Computer.Program.SetAlias("guidance");
        pod.Computer.SetAuthority(true);
        var discovery = Path.Combine(Path.GetTempPath(), "klanker-bridge-" + Guid.NewGuid().ToString("N") + ".json");
        try
        {
            RunTransport(discovery);
            Check(!File.Exists(discovery), "bridge removes its discovery file on dispose");
        }
        finally
        {
            pod.OnDestroy();
            addon.OnDestroy();
            HighLogic.LoadedSceneIsFlight = false;
            if (File.Exists(discovery)) File.Delete(discovery);
        }
    }

    private static void RunTransport(string discovery)
    {
        using var server = new BridgeServer(BridgeDispatcher.Execute, "test-token", discovery);
        Check(File.Exists(discovery), "bridge writes a discovery file");
        using var client = new TcpClient();
        client.Connect(IPAddress.Loopback, server.Port);
        var stream = client.GetStream();
        using var reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, true) { AutoFlush = true };

        var nextId = 0;
        JObject Call(string method, JObject? parameters = null, string token = "test-token")
        {
            var request = new JObject { ["id"] = ++nextId, ["token"] = token, ["method"] = method };
            if (parameters != null) request["params"] = parameters;
            writer.WriteLine(request.ToString(Formatting.None));
            var line = reader.ReadLine() ?? throw new InvalidOperationException("Bridge closed the connection.");
            return JObject.Parse(line);
        }
        JObject Ok(string method, JObject? parameters = null)
        {
            var response = Call(method, parameters);
            if ((bool?)response["ok"] != true) throw new InvalidOperationException("Bridge error: " + response["error"]);
            return (JObject)response["result"]!;
        }
        JObject Target(string alias) => new() { ["target"] = new JObject { ["alias"] = alias } };

        Check((bool?)Ok("ping")["pong"] == true, "bridge ping");
        var actors = (JArray)Ok("list")["actors"]!;
        var listed = false;
        foreach (var actor in actors) if ((string?)actor["alias"] == "guidance") listed = true;
        Check(listed, "bridge lists the aliased actor");

        var denied = Call("list", token: "wrong-token");
        Check((bool?)denied["ok"] == false && (string?)denied["error"] == "Unauthorized.", "bridge rejects a bad token");

        var deployed = Ok("deploy", new JObject
        {
            [ "target" ] = new JObject { ["alias"] = "guidance" },
            ["file"] = "new.js",
            ["source"] = "export default class { flightTick() {} };",
            ["run"] = true,
        });
        Check((string?)deployed["file"] == "new.js" && (bool?)deployed["runRequested"] == true, "bridge deploys and runs");

        var state = Ok("state.get", Target("guidance"));
        Check((string?)state["storage"] == "{}", "bridge reads storage");

        server.Broadcast("log", new JObject { ["message"] = "hello" });
        var message = JObject.Parse(reader.ReadLine() ?? throw new InvalidOperationException("No event."));
        Check((string?)message["event"] == "log" && (string?)message["data"]!["message"] == "hello",
            "bridge broadcasts events to clients");

        var unknown = Call("does.not.exist");
        Check((bool?)unknown["ok"] == false, "bridge rejects an unknown method");
    }

    private static void Check(bool condition, string label)
    {
        if (!condition) throw new Exception("FAIL: " + label);
        Console.WriteLine("PASS: " + label);
    }
}

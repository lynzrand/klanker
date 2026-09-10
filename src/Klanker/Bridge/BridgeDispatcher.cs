using System;
using Klanker.Runtime;
using Newtonsoft.Json.Linq;

namespace Klanker.Bridge;

// Executes bridge requests against the live computer registry. Must run on the
// Unity main thread; the transport marshals to it.
internal static class BridgeDispatcher
{
    internal static JObject Execute(string method, JObject parameters)
    {
        switch (method)
        {
            case "ping": return new JObject { ["pong"] = true };
            case "list": return List();
            case "deploy": return Deploy(parameters);
            case "restart": return Act(parameters, computer => computer.Computer.Start());
            case "stop": return Act(parameters, computer => computer.Computer.Stop());
            case "alias": return SetAlias(parameters);
            case "state.get": return GetState(parameters);
            case "state.reset": return ResetState(parameters);
            default: throw new InvalidOperationException("Unknown method: " + method);
        }
    }

    private static JObject List()
    {
        var actors = new JArray();
        foreach (var computer in KlankerComputer.Registry) actors.Add(Describe(computer));
        return new JObject { ["actors"] = actors };
    }

    private static JObject Deploy(JObject parameters)
    {
        var computer = Resolve(parameters);
        var fileName = (string?)parameters["file"] ?? "";
        var source = (string?)parameters["source"] ?? "";
        ComputerProgram.Validate(fileName, source);
        computer.AssignScript(fileName, source);
        if ((bool?)parameters["run"] == true) computer.Computer.Start();
        return Describe(computer);
    }

    private static JObject Act(JObject parameters, Action<KlankerComputer> action)
    {
        var computer = Resolve(parameters);
        action(computer);
        return Describe(computer);
    }

    private static JObject SetAlias(JObject parameters)
    {
        var computer = Resolve(parameters);
        computer.Computer.Program.SetAlias((string?)parameters["alias"] ?? "");
        return Describe(computer);
    }

    private static JObject GetState(JObject parameters)
    {
        var computer = Resolve(parameters);
        computer.Computer.CheckpointStorage();
        return new JObject
        {
            ["storage"] = computer.Computer.Program.StorageJson,
            ["error"] = computer.Computer.StorageError,
        };
    }

    private static JObject ResetState(JObject parameters)
    {
        var computer = Resolve(parameters);
        computer.Computer.Program.SetStorage("{}");
        return Describe(computer);
    }

    private static KlankerComputer Resolve(JObject parameters)
    {
        var target = parameters["target"] as JObject
            ?? throw new InvalidOperationException("A target with an id, alias, or active flag is required.");
        var id = (string?)target["id"];
        var alias = (string?)target["alias"];
        if ((bool?)target["active"] == true)
        {
            if (!string.IsNullOrEmpty(id) || !string.IsNullOrEmpty(alias))
                throw new InvalidOperationException("Target must not combine active with id or alias.");
            var vessel = HighLogic.LoadedSceneIsFlight ? FlightGlobals.ActiveVessel : null;
            return FlightAddon.FindActiveComputer(vessel)
                ?? throw new InvalidOperationException(
                    "No active computer: the active vessel's control-point part needs an enabled Klanker computer.");
        }
        if (string.IsNullOrEmpty(id) == string.IsNullOrEmpty(alias))
            throw new InvalidOperationException("Target must have exactly one of id or alias.");
        KlankerComputer? match = null;
        foreach (var computer in KlankerComputer.Registry)
        {
            var matched = !string.IsNullOrEmpty(id)
                ? computer.Computer.Program.WorkerId == id
                : string.Equals(computer.Computer.Program.Alias, alias, StringComparison.Ordinal);
            if (!matched) continue;
            if (match != null) throw new InvalidOperationException("Ambiguous alias; use the workerId instead.");
            match = computer;
        }
        return match ?? throw new InvalidOperationException("No matching actor.");
    }

    private static JObject Describe(KlankerComputer computer)
    {
        var program = computer.Computer.Program;
        return new JObject
        {
            ["workerId"] = program.WorkerId,
            ["alias"] = program.Alias,
            ["file"] = program.FileName,
            ["runRequested"] = program.RunRequested,
            ["fault"] = program.Fault,
            ["status"] = computer.Computer.Status,
            ["running"] = computer.Computer.IsRunning,
            ["successfulTicks"] = computer.Computer.SuccessfulTicks,
            ["storageError"] = computer.Computer.StorageError,
            ["vessel"] = computer.vessel?.vesselName ?? "",
            ["part"] = computer.part.partInfo.title,
            ["scene"] = HighLogic.LoadedSceneIsFlight ? "flight" : HighLogic.LoadedSceneIsEditor ? "editor" : "other",
        };
    }
}

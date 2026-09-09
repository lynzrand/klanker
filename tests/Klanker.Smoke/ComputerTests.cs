using System;
using System.Collections.Generic;
using System.IO;
using Klanker;
using Klanker.Runtime;

internal static class ComputerTests
{
    internal static void Run(string plugins)
    {
        using var runtimeHost = new WorkerRuntime();
        const string source = "// braces {} = // and unicode: 航天器\nexport default { flightTick({vessel}) { vessel.control.throttle = 0.25; } };";
        var program = new ComputerProgram();
        program.Assign("test.js", source);
        program.EnsureIdentity();
        program.RunRequested = true;
        var saved = Save(program, true);
        var restored = ComputerProgram.Load(key => saved.TryGetValue(key, out var value) ? value : null);
        Check(restored.Source == source && restored.WorkerId == program.WorkerId && restored.RunRequested, "script and identity round-trip without local file");
        var craft = Save(program, false);
        Check(craft["workerId"] == "", "craft template omits flight identity");
        var clone = program.CopyForNewPart();
        clone.EnsureIdentity();
        Check(clone.WorkerId != program.WorkerId && clone.Source == source, "copied pod gets independent identity and assignment");
        foreach (var name in new[] { "../test.js", "..\\test.js", "C:test.js", "", "test.txt" })
            Reject(() => ComputerProgram.Validate(name, source), "invalid filename " + name);
        Reject(() => ComputerProgram.Validate("huge.js", new string('界', ComputerProgram.MaximumBytes / 3 + 1)), "UTF-8 byte limit");
        var broken = new Dictionary<string, string>(saved) { ["scriptBase64"] = "!" };
        Reject(() => ComputerProgram.Load(key => broken.TryGetValue(key, out var value) ? value : null), "malformed saved script");
        broken["klankerVersion"] = "999";
        Reject(() => ComputerProgram.Load(key => broken.TryGetValue(key, out var value) ? value : null), "unknown schema");

        using (var worker = new ComputerWorker(restored, runtimeHost))
        {
            Check(!worker.IsRunning, "restoring metadata does not create a runtime");
            worker.SetAuthority(true);
            var testVessel = new Vessel();
            var testControls = new FlightCtrlState();
            worker.Tick(testVessel, testControls);
            Check(testControls.mainThrottle == 0.25f, "saved script starts on activation");
            Reject(() => worker.Assign("broken.js", "export default {};"), "failed replacement rejected");
            testControls.mainThrottle = 0;
            worker.Tick(testVessel, testControls);
            Check(worker.Program.Source == source && testControls.mainThrottle == 0.25f, "failed replacement retains saved and running script");
            worker.SetAuthority(false);
            Check(!worker.IsRunning && worker.Program.RunRequested, "standby releases runtime but retains run setting");
            Reject(() => worker.Tick(testVessel, testControls), "standby cannot tick");
            worker.SetAuthority(true);
            Check(worker.IsRunning, "reactivation recreates runtime");
            worker.Assign("fault.js", "export default { flightTick() { throw new Error('sticky'); } };");
            Reject(() => worker.Tick(testVessel, testControls), "worker fault");
            worker.SetAuthority(false);
            worker.SetAuthority(true);
            Check(!worker.IsRunning && worker.Program.Fault.Contains("sticky"), "fault survives authority changes");
            var faultSave = Save(worker.Program, true);
            using var loadedFault = new ComputerWorker(ComputerProgram.Load(key => faultSave.TryGetValue(key, out var value) ? value : null), runtimeHost);
            loadedFault.SetAuthority(true);
            Check(!loadedFault.IsRunning && loadedFault.Program.Fault.Contains("sticky"), "fault survives save/load without automatic retry");
            worker.Assign("test.js", source);
            Check(worker.IsRunning, "explicit successful reload recovers fault");
            worker.Stop();
            worker.SetAuthority(false);
            worker.SetAuthority(true);
            Check(!worker.IsRunning && !worker.Program.RunRequested, "stop survives reactivation");
        }

        KSPUtil.ApplicationRootPath = Path.GetFullPath(Path.Combine(plugins, "..", "..", ".."));
        HighLogic.LoadedSceneIsFlight = true;
        var addon = new FlightAddon();
        addon.Awake();
        var vessel = new Vessel();
        var a = Pod(vessel, source);
        var b = Pod(vessel, "export default { flightTick({vessel}) { vessel.control.throttle = 0.75; } };");
        try
        {
            FlightGlobals.ActiveVessel = vessel;
            vessel.ReferencePart = a.part;
            a.Computer.Start(); b.Computer.Start();
            addon.Update();
            var controls = new FlightCtrlState();
            vessel.Tick(controls);
            Check(controls.mainThrottle == 0.25f && vessel.SubscriberCount == 1, "one callback for the active pod");
            vessel.ReferencePart = b.part;
            controls.mainThrottle = 0.1f;
            vessel.Tick(controls); // No Update yet: the old pod must already be unable to write.
            Check(controls.mainThrottle == 0.1f && vessel.SubscriberCount == 0, "same-frame control point change revokes old pod");
            addon.Update(); vessel.Tick(controls);
            Check(controls.mainThrottle == 0.75f && !a.Computer.IsRunning && b.Computer.IsRunning, "new control point receives authority");
            PauseMenu.isOpen = true;
            controls.mainThrottle = 0.1f; vessel.Tick(controls);
            Check(controls.mainThrottle == 0.1f, "pause suppresses worker ticks");
            PauseMenu.isOpen = false;
            vessel.packed = true; vessel.Tick(controls); addon.Update();
            Check(!b.Computer.IsRunning && vessel.SubscriberCount == 0, "packing revokes authority");
            vessel.packed = false; addon.Update();
            var split = new Vessel { ReferencePart = b.part };
            b.part.vessel = split;
            controls.mainThrottle = 0.1f; vessel.Tick(controls);
            Check(controls.mainThrottle == 0.1f, "moved part cannot control its previous vessel");
            FlightGlobals.ActiveVessel = split; addon.Update(); split.Tick(controls);
            Check(controls.mainThrottle == 0.75f && vessel.SubscriberCount == 0 && split.SubscriberCount == 1, "same computer rebinds to new vessel");
            var sceneRuntime = FlightAddon.RuntimeHost;
            Check(sceneRuntime.ContextCount == 1, "scene runtime owns the active worker context");
            var node = new ConfigNode(); b.OnSave(node);
            var loaded = new KlankerComputer(); loaded.OnLoad(node); loaded.OnStart(PartModule.StartState.Flying);
            Check(loaded.Computer.Program.Source == b.Computer.Program.Source && loaded.Computer.Program.WorkerId == b.Computer.Program.WorkerId, "PartModule save/load wiring");
            var copy = new KlankerComputer(); copy.OnCopy(b);
            Check(copy.Computer.Program.WorkerId != b.Computer.Program.WorkerId && b.Computer.IsRunning, "copy does not dispose original runtime");
            HighLogic.LoadedSceneIsFlight = false;
            HighLogic.LoadedSceneIsEditor = true;
            var editor = new KlankerComputer(); editor.OnLoad(node); editor.OnStart(PartModule.StartState.Editor);
            var craftNode = new ConfigNode(); editor.OnSave(craftNode);
            Check(craftNode.GetValue("workerId") == "" && !editor.Computer.IsRunning, "editor keeps a non-running craft template");
            HighLogic.LoadedSceneIsEditor = false;
            HighLogic.LoadedSceneIsFlight = true;
            var launchA = new KlankerComputer(); launchA.OnLoad(craftNode); launchA.OnStart(PartModule.StartState.Flying);
            var launchB = new KlankerComputer(); launchB.OnLoad(craftNode); launchB.OnStart(PartModule.StartState.Flying);
            Check(launchA.Computer.Program.WorkerId != launchB.Computer.Program.WorkerId, "two launches of one craft get distinct identities");
            editor.OnDestroy(); launchA.OnDestroy(); launchB.OnDestroy();
            var corrupt = node.CreateCopy(); corrupt.SetValue("scriptBase64", "!", true);
            loaded.OnLoad(corrupt);
            var resaved = new ConfigNode(); loaded.OnSave(resaved);
            Check(resaved.GetValue("scriptBase64") == "!" && loaded.Computer.Program.Fault.Length > 0, "unreadable save retained for recovery");
            HighLogic.LoadedSceneIsFlight = false; HighLogic.LoadedSceneIsEditor = true;
            loaded.OnStart(PartModule.StartState.Editor);
            Check(loaded.Computer.Program.Fault.Length > 0, "editor does not hide an unreadable deployment");
            HighLogic.LoadedSceneIsFlight = true; HighLogic.LoadedSceneIsEditor = false;
            loaded.AssignScript("replacement.js", source); loaded.OnSave(resaved);
            Check(resaved.GetValue("scriptBase64") != "!", "explicit replacement clears unreadable save");
            loaded.OnDestroy(); copy.OnDestroy();
            addon.OnDestroy();
            Check(sceneRuntime.ContextCount == 0, "addon teardown releases its shared runtime contexts");
            Reject(() => sceneRuntime.CreateWorker(source), "addon runtime cannot be reused after scene teardown");
            Check(split.SubscriberCount == 0 && !b.Computer.IsRunning, "scene teardown unsubscribes and disposes runtime");
            Check(b.Computer.Program.RunRequested, "scene teardown retains requested run state");
        }
        finally
        {
            addon.OnDestroy(); a.OnDestroy(); b.OnDestroy();
            FlightGlobals.ActiveVessel = null; HighLogic.LoadedSceneIsFlight = false; PauseMenu.isOpen = false;
        }
    }

    private static KlankerComputer Pod(Vessel vessel, string source)
    {
        var pod = new KlankerComputer();
        pod.part.vessel = vessel; pod.part.Computer = pod;
        pod.AssignScript("test.js", source);
        pod.OnStart(PartModule.StartState.Flying);
        return pod;
    }

    private static Dictionary<string, string> Save(ComputerProgram program, bool flight)
    {
        var values = new Dictionary<string, string>();
        program.Save((key, value) => values[key] = value, flight);
        return values;
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

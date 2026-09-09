using System;
using System.Collections.Generic;
using Klanker;
using Klanker.Runtime;

internal static class StorageTests
{
    internal static void Run()
    {
        const string source = """
            export default { flightTick(ctx) {
                if (Object.getPrototypeOf(ctx.storage) !== Object.prototype) throw new Error('not a JS object');
                ctx.storage.count = (ctx.storage.count ?? 0) + 1;
                ctx.storage.nested = { label: '航天器 {}', values: [true, null, 2] };
                let rejected = false;
                try { ctx.storage = {}; } catch { rejected = true; }
                if (!rejected) throw new Error('root must be readonly');
            }};
            """;
        var vessel = new Vessel();
        var controls = new FlightCtrlState();
        var program = new ComputerProgram();
        using (var computer = new ComputerWorker(program))
        {
            computer.Assign("storage.js", source);
            computer.Start(); computer.SetAuthority(true);
            computer.Tick(vessel, controls);
            Check(program.StorageJson == "{}", "no JSON serialization on every physics tick");
            computer.CheckpointStorage();
            Check(program.StorageJson.Contains("\"count\":1") && program.StorageJson.Contains("航天器"), "JSON checkpoint preserves nested Unicode data");
            var saved = new Dictionary<string, string>();
            program.Save((key, value) => saved[key] = value, true);
            var restored = ComputerProgram.Load(key => saved.TryGetValue(key, out var value) ? value : null);
            Check(restored.StorageJson == program.StorageJson, "storage round-trip through part save encoding");
            computer.Tick(vessel, controls);
            computer.SetAuthority(false);
            Check(program.StorageJson.Contains("\"count\":2"), "authority release captures state");
            computer.SetAuthority(true); computer.Tick(vessel, controls);
            computer.Assign("storage.js", source); computer.Tick(vessel, controls); computer.Stop();
            Check(program.StorageJson.Contains("\"count\":4"), "storage survives restart and script replacement");
            using var restoredComputer = new ComputerWorker(restored);
            restoredComputer.Start(); restoredComputer.SetAuthority(true);
            restoredComputer.Tick(vessel, controls); restoredComputer.CheckpointStorage();
            Check(restored.StorageJson.Contains("\"count\":2"), "quicksave snapshot restores independently of later edits");
            saved.Remove("storageBase64");
            Check(ComputerProgram.Load(key => saved.TryGetValue(key, out var value) ? value : null).StorageJson == "{}", "old saves get empty storage");
        }

        foreach (var mutation in new[] {
            "storage.bad = undefined", "storage.bad = NaN", "storage.bad = 1n",
            "storage.bad = () => 1", "storage.bad = new Date()", "storage.self = storage",
            "storage.bad = vessel", "storage.bad = Array(2)",
            "Object.defineProperty(storage, 'bad', {enumerable:true, get() { while(true) {} }})",
            "storage.bad = '界'.repeat(30000)",
            "storage.bad = new Proxy({}, { ownKeys() { while(true) {} } })"
        })
        {
            var data = new ComputerProgram();
            data.SetStorage("{\"good\":7}");
            using var computer = new ComputerWorker(data);
            computer.Assign("bad.js", "export default { flightTick({storage, vessel}) { " + mutation + "; } };");
            computer.Start(); computer.SetAuthority(true); computer.Tick(vessel, controls);
            computer.CheckpointStorage();
            Check(data.StorageJson == "{\"good\":7}" && computer.StorageError.Length > 0, "invalid storage retains checkpoint: " + mutation);
        }
        using (var computer = new ComputerWorker(new ComputerProgram()))
        {
            computer.Assign("fault.js", "export default { flightTick({storage}) { storage.bad = 1; throw new Error('fault'); } };");
            computer.Start(); computer.SetAuthority(true);
            try { computer.Tick(vessel, controls); } catch { }
            Check(computer.Program.StorageJson == "{}", "fault discards changes since last storage checkpoint");
        }

        HighLogic.LoadedSceneIsFlight = true;
        var pod = new KlankerComputer();
        var copy = new KlankerComputer();
        var loaded = new KlankerComputer();
        try
        {
            pod.AssignScript("storage.js", source);
            pod.Computer.Start(); pod.Computer.SetAuthority(true); pod.Computer.Tick(vessel, controls);
            var node = new ConfigNode(); pod.OnSave(node);
            loaded.OnLoad(node);
            Check(loaded.Computer.Program.StorageJson.Contains("\"count\":1"), "KSP OnSave captures live storage");
            copy.OnCopy(pod);
            copy.Computer.Start(); copy.Computer.SetAuthority(true); copy.Computer.Tick(vessel, controls);
            copy.Computer.CheckpointStorage();
            Check(copy.Computer.Program.StorageJson.Contains("\"count\":2") &&
                pod.Computer.Program.StorageJson.Contains("\"count\":1"), "copied parts have independent storage");
        }
        finally { pod.OnDestroy(); copy.OnDestroy(); loaded.OnDestroy(); HighLogic.LoadedSceneIsFlight = false; }
    }
    private static void Check(bool condition, string label)
    {
        if (!condition) throw new Exception("FAIL: " + label);
        Console.WriteLine("PASS: " + label);
    }
}

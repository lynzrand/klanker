using System;
using System.Diagnostics.CodeAnalysis;
using Klanker.Runtime;
using UnityEngine;

namespace Klanker;

[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
    Justification = "Unity owns PartModule lifetime; OnDestroy disposes the worker.")]
public sealed class KlankerComputer : PartModule
{
    private ComputerWorker computer = new(new ComputerProgram());
    private ConfigNode? unreadableSave;
    internal ComputerWorker Computer => computer;

    internal void AssignScript(string fileName, string source)
    {
        computer.Assign(fileName, source);
        unreadableSave = null;
    }

    [KSPEvent(guiActive = true, guiActiveEditor = true, guiName = "Klanker worker…")]
    public void OpenComputer() => FlightAddon.Show(this);

    public override string GetInfo() => "Hosts a Klanker JavaScript worker. Configure it from the part's right-click menu.";

    public override void OnStart(StartState state)
    {
        base.OnStart(state);
        if (HighLogic.LoadedSceneIsFlight) computer.Program.EnsureIdentity();
        else if (HighLogic.LoadedSceneIsEditor && unreadableSave == null)
        {
            var template = computer.Program.CopyForNewPart();
            computer.Dispose();
            computer = new ComputerWorker(template);
        }
    }

    public override void OnLoad(ConfigNode node)
    {
        base.OnLoad(node);
        computer.Dispose();
        unreadableSave = null;
        try { computer = new ComputerWorker(ComputerProgram.Load(node.GetValue)); }
        catch (Exception exception)
        {
            // Preserve unknown/corrupt deployment data through autosaves until
            // the player explicitly replaces it with a valid assignment.
            unreadableSave = node.CreateCopy();
            computer = new ComputerWorker(new ComputerProgram { Fault = "Cannot load saved computer: " + exception.Message });
            Debug.LogError("[Klanker] " + exception);
        }
    }

    public override void OnSave(ConfigNode node)
    {
        base.OnSave(node);
        if (unreadableSave != null)
        {
            unreadableSave.CopyTo(node, true);
            return;
        }
        if (HighLogic.LoadedSceneIsFlight) computer.Program.EnsureIdentity();
        computer.CheckpointStorage();
        computer.Program.Save((key, value) => node.SetValue(key, value, true), HighLogic.LoadedSceneIsFlight);
    }

    public override void OnCopy(PartModule fromModule)
    {
        base.OnCopy(fromModule);
        if (fromModule is KlankerComputer source)
        {
            source.Computer.CheckpointStorage();
            if (!ReferenceEquals(computer, source.Computer)) computer.Dispose();
            computer = new ComputerWorker(source.Computer.Program.CopyForNewPart());
            unreadableSave = source.unreadableSave?.CreateCopy();
        }
        else
        {
            computer.Dispose();
            computer = new ComputerWorker(new ComputerProgram());
        }
        if (HighLogic.LoadedSceneIsFlight) computer.Program.EnsureIdentity();
    }

    public void OnDestroy() => computer.Dispose();
}

using System;
using System.IO;
using System.Text;
using Klanker.Runtime;
using Microsoft.ClearScript;
using UnityEngine;

namespace Klanker;

// Owns the scene UI and the single vessel callback, not the script assignment.
[KSPAddon(KSPAddon.Startup.FlightAndEditor, false)]
public sealed class FlightAddon : MonoBehaviour
{
    private static FlightAddon? instance;
    private KlankerComputer? selected;
    private KlankerComputer? active;
    private ComputerWorker? activeWorker;
    private Vessel? controlledVessel;
    private Rect window = new(30, 80, 440, 340);
    private string scriptName = "observe.js";
    private string message = "";
    private bool visible;

    public void Awake()
    {
        instance = this;
        visible = HighLogic.LoadedSceneIsFlight;
        HostSettings.AuxiliarySearchPath = Path.Combine(
            KSPUtil.ApplicationRootPath, "GameData", "Klanker", "Plugins", "PluginData");
        Debug.Log("[Klanker] Computer UI ready. F8 toggles it; part menus select a computer.");
    }

    internal static void Show(KlankerComputer computer)
    {
        if (instance == null) return;
        instance.Select(computer);
        instance.visible = true;
    }

    private void Select(KlankerComputer computer)
    {
        selected = computer;
        scriptName = computer.Computer.Program.HasScript ? computer.Computer.Program.FileName : "observe.js";
        message = "";
    }

    public void Update()
    {
        if (Input.GetKeyDown(KeyCode.F8)) visible = !visible;
        var vessel = HighLogic.LoadedSceneIsFlight ? FlightGlobals.ActiveVessel : null;
        var candidate = FindActiveComputer(vessel);
        if (candidate != active || vessel != controlledVessel ||
            (candidate != null && candidate.Computer != activeWorker))
        {
            ReleaseAuthority();
            if (candidate != null && vessel != null)
            {
                active = candidate;
                activeWorker = candidate.Computer;
                controlledVessel = vessel;
                activeWorker.SetAuthority(true);
                controlledVessel.OnFlyByWire += FlyByWire;
                Debug.Log("[Klanker] Active computer: " + candidate.Computer.Program.WorkerId);
            }
        }
        // A vanished or remote selection must not leave a UI that edits another vessel.
        if (HighLogic.LoadedSceneIsFlight && selected != null && selected.vessel != vessel) selected = null;
        if (selected == null && candidate != null) Select(candidate);
    }

    private static KlankerComputer? FindActiveComputer(Vessel? vessel)
    {
        if (vessel == null || !vessel.loaded || vessel.packed) return null;
        var reference = vessel.GetReferenceTransformPart();
        if (reference == null || reference.vessel != vessel) return null;
        var computer = reference.FindModuleImplementing<KlankerComputer>();
        return computer != null && computer.isEnabled && computer.moduleIsEnabled ? computer : null;
    }

    public void OnGUI()
    {
        if (visible) window = GUILayout.Window(GetInstanceID(), window, DrawWindow, "Klanker computers (F8)");
    }

    private void DrawWindow(int id)
    {
        if (selected == null)
        {
            GUILayout.Label("Right-click a command pod or probe core and choose Klanker worker…");
            GUILayout.Label("Missing that button? Check that ModuleManager and Klanker's command-computers patch are installed.");
        }
        else
        {
            var computer = selected.Computer;
            var program = computer.Program;
            GUILayout.Label("Computer: " + selected.part.partInfo.title);
            GUILayout.Label(program.WorkerId.Length == 0 ? "Worker identity assigned at launch." : "Worker: " + program.WorkerId);
            GUILayout.Label("Assigned: " + (program.HasScript ? program.FileName : "none"));
            GUILayout.Label(computer.Status);
            if (computer.StorageError.Length != 0) GUILayout.Label(computer.StorageError);
            GUILayout.Label($"Successful ticks: {computer.SuccessfulTicks}");
            GUILayout.Label("File in GameData/Klanker/Workers:");
            scriptName = GUILayout.TextField(scriptName, 100);
            if (GUILayout.Button("Assign / reload file")) AssignScript();
            var requested = GUILayout.Toggle(program.RunRequested, "Run when active (saved with this part)");
            if (requested != program.RunRequested) Invoke(() => { if (requested) computer.Start(); else computer.Stop(); });
            if (program.HasScript && GUILayout.Button("Start / restart assigned script")) Invoke(computer.Start);
            if (GUILayout.Button("Stop worker")) computer.Stop();
            if (active != null && active != selected && GUILayout.Button("Show active control point")) Select(active);
            if (HighLogic.LoadedSceneIsFlight && active == null)
                GUILayout.Label("No active computer. Use Control from Here on a command part.");
            if (message.Length != 0) GUILayout.Label(message);
        }
        GUI.DragWindow(new Rect(0, 0, 440, 22));
    }

    private void AssignScript()
    {
        if (selected == null) return;
        Invoke(() =>
        {
            ComputerProgram.Validate(scriptName, "");
            var path = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Klanker", "Workers", scriptName);
            if (new FileInfo(path).Length > ComputerProgram.MaximumBytes)
                throw new InvalidOperationException("Workers are limited to 128 KiB.");
            selected.AssignScript(scriptName, File.ReadAllText(path, new UTF8Encoding(false, true)));
            message = "Script copied into this part. Save the craft/game to keep it.";
        });
    }

    private void Invoke(Action action)
    {
        try { message = ""; action(); }
        catch (Exception exception)
        {
            message = exception.Message;
            Debug.LogError("[Klanker] " + exception);
        }
    }

    private void FlyByWire(FlightCtrlState controls)
    {
        var vessel = controlledVessel;
        var worker = activeWorker;
        // Check again inside the callback: control-point/topology changes can
        // happen between Update and the physics callback. Never let the old owner write.
        if (vessel == null || vessel != FlightGlobals.ActiveVessel || active == null ||
            FindActiveComputer(vessel) != active || active.Computer != worker)
        {
            ReleaseAuthority();
            return;
        }
        if (worker == null || !worker.IsRunning || PauseMenu.isOpen) return;
        try
        {
            worker.Tick(vessel, controls);
        }
        catch (Exception exception)
        {
            ScreenMessages.PostScreenMessage("Klanker worker faulted. Restart it from its computer window.", 8, ScreenMessageStyle.UPPER_CENTER);
            Debug.LogError("[Klanker] " + exception);
        }
    }

    private void ReleaseAuthority()
    {
        if (controlledVessel != null) controlledVessel.OnFlyByWire -= FlyByWire;
        activeWorker?.SetAuthority(false);
        controlledVessel = null;
        active = null;
        activeWorker = null;
    }

    public void OnDestroy()
    {
        ReleaseAuthority();
        if (instance == this) instance = null;
    }
}

using System;
using System.IO;
using System.Text;
using System.Diagnostics.CodeAnalysis;
using Klanker.Runtime;
using Microsoft.ClearScript;
using UnityEngine;

namespace Klanker;

// Owns the scene UI and the single vessel callback, not the script assignment.
[KSPAddon(KSPAddon.Startup.FlightAndEditor, false)]
[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
    Justification = "Unity owns the addon lifetime; OnDestroy disposes the scene runtime.")]
public sealed class FlightAddon : MonoBehaviour
{
    private static FlightAddon? instance;
    private KlankerComputer? selected;
    private KlankerComputer? active;
    private ComputerWorker? activeWorker;
    private Vessel? controlledVessel;
    private Rect window = new(30, 80, 440, 340);
    private string scriptName = "observe.js";
    private string aliasName = "";
    private string message = "";
    private bool visible;
    private WorkerRuntime? runtimeHost;
    private string runtimeError = "";
    internal static WorkerRuntime RuntimeHost => instance?.runtimeHost ??
        throw new InvalidOperationException("Klanker V8 runtime is not available in this scene.");

    public void Awake()
    {
        instance = this;
        visible = HighLogic.LoadedSceneIsFlight;
        HostSettings.AuxiliarySearchPath = Path.Combine(
            KSPUtil.ApplicationRootPath, "GameData", "Klanker", "Plugins", "PluginData");
        var watch = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            runtimeHost = new WorkerRuntime();
            Debug.Log($"[Klanker] Scene V8 runtime warmed in {watch.Elapsed.TotalMilliseconds:F1} ms.");
        }
        catch (Exception exception)
        {
            runtimeError = "V8 startup failed: " + exception.Message;
            Debug.LogError("[Klanker] " + exception);
        }
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
        aliasName = computer.Computer.Program.Alias;
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
        if (runtimeError.Length != 0) GUILayout.Label(runtimeError);
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
            GUILayout.Label("Alias (CLI selector, not unique): " + (program.Alias.Length == 0 ? "none" : program.Alias));
            aliasName = GUILayout.TextField(aliasName, ComputerProgram.MaximumAliasLength);
            if (GUILayout.Button("Set alias")) Invoke(() => { selected.Computer.Program.SetAlias(aliasName); message = "Alias set. Save the craft/game to keep it."; });
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
        runtimeHost?.Dispose();
        runtimeHost = null;
        if (instance == this) instance = null;
    }
}

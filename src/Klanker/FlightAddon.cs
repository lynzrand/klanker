using System;
using System.IO;
using Klanker.Runtime;
using Microsoft.ClearScript;
using UnityEngine;

namespace Klanker;

[KSPAddon(KSPAddon.Startup.Flight, false)]
public sealed class FlightAddon : MonoBehaviour
{
    private FlightWorker? worker;
    private Vessel? controlledVessel;
    private Rect window = new(30, 80, 360, 230);
    private string status = "Stopped. Load a worker to begin.";
    private string scriptName = "observe.js";
    private bool visible = true;
    private long ticks;

    public void Awake()
    {
        visible = true;
        HostSettings.AuxiliarySearchPath = Path.Combine(
            KSPUtil.ApplicationRootPath, "GameData", "Klanker", "Plugins", "PluginData");
        Debug.Log("[Klanker] Flight addon ready. Window visible; F8 toggles it.");
    }

    public void Update()
    {
        if (Input.GetKeyDown(KeyCode.F8)) visible = !visible;
        if (controlledVessel != null && controlledVessel != FlightGlobals.ActiveVessel)
            Stop("Stopped: active vessel changed. Load explicitly on the new vessel.");
    }

    public void OnGUI()
    {
        if (visible) window = GUILayout.Window(GetInstanceID(), window, DrawWindow, "Klanker flight PoC (F8)");
    }

    private void DrawWindow(int id)
    {
        GUILayout.Label("Worker in GameData/Klanker/Workers:");
        scriptName = GUILayout.TextField(scriptName, 100);
        GUILayout.Label(status);
        GUILayout.Label($"Successful ticks: {ticks}");
        if (GUILayout.Button("Load / reload worker")) LoadWorker();
        if (GUILayout.Button("Stop control")) Stop("Stopped by player.");
        GUI.DragWindow(new Rect(0, 0, 360, 22));
    }

    private void LoadWorker()
    {
        FlightWorker? candidate = null;
        try
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || !vessel.loaded || vessel.packed)
                throw new InvalidOperationException("An active, unpacked vessel is required.");
            if (Path.GetFileName(scriptName) != scriptName || !scriptName.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Enter a .js filename without directories.");
            var path = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Klanker", "Workers", scriptName);
            if (new FileInfo(path).Length > 128 * 1024)
                throw new InvalidOperationException("PoC workers are limited to 128 KiB.");
            candidate = new FlightWorker(File.ReadAllText(path));
            Stop("Stopped.");
            worker = candidate;
            candidate = null;
            controlledVessel = vessel;
            controlledVessel.OnFlyByWire += FlyByWire;
            ticks = 0;
            status = $"Running on {vessel.vesselName}";
            Debug.Log("[Klanker] " + status);
        }
        catch (Exception exception)
        {
            candidate?.Dispose();
            status = "Load failed: " + exception.Message + (worker != null ? " (previous worker still running)" : "");
            Debug.LogError("[Klanker] " + exception);
        }
    }

    private void FlyByWire(FlightCtrlState controls)
    {
        var vessel = controlledVessel;
        if (worker == null || vessel == null || vessel != FlightGlobals.ActiveVessel || vessel.packed || PauseMenu.isOpen)
            return;
        try
        {
            var writes = worker.Tick(key => key switch
            {
                "altitude" => vessel.altitude,
                "verticalSpeed" => vessel.verticalSpeed,
                "surfaceSpeed" => vessel.srfSpeed,
                "orbit.apoapsis" => vessel.orbit.ApA,
                "orbit.periapsis" => vessel.orbit.PeA,
                "control.throttle" => controls.mainThrottle,
                "control.pitch" => controls.pitch,
                "control.yaw" => controls.yaw,
                "control.roll" => controls.roll,
                _ => throw new InvalidOperationException("Unknown vessel property: " + key),
            });
            foreach (var write in writes)
            {
                var value = (float)write.Value;
                switch (write.Key)
                {
                    case "control.throttle": controls.mainThrottle = value; break;
                    case "control.pitch": controls.pitch = value; break;
                    case "control.yaw": controls.yaw = value; break;
                    case "control.roll": controls.roll = value; break;
                }
            }
            ticks++;
        }
        catch (Exception exception)
        {
            Stop("FAULTED: " + exception.Message);
            ScreenMessages.PostScreenMessage("Klanker fault: control released. Reload to restart.", 8, ScreenMessageStyle.UPPER_CENTER);
            Debug.LogError("[Klanker] " + exception);
        }
    }

    private void Stop(string message)
    {
        if (controlledVessel != null) controlledVessel.OnFlyByWire -= FlyByWire;
        controlledVessel = null;
        var previous = worker;
        worker = null;
        previous?.Dispose();
        status = message;
    }

    public void OnDestroy() => Stop("Flight scene closed.");
}

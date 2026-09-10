// Minimal host fixtures for exercising our real PartModule/coordinator source.
// They deliberately do not claim to emulate KSP loading, docking, or Unity physics.
using System;
using System.Collections.Generic;
using Klanker;

namespace UnityEngine
{
    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
    }
    public sealed class Transform
    {
        public Vector3 right = new(1, 0, 0), up = new(0, 1, 0), forward = new(0, 0, 1);
        public Vector3 InverseTransformDirection(Vector3 v) => new(
            v.x * right.x + v.y * right.y + v.z * right.z,
            v.x * up.x + v.y * up.y + v.z * up.z,
            v.x * forward.x + v.y * forward.y + v.z * forward.z);
    }
    public sealed class Rigidbody { public Vector3 angularVelocity; }
    public class MonoBehaviour { public int GetInstanceID() => GetHashCode(); }
    public struct Rect { public Rect(float x, float y, float w, float h) { } }
    public enum KeyCode { F8 }
    public static class Input { public static bool GetKeyDown(KeyCode key) => false; }
    public static class GUILayout
    {
        public static Rect Window(int id, Rect rect, Action<int> draw, string title) => rect;
        public static void Label(string text) { }
        public static string TextField(string text, int maximum) => text;
        public static bool Button(string text) => false;
        public static bool Toggle(bool value, string text) => value;
    }
    public static class GUI { public static void DragWindow(Rect rect) { } }
    public static class Debug
    {
        public static void Log(string text) { }
        public static void LogError(string text) { }
    }
}

[AttributeUsage(AttributeTargets.Class)]
public sealed class KSPAddon : Attribute
{
    public enum Startup { FlightAndEditor }
    public KSPAddon(Startup startup, bool once) { }
}
[AttributeUsage(AttributeTargets.Method)]
public sealed class KSPEvent : Attribute
{
    public bool guiActive, guiActiveEditor;
    public string guiName = "";
}
public class PartModule : UnityEngine.MonoBehaviour
{
    public enum StartState { Editor, Flying }
    public Part part = new();
    public Vessel? vessel => part.vessel;
    public bool isEnabled = true, moduleIsEnabled = true;
    public virtual string GetInfo() => "";
    public virtual void OnStart(StartState state) { }
    public virtual void OnLoad(ConfigNode node) { }
    public virtual void OnSave(ConfigNode node) { }
    public virtual void OnCopy(PartModule source) { }
}
public sealed class ConfigNode
{
    private readonly Dictionary<string, string> values = new();
    public string? GetValue(string key) => values.TryGetValue(key, out var value) ? value : null;
    public void SetValue(string key, string value, bool create) => values[key] = value;
    public ConfigNode CreateCopy() { var copy = new ConfigNode(); CopyTo(copy, true); return copy; }
    public void CopyTo(ConfigNode node, bool overwrite)
    {
        foreach (var pair in values) if (overwrite || node.GetValue(pair.Key) == null) node.SetValue(pair.Key, pair.Value, true);
    }
}
public sealed class AvailablePart { public string title = "Test pod"; }
public sealed class Part
{
    public UnityEngine.Rigidbody rb = new();
    public List<PartResource> Resources = new();
    public Vessel? vessel;
    public AvailablePart partInfo = new();
    public KlankerComputer? Computer;
    public T? FindModuleImplementing<T>() where T : class => Computer as T;
}
public sealed class PartResource { public string resourceName = ""; public double amount, maxAmount; }
public struct Vector3d
{
    public double x, y, z;
    public double magnitude => Math.Sqrt(x * x + y * y + z * z);
    public static explicit operator UnityEngine.Vector3(Vector3d v) => new((float)v.x, (float)v.y, (float)v.z);
}
public sealed class CelestialBody { public string bodyName = "Kerbin"; public double Radius, gravParameter; }
public sealed class Orbit
{
    public double ApA, PeA, timeToAp, timeToPe, eccentricity, inclination, semiMajorAxis, period;
}
public sealed class Vessel
{
    public Part rootPart = new();
    public UnityEngine.Transform ReferenceTransform = new();
    public Vector3d upAxis = new() { y = 1 }, north = new() { z = 1 }, east = new() { x = 1 };
    public enum Situations { PRELAUNCH, FLYING, ORBITING, ESCAPING }
    public Guid id = Guid.NewGuid();
    public string vesselName = "Test vessel";
    public Situations situation;
    public double latitude, longitude, terrainAltitude, horizontalSrfSpeed;
    public Vector3d srf_velocity, obt_velocity;
    public CelestialBody mainBody = new();
    public List<Part> parts = new();
    public float MassTonnes = 1;
    public float GetTotalMass() => MassTonnes;
    public bool loaded = true, packed;
    public Part? ReferencePart;
    public double altitude = 100, verticalSpeed, srfSpeed;
    public Orbit orbit = new();
    public ActionGroupList ActionGroups = new();
    public event Action<FlightCtrlState>? OnFlyByWire;
    public int SubscriberCount => OnFlyByWire?.GetInvocationList().Length ?? 0;
    public Part? GetReferenceTransformPart() => ReferencePart;
    public void Tick(FlightCtrlState controls) => OnFlyByWire?.Invoke(controls);
}
public enum KSPActionGroup { None, Stage, Gear, Light, RCS, SAS, Brakes, Abort, Custom01 }
public sealed class ActionGroupList
{
    private readonly Dictionary<KSPActionGroup, bool> states = new();
    public bool this[KSPActionGroup group] { get => states.TryGetValue(group, out var value) && value; set => states[group] = value; }
    public void SetGroup(KSPActionGroup group, bool value) => states[group] = value;
    public void ToggleGroup(KSPActionGroup group) => states[group] = !this[group];
}
public sealed class FlightCtrlState { public float mainThrottle, pitch, yaw, roll, X, Y, Z; }
public static class FlightGlobals { public static Vessel? ActiveVessel; }
public static class HighLogic { public static bool LoadedSceneIsFlight, LoadedSceneIsEditor; }
public static class KSPUtil { public static string ApplicationRootPath = ""; }
public static class Planetarium { public static double UniversalTime; public static double GetUniversalTime() => UniversalTime; }
public static class TimeWarp { public static float fixedDeltaTime = 0.02f; }
public static class PauseMenu { public static bool isOpen; }
public enum ScreenMessageStyle { UPPER_CENTER }
public static class ScreenMessages
{
    public static void PostScreenMessage(string text, float time, ScreenMessageStyle style) { }
}

namespace KSP.UI.Screens
{
    public sealed class StageManager
    {
        public static StageManager Instance = new();
        public int Activations;
        public static void ActivateNextStage() => Instance.Activations++;
    }
}

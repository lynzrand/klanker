using System;

namespace Klanker.Runtime;

// One part's deployment and disposable execution context. The scene coordinator
// grants authority to at most one instance; losing it never changes the assignment.
internal sealed class ComputerWorker : IDisposable
{
    private FlightWorker? runtime;
    private bool authority;
    internal ComputerProgram Program { get; }
    internal long SuccessfulTicks { get; private set; }
    internal bool IsRunning => runtime != null;
    internal string Status => Program.Fault.Length != 0 ? "FAULTED: " + Program.Fault :
        !Program.HasScript ? "No script assigned." :
        !Program.RunRequested ? "Stopped." :
        IsRunning ? "Running." : "Standby: waiting to be the active control point.";

    internal ComputerWorker(ComputerProgram program) => Program = program;

    internal void Assign(string fileName, string source)
    {
        ComputerProgram.Validate(fileName, source);
        // Validate first: a bad replacement must not change the saved deployment
        // or disturb the old engine. This also bounds top-level module execution.
        var candidate = CreateRuntime(source, fileName);
        try
        {
            Program.Assign(fileName, source);
            ReleaseRuntime();
            SuccessfulTicks = 0;
            if (authority && Program.RunRequested)
            {
                runtime = candidate;
                candidate = null;
            }
        }
        finally { candidate?.Dispose(); }
    }

    internal void Start()
    {
        if (!Program.HasScript) throw new InvalidOperationException("Assign a script first.");
        ReleaseRuntime();
        Program.Fault = "";
        Program.RunRequested = true;
        SuccessfulTicks = 0;
        Resume();
    }

    internal void Stop()
    {
        Program.RunRequested = false;
        ReleaseRuntime();
    }

    internal void SetAuthority(bool value)
    {
        authority = value;
        if (!value) ReleaseRuntime();
        else Resume();
    }

    private void Resume()
    {
        if (!authority || runtime != null || !Program.RunRequested || !Program.HasScript || Program.Fault.Length != 0) return;
        try { runtime = CreateRuntime(Program.Source, Program.FileName); }
        catch (Exception exception) { RecordFault(exception); }
    }

    private FlightWorker CreateRuntime(string source, string fileName) =>
        new(source, message => UnityEngine.Debug.Log(
            $"[Klanker worker {Program.WorkerId} {fileName}] {message}"));

    internal void Tick(Vessel vessel, FlightCtrlState controls)
    {
        if (!authority || runtime == null) throw new InvalidOperationException("This computer does not have flight authority.");
        try
        {
            runtime.Tick(vessel, controls);
            SuccessfulTicks++;
        }
        catch (Exception exception)
        {
            RecordFault(exception);
            throw;
        }
    }

    private void RecordFault(Exception exception)
    {
        // Keep saved diagnostics bounded even if a worker throws a huge JS string.
        Program.Fault = exception.Message.Length > 2048 ? exception.Message.Substring(0, 2048) : exception.Message;
        if (Program.Fault.Length == 0) Program.Fault = exception.GetType().Name;
        ReleaseRuntime();
    }

    private void ReleaseRuntime()
    {
        var previous = runtime;
        runtime = null;
        previous?.Dispose();
    }

    public void Dispose()
    {
        authority = false;
        ReleaseRuntime();
    }
}

using System;

namespace Klanker.Runtime;

// Process-wide tap for worker log lines so a bridge can stream them to a CLI.
// Invoked on the main thread as workers emit logs.
internal static class KlankerLog
{
    internal static event Action<string, string, string>? Message;
    internal static void Publish(string workerId, string fileName, string message) =>
        Message?.Invoke(workerId, fileName, message);
}

using System;
using System.IO;
using System.Runtime.InteropServices;

namespace Klanker.Bridge;

// Discovery-file location and small platform helpers shared with the CLI.
internal static class BridgePaths
{
    private const uint OwnerReadWrite = 0x180; // 0600

    internal static string DiscoveryPath
    {
        get
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(root)) root = Path.GetTempPath();
            return Path.Combine(root, "klanker", "bridge.json");
        }
    }

    internal static string NewToken() => Guid.NewGuid().ToString("N");

    // Best effort: the token guards a local code-execution endpoint, so keep the
    // discovery file owner-only where the platform supports POSIX modes.
    internal static void RestrictToOwner(string path)
    {
        if (Path.DirectorySeparatorChar == '\\') return;
        try { _ = Chmod(path, OwnerReadWrite); }
        catch (Exception) { /* best effort on unusual platforms */ }
    }

    [DllImport("libc", SetLastError = true, CharSet = CharSet.Ansi, BestFitMapping = false, ThrowOnUnmappableChar = true)]
    private static extern int Chmod(string path, uint mode);
}

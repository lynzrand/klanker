using System;
using System.IO;
using System.Text;

namespace Klanker.Runtime;

// Saved deployment data only. No Unity objects, running engines, or JS heap state.
internal sealed class ComputerProgram
{
    internal const int MaximumBytes = 128 * 1024;
    internal const int MaximumStorageBytes = 64 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly char[] PathSeparators = { '/', '\\', ':' };
    internal string WorkerId { get; private set; } = "";
    internal string FileName { get; private set; } = "";
    internal string Source { get; private set; } = "";
    internal bool RunRequested { get; set; }
    internal string Fault { get; set; } = "";
    internal bool HasScript => FileName.Length != 0;
    internal string StorageJson { get; private set; } = "{}";

    internal void SetStorage(string json)
    {
        if (Utf8.GetByteCount(json) > MaximumStorageBytes)
            throw new FormatException("Worker storage exceeds 64 KiB of UTF-8 JSON.");
        StorageJson = json;
    }

    internal void EnsureIdentity()
    {
        if (WorkerId.Length == 0) WorkerId = Guid.NewGuid().ToString("N");
    }

    internal void Assign(string fileName, string source)
    {
        Validate(fileName, source);
        FileName = fileName;
        Source = source;
        Fault = "";
    }

    internal static void Validate(string fileName, string source)
    {
        if (string.IsNullOrWhiteSpace(fileName) || fileName.Length > 100 ||
            fileName.IndexOfAny(PathSeparators) >= 0 || Path.GetFileName(fileName) != fileName ||
            !fileName.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Choose a .js filename without directories.", nameof(fileName));
        if (Utf8.GetByteCount(source) > MaximumBytes)
            throw new ArgumentException("Workers are limited to 128 KiB of UTF-8 source.", nameof(source));
    }

    internal ComputerProgram CopyForNewPart() => new()
    {
        FileName = FileName, Source = Source, RunRequested = RunRequested, StorageJson = StorageJson,
        // A copied computer gets a new identity and does not inherit a runtime fault.
    };

    internal void Save(Action<string, string> set, bool flight)
    {
        set("klankerVersion", "1");
        // Craft templates must not give every launch the same actor identity.
        set("workerId", flight ? WorkerId : "");
        set("scriptFile", FileName);
        set("scriptBase64", Convert.ToBase64String(Utf8.GetBytes(Source)));
        set("runRequested", RunRequested ? "True" : "False");
        set("faultBase64", flight ? Convert.ToBase64String(Encoding.UTF8.GetBytes(Fault)) : "");
        set("storageBase64", Convert.ToBase64String(Utf8.GetBytes(StorageJson)));
    }

    internal static ComputerProgram Load(Func<string, string?> get)
    {
        var result = new ComputerProgram();
        var version = get("klankerVersion");
        if (version == null) return result; // Fresh part / ModuleManager configuration.
        if (version != "1") throw new FormatException("Unsupported Klanker computer save version: " + version);
        var id = get("workerId") ?? "";
        if (id.Length != 0 && !Guid.TryParseExact(id, "N", out _))
            throw new FormatException("Invalid Klanker worker identity.");
        result.WorkerId = id;
        var fileName = get("scriptFile") ?? "";
        var source = Decode(get("scriptBase64"), MaximumBytes);
        if (fileName.Length != 0) result.Assign(fileName, source);
        else if (source.Length != 0) throw new FormatException("Saved script has no filename.");
        if (!bool.TryParse(get("runRequested") ?? "False", out var run))
            throw new FormatException("Invalid saved run setting.");
        result.RunRequested = run;
        result.Fault = Decode(get("faultBase64"), 16 * 1024);
        var storage = Decode(get("storageBase64"), MaximumStorageBytes);
        result.SetStorage(storage.Length == 0 ? "{}" : storage);
        return result;
    }

    private static string Decode(string? encoded, int maximumBytes)
    {
        if (string.IsNullOrEmpty(encoded)) return "";
        if (encoded!.Length > ((maximumBytes + 2) / 3) * 4)
            throw new FormatException("Saved Klanker data exceeds its size limit.");
        var bytes = Convert.FromBase64String(encoded);
        if (bytes.Length > maximumBytes) throw new FormatException("Saved Klanker data exceeds its size limit.");
        return Utf8.GetString(bytes);
    }
}

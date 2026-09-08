using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

// Metadata-only: never fall back to the developer machine's GAC or execute game code.
internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) throw new ArgumentException("Pass packaged Plugins and stripped KSP root.");
            var plugins = Path.GetFullPath(args[0]);
            var ksp = Path.GetFullPath(args[1]);
            var package = Directory.GetFiles(plugins, "*.dll");
            var supplied = Directory.GetFiles(Path.Combine(ksp, "KSP_Data", "Managed"), "*.dll")
                .Concat(Directory.GetFiles(Path.Combine(ksp, "GameData", "MechJeb2", "Plugins"), "*.dll"));
            var available = supplied.Concat(package).Select(Path.GetFileNameWithoutExtension).ToHashSet(StringComparer.Ordinal);
            var failures = new List<string>();
            var foundMechJebDependency = false;
            foreach (var path in package)
            {
                using var stream = File.OpenRead(path);
                using var pe = new PEReader(stream);
                if (!pe.HasMetadata)
                {
                    failures.Add($"Native library exposed to KSP's assembly scanner: {path}");
                    continue;
                }
                var metadata = pe.GetMetadataReader();
                var assembly = metadata.GetAssemblyDefinition();
                if (Environment.GetEnvironmentVariable("KLANKER_DUMP_REFERENCES") == "1")
                    Console.WriteLine(Path.GetFileName(path) + " -> " + string.Join(", ", metadata.AssemblyReferences.Select(h => metadata.GetString(metadata.GetAssemblyReference(h).Name))));
                foreach (var handle in assembly.GetCustomAttributes())
                {
                    var attribute = metadata.GetCustomAttribute(handle);
                    if (AttributeType(metadata, attribute) == "ReferenceAssemblyAttribute")
                        failures.Add($"Compile-only reference assembly shipped as runtime: {path}");
                    if (AttributeType(metadata, attribute) == "KSPAssemblyDependency")
                    {
                        var blob = metadata.GetBlobReader(attribute.Value);
                        if (blob.ReadUInt16() != 1) throw new BadImageFormatException("Invalid attribute prolog");
                        var name = blob.ReadSerializedString();
                        var version = new Version(blob.ReadInt32(), blob.ReadInt32(), blob.ReadInt32());
                        if (name == "MechJeb2")
                        {
                            if (Path.GetFileName(path) == "Klanker.dll") foundMechJebDependency = true;
                            var actual = KspIdentity(Path.Combine(ksp, "GameData", "MechJeb2", "Plugins", "MechJeb2.dll"));
                            if (actual != version) failures.Add($"MechJeb KSP API identity mismatch: requires {version}, pinned release declares {actual}");
                            else Console.WriteLine($"PASS: pinned MechJeb release KSP identity {version}");
                        }
                    }
                }
                foreach (var handle in metadata.AssemblyReferences)
                {
                    var reference = metadata.GetAssemblyReference(handle);
                    var name = metadata.GetString(reference.Name);
                    if (!available.Contains(name)) failures.Add($"{Path.GetFileName(path)} -> missing {name} {reference.Version}");
                }
                if (Path.GetFileName(path).StartsWith("System.", StringComparison.Ordinal) || Path.GetFileName(path) == "Microsoft.CSharp.dll")
                {
                    // Catch accidentally substituted stub/reference binaries even if
                    // they don't carry ReferenceAssemblyAttribute (e.g. stripped IL).
                    if (!metadata.MethodDefinitions.Any(h => metadata.GetMethodDefinition(h).RelativeVirtualAddress != 0)
                        && metadata.ExportedTypes.Count == 0)
                        failures.Add($"Framework library has neither implementation nor forwarders: {path}");
                }
            }
            if (!foundMechJebDependency) failures.Add("Klanker.dll is missing its MechJeb KSPAssemblyDependency attribute.");
            foreach (var failure in failures) Console.Error.WriteLine("FAIL: " + failure);
            if (failures.Count != 0) return 1;
            Console.WriteLine($"PASS: {package.Length} packaged managed DLLs have a closed KSP dependency graph; no desktop GAC fallback.");
            return 0;
        }
        catch (Exception exception) { Console.Error.WriteLine(exception); return 1; }
    }

    private static string AttributeType(MetadataReader metadata, CustomAttribute attribute)
    {
        if (attribute.Constructor.Kind != HandleKind.MemberReference) return "";
        var constructor = metadata.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
        return constructor.Parent.Kind == HandleKind.TypeReference
            ? metadata.GetString(metadata.GetTypeReference((TypeReferenceHandle)constructor.Parent).Name) : "";
    }

    private static Version KspIdentity(string path)
    {
        using var stream = File.OpenRead(path);
        using var pe = new PEReader(stream);
        var metadata = pe.GetMetadataReader();
        foreach (var handle in metadata.GetAssemblyDefinition().GetCustomAttributes())
        {
            var attribute = metadata.GetCustomAttribute(handle);
            if (AttributeType(metadata, attribute) != "KSPAssembly") continue;
            var blob = metadata.GetBlobReader(attribute.Value);
            if (blob.ReadUInt16() != 1) throw new BadImageFormatException("Invalid attribute prolog");
            if (blob.ReadSerializedString() == "MechJeb2")
            {
                var major = blob.ReadInt32();
                var minor = blob.ReadInt32();
                // MechJeb uses the two-integer KSPAssembly constructor, which
                // defaults its API revision to zero.
                return new Version(major, minor, blob.RemainingBytes >= 6 ? blob.ReadInt32() : 0);
            }
        }
        throw new InvalidOperationException("Pinned MechJeb DLL has no KSPAssembly identity.");
    }
}

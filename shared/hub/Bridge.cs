using System.Text;

namespace NarrationUtilsHub;

/// <summary>Versioned file bridge between the hub and the REAPER adapter.</summary>
/// <remarks>Commands are percent-encoded, atomically written numbered files; events are tailed by byte offset.</remarks>
public static class BridgeProtocol
{
    public const int ProtocolVersion = 1;

    /// <summary>BOM-less UTF-8 encoding for command files.</summary>
    /// <remarks>The adapter expects the protocol-version digit as the first byte.</remarks>
    public static readonly Encoding FileEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    public static string EncodeFields(params object?[] fields) =>
        string.Join("|", fields.Select(field => Uri.EscapeDataString(field?.ToString() ?? "")));

    public static List<string> DecodeFields(string line) =>
        line.TrimEnd('\r', '\n').Split('|').Select(Uri.UnescapeDataString).ToList();

    public static string Serialize(string action, params object?[] fields)
    {
        var all = new List<object?> { ProtocolVersion, action };
        all.AddRange(fields);
        return EncodeFields(all.ToArray()) + "\n";
    }
}

/// <summary>Writes ordered command files and tails the adapter's events.log.</summary>
public sealed class BridgeClient
{
    private readonly string _sessionDir;
    private readonly string _commandsDir;
    private int _counter;
    private long _eventOffset;

    public BridgeClient(string sessionDir)
    {
        _sessionDir = sessionDir;
        _commandsDir = Path.Combine(sessionDir, "commands");
        Directory.CreateDirectory(_commandsDir);
    }

    public string Send(string action, params object?[] fields)
    {
        var sequence = _counter++;
        var target = Path.Combine(_commandsDir, $"{sequence:D8}.cmd");
        var temporary = target + ".tmp";
        File.WriteAllText(temporary, BridgeProtocol.Serialize(action, fields), BridgeProtocol.FileEncoding);
        File.Move(temporary, target, overwrite: true);
        return target;
    }

    public List<string> ReadEvents()
    {
        var eventsPath = Path.Combine(_sessionDir, "events.log");
        try
        {
            using var stream = new FileStream(eventsPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            stream.Seek(_eventOffset, SeekOrigin.Begin);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var text = reader.ReadToEnd();
            _eventOffset = stream.Position;
            return text.Split('\n').Where(line => line.Trim('\r').Length > 0).Select(line => line.TrimEnd('\r')).ToList();
        }
        catch (IOException)
        {
            return new List<string>();
        }
        catch (UnauthorizedAccessException)
        {
            return new List<string>();
        }
    }
}

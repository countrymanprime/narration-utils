using System.Text.Json;

namespace NarrationUtilsHub;

/// <summary>Append-only startup and runtime evidence, ported from narration_hub.py's
/// SessionDiagnostics. Same shape (JSON-lines to host.log) as the Python host wrote,
/// so existing tooling/expectations around reading host.log don't need to change.</summary>
public sealed class SessionDiagnostics
{
    private readonly object _lock = new();
    public string SessionDir { get; }
    public string Path { get; }
    public string Identifier { get; }

    public SessionDiagnostics(string sessionDir)
    {
        SessionDir = sessionDir;
        Directory.CreateDirectory(SessionDir);
        Path = System.IO.Path.Combine(SessionDir, "host.log");
        Identifier = new DirectoryInfo(SessionDir).Name;
    }

    public void Event(string name, IReadOnlyDictionary<string, object?>? details = null)
    {
        var record = new Dictionary<string, object?>
        {
            ["time"] = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:sszzz"),
            ["event"] = name,
            ["session"] = Identifier,
        };
        if (details != null) foreach (var (key, value) in details) record[key] = value;
        var line = JsonSerializer.Serialize(record, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        lock (_lock) File.AppendAllText(Path, line + "\n");
    }

    public void Exception(string name, Exception exception) =>
        Event(name, new Dictionary<string, object?> { ["error"] = exception.Message, ["traceback"] = exception.ToString() });
}

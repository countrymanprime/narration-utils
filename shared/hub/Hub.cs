using System.Diagnostics;
using System.Globalization;

namespace NarrationUtilsHub;

/// <summary>CLI arguments, mirroring narration_hub.py's argparse surface.</summary>
public sealed class HubArgs
{
    public required string SessionDir { get; init; }
    public string ProjectFolder { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string ManuscriptPython { get; init; } = "";
    public string ManuscriptBackend { get; init; } = "";
    public string ComparePython { get; init; } = "";
    public string CompareBackend { get; init; } = "";
    public List<string> Seed { get; init; } = new();
}

public readonly record struct FieldSchema(string Key, string Label, string Kind, string[] Choices);

/// <summary>Mutable run state for one Transcript Compare pass. Ported 1:1 from
/// narration_hub.py's TranscriptRun dataclass, including its 500-line log cap.</summary>
public sealed class TranscriptRun
{
    public string Phase = "idle";
    public string RunId = "";
    public double Percent;
    public string Message = "Select a track in REAPER, then start a comparison.";
    public List<string> Logs = new();
    public List<string> Chapters = new();
    public List<Dictionary<string, object?>> Rows = new();
    public string Diff = "";
    public string Summary = "";
    public double Started;
    public string? Manifest;
    public string? Output;
    public string? Progress;
    public string? LogPath;
    public string? DiffPath;
    public Process? BackendProcess;
    public long LogOffset;
    public Dictionary<string, string> PendingOptions = new();

    public static double MonotonicSeconds() => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;

    public Dictionary<string, object?> Snapshot() => new()
    {
        ["runId"] = string.IsNullOrEmpty(RunId) ? null : RunId,
        ["phase"] = Phase,
        ["percent"] = Percent,
        ["message"] = Message,
        ["logs"] = Logs.Count > 500 ? Logs.GetRange(Logs.Count - 500, 500) : Logs,
        ["chapters"] = Chapters,
        ["rows"] = Rows,
        ["diff"] = Diff,
        ["summary"] = Summary,
        ["elapsed"] = Started > 0 ? Math.Max(0, MonotonicSeconds() - Started) : 0,
    };
}

/// <summary>Port of narration_hub.py's Hub class: owns the transcript-run state
/// machine, the settings surface, and the file-based bridge loop talking to
/// shared/reaper/narration_ui_bridge.lua. The window/webview shell (Program.cs)
/// only ever calls through the thin HostApi wrapper below.</summary>
public sealed class Hub
{
    public const int ApiVersion = 1;

    public static readonly string[] PublicApiMethods =
    {
        "ready", "bootstrap", "poll", "selectManuscript", "saveSettings",
        "guideBuild", "guideIndex", "guideEdit", "guideExport", "guidePreview",
        "transcriptStart", "transcriptCancel", "transcriptAddEquivalence",
        "transcriptJump", "transcriptSuggestHints", "reportClientDiagnostic",
    };

    private static readonly Dictionary<string, FieldSchema[]> FieldSchemas = new()
    {
        ["ManuscriptGuide"] = new[]
        {
            new FieldSchema("spacy_model", "spaCy model", "text", Array.Empty<string>()),
            new FieldSchema("espeak_library", "eSpeak NG DLL", "text", Array.Empty<string>()),
            new FieldSchema("piper_exe", "Piper executable", "text", Array.Empty<string>()),
            new FieldSchema("piper_model", "Piper voice model", "text", Array.Empty<string>()),
        },
        ["TranscriptCompare"] = new[]
        {
            new FieldSchema("model_size", "Default Whisper model", "choice", new[] { "tiny", "base", "small", "medium", "large-v3" }),
            new FieldSchema("color_misread", "Misread marker color", "color", Array.Empty<string>()),
            new FieldSchema("color_skipped", "Skipped marker color", "color", Array.Empty<string>()),
            new FieldSchema("color_extra", "Extra marker color", "color", Array.Empty<string>()),
        },
    };

    private static readonly Dictionary<string, string> ChunkSeconds = new()
    {
        ["30 seconds"] = "30", ["1 minute"] = "60", ["5 minutes"] = "300", ["15 minutes"] = "900", ["1 hour"] = "3600",
    };

    private readonly string? _projectFolder;
    private readonly string _projectName;
    private readonly string _sessionDir;
    private readonly BridgeClient _bridge;
    private readonly string _manuscriptPython;
    private readonly string _manuscriptBackend;
    private readonly string _comparePython;
    private readonly string _compareBackend;
    public readonly SessionDiagnostics Diagnostics;

    private readonly object _lock = new();
    private TranscriptRun _run = new();
    private int _revision = 1;
    public volatile bool Closed;

    /// <summary>Set by Program.cs once the window exists, for the manuscript file picker.</summary>
    public Func<string?>? ShowOpenDocxDialog;

    public Hub(HubArgs args, SessionDiagnostics diagnostics)
    {
        _projectFolder = string.IsNullOrEmpty(args.ProjectFolder) ? null : args.ProjectFolder;
        _projectName = !string.IsNullOrEmpty(args.ProjectName) ? args.ProjectName : (_projectFolder != null ? new DirectoryInfo(_projectFolder).Name : "Unsaved REAPER project");
        _sessionDir = args.SessionDir;
        _bridge = new BridgeClient(_sessionDir);
        _manuscriptPython = args.ManuscriptPython; _manuscriptBackend = args.ManuscriptBackend;
        _comparePython = args.ComparePython; _compareBackend = args.CompareBackend;
        Diagnostics = diagnostics;
        Diagnostics.Event("hub_created", new Dictionary<string, object?> { ["project_folder"] = _projectFolder, ["project_name"] = _projectName });
        var thread = new Thread(BridgeLoop) { IsBackground = true };
        thread.Start();
    }

    public Dictionary<string, object?> Ready()
    {
        Diagnostics.Event("api_ready_called");
        return new Dictionary<string, object?> { ["apiVersion"] = ApiVersion, ["methods"] = PublicApiMethods, ["diagnosticId"] = Diagnostics.Identifier };
    }

    public void ReportClientDiagnostic(string kind, string message) =>
        Diagnostics.Event("client_" + kind[..Math.Min(kind.Length, 48)], new Dictionary<string, object?> { ["message"] = message[..Math.Min(message.Length, 4000)] });

    private void Changed() { lock (_lock) _revision++; }

    private GuideService Guide() => new(_projectFolder, _manuscriptPython, _manuscriptBackend);

    private Dictionary<string, object?> Settings()
    {
        var result = new Dictionary<string, object?>();
        foreach (var (tool, fields) in FieldSchemas)
        {
            var list = new List<Dictionary<string, object?>>();
            foreach (var field in fields)
            {
                var (value, source) = Config.Get(tool, field.Key, _projectFolder, "");
                list.Add(new Dictionary<string, object?>
                {
                    ["key"] = field.Key,
                    ["label"] = field.Label,
                    ["kind"] = field.Kind,
                    ["choices"] = field.Choices,
                    ["value"] = value,
                    ["source"] = source,
                    ["projectOverride"] = _projectFolder != null && Config.IsProjectOverride(_projectFolder, tool, field.Key),
                });
            }
            result[tool] = list;
        }
        return result;
    }

    public Dictionary<string, object?> Bootstrap()
    {
        var roadmapPath = Path.Combine(Config.RepoRoot, "shared", "config", "roadmap.json");
        var roadmap = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(roadmapPath));
        var manuscriptPath = Path.Combine(_projectFolder ?? "", "Manuscript.docx");
        var manuscript = _projectFolder != null && File.Exists(manuscriptPath) ? manuscriptPath : "";
        Dictionary<string, object?> transcript;
        lock (_lock) transcript = _run.Snapshot();
        Diagnostics.Event("bootstrap_completed", new Dictionary<string, object?> { ["manuscript_found"] = manuscript.Length > 0 });
        return new Dictionary<string, object?>
        {
            ["apiVersion"] = ApiVersion,
            ["diagnosticId"] = Diagnostics.Identifier,
            ["projectFolder"] = _projectFolder ?? "",
            ["projectName"] = _projectName,
            ["manuscriptPath"] = manuscript,
            ["runtime"] = new Dictionary<string, object?>
            {
                ["ManuscriptGuide"] = new Dictionary<string, object?> { ["python_exe"] = _manuscriptPython, ["backend"] = _manuscriptBackend },
                ["TranscriptCompare"] = new Dictionary<string, object?> { ["python_exe"] = _comparePython, ["compare_script"] = _compareBackend },
            },
            ["settings"] = Settings(),
            ["roadmap"] = roadmap,
            ["transcript"] = transcript,
        };
    }

    public Dictionary<string, object?> Poll(int revision)
    {
        lock (_lock) return new Dictionary<string, object?> { ["revision"] = _revision, ["transcript"] = _run.Snapshot() };
    }

    public Dictionary<string, object?> SelectManuscript()
    {
        if (string.IsNullOrEmpty(_projectFolder)) throw new InvalidOperationException("Save the REAPER project before selecting its manuscript.");
        var selected = ShowOpenDocxDialog?.Invoke();
        if (string.IsNullOrEmpty(selected)) return new Dictionary<string, object?> { ["path"] = "" };
        var destination = Path.Combine(_projectFolder, "Manuscript.docx");
        File.Copy(selected, destination, overwrite: true);
        Config.SaveGlobalSetting("_shared", "last_docx_path", selected);
        Changed();
        return new Dictionary<string, object?> { ["path"] = destination };
    }

    public Dictionary<string, object?> SaveSettings(string tool, string scope, Dictionary<string, string?> values)
    {
        if (!FieldSchemas.TryGetValue(tool, out var fields) || (scope != "global" && scope != "project"))
            throw new ArgumentException("Unsupported settings request");
        var valid = fields.ToDictionary(f => f.Key);
        var clean = new Dictionary<string, string?>();
        foreach (var (key, value) in values)
        {
            if (!valid.TryGetValue(key, out var field)) throw new ArgumentException($"Unknown setting: {key}");
            if (value != null && field.Kind == "color" && !IsValidHex(value)) throw new ArgumentException($"{field.Label} must be a six-digit hexadecimal color.");
            if (value != null && field.Kind == "choice" && !field.Choices.Contains(value)) throw new ArgumentException($"Invalid value for {field.Label}.");
            clean[key] = value;
        }
        Config.SaveScopeSettings(tool, clean, scope == "project" ? _projectFolder : null);
        Changed();
        return Bootstrap();
    }

    private static bool IsValidHex(string value) => value.Length == 6 && value.All(Uri.IsHexDigit);

    public void TranscriptStart(Dictionary<string, string> options)
    {
        lock (_lock)
        {
            if (_run.Phase is "preparing" or "running") throw new InvalidOperationException("A comparison is already running.");
            if (string.IsNullOrEmpty(_projectFolder) || !File.Exists(Path.Combine(_projectFolder, "Manuscript.docx")))
                throw new InvalidOperationException("Save the REAPER project and select its manuscript first.");
            var runId = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture) + "000";
            var hintsPath = Path.Combine(_projectFolder, "TranscriptCompare", "vocabulary_hints.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(hintsPath)!);
            File.WriteAllText(hintsPath, (options.GetValueOrDefault("hints", "")).Trim());
            _run = new TranscriptRun { Phase = "preparing", RunId = runId, Message = "Preparing the selected REAPER audio…", Started = TranscriptRun.MonotonicSeconds(), PendingOptions = new Dictionary<string, string>(options) };
            _bridge.Send("prepare_compare", runId);
        }
        Changed();
    }

    public void TranscriptCancel()
    {
        lock (_lock)
        {
            if (_run.Phase is "preparing" or "need_chapter") _run.Phase = "cancelled";
            if (_run.Progress != null) File.WriteAllText(_run.Progress + ".cancel", "cancel");
            _run.Message = "Cancellation requested…";
        }
        Changed();
    }

    public void TranscriptJump(string rowId)
    {
        lock (_lock)
        {
            if (!_run.Rows.Any(row => (string?)row["id"] == rowId)) throw new InvalidOperationException("That discrepancy is no longer available.");
            _bridge.Send("jump_to_compare_marker", _run.RunId, rowId);
        }
    }

    public string TranscriptAddEquivalence(string rowId)
    {
        Dictionary<string, object?>? row;
        lock (_lock) row = _run.Rows.FirstOrDefault(r => (string?)r["id"] == rowId);
        var docText = row?["docText"] as string; var audioText = row?["audioText"] as string;
        if (row is null || (string?)row["kind"] != "MISREAD" || string.IsNullOrEmpty(docText) || string.IsNullOrEmpty(audioText) || docText.Contains(' ') || audioText.Contains(' '))
            throw new InvalidOperationException("Select a single-word MISREAD result to add an equivalence.");
        var path = Path.Combine(_projectFolder!, "TranscriptCompare", "equivalences.csv");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        if (!File.Exists(path)) File.WriteAllText(path, "# Transcript Compare - custom word equivalences\n# One comma-separated group per line.\n");
        File.AppendAllText(path, $"{docText}, {audioText}\n");
        return $"Added equivalence: {docText} = {audioText}";
    }

    public string TranscriptSuggestHints()
    {
        var manuscript = _projectFolder != null ? Path.Combine(_projectFolder, "Manuscript.docx") : null;
        if (manuscript is null || !File.Exists(manuscript)) throw new InvalidOperationException("Select a manuscript first.");
        var outPath = Path.Combine(_sessionDir, $"hints_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() * 1000}.txt");
        var result = WindowsProcess.Run(_comparePython, new[] { _compareBackend, "--docx", manuscript, "--extract-hints", "--hints-out", outPath });
        var content = (File.Exists(outPath) ? File.ReadAllText(outPath) : "").Trim();
        if (result.ExitCode != 0 || !content.StartsWith("OK|", StringComparison.Ordinal))
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not extract vocabulary hints." : result.StdErr.Trim());
        return content[(content.IndexOf('|') + 1)..];
    }

    public string GuideBuild() => Guide().Build();
    public List<Dictionary<string, string>> GuideIndex() => Guide().Index();
    public void GuideEdit(string entityId, Dictionary<string, string> values, List<string> locks) => Guide().Edit(entityId, values, locks.Select(l => l.ToLowerInvariant()).ToHashSet());
    public string GuideExport() => Guide().ExportHotwords();
    public string GuidePreview(string entityId) => Guide().Preview(entityId);

    private void AppendLog(string line)
    {
        lock (_lock)
        {
            if (line.Length > 0) _run.Logs.AddRange(line.Split('\n'));
            if (_run.Logs.Count > 500) _run.Logs = _run.Logs.GetRange(_run.Logs.Count - 500, 500);
        }
        Changed();
    }

    private void BridgeLoop()
    {
        while (!Closed)
        {
            try
            {
                foreach (var raw in _bridge.ReadEvents()) HandleEvent(BridgeProtocol.DecodeFields(raw));
                PollBackend();
            }
            catch (Exception exc) { AppendLog($"Bridge error: {exc.Message}"); }
            Thread.Sleep(150);
        }
    }

    private void HandleEvent(List<string> fields)
    {
        if (fields.Count == 0) return;
        var tag = fields[0]; var rest = fields.Skip(1).ToList();
        if (tag == "COMPARE_PREPARED" && rest.Count >= 5)
        {
            var (runId, manifest, docx, track, diffPath) = (rest[0], rest[1], rest[2], rest[3], rest[4]);
            lock (_lock)
            {
                if (runId != _run.RunId || _run.Phase != "preparing") return;
                _run.Manifest = manifest; _run.DiffPath = diffPath;
            }
            LaunchBackend(docx, track);
        }
        else if (tag == "COMPARE_MARKER" && rest.Count >= 8)
        {
            var (runId, rowId, kind, name, docText, audioText, projectTime, itemIndex) = (rest[0], rest[1], rest[2], rest[3], rest[4], rest[5], rest[6], rest[7]);
            lock (_lock)
            {
                if (runId == _run.RunId)
                    _run.Rows.Add(new Dictionary<string, object?>
                    {
                        ["id"] = rowId, ["kind"] = kind, ["name"] = name, ["docText"] = docText, ["audioText"] = audioText,
                        ["projectTime"] = ParseDoubleOrZero(projectTime), ["itemIndex"] = ParseIntOrZero(itemIndex), ["srcpos"] = 0,
                    });
            }
            Changed();
        }
        else if (tag == "COMPARE_APPLIED" && rest.Count >= 2)
        {
            var (runId, summary) = (rest[0], rest[1]);
            lock (_lock) { if (runId == _run.RunId) { _run.Phase = "success"; _run.Percent = 100; _run.Summary = summary; _run.Message = "Comparison complete."; } }
            Changed();
        }
        else if (tag == "ERROR")
        {
            lock (_lock) { _run.Phase = "error"; _run.Message = rest.Count > 0 ? rest[0] : "REAPER integration failed."; }
            Changed();
        }
    }

    private static double ParseDoubleOrZero(string value) => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var result) ? result : 0;
    private static int ParseIntOrZero(string value) => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) ? result : 0;

    private void LaunchBackend(string docx, string track)
    {
        lock (_lock)
        {
            var run = _run;
            if (run.Manifest is null) return;
            var options = run.PendingOptions;
            run.Output = Path.Combine(_sessionDir, $"results_{run.RunId}.txt");
            run.Progress = Path.Combine(_sessionDir, $"progress_{run.RunId}.txt");
            run.LogPath = Path.Combine(_sessionDir, $"log_{run.RunId}.txt");
            var args = new List<string>
            {
                _compareBackend, "--manifest", run.Manifest, "--docx", docx, "--track-name", track,
                "--out", run.Output, "--diff-out", run.DiffPath ?? "", "--model", options.GetValueOrDefault("model", "small"),
                "--progress", run.Progress, "--log", run.LogPath,
            };
            if (options.TryGetValue("chapterTitle", out var chapterTitle) && !string.IsNullOrEmpty(chapterTitle)) { args.Add("--chapter-title"); args.Add(chapterTitle); }
            if (options.TryGetValue("chunk", out var chunk) && ChunkSeconds.TryGetValue(chunk, out var seconds))
            {
                args.Add("--chunk-seconds"); args.Add(seconds);
                args.Add("--parallel-workers"); args.Add(options.GetValueOrDefault("workers") == "Auto" ? "0" : (options.GetValueOrDefault("workers", "0")));
            }
            run.Phase = "running"; run.Message = "Launching transcript backend…";
            run.BackendProcess = WindowsProcess.StartDetachedSilently(_comparePython, args);
        }
        Changed();
    }

    private void PollBackend()
    {
        TranscriptRun run; string? progress, logPath, output; Process? process;
        lock (_lock)
        {
            run = _run;
            if (run.Phase != "running") return;
            (progress, logPath, process, output) = (run.Progress, run.LogPath, run.BackendProcess, run.Output);
        }
        if (progress != null && File.Exists(progress))
        {
            var last = File.ReadAllLines(progress).LastOrDefault();
            if (!string.IsNullOrEmpty(last))
            {
                var stageSplit = last.Split('|', 2);
                var stage = stageSplit[0];
                var rest = stageSplit.Length > 1 ? stageSplit[1] : "";
                if (rest.Length > 0)
                {
                    var restSplit = rest.Split('|', 2);
                    var pct = restSplit[0]; var detail = restSplit.Length > 1 ? restSplit[1] : "";
                    lock (_lock) { run.Percent = ParseDoubleOrZero(pct); run.Message = detail.Length > 0 ? detail : stage; }
                    Changed();
                    if (stage is "CANCELLED" or "ERROR") { lock (_lock) run.Phase = stage == "CANCELLED" ? "cancelled" : "error"; Changed(); return; }
                }
            }
        }
        if (logPath != null && File.Exists(logPath))
        {
            using var stream = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            stream.Seek(run.LogOffset, SeekOrigin.Begin);
            using var reader = new StreamReader(stream);
            var text = reader.ReadToEnd();
            run.LogOffset = stream.Position;
            if (text.Length > 0) AppendLog(text);
        }
        if (process is { HasExited: true } && output != null && File.Exists(output))
        {
            var content = File.ReadAllText(output);
            if (content.StartsWith("NEED_CHAPTER|", StringComparison.Ordinal))
            {
                lock (_lock)
                {
                    run.Phase = "need_chapter";
                    run.Chapters = content[(content.IndexOf('|') + 1)..].Trim().Split('|').Where(v => v.Length > 0).ToList();
                    run.Message = "Choose the manuscript chapter.";
                }
                Changed(); return;
            }
            if (process.ExitCode == 2) { lock (_lock) { run.Phase = "cancelled"; run.Message = "Cancelled — no markers were added."; } Changed(); return; }
            if (process.ExitCode != 0) { lock (_lock) { run.Phase = "error"; run.Message = "Transcript backend failed."; } Changed(); return; }
            var colors = new[]
            {
                Config.Get("TranscriptCompare", "color_misread", _projectFolder, "FF4040").Value,
                Config.Get("TranscriptCompare", "color_skipped", _projectFolder, "FFC000").Value,
                Config.Get("TranscriptCompare", "color_extra", _projectFolder, "40A0FF").Value,
            };
            _bridge.Send("apply_compare_results", new object[] { run.RunId, output }.Concat(colors).ToArray());
            lock (_lock)
            {
                run.Message = "Applying take markers in REAPER…"; run.BackendProcess = null;
                if (run.DiffPath != null && File.Exists(run.DiffPath)) run.Diff = File.ReadAllText(run.DiffPath);
            }
            Changed();
        }
    }

    public void Close()
    {
        Diagnostics.Event("hub_close_requested");
        TranscriptCancel();
        Closed = true;
        _bridge.Send("close");
    }
}

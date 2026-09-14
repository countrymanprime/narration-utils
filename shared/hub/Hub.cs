using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NarrationUtilsHub;

/// <summary>Arguments used to configure the desktop hub.</summary>
public sealed class HubArgs
{
    public required string SessionDir { get; init; }
    public string ProjectFolder { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Daw { get; init; } = "";
    public string ManuscriptPython { get; init; } = "";
    public string ManuscriptBackend { get; init; } = "";
    public string ComparePython { get; init; } = "";
    public string CompareBackend { get; init; } = "";
    public List<string> Seed { get; init; } = new();
    public string AudioBaseUrl { get; init; } = "";
}

public readonly record struct FieldSchema(string Key, string Label, string Kind, string[] Choices);

/// <summary>Mutable state for one Transcript Compare pass.</summary>
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

/// <summary>Coordinates transcript runs, settings, and the REAPER bridge.</summary>
public sealed class Hub
{
    // Increment when a breaking API response-shape change is released.
    public const int ApiVersion = 1;

    private static readonly Dictionary<string, FieldSchema[]> FieldSchemas = new()
    {
        ["General"] = new[]
        {
            new FieldSchema("log_verbosity", "Log verbosity", "choice", new[] { "quiet", "normal", "verbose" }),
        },
        ["ManuscriptGuide"] = new[]
        {
            new FieldSchema("spacy_model", "spaCy model", "text", Array.Empty<string>()),
            new FieldSchema("espeak_library", "eSpeak NG DLL", "text", Array.Empty<string>()),
            new FieldSchema("piper_model", "Piper voice model", "text", Array.Empty<string>()),
        },
        ["TranscriptCompare"] = new[]
        {
            new FieldSchema("model_size", "Default Whisper model", "choice", new[] { "tiny", "small", "medium", "large-v3-turbo", "large-v3" }),
            new FieldSchema("chunk_seconds", "Default chunk length", "choice", new[] { "30", "60", "300", "600" }),
            new FieldSchema("color_misread", "Misread marker color", "color", Array.Empty<string>()),
            new FieldSchema("color_skipped", "Skipped marker color", "color", Array.Empty<string>()),
            new FieldSchema("color_extra", "Extra marker color", "color", Array.Empty<string>()),
        },
    };

    private readonly string? _projectFolder;
    private readonly string _projectName;
    private readonly string _daw;
    private readonly string _sessionDir;
    private readonly BridgeClient _bridge;
    private readonly string _manuscriptPython;
    private readonly string _manuscriptBackend;
    private readonly string _comparePython;
    private readonly string _compareBackend;
    // Not known at construction time: the Kestrel host's loopback port is
    // OS-assigned and only available once it has actually started, which
    // happens after Hub exists (Endpoints.cs needs a Hub instance to map
    // against). Program.cs sets this once webApp.StartAsync() returns.
    public string GuideAudioBaseUrl { get; set; }
    public readonly SessionDiagnostics Diagnostics;

    private readonly object _lock = new();
    private TranscriptRun _run = new();
    private string? _lastCompletedJson;
    private int _revision = 1;
    public volatile bool Closed;

    /// <summary>Set by Program.cs once the window exists, for the manuscript file picker.</summary>
    public Func<string?>? ShowOpenDocxDialog;

    public Hub(HubArgs args, SessionDiagnostics diagnostics)
    {
        _projectFolder = string.IsNullOrEmpty(args.ProjectFolder) ? null : args.ProjectFolder;
        _projectName = !string.IsNullOrEmpty(args.ProjectName) ? args.ProjectName : (_projectFolder != null ? new DirectoryInfo(_projectFolder).Name : "Unsaved REAPER project");
        _daw = string.IsNullOrEmpty(args.Daw) ? "REAPER" : args.Daw;
        _sessionDir = args.SessionDir;
        _bridge = new BridgeClient(_sessionDir);
        _manuscriptPython = args.ManuscriptPython; _manuscriptBackend = args.ManuscriptBackend;
        _comparePython = args.ComparePython; _compareBackend = args.CompareBackend;
        if (_projectFolder is { } projectFolder)
        {
            var lastRunPath = Path.Combine(projectFolder, ".narration-last-comparison.json");
            if (File.Exists(lastRunPath)) _lastCompletedJson = File.ReadAllText(lastRunPath);
        }
        GuideAudioBaseUrl = args.AudioBaseUrl;
        Diagnostics = diagnostics;
        Diagnostics.Event("hub_created", new Dictionary<string, object?> { ["project_folder"] = _projectFolder, ["project_name"] = _projectName });
        var thread = new Thread(BridgeLoop) { IsBackground = true };
        thread.Start();
    }

    public Dictionary<string, object?> Ready()
    {
        Diagnostics.Event("api_ready_called");
        return new Dictionary<string, object?> { ["apiVersion"] = ApiVersion, ["diagnosticId"] = Diagnostics.Identifier };
    }

    public void ReportClientDiagnostic(string kind, string message) =>
        Diagnostics.Event("client_" + kind[..Math.Min(kind.Length, 48)], new Dictionary<string, object?> { ["message"] = message[..Math.Min(message.Length, 4000)] });

    private void Changed() { lock (_lock) _revision++; }

    private GuideService Guide() => new(_projectFolder, _manuscriptPython, _manuscriptBackend);
    private ManuscriptService Manuscript() => new(_projectFolder, _manuscriptPython, _manuscriptBackend);

    /// <summary>Returns raw and effective settings for one scope.</summary>
    public Dictionary<string, object?> SettingsForScope(string scope)
    {
        if (scope != "global" && scope != "project") throw new ArgumentException("Unsupported settings scope");
        var result = new Dictionary<string, object?>();
        foreach (var (tool, fields) in FieldSchemas)
        {
            var list = new List<Dictionary<string, object?>>();
            foreach (var field in fields)
            {
                string value; bool isSet;
                if (scope == "project")
                {
                    var project = Config.LoadProjectSettings(_projectFolder, tool);
                    isSet = project.TryGetPropertyValue(field.Key, out var raw);
                    value = isSet ? (raw?.GetValue<string>() ?? "") : "";
                }
                else
                {
                    var global = Config.LoadGlobalSettings(tool);
                    isSet = global.TryGetPropertyValue(field.Key, out var raw);
                    value = isSet ? (raw?.GetValue<string>() ?? "") : Config.GetDefault(tool, field.Key, "");
                }
                var (effectiveValue, effectiveSource) = Config.Get(tool, field.Key, _projectFolder, "");
                list.Add(new Dictionary<string, object?>
                {
                    ["key"] = field.Key,
                    ["label"] = field.Label,
                    ["kind"] = field.Kind,
                    ["choices"] = field.Choices,
                    ["value"] = value,
                    ["isSet"] = isSet,
                    ["effectiveValue"] = effectiveValue,
                    ["effectiveSource"] = effectiveSource,
                });
            }
            result[tool] = list;
        }
        return result;
    }

    public Dictionary<string, object?> Bootstrap()
    {
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
            ["daw"] = _daw,
            ["manuscriptPath"] = manuscript,
            ["runtime"] = new Dictionary<string, object?>
            {
                ["ManuscriptGuide"] = new Dictionary<string, object?> { ["python_exe"] = _manuscriptPython, ["backend"] = _manuscriptBackend },
                ["TranscriptCompare"] = new Dictionary<string, object?> { ["python_exe"] = _comparePython, ["compare_script"] = _compareBackend },
            },
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
        var selected = ShowOpenDocxDialog != null ? StaDialog.Run(ShowOpenDocxDialog) : null;
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
            _run = new TranscriptRun
            {
                Phase = "preparing",
                RunId = runId,
                Message = "Preparing the selected REAPER audio…",
                Started = TranscriptRun.MonotonicSeconds(),
                PendingOptions = new Dictionary<string, string>(options),
            };
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

    public void TranscriptReset()
    {
        lock (_lock)
        {
            if (_run.Phase is "preparing" or "running") throw new InvalidOperationException("Cancel the active comparison before starting a new one.");
            _run = new TranscriptRun();
        }
        Changed();
    }

    public JsonNode? TranscriptLastCompleted()
    {
        lock (_lock) return string.IsNullOrWhiteSpace(_lastCompletedJson) ? null : JsonNode.Parse(_lastCompletedJson);
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
        var accepted = TranscriptHints();
        return string.Join(", ", Guide().VocabularyCandidates()
            .Where(candidate => !accepted.Contains(candidate, StringComparer.OrdinalIgnoreCase)));
    }

    /// <summary>Per-project vocab-hints sidecar, kept separate from the
    /// overwritten-every-run vocabulary_hints.txt the compare backend reads:
    /// this is the accepted-hints list the Proofing screen shows as chips
    /// across sessions, so "Suggest from manuscript" doesn't have to be
    /// re-run and re-accepted from scratch every time.</summary>
    private string VocabHintsPath() => Path.Combine(_projectFolder!, "TranscriptCompare", "vocab_hints.json");

    public List<string> TranscriptHints()
    {
        if (_projectFolder is null || !File.Exists(VocabHintsPath())) return new List<string>();
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(File.ReadAllText(VocabHintsPath())) ?? new(); }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException) { return new List<string>(); }
    }

    public void TranscriptSaveHints(List<string> accepted)
    {
        if (_projectFolder is null) throw new InvalidOperationException("Select a manuscript first.");
        var path = VocabHintsPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var cleaned = accepted.Select(h => h.Trim()).Where(h => h.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(h => h, StringComparer.OrdinalIgnoreCase).ToList();
        File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(cleaned));
    }

    public string GuideBuild() => Guide().Build();
    public System.Text.Json.Nodes.JsonArray GuideEntities() => Guide().Entities();
    public void GuideEdit(string entityId, Dictionary<string, string> values) => Guide().Edit(entityId, values);
    public void GuideSetLocked(string entityId, bool locked) => Guide().SetLocked(entityId, locked);
    public void GuideRescan(string entityId) => Guide().Rescan(entityId);
    public string GuideCreate(string name, string category, List<string> aliases) => Guide().Create(name, category, aliases);
    public void GuideMerge(string sourceId, string targetId) => Guide().Merge(sourceId, targetId);
    public void GuideDelete(string entityId) => Guide().Delete(entityId);
    public void GuideRelate(string entityId, string otherId, string label) => Guide().Relate(entityId, otherId, label);
    public void GuideUnrelate(string entityId, string otherId, string label) => Guide().Unrelate(entityId, otherId, label);
    public string GuideExport() => Guide().ExportHotwords();

    /// <summary>Renders an entity preview clip and returns a playable URL.</summary>
    /// <remarks>Uses a file URL when no project-scoped audio server is running.</remarks>
    public string GuidePreview(string entityId, int? aliasIndex = null)
    {
        var path = Guide().Preview(entityId, aliasIndex);
        if (string.IsNullOrEmpty(GuideAudioBaseUrl)) return "file:///" + path.Replace('\\', '/');
        return GuideAudioBaseUrl + Uri.EscapeDataString(Path.GetFileName(path));
    }

    public List<ManuscriptChapter> ManuscriptChapters() => Manuscript().Chapters();
    public ManuscriptReader ManuscriptReader() => Manuscript().Reader();
    public ReaderState ManuscriptReaderState() => Manuscript().GetReaderState();
    public ReaderState ManuscriptReaderStateSave(string? activeChapter, int? activeSourceLine, List<string>? expandedChapters = null) =>
        Manuscript().SaveReaderState(activeChapter, activeSourceLine, expandedChapters);

    public ReaderBookmark ManuscriptBookmarkCreate(string kind, string chapter, int? paragraph, int? sourceLine, string? noteId) =>
        Manuscript().CreateBookmark(kind, chapter, paragraph, sourceLine, noteId);
    public void ManuscriptBookmarkDelete(string id) => Manuscript().DeleteBookmark(id);
    public List<ManuscriptParagraph> ManuscriptParagraphs(string chapter) => Manuscript().Paragraphs(chapter);
    public List<SearchHit> ManuscriptSearch(string query) => Manuscript().Search(query);
    public ManuscriptChapter ManuscriptSetChapterStatus(string chapter, string status) => Manuscript().SetChapterStatus(chapter, status);
    public List<ManuscriptNote> ManuscriptNoteList(string? chapter) => Manuscript().NoteList(chapter);
    public ManuscriptNote ManuscriptNoteCreate(
        string chapter,
        int paragraph,
        string text,
        int? anchorStart = null,
        int? anchorEnd = null,
        string? anchorText = null) =>
        Manuscript().NoteCreate(chapter, paragraph, text, anchorStart, anchorEnd, anchorText);
    public void ManuscriptNoteDelete(string id) => Manuscript().NoteDelete(id);

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
                        ["chapter"] = rest.Count > 8 ? rest[8] : "", ["paragraph"] = rest.Count > 9 ? ParseIntOrZero(rest[9]) : 0,
                        ["scriptContext"] = rest.Count > 10 ? rest[10] : docText, ["audioContext"] = rest.Count > 11 ? rest[11] : audioText,
                    });
            }
            Changed();
        }
        else if (tag == "COMPARE_APPLIED" && rest.Count >= 2)
        {
            var (runId, summary) = (rest[0], rest[1]);
            lock (_lock)
            {
                if (runId == _run.RunId)
                {
                    _run.Phase = "success"; _run.Percent = 100; _run.Summary = summary; _run.Message = "Comparison complete.";
                    _lastCompletedJson = JsonSerializer.Serialize(_run.Snapshot());
                    if (_projectFolder is { } projectFolder) File.WriteAllText(Path.Combine(projectFolder, ".narration-last-comparison.json"), _lastCompletedJson);
                }
            }
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
            if (options.TryGetValue("chunk", out var chunkSeconds) && int.TryParse(chunkSeconds, out _))
            {
                args.Add("--chunk-seconds"); args.Add(chunkSeconds);
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

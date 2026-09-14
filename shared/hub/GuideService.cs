using System.Text.Json.Nodes;

namespace NarrationUtilsHub;

/// <summary>Port of narration_hub.py's GuideService - shells out to the Manuscript
/// Guide tool venv exactly as before, just through WindowsProcess (hidden console)
/// instead of a bare subprocess.run call.</summary>
public sealed class GuideService
{
    private readonly string? _projectFolder;
    private readonly string _pythonExe;
    private readonly string _backend;

    public GuideService(string? projectFolder, string pythonExe, string backend)
    {
        _projectFolder = projectFolder;
        _pythonExe = pythonExe;
        _backend = backend;
    }

    private string? Manuscript
    {
        get
        {
            if (string.IsNullOrEmpty(_projectFolder)) return null;
            var path = Path.Combine(_projectFolder, "Manuscript.docx");
            return File.Exists(path) ? path : null;
        }
    }

    private string? DataDir => string.IsNullOrEmpty(_projectFolder) ? null : Path.Combine(_projectFolder, "ManuscriptGuide");
    private string? GuidePath => DataDir is null ? null : Path.Combine(DataDir, "manuscript_guide.json");

    private (int ExitCode, string StdOut, string StdErr) RunBackend(params string[] args)
    {
        if (!File.Exists(_pythonExe)) throw new InvalidOperationException("Configure the Manuscript Guide Python executable before continuing.");
        if (!File.Exists(_backend)) throw new InvalidOperationException("Configure the Manuscript Guide backend before continuing.");
        var allArgs = new List<string> { _backend };
        allArgs.AddRange(args);
        return WindowsProcess.Run(_pythonExe, allArgs);
    }

    private static void ThrowIfFailed((int ExitCode, string StdOut, string StdErr) result, string fallback)
    {
        if (result.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? fallback : result.StdErr.Trim());
    }

    public string Build()
    {
        var manuscript = Manuscript; var guidePath = GuidePath; var dataDir = DataDir;
        if (manuscript is null || guidePath is null || dataDir is null) throw new InvalidOperationException("Save the REAPER project and select a manuscript first.");
        Directory.CreateDirectory(dataDir);
        var (model, _) = Config.Get("ManuscriptGuide", "spacy_model", _projectFolder, "en_core_web_sm");
        var (espeak, _) = Config.Get("ManuscriptGuide", "espeak_library", _projectFolder, "");
        var args = new List<string> { "build", "--docx", manuscript, "--out", guidePath, "--spacy-model", model };
        if (!string.IsNullOrEmpty(espeak)) { args.Add("--espeak-library"); args.Add(espeak); }
        var result = RunBackend(args.ToArray());
        if (result.ExitCode != 0 || !File.Exists(guidePath)) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Manuscript Guide build failed." : result.StdErr.Trim());
        return "Guide rebuilt.";
    }

    /// <summary>Returns guide entities as parsed JSON.</summary>
    public JsonArray Entities()
    {
        var guidePath = GuidePath;
        if (guidePath is null || !File.Exists(guidePath)) return new JsonArray();
        var guide = JsonNode.Parse(File.ReadAllText(guidePath)) as JsonObject;
        return guide?["entities"]?.AsArray() ?? new JsonArray();
    }

    /// <summary>Reads the candidate terms produced with the durable Story
    /// Bible manifest.  Suggestions are deliberately not generated here: the
    /// Proofing page asks for them explicitly and only accepted terms persist
    /// in its separate project sidecar.</summary>
    public List<string> VocabularyCandidates()
    {
        var guidePath = GuidePath;
        if (guidePath is null || !File.Exists(guidePath))
            throw new InvalidOperationException("Build the Story Bible before requesting vocabulary suggestions.");
        var guide = JsonNode.Parse(File.ReadAllText(guidePath)) as JsonObject;
        if (guide is null) throw new InvalidOperationException("Could not read the Story Bible manifest.");
        return guide["vocabulary_candidates"]?.AsArray()
            .Select(node => node?.GetValue<string>()?.Trim())
            .Where(value => !string.IsNullOrEmpty(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .Cast<string>()
            .ToList() ?? new List<string>();
    }

    public void Edit(string entityId, IReadOnlyDictionary<string, string> values)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        foreach (var (field, value) in values)
        {
            var args = new List<string> { "edit", "--guide", guidePath, "--entity-id", entityId, "--field", field, "--value", value };
            if (field == "aliases")
            {
                // A newly-added alias gets scanned for occurrences immediately
                // (if a manuscript is available) rather than waiting on a
                // separate Rescan click - Rescan exists for finding NEW
                // occurrences of an EXISTING alias later, not first-time scans.
                if (Manuscript is { } manuscript) { args.Add("--docx"); args.Add(manuscript); }
                var (espeak, _) = Config.Get("ManuscriptGuide", "espeak_library", _projectFolder, "");
                if (!string.IsNullOrEmpty(espeak)) { args.Add("--espeak-library"); args.Add(espeak); }
            }
            ThrowIfFailed(RunBackend(args.ToArray()), "Could not save the guide entry.");
        }
    }

    public void SetLocked(string entityId, bool locked)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        ThrowIfFailed(RunBackend("edit", "--guide", guidePath, "--entity-id", entityId, "--field", "locked", "--value", locked ? "true" : "false"), "Could not update the lock state.");
    }

    public void Rescan(string entityId)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        var manuscript = Manuscript ?? throw new InvalidOperationException("Save the REAPER project and select a manuscript first.");
        ThrowIfFailed(RunBackend("rescan", "--guide", guidePath, "--docx", manuscript, "--entity-id", entityId), "Could not rescan the manuscript.");
    }

    /// <summary>Creates the entity and returns its id, so the caller can select
    /// it immediately - "+ Add entity" opens straight into the new (initially
    /// uncategorized "Draft") entry rather than making the user find it in the list.</summary>
    public string Create(string name, string category, IReadOnlyList<string> aliases)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available. Build it first.");
        var manuscript = Manuscript ?? throw new InvalidOperationException("Save the REAPER project and select a manuscript first.");
        var (espeak, _) = Config.Get("ManuscriptGuide", "espeak_library", _projectFolder, "");
        var args = new List<string> { "create", "--guide", guidePath, "--docx", manuscript, "--name", name, "--category", category, "--aliases", string.Join(";", aliases) };
        if (!string.IsNullOrEmpty(espeak)) { args.Add("--espeak-library"); args.Add(espeak); }
        var result = RunBackend(args.ToArray());
        ThrowIfFailed(result, "Could not create the entity.");
        var parts = result.StdOut.Trim().Split('|');
        if (parts.Length < 2 || parts[0] != "CREATED") throw new InvalidOperationException("Could not create the entity.");
        return parts[1];
    }

    public void Merge(string sourceId, string targetId)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        ThrowIfFailed(RunBackend("merge", "--guide", guidePath, "--source-id", sourceId, "--target-id", targetId), "Could not merge the entities.");
    }

    public void Delete(string entityId)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        ThrowIfFailed(RunBackend("delete", "--guide", guidePath, "--entity-id", entityId), "Could not delete the entity.");
    }

    public void Relate(string entityId, string otherId, string label)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        ThrowIfFailed(RunBackend("relate", "--guide", guidePath, "--entity-id", entityId, "--other-id", otherId, "--label", label), "Could not add the relationship.");
    }

    public void Unrelate(string entityId, string otherId, string label)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        ThrowIfFailed(RunBackend("unrelate", "--guide", guidePath, "--entity-id", entityId, "--other-id", otherId, "--label", label), "Could not remove the relationship.");
    }

    public string ExportHotwords()
    {
        var guidePath = GuidePath; var dataDir = DataDir;
        if (guidePath is null || dataDir is null) throw new InvalidOperationException("No project guide is available.");
        var outPath = Path.Combine(dataDir, "whisper_hotwords.txt");
        var result = RunBackend("export-hotwords", "--guide", guidePath, "--out", outPath);
        if (result.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not export hotwords." : result.StdErr.Trim());
        return outPath;
    }

    /// <summary>Renders (or re-renders) a preview clip - the entity's canonical
    /// name, or one specific alias when <paramref name="aliasIndex"/> is given -
    /// and returns its file path on disk. The caller (Hub) turns this into a URL
    /// the UI's &lt;audio&gt; element can actually load.</summary>
    public string Preview(string entityId, int? aliasIndex = null)
    {
        var guidePath = GuidePath; var dataDir = DataDir;
        if (guidePath is null || dataDir is null) throw new InvalidOperationException("No project guide is available.");
        var (piper, _) = Config.Get("ManuscriptGuide", "piper_exe", _projectFolder, "");
        var (voice, _) = Config.Get("ManuscriptGuide", "piper_model", _projectFolder, "");
        if (string.IsNullOrEmpty(piper) || string.IsNullOrEmpty(voice)) throw new InvalidOperationException("Set Piper executable and voice model in Settings.");
        var audioDir = Path.Combine(dataDir, "audio");
        var args = new List<string> { "render-audio", "--guide", guidePath, "--entity-id", entityId, "--audio-dir", audioDir, "--piper-exe", piper, "--piper-model", voice };
        if (aliasIndex is { } index) { args.Add("--alias-index"); args.Add(index.ToString()); }
        var result = RunBackend(args.ToArray());
        var filename = aliasIndex is { } aliasIndexValue ? $"{entityId}__alias{aliasIndexValue}.wav" : $"{entityId}.wav";
        var output = Path.Combine(audioDir, filename);
        if (result.ExitCode != 0 || !File.Exists(output)) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not render the preview." : result.StdErr.Trim());
        return output;
    }
}

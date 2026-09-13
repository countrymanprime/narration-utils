namespace NarrationUtilsHub;

/// <summary>Port of narration_hub.py's GuideService - shells out to the Manuscript
/// Guide tool venv exactly as before, just through WindowsProcess (hidden console)
/// instead of a bare subprocess.run call.</summary>
public sealed class GuideService
{
    private static readonly string[] IndexKeys = { "tag", "id", "category", "name", "say", "ipa", "count", "locks", "description", "traits", "chapter", "evidence" };

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

    public List<Dictionary<string, string>> Index()
    {
        var guidePath = GuidePath; var dataDir = DataDir;
        if (guidePath is null || !File.Exists(guidePath) || dataDir is null) return new List<Dictionary<string, string>>();
        var outPath = Path.Combine(dataDir, "hub-index.txt");
        var result = RunBackend("index", "--guide", guidePath, "--out", outPath);
        if (result.ExitCode != 0 || !File.Exists(outPath)) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not read the guide." : result.StdErr.Trim());
        var rows = new List<Dictionary<string, string>>();
        foreach (var line in File.ReadAllLines(outPath))
        {
            if (!line.StartsWith("ENTITY|", StringComparison.Ordinal)) continue;
            var parts = line.Split('|', 12);
            if (parts.Length != 12) continue;
            var row = new Dictionary<string, string>();
            for (var i = 0; i < IndexKeys.Length; i++) row[IndexKeys[i]] = Uri.UnescapeDataString(parts[i]);
            rows.Add(row);
        }
        return rows;
    }

    public void Edit(string entityId, IReadOnlyDictionary<string, string> values, ISet<string> locks)
    {
        var guidePath = GuidePath ?? throw new InvalidOperationException("No project guide is available.");
        foreach (var (field, value) in values)
        {
            var result = RunBackend("edit", "--guide", guidePath, "--entity-id", entityId, "--field", field, "--value", value, "--lock", locks.Contains(field.ToLowerInvariant()) ? "on" : "off");
            if (result.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not save the guide entry." : result.StdErr.Trim());
        }
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

    public string Preview(string entityId)
    {
        var guidePath = GuidePath; var dataDir = DataDir;
        if (guidePath is null || dataDir is null) throw new InvalidOperationException("No project guide is available.");
        var (piper, _) = Config.Get("ManuscriptGuide", "piper_exe", _projectFolder, "");
        var (voice, _) = Config.Get("ManuscriptGuide", "piper_model", _projectFolder, "");
        if (string.IsNullOrEmpty(piper) || string.IsNullOrEmpty(voice)) throw new InvalidOperationException("Set Piper executable and voice model in Settings.");
        var audioDir = Path.Combine(dataDir, "audio");
        var result = RunBackend("render-audio", "--guide", guidePath, "--entity-id", entityId, "--audio-dir", audioDir, "--piper-exe", piper, "--piper-model", voice);
        var output = Path.Combine(audioDir, $"{entityId}.wav");
        if (result.ExitCode != 0 || !File.Exists(output)) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.StdErr) ? "Could not render the preview." : result.StdErr.Trim());
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(output) { UseShellExecute = true });
        return output;
    }
}

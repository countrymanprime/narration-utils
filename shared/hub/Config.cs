using System.Text.Json;
using System.Text.Json.Nodes;

namespace NarrationUtilsHub;

/// <summary>
/// Layered settings, ported 1:1 from shared/python/narration_common/config.py.
/// Both implementations read/write the SAME JSON files (repo defaults, the
/// per-user global-settings.json, per-project settings.json) - the Python
/// version stays canonical for the two tool backends (Manuscript Guide,
/// Transcript Compare), which keep resolving their own argparse defaults
/// through it independently of whatever this hub passes on the command line.
/// Any behavioral drift here (scope precedence, null-vs-missing-key, atomic
/// writes) is a real cross-language bug risk - keep this file's semantics in
/// lockstep with config.py rather than "close enough".
/// </summary>
public static class Config
{
    private static JsonObject? _repoDefaultsCache;

    /// <summary>Set once at startup to the repo checkout root (parent of "shared").</summary>
    public static string RepoRoot { get; set; } = AppContext.BaseDirectory;

    private static string RepoDefaultsPath() => Path.Combine(RepoRoot, "shared", "config", "defaults.json");

    private static JsonObject ReadJsonFile(string path)
    {
        try
        {
            var text = File.ReadAllText(path);
            return (JsonNode.Parse(text) as JsonObject) ?? new JsonObject();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return new JsonObject();
        }
    }

    // json.dumps(..., sort_keys=True) sorts every nested object's keys
    // alphabetically; JsonObject does not do this on its own, so writes must
    // sort explicitly to keep output byte-comparable with the Python writer.
    private static JsonNode? SortedDeep(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            var sorted = new JsonObject();
            foreach (var key in obj.Select(kv => kv.Key).OrderBy(k => k, StringComparer.Ordinal))
                sorted[key] = SortedDeep(obj[key]?.DeepClone());
            return sorted;
        }
        if (node is JsonArray arr)
        {
            var copy = new JsonArray();
            foreach (var item in arr) copy.Add(SortedDeep(item?.DeepClone()));
            return copy;
        }
        return node?.DeepClone();
    }

    private static void WriteJsonFile(string path, JsonObject data)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        var tempPath = path + ".tmp";
        var json = SortedDeep(data)!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, path, overwrite: true);
    }

    // Whole-file read-modify-write, touching only `tool`'s section, so a
    // write from one tool can never clobber another tool's section already
    // saved in the same shared file.
    private static void UpdateToolSection(string path, string tool, Action<JsonObject> mutate)
    {
        var data = ReadJsonFile(path);
        var section = (data[tool] as JsonObject)?.DeepClone() as JsonObject ?? new JsonObject();
        mutate(section);
        data[tool] = section;
        WriteJsonFile(path, data);
    }

    /// <summary>shared/config/defaults.json[tool], memoized. {} if missing/malformed.</summary>
    public static JsonObject LoadRepoDefaults(string tool)
    {
        _repoDefaultsCache ??= ReadJsonFile(RepoDefaultsPath());
        return (_repoDefaultsCache[tool] as JsonObject) ?? new JsonObject();
    }

    public static string GetDefault(string tool, string key, string hardcodedDefault)
    {
        var defaults = LoadRepoDefaults(tool);
        return defaults[key]?.GetValue<string>() ?? hardcodedDefault;
    }

    public static string GlobalSettingsPath()
    {
        var appdata = Environment.GetEnvironmentVariable("APPDATA");
        var baseDir = !string.IsNullOrEmpty(appdata) ? appdata : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Roaming");
        return Path.Combine(baseDir, "narration-utils", "global-settings.json");
    }

    public static JsonObject LoadGlobalSettings(string tool) => (ReadJsonFile(GlobalSettingsPath())[tool] as JsonObject) ?? new JsonObject();

    public static void SaveGlobalSetting(string tool, string key, string? value) =>
        UpdateToolSection(GlobalSettingsPath(), tool, section => section[key] = value);

    /// <summary>One-time migration backstop: for each key in `seed`, writes it into
    /// global settings only if that tool+key isn't already saved there. Safe to
    /// call on every launch - a no-op once real values exist.</summary>
    public static void SeedGlobalIfMissing(string tool, IReadOnlyDictionary<string, string> seed) =>
        UpdateToolSection(GlobalSettingsPath(), tool, section =>
        {
            foreach (var (key, value) in seed)
                if (!section.ContainsKey(key)) section[key] = value;
        });

    public static string? ProjectSettingsPath(string? projectFolder) =>
        string.IsNullOrEmpty(projectFolder) ? null : Path.Combine(projectFolder, "narration-utils", "settings.json");

    public static JsonObject LoadProjectSettings(string? projectFolder, string tool)
    {
        var path = ProjectSettingsPath(projectFolder);
        return path is null ? new JsonObject() : (ReadJsonFile(path)[tool] as JsonObject) ?? new JsonObject();
    }

    public static void SaveProjectSetting(string projectFolder, string tool, string key, string? value)
    {
        var path = ProjectSettingsPath(projectFolder) ?? throw new ArgumentException("save_project_setting requires a project_folder");
        UpdateToolSection(path, tool, section => section[key] = value);
    }

    /// <summary>Atomically applies a group of settings for one tool and scope.
    /// `null` removes a project override; this is intentionally distinct from
    /// an empty string, which is a valid explicit global value. Mirrors
    /// config.py's save_scope_settings exactly, including the (slightly odd
    /// but load-bearing) fact that a null value in GLOBAL scope is written
    /// as a literal JSON null rather than treated as a removal.</summary>
    public static void SaveScopeSettings(string tool, IReadOnlyDictionary<string, string?> values, string? projectFolder = null)
    {
        var path = !string.IsNullOrEmpty(projectFolder) ? ProjectSettingsPath(projectFolder)! : GlobalSettingsPath();
        UpdateToolSection(path, tool, section =>
        {
            foreach (var (key, value) in values)
            {
                if (!string.IsNullOrEmpty(projectFolder) && value is null) section.Remove(key);
                else section[key] = value;
            }
        });
    }

    public static void ClearProjectOverride(string projectFolder, string tool, string key)
    {
        var path = ProjectSettingsPath(projectFolder);
        if (path is null) return;
        UpdateToolSection(path, tool, section => section.Remove(key));
    }

    public static bool IsProjectOverride(string? projectFolder, string tool, string key) =>
        LoadProjectSettings(projectFolder, tool).ContainsKey(key);

    /// <summary>Full layered lookup. Returns (value, scope) where scope is one of
    /// "project", "global", "repo_default", "hardcoded" - callers that show
    /// provenance (the Settings screen) use it to mark a value as inherited
    /// vs. overridden.</summary>
    public static (string Value, string Scope) Get(string tool, string key, string? projectFolder, string hardcodedDefault)
    {
        if (!string.IsNullOrEmpty(projectFolder))
        {
            var project = LoadProjectSettings(projectFolder, tool);
            if (project.TryGetPropertyValue(key, out var projectValue)) return (projectValue?.GetValue<string>() ?? "", "project");
        }
        var global = LoadGlobalSettings(tool);
        if (global.TryGetPropertyValue(key, out var globalValue)) return (globalValue?.GetValue<string>() ?? "", "global");
        var defaults = LoadRepoDefaults(tool);
        if (defaults.TryGetPropertyValue(key, out var defaultValue)) return (defaultValue?.GetValue<string>() ?? "", "repo_default");
        return (hardcodedDefault, "hardcoded");
    }
}

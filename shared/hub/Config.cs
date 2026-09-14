using System.Text.Json;
using System.Text.Json.Nodes;

namespace NarrationUtilsHub;

/// <summary>Reads and writes layered repository, global, and project settings.</summary>
public static class Config
{
    private static JsonObject? _repoDefaultsCache;
    private static readonly AsyncLocal<string?> GlobalSettingsRootOverride = new();

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

    // Stable key order keeps settings diffs readable and deterministic.
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

    // Preserve other tools' sections during a read-modify-write update.
    private static void UpdateToolSection(string path, string tool, Action<JsonObject> mutate)
    {
        var data = ReadJsonFile(path);
        var section = (data[tool] as JsonObject)?.DeepClone() as JsonObject ?? new JsonObject();
        mutate(section);
        data[tool] = section;
        WriteJsonFile(path, data);
    }

    /// <summary>Gets cached repository defaults for one tool.</summary>
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
        var appdata = GlobalSettingsRootOverride.Value ?? Environment.GetEnvironmentVariable("APPDATA");
        var baseDir = !string.IsNullOrEmpty(appdata) ? appdata : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Roaming");
        return Path.Combine(baseDir, "narration-utils", "global-settings.json");
    }

    /// <summary>Temporarily directs global-settings reads and writes to <paramref name="directory"/>.</summary>
    /// <remarks>The override is async-context-local so parallel tests can provide independent settings roots.</remarks>
    public static IDisposable UseGlobalSettingsDirectory(string directory)
    {
        var previous = GlobalSettingsRootOverride.Value;
        GlobalSettingsRootOverride.Value = directory;
        return new RestoreGlobalSettingsRoot(previous);
    }

    private sealed class RestoreGlobalSettingsRoot(string? previous) : IDisposable
    {
        public void Dispose() => GlobalSettingsRootOverride.Value = previous;
    }

    public static JsonObject LoadGlobalSettings(string tool) => (ReadJsonFile(GlobalSettingsPath())[tool] as JsonObject) ?? new JsonObject();

    public static void SaveGlobalSetting(string tool, string key, string? value) =>
        UpdateToolSection(GlobalSettingsPath(), tool, section => section[key] = value);

    /// <summary>Seeds missing global settings without replacing saved values.</summary>
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

    /// <summary>Atomically saves a group of settings for one tool and scope.</summary>
    /// <remarks>A null project value removes its override; a null global value is stored explicitly.</remarks>
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

    /// <summary>Resolves a setting and identifies the supplying scope.</summary>
    /// <returns>The value and one of <c>project</c>, <c>global</c>, <c>repo_default</c>, or <c>hardcoded</c>.</returns>
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

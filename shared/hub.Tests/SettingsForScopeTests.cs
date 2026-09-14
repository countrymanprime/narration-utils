namespace NarrationUtilsHub.Tests;

/// <summary>Covers the Stage 5 settings rework: Global and Project scopes must
/// report their own raw value (not the merged/effective one), and the
/// removed `piper_exe` field must no longer appear in the schema.</summary>
public sealed class SettingsForScopeTests : IDisposable
{
    private readonly string _tempAppData;
    private readonly IDisposable _settingsRoot;
    private readonly string _session;
    private readonly string _project;

    public SettingsForScopeTests()
    {
        _tempAppData = Path.Combine(Path.GetTempPath(), "narration-utils-settings-scope-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(_tempAppData);
        _settingsRoot = Config.UseGlobalSettingsDirectory(_tempAppData);
        Config.RepoRoot = Program.FindRepoRoot();
        _session = Path.Combine(_tempAppData, "session");
        _project = Path.Combine(_tempAppData, "project");
        Directory.CreateDirectory(_project);
    }

    public void Dispose()
    {
        _settingsRoot.Dispose();
        Directory.Delete(_tempAppData, recursive: true);
    }

    private Hub NewHub() => new(new HubArgs { SessionDir = _session, ProjectFolder = _project }, new SessionDiagnostics(_session));

    [Fact]
    public void GlobalAndProjectScopesReportDistinctRawValuesNotTheMergedOne()
    {
        var hub = NewHub();
        hub.SaveSettings("TranscriptCompare", "global", new Dictionary<string, string?> { ["model_size"] = "medium" });
        hub.SaveSettings("TranscriptCompare", "project", new Dictionary<string, string?> { ["model_size"] = "large-v3" });

        var global = (List<Dictionary<string, object?>>)hub.SettingsForScope("global")["TranscriptCompare"]!;
        var project = (List<Dictionary<string, object?>>)hub.SettingsForScope("project")["TranscriptCompare"]!;
        var globalField = global.Single(f => (string)f["key"]! == "model_size");
        var projectField = project.Single(f => (string)f["key"]! == "model_size");

        Assert.Equal("medium", globalField["value"]);
        Assert.True((bool)globalField["isSet"]!);
        Assert.Equal("large-v3", projectField["value"]);
        Assert.True((bool)projectField["isSet"]!);
        // The merged/effective value is the same from either tab - the project
        // override wins regardless of which scope you're currently viewing.
        Assert.Equal("large-v3", projectField["effectiveValue"]);
        Assert.Equal("large-v3", globalField["effectiveValue"]);
    }

    [Fact]
    public void ProjectFieldWithNoOverrideReportsUnsetWithGlobalAsEffectiveFallback()
    {
        var hub = NewHub();
        hub.SaveSettings("TranscriptCompare", "global", new Dictionary<string, string?> { ["color_extra"] = "112233" });

        var project = (List<Dictionary<string, object?>>)hub.SettingsForScope("project")["TranscriptCompare"]!;
        var field = project.Single(f => (string)f["key"]! == "color_extra");

        Assert.False((bool)field["isSet"]!);
        Assert.Equal("", field["value"]);
        Assert.Equal("112233", field["effectiveValue"]);
        Assert.Equal("global", field["effectiveSource"]);
    }

    [Fact]
    public void PiperExecutableFieldNoLongerExistsInTheSchema()
    {
        var hub = NewHub();
        var fields = (List<Dictionary<string, object?>>)hub.SettingsForScope("global")["ManuscriptGuide"]!;
        Assert.DoesNotContain(fields, f => (string)f["key"]! == "piper_exe");
        Assert.Contains(fields, f => (string)f["key"]! == "piper_model");
    }

    [Fact]
    public void GeneralCategoryExposesLogVerbosityWithoutObsoleteReaderWidth()
    {
        var hub = NewHub();
        var fields = (List<Dictionary<string, object?>>)hub.SettingsForScope("global")["General"]!;
        var verbosity = fields.Single(f => (string)f["key"]! == "log_verbosity");
        Assert.Equal("normal", verbosity["effectiveValue"]);
        Assert.DoesNotContain(fields, f => (string)f["key"]! == "default_reader_width");
    }
}

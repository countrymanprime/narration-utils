namespace NarrationUtilsHub.Tests;

/// <summary>Mirrors shared/python/tests/test_ui_bridge_and_config.py's
/// ScopedConfigTests - both implementations must agree on layered-settings
/// behavior since they read/write the same on-disk JSON files.</summary>
public sealed class ConfigTests : IDisposable
{
    private readonly string _tempAppData;
    private readonly IDisposable _settingsRoot;

    public ConfigTests()
    {
        _tempAppData = Path.Combine(Path.GetTempPath(), "narration-utils-config-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(_tempAppData);
        _settingsRoot = Config.UseGlobalSettingsDirectory(_tempAppData);
        Config.RepoRoot = Program.FindRepoRoot();
    }

    public void Dispose()
    {
        _settingsRoot.Dispose();
        Directory.Delete(_tempAppData, recursive: true);
    }

    [Fact]
    public void ScopeSaveIsGroupedAndNullClearsProjectOverride()
    {
        var project = Path.Combine(_tempAppData, "project");
        Config.SaveScopeSettings("TranscriptCompare", new Dictionary<string, string?> { ["model_size"] = "medium", ["color_extra"] = "112233" });
        Config.SaveScopeSettings("TranscriptCompare", new Dictionary<string, string?> { ["model_size"] = "large-v3", ["color_extra"] = "AABBCC" }, project);
        Config.SaveScopeSettings("TranscriptCompare", new Dictionary<string, string?> { ["model_size"] = null }, project);

        var (model, modelScope) = Config.Get("TranscriptCompare", "model_size", project, "small");
        var (color, colorScope) = Config.Get("TranscriptCompare", "color_extra", project, "");

        Assert.Equal(("medium", "global"), (model, modelScope));
        Assert.Equal(("AABBCC", "project"), (color, colorScope));
    }

    [Fact]
    public void RepoDefaultsFallBackWhenNoOverrideExists()
    {
        var (model, scope) = Config.Get("TranscriptCompare", "model_size", null, "fallback-literal");
        Assert.Equal("repo_default", scope);
        Assert.Equal("small", model);
    }
}

namespace NarrationUtilsHub.Tests;

/// <summary>Covers the Stage 6 accepted-hints sidecar: unlike
/// vocabulary_hints.txt (overwritten every run by the compare backend), this
/// list is what the Proofing screen's chips persist across sessions.</summary>
public sealed class TranscriptHintsTests : IDisposable
{
    private readonly string _tempAppData;
    private readonly IDisposable _settingsRoot;
    private readonly string _session;
    private readonly string _project;

    public TranscriptHintsTests()
    {
        _tempAppData = Path.Combine(Path.GetTempPath(), "narration-utils-hints-tests-" + Guid.NewGuid());
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
    public void HintsAreEmptyUntilSavedThenRoundTripSortedAndDeduplicated()
    {
        var hub = NewHub();
        Assert.Empty(hub.TranscriptHints());

        hub.TranscriptSaveHints(new List<string> { "Voltage Corps", "aurelian", "Aurelian", "  Meridian  " });

        var saved = hub.TranscriptHints();
        Assert.Equal(new[] { "aurelian", "Meridian", "Voltage Corps" }, saved);
    }

    [Fact]
    public void SavingWithoutAProjectFolderThrows()
    {
        var hub = new Hub(new HubArgs { SessionDir = _session, ProjectFolder = "" }, new SessionDiagnostics(_session));
        Assert.Throws<InvalidOperationException>(() => hub.TranscriptSaveHints(new List<string> { "x" }));
    }
}

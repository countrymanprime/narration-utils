namespace NarrationUtilsHub.Tests;

/// <summary>Covers the Stage 7 switch from the pipe-delimited hub-index.txt
/// format to returning manuscript_guide.json's entities array verbatim, plus
/// GuidePreview's file-path-to-URL logic (the rest of the Story Bible's new
/// commands shell out to the Python backend and need a real venv - covered by
/// manual verification instead, matching how GuideBuild/GuideEdit already were).</summary>
public sealed class GuideEntitiesTests
{
    private static Hub NewHub(string projectFolder, string audioBaseUrl = "") =>
        new(new HubArgs { SessionDir = Path.GetTempPath(), ProjectFolder = projectFolder, AudioBaseUrl = audioBaseUrl }, new SessionDiagnostics(Path.GetTempPath()));

    [Fact]
    public void EntitiesAreEmptyWithNoProjectOrGuideFile()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var project = Path.Combine(Path.GetTempPath(), "narration-utils-guide-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(project);
        try
        {
            var hub = NewHub(project);
            Assert.Empty(hub.GuideEntities());
        }
        finally { Directory.Delete(project, recursive: true); }
    }

    [Fact]
    public void EntitiesReturnGuideJsonVerbatimIncludingArrayFields()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var project = Path.Combine(Path.GetTempPath(), "narration-utils-guide-tests-" + Guid.NewGuid());
        var dataDir = Path.Combine(project, "ManuscriptGuide");
        Directory.CreateDirectory(dataDir);
        try
        {
            File.WriteAllText(Path.Combine(dataDir, "manuscript_guide.json"), """
            { "schema_version": 1, "entities": [
                { "id": "entity-1", "canonical_name": "Aurelian", "aliases": ["Cap"], "category": "Character",
                  "occurrences": [{"chapter": "1", "paragraph": 3, "excerpt": "..."}], "occurrence_count": 1,
                  "pronunciation": {"ipa": "", "source": "not generated", "confidence": "unknown"},
                  "description": {"text": "", "evidence": {}}, "personality_notes": [],
                  "relationships": [{"id": "entity-2", "name": "Nico", "label": "mentor of"}],
                  "locked": true, "review_state": "reviewed" }
            ] }
            """);
            var hub = NewHub(project);
            var entities = hub.GuideEntities();
            Assert.Single(entities);
            var entity = entities[0]!;
            Assert.Equal("Aurelian", entity["canonical_name"]!.GetValue<string>());
            Assert.Equal("Cap", entity["aliases"]![0]!.GetValue<string>());
            Assert.True(entity["locked"]!.GetValue<bool>());
            Assert.Equal("mentor of", entity["relationships"]![0]!["label"]!.GetValue<string>());
        }
        finally { Directory.Delete(project, recursive: true); }
    }

    [Fact]
    public void ProofingSuggestionsComeFromTheGuideManifestAndExcludeAcceptedHints()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var project = Path.Combine(Path.GetTempPath(), "narration-utils-guide-hints-tests-" + Guid.NewGuid());
        var dataDir = Path.Combine(project, "ManuscriptGuide");
        Directory.CreateDirectory(dataDir);
        try
        {
            File.WriteAllText(Path.Combine(dataDir, "manuscript_guide.json"), """
            { "schema_version": 2, "vocabulary_candidates": ["Alice", "White Rabbit", "Alice"] }
            """);
            var hub = NewHub(project);
            Assert.Equal("Alice, White Rabbit", hub.TranscriptSuggestHints());

            hub.TranscriptSaveHints(new List<string> { "alice" });
            Assert.Equal("White Rabbit", hub.TranscriptSuggestHints());
        }
        finally { Directory.Delete(project, recursive: true); }
    }

    [Fact]
    public void GuidePreviewFallsBackToFileUrlWithoutAnAudioServer()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var tempAppData = Path.Combine(Path.GetTempPath(), "narration-utils-guide-tests-appdata-" + Guid.NewGuid());
        Directory.CreateDirectory(tempAppData);
        using var settingsRoot = Config.UseGlobalSettingsDirectory(tempAppData);
        var project = Path.Combine(Path.GetTempPath(), "narration-utils-guide-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(project);
        try
        {
            // No Piper configured (isolated from the real global settings via a
            // fake APPDATA), so Guide().Preview() throws before touching Python -
            // enough to prove GuidePreview doesn't swallow/rewrite that failure.
            var hub = NewHub(project);
            var ex = Assert.Throws<InvalidOperationException>(() => hub.GuidePreview("entity-1"));
            Assert.Contains("Piper", ex.Message);
        }
        finally
        {
            Directory.Delete(project, recursive: true);
            Directory.Delete(tempAppData, recursive: true);
        }
    }
}

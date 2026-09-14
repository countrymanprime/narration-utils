using System.Text.Json;

namespace NarrationUtilsHub.Tests;

/// <summary>Tests manuscript cache, sidecar, search, and annotation behavior.</summary>
public sealed class ManuscriptServiceTests : IDisposable
{
    private readonly string _project;

    public ManuscriptServiceTests()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        _project = Path.Combine(Path.GetTempPath(), "narration-utils-manuscript-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(_project, "ManuscriptGuide"));
        File.WriteAllText(Path.Combine(_project, "Manuscript.docx"), "not a real docx - only its mtime matters for cache staleness");
    }

    public void Dispose() { if (Directory.Exists(_project)) Directory.Delete(_project, recursive: true); }

    private ManuscriptService NewService() => new(_project, pythonExe: "unused", backend: "unused");

    private void SeedTextCache()
    {
        var payload = new
        {
            chapters = new[] { new { title = "Chapter One", index = 0, wordCount = 8 }, new { title = "Chapter Two", index = 1, wordCount = 5 } },
            paragraphs = new[]
            {
                new { chapter = "Chapter One", index = 0, text = "Saint Voltage crossed the plaza at a dead run." },
                new { chapter = "Chapter One", index = 1, text = "Nico was waiting by the side doors." },
                new { chapter = "Chapter Two", index = 2, text = "Three floors beneath the hall." },
            },
        };
        var cachePath = Path.Combine(_project, "ManuscriptGuide", "manuscript_text.json");
        File.WriteAllText(cachePath, JsonSerializer.Serialize(payload));
        // Cache must be newer than Manuscript.docx or ManuscriptService treats
        // it as stale and tries to regenerate it via the (here, fake) Python backend.
        File.SetLastWriteTimeUtc(cachePath, DateTime.UtcNow.AddMinutes(5));
    }

    private void SeedGuide()
    {
        var guide = new
        {
            entities = new[]
            {
                new
                {
                    id = "saint-voltage", canonical_name = "Saint Voltage", category = "Character", locked = false,
                    occurrences = new[] { new { chapter = "Chapter One", paragraph = 0, excerpt = "Saint Voltage crossed the plaza." } },
                    aliases = new[] { new { text = "The Voltage", occurrences = new[] { new { chapter = "Chapter One", paragraph = 1, excerpt = "Nico was waiting." } } } },
                },
            },
        };
        File.WriteAllText(Path.Combine(_project, "ManuscriptGuide", "manuscript_guide.json"), JsonSerializer.Serialize(guide));
    }

    [Fact]
    public void ChaptersReadsWordCountsFromTheCacheAndDefaultsStatusToNotStarted()
    {
        SeedTextCache();
        var chapters = NewService().Chapters();
        Assert.Equal(2, chapters.Count);
        Assert.Equal("Chapter One", chapters[0].Title);
        Assert.Equal(8, chapters[0].WordCount);
        Assert.Equal("not_started", chapters[0].Status);
    }

    [Fact]
    public void ParagraphsAreFilteredByChapterAndTaggedWithEntityIdsFromTheGuide()
    {
        SeedTextCache();
        SeedGuide();
        var paragraphs = NewService().Paragraphs("Chapter One");
        Assert.Equal(2, paragraphs.Count);
        Assert.Equal(new[] { "saint-voltage" }, paragraphs[0].EntityIds);
        Assert.Equal(new[] { "saint-voltage" }, paragraphs[1].EntityIds); // via the alias's own occurrence
    }

    [Fact]
    public void ParagraphsWithNoMatchingEntityOccurrenceGetAnEmptyList()
    {
        SeedTextCache();
        SeedGuide();
        var paragraphs = NewService().Paragraphs("Chapter Two");
        Assert.Single(paragraphs);
        Assert.Empty(paragraphs[0].EntityIds);
    }

    [Fact]
    public void SearchIsCaseInsensitiveAcrossAllChapters()
    {
        SeedTextCache();
        var hits = NewService().Search("nico");
        Assert.Single(hits);
        Assert.Equal("Chapter One", hits[0].Chapter);
    }

    [Fact]
    public void ChapterStatusAndNotesRoundTripThroughTheSidecarWithoutTouchingThePythonBackend()
    {
        var service = NewService();
        service.SetChapterStatus("Chapter One", "recording");
        SeedTextCache();
        var chapters = service.Chapters();
        Assert.Equal("recording", chapters.Single(c => c.Title == "Chapter One").Status);

        var note = service.NoteCreate("Chapter One", 0, "Underplay the bravado here.");
        Assert.Equal("Chapter One", note.Chapter);
        Assert.Single(service.NoteList("Chapter One"));
        Assert.Empty(service.NoteList("Chapter Two"));

        service.NoteDelete(note.Id);
        Assert.Empty(service.NoteList(null));
    }

    [Fact]
    public void SettingAnUnknownChapterStatusThrows()
    {
        Assert.Throws<ArgumentException>(() => NewService().SetChapterStatus("Chapter One", "on-fire"));
    }

    [Fact]
    public void ReaderStateAndBookmarksRoundTripThroughTheProjectSidecar()
    {
        var service = NewService();
        var initial = service.GetReaderState();
        Assert.Null(initial.ExpandedChapters);
        Assert.Empty(initial.Bookmarks);

        service.SaveReaderState("Chapter Two", 512, new List<string> { "Chapter One", "Chapter Two" });
        var bookmark = service.CreateBookmark("line", "Chapter Two", 2, 512, null);
        var restored = NewService().GetReaderState();

        Assert.Equal("Chapter Two", restored.ActiveChapter);
        Assert.Equal(512, restored.ActiveSourceLine);
        Assert.Equal(new[] { "Chapter One", "Chapter Two" }, restored.ExpandedChapters);
        Assert.Single(restored.Bookmarks);
        Assert.Equal(bookmark.Id, restored.Bookmarks[0].Id);

        service.DeleteBookmark(bookmark.Id);
        Assert.Empty(NewService().GetReaderState().Bookmarks);
    }

    [Fact]
    public void LegacyReaderStateIgnoresRetiredAutoFocusField()
    {
        var sidecar = Path.Combine(_project, "narration-utils", "manuscript-notes.json");
        Directory.CreateDirectory(Path.GetDirectoryName(sidecar)!);
        var legacySidecar = new
        {
            notes = Array.Empty<object>(),
            chapterStatus = new { },
            readerState = new
            {
                activeChapter = "Chapter One",
                autoFocusChapters = true,
                bookmarks = Array.Empty<object>(),
                expandedChapters = new[] { "Chapter One" },
            },
        };
        File.WriteAllText(sidecar, JsonSerializer.Serialize(legacySidecar));

        var state = NewService().GetReaderState();

        Assert.Equal("Chapter One", state.ActiveChapter);
        Assert.Equal(new[] { "Chapter One" }, state.ExpandedChapters);
    }
}

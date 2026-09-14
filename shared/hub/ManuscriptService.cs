using System.Text.Json;
using System.Text.Json.Nodes;

namespace NarrationUtilsHub;

public sealed record ManuscriptChapter(string Id, string Title, int Index, int WordCount, string Status);
public sealed record ManuscriptParagraph(string Chapter, int Index, string Text, List<string> EntityIds);
public sealed record ManuscriptNote(string Id, string Chapter, int Paragraph, string Text, string CreatedAt, int? AnchorStart = null, int? AnchorEnd = null, string? AnchorText = null);
public sealed record ReaderBookmark(string Id, string Kind, string Chapter, int? Paragraph = null, int? SourceLine = null, string? NoteId = null, string? CreatedAt = null);
public sealed record ReaderState(string? ActiveChapter, int? ActiveSourceLine, List<ReaderBookmark> Bookmarks, List<string>? ExpandedChapters = null);
public sealed record SearchHit(string Chapter, int Paragraph, string Excerpt);
public sealed record ManuscriptReader(List<ManuscriptChapter> Chapters, List<ManuscriptParagraph> Paragraphs, List<ManuscriptNote> Notes);

/// <summary>Backs the Manuscript reader page: full chapter/paragraph text
/// (via a new `export-manuscript` subcommand on the same Manuscript Guide
/// Python backend GuideService already shells out to - no new venv), joined
/// with entity occurrences already produced by a guide build, plus a small
/// user-authored sidecar for notes and narrator-set chapter status. Modeled
/// on GuideService.cs's shape (same RunBackend/ThrowIfFailed pattern) but
/// kept as its own file since chapter text and Story Bible entities are
/// different concerns that happen to share one Python backend.</summary>
public sealed class ManuscriptService
{
    private readonly string? _projectFolder;
    private readonly string _pythonExe;
    private readonly string _backend;

    public ManuscriptService(string? projectFolder, string pythonExe, string backend)
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
    private string? TextCachePath => DataDir is null ? null : Path.Combine(DataDir, "manuscript_text.json");
    private string? GuidePath => DataDir is null ? null : Path.Combine(DataDir, "manuscript_guide.json");
    // A sidecar for narrator-authored data (notes, chapter workflow status) -
    // distinct from manuscript_guide.json/manuscript_text.json, which are both
    // regenerable analyzer output. Sibling to the shared settings sidecar per
    // the project-sidecar rules in docs/architecture/daw-integration.md.
    private string? NotesPath => string.IsNullOrEmpty(_projectFolder) ? null : Path.Combine(_projectFolder, "narration-utils", "manuscript-notes.json");

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

    private sealed record TextCache(List<ChapterEntry> Chapters, List<ParagraphEntry> Paragraphs);
    private sealed record ChapterEntry(string Title, int Index, int WordCount);
    private sealed record ParagraphEntry(string Chapter, int Index, string Text);

    /// <summary>Regenerates the cached chapter/paragraph export whenever it is
    /// missing or older than the manuscript itself - same "cache analyzer
    /// output, rebuild on demand" pattern GuideService.Build() uses, just
    /// triggered automatically by staleness instead of an explicit button
    /// (there is no separate "Build" action for the Manuscript page in the
    /// wireframe; the reader should just always reflect the current .docx).</summary>
    private TextCache LoadOrRebuildTextCache()
    {
        var manuscript = Manuscript ?? throw new InvalidOperationException("Select a manuscript first.");
        var cachePath = TextCachePath!;
        var stale = !File.Exists(cachePath) || File.GetLastWriteTimeUtc(cachePath) < File.GetLastWriteTimeUtc(manuscript);
        if (stale)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            var result = RunBackend("export-manuscript", "--docx", manuscript, "--out", cachePath);
            ThrowIfFailed(result, "Could not read the manuscript.");
        }
        var json = JsonSerializer.Deserialize<TextCache>(File.ReadAllText(cachePath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Could not read the manuscript export.");
        return json;
    }

    /// <summary>Chapter+paragraph index pairs that have at least one Story
    /// Bible entity occurrence there, built once per call from the existing
    /// guide JSON (already produced by a guide build) rather than adding any
    /// new Python output - the guide's entities already carry this.</summary>
    private Dictionary<(string Chapter, int Paragraph), List<string>> EntityOccurrenceIndex()
    {
        var index = new Dictionary<(string, int), List<string>>();
        var guidePath = GuidePath;
        if (guidePath is null || !File.Exists(guidePath)) return index;
        if (JsonNode.Parse(File.ReadAllText(guidePath)) is not JsonObject guide) return index;
        foreach (var entity in guide["entities"]?.AsArray() ?? new JsonArray())
        {
            if (entity is not JsonObject entityObject) continue;
            var id = entityObject["id"]?.GetValue<string>();
            if (id is null) continue;
            void AddOccurrences(JsonArray? occurrences)
            {
                foreach (var occurrence in occurrences ?? new JsonArray())
                {
                    if (occurrence is not JsonObject occ) continue;
                    var chapter = occ["chapter"]?.GetValue<string>();
                    var paragraph = occ["paragraph"]?.GetValue<int>();
                    if (chapter is null || paragraph is null) continue;
                    var key = (chapter, paragraph.Value);
                    if (!index.TryGetValue(key, out var ids)) index[key] = ids = new List<string>();
                    if (!ids.Contains(id)) ids.Add(id);
                }
            }
            AddOccurrences(entityObject["occurrences"]?.AsArray());
            foreach (var alias in entityObject["aliases"]?.AsArray() ?? new JsonArray())
                AddOccurrences((alias as JsonObject)?["occurrences"]?.AsArray());
        }
        return index;
    }

    private sealed record NotesFile(List<ManuscriptNote> Notes, Dictionary<string, string> ChapterStatus, ReaderState? ReaderState = null);
    private static ReaderState EmptyReaderState() => new(null, null, new List<ReaderBookmark>());

    private NotesFile LoadNotes()
    {
        var path = NotesPath;
        if (path is null || !File.Exists(path)) return new NotesFile(new List<ManuscriptNote>(), new Dictionary<string, string>(), EmptyReaderState());
        try
        {
            var loaded = JsonSerializer.Deserialize<NotesFile>(
                File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ??
                new NotesFile(new(), new(), EmptyReaderState());
            // JsonSerializer ignores retired fields such as AutoFocusChapters,
            // allowing reader sidecars written by older versions to load intact.
            return loaded with { ReaderState = loaded.ReaderState is { Bookmarks: not null } state ? state : EmptyReaderState() };
        }
        catch (JsonException) { return new NotesFile(new List<ManuscriptNote>(), new Dictionary<string, string>(), EmptyReaderState()); }
    }

    private void SaveNotes(NotesFile notes)
    {
        var path = NotesPath ?? throw new InvalidOperationException("Save the REAPER project first.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(notes));
    }

    public List<ManuscriptChapter> Chapters()
    {
        var cache = LoadOrRebuildTextCache();
        var status = LoadNotes().ChapterStatus;
        return cache.Chapters.Select(c => new ManuscriptChapter(
            Id: Slug(c.Title), Title: c.Title, Index: c.Index, WordCount: c.WordCount,
            Status: status.GetValueOrDefault(c.Title, "not_started"))).ToList();
    }

    public List<ManuscriptParagraph> Paragraphs(string chapter)
    {
        var cache = LoadOrRebuildTextCache();
        var entityIndex = EntityOccurrenceIndex();
        return cache.Paragraphs
            .Where(p => p.Chapter == chapter)
            .Select(p => new ManuscriptParagraph(p.Chapter, p.Index, p.Text, entityIndex.GetValueOrDefault((p.Chapter, p.Index), new List<string>())))
            .ToList();
    }

    public ManuscriptReader Reader()
    {
        var cache = LoadOrRebuildTextCache();
        var status = LoadNotes().ChapterStatus;
        var entityIndex = EntityOccurrenceIndex();
        var chapters = cache.Chapters.Select(c => new ManuscriptChapter(Slug(c.Title), c.Title, c.Index, c.WordCount, status.GetValueOrDefault(c.Title, "not_started"))).ToList();
        var paragraphs = cache.Paragraphs.Select(p => new ManuscriptParagraph(p.Chapter, p.Index, p.Text, entityIndex.GetValueOrDefault((p.Chapter, p.Index), new List<string>()))).ToList();
        return new ManuscriptReader(chapters, paragraphs, LoadNotes().Notes);
    }

    public List<SearchHit> Search(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return new List<SearchHit>();
        var cache = LoadOrRebuildTextCache();
        return cache.Paragraphs
            .Where(p => p.Text.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Select(p => new SearchHit(p.Chapter, p.Index, p.Text))
            .ToList();
    }

    public ManuscriptChapter SetChapterStatus(string chapter, string status)
    {
        var allowed = new[] { "not_started", "recording", "editing", "proofing", "finalized" };
        if (!allowed.Contains(status)) throw new ArgumentException($"Unknown chapter status: {status}");
        var notes = LoadNotes();
        notes.ChapterStatus[chapter] = status;
        SaveNotes(notes);
        // Status is sidecar-owned; do not trigger a manuscript export merely to
        // update it. The reader/Home already hold the chapter metadata.
        return new ManuscriptChapter(Slug(chapter), chapter, 0, 0, status);
    }

    public List<ManuscriptNote> NoteList(string? chapter)
    {
        var notes = LoadNotes().Notes;
        return chapter is null ? notes : notes.Where(n => n.Chapter == chapter).ToList();
    }

    public ManuscriptNote NoteCreate(string chapter, int paragraph, string text, int? anchorStart = null, int? anchorEnd = null, string? anchorText = null)
    {
        if ((anchorStart.HasValue && anchorStart.Value < 0) ||
            (anchorEnd.HasValue && (!anchorStart.HasValue || anchorEnd.Value < anchorStart.Value)))
        {
            throw new ArgumentException("Invalid note anchor.");
        }
        var notes = LoadNotes();
        var note = new ManuscriptNote(Guid.NewGuid().ToString("n"), chapter, paragraph, text, DateTimeOffset.UtcNow.ToString("o"), anchorStart, anchorEnd, anchorText);
        notes.Notes.Add(note);
        SaveNotes(notes);
        return note;
    }

    public void NoteDelete(string id)
    {
        var notes = LoadNotes();
        notes.Notes.RemoveAll(n => n.Id == id);
        SaveNotes(notes);
    }

    public ReaderState GetReaderState() => LoadNotes().ReaderState ?? EmptyReaderState();

    public ReaderState SaveReaderState(string? activeChapter, int? activeSourceLine, List<string>? expandedChapters = null)
    {
        var notes = LoadNotes();
        var current = notes.ReaderState ?? EmptyReaderState();
        var next = current with { ActiveChapter = activeChapter, ActiveSourceLine = activeSourceLine, ExpandedChapters = expandedChapters ?? current.ExpandedChapters };
        SaveNotes(notes with { ReaderState = next });
        return next;
    }

    public ReaderBookmark CreateBookmark(string kind, string chapter, int? paragraph, int? sourceLine, string? noteId)
    {
        if (kind is not ("chapter" or "line" or "note")) throw new ArgumentException("Unknown bookmark kind.");
        var notes = LoadNotes(); var state = notes.ReaderState ?? EmptyReaderState();
        var duplicate = state.Bookmarks.FirstOrDefault(item => item.Kind == kind && item.Chapter == chapter && item.Paragraph == paragraph && item.NoteId == noteId);
        if (duplicate is not null) return duplicate;
        var bookmark = new ReaderBookmark(Guid.NewGuid().ToString("n"), kind, chapter, paragraph, sourceLine, noteId, DateTimeOffset.UtcNow.ToString("o"));
        SaveNotes(notes with { ReaderState = state with { Bookmarks = [..state.Bookmarks, bookmark] } });
        return bookmark;
    }

    public void DeleteBookmark(string id)
    {
        var notes = LoadNotes(); var state = notes.ReaderState ?? EmptyReaderState();
        SaveNotes(notes with { ReaderState = state with { Bookmarks = state.Bookmarks.Where(item => item.Id != id).ToList() } });
    }

    private static string Slug(string title) => new string(title.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
}

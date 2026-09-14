using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Json;

namespace NarrationUtilsHub;

/// <summary>
/// Maps the /api/* surface onto Hub's existing method set. Replaces the old
/// hand-rolled {id, method, args} postMessage protocol (RpcDispatcher.cs,
/// deleted) with plain typed HTTP endpoints: every argument arrives as a
/// route/query parameter or a JSON body bound by ASP.NET Core's model binder,
/// instead of positional untyped JsonElement[] args - the exact class of bug
/// (reordered/renamed args, no compile-time contract) that motivated this
/// rewrite. Kept as a pure routing layer; all business logic still lives in
/// Hub.cs/GuideService.cs, unchanged.
/// </summary>
public static class Endpoints
{
    public static void MapHubApi(this IEndpointRouteBuilder app, Hub hub)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", () => Results.Ok(hub.Ready()));
        api.MapGet("/bootstrap", () => Results.Ok(hub.Bootstrap()));

        api.MapGet("/transcript/state", () => Results.Ok(hub.Poll(0)));
        api.MapGet("/transcript/events", (HttpContext context) => TranscriptEvents(context, hub));
        api.MapPost("/transcript/start", (Dictionary<string, string> options) => { hub.TranscriptStart(options); return Results.Accepted(); });
        api.MapPost("/transcript/cancel", () => { hub.TranscriptCancel(); return Results.Ok(); });
        api.MapPost("/transcript/reset", () => { hub.TranscriptReset(); return Results.Ok(); });
        api.MapGet("/transcript/last-completed", () => Results.Json(hub.TranscriptLastCompleted()));
        api.MapPost("/transcript/discrepancies/{id}/equivalence", (string id) => Results.Ok(new { message = hub.TranscriptAddEquivalence(id) }));
        api.MapPost("/transcript/discrepancies/{id}/jump", (string id) => { hub.TranscriptJump(id); return Results.Ok(); });
        api.MapPost("/transcript/markers/export", () => { hub.TranscriptExportMarkers(); return Results.Accepted(); });
        api.MapGet("/transcript/hints/suggestions", () => Results.Ok(new { value = hub.TranscriptSuggestHints() }));
        api.MapGet("/transcript/hints", () => Results.Ok(hub.TranscriptHints()));
        api.MapPut("/transcript/hints", (List<string> accepted) => { hub.TranscriptSaveHints(accepted); return Results.Ok(); });

        api.MapPost("/manuscript/select-file", () => Results.Ok(hub.SelectManuscript()));

        api.MapGet("/settings", (string scope) => Results.Ok(hub.SettingsForScope(scope)));
        api.MapPut("/settings/{tool}/{scope}", (string tool, string scope, Dictionary<string, string?> values) => Results.Ok(hub.SaveSettings(tool, scope, values)));

        api.MapGet("/guide/entities", () => Results.Json((JsonNode)hub.GuideEntities()));
        api.MapPost("/guide/build", () => Results.Ok(new { message = hub.GuideBuild() }));
        api.MapPost("/guide/entities", (CreateEntityRequest body) => Results.Ok(new { id = hub.GuideCreate(body.Name, body.Category, body.Aliases ?? new()) }));
        api.MapPatch("/guide/entities/{id}", (string id, Dictionary<string, string> values) => { hub.GuideEdit(id, values); return Results.Ok(); });
        api.MapPut("/guide/entities/{id}/locked", (string id, LockedRequest body) => { hub.GuideSetLocked(id, body.Locked); return Results.Ok(); });
        api.MapPost("/guide/entities/{id}/rescan", (string id) => { hub.GuideRescan(id); return Results.Ok(); });
        api.MapPost("/guide/merge", (MergeRequest body) => { hub.GuideMerge(body.SourceId, body.TargetId); return Results.Ok(); });
        api.MapDelete("/guide/entities/{id}", (string id) => { hub.GuideDelete(id); return Results.Ok(); });
        api.MapPost("/guide/relationships", (RelationshipRequest body) => { hub.GuideRelate(body.Id, body.OtherId, body.Label); return Results.Ok(); });
        api.MapDelete("/guide/relationships", (string id, string otherId, string label) => { hub.GuideUnrelate(id, otherId, label); return Results.Ok(); });
        api.MapGet("/guide/export", () => Results.Ok(new { path = hub.GuideExport() }));
        api.MapGet("/guide/entities/{id}/preview", (string id, int? aliasIndex) => Results.Ok(new { url = hub.GuidePreview(id, aliasIndex) }));

        api.MapPost("/diagnostics", (DiagnosticRequest body) => { hub.ReportClientDiagnostic(body.Kind, body.Message); return Results.Ok(); });

        api.MapGet("/manuscript/chapters", () => Results.Ok(hub.ManuscriptChapters()));
        api.MapGet("/manuscript/reader", () => Results.Ok(hub.ManuscriptReader()));
        api.MapGet("/manuscript/reader-state", () => Results.Ok(hub.ManuscriptReaderState()));
        api.MapPut("/manuscript/reader-state", (ReaderStateRequest body) => Results.Ok(hub.ManuscriptReaderStateSave(body.ActiveChapter, body.ActiveSourceLine, body.ExpandedChapters)));
        api.MapPost("/manuscript/bookmarks", (CreateBookmarkRequest body) => Results.Ok(hub.ManuscriptBookmarkCreate(body.Kind, body.Chapter, body.Paragraph, body.SourceLine, body.NoteId)));
        api.MapDelete("/manuscript/bookmarks/{id}", (string id) => { hub.ManuscriptBookmarkDelete(id); return Results.Ok(); });
        api.MapGet("/manuscript/chapters/{chapter}/paragraphs", (string chapter) => Results.Ok(hub.ManuscriptParagraphs(chapter)));
        api.MapGet("/manuscript/search", (string q) => Results.Ok(hub.ManuscriptSearch(q)));
        api.MapPut("/manuscript/chapters/{chapter}/status", (string chapter, ChapterStatusRequest body) => Results.Ok(hub.ManuscriptSetChapterStatus(chapter, body.Status)));
        api.MapGet("/manuscript/notes", (string? chapter) => Results.Ok(hub.ManuscriptNoteList(chapter)));
        api.MapPost("/manuscript/notes", (CreateNoteRequest body) => Results.Ok(hub.ManuscriptNoteCreate(body.Chapter, body.Paragraph, body.Text, body.AnchorStart, body.AnchorEnd, body.AnchorText)));
        api.MapDelete("/manuscript/notes/{id}", (string id) => { hub.ManuscriptNoteDelete(id); return Results.Ok(); });
    }

    /// <summary>Streams transcript-run snapshots over Server-Sent Events.</summary>
    /// <remarks>Emits on revision changes and sends heartbeat comments while idle.</remarks>
    private static async Task TranscriptEvents(HttpContext context, Hub hub)
    {
        context.Response.Headers.CacheControl = "no-cache";
        context.Response.ContentType = "text/event-stream";
        var lastRevision = -1;
        var lastHeartbeat = DateTimeOffset.UtcNow;
        while (!context.RequestAborted.IsCancellationRequested)
        {
            var snapshot = hub.Poll(0);
            var revision = (int)(snapshot["revision"] ?? 0);
            if (revision != lastRevision)
            {
                lastRevision = revision;
                var json = JsonSerializer.Serialize(snapshot["transcript"]);
                await context.Response.WriteAsync($"data: {json}\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
                lastHeartbeat = DateTimeOffset.UtcNow;
            }
            else if (DateTimeOffset.UtcNow - lastHeartbeat > TimeSpan.FromSeconds(15))
            {
                await context.Response.WriteAsync(": heartbeat\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
                lastHeartbeat = DateTimeOffset.UtcNow;
            }
            try { await Task.Delay(200, context.RequestAborted); } catch (TaskCanceledException) { break; }
        }
    }

    public sealed record CreateEntityRequest(string Name, string Category, List<string>? Aliases);
    public sealed record LockedRequest(bool Locked);
    public sealed record MergeRequest(string SourceId, string TargetId);
    public sealed record RelationshipRequest(string Id, string OtherId, string Label);
    public sealed record DiagnosticRequest(string Kind, string Message);
    public sealed record ChapterStatusRequest(string Status);
    public sealed record CreateNoteRequest(string Chapter, int Paragraph, string Text, int? AnchorStart = null, int? AnchorEnd = null, string? AnchorText = null);
    public sealed record ReaderStateRequest(string? ActiveChapter, int? ActiveSourceLine, List<string>? ExpandedChapters = null);
    public sealed record CreateBookmarkRequest(string Kind, string Chapter, int? Paragraph = null, int? SourceLine = null, string? NoteId = null);
}

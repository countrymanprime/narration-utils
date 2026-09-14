"""Builds the FastAPI app for the API, UI bundle, and preview audio.

Ported from shared/hub/HubWebApp.cs + shared/hub/Endpoints.cs. Kept as a pure
routing layer, same as Endpoints.cs - all business logic lives in
hub_state.py/guide_service.py/manuscript_service.py, unchanged.
"""

import asyncio
import json
import time
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .hub_state import HubError, HubState


class DiagnosticRequest(BaseModel):
    kind: str
    message: str


class CreateEntityRequest(BaseModel):
    name: str
    category: str
    aliases: list[str] | None = None


class LockedRequest(BaseModel):
    locked: bool


class MergeRequest(BaseModel):
    sourceId: str
    targetId: str


class RelationshipRequest(BaseModel):
    id: str
    otherId: str
    label: str


class ChapterStatusRequest(BaseModel):
    status: str


class CreateNoteRequest(BaseModel):
    chapter: str
    paragraph: int
    text: str
    anchorStart: int | None = None
    anchorEnd: int | None = None
    anchorText: str | None = None


class ReaderStateRequest(BaseModel):
    activeChapter: str | None = None
    activeSourceLine: int | None = None
    expandedChapters: list[str] | None = None


class CreateBookmarkRequest(BaseModel):
    kind: str
    chapter: str
    paragraph: int | None = None
    sourceLine: int | None = None
    noteId: str | None = None


class ErrorToJsonMiddleware:
    """Wraps any unhandled exception as a JSON error body, mirroring
    HubWebApp.cs's catch-all. Also touches hub.last_activity_at on every
    request - see main.py's idle watchdog.

    Deliberately a plain ASGI middleware, not `@app.middleware("http")`
    (BaseHTTPMiddleware) - that flavor is documented to double-invoke a
    streaming endpoint (like /api/transcript/events) when the client
    disconnects mid-stream. FastAPI's own HTTPException handling runs inside
    `self.app`, so this only ever sees genuinely unhandled exceptions.
    """

    def __init__(self, app, hub: HubState):
        self.app = app
        self.hub = hub

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        self.hub.touch_activity()
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:  # noqa: BLE001 - mirrors HubWebApp.cs's catch-all JSON error body
            if started:
                raise
            self.hub.diagnostics.exception("api_request_failed_" + scope.get("path", ""), exc)
            await JSONResponse(status_code=500, content={"error": str(exc)})(scope, receive, send)


def build_app(hub: HubState, ui_dist_dir: str, audio_dir: str | None = None, shutdown_event: asyncio.Event | None = None) -> FastAPI:
    app = FastAPI()
    ui_dist = Path(ui_dist_dir)
    app.add_middleware(ErrorToJsonMiddleware, hub=hub)

    api = APIRouter(prefix="/api")

    def _bad_request(exc: HubError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    @api.get("/health")
    def health():
        return hub.ready()

    @api.get("/bootstrap")
    def bootstrap():
        return hub.bootstrap()

    @api.get("/transcript/state")
    def transcript_state():
        return hub.poll()

    @api.get("/transcript/events")
    async def transcript_events(request: Request):
        async def stream():
            try:
                last_revision = -1
                last_heartbeat = time.monotonic()
                while not await request.is_disconnected():
                    hub.touch_activity()
                    snapshot = hub.poll()
                    revision = snapshot["revision"]
                    if revision != last_revision:
                        last_revision = revision
                        yield f"data: {json.dumps(snapshot['transcript'])}\n\n"
                        last_heartbeat = time.monotonic()
                    elif time.monotonic() - last_heartbeat > 15:
                        yield ": heartbeat\n\n"
                        last_heartbeat = time.monotonic()
                    await asyncio.sleep(0.2)
            except GeneratorExit:
                pass

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @api.post("/shutdown")
    def shutdown():
        # Lets an operator (or a future admin action) request a clean exit;
        # the normal path is main.py's idle watchdog noticing no activity
        # (see hub.touch_activity/last_activity_at) for a long stretch once
        # the browser tab closes.
        hub.diagnostics.event("shutdown_requested_via_api")
        if shutdown_event is not None:
            shutdown_event.set()

    @api.post("/transcript/start", status_code=202)
    def transcript_start(options: dict[str, str]):
        try:
            hub.transcript_start(options)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/transcript/cancel")
    def transcript_cancel():
        hub.transcript_cancel()

    @api.post("/transcript/reset")
    def transcript_reset():
        try:
            hub.transcript_reset()
        except HubError as exc:
            _bad_request(exc)

    @api.get("/transcript/last-completed")
    def transcript_last_completed():
        return hub.transcript_last_completed()

    @api.post("/transcript/discrepancies/{row_id}/equivalence")
    def transcript_add_equivalence(row_id: str):
        try:
            return {"message": hub.transcript_add_equivalence(row_id)}
        except HubError as exc:
            _bad_request(exc)

    @api.post("/transcript/discrepancies/{row_id}/jump")
    def transcript_jump(row_id: str):
        try:
            hub.transcript_jump(row_id)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/transcript/markers/export", status_code=202)
    def transcript_export_markers():
        try:
            hub.transcript_export_markers()
        except HubError as exc:
            _bad_request(exc)

    @api.get("/transcript/hints/suggestions")
    def transcript_hint_suggestions():
        try:
            return {"value": hub.transcript_suggest_hints()}
        except HubError as exc:
            _bad_request(exc)

    @api.get("/transcript/hints")
    def transcript_hints():
        return hub.transcript_hints()

    @api.put("/transcript/hints")
    def transcript_save_hints(accepted: list[str]):
        try:
            hub.transcript_save_hints(accepted)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/manuscript/select-file")
    def manuscript_select_file():
        try:
            return hub.select_manuscript()
        except HubError as exc:
            _bad_request(exc)

    @api.get("/settings")
    def get_settings(scope: str):
        try:
            return hub.settings_for_scope(scope)
        except HubError as exc:
            _bad_request(exc)

    @api.put("/settings/{tool}/{scope}")
    def put_settings(tool: str, scope: str, values: dict[str, str | None]):
        try:
            return hub.save_settings(tool, scope, values)
        except HubError as exc:
            _bad_request(exc)

    @api.get("/guide/entities")
    def guide_entities():
        return hub.guide_entities()

    @api.post("/guide/build")
    def guide_build():
        try:
            return {"message": hub.guide_build()}
        except HubError as exc:
            _bad_request(exc)

    @api.post("/guide/entities")
    def guide_create(body: CreateEntityRequest):
        try:
            return {"id": hub.guide_create(body.name, body.category, body.aliases or [])}
        except HubError as exc:
            _bad_request(exc)

    @api.patch("/guide/entities/{entity_id}")
    def guide_edit(entity_id: str, values: dict[str, str]):
        try:
            hub.guide_edit(entity_id, values)
        except HubError as exc:
            _bad_request(exc)

    @api.put("/guide/entities/{entity_id}/locked")
    def guide_set_locked(entity_id: str, body: LockedRequest):
        try:
            hub.guide_set_locked(entity_id, body.locked)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/guide/entities/{entity_id}/rescan")
    def guide_rescan(entity_id: str):
        try:
            hub.guide_rescan(entity_id)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/guide/merge")
    def guide_merge(body: MergeRequest):
        try:
            hub.guide_merge(body.sourceId, body.targetId)
        except HubError as exc:
            _bad_request(exc)

    @api.delete("/guide/entities/{entity_id}")
    def guide_delete(entity_id: str):
        try:
            hub.guide_delete(entity_id)
        except HubError as exc:
            _bad_request(exc)

    @api.post("/guide/relationships")
    def guide_relate(body: RelationshipRequest):
        try:
            hub.guide_relate(body.id, body.otherId, body.label)
        except HubError as exc:
            _bad_request(exc)

    @api.delete("/guide/relationships")
    def guide_unrelate(id: str, otherId: str, label: str):
        try:
            hub.guide_unrelate(id, otherId, label)
        except HubError as exc:
            _bad_request(exc)

    @api.get("/guide/export")
    def guide_export():
        try:
            return {"path": hub.guide_export()}
        except HubError as exc:
            _bad_request(exc)

    @api.get("/guide/entities/{entity_id}/preview")
    def guide_preview(entity_id: str, aliasIndex: int | None = None):
        try:
            return {"url": hub.guide_preview(entity_id, aliasIndex)}
        except HubError as exc:
            _bad_request(exc)

    @api.post("/diagnostics")
    def post_diagnostics(body: DiagnosticRequest):
        hub.report_client_diagnostic(body.kind, body.message)

    @api.get("/manuscript/chapters")
    def manuscript_chapters():
        try:
            return hub.manuscript_chapters()
        except HubError as exc:
            _bad_request(exc)

    @api.get("/manuscript/reader")
    def manuscript_reader():
        try:
            return hub.manuscript_reader()
        except HubError as exc:
            _bad_request(exc)

    @api.get("/manuscript/reader-state")
    def manuscript_reader_state():
        return hub.manuscript_reader_state()

    @api.put("/manuscript/reader-state")
    def manuscript_reader_state_save(body: ReaderStateRequest):
        return hub.manuscript_reader_state_save(body.activeChapter, body.activeSourceLine, body.expandedChapters)

    @api.post("/manuscript/bookmarks")
    def manuscript_bookmark_create(body: CreateBookmarkRequest):
        try:
            return hub.manuscript_bookmark_create(body.kind, body.chapter, body.paragraph, body.sourceLine, body.noteId)
        except HubError as exc:
            _bad_request(exc)

    @api.delete("/manuscript/bookmarks/{bookmark_id}")
    def manuscript_bookmark_delete(bookmark_id: str):
        hub.manuscript_bookmark_delete(bookmark_id)

    @api.get("/manuscript/chapters/{chapter}/paragraphs")
    def manuscript_paragraphs(chapter: str):
        try:
            return hub.manuscript_paragraphs(chapter)
        except HubError as exc:
            _bad_request(exc)

    @api.get("/manuscript/search")
    def manuscript_search(q: str):
        try:
            return hub.manuscript_search(q)
        except HubError as exc:
            _bad_request(exc)

    @api.put("/manuscript/chapters/{chapter}/status")
    def manuscript_set_chapter_status(chapter: str, body: ChapterStatusRequest):
        try:
            return hub.manuscript_set_chapter_status(chapter, body.status)
        except HubError as exc:
            _bad_request(exc)

    @api.get("/manuscript/notes")
    def manuscript_note_list(chapter: str | None = None):
        return hub.manuscript_note_list(chapter)

    @api.post("/manuscript/notes")
    def manuscript_note_create(body: CreateNoteRequest):
        try:
            return hub.manuscript_note_create(body.chapter, body.paragraph, body.text, body.anchorStart, body.anchorEnd, body.anchorText)
        except HubError as exc:
            _bad_request(exc)

    @api.delete("/manuscript/notes/{note_id}")
    def manuscript_note_delete(note_id: str):
        hub.manuscript_note_delete(note_id)

    app.include_router(api)

    if audio_dir:
        Path(audio_dir).mkdir(parents=True, exist_ok=True)
        app.mount("/audio", StaticFiles(directory=audio_dir), name="audio")

    if ui_dist.is_dir():
        app.mount("/assets", StaticFiles(directory=ui_dist / "assets"), name="ui-assets")

        @app.get("/{full_path:path}")
        async def spa_fallback(full_path: str):
            candidate = ui_dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(ui_dist / "index.html")

    return app

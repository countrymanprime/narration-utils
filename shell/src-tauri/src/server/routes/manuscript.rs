use std::sync::Arc;

use axum::{
    routing::{get, post, put},
    Router,
};

use super::super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router
        .route(
            "/api/manuscript/chapters",
            get(super::super::manuscript_chapters),
        )
        .route(
            "/api/manuscript/chapters/{chapter}/paragraphs",
            get(super::super::manuscript_paragraphs),
        )
        .route(
            "/api/manuscript/reader",
            get(super::super::manuscript_reader),
        )
        .route(
            "/api/manuscript/reader-state",
            get(super::super::manuscript_reader_state)
                .put(super::super::manuscript_save_reader_state),
        )
        .route(
            "/api/manuscript/bookmarks",
            post(super::super::manuscript_bookmark_create),
        )
        .route(
            "/api/manuscript/bookmarks/{bookmark_id}",
            axum::routing::delete(super::super::manuscript_bookmark_delete),
        )
        .route(
            "/api/manuscript/search",
            get(super::super::manuscript_search),
        )
        .route(
            "/api/manuscript/chapters/{chapter}/status",
            put(super::super::manuscript_set_status),
        )
        .route(
            "/api/manuscript/notes",
            get(super::super::manuscript_notes).post(super::super::manuscript_note_create),
        )
        .route(
            "/api/manuscript/notes/{note_id}",
            axum::routing::delete(super::super::manuscript_note_delete),
        )
        .route(
            "/api/manuscript/import/legacy-preview",
            post(super::super::manuscript_legacy_preview),
        )
        .route(
            "/api/manuscript/select-file",
            post(super::super::manuscript_select_file),
        )
        .route(
            "/api/manuscript/import/{job_id}",
            get(super::super::manuscript_import_state),
        )
        .route(
            "/api/manuscript/import/{job_id}/preview",
            post(super::super::manuscript_import_preview),
        )
        .route(
            "/api/manuscript/import/{job_id}/commit",
            post(super::super::manuscript_import_commit),
        )
        .route(
            "/api/manuscript/import/{job_id}/cancel",
            post(super::super::manuscript_import_cancel),
        )
        .route(
            "/api/project-data/clear",
            post(super::super::project_data_clear),
        )
}

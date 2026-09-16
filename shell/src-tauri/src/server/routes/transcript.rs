use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use super::super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router
        .route("/api/transcript/state", get(super::super::transcript_state))
        .route(
            "/api/transcript/events",
            get(super::super::transcript_events),
        )
        .route(
            "/api/transcript/start",
            post(super::super::transcript_start),
        )
        .route(
            "/api/transcript/cancel",
            post(super::super::transcript_cancel),
        )
        .route(
            "/api/transcript/reset",
            post(super::super::transcript_reset),
        )
        .route(
            "/api/transcript/last-completed",
            get(super::super::transcript_last_completed),
        )
        .route(
            "/api/transcript/discrepancies/{row_id}/equivalence",
            post(super::super::transcript_add_equivalence),
        )
        .route(
            "/api/transcript/discrepancies/{row_id}/jump",
            post(super::super::transcript_jump),
        )
        .route(
            "/api/transcript/markers/export",
            post(super::super::transcript_export_markers),
        )
        .route(
            "/api/transcript/hints/suggestions",
            get(super::super::transcript_suggest_hints),
        )
        .route(
            "/api/transcript/hints",
            get(super::super::transcript_hints).put(super::super::transcript_save_hints),
        )
}

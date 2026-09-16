use std::sync::Arc;

use axum::{
    routing::{get, post, put},
    Router,
};

use super::super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router
        .route(
            "/api/guide/entities",
            get(super::super::guide_entities).post(super::super::guide_create),
        )
        .route(
            "/api/guide/entities/{entity_id}",
            axum::routing::patch(super::super::guide_edit).delete(super::super::guide_delete),
        )
        .route(
            "/api/guide/entities/{entity_id}/locked",
            put(super::super::guide_set_locked),
        )
        .route(
            "/api/guide/entities/{entity_id}/rescan",
            post(super::super::guide_rescan),
        )
        .route(
            "/api/guide/entities/{entity_id}/preview",
            get(super::super::guide_preview),
        )
        .route(
            "/api/guide/audio/{file_name}",
            get(super::super::guide_audio),
        )
        .route("/api/guide/merge", post(super::super::guide_merge))
        .route(
            "/api/guide/relationships",
            post(super::super::guide_relate).delete(super::super::guide_unrelate),
        )
        .route("/api/guide/export", get(super::super::guide_export))
        .route(
            "/api/guide/build",
            get(super::super::guide_build_state).post(super::super::guide_build_start),
        )
}

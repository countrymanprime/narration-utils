use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use super::super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router
        .route("/api/tts/catalog", get(super::super::tts_catalog))
        .route(
            "/api/tts/voices/{voice_id}/install",
            post(super::super::tts_install),
        )
        .route(
            "/api/tts/voices/{voice_id}",
            axum::routing::delete(super::super::tts_remove),
        )
        .route(
            "/api/tts/jobs/{job_id}",
            get(super::super::tts_install_state),
        )
        .route(
            "/api/tts/jobs/{job_id}/cancel",
            post(super::super::tts_install_cancel),
        )
}

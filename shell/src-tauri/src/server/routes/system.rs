use std::sync::Arc;

use axum::{
    routing::{get, post, put},
    Router,
};

use super::super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router
        .route("/api/health", get(super::super::health))
        .route("/api/bootstrap", get(super::super::bootstrap))
        .route("/api/settings", get(super::super::settings))
        .route(
            "/api/settings/{tool}/{scope}",
            put(super::super::save_settings),
        )
        .route("/api/diagnostics", post(super::super::report_diagnostic))
        .route("/api/shutdown", post(super::super::shutdown))
}

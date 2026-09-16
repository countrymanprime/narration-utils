//! Domain route registration. Request handlers remain close to their current
//! state methods while this module makes the public API surface auditable.

mod manuscript;
mod story_bible;
mod system;
mod transcript;
mod tts;

use std::sync::Arc;

use axum::Router;

use super::AppState;

pub(super) fn register(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    let router = system::register(router);
    let router = manuscript::register(router);
    let router = story_bible::register(router);
    let router = transcript::register(router);
    tts::register(router)
}

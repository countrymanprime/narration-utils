//! In-process HTTP host foundation.
//!
//! This phase implements API operations independent of the manuscript,
//! guide, REAPER, and transcript subsystems. The production shell continues
//! to launch Python until every shipped endpoint has a Rust peer.

pub mod bridge;
pub mod config;
pub mod diagnostics;
pub mod field_schemas;
pub mod guide_service;
pub mod manuscript_canonical;
pub mod manuscript_service;
pub mod process_utils;
pub mod transcript;
pub mod work_job;

use std::{
    collections::BTreeMap,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{any, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::watch;
use tower_http::services::{ServeDir, ServeFile};

use self::{
    config::SettingsStore,
    diagnostics::SessionDiagnostics,
    field_schemas::{is_valid_hex, schemas_for, FIELD_SCHEMAS},
    guide_service::GuideService,
    manuscript_service::ManuscriptService,
    work_job::WorkJob,
};

pub const API_VERSION: u8 = 1;

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub repo_root: PathBuf,
    pub session_dir: PathBuf,
    pub project_folder: Option<PathBuf>,
    pub project_name: String,
    pub daw: String,
    pub manuscript_python: String,
    pub manuscript_backend: String,
    pub compare_python: String,
    pub compare_backend: String,
    pub app_handle: Option<tauri::AppHandle>,
}

pub struct AppState {
    config: ServerConfig,
    settings: SettingsStore,
    diagnostics: SessionDiagnostics,
    revision: watch::Sender<u64>,
    shutdown: watch::Sender<bool>,
    import_job: Mutex<Option<WorkJob>>,
    guide_job: tokio::sync::Mutex<Option<WorkJob>>,
    transcript: tokio::sync::Mutex<transcript::TranscriptRun>,
    last_completed_json: tokio::sync::Mutex<Option<String>>,
    bridge: tokio::sync::Mutex<bridge::BridgeClient>,
}

impl AppState {
    pub fn new(config: ServerConfig) -> Result<(Arc<Self>, watch::Receiver<bool>), String> {
        let settings = SettingsStore::new(config.repo_root.clone(), config.project_folder.clone());
        let diagnostics = SessionDiagnostics::new(&config.session_dir)?;
        diagnostics.event(
            "hub_created",
            Map::from_iter([
                ("project_folder".to_string(), json!(config.project_folder)),
                ("project_name".to_string(), json!(config.project_name)),
            ]),
        );
        let (revision, _) = watch::channel(1_u64);
        let (shutdown, receiver) = watch::channel(false);
        let bridge = bridge::BridgeClient::new(config.session_dir.clone())?;
        // Mirrors HubState.__init__ reading back the last comparison so a
        // reopened project still shows its most recent results.
        let last_completed_json = config
            .project_folder
            .as_ref()
            .map(|project| project.join(".narration-last-comparison.json"))
            .filter(|path| path.is_file())
            .and_then(|path| std::fs::read_to_string(path).ok());
        Ok((
            Arc::new(Self {
                config,
                settings,
                diagnostics,
                revision,
                shutdown,
                import_job: Mutex::new(None),
                guide_job: tokio::sync::Mutex::new(None),
                transcript: tokio::sync::Mutex::new(transcript::TranscriptRun::default()),
                last_completed_json: tokio::sync::Mutex::new(last_completed_json),
                bridge: tokio::sync::Mutex::new(bridge),
            }),
            receiver,
        ))
    }

    fn changed(&self) {
        let next = self.revision.borrow().saturating_add(1);
        let _ = self.revision.send(next);
    }

    /// Signals the server's graceful-shutdown future (see `host::serve`) to
    /// stop accepting new requests. `reason` distinguishes an explicit
    /// `/api/shutdown` call from the window itself closing in `host.log`.
    pub fn request_shutdown(&self, reason: &str) {
        self.diagnostics
            .event(&format!("shutdown_requested_{reason}"), Map::new());
        let _ = self.shutdown.send(true);
    }

    fn health(&self) -> HealthResponse {
        self.diagnostics.event("api_ready_called", Map::new());
        HealthResponse {
            api_version: API_VERSION,
            diagnostic_id: self.diagnostics.identifier().to_string(),
        }
    }

    async fn bootstrap(&self) -> Value {
        let project_folder = self
            .config
            .project_folder
            .as_ref()
            .map(|folder| folder.to_string_lossy().to_string())
            .unwrap_or_default();
        let manuscript_path = self
            .config
            .project_folder
            .as_ref()
            .map(|folder| folder.join("narration-utils/manuscript/manuscript.json"));
        let manuscript = manuscript_path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .map(|data| {
                json!({
                    "id": data.get("documentId").cloned().unwrap_or(Value::Null),
                    "format": data.pointer("/importer/format").cloned().unwrap_or(Value::Null),
                    "sourceName": data.pointer("/source/fileName").cloned().unwrap_or(Value::Null),
                    "importedAt": data.get("importedAt").cloned().unwrap_or(Value::Null),
                })
            });
        let legacy = self
            .config
            .project_folder
            .as_ref()
            .is_some_and(|folder| folder.join("Manuscript.docx").is_file())
            && manuscript.is_none();
        self.diagnostics.event(
            "bootstrap_completed",
            Map::from_iter([("manuscript_found".to_string(), json!(manuscript.is_some()))]),
        );
        json!({
            "apiVersion": API_VERSION,
            "diagnosticId": self.diagnostics.identifier(),
            "projectFolder": project_folder,
            "projectName": self.config.project_name,
            "daw": self.config.daw,
            "manuscript": manuscript,
            "legacyManuscriptAvailable": legacy,
            "runtime": {
                "ManuscriptGuide": { "python_exe": self.config.manuscript_python, "backend": self.config.manuscript_backend },
                "TranscriptCompare": { "python_exe": self.config.compare_python, "compare_script": self.config.compare_backend },
            },
            "transcript": self.transcript.lock().await.snapshot(),
        })
    }

    fn settings_for_scope(&self, scope: &str) -> Result<Value, ApiError> {
        if !matches!(scope, "global" | "project") {
            return Err(ApiError::bad_request("Unsupported settings scope"));
        }
        let mut result = Map::new();
        for (tool, schemas) in FIELD_SCHEMAS {
            let raw = if scope == "global" {
                self.settings.global(tool)
            } else {
                self.settings.project(tool)
            };
            let defaults = self.settings.repo_defaults(tool);
            let fields = schemas
                .iter()
                .map(|field| {
                    let (effective_value, effective_source) =
                        self.settings.effective(tool, field.key, "");
                    let is_set = raw.contains_key(field.key);
                    let value = if scope == "global" {
                        raw.get(field.key)
                            .cloned()
                            .unwrap_or_else(|| defaults.get(field.key).cloned().unwrap_or_default())
                    } else {
                        raw.get(field.key).cloned().unwrap_or_default()
                    };
                    json!({
                        "key": field.key,
                        "label": field.label,
                        "kind": field.kind,
                        "choices": field.choices,
                        "value": value,
                        "isSet": is_set,
                        "effectiveValue": effective_value,
                        "effectiveSource": effective_source,
                    })
                })
                .collect::<Vec<_>>();
            result.insert((*tool).to_string(), Value::Array(fields));
        }
        Ok(Value::Object(result))
    }

    async fn save_settings(
        &self,
        tool: &str,
        scope: &str,
        values: BTreeMap<String, Option<String>>,
    ) -> Result<Value, ApiError> {
        let schemas = schemas_for(tool)
            .ok_or_else(|| ApiError::bad_request("Unsupported settings request"))?;
        if !matches!(scope, "global" | "project") {
            return Err(ApiError::bad_request("Unsupported settings request"));
        }
        for (key, value) in &values {
            let field = schemas
                .iter()
                .find(|field| field.key == key)
                .ok_or_else(|| ApiError::bad_request(format!("Unknown setting: {key}")))?;
            if let Some(value) = value {
                if field.kind == "color" && !is_valid_hex(value) {
                    return Err(ApiError::bad_request(format!(
                        "{} must be a six-digit hexadecimal color.",
                        field.label
                    )));
                }
                if field.kind == "choice" && !field.choices.contains(&value.as_str()) {
                    return Err(ApiError::bad_request(format!(
                        "Invalid value for {}.",
                        field.label
                    )));
                }
            }
        }
        self.settings
            .save_scope(tool, scope, &values)
            .map_err(ApiError::bad_request)?;
        self.changed();
        Ok(self.bootstrap().await)
    }

    fn manuscript(&self) -> ManuscriptService {
        ManuscriptService::new(self.config.project_folder.clone())
    }
    fn guide(&self) -> GuideService {
        GuideService::new(
            self.config.project_folder.clone(),
            self.config.manuscript_python.clone(),
            self.config.manuscript_backend.clone(),
            self.settings.clone(),
        )
    }

    fn start_import(&self, source: &FsPath, heading_level: u8) -> Result<Value, ApiError> {
        let project = self.config.project_folder.as_deref().ok_or_else(|| {
            ApiError::bad_request("Save the REAPER project before selecting its manuscript.")
        })?;
        let fingerprint =
            manuscript_canonical::fingerprint(source).map_err(ApiError::bad_request)?;
        let mut job = WorkJob::import(
            source.to_string_lossy().to_string(),
            fingerprint,
            manuscript_canonical::exists(project),
        );
        job.add_log(&format!(
            "Selected {}.",
            source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("manuscript")
        ));
        job.add_log("Parsing and validating the manuscript…");
        match manuscript_canonical::prepare_import(source, heading_level)
            .and_then(|draft| manuscript_canonical::preview(&draft).map(|preview| (draft, preview)))
        {
            Ok((draft, preview)) => {
                job.phase = "ready".into();
                job.message = "Import preview is ready.".into();
                job.percent = 100;
                job.draft = Some(draft);
                job.preview = Some(preview);
                job.add_log("Import preview is ready.");
            }
            Err(error) => {
                job.phase = "error".into();
                job.error = error.clone();
                job.message = format!("Import preview failed: {error}");
            }
        }
        let snapshot = job.snapshot();
        *self.import_job.lock().expect("import job mutex") = Some(job);
        Ok(snapshot)
    }
    fn select_manuscript(&self) -> Result<Value, ApiError> {
        use tauri_plugin_dialog::DialogExt;
        if self.config.project_folder.is_none() {
            return Err(ApiError::bad_request(
                "Save the REAPER project before selecting its manuscript.",
            ));
        }
        let app = self.config.app_handle.as_ref().ok_or_else(|| {
            ApiError::bad_request(
                "The manuscript picker is not available before the desktop host starts.",
            )
        })?;
        let chosen = app
            .dialog()
            .file()
            .add_filter("Manuscripts", &["docx", "md", "markdown", "pdf"])
            .blocking_pick_file();
        let Some(path) = chosen.and_then(|file| file.as_path().map(ToOwned::to_owned)) else {
            return Ok(json!({"selected":false}));
        };
        let job = self.start_import(&path, 1)?;
        Ok(json!({"selected":true,"jobId":job["id"]}))
    }
    fn import_state(&self, id: &str) -> Result<Value, ApiError> {
        let guard = self.import_job.lock().expect("import job mutex");
        let job = guard.as_ref().filter(|job| job.id == id).ok_or_else(|| {
            ApiError::bad_request("This manuscript import is no longer available.")
        })?;
        Ok(job.snapshot())
    }
    fn commit_import(&self, id: &str, confirmed: bool) -> Result<Value, ApiError> {
        let project = self
            .config
            .project_folder
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("Choose a manuscript file first."))?;
        let mut guard = self.import_job.lock().expect("import job mutex");
        let job = guard.as_mut().filter(|job| job.id == id).ok_or_else(|| {
            ApiError::bad_request("This manuscript import is no longer available.")
        })?;
        if job.phase != "ready" {
            return Err(ApiError::bad_request(
                "Wait for the manuscript preview before importing.",
            ));
        }
        if job.requires_reset && !confirmed {
            return Err(ApiError::bad_request(
                "Confirm replacement before clearing manuscript-derived project data.",
            ));
        }
        let source = PathBuf::from(&job.source);
        // Re-checked here, not just at preview time: rejects a commit if the
        // source file changed in between, instead of silently importing
        // stale content. Mirrors hub_state.py's _commit_import_job.
        if manuscript_canonical::fingerprint(&source).ok() != Some(job.source_fingerprint) {
            job.phase = "error".into();
            job.error="The selected manuscript changed after preview. Choose it again to import the current version.".into();
            return Err(ApiError::bad_request(job.error.clone()));
        }
        job.phase = "committing".into();
        job.percent = 12;
        job.message = "Writing the project-owned manuscript…".into();
        job.add_log("Writing the project-owned manuscript…");
        let data = manuscript_canonical::commit_import(
            project,
            &source,
            job.draft.as_ref().expect("ready job has draft"),
        )
        .map_err(ApiError::bad_request)?;
        if job.requires_reset {
            manuscript_canonical::reset_derivatives(project).map_err(ApiError::bad_request)?;
        }
        job.phase = "success".into();
        job.percent = 100;
        job.message = "Manuscript import complete.".into();
        job.add_log("Manuscript import complete.");
        job.result = Some(
            json!({"id":data["documentId"],"format":data["importer"]["format"],"sourceName":data["source"]["fileName"],"importedAt":data["importedAt"]}),
        );
        self.changed();
        Ok(job.snapshot())
    }
    fn clear_project_data(&self, confirmed: bool) -> Result<(), ApiError> {
        let project = self
            .config
            .project_folder
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("Save the REAPER project first."))?;
        if !confirmed {
            return Err(ApiError::bad_request(
                "Confirm clearing derived project data before continuing.",
            ));
        }
        manuscript_canonical::reset_derivatives(project).map_err(ApiError::bad_request)?;
        // Unlike a manuscript replacement, an operator-initiated reset also
        // removes the canonical manuscript itself, returning Home to its
        // pristine "no imported manuscript" state - only after derived data
        // has already been cleared, matching hub_state.py's ordering.
        manuscript_canonical::clear(project).map_err(ApiError::bad_request)?;
        self.diagnostics.event(
            "project_derived_data_cleared",
            Map::from_iter([("project_folder".to_string(), json!(project))]),
        );
        self.changed();
        Ok(())
    }

    async fn guide_build_start(&self) -> Result<Value, ApiError> {
        {
            let guard = self.guide_job.lock().await;
            if let Some(job) = guard.as_ref() {
                if matches!(job.phase.as_str(), "running" | "preparing") {
                    return Err(ApiError::bad_request(
                        "A Story Bible rebuild is already running.",
                    ));
                }
            }
        }
        let mut job = WorkJob::story_bible();
        let progress_path = self
            .config
            .session_dir
            .join(format!("guide_progress_{}.txt", job.id));
        let log_path = self
            .config
            .session_dir
            .join(format!("guide_log_{}.txt", job.id));
        match self.guide().start_build(&progress_path, &log_path).await {
            Ok((process, guide_path)) => {
                job.phase = "running".into();
                job.process = Some(process);
                job.progress_path = Some(progress_path);
                job.log_path = Some(log_path);
                job.guide_path = Some(guide_path);
                job.message = "Story Bible rebuild started.".into();
                job.percent = 1;
            }
            Err(error) => {
                job.phase = "error".into();
                job.error = error.clone();
                job.message = format!("Story Bible rebuild failed to start: {error}");
            }
        }
        let snapshot = job.snapshot();
        *self.guide_job.lock().await = Some(job);
        Ok(snapshot)
    }

    async fn guide_build_state(&self) -> Value {
        let guard = self.guide_job.lock().await;
        match guard.as_ref() {
            Some(job) => job.snapshot(),
            None => {
                json!({"id": null, "kind": "story_bible", "phase": "idle", "message": "Ready to build the Story Bible.", "percent": 0, "logs": [], "elapsed": 0, "preview": null, "requiresReset": false, "result": null, "error": ""})
            }
        }
    }

    /// One tick of guide-build progress/log/completion tracking. Mirrors
    /// `hub_state.py::_poll_guide_build`; driven by `transcript::spawn_bridge_loop`'s
    /// timer once the real server is wired up in the cutover phase -
    /// exposed as a single tick here so it stays directly testable.
    async fn poll_guide_build(&self) {
        let mut guard = self.guide_job.lock().await;
        let Some(job) = guard.as_mut() else {
            return;
        };
        if job.phase != "running" {
            return;
        }

        if let Some(progress_path) = job.progress_path.clone() {
            if let Ok(text) = std::fs::read_to_string(&progress_path) {
                if let Some(line) = text.lines().last() {
                    let mut parts = line.splitn(3, '|');
                    let _stage = parts.next().unwrap_or_default();
                    let percent_str = parts.next().unwrap_or_default();
                    let message = parts.next().unwrap_or_default();
                    let value = percent_str.parse::<u8>().unwrap_or(job.percent);
                    // Mirrors _poll_guide_build: only a non-empty message
                    // that actually changed something updates the job.
                    if !message.is_empty() && (message != job.message || value != job.percent) {
                        job.message = message.to_string();
                        job.percent = value;
                    }
                }
            }
        }

        if let Some(log_path) = job.log_path.clone() {
            if let Ok(bytes) = std::fs::read(&log_path) {
                let offset = usize::try_from(job.log_offset)
                    .unwrap_or(usize::MAX)
                    .min(bytes.len());
                if offset < bytes.len() {
                    let text = String::from_utf8_lossy(&bytes[offset..]).into_owned();
                    job.log_offset = bytes.len() as u64;
                    if !text.is_empty() {
                        job.add_log(&text);
                    }
                }
            }
        }

        let exited = match &job.process {
            Some(process) => process.has_exited().await,
            None => false,
        };
        if exited {
            let exit_code = match &job.process {
                Some(process) => process.exit_code().await,
                None => None,
            };
            let guide_ok = job.guide_path.as_deref().is_some_and(|path| path.is_file());
            if exit_code == Some(0) && guide_ok {
                job.phase = "success".into();
                job.percent = 100;
                job.result = Some(json!({"message": "Story Bible rebuilt."}));
                job.message = "Story Bible rebuild complete.".into();
                let message = job.message.clone();
                job.add_log(&message);
            } else {
                job.phase = "error".into();
                job.error =
                    "Story Bible rebuild failed. Review the activity log for details.".into();
                let message = job.error.clone();
                job.message = message.clone();
                job.add_log(&message);
            }
            self.diagnostics.event(
                "story_bible_job_complete",
                Map::from_iter([
                    ("id".to_string(), json!(job.id)),
                    ("phase".to_string(), json!(job.phase)),
                ]),
            );
        }
    }

    fn guide_entities(&self) -> Value {
        Value::Array(self.guide().entities())
    }
    async fn guide_create(
        &self,
        name: &str,
        category: &str,
        aliases: &[String],
    ) -> Result<Value, ApiError> {
        let id = self
            .guide()
            .create(name, category, aliases)
            .await
            .map_err(ApiError::bad_request)?;
        Ok(json!({"id": id}))
    }
    async fn guide_edit(
        &self,
        entity_id: &str,
        values: &BTreeMap<String, String>,
    ) -> Result<(), ApiError> {
        self.guide()
            .edit(entity_id, values)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_set_locked(&self, entity_id: &str, locked: bool) -> Result<(), ApiError> {
        self.guide()
            .set_locked(entity_id, locked)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_rescan(&self, entity_id: &str) -> Result<(), ApiError> {
        self.guide()
            .rescan(entity_id)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_merge(&self, source_id: &str, target_id: &str) -> Result<(), ApiError> {
        self.guide()
            .merge(source_id, target_id)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_delete(&self, entity_id: &str) -> Result<(), ApiError> {
        self.guide()
            .delete(entity_id)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_relate(
        &self,
        entity_id: &str,
        other_id: &str,
        label: &str,
    ) -> Result<(), ApiError> {
        self.guide()
            .relate(entity_id, other_id, label)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_unrelate(
        &self,
        entity_id: &str,
        other_id: &str,
        label: &str,
    ) -> Result<(), ApiError> {
        self.guide()
            .unrelate(entity_id, other_id, label)
            .await
            .map_err(ApiError::bad_request)
    }
    async fn guide_export(&self) -> Result<Value, ApiError> {
        Ok(json!({"path": self.guide().export_hotwords().await.map_err(ApiError::bad_request)?}))
    }
    async fn guide_preview(
        &self,
        entity_id: &str,
        alias_index: Option<i64>,
    ) -> Result<Value, ApiError> {
        // TODO(phase f): thread the real bound-port audio base URL through
        // once the server actually binds one; until then this always
        // returns a file:// URL, matching Python when guide_audio_base_url
        // is unset.
        let url = guide_service::preview_url(&self.guide(), None, entity_id, alias_index)
            .await
            .map_err(ApiError::bad_request)?;
        Ok(json!({"url": url}))
    }
}

#[derive(Serialize)]
struct HealthResponse {
    #[serde(rename = "apiVersion")]
    api_version: u8,
    #[serde(rename = "diagnosticId")]
    diagnostic_id: String,
}

#[derive(Deserialize)]
struct SettingsQuery {
    scope: String,
}

#[derive(Deserialize)]
struct DiagnosticRequest {
    kind: String,
    message: String,
}
#[derive(Deserialize)]
struct ImportOptionsRequest {
    #[serde(rename = "markdownHeadingLevel", default = "default_heading_level")]
    markdown_heading_level: u8,
    #[serde(rename = "confirmedReset", default)]
    confirmed_reset: bool,
}
fn default_heading_level() -> u8 {
    1
}
#[derive(Deserialize)]
struct ChapterStatusRequest {
    status: String,
}
#[derive(Deserialize)]
struct CreateNoteRequest {
    #[serde(rename = "chapterId")]
    chapter_id: String,
    #[serde(rename = "paragraphId")]
    paragraph_id: String,
    text: String,
    #[serde(rename = "anchorStart")]
    anchor_start: Option<i64>,
    #[serde(rename = "anchorEnd")]
    anchor_end: Option<i64>,
    #[serde(rename = "anchorText")]
    anchor_text: Option<String>,
}

#[derive(Debug)]
pub(crate) struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.message }))).into_response()
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let ui_dist = state.config.repo_root.join("shared/ui/dist");
    Router::new()
        .route("/api/health", get(health))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/settings", get(settings))
        .route("/api/settings/{tool}/{scope}", put(save_settings))
        .route("/api/diagnostics", post(report_diagnostic))
        .route("/api/shutdown", post(shutdown))
        .route("/api/manuscript/chapters", get(manuscript_chapters))
        .route(
            "/api/manuscript/chapters/{chapter}/paragraphs",
            get(manuscript_paragraphs),
        )
        .route("/api/manuscript/reader", get(manuscript_reader))
        .route(
            "/api/manuscript/reader-state",
            get(manuscript_reader_state).put(manuscript_save_reader_state),
        )
        .route(
            "/api/manuscript/bookmarks",
            post(manuscript_bookmark_create),
        )
        .route(
            "/api/manuscript/bookmarks/{bookmark_id}",
            axum::routing::delete(manuscript_bookmark_delete),
        )
        .route("/api/manuscript/search", get(manuscript_search))
        .route(
            "/api/manuscript/chapters/{chapter}/status",
            put(manuscript_set_status),
        )
        .route(
            "/api/manuscript/notes",
            get(manuscript_notes).post(manuscript_note_create),
        )
        .route(
            "/api/manuscript/notes/{note_id}",
            axum::routing::delete(manuscript_note_delete),
        )
        .route(
            "/api/manuscript/import/legacy-preview",
            post(manuscript_legacy_preview),
        )
        .route("/api/manuscript/select-file", post(manuscript_select_file))
        .route(
            "/api/manuscript/import/{job_id}",
            get(manuscript_import_state),
        )
        .route(
            "/api/manuscript/import/{job_id}/commit",
            post(manuscript_import_commit),
        )
        .route("/api/project-data/clear", post(project_data_clear))
        .route(
            "/api/guide/entities",
            get(guide_entities).post(guide_create),
        )
        .route(
            "/api/guide/entities/{entity_id}",
            axum::routing::patch(guide_edit).delete(guide_delete),
        )
        .route(
            "/api/guide/entities/{entity_id}/locked",
            put(guide_set_locked),
        )
        .route("/api/guide/entities/{entity_id}/rescan", post(guide_rescan))
        .route(
            "/api/guide/entities/{entity_id}/preview",
            get(guide_preview),
        )
        .route("/api/guide/merge", post(guide_merge))
        .route(
            "/api/guide/relationships",
            post(guide_relate).delete(guide_unrelate),
        )
        .route("/api/guide/export", get(guide_export))
        .route(
            "/api/guide/build",
            get(guide_build_state).post(guide_build_start),
        )
        .route("/api/transcript/state", get(transcript_state))
        .route("/api/transcript/events", get(transcript_events))
        .route("/api/transcript/start", post(transcript_start))
        .route("/api/transcript/cancel", post(transcript_cancel))
        .route("/api/transcript/reset", post(transcript_reset))
        .route(
            "/api/transcript/last-completed",
            get(transcript_last_completed),
        )
        .route(
            "/api/transcript/discrepancies/{row_id}/equivalence",
            post(transcript_add_equivalence),
        )
        .route(
            "/api/transcript/discrepancies/{row_id}/jump",
            post(transcript_jump),
        )
        .route(
            "/api/transcript/markers/export",
            post(transcript_export_markers),
        )
        .route(
            "/api/transcript/hints/suggestions",
            get(transcript_suggest_hints),
        )
        .route(
            "/api/transcript/hints",
            get(transcript_hints).put(transcript_save_hints),
        )
        .route("/api/{*path}", any(api_not_found))
        .fallback_service(
            ServeDir::new(&ui_dist).fallback(ServeFile::new(ui_dist.join("index.html"))),
        )
        .with_state(state)
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(state.health())
}

async fn bootstrap(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(state.bootstrap().await)
}

async fn settings(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SettingsQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.settings_for_scope(&query.scope)?))
}

async fn save_settings(
    State(state): State<Arc<AppState>>,
    Path((tool, scope)): Path<(String, String)>,
    Json(values): Json<BTreeMap<String, Option<String>>>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.save_settings(&tool, &scope, values).await?))
}

async fn report_diagnostic(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DiagnosticRequest>,
) -> StatusCode {
    state
        .diagnostics
        .client_event(&request.kind, &request.message);
    StatusCode::OK
}

async fn shutdown(State(state): State<Arc<AppState>>) -> StatusCode {
    state.request_shutdown("via_api");
    StatusCode::OK
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}
#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}
#[derive(Deserialize)]
struct NotesQuery {
    chapter: Option<String>,
}
async fn manuscript_chapters(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .chapters()
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_paragraphs(
    State(state): State<Arc<AppState>>,
    Path(chapter): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .paragraphs(&chapter)
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .search(&query.q)
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_set_status(
    State(state): State<Arc<AppState>>,
    Path(chapter): Path<String>,
    Json(body): Json<ChapterStatusRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .set_chapter_status(&chapter, &body.status)
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_notes(
    State(state): State<Arc<AppState>>,
    Query(query): Query<NotesQuery>,
) -> Json<Value> {
    Json(state.manuscript().note_list(query.chapter.as_deref()))
}
async fn manuscript_note_create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateNoteRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .note_create(
                &body.chapter_id,
                &body.paragraph_id,
                &body.text,
                body.anchor_start,
                body.anchor_end,
                body.anchor_text,
            )
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_note_delete(
    State(state): State<Arc<AppState>>,
    Path(note_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .manuscript()
        .note_delete(&note_id)
        .map_err(ApiError::bad_request)?;
    Ok(StatusCode::OK)
}
async fn manuscript_reader(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state.manuscript().reader().map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_reader_state(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(state.manuscript().reader_state())
}
#[derive(Deserialize)]
struct SaveReaderStateRequest {
    #[serde(rename = "activeChapter")]
    active_chapter: Option<String>,
    #[serde(rename = "activeSourceLine")]
    active_source_line: Option<i64>,
    #[serde(rename = "expandedChapters")]
    expanded_chapters: Option<Vec<String>>,
}
async fn manuscript_save_reader_state(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SaveReaderStateRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .save_reader_state(
                body.active_chapter,
                body.active_source_line,
                body.expanded_chapters,
            )
            .map_err(ApiError::bad_request)?,
    ))
}
#[derive(Deserialize)]
struct CreateBookmarkRequest {
    kind: String,
    chapter: String,
    #[serde(rename = "chapterId")]
    chapter_id: Option<String>,
    paragraph: Option<i64>,
    #[serde(rename = "paragraphId")]
    paragraph_id: Option<String>,
    #[serde(rename = "sourceLine")]
    source_line: Option<i64>,
    #[serde(rename = "noteId")]
    note_id: Option<String>,
}
async fn manuscript_bookmark_create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBookmarkRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .manuscript()
            .create_bookmark(
                &body.kind,
                &body.chapter,
                body.chapter_id.as_deref(),
                body.paragraph,
                body.paragraph_id.as_deref(),
                body.source_line,
                body.note_id.as_deref(),
            )
            .map_err(ApiError::bad_request)?,
    ))
}
async fn manuscript_bookmark_delete(
    State(state): State<Arc<AppState>>,
    Path(bookmark_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .manuscript()
        .delete_bookmark(&bookmark_id)
        .map_err(ApiError::bad_request)?;
    Ok(StatusCode::OK)
}

async fn guide_entities(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(state.guide_entities())
}
#[derive(Deserialize)]
struct CreateEntityRequest {
    name: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    aliases: Vec<String>,
}
async fn guide_create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateEntityRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .guide_create(&body.name, &body.category, &body.aliases)
            .await?,
    ))
}
async fn guide_edit(
    State(state): State<Arc<AppState>>,
    Path(entity_id): Path<String>,
    Json(values): Json<BTreeMap<String, String>>,
) -> Result<StatusCode, ApiError> {
    state.guide_edit(&entity_id, &values).await?;
    Ok(StatusCode::OK)
}
async fn guide_delete(
    State(state): State<Arc<AppState>>,
    Path(entity_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.guide_delete(&entity_id).await?;
    Ok(StatusCode::OK)
}
#[derive(Deserialize)]
struct SetLockedRequest {
    locked: bool,
}
async fn guide_set_locked(
    State(state): State<Arc<AppState>>,
    Path(entity_id): Path<String>,
    Json(body): Json<SetLockedRequest>,
) -> Result<StatusCode, ApiError> {
    state.guide_set_locked(&entity_id, body.locked).await?;
    Ok(StatusCode::OK)
}
async fn guide_rescan(
    State(state): State<Arc<AppState>>,
    Path(entity_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.guide_rescan(&entity_id).await?;
    Ok(StatusCode::OK)
}
#[derive(Deserialize)]
struct AliasQuery {
    #[serde(rename = "aliasIndex")]
    alias_index: Option<i64>,
}
async fn guide_preview(
    State(state): State<Arc<AppState>>,
    Path(entity_id): Path<String>,
    Query(query): Query<AliasQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state.guide_preview(&entity_id, query.alias_index).await?,
    ))
}
#[derive(Deserialize)]
struct MergeRequest {
    #[serde(rename = "sourceId")]
    source_id: String,
    #[serde(rename = "targetId")]
    target_id: String,
}
async fn guide_merge(
    State(state): State<Arc<AppState>>,
    Json(body): Json<MergeRequest>,
) -> Result<StatusCode, ApiError> {
    state.guide_merge(&body.source_id, &body.target_id).await?;
    Ok(StatusCode::OK)
}
#[derive(Deserialize)]
struct RelateRequest {
    id: String,
    #[serde(rename = "otherId")]
    other_id: String,
    label: String,
}
async fn guide_relate(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RelateRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .guide_relate(&body.id, &body.other_id, &body.label)
        .await?;
    Ok(StatusCode::OK)
}
#[derive(Deserialize)]
struct UnrelateQuery {
    id: String,
    #[serde(rename = "otherId")]
    other_id: String,
    label: String,
}
async fn guide_unrelate(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UnrelateQuery>,
) -> Result<StatusCode, ApiError> {
    state
        .guide_unrelate(&query.id, &query.other_id, &query.label)
        .await?;
    Ok(StatusCode::OK)
}
async fn guide_export(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.guide_export().await?))
}
async fn guide_build_start(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.guide_build_start().await?))
}
async fn guide_build_state(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(state.guide_build_state().await)
}

async fn transcript_state(State(state): State<Arc<AppState>>) -> Json<Value> {
    let revision = *state.revision.borrow();
    let transcript = state.transcript.lock().await.snapshot();
    Json(json!({"revision": revision, "transcript": transcript}))
}

async fn transcript_start(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BTreeMap<String, String>>,
) -> Result<StatusCode, ApiError> {
    state.transcript_start(body).await?;
    Ok(StatusCode::ACCEPTED)
}
async fn transcript_cancel(State(state): State<Arc<AppState>>) -> StatusCode {
    state.transcript_cancel().await;
    StatusCode::OK
}
async fn transcript_reset(State(state): State<Arc<AppState>>) -> Result<StatusCode, ApiError> {
    state.transcript_reset().await?;
    Ok(StatusCode::OK)
}
async fn transcript_last_completed(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(
        state
            .transcript_last_completed()
            .await
            .unwrap_or(Value::Null),
    )
}
async fn transcript_add_equivalence(
    State(state): State<Arc<AppState>>,
    Path(row_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"message": state.transcript_add_equivalence(&row_id).await?}),
    ))
}
async fn transcript_jump(
    State(state): State<Arc<AppState>>,
    Path(row_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.transcript_jump(&row_id).await?;
    Ok(StatusCode::OK)
}
async fn transcript_export_markers(
    State(state): State<Arc<AppState>>,
) -> Result<StatusCode, ApiError> {
    state.transcript_export_markers().await?;
    Ok(StatusCode::ACCEPTED)
}
async fn transcript_suggest_hints(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(state.transcript_suggest_hints().await?)))
}
async fn transcript_hints(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!(state.transcript_hints()))
}
async fn transcript_save_hints(
    State(state): State<Arc<AppState>>,
    Json(accepted): Json<Vec<String>>,
) -> Result<StatusCode, ApiError> {
    state.transcript_save_hints(accepted)?;
    Ok(StatusCode::OK)
}

/// Mirrors app.py's `/api/transcript/events`: `data: <transcript json>\n\n`
/// on every revision change, a `: heartbeat` SSE comment after >15s idle,
/// ends when the client disconnects (detected here by the send failing once
/// axum drops the response body's receiver).
async fn transcript_events(
    State(state): State<Arc<AppState>>,
) -> axum::response::sse::Sse<
    impl tokio_stream::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
> {
    use axum::response::sse::Event;
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(16);
    let mut revision_rx = state.revision.subscribe();
    tokio::spawn(async move {
        let mut last_sent = *revision_rx.borrow();
        // First tick sees the current value as "already changed"; send the
        // current snapshot immediately so a fresh client isn't stuck
        // waiting a full heartbeat interval for its first paint.
        let snapshot = state.transcript.lock().await.snapshot();
        if tx
            .send(Ok(Event::default().data(snapshot.to_string())))
            .await
            .is_err()
        {
            return;
        }
        loop {
            let sleep = tokio::time::sleep(std::time::Duration::from_secs(15));
            tokio::select! {
                changed = revision_rx.changed() => {
                    if changed.is_err() { break; }
                    let current = *revision_rx.borrow();
                    if current != last_sent {
                        last_sent = current;
                        let snapshot = state.transcript.lock().await.snapshot();
                        if tx.send(Ok(Event::default().data(snapshot.to_string()))).await.is_err() { break; }
                    }
                }
                _ = sleep => {
                    if tx.send(Ok(Event::default().comment("heartbeat"))).await.is_err() { break; }
                }
            }
        }
    });
    axum::response::sse::Sse::new(tokio_stream::wrappers::ReceiverStream::new(rx))
}
async fn manuscript_select_file(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.select_manuscript()?))
}
async fn manuscript_legacy_preview(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let project = state.config.project_folder.as_deref().ok_or_else(|| {
        ApiError::bad_request("Save the REAPER project before importing a manuscript.")
    })?;
    let job = state.start_import(&project.join("Manuscript.docx"), 1)?;
    Ok(Json(json!({"selected":true,"jobId":job["id"]})))
}
async fn manuscript_import_state(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.import_state(&job_id)?))
}
async fn manuscript_import_commit(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    Json(body): Json<ImportOptionsRequest>,
) -> Result<Json<Value>, ApiError> {
    let _ = body.markdown_heading_level;
    Ok(Json(state.commit_import(&job_id, body.confirmed_reset)?))
}
#[derive(Deserialize)]
struct ClearProjectDataRequest {
    confirmed: bool,
}
async fn project_data_clear(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ClearProjectDataRequest>,
) -> Result<StatusCode, ApiError> {
    state.clear_project_data(body.confirmed)?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::{manuscript_canonical, router, AppState, ServerConfig};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::Value;
    use std::{path::PathBuf, sync::Arc};
    use tower::ServiceExt;

    fn state(project_folder: Option<PathBuf>) -> Arc<AppState> {
        let session_dir = std::env::temp_dir().join(format!(
            "narration-utils-server-test-{}",
            std::process::id()
        ));
        let (state, _) = AppState::new(ServerConfig {
            repo_root: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
            session_dir,
            project_folder,
            project_name: "Unsaved REAPER project".to_string(),
            daw: "REAPER".to_string(),
            manuscript_python: String::new(),
            manuscript_backend: String::new(),
            compare_python: String::new(),
            compare_backend: String::new(),
            app_handle: None,
        })
        .unwrap();
        state
    }

    #[tokio::test]
    async fn health_and_bootstrap_are_reachable_without_a_tcp_listener() {
        let app = router(state(None));
        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        let bootstrap = app
            .oneshot(
                Request::builder()
                    .uri("/api/bootstrap")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bootstrap.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn unknown_routes_remain_not_found() {
        let response = router(state(None))
            .oneshot(
                Request::builder()
                    .uri("/api/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn project_settings_save_and_validate_through_the_router() {
        let project = std::env::temp_dir().join(format!(
            "narration-utils-settings-test-{}",
            std::process::id()
        ));
        let app = router(state(Some(project.clone())));
        let saved = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/settings/TranscriptCompare/project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"color_extra":"112233"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(saved.status(), StatusCode::OK);
        let settings =
            std::fs::read_to_string(project.join("narration-utils/settings.json")).unwrap();
        assert!(settings.contains("112233"));

        let rejected = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/settings/TranscriptCompare/project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"color_extra":"not-a-color"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(project);
    }

    #[test]
    fn commit_rejects_a_source_file_that_changed_after_preview() {
        let project = std::env::temp_dir().join(format!(
            "narration-utils-fingerprint-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&project);
        let source_dir = std::env::temp_dir().join(format!(
            "narration-utils-fingerprint-source-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&source_dir);
        std::fs::create_dir_all(&source_dir).unwrap();
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = source_dir.join("book.md");
        std::fs::copy(repo.join("shared/test-fixtures/alice.md"), &source).unwrap();

        let app_state = state(Some(project.clone()));
        let preview = app_state
            .start_import(&source, 1)
            .expect("preview succeeds");
        let job_id = preview["id"].as_str().unwrap().to_string();
        assert_eq!(preview["phase"], "ready");

        // Editing the source after preview (but before commit) must be
        // caught, not silently imported.
        std::fs::write(&source, "# Changed\n\nDifferent content entirely.\n").unwrap();

        let error = app_state
            .commit_import(&job_id, false)
            .expect_err("changed source must be rejected");
        assert!(
            error.message.contains("changed after preview"),
            "unexpected message: {}",
            error.message
        );
        assert!(
            !manuscript_canonical::exists(&project),
            "a rejected commit must not write the canonical manuscript"
        );

        let _ = std::fs::remove_dir_all(project);
        let _ = std::fs::remove_dir_all(source_dir);
    }

    #[test]
    fn clear_project_data_requires_confirmation_and_removes_the_manuscript() {
        let project =
            std::env::temp_dir().join(format!("narration-utils-clear-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&project);
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = repo.join("shared/test-fixtures/alice.md");

        let app_state = state(Some(project.clone()));
        let preview = app_state
            .start_import(&source, 1)
            .expect("preview succeeds");
        let job_id = preview["id"].as_str().unwrap().to_string();
        app_state
            .commit_import(&job_id, false)
            .expect("first import needs no confirmation");
        assert!(manuscript_canonical::exists(&project));

        let unconfirmed = app_state.clear_project_data(false);
        assert!(
            unconfirmed.is_err(),
            "clearing without confirmation must be rejected"
        );
        assert!(
            manuscript_canonical::exists(&project),
            "an unconfirmed clear must not touch anything"
        );

        app_state
            .clear_project_data(true)
            .expect("confirmed clear succeeds");
        assert!(!manuscript_canonical::exists(&project));

        let _ = std::fs::remove_dir_all(project);
    }

    fn state_with_backend(project: PathBuf, python_exe: String, backend: String) -> Arc<AppState> {
        let session_dir = std::env::temp_dir().join(format!(
            "narration-utils-guide-build-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&session_dir);
        let (state, _) = AppState::new(ServerConfig {
            repo_root: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
            session_dir,
            project_folder: Some(project),
            project_name: "Test project".to_string(),
            daw: "REAPER".to_string(),
            manuscript_python: python_exe,
            manuscript_backend: backend,
            compare_python: String::new(),
            compare_backend: String::new(),
            app_handle: None,
        })
        .unwrap();
        state
    }

    /// Stands in for `manuscript_guide.py build`: writes a couple of
    /// progress lines, some log text, and an empty guide JSON file, then
    /// exits 0 - just enough of the real contract
    /// (`--progress`/`--log`/`--out`, `stage|percent|message` lines) to
    /// exercise `poll_guide_build`'s file-tailing and completion detection
    /// without spaCy.
    fn write_fake_guide_build_backend(dir: &std::path::Path) -> PathBuf {
        let script = dir.join("fake_build_backend.py");
        std::fs::write(
            &script,
            r#"
import argparse, time
parser = argparse.ArgumentParser()
parser.add_argument("mode")
parser.add_argument("--manuscript")
parser.add_argument("--out")
parser.add_argument("--spacy-model")
parser.add_argument("--progress")
parser.add_argument("--log")
args = parser.parse_args()
with open(args.progress, "w", encoding="utf-8") as f:
    f.write("LOAD|5|Loading manuscript...\n")
with open(args.log, "w", encoding="utf-8") as f:
    f.write("starting up\n")
time.sleep(0.1)
with open(args.progress, "a", encoding="utf-8") as f:
    f.write("DONE|100|Finished\n")
with open(args.log, "a", encoding="utf-8") as f:
    f.write("done\n")
with open(args.out, "w", encoding="utf-8") as f:
    f.write("{}")
"#,
        )
        .unwrap();
        script
    }

    async fn poll_until_settled(state: &AppState) -> Value {
        for _ in 0..100 {
            state.poll_guide_build().await;
            let snapshot = state.guide_build_state().await;
            if snapshot["phase"] != "running" {
                return snapshot;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        state.guide_build_state().await
    }

    #[tokio::test]
    async fn guide_build_runs_end_to_end_through_a_fake_backend() {
        let project = std::env::temp_dir().join(format!(
            "narration-utils-guide-build-project-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(project.join("narration-utils/manuscript")).unwrap();
        std::fs::write(
            project.join("narration-utils/manuscript/manuscript.json"),
            "{}",
        )
        .unwrap();

        let python_exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.venv/Scripts/python.exe")
            .to_string_lossy()
            .to_string();
        let backend = write_fake_guide_build_backend(&project)
            .to_string_lossy()
            .to_string();
        let state = state_with_backend(project.clone(), python_exe, backend);

        let started = state.guide_build_start().await.expect("start succeeds");
        assert_eq!(started["phase"], "running");

        let settled = poll_until_settled(&state).await;
        assert_eq!(
            settled["phase"], "success",
            "unexpected snapshot: {settled}"
        );
        assert_eq!(settled["percent"], 100);
        let logs = settled["logs"].as_array().unwrap();
        assert!(
            logs.iter().any(|line| line == "starting up"),
            "logs: {logs:?}"
        );
        assert!(logs.iter().any(|line| line == "done"), "logs: {logs:?}");

        // A second start while idle-after-success is allowed; while running
        // it must be rejected - covered implicitly by the immediate
        // duplicate-start check below on the same (now finished) job kind.
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn guide_build_rejects_a_second_start_while_one_is_running() {
        let project = std::env::temp_dir().join(format!(
            "narration-utils-guide-build-busy-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(project.join("narration-utils/manuscript")).unwrap();
        std::fs::write(
            project.join("narration-utils/manuscript/manuscript.json"),
            "{}",
        )
        .unwrap();

        let python_exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.venv/Scripts/python.exe")
            .to_string_lossy()
            .to_string();
        let backend = write_fake_guide_build_backend(&project)
            .to_string_lossy()
            .to_string();
        let state = state_with_backend(project.clone(), python_exe, backend);

        state
            .guide_build_start()
            .await
            .expect("first start succeeds");
        let error = state
            .guide_build_start()
            .await
            .expect_err("second start while running must be rejected");
        assert!(
            error.message.contains("already running"),
            "unexpected message: {}",
            error.message
        );

        let _ = poll_until_settled(&state).await;
        let _ = std::fs::remove_dir_all(project);
    }
}

//! Transcript Compare lifecycle: launches `compare.py`, tracks its
//! progress/output, and drives the REAPER bridge conversation
//! (`prepare_compare` -> `COMPARE_PREPARED` -> launch -> `inspect_compare_results`
//! -> `COMPARE_MARKER`*/`COMPARE_INSPECTED`). Ported line-for-line from
//! `hub_state.py`'s transcript-compare section and `_handle_event` - field
//! orders below are a fixed wire contract with REAPER's Lua bridge, not
//! ours to change.

use std::path::Path;
use std::time::Instant;

use serde_json::{json, Value};

use super::{process_utils, process_utils::DetachedProcess, ApiError, AppState};

pub struct TranscriptRun {
    pub phase: String,
    pub run_id: String,
    pub percent: f64,
    pub message: String,
    pub logs: Vec<String>,
    pub chapters: Vec<String>,
    pub rows: Vec<Value>,
    pub diff: String,
    pub summary: String,
    pub marker_export_phase: String,
    pub marker_export_message: String,
    pub marker_export_added: i64,
    pub marker_export_skipped: i64,
    pub started: Option<Instant>,
    pub manifest: Option<String>,
    pub output: Option<String>,
    pub progress: Option<String>,
    pub log_path: Option<String>,
    pub diff_path: Option<String>,
    pub backend_process: Option<DetachedProcess>,
    pub log_offset: u64,
    pub pending_options: std::collections::BTreeMap<String, String>,
}

impl Default for TranscriptRun {
    fn default() -> Self {
        Self {
            phase: "idle".into(), run_id: String::new(), percent: 0.0,
            message: "Select a track in REAPER, then start a comparison.".into(),
            logs: Vec::new(), chapters: Vec::new(), rows: Vec::new(), diff: String::new(), summary: String::new(),
            marker_export_phase: "idle".into(), marker_export_message: String::new(),
            marker_export_added: 0, marker_export_skipped: 0, started: None,
            manifest: None, output: None, progress: None, log_path: None, diff_path: None,
            backend_process: None, log_offset: 0, pending_options: std::collections::BTreeMap::new(),
        }
    }
}

impl TranscriptRun {
    pub fn add_log(&mut self, text: &str) {
        for line in text.lines() {
            if !line.is_empty() { self.logs.push(line.to_string()); }
        }
        if self.logs.len() > 500 {
            let start = self.logs.len() - 500;
            self.logs.drain(0..start);
        }
    }

    pub fn snapshot(&self) -> Value {
        let start = self.logs.len().saturating_sub(500);
        json!({
            "runId": if self.run_id.is_empty() { Value::Null } else { json!(self.run_id) },
            "phase": self.phase, "percent": self.percent, "message": self.message,
            "logs": self.logs[start..],
            "chapters": self.chapters, "rows": self.rows, "diff": self.diff, "summary": self.summary,
            "markerExport": {
                "phase": self.marker_export_phase, "message": self.marker_export_message,
                "added": self.marker_export_added, "skipped": self.marker_export_skipped,
            },
            "elapsed": self.started.map(|start| start.elapsed().as_secs_f64()).unwrap_or(0.0),
        })
    }
}

impl AppState {
    fn compare(&self) -> (String, String) {
        (self.config.compare_python.clone(), self.config.compare_backend.clone())
    }

    pub async fn transcript_start(&self, options: std::collections::BTreeMap<String, String>) -> Result<(), ApiError> {
        let project = {
            let mut run = self.transcript.lock().await;
            if matches!(run.phase.as_str(), "preparing" | "running") {
                return Err(ApiError::bad_request("A comparison is already running."));
            }
            let project = self.config.project_folder.clone().filter(|project| super::manuscript_canonical::exists(project))
                .ok_or_else(|| ApiError::bad_request("Save the REAPER project and import a manuscript first."))?;
            let run_id = format!("{}000", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
            let hints_path = project.join("TranscriptCompare/vocabulary_hints.txt");
            if let Some(parent) = hints_path.parent() { std::fs::create_dir_all(parent).map_err(|error| ApiError::bad_request(format!("Could not prepare Transcript Compare storage: {error}")))?; }
            std::fs::write(&hints_path, options.get("hints").map(|value| value.trim()).unwrap_or("")).map_err(|error| ApiError::bad_request(format!("Could not write vocabulary hints: {error}")))?;
            *run = TranscriptRun { phase: "preparing".into(), run_id: run_id.clone(), message: "Preparing the selected REAPER audio…".into(), started: Some(Instant::now()), pending_options: options, ..Default::default() };
            let mut bridge = self.bridge.lock().await;
            let _ = bridge.send("prepare_compare", &[&run_id]);
            project
        };
        let _ = project;
        self.changed();
        Ok(())
    }

    pub async fn transcript_cancel(&self) {
        let progress = {
            let mut run = self.transcript.lock().await;
            if matches!(run.phase.as_str(), "preparing" | "need_chapter") { run.phase = "cancelled".into(); }
            run.message = "Cancellation requested…".into();
            run.progress.clone()
        };
        if let Some(progress) = progress {
            let _ = std::fs::write(format!("{progress}.cancel"), "cancel");
        }
        self.changed();
    }

    pub async fn transcript_reset(&self) -> Result<(), ApiError> {
        {
            let mut run = self.transcript.lock().await;
            if matches!(run.phase.as_str(), "preparing" | "running") {
                return Err(ApiError::bad_request("Cancel the active comparison before starting a new one."));
            }
            *run = TranscriptRun::default();
        }
        self.changed();
        Ok(())
    }

    pub async fn transcript_last_completed(&self) -> Option<Value> {
        let text = self.last_completed_json.lock().await.clone()?;
        if text.trim().is_empty() { return None; }
        serde_json::from_str(&text).ok()
    }

    pub async fn transcript_jump(&self, row_id: &str) -> Result<(), ApiError> {
        let (run_id, ok) = { let run = self.transcript.lock().await; (run.run_id.clone(), run.rows.iter().any(|row| row["id"] == row_id)) };
        if !ok { return Err(ApiError::bad_request("That discrepancy is no longer available.")); }
        let mut bridge = self.bridge.lock().await;
        let _ = bridge.send("jump_to_compare_marker", &[&run_id, row_id]);
        Ok(())
    }

    pub async fn transcript_export_markers(&self) -> Result<(), ApiError> {
        let (run_id, output, pending) = {
            let run = self.transcript.lock().await;
            if run.phase != "success" || run.run_id.is_empty() || run.output.is_none() {
                return Err(ApiError::bad_request("Run a comparison in this session before exporting its markers."));
            }
            if run.marker_export_phase == "exporting" { return Err(ApiError::bad_request("Marker export is already in progress.")); }
            let pending = run.rows.iter().filter(|row| row["markerState"] == "pending").count();
            if pending == 0 { return Err(ApiError::bad_request("There are no new markers ready to export.")); }
            (run.run_id.clone(), run.output.clone().unwrap(), pending)
        };
        let misread = self.settings.effective("TranscriptCompare", "color_misread", "FF4040").0;
        let skipped = self.settings.effective("TranscriptCompare", "color_skipped", "FFC000").0;
        let extra = self.settings.effective("TranscriptCompare", "color_extra", "40A0FF").0;
        {
            let mut run = self.transcript.lock().await;
            run.marker_export_phase = "exporting".into();
            run.marker_export_message = format!("Exporting {pending} marker{} to REAPER…", if pending == 1 { "" } else { "s" });
            run.marker_export_added = 0;
            run.marker_export_skipped = 0;
            let mut bridge = self.bridge.lock().await;
            let _ = bridge.send("export_compare_markers", &[&run_id, &output, &misread, &skipped, &extra]);
        }
        self.changed();
        Ok(())
    }

    pub async fn transcript_add_equivalence(&self, row_id: &str) -> Result<String, ApiError> {
        let project = self.config.project_folder.clone().ok_or_else(|| ApiError::bad_request("Select a single-word MISREAD result to add an equivalence."))?;
        let run = self.transcript.lock().await;
        let row = run.rows.iter().find(|row| row["id"] == row_id);
        let doc_text = row.and_then(|row| row["docText"].as_str());
        let audio_text = row.and_then(|row| row["audioText"].as_str());
        let invalid = row.is_none()
            || row.map(|row| row["kind"] != "MISREAD").unwrap_or(true)
            || doc_text.is_none_or(str::is_empty)
            || audio_text.is_none_or(str::is_empty)
            || doc_text.is_some_and(|text| text.contains(' '))
            || audio_text.is_some_and(|text| text.contains(' '));
        if invalid { return Err(ApiError::bad_request("Select a single-word MISREAD result to add an equivalence.")); }
        let (doc_text, audio_text) = (doc_text.unwrap(), audio_text.unwrap());
        let path = project.join("TranscriptCompare/equivalences.csv");
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| ApiError::bad_request(format!("Could not prepare Transcript Compare storage: {error}")))?; }
        if !path.is_file() {
            std::fs::write(&path, "# Transcript Compare - custom word equivalences\n# One comma-separated group per line.\n").map_err(|error| ApiError::bad_request(format!("Could not create equivalences file: {error}")))?;
        }
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).map_err(|error| ApiError::bad_request(format!("Could not update equivalences file: {error}")))?;
        writeln!(file, "{doc_text}, {audio_text}").map_err(|error| ApiError::bad_request(format!("Could not update equivalences file: {error}")))?;
        Ok(format!("Added equivalence: {doc_text} = {audio_text}"))
    }

    pub async fn transcript_suggest_hints(&self) -> Result<String, ApiError> {
        let accepted = self.transcript_hints();
        let accepted_lower: std::collections::HashSet<String> = accepted.iter().map(|value| value.to_lowercase()).collect();
        let candidates = self.guide().vocabulary_candidates().map_err(ApiError::bad_request)?;
        Ok(candidates.into_iter().filter(|candidate| !accepted_lower.contains(&candidate.to_lowercase())).collect::<Vec<_>>().join(", "))
    }

    fn vocab_hints_path(&self) -> Option<std::path::PathBuf> {
        self.config.project_folder.as_ref().map(|project| project.join("TranscriptCompare/vocab_hints.json"))
    }

    pub fn transcript_hints(&self) -> Vec<String> {
        let Some(path) = self.vocab_hints_path() else { return Vec::new(); };
        let Ok(text) = std::fs::read_to_string(path) else { return Vec::new(); };
        serde_json::from_str(&text).unwrap_or_default()
    }

    pub fn transcript_save_hints(&self, accepted: Vec<String>) -> Result<(), ApiError> {
        let path = self.vocab_hints_path().ok_or_else(|| ApiError::bad_request("Select a manuscript first."))?;
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| ApiError::bad_request(format!("Could not save hints: {error}")))?; }
        let mut seen: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
        for hint in accepted {
            let trimmed = hint.trim().to_string();
            if !trimmed.is_empty() { seen.entry(trimmed.to_lowercase()).or_insert(trimmed); }
        }
        let mut values: Vec<String> = seen.into_values().collect();
        values.sort_by_key(|value| value.to_lowercase());
        std::fs::write(&path, serde_json::to_string(&values).expect("string list serializes")).map_err(|error| ApiError::bad_request(format!("Could not save hints: {error}")))
    }

    fn persist_last_comparison(&self, run: &TranscriptRun) {
        let text = serde_json::to_string(&run.snapshot()).expect("snapshot serializes");
        if let Some(project) = &self.config.project_folder {
            let _ = std::fs::write(project.join(".narration-last-comparison.json"), &text);
        }
        // Stashed for transcript_last_completed(); written on the same tick
        // so a caller polling right after COMPARE_INSPECTED/COMPARE_EXPORTED
        // sees it without waiting for a file round-trip.
        if let Ok(mut cache) = self.last_completed_json.try_lock() { *cache = Some(text); }
    }

    /// One event from REAPER's bridge. Field orders here are a fixed wire
    /// contract with `shared/reaper/narration_ui_bridge.lua` - verified
    /// against `hub_state.py::_handle_event`, not ours to change.
    pub async fn handle_bridge_event(&self, fields: Vec<String>) {
        let Some((tag, rest)) = fields.split_first() else { return; };
        match (tag.as_str(), rest.len()) {
            ("COMPARE_PREPARED", n) if n >= 5 => {
                let (run_id, manifest, manuscript, track, diff_path) = (&rest[0], &rest[1], rest[2].clone(), rest[3].clone(), &rest[4]);
                let should_launch = {
                    let mut run = self.transcript.lock().await;
                    if run_id != &run.run_id || run.phase != "preparing" { false } else {
                        run.manifest = Some(manifest.clone());
                        run.diff_path = Some(diff_path.clone());
                        true
                    }
                };
                if should_launch { self.launch_backend(&manuscript, &track).await; }
            }
            ("COMPARE_MARKER", n) if n >= 8 => {
                let run_id = &rest[0];
                let mut run = self.transcript.lock().await;
                if run_id == &run.run_id && run.phase == "inspecting" {
                    let doc_text = rest[4].clone();
                    let audio_text = rest[5].clone();
                    run.rows.push(json!({
                        "id": rest[1], "kind": rest[2], "name": rest[3], "docText": doc_text, "audioText": audio_text,
                        "projectTime": rest[6].parse::<f64>().unwrap_or(0.0), "itemIndex": rest[7].parse::<i64>().unwrap_or(0),
                        "srcpos": rest.get(14).and_then(|value| value.parse::<f64>().ok()).unwrap_or(0.0),
                        "chapter": rest.get(8).cloned().unwrap_or_default(), "paragraph": rest.get(9).and_then(|value| value.parse::<i64>().ok()).unwrap_or(0),
                        "scriptContext": rest.get(10).cloned().unwrap_or_else(|| doc_text.clone()), "audioContext": rest.get(11).cloned().unwrap_or_else(|| audio_text.clone()),
                        "markerState": rest.get(12).cloned().unwrap_or_else(|| "pending".to_string()),
                        "existingMarkerName": rest.get(13).cloned().unwrap_or_default(),
                    }));
                    drop(run);
                    self.changed();
                }
            }
            ("COMPARE_INSPECTED", n) if n >= 4 => {
                let run_id = rest[0].clone();
                let mut run = self.transcript.lock().await;
                if run_id == run.run_id && run.phase == "inspecting" {
                    run.phase = "success".into();
                    run.percent = 100.0;
                    let existing_count: i64 = rest[3].parse().unwrap_or(0);
                    run.summary = if existing_count > 0 { format!("{} {existing_count} already marked.", rest[1]) } else { rest[1].clone() };
                    run.message = "Comparison complete — review discrepancies before exporting markers.".into();
                    self.persist_last_comparison(&run);
                    drop(run);
                    self.changed();
                }
            }
            ("COMPARE_EXPORT_MARKER", n) if n >= 3 => {
                let run_id = rest[0].clone();
                let mut run = self.transcript.lock().await;
                if run_id == run.run_id && run.marker_export_phase == "exporting" {
                    let marker_state = rest[2].clone();
                    let existing_marker_name = rest.get(3).cloned().unwrap_or_default();
                    if let Some(row) = run.rows.iter_mut().find(|row| row["id"] == rest[1]) {
                        row["markerState"] = json!(marker_state);
                        row["existingMarkerName"] = json!(existing_marker_name);
                    }
                    drop(run);
                    self.changed();
                }
            }
            ("COMPARE_EXPORTED", n) if n >= 3 => {
                let run_id = rest[0].clone();
                let (added, skipped): (i64, i64) = (rest[1].parse().unwrap_or(0), rest[2].parse().unwrap_or(0));
                let mut run = self.transcript.lock().await;
                if run_id == run.run_id && run.marker_export_phase == "exporting" {
                    run.marker_export_phase = "complete".into();
                    run.marker_export_added = added;
                    run.marker_export_skipped = skipped;
                    run.marker_export_message = format!("Exported {added} marker{}; skipped {skipped} existing.", if added == 1 { "" } else { "s" });
                    self.persist_last_comparison(&run);
                    drop(run);
                    self.changed();
                }
            }
            ("ERROR", _) => {
                let message = rest.first().cloned().unwrap_or_else(|| "REAPER integration failed.".to_string());
                let mut run = self.transcript.lock().await;
                if run.marker_export_phase == "exporting" {
                    run.marker_export_phase = "error".into();
                    run.marker_export_message = message;
                } else {
                    run.phase = "error".into();
                    run.message = message;
                }
                drop(run);
                self.changed();
            }
            _ => {}
        }
    }

    async fn launch_backend(&self, manuscript: &str, track: &str) {
        let (compare_python, compare_backend) = self.compare();
        let mut run = self.transcript.lock().await;
        if run.manifest.is_none() { return; }
        let output = self.config.session_dir.join(format!("results_{}.txt", run.run_id)).to_string_lossy().to_string();
        let progress = self.config.session_dir.join(format!("progress_{}.txt", run.run_id)).to_string_lossy().to_string();
        let log_path = self.config.session_dir.join(format!("log_{}.txt", run.run_id)).to_string_lossy().to_string();
        let mut args = vec![
            compare_backend, "--manifest".to_string(), run.manifest.clone().unwrap(), "--manuscript".to_string(), manuscript.to_string(),
            "--track-name".to_string(), track.to_string(), "--out".to_string(), output.clone(),
            "--diff-out".to_string(), run.diff_path.clone().unwrap_or_default(),
            "--model".to_string(), run.pending_options.get("model").cloned().unwrap_or_else(|| "small".to_string()),
            "--progress".to_string(), progress.clone(), "--log".to_string(), log_path.clone(),
        ];
        if let Some(chapter_title) = run.pending_options.get("chapterTitle").filter(|value| !value.is_empty()) {
            args.push("--chapter-title".to_string());
            args.push(chapter_title.clone());
        }
        if let Some(chunk) = run.pending_options.get("chunk").filter(|value| value.trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) && !value.is_empty()) {
            let workers = run.pending_options.get("workers").cloned().unwrap_or_default();
            args.push("--chunk-seconds".to_string());
            args.push(chunk.clone());
            args.push("--parallel-workers".to_string());
            args.push(if workers == "Auto" { "0".to_string() } else if workers.is_empty() { "0".to_string() } else { workers });
        }
        run.phase = "running".into();
        run.message = "Launching transcript backend…".into();
        run.output = Some(output);
        run.progress = Some(progress);
        run.log_path = Some(log_path);
        run.backend_process = process_utils::start_detached(&compare_python, &args).ok();
        drop(run);
        self.changed();
    }

    /// One tick of transcript-backend progress/log/completion tracking.
    /// Mirrors `hub_state.py::_poll_backend`.
    pub async fn poll_backend(&self) {
        let (progress, log_path, output, has_process) = {
            let run = self.transcript.lock().await;
            if run.phase != "running" { return; }
            (run.progress.clone(), run.log_path.clone(), run.output.clone(), run.backend_process.is_some())
        };

        if let Some(progress) = &progress {
            if let Ok(text) = std::fs::read_to_string(progress) {
                if let Some(last) = text.lines().last() {
                    if let Some((stage, rest)) = last.split_once('|') {
                        if !rest.is_empty() {
                            let (pct, detail) = rest.split_once('|').unwrap_or((rest, ""));
                            let mut run = self.transcript.lock().await;
                            run.percent = pct.parse().unwrap_or(0.0);
                            run.message = if detail.is_empty() { stage.to_string() } else { detail.to_string() };
                            let terminal = matches!(stage, "CANCELLED" | "ERROR");
                            if terminal { run.phase = if stage == "CANCELLED" { "cancelled".into() } else { "error".into() }; }
                            drop(run);
                            self.changed();
                            if terminal { return; }
                        }
                    }
                }
            }
        }

        if let Some(log_path) = &log_path {
            if let Ok(bytes) = std::fs::read(log_path) {
                let mut run = self.transcript.lock().await;
                let offset = usize::try_from(run.log_offset).unwrap_or(usize::MAX).min(bytes.len());
                if offset < bytes.len() {
                    let text = String::from_utf8_lossy(&bytes[offset..]).into_owned();
                    run.log_offset = bytes.len() as u64;
                    if !text.is_empty() { run.add_log(&text); }
                }
            }
        }

        if !has_process { return; }
        let exited = { let run = self.transcript.lock().await; match &run.backend_process { Some(process) => process.has_exited().await, None => false } };
        if !exited { return; }
        let Some(output) = output else { return; };
        if !Path::new(&output).is_file() { return; }
        let content = std::fs::read_to_string(&output).unwrap_or_default();

        if let Some(rest) = content.strip_prefix("NEED_CHAPTER|") {
            let mut run = self.transcript.lock().await;
            run.phase = "need_chapter".into();
            run.chapters = rest.trim().split('|').filter(|value| !value.is_empty()).map(str::to_string).collect();
            run.message = "Choose the manuscript chapter.".into();
            drop(run);
            self.changed();
            return;
        }
        let exit_code = { let run = self.transcript.lock().await; match &run.backend_process { Some(process) => process.exit_code().await, None => None } };
        if exit_code == Some(2) {
            let mut run = self.transcript.lock().await;
            run.phase = "cancelled".into();
            run.message = "Cancelled — no markers were added.".into();
            drop(run); self.changed();
            return;
        }
        if exit_code != Some(0) {
            let mut run = self.transcript.lock().await;
            run.phase = "error".into();
            run.message = "Transcript backend failed.".into();
            drop(run); self.changed();
            return;
        }
        let run_id = { self.transcript.lock().await.run_id.clone() };
        { let mut bridge = self.bridge.lock().await; let _ = bridge.send("inspect_compare_results", &[&run_id, &output]); }
        let mut run = self.transcript.lock().await;
        run.phase = "inspecting".into();
        run.message = "Checking existing take markers in REAPER…".into();
        run.backend_process = None;
        if let Some(diff_path) = run.diff_path.clone() {
            if Path::new(&diff_path).is_file() {
                run.diff = std::fs::read_to_string(&diff_path).unwrap_or_default();
            }
        }
        drop(run);
        self.changed();
    }
}

/// Drains new REAPER bridge events and ticks both subprocess pollers - one
/// task, ~150ms cadence, mirroring `hub_state.py::_bridge_loop` exactly
/// (all three concerns share one loop there too).
pub fn spawn_bridge_loop(state: std::sync::Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            let events = { let mut bridge = state.bridge.lock().await; bridge.read_events() };
            for line in events {
                state.handle_bridge_event(super::bridge::decode_fields(&line)).await;
            }
            state.poll_backend().await;
            state.poll_guide_build().await;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::super::{manuscript_canonical, AppState, ServerConfig};
    use std::{path::PathBuf, sync::Arc};

    fn project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("narration-utils-transcript-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state(project: PathBuf, compare_python: String, compare_backend: String) -> Arc<AppState> {
        let session_dir = std::env::temp_dir().join(format!("narration-utils-transcript-session-{}-{}", project.file_name().unwrap().to_string_lossy(), std::process::id()));
        let _ = std::fs::remove_dir_all(&session_dir);
        let (state, _) = AppState::new(ServerConfig {
            repo_root: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
            session_dir,
            project_folder: Some(project),
            project_name: "Test project".to_string(),
            daw: "REAPER".to_string(),
            manuscript_python: String::new(),
            manuscript_backend: String::new(),
            compare_python,
            compare_backend,
            app_handle: None,
        })
        .unwrap();
        state
    }

    fn import_manuscript(project: &std::path::Path) {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = repo.join("shared/test-fixtures/alice.md");
        let draft = manuscript_canonical::prepare_import(&source, 1).expect("fixture parses");
        manuscript_canonical::commit_import(project, &source, &draft).expect("commit succeeds");
    }

    fn write_fake_compare_backend(dir: &std::path::Path) -> PathBuf {
        let script = dir.join("fake_compare.py");
        std::fs::write(&script, r#"
import argparse, time
parser = argparse.ArgumentParser()
parser.add_argument("--manifest"); parser.add_argument("--manuscript"); parser.add_argument("--track-name")
parser.add_argument("--out"); parser.add_argument("--diff-out"); parser.add_argument("--model")
parser.add_argument("--progress"); parser.add_argument("--log")
parser.add_argument("--chapter-title", default=None)
parser.add_argument("--chunk-seconds", default=None); parser.add_argument("--parallel-workers", default=None)
args = parser.parse_args()
with open(args.progress, "w", encoding="utf-8") as f:
    f.write("TRANSCRIBE|50|Transcribing...\n")
with open(args.log, "w", encoding="utf-8") as f:
    f.write("transcribing\n")
time.sleep(0.1)
with open(args.progress, "a", encoding="utf-8") as f:
    f.write("DONE|100|Finished\n")
with open(args.diff_out, "w", encoding="utf-8") as f:
    f.write("--- diff ---\n")
with open(args.out, "w", encoding="utf-8") as f:
    f.write("SUMMARY|1 discrepancy found\n")
"#).unwrap();
        script
    }

    #[tokio::test]
    async fn start_requires_an_imported_manuscript() {
        let project = project("start-no-manuscript");
        let state = state(project.clone(), String::new(), String::new());
        let error = state.transcript_start(Default::default()).await.expect_err("must be rejected");
        assert!(error.message.contains("import a manuscript"), "unexpected message: {}", error.message);
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn start_writes_hints_and_sends_prepare_compare_over_the_bridge() {
        let project = project("start-ok");
        import_manuscript(&project);
        let state = state(project.clone(), String::new(), String::new());

        let mut options = std::collections::BTreeMap::new();
        options.insert("hints".to_string(), "  alice, rabbit  ".to_string());
        state.transcript_start(options).await.expect("start succeeds");

        let run_id = state.transcript.lock().await.run_id.clone();
        assert!(!run_id.is_empty());
        assert_eq!(state.transcript.lock().await.phase, "preparing");

        let hints = std::fs::read_to_string(project.join("TranscriptCompare/vocabulary_hints.txt")).unwrap();
        assert_eq!(hints, "alice, rabbit");

        // The bridge command was actually written to disk (not just called
        // in memory) - percent-encoded, protocol-versioned, matching
        // ui_bridge.py's contract.
        let commands_dir = state.config.session_dir.join("commands");
        let files: Vec<_> = std::fs::read_dir(&commands_dir).unwrap().collect();
        assert_eq!(files.len(), 1, "expected exactly one bridge command file");
        let content = std::fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap();
        assert_eq!(content.trim(), format!("1|prepare_compare|{run_id}"));

        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn compare_marker_event_defaults_missing_optional_fields() {
        let project = project("marker-defaults");
        let state = state(project.clone(), String::new(), String::new());
        {
            let mut run = state.transcript.lock().await;
            run.run_id = "run-1".to_string();
            run.phase = "inspecting".to_string();
        }
        // Only the 8 required fields - none of the optional trailing ones
        // (chapter/paragraph/scriptContext/audioContext/markerState/
        // existingMarkerName/srcpos) that real REAPER sometimes omits.
        state.handle_bridge_event(vec![
            "COMPARE_MARKER".to_string(), "run-1".to_string(), "row-1".to_string(), "MISREAD".to_string(),
            "name".to_string(), "docword".to_string(), "audioword".to_string(), "12.5".to_string(), "3".to_string(),
        ]).await;
        let run = state.transcript.lock().await;
        assert_eq!(run.rows.len(), 1);
        let row = &run.rows[0];
        assert_eq!(row["scriptContext"], "docword", "must default to docText");
        assert_eq!(row["audioContext"], "audioword", "must default to audioText");
        assert_eq!(row["markerState"], "pending");
        assert_eq!(row["existingMarkerName"], "");
        assert_eq!(row["chapter"], "");
        assert_eq!(row["paragraph"], 0);
        assert_eq!(row["srcpos"], 0.0);
        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn full_compare_lifecycle_runs_through_a_fake_backend_to_inspecting() {
        let project = project("lifecycle");
        import_manuscript(&project);
        let python_exe = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.venv/Scripts/python.exe").to_string_lossy().to_string();
        let backend = write_fake_compare_backend(&project).to_string_lossy().to_string();
        let state = state(project.clone(), python_exe, backend);

        state.transcript_start(Default::default()).await.expect("start succeeds");
        let run_id = state.transcript.lock().await.run_id.clone();

        // Stand in for REAPER's own reply to `prepare_compare` - a real
        // bridge event with the same shape narration_ui_bridge.lua sends.
        let manifest = project.join("manifest.txt").to_string_lossy().to_string();
        let diff_path = project.join("diff.txt").to_string_lossy().to_string();
        state.handle_bridge_event(vec![
            "COMPARE_PREPARED".to_string(), run_id.clone(), manifest, project.join("narration-utils/manuscript/manuscript.json").to_string_lossy().to_string(),
            "Chapter I: Down the Rabbit-Hole".to_string(), diff_path,
        ]).await;
        assert_eq!(state.transcript.lock().await.phase, "running");

        for _ in 0..100 {
            state.poll_backend().await;
            if state.transcript.lock().await.phase != "running" { break; }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let phase = state.transcript.lock().await.phase.clone();
        assert_eq!(phase, "inspecting", "snapshot: {:?}", state.transcript.lock().await.snapshot());

        // The orchestrator hands the output path to REAPER rather than
        // parsing SUMMARY/MARKER lines itself - confirm it actually sent
        // inspect_compare_results, not just transitioned state locally.
        let commands_dir = state.config.session_dir.join("commands");
        let sent_inspect = std::fs::read_dir(&commands_dir).unwrap().any(|entry| {
            std::fs::read_to_string(entry.unwrap().path()).unwrap_or_default().contains("inspect_compare_results")
        });
        assert!(sent_inspect, "expected an inspect_compare_results bridge command");

        let _ = std::fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn add_equivalence_requires_a_single_word_misread_row() {
        let project = project("equivalence");
        let state = state(project.clone(), String::new(), String::new());
        {
            let mut run = state.transcript.lock().await;
            run.rows.push(serde_json::json!({"id": "r1", "kind": "SKIPPED", "docText": "a", "audioText": "b"}));
            run.rows.push(serde_json::json!({"id": "r2", "kind": "MISREAD", "docText": "two words", "audioText": "b"}));
            run.rows.push(serde_json::json!({"id": "r3", "kind": "MISREAD", "docText": "alpha", "audioText": "beta"}));
        }
        assert!(state.transcript_add_equivalence("r1").await.is_err(), "wrong kind must be rejected");
        assert!(state.transcript_add_equivalence("r2").await.is_err(), "multi-word text must be rejected");
        let message = state.transcript_add_equivalence("r3").await.expect("valid single-word MISREAD succeeds");
        assert_eq!(message, "Added equivalence: alpha = beta");
        let contents = std::fs::read_to_string(project.join("TranscriptCompare/equivalences.csv")).unwrap();
        assert!(contents.contains("alpha, beta"));
        let _ = std::fs::remove_dir_all(project);
    }

    #[test]
    fn hints_round_trip_and_dedupe_case_insensitively() {
        let project = project("hints");
        let state_dir = std::env::temp_dir().join(format!("narration-utils-transcript-hints-session-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&state_dir);
        let (state, _) = AppState::new(ServerConfig {
            repo_root: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
            session_dir: state_dir,
            project_folder: Some(project.clone()),
            project_name: "Test".to_string(), daw: "REAPER".to_string(),
            manuscript_python: String::new(), manuscript_backend: String::new(),
            compare_python: String::new(), compare_backend: String::new(),
            app_handle: None,
        }).unwrap();

        state.transcript_save_hints(vec!["Alice".to_string(), "alice".to_string(), " Rabbit ".to_string(), "".to_string()]).expect("save succeeds");
        assert_eq!(state.transcript_hints(), vec!["Alice".to_string(), "Rabbit".to_string()]);
        let _ = std::fs::remove_dir_all(project);
    }
}

//! Story Bible (Guide) backend calls. Shells out to
//! `tools/manuscript-guide/core/manuscript_guide.py` exactly as
//! `guide_service.py` does today - same subcommands, same
//! `--progress`/`--log` file conventions, same stdout contract. Ported
//! function-for-function so the two stay easy to compare.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    config::SettingsStore,
    process_utils,
    process_utils::DetachedProcess,
    tts::{AssetManager, InstallState, PiperProvider, TtsProvider, Voice},
};

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PreviewResult {
    Ready {
        file_name: String,
    },
    AssetRequired {
        voice: Box<Voice>,
        install_state: InstallState,
    },
}

pub struct GuideService {
    project_folder: Option<PathBuf>,
    python_exe: String,
    backend: String,
    settings: SettingsStore,
    tts: AssetManager,
}

impl GuideService {
    pub fn new(
        project_folder: Option<PathBuf>,
        python_exe: String,
        backend: String,
        settings: SettingsStore,
        tts: AssetManager,
    ) -> Self {
        Self {
            project_folder,
            python_exe,
            backend,
            settings,
            tts,
        }
    }

    fn manuscript(&self) -> Option<String> {
        let project = self.project_folder.as_deref()?;
        let path = super::manuscript_canonical::manuscript_path(project);
        path.is_file().then(|| path.to_string_lossy().to_string())
    }

    fn data_dir(&self) -> Option<PathBuf> {
        self.project_folder
            .as_deref()
            .map(|project| project.join("ManuscriptGuide"))
    }

    fn guide_path(&self) -> Option<PathBuf> {
        self.data_dir().map(|dir| dir.join("manuscript_guide.json"))
    }

    fn config(&self, key: &str, fallback: &str) -> String {
        self.settings.effective("ManuscriptGuide", key, fallback).0
    }

    async fn run_backend(&self, args: &[String]) -> Result<(i32, String, String), String> {
        if !Path::new(&self.python_exe).is_file() {
            return Err(
                "Configure the Manuscript Guide Python executable before continuing.".to_string(),
            );
        }
        if !self.backend.is_empty() && !Path::new(&self.backend).is_file() {
            return Err("Configure the Manuscript Guide backend before continuing.".to_string());
        }
        let mut full_args = Vec::new();
        if !self.backend.is_empty() {
            full_args.push(self.backend.clone());
        }
        full_args.extend(args.iter().cloned());
        process_utils::run(&self.python_exe, &full_args).await
    }

    fn throw_if_failed(result: (i32, String, String), fallback: &str) -> Result<(), String> {
        let (code, _out, err) = result;
        if code != 0 {
            return Err(if err.trim().is_empty() {
                fallback.to_string()
            } else {
                err.trim().to_string()
            });
        }
        Ok(())
    }

    /// Launches a rebuild without making the caller wait for spaCy NLP.
    /// Returns the detached process handle and where its output will land -
    /// the caller (`AppState`'s guide-build poll loop) owns tracking
    /// progress/completion from there, exactly as `_poll_guide_build` does.
    pub async fn start_build(
        &self,
        progress_path: &Path,
        log_path: &Path,
    ) -> Result<(DetachedProcess, PathBuf), String> {
        let manuscript = self
            .manuscript()
            .ok_or_else(|| "Save the REAPER project and import a manuscript first.".to_string())?;
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "Save the REAPER project and import a manuscript first.".to_string())?;
        if !Path::new(&self.python_exe).is_file() {
            return Err(
                "Configure the Manuscript Guide Python executable before continuing.".to_string(),
            );
        }
        if !self.backend.is_empty() && !Path::new(&self.backend).is_file() {
            return Err("Configure the Manuscript Guide backend before continuing.".to_string());
        }
        let data_dir = self.data_dir().expect("guide_path implies data_dir");
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("Could not create Story Bible storage: {error}"))?;
        let model = self.config("spacy_model", "en_core_web_sm");
        let espeak = self.config("espeak_library", "");
        let mut args = Vec::new();
        if !self.backend.is_empty() {
            args.push(self.backend.clone());
        }
        args.extend([
            "build".to_string(),
            "--manuscript".to_string(),
            manuscript,
            "--out".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--spacy-model".to_string(),
            model,
            "--progress".to_string(),
            progress_path.to_string_lossy().to_string(),
            "--log".to_string(),
            log_path.to_string_lossy().to_string(),
        ]);
        if !espeak.is_empty() {
            args.push("--espeak-library".to_string());
            args.push(espeak);
        }
        let process = process_utils::start_detached(&self.python_exe, &args)?;
        Ok((process, guide_path))
    }

    pub fn entities(&self) -> Vec<Value> {
        let Some(path) = self.guide_path() else {
            return Vec::new();
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Vec::new();
        };
        let Ok(guide) = serde_json::from_str::<Value>(&text) else {
            return Vec::new();
        };
        guide["entities"].as_array().cloned().unwrap_or_default()
    }

    /// Case-insensitive de-dup keeping first-seen casing, matching
    /// `guide_service.py::vocabulary_candidates`'s C#-Distinct-flavored
    /// comment - a plain set would treat "alice"/"Alice" as distinct.
    pub fn vocabulary_candidates(&self) -> Result<Vec<String>, String> {
        let path = self.guide_path().ok_or_else(|| {
            "Build the Story Bible before requesting vocabulary suggestions.".to_string()
        })?;
        if !path.is_file() {
            return Err(
                "Build the Story Bible before requesting vocabulary suggestions.".to_string(),
            );
        }
        let text = std::fs::read_to_string(&path)
            .map_err(|error| format!("Could not read the Story Bible: {error}"))?;
        let guide: Value = serde_json::from_str(&text)
            .map_err(|error| format!("Could not read the Story Bible: {error}"))?;
        let mut seen: std::collections::BTreeMap<String, String> =
            std::collections::BTreeMap::new();
        for value in guide["vocabulary_candidates"]
            .as_array()
            .into_iter()
            .flatten()
        {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    seen.entry(trimmed.to_lowercase())
                        .or_insert_with(|| trimmed.to_string());
                }
            }
        }
        let mut values: Vec<String> = seen.into_values().collect();
        values.sort_by_key(|value| value.to_lowercase());
        Ok(values)
    }

    pub async fn edit(
        &self,
        entity_id: &str,
        values: &std::collections::BTreeMap<String, String>,
    ) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        for (field, value) in values {
            let mut args = vec![
                "edit".to_string(),
                "--guide".to_string(),
                guide_path.to_string_lossy().to_string(),
                "--entity-id".to_string(),
                entity_id.to_string(),
                "--field".to_string(),
                field.clone(),
                "--value".to_string(),
                value.clone(),
            ];
            if field == "aliases" {
                if let Some(manuscript) = self.manuscript() {
                    args.push("--manuscript".to_string());
                    args.push(manuscript);
                }
                let espeak = self.config("espeak_library", "");
                if !espeak.is_empty() {
                    args.push("--espeak-library".to_string());
                    args.push(espeak);
                }
            }
            Self::throw_if_failed(
                self.run_backend(&args).await?,
                "Could not save the guide entry.",
            )?;
        }
        Ok(())
    }

    pub async fn set_locked(&self, entity_id: &str, locked: bool) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let args = vec![
            "edit".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
            "--field".to_string(),
            "locked".to_string(),
            "--value".to_string(),
            locked.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not update the lock state.",
        )
    }

    pub async fn rescan(&self, entity_id: &str) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let manuscript = self
            .manuscript()
            .ok_or_else(|| "Save the REAPER project and select a manuscript first.".to_string())?;
        let args = vec![
            "rescan".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--manuscript".to_string(),
            manuscript,
            "--entity-id".to_string(),
            entity_id.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not rescan the manuscript.",
        )
    }

    pub async fn create(
        &self,
        name: &str,
        category: &str,
        aliases: &[String],
    ) -> Result<String, String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available. Build it first.".to_string())?;
        let manuscript = self
            .manuscript()
            .ok_or_else(|| "Save the REAPER project and select a manuscript first.".to_string())?;
        let espeak = self.config("espeak_library", "");
        let mut args = vec![
            "create".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--manuscript".to_string(),
            manuscript,
            "--name".to_string(),
            name.to_string(),
            "--category".to_string(),
            category.to_string(),
            "--aliases".to_string(),
            aliases.join(";"),
        ];
        if !espeak.is_empty() {
            args.push("--espeak-library".to_string());
            args.push(espeak);
        }
        let result = self.run_backend(&args).await?;
        Self::throw_if_failed(result.clone(), "Could not create the entity.")?;
        let parts: Vec<&str> = result.1.trim().split('|').collect();
        if parts.len() < 2 || parts[0] != "CREATED" {
            return Err("Could not create the entity.".to_string());
        }
        Ok(parts[1].to_string())
    }

    pub async fn merge(&self, source_id: &str, target_id: &str) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let args = vec![
            "merge".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--source-id".to_string(),
            source_id.to_string(),
            "--target-id".to_string(),
            target_id.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not merge the entities.",
        )
    }

    pub async fn delete(&self, entity_id: &str) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let args = vec![
            "delete".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not delete the entity.",
        )
    }

    pub async fn relate(&self, entity_id: &str, other_id: &str, label: &str) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let args = vec![
            "relate".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
            "--other-id".to_string(),
            other_id.to_string(),
            "--label".to_string(),
            label.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not add the relationship.",
        )
    }

    pub async fn unrelate(
        &self,
        entity_id: &str,
        other_id: &str,
        label: &str,
    ) -> Result<(), String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let args = vec![
            "unrelate".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
            "--other-id".to_string(),
            other_id.to_string(),
            "--label".to_string(),
            label.to_string(),
        ];
        Self::throw_if_failed(
            self.run_backend(&args).await?,
            "Could not remove the relationship.",
        )
    }

    pub async fn export_hotwords(&self) -> Result<String, String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let data_dir = self.data_dir().expect("guide_path implies data_dir");
        let out_path = data_dir.join("whisper_hotwords.txt");
        let args = vec![
            "export-hotwords".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--out".to_string(),
            out_path.to_string_lossy().to_string(),
        ];
        let result = self.run_backend(&args).await?;
        if result.0 != 0 {
            return Err(if result.2.trim().is_empty() {
                "Could not export hotwords.".to_string()
            } else {
                result.2.trim().to_string()
            });
        }
        Ok(out_path.to_string_lossy().to_string())
    }

    fn selected_voice(&self) -> Result<&Voice, String> {
        let provider = self.settings.effective("Piper", "tts_provider", "piper").0;
        if provider != "piper" {
            return Err("The selected TTS provider is not available in this release.".to_string());
        }
        let voice_id = self
            .settings
            .effective("Piper", "tts_voice_id", "en_US-ljspeech-high")
            .0;
        self.tts.voice(&voice_id).ok_or_else(|| {
            "The selected TTS voice is not in this release's approved catalog.".to_string()
        })
    }

    fn spoken_text(&self, entity_id: &str, alias_index: Option<i64>) -> Result<String, String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let text = std::fs::read_to_string(guide_path)
            .map_err(|error| format!("Could not read the Story Bible: {error}"))?;
        let guide: Value = serde_json::from_str(&text)
            .map_err(|error| format!("Could not read the Story Bible: {error}"))?;
        let entity = guide["entities"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entity| entity["id"].as_str() == Some(entity_id))
            .ok_or_else(|| "The requested Story Bible entry no longer exists.".to_string())?;
        match alias_index {
            None => entity["canonical_name"]
                .as_str()
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "The requested Story Bible name is empty.".to_string()),
            Some(index) if index >= 0 => entity["aliases"]
                .as_array()
                .and_then(|aliases| aliases.get(index as usize))
                .and_then(|alias| alias["text"].as_str())
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "The requested Story Bible alias no longer exists.".to_string()),
            Some(_) => Err("The requested Story Bible alias is invalid.".to_string()),
        }
    }

    fn preview_name(spoken: &str, voice: &Voice) -> String {
        let mut digest = Sha256::new();
        digest.update(b"narration-utils-tts-preview-v1\0");
        digest.update(voice.provider.as_bytes());
        digest.update(b"\0");
        digest.update(voice.version.as_bytes());
        digest.update(b"\0");
        digest.update(spoken.as_bytes());
        format!("{:x}.wav", digest.finalize())
    }

    pub async fn preview(
        &self,
        entity_id: &str,
        alias_index: Option<i64>,
    ) -> Result<PreviewResult, String> {
        let voice = self.selected_voice()?;
        let install_state = self.tts.state(voice);
        if install_state != InstallState::Installed {
            return Ok(PreviewResult::AssetRequired {
                voice: Box::new(voice.clone()),
                install_state,
            });
        }
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let data_dir = self.data_dir().expect("guide_path implies data_dir");
        let spoken = self.spoken_text(entity_id, alias_index)?;
        let file_name = Self::preview_name(&spoken, voice);
        let audio_dir = data_dir.join("audio").join("tts");
        let output = audio_dir.join(&file_name);
        if output.is_file() {
            return Ok(PreviewResult::Ready { file_name });
        }
        let paths = self.tts.paths(voice)?;
        if !paths.config.is_file() {
            return Err("The verified Piper voice configuration is unavailable. Repair the voice and try again.".to_string());
        }
        let runtime_dir = Path::new(&self.python_exe)
            .parent()
            .ok_or_else(|| "The packaged Piper runtime is unavailable. Repair Narration Utils before using TTS.".to_string())?;
        let provider = PiperProvider;
        if provider.id() != voice.provider {
            return Err("The selected TTS provider is not available in this release.".to_string());
        }
        let piper = provider.runtime(runtime_dir)?;
        let mut args = vec![
            "render-audio".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
            "--audio-dir".to_string(),
            audio_dir.to_string_lossy().to_string(),
            "--piper-exe".to_string(),
            piper.to_string_lossy().to_string(),
            "--piper-model".to_string(),
            paths.model.to_string_lossy().to_string(),
            "--output-name".to_string(),
            file_name.clone(),
        ];
        if let Some(index) = alias_index {
            args.push("--alias-index".to_string());
            args.push(index.to_string());
        }
        let result = self.run_backend(&args).await?;
        if result.0 != 0 || !output.is_file() {
            return Err(if result.2.trim().is_empty() {
                "Could not render the preview.".to_string()
            } else {
                result.2.trim().to_string()
            });
        }
        Ok(PreviewResult::Ready { file_name })
    }

    pub fn audio_file(&self, file_name: &str) -> Result<PathBuf, String> {
        let valid_name = file_name.len() == 68
            && file_name.ends_with(".wav")
            && file_name[..64].bytes().all(|byte| byte.is_ascii_hexdigit());
        if !valid_name {
            return Err("Invalid preview audio request.".to_string());
        }
        let root = self
            .data_dir()
            .ok_or_else(|| "No project guide is available.".to_string())?
            .join("audio")
            .join("tts");
        let root = root
            .canonicalize()
            .map_err(|_| "Preview audio is unavailable.".to_string())?;
        let candidate = root.join(file_name);
        let candidate = candidate
            .canonicalize()
            .map_err(|_| "Preview audio is unavailable.".to_string())?;
        if !candidate.starts_with(&root) || !candidate.is_file() {
            return Err("Preview audio is unavailable.".to_string());
        }
        Ok(candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::GuideService;
    use crate::server::{config::SettingsStore, test_support, tts::AssetManager};
    use std::{fs, path::PathBuf};

    fn project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "narration-utils-guide-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn service(project: PathBuf, python_exe: String, backend: String) -> GuideService {
        let settings = SettingsStore::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
            Some(project.clone()),
        );
        GuideService::new(
            Some(project),
            python_exe,
            backend,
            settings,
            AssetManager::new(),
        )
    }

    /// A minimal stand-in for manuscript_guide.py: only understands enough
    /// of the `create` subcommand's contract (stdout `CREATED|<id>|<count>`)
    /// to test argument-building/result-parsing without spaCy.
    fn write_fake_backend(dir: &std::path::Path) -> PathBuf {
        let script = dir.join("fake_manuscript_guide.py");
        fs::write(
            &script,
            r#"
import sys
if sys.argv[1] == "create":
    print("CREATED|e-42|3")
    sys.exit(0)
sys.exit(1)
"#,
        )
        .unwrap();
        script
    }

    #[test]
    fn entities_is_empty_without_a_guide_file() {
        let project = project("entities-empty");
        let service = service(project.clone(), String::new(), String::new());
        assert!(service.entities().is_empty());
        let _ = fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn preview_requires_an_approved_voice_before_touching_the_backend() {
        let project = project("preview-no-piper");
        // Deliberately invalid paths: a missing catalog voice must be surfaced
        // before a render can reach any backend/runtime path.
        let service = service(
            project.clone(),
            "does-not-exist.exe".to_string(),
            "does-not-exist.py".to_string(),
        );
        let preview = service
            .preview("e-1", None)
            .await
            .expect("request is gated");
        assert!(matches!(
            preview,
            super::PreviewResult::AssetRequired { .. }
        ));
        let _ = fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn vocabulary_candidates_dedupes_case_insensitively_keeping_first_seen_casing() {
        let project = project("vocab");
        let guide_dir = project.join("ManuscriptGuide");
        fs::create_dir_all(&guide_dir).unwrap();
        fs::write(
            guide_dir.join("manuscript_guide.json"),
            serde_json::json!({"vocabulary_candidates": ["Alice", "alice", "Bob", "  ", ""]})
                .to_string(),
        )
        .unwrap();
        let service = service(project.clone(), String::new(), String::new());
        assert_eq!(
            service.vocabulary_candidates().unwrap(),
            vec!["Alice".to_string(), "Bob".to_string()]
        );
        let _ = fs::remove_dir_all(project);
    }

    #[tokio::test]
    async fn create_builds_the_expected_args_and_parses_the_pipe_delimited_result() {
        let project = project("create");
        // create() also requires an existing manuscript and guide file to
        // resolve their paths - a guide file's presence is what matters,
        // not its content, since the fake backend doesn't read it.
        let guide_dir = project.join("ManuscriptGuide");
        fs::create_dir_all(&guide_dir).unwrap();
        fs::write(guide_dir.join("manuscript_guide.json"), "{}").unwrap();
        let manuscript_dir = project.join("narration-utils/manuscript");
        fs::create_dir_all(&manuscript_dir).unwrap();
        fs::write(manuscript_dir.join("manuscript.json"), "{}").unwrap();

        let python_exe = test_support::python_executable();
        let backend = write_fake_backend(&project);
        let service = service(
            project.clone(),
            python_exe,
            backend.to_string_lossy().to_string(),
        );

        let id = service
            .create("Alice", "Character", &["Alicia".to_string()])
            .await
            .expect("create succeeds");
        assert_eq!(id, "e-42");
        let _ = fs::remove_dir_all(project);
    }
}

//! Story Bible (Guide) backend calls. Shells out to
//! `tools/manuscript-guide/core/manuscript_guide.py` exactly as
//! `guide_service.py` does today - same subcommands, same
//! `--progress`/`--log` file conventions, same stdout contract. Ported
//! function-for-function so the two stay easy to compare.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{config::SettingsStore, process_utils, process_utils::DetachedProcess};

pub struct GuideService {
    project_folder: Option<PathBuf>,
    python_exe: String,
    backend: String,
    settings: SettingsStore,
}

impl GuideService {
    pub fn new(
        project_folder: Option<PathBuf>,
        python_exe: String,
        backend: String,
        settings: SettingsStore,
    ) -> Self {
        Self {
            project_folder,
            python_exe,
            backend,
            settings,
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

    pub async fn preview(
        &self,
        entity_id: &str,
        alias_index: Option<i64>,
    ) -> Result<String, String> {
        let guide_path = self
            .guide_path()
            .ok_or_else(|| "No project guide is available.".to_string())?;
        let data_dir = self.data_dir().expect("guide_path implies data_dir");
        // Deliberately a raw config read, not a schema field - piper_exe
        // isn't exposed in the Settings UI (only piper_model is), matching
        // guide_service.py's own direct `cfg.get(...)` call here.
        let piper = self.config("piper_exe", "");
        let voice = self.config("piper_model", "");
        if piper.is_empty() || voice.is_empty() {
            return Err("Set Piper executable and voice model in Settings.".to_string());
        }
        let audio_dir = data_dir.join("audio");
        let mut args = vec![
            "render-audio".to_string(),
            "--guide".to_string(),
            guide_path.to_string_lossy().to_string(),
            "--entity-id".to_string(),
            entity_id.to_string(),
            "--audio-dir".to_string(),
            audio_dir.to_string_lossy().to_string(),
            "--piper-exe".to_string(),
            piper,
            "--piper-model".to_string(),
            voice,
        ];
        if let Some(index) = alias_index {
            args.push("--alias-index".to_string());
            args.push(index.to_string());
        }
        let result = self.run_backend(&args).await?;
        let filename = match alias_index {
            Some(index) => format!("{entity_id}__alias{index}.wav"),
            None => format!("{entity_id}.wav"),
        };
        let output = audio_dir.join(filename);
        if result.0 != 0 || !output.is_file() {
            return Err(if result.2.trim().is_empty() {
                "Could not render the preview.".to_string()
            } else {
                result.2.trim().to_string()
            });
        }
        Ok(output.to_string_lossy().to_string())
    }
}

/// Turns a rendered preview's file path into a URL. Mirrors
/// `guide_service.py::preview_url`.
pub async fn preview_url(
    guide: &GuideService,
    audio_base_url: Option<&str>,
    entity_id: &str,
    alias_index: Option<i64>,
) -> Result<String, String> {
    let path = guide.preview(entity_id, alias_index).await?;
    match audio_base_url {
        None | Some("") => Ok(format!("file:///{}", path.replace('\\', "/"))),
        Some(base) => {
            let name = Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            Ok(format!("{base}{}", super::bridge::percent_encode(&name)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{preview_url, GuideService};
    use crate::server::{config::SettingsStore, test_support};
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
        GuideService::new(Some(project), python_exe, backend, settings)
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
    async fn preview_reports_missing_piper_configuration_without_touching_the_backend() {
        let project = project("preview-no-piper");
        // Deliberately invalid paths: if preview() ever reached
        // run_backend() before checking Piper config, this would fail with
        // a different error ("Configure the Manuscript Guide..."), not the
        // Piper one - this is the ordering guarantee test_guide_entities.py
        // asserts in Python.
        let service = service(
            project.clone(),
            "does-not-exist.exe".to_string(),
            "does-not-exist.py".to_string(),
        );
        let error = preview_url(&service, None, "e-1", None)
            .await
            .expect_err("must fail");
        assert!(error.contains("Piper"), "unexpected error: {error}");
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

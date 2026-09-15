//! The three settings tiers shared by the Python host and the Rust cutover:
//! repository defaults, user-global settings, and project overrides.

use std::{
    collections::BTreeMap,
    env, fs, io,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value};

pub type Settings = BTreeMap<String, String>;

#[derive(Clone)]
pub struct SettingsStore {
    repo_root: PathBuf,
    project_folder: Option<PathBuf>,
}

impl SettingsStore {
    pub fn new(repo_root: impl Into<PathBuf>, project_folder: Option<PathBuf>) -> Self {
        Self {
            repo_root: repo_root.into(),
            project_folder,
        }
    }

    pub fn repo_defaults(&self, tool: &str) -> Settings {
        read_tool(&self.repo_root.join("shared/config/defaults.json"), tool)
    }

    pub fn global(&self, tool: &str) -> Settings {
        read_tool(&global_settings_path(), tool)
    }

    pub fn project(&self, tool: &str) -> Settings {
        self.project_path()
            .map_or_else(Settings::new, |path| read_tool(&path, tool))
    }

    pub fn effective(&self, tool: &str, key: &str, fallback: &str) -> (String, &'static str) {
        let project = self.project(tool);
        if let Some(value) = project.get(key) {
            return (value.clone(), "project");
        }
        let global = self.global(tool);
        if let Some(value) = global.get(key) {
            return (value.clone(), "global");
        }
        let defaults = self.repo_defaults(tool);
        if let Some(value) = defaults.get(key) {
            return (value.clone(), "repo_default");
        }
        (fallback.to_string(), "hardcoded")
    }

    pub fn save_scope(
        &self,
        tool: &str,
        scope: &str,
        values: &BTreeMap<String, Option<String>>,
    ) -> Result<(), String> {
        let path = match scope {
            "global" => global_settings_path(),
            "project" => self.project_path().ok_or_else(|| {
                "Save the REAPER project before changing project settings.".to_string()
            })?,
            _ => return Err("Unsupported settings scope".to_string()),
        };
        let mut document = read_document(&path);
        let section = document
            .entry(tool.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let object = section
            .as_object_mut()
            .ok_or_else(|| "Settings file has an invalid tool section.".to_string())?;
        for (key, value) in values {
            match (scope, value) {
                ("project", None) => {
                    object.remove(key);
                }
                (_, Some(value)) => {
                    object.insert(key.clone(), Value::String(value.clone()));
                }
                (_, None) => {
                    object.insert(key.clone(), Value::Null);
                }
            }
        }
        write_document(&path, &document)
            .map_err(|error| format!("Could not save settings: {error}"))
    }

    fn project_path(&self) -> Option<PathBuf> {
        self.project_folder
            .as_ref()
            .map(|folder| folder.join("narration-utils/settings.json"))
    }
}

fn global_settings_path() -> PathBuf {
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("AppData/Roaming"))
        })
        .unwrap_or_else(|| PathBuf::from("AppData/Roaming"));
    base.join("narration-utils/global-settings.json")
}

fn read_tool(path: &Path, tool: &str) -> Settings {
    read_document(path)
        .get(tool)
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn read_document(path: &Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_document(path: &Path, document: &Map<String, Value>) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(document).expect("JSON map serializes");
    fs::write(&temporary, body)?;
    fs::rename(temporary, path)
}

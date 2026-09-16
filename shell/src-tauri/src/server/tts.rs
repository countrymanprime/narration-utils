//! Catalog-owned local text-to-speech assets and providers.
//!
//! Voice weights are deliberately kept outside the application bundle and the
//! project folder.  A catalog entry is the only source of a download URL and
//! checksum; callers never supply a path or arbitrary URL.

use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::process::Command;

const CATALOG_JSON: &str = include_str!("../../../../shared/config/tts-assets.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub catalog_version: u32,
    pub voices: Vec<Voice>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub id: String,
    pub provider: String,
    pub display_name: String,
    pub locale: String,
    pub version: String,
    pub publisher: String,
    pub license: String,
    pub license_url: String,
    pub model_card_url: String,
    pub provenance_url: String,
    pub attribution: String,
    #[serde(skip_serializing)]
    pub files: Vec<AssetFile>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssetFile {
    pub name: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallState {
    Installed,
    NotInstalled,
    VerificationFailed,
}

#[derive(Clone, Debug)]
pub struct VoicePaths {
    pub model: PathBuf,
    pub config: PathBuf,
}

/// Kept deliberately small: adding a provider means implementing runtime
/// discovery and render compatibility without changing catalog/cache callers.
pub trait TtsProvider {
    fn id(&self) -> &'static str;
    fn runtime(&self, tool_runtime: &Path) -> Result<PathBuf, String>;
}

pub struct PiperProvider;

impl TtsProvider for PiperProvider {
    fn id(&self) -> &'static str {
        "piper"
    }

    fn runtime(&self, tool_runtime: &Path) -> Result<PathBuf, String> {
        let executable = if cfg!(windows) { "piper.exe" } else { "piper" };
        let candidates = [
            tool_runtime.join(executable),
            tool_runtime.join("piper").join(executable),
        ];
        candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| {
                "The packaged Piper runtime is unavailable. Repair Narration Utils before using TTS."
                    .to_string()
            })
    }
}

#[derive(Clone)]
pub struct AssetManager {
    catalog: &'static Catalog,
    cache_root: PathBuf,
}

impl AssetManager {
    pub fn new() -> Self {
        Self::with_cache_root(asset_cache_root())
    }

    pub fn with_cache_root(cache_root: PathBuf) -> Self {
        Self {
            catalog: catalog(),
            cache_root,
        }
    }

    pub fn catalog_version(&self) -> u32 {
        self.catalog.catalog_version
    }

    pub fn voices(&self) -> impl Iterator<Item = &Voice> {
        self.catalog.voices.iter()
    }

    pub fn voice(&self, id: &str) -> Option<&Voice> {
        self.catalog.voices.iter().find(|voice| voice.id == id)
    }

    pub fn state(&self, voice: &Voice) -> InstallState {
        let root = self.voice_root(voice);
        if !root.exists() {
            return InstallState::NotInstalled;
        }
        if voice
            .files
            .iter()
            .all(|file| verify_file(&root.join(&file.name), file).is_ok())
        {
            InstallState::Installed
        } else {
            InstallState::VerificationFailed
        }
    }

    pub fn paths(&self, voice: &Voice) -> Result<VoicePaths, String> {
        if self.state(voice) != InstallState::Installed {
            return Err("The selected voice is not installed or did not verify.".to_string());
        }
        let root = self.voice_root(voice);
        let model = voice
            .files
            .iter()
            .find(|file| file.name.ends_with(".onnx"))
            .ok_or_else(|| "The catalog voice has no Piper model.".to_string())?;
        let config = voice
            .files
            .iter()
            .find(|file| file.name.ends_with(".onnx.json"))
            .ok_or_else(|| "The catalog voice has no Piper configuration.".to_string())?;
        Ok(VoicePaths {
            model: root.join(&model.name),
            config: root.join(&config.name),
        })
    }

    pub async fn install(&self, voice: &Voice, cancelled: Arc<AtomicBool>) -> Result<(), String> {
        if self.state(voice) == InstallState::Installed {
            return Ok(());
        }
        let target = self.voice_root(voice);
        let staging = target.with_file_name(format!(".installing-{}", uuid::Uuid::new_v4()));
        let outcome = async {
            fs::create_dir_all(&staging)
                .map_err(|error| format!("Could not create the TTS asset cache: {error}"))?;
            for file in &voice.files {
                download_file(file, &staging.join(&file.name), &cancelled).await?;
                verify_file(&staging.join(&file.name), file)?;
            }
            if cancelled.load(Ordering::SeqCst) {
                return Err("Voice download cancelled.".to_string());
            }
            let manifest = serde_json::json!({
                "catalogVersion": self.catalog_version(),
                "voiceId": voice.id,
                "voiceVersion": voice.version,
                "provider": voice.provider,
            });
            fs::write(
                staging.join("manifest.json"),
                serde_json::to_vec_pretty(&manifest).expect("TTS manifest serializes"),
            )
            .map_err(|error| format!("Could not write the TTS asset manifest: {error}"))?;
            if target.exists() {
                fs::remove_dir_all(&target)
                    .map_err(|error| format!("Could not replace the failed TTS asset: {error}"))?;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create the TTS asset cache: {error}"))?;
            }
            fs::rename(&staging, &target)
                .map_err(|error| format!("Could not activate the verified TTS voice: {error}"))?;
            Ok(())
        }
        .await;
        if outcome.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        outcome
    }

    pub fn remove(&self, voice: &Voice) -> Result<(), String> {
        let root = self.voice_root(voice);
        if root.exists() {
            fs::remove_dir_all(root)
                .map_err(|error| format!("Could not remove the TTS voice: {error}"))?;
        }
        Ok(())
    }

    fn voice_root(&self, voice: &Voice) -> PathBuf {
        self.cache_root
            .join(&voice.provider)
            .join(&voice.id)
            .join(&voice.version)
    }
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(CATALOG_JSON).expect("TTS asset catalog is valid JSON")
    })
}

fn asset_cache_root() -> PathBuf {
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| env::var_os("HOME").map(|value| PathBuf::from(value).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("AppData/Roaming"));
    base.join("narration-utils").join("assets").join("tts")
}

async fn download_file(
    file: &AssetFile,
    destination: &Path,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("Voice download cancelled.".to_string());
    }
    let status = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" })
        .args([
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--output",
        ])
        .arg(destination)
        .arg(&file.url)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("Could not start the approved voice download: {error}"))?;
    if cancelled.load(Ordering::SeqCst) {
        return Err("Voice download cancelled.".to_string());
    }
    if !status.status.success() {
        return Err(format!(
            "Could not download the approved voice asset: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }
    Ok(())
}

fn verify_file(path: &Path, expected: &AssetFile) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|_| format!("Missing downloaded asset {}.", expected.name))?;
    if metadata.len() != expected.size {
        return Err(format!(
            "Downloaded asset {} has an unexpected size.",
            expected.name
        ));
    }
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not read downloaded asset: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not verify downloaded asset: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected.sha256.to_lowercase() {
        return Err(format!(
            "Downloaded asset {} failed SHA-256 verification.",
            expected.name
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager(root: &Path) -> AssetManager {
        AssetManager::with_cache_root(root.to_path_buf())
    }

    #[test]
    fn catalog_has_only_reviewed_piper_voice_records() {
        let manager = AssetManager::new();
        let voice = manager.voice("en_US-ljspeech-high").expect("catalog voice");
        assert_eq!(voice.provider, "piper");
        assert!(voice
            .files
            .iter()
            .all(|file| file.url.contains("/resolve/v1.0.0/")));
        assert!(!manager.voices().any(|voice| voice.id.contains("lessac")));
    }

    #[test]
    fn corrupt_cached_asset_is_not_usable() {
        let root =
            env::temp_dir().join(format!("narration-utils-tts-test-{}", uuid::Uuid::new_v4()));
        let manager = manager(&root);
        let voice = manager.voice("en_US-ljspeech-high").unwrap();
        let destination = manager.voice_root(voice);
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join(&voice.files[0].name), b"not a model").unwrap();
        assert_eq!(manager.state(voice), InstallState::VerificationFailed);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn piper_runtime_is_never_a_user_setting() {
        let root = env::temp_dir().join(format!(
            "narration-utils-tts-runtime-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        assert!(PiperProvider.runtime(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }
}

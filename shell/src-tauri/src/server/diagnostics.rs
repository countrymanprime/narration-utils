use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::{Local, SecondsFormat};
use serde_json::{json, Map, Value};

pub struct SessionDiagnostics {
    path: PathBuf,
    identifier: String,
    lock: Mutex<()>,
}

impl SessionDiagnostics {
    pub fn new(session_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(session_dir)
            .map_err(|error| format!("Could not create session directory: {error}"))?;
        Ok(Self {
            path: session_dir.join("host.log"),
            identifier: session_dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            lock: Mutex::new(()),
        })
    }

    pub fn identifier(&self) -> &str {
        &self.identifier
    }

    pub fn event(&self, name: &str, details: Map<String, Value>) {
        let mut record = details;
        record.insert(
            "time".to_string(),
            Value::String(Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)),
        );
        record.insert("event".to_string(), Value::String(name.to_string()));
        record.insert(
            "session".to_string(),
            Value::String(self.identifier.clone()),
        );
        if let Ok(_guard) = self.lock.lock() {
            if let Ok(mut output) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
            {
                let _ = writeln!(output, "{}", Value::Object(record));
            }
        }
    }

    pub fn client_event(&self, kind: &str, message: &str) {
        self.event(
            &format!("client_{}", kind.chars().take(48).collect::<String>()),
            Map::from_iter([(
                String::from("message"),
                json!(message.chars().take(4000).collect::<String>()),
            )]),
        );
    }
}

//! Versioned file IPC with the REAPER Lua adapter.
//!
//! The encoding mirrors `urllib.parse.quote(value, safe="")`: RFC 3986's
//! unreserved bytes stay literal; every other UTF-8 byte is percent encoded.

use std::{fs, path::PathBuf};

use percent_encoding::percent_decode_str;

pub const PROTOCOL_VERSION: u8 = 1;

pub fn encode_fields(fields: &[&str]) -> String {
    fields.iter().map(|field| percent_encode(field)).collect::<Vec<_>>().join("|")
}

pub fn decode_fields(line: &str) -> Vec<String> {
    line.trim_end_matches(['\r', '\n']).split('|').map(|field| percent_decode_str(field).decode_utf8_lossy().into_owned()).collect()
}

/// Mirrors `urllib.parse.quote(value, safe="")` - also reused by
/// `guide_service.rs::preview_url`, which needs the identical encoding for
/// a filename embedded in an audio URL (`GuideService.cs`'s original used
/// the same `Uri.EscapeDataString`-equivalent call for both).
pub fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') { encoded.push(byte as char); }
        else { encoded.push_str(&format!("%{byte:02X}")); }
    }
    encoded
}

pub struct BridgeClient { session_dir: PathBuf, counter: u64, event_offset: u64 }

impl BridgeClient {
    pub fn new(session_dir: impl Into<PathBuf>) -> Result<Self, String> {
        let session_dir = session_dir.into();
        fs::create_dir_all(session_dir.join("commands")).map_err(|error| format!("Could not create bridge command directory: {error}"))?;
        Ok(Self { session_dir, counter: 0, event_offset: 0 })
    }
    pub fn send(&mut self, action: &str, fields: &[&str]) -> Result<PathBuf, String> {
        let target = self.session_dir.join("commands").join(format!("{:08}.cmd", self.counter));
        self.counter += 1;
        let temporary = target.with_extension("tmp");
        let mut values = vec![PROTOCOL_VERSION.to_string(), action.to_string()]; values.extend(fields.iter().map(|value| (*value).to_string()));
        let refs = values.iter().map(String::as_str).collect::<Vec<_>>();
        fs::write(&temporary, format!("{}\n", encode_fields(&refs))).map_err(|error| format!("Could not write bridge command: {error}"))?;
        fs::rename(&temporary, &target).map_err(|error| format!("Could not activate bridge command: {error}"))?;
        Ok(target)
    }
    pub fn read_events(&mut self) -> Vec<String> {
        let path = self.session_dir.join("events.log");
        let Ok(bytes) = fs::read(&path) else { return vec![]; };
        let offset = usize::try_from(self.event_offset).unwrap_or(usize::MAX).min(bytes.len());
        self.event_offset = bytes.len() as u64;
        String::from_utf8_lossy(&bytes[offset..]).lines().filter(|line| !line.is_empty()).map(str::to_string).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_fields, encode_fields};
    #[test]
    fn matches_python_quote_safe_empty_for_unicode_and_protocol_delimiters() {
        assert_eq!(encode_fields(&["hello world", "A|B", "é", "~_.-"]), "hello%20world|A%7CB|%C3%A9|~_.-");
        assert_eq!(decode_fields("hello%20world|A%7CB|%C3%A9|~_.-\n"), vec!["hello world", "A|B", "é", "~_.-"]);
    }
}

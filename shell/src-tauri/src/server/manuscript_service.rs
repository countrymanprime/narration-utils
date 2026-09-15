//! Reader and review sidecar data stored beside a canonical manuscript.

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::manuscript_canonical;

/// (mtime_ns, size) staleness stamp for a cached file - re-read only when it
/// changes. Mirrors manuscript_service.py's class-level `_cache`/
/// `_notes_cache`/`_entity_index_cache` dicts (added for the manuscript
/// page's performance, not merely style) - a process-wide cache, not a
/// per-`ManuscriptService`-instance one, since a fresh instance is
/// constructed per request (see `AppState::manuscript`).
type Stamp = (i128, u64);
fn stamp(path: &std::path::Path) -> Option<Stamp> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let mtime_ns = modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as i128).unwrap_or(0);
    Some((mtime_ns, metadata.len()))
}
static MANUSCRIPT_CACHE: LazyLock<Mutex<HashMap<PathBuf, (Stamp, Value)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static NOTES_CACHE: LazyLock<Mutex<HashMap<PathBuf, (Stamp, Value)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ENTITY_INDEX_CACHE: LazyLock<Mutex<HashMap<PathBuf, (Stamp, HashMap<(String, String), Vec<String>>)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub struct ManuscriptService { project: Option<PathBuf> }

impl ManuscriptService {
    pub fn new(project: Option<PathBuf>) -> Self { Self { project } }

    pub fn chapters(&self) -> Result<Value, String> {
        let data = self.load()?; let notes = self.load_notes(); let status = notes.get("chapterStatus").and_then(Value::as_object).cloned().unwrap_or_default();
        let paragraphs = data["paragraphs"].as_array().cloned().unwrap_or_default();
        Ok(Value::Array(data["chapters"].as_array().cloned().unwrap_or_default().iter().map(|chapter| chapter_payload(chapter, &status, Some(&paragraphs))).collect()))
    }
    pub fn paragraphs(&self, chapter_id: &str) -> Result<Value, String> {
        let data = self.load()?; let entities = self.entity_occurrence_index();
        Ok(Value::Array(data["paragraphs"].as_array().cloned().unwrap_or_default().iter().filter(|paragraph| paragraph["chapterId"].as_str() == Some(chapter_id)).map(|paragraph| paragraph_payload(paragraph, &entities)).collect()))
    }
    pub fn reader(&self) -> Result<Value, String> {
        let data = self.load()?; let notes = self.load_notes();
        let status = notes.get("chapterStatus").and_then(Value::as_object).cloned().unwrap_or_default();
        let entities = self.entity_occurrence_index();
        let chapters = Value::Array(data["chapters"].as_array().cloned().unwrap_or_default().iter().map(|chapter| chapter_payload(chapter, &status, None)).collect());
        let paragraphs = Value::Array(data["paragraphs"].as_array().cloned().unwrap_or_default().iter().map(|paragraph| paragraph_payload(paragraph, &entities)).collect());
        Ok(json!({"chapters": chapters, "paragraphs": paragraphs, "notes": notes["notes"]}))
    }
    pub fn search(&self, query: &str) -> Result<Value, String> {
        if query.trim().is_empty() { return Ok(json!([])); }
        let needle = query.to_lowercase(); let data = self.load()?;
        Ok(Value::Array(data["paragraphs"].as_array().cloned().unwrap_or_default().iter().filter(|paragraph| paragraph["text"].as_str().unwrap_or_default().to_lowercase().contains(&needle)).map(|paragraph| json!({"chapter": paragraph["chapterTitle"], "chapterId": paragraph["chapterId"], "paragraph": paragraph["index"], "paragraphId": paragraph["id"], "excerpt": paragraph["text"]})).collect()))
    }
    pub fn set_chapter_status(&self, chapter_id: &str, status: &str) -> Result<Value, String> {
        if !matches!(status, "not_started" | "recording" | "editing" | "proofing" | "finalized") { return Err(format!("Unknown chapter status: {status}")); }
        let data = self.load()?; let chapter = data["chapters"].as_array().and_then(|chapters| chapters.iter().find(|chapter| chapter["id"].as_str() == Some(chapter_id))).ok_or_else(|| "Unknown manuscript chapter.".to_string())?;
        let mut notes = self.load_notes(); let object = notes.as_object_mut().expect("notes object"); object.entry("chapterStatus").or_insert_with(|| json!({})).as_object_mut().expect("status object").insert(chapter_id.to_string(), json!(status));
        let chapter_status = notes["chapterStatus"].as_object().cloned().unwrap_or_default(); self.save_notes(&notes)?;
        Ok(chapter_payload(chapter, &chapter_status, None))
    }
    pub fn note_list(&self, chapter_id: Option<&str>) -> Value { let notes = self.load_notes(); Value::Array(notes["notes"].as_array().cloned().unwrap_or_default().into_iter().filter(|note| chapter_id.is_none_or(|id| note["chapterId"].as_str() == Some(id))).collect()) }
    pub fn note_create(&self, chapter_id: &str, paragraph_id: &str, text: &str, anchor_start: Option<i64>, anchor_end: Option<i64>, anchor_text: Option<String>) -> Result<Value, String> {
        if anchor_start.is_some_and(|value| value < 0) || anchor_end.is_some_and(|end| anchor_start.is_none_or(|start| end < start)) { return Err("Invalid note anchor.".to_string()); }
        let data = self.load()?; let paragraph = data["paragraphs"].as_array().and_then(|items| items.iter().find(|item| item["id"].as_str() == Some(paragraph_id) && item["chapterId"].as_str() == Some(chapter_id))).ok_or_else(|| "Unknown manuscript paragraph.".to_string())?;
        let note = json!({"id": Uuid::new_v4().simple().to_string(), "chapter": paragraph["chapterTitle"], "chapterId": chapter_id, "paragraph": paragraph["index"], "paragraphId": paragraph_id, "text": text, "createdAt": Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, true), "anchorStart": anchor_start, "anchorEnd": anchor_end, "anchorText": anchor_text});
        let mut notes = self.load_notes(); notes["notes"].as_array_mut().expect("notes array").push(note.clone()); self.save_notes(&notes)?; Ok(note)
    }
    pub fn note_delete(&self, note_id: &str) -> Result<(), String> { let mut notes = self.load_notes(); notes["notes"].as_array_mut().expect("notes array").retain(|note| note["id"].as_str() != Some(note_id)); self.save_notes(&notes) }

    pub fn reader_state(&self) -> Value { self.load_notes()["readerState"].clone() }
    pub fn save_reader_state(&self, active_chapter: Option<String>, active_source_line: Option<i64>, expanded_chapters: Option<Vec<String>>) -> Result<Value, String> {
        let mut notes = self.load_notes();
        let current = notes["readerState"].clone();
        // expanded_chapters: an explicitly empty list is a real value (all
        // chapters collapsed), not "unset" - only None falls back to the
        // stored value. Mirrors Python's `if expanded_chapters is not None`.
        let expanded_chapters = match expanded_chapters {
            Some(list) => json!(list),
            None => current["expandedChapters"].clone(),
        };
        let next_state = json!({
            "activeChapter": active_chapter,
            "activeSourceLine": active_source_line,
            "bookmarks": current["bookmarks"],
            "expandedChapters": expanded_chapters,
        });
        notes["readerState"] = next_state.clone();
        self.save_notes(&notes)?;
        Ok(next_state)
    }
    pub fn create_bookmark(&self, kind: &str, chapter: &str, chapter_id: Option<&str>, paragraph: Option<i64>, paragraph_id: Option<&str>, source_line: Option<i64>, note_id: Option<&str>) -> Result<Value, String> {
        if !matches!(kind, "chapter" | "line" | "note") { return Err("Unknown bookmark kind.".to_string()); }
        let mut notes = self.load_notes();
        let bookmarks = notes["readerState"]["bookmarks"].as_array().cloned().unwrap_or_default();
        if let Some(duplicate) = bookmarks.iter().find(|b| {
            b["kind"].as_str() == Some(kind)
                && b["chapterId"].as_str() == chapter_id
                && b["paragraphId"].as_str() == paragraph_id
                && b["noteId"].as_str() == note_id
        }) {
            return Ok(duplicate.clone());
        }
        let bookmark = json!({
            "id": Uuid::new_v4().simple().to_string(), "kind": kind, "chapter": chapter, "chapterId": chapter_id,
            "paragraph": paragraph, "paragraphId": paragraph_id, "sourceLine": source_line, "noteId": note_id,
            "createdAt": Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, true),
        });
        let mut updated = bookmarks; updated.push(bookmark.clone());
        notes["readerState"]["bookmarks"] = Value::Array(updated);
        self.save_notes(&notes)?;
        Ok(bookmark)
    }
    pub fn delete_bookmark(&self, bookmark_id: &str) -> Result<(), String> {
        let mut notes = self.load_notes();
        let bookmarks = notes["readerState"]["bookmarks"].as_array().cloned().unwrap_or_default().into_iter().filter(|b| b["id"].as_str() != Some(bookmark_id)).collect();
        notes["readerState"]["bookmarks"] = Value::Array(bookmarks);
        self.save_notes(&notes)
    }

    fn load(&self) -> Result<Value, String> {
        let project = self.project.as_deref().ok_or_else(|| "Save the REAPER project and import a manuscript first.".to_string())?;
        let path = manuscript_canonical::manuscript_path(project);
        if let (Some(current), Ok(mut cache)) = (stamp(&path), MANUSCRIPT_CACHE.lock()) {
            if let Some((cached_stamp, data)) = cache.get(&path) {
                if *cached_stamp == current { return Ok(data.clone()); }
            }
            let data = manuscript_canonical::load(project)?;
            cache.insert(path, (current, data.clone()));
            return Ok(data);
        }
        manuscript_canonical::load(project)
    }
    fn guide_path(&self) -> Option<PathBuf> { self.project.as_ref().map(|project| project.join("ManuscriptGuide/manuscript_guide.json")) }
    fn entity_occurrence_index(&self) -> HashMap<(String, String), Vec<String>> {
        let Some(path) = self.guide_path() else { return HashMap::new(); };
        let Some(current) = stamp(&path) else { return HashMap::new(); };
        if let Ok(cache) = ENTITY_INDEX_CACHE.lock() {
            if let Some((cached_stamp, index)) = cache.get(&path) {
                if *cached_stamp == current { return index.clone(); }
            }
        }
        let index = build_entity_occurrence_index(&path);
        if let Ok(mut cache) = ENTITY_INDEX_CACHE.lock() { cache.insert(path, (current, index.clone())); }
        index
    }
    fn notes_path(&self) -> Result<PathBuf, String> { Ok(self.project.as_ref().ok_or_else(|| "Save the REAPER project first.".to_string())?.join("narration-utils/manuscript-notes.json")) }
    fn load_notes(&self) -> Value {
        let Ok(path) = self.notes_path() else { return empty_notes(); };
        let Some(current) = stamp(&path) else { return empty_notes(); };
        if let Ok(cache) = NOTES_CACHE.lock() {
            if let Some((cached_stamp, notes)) = cache.get(&path) {
                if *cached_stamp == current { return notes.clone(); }
            }
        }
        let Ok(text) = fs::read_to_string(&path) else { return empty_notes(); };
        let notes = normalize_notes(serde_json::from_str(&text).unwrap_or_else(|_| json!({})));
        if let Ok(mut cache) = NOTES_CACHE.lock() { cache.insert(path, (current, notes.clone())); }
        notes
    }
    fn save_notes(&self, notes: &Value) -> Result<(), String> {
        let path = self.notes_path()?;
        if let Some(parent)=path.parent(){fs::create_dir_all(parent).map_err(|error| format!("Could not create manuscript sidecar: {error}"))?;}
        fs::write(&path, serde_json::to_vec_pretty(notes).expect("notes JSON serializes")).map_err(|error| format!("Could not write manuscript sidecar: {error}"))?;
        if let Ok(mut cache) = NOTES_CACHE.lock() { cache.remove(&path); }
        Ok(())
    }
}

fn empty_notes() -> Value { json!({"notes": [], "chapterStatus": {}, "readerState": {"activeChapter": null, "activeSourceLine": null, "bookmarks": [], "expandedChapters": null}}) }
fn normalize_notes(raw: Value) -> Value { let object = raw.as_object().cloned().unwrap_or_default(); let lower = object.into_iter().map(|(key,value)|(key.to_lowercase(),value)).collect::<BTreeMap<_,_>>(); json!({"notes": lower.get("notes").cloned().unwrap_or_else(||json!([])), "chapterStatus": lower.get("chapterstatus").cloned().unwrap_or_else(||json!({})), "readerState": lower.get("readerstate").cloned().unwrap_or_else(|| empty_notes()["readerState"].clone())}) }
fn paragraph_payload(paragraph: &Value, entities: &HashMap<(String, String), Vec<String>>) -> Value {
    let key = (paragraph["chapterId"].as_str().unwrap_or_default().to_string(), paragraph["id"].as_str().unwrap_or_default().to_string());
    let entity_ids = entities.get(&key).cloned().unwrap_or_default();
    json!({"id":paragraph["id"],"chapterId":paragraph["chapterId"],"chapter":paragraph["chapterTitle"],"index":paragraph["index"],"text":paragraph["text"],"entityIds":entity_ids})
}
fn chapter_payload(chapter:&Value,status:&Map<String,Value>,paragraphs:Option<&Vec<Value>>)->Value { let mut value=json!({"id":chapter["id"],"title":chapter["title"],"subtitle":chapter["subtitle"],"index":chapter["index"],"wordCount":chapter["wordCount"],"status":status.get(chapter["id"].as_str().unwrap_or_default()).cloned().unwrap_or_else(||json!("not_started"))}); if let Some(paragraphs)=paragraphs {value["paragraphIds"]=Value::Array(paragraphs.iter().filter(|paragraph|paragraph["chapterId"]==chapter["id"]).map(|paragraph|json!({"id":paragraph["id"],"index":paragraph["index"]})).collect());} value }

/// Mirrors manuscript_service.py's `_entity_occurrence_index`: tolerates a
/// missing/unreadable guide file (empty index), a plain-string alias (no
/// `occurrences` key) the same way Python's `isinstance(alias, dict)` guard
/// does, and de-dupes entity ids per (chapterId, paragraphId).
fn build_entity_occurrence_index(guide_path: &std::path::Path) -> HashMap<(String, String), Vec<String>> {
    let mut index: HashMap<(String, String), Vec<String>> = HashMap::new();
    let Ok(text) = fs::read_to_string(guide_path) else { return index; };
    let Ok(guide) = serde_json::from_str::<Value>(&text) else { return index; };
    let mut add_occurrences = |entity_id: &str, occurrences: &Value| {
        for occurrence in occurrences.as_array().into_iter().flatten() {
            let (Some(chapter), Some(paragraph)) = (occurrence["chapterId"].as_str(), occurrence["paragraphId"].as_str()) else { continue };
            let ids = index.entry((chapter.to_string(), paragraph.to_string())).or_default();
            if !ids.iter().any(|id| id == entity_id) { ids.push(entity_id.to_string()); }
        }
    };
    for entity in guide["entities"].as_array().into_iter().flatten() {
        let Some(entity_id) = entity["id"].as_str() else { continue };
        add_occurrences(entity_id, &entity["occurrences"]);
        for alias in entity["aliases"].as_array().into_iter().flatten() {
            if alias.is_object() { add_occurrences(entity_id, &alias["occurrences"]); }
        }
    }
    index
}

#[cfg(test)]
mod tests {
    use super::ManuscriptService;
    use crate::server::manuscript_canonical;
    use std::{fs, path::PathBuf};

    fn project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("narration-utils-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn seed_manuscript(project: &PathBuf) -> (String, String) {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = repo.join("shared/test-fixtures/alice.md");
        let draft = manuscript_canonical::prepare_import(&source, 1).expect("fixture parses");
        let canonical = manuscript_canonical::commit_import(project, &source, &draft).expect("commit succeeds");
        let chapter_id = canonical["chapters"][0]["id"].as_str().unwrap().to_string();
        let paragraph_id = canonical["paragraphs"][0]["id"].as_str().unwrap().to_string();
        (chapter_id, paragraph_id)
    }

    #[test]
    fn reader_state_round_trips_and_an_explicit_empty_expanded_list_is_not_treated_as_unset() {
        let project = project("reader-state-test");
        seed_manuscript(&project);
        let service = ManuscriptService::new(Some(project.clone()));

        let saved = service
            .save_reader_state(Some("c-0001".to_string()), Some(3), Some(vec!["c-0001".to_string()]))
            .expect("save succeeds");
        assert_eq!(saved["activeChapter"], "c-0001");
        assert_eq!(saved["expandedChapters"], serde_json::json!(["c-0001"]));

        // Omitting expandedChapters (None) must fall back to the stored
        // value, not clear it - only an explicit list (even empty) changes it.
        let unchanged = service.save_reader_state(Some("c-0002".to_string()), None, None).expect("save succeeds");
        assert_eq!(unchanged["expandedChapters"], serde_json::json!(["c-0001"]));

        let cleared = service.save_reader_state(None, None, Some(vec![])).expect("save succeeds");
        assert_eq!(cleared["expandedChapters"], serde_json::json!([]));

        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn duplicate_bookmarks_are_deduped_and_delete_removes_by_id() {
        let project = project("bookmark-test");
        let (chapter_id, _) = seed_manuscript(&project);
        let service = ManuscriptService::new(Some(project.clone()));

        let first = service
            .create_bookmark("chapter", "Chapter One", Some(&chapter_id), None, None, None, None)
            .expect("create succeeds");
        let duplicate = service
            .create_bookmark("chapter", "Chapter One", Some(&chapter_id), None, None, None, None)
            .expect("create succeeds");
        assert_eq!(first["id"], duplicate["id"], "identical bookmark should be deduped, not re-created");

        let state = service.reader_state();
        assert_eq!(state["bookmarks"].as_array().unwrap().len(), 1);

        service.delete_bookmark(first["id"].as_str().unwrap()).expect("delete succeeds");
        let state = service.reader_state();
        assert!(state["bookmarks"].as_array().unwrap().is_empty());

        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn reader_includes_paragraphs_and_notes_alongside_chapters() {
        let project = project("reader-test");
        seed_manuscript(&project);
        let service = ManuscriptService::new(Some(project.clone()));
        let reader = service.reader().expect("reader loads");
        assert!(!reader["chapters"].as_array().unwrap().is_empty());
        assert!(!reader["paragraphs"].as_array().unwrap().is_empty());
        assert!(reader["notes"].as_array().unwrap().is_empty());
        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn entity_occurrence_index_tolerates_a_missing_guide_file_and_a_plain_string_alias() {
        let project = project("entity-index-test");
        let (chapter_id, paragraph_id) = seed_manuscript(&project);
        let service = ManuscriptService::new(Some(project.clone()));

        // No guide file yet: entityIds must be empty, not an error.
        let paragraphs = service.paragraphs(&chapter_id).expect("paragraphs load");
        assert_eq!(paragraphs[0]["entityIds"], serde_json::json!([]));

        let guide_dir = project.join("ManuscriptGuide");
        fs::create_dir_all(&guide_dir).unwrap();
        let guide = serde_json::json!({
            "entities": [
                {
                    "id": "e-1",
                    "occurrences": [{"chapterId": chapter_id, "paragraphId": paragraph_id}],
                    // A plain-string alias (no `occurrences` key) must be
                    // skipped, not panic - matches Python's isinstance guard.
                    "aliases": ["Alice"],
                }
            ]
        });
        fs::write(guide_dir.join("manuscript_guide.json"), serde_json::to_vec(&guide).unwrap()).unwrap();

        let paragraphs = service.paragraphs(&chapter_id).expect("paragraphs load");
        assert_eq!(paragraphs[0]["entityIds"], serde_json::json!(["e-1"]));

        let _ = fs::remove_dir_all(project);
    }
}

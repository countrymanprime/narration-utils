//! Project-owned canonical manuscript storage.
//!
//! Parsing source files is delegated to `manuscript-import`; this module owns
//! the stable `narration-utils/manuscript/manuscript.json` transaction used by
//! the reader and the two remaining Python CLIs.

use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn manuscript_dir(project: &Path) -> PathBuf {
    project.join("narration-utils/manuscript")
}

pub fn manuscript_path(project: &Path) -> PathBuf {
    manuscript_dir(project).join("manuscript.json")
}

pub fn prepare_import(source: &Path, markdown_heading_level: u8) -> Result<Value, String> {
    let draft =
        manuscript_import::build_draft(source, markdown_heading_level).map_err(|error| error.0)?;
    serde_json::to_value(draft)
        .map_err(|error| format!("Could not serialize import preview: {error}"))
}

pub fn preview(draft: &Value) -> Result<Value, String> {
    let object = draft
        .as_object()
        .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
    let paragraphs = object
        .get("paragraphs")
        .and_then(Value::as_array)
        .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
    Ok(json!({
        "format": object.get("format").cloned().unwrap_or(Value::Null),
        "sourceName": object.get("sourceName").cloned().unwrap_or(Value::Null),
        "paragraphCount": paragraphs.len(),
        "chapterTitles": object.get("chapterTitles").cloned().unwrap_or_else(|| json!([])),
        "sections": object.get("sections").cloned().unwrap_or_else(|| json!([])),
        "characterCandidates": object.get("characterCandidates").cloned().unwrap_or_else(|| json!([])),
    }))
}

pub fn commit_import(
    project: &Path,
    source: &Path,
    draft: &Value,
    section_kinds: &BTreeMap<String, String>,
) -> Result<Value, String> {
    let source_name = source
        .file_name()
        .ok_or_else(|| "The selected manuscript has no file name.".to_string())?;
    let source_folder = manuscript_dir(project)
        .join("sources")
        .join(Uuid::new_v4().simple().to_string());
    fs::create_dir_all(&source_folder)
        .map_err(|error| format!("Could not create manuscript storage: {error}"))?;
    let stored = source_folder.join(source_name);

    let mut input = fs::File::open(source)
        .map_err(|error| format!("Could not open the selected manuscript: {error}"))?;
    let mut output = fs::File::create(&stored)
        .map_err(|error| format!("Could not store the selected manuscript: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Could not read the selected manuscript: {error}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Could not store the selected manuscript: {error}"))?;
        digest.update(&buffer[..read]);
    }
    output
        .flush()
        .map_err(|error| format!("Could not store the selected manuscript: {error}"))?;

    let relative = stored
        .strip_prefix(project)
        .map_err(|_| "Could not locate project-owned manuscript storage.".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let canonical = canonicalize(
        draft,
        source_name.to_string_lossy().as_ref(),
        &relative,
        &format!("{:x}", digest.finalize()),
        section_kinds,
    )?;
    let target = manuscript_path(project);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create manuscript storage: {error}"))?;
    }
    let temporary = target.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&canonical).expect("canonical JSON serializes"),
    )
    .map_err(|error| format!("Could not write canonical manuscript data: {error}"))?;
    fs::rename(temporary, target)
        .map_err(|error| format!("Could not activate canonical manuscript data: {error}"))?;
    Ok(canonical)
}

/// Adds only the character-list entries the narrator checked in the import
/// preview.  They are manual, reviewable Story Bible records so a later
/// automatic rebuild retains rather than re-interprets them.
pub fn seed_character_candidates(
    project: &Path,
    canonical: &Value,
    draft: &Value,
    selected_ids: &HashSet<String>,
) -> Result<(), String> {
    if selected_ids.is_empty() {
        return Ok(());
    }
    let candidates = draft
        .get("characterCandidates")
        .and_then(Value::as_array)
        .ok_or_else(|| "The manuscript character suggestions are invalid.".to_string())?;
    let sections = draft
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let guide_path = project.join("ManuscriptGuide/manuscript_guide.json");
    let mut guide = fs::read_to_string(&guide_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            json!({
                "schema_version": 1,
                "source": {"sha256": canonical["source"]["sha256"]},
                "entities": [],
                "vocabulary_candidates": [],
                "absorbed_names": {},
            })
        });
    let entities = guide
        .get_mut("entities")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "The Story Bible data is invalid.".to_string())?;
    for candidate in candidates {
        let id = candidate
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !selected_ids.contains(id) {
            continue;
        }
        let name = candidate
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if name.is_empty()
            || entities.iter().any(|entity| {
                entity
                    .get("canonical_name")
                    .and_then(Value::as_str)
                    .is_some_and(|existing| existing.eq_ignore_ascii_case(name))
            })
        {
            continue;
        }
        let source_section_id = candidate
            .get("sourceSectionId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let source_title = sections
            .iter()
            .find(|section| section.get("id").and_then(Value::as_str) == Some(source_section_id))
            .and_then(|section| section.get("title").and_then(Value::as_str))
            .unwrap_or("Characters");
        let description = candidate
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        entities.push(json!({
            "id": format!("import-character-{}", Uuid::new_v4().simple()),
            "canonical_name": name,
            "aliases": [],
            "category": "Character",
            "occurrences": [],
            "occurrence_count": 0,
            "pronunciation": {"say_as": name, "source": "Imported character list", "confidence": "pending"},
            "description": {"text": description, "evidence": {"chapter": source_title, "excerpt": description}},
            "personality_notes": [],
            "context": "",
            "relationships": [],
            "locked": false,
            "manual": true,
            "review_state": "needs review",
        }));
    }
    if let Some(parent) = guide_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create Story Bible storage: {error}"))?;
    }
    let temporary = guide_path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&guide).expect("guide JSON serializes"),
    )
    .map_err(|error| format!("Could not write Story Bible suggestions: {error}"))?;
    fs::rename(temporary, guide_path)
        .map_err(|error| format!("Could not activate Story Bible suggestions: {error}"))
}

pub fn load(project: &Path) -> Result<Value, String> {
    let path = manuscript_path(project);
    let mut data: Value = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|_| "Import a manuscript first.".to_string())?,
    )
    .map_err(|_| "The canonical manuscript data could not be read.".to_string())?;
    validate(&data)?;
    if migrate_legacy_section_labels(&mut data) {
        let temporary = path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&data).expect("canonical JSON serializes"),
        )
        .map_err(|error| format!("Could not update legacy manuscript labels: {error}"))?;
        fs::rename(&temporary, &path)
            .map_err(|error| format!("Could not activate updated manuscript labels: {error}"))?;
    }
    Ok(data)
}

/// Old canonical files used a developer-facing `Front Matter` chapter name.
/// Preserve their stable IDs and source text, but promote the label and add
/// the now-optional content kind so every reader sees a human-facing opening
/// section and downstream narration consumers exclude it consistently.
fn migrate_legacy_section_labels(data: &mut Value) -> bool {
    let mut changed = false;
    let mut opening_ids = HashSet::new();
    if let Some(chapters) = data.get_mut("chapters").and_then(Value::as_array_mut) {
        for chapter in chapters {
            let is_legacy_front_matter = chapter
                .get("title")
                .and_then(Value::as_str)
                .is_some_and(|title| title.trim().eq_ignore_ascii_case("front matter"));
            if !is_legacy_front_matter {
                continue;
            }
            if let Some(id) = chapter.get("id").and_then(Value::as_str) {
                opening_ids.insert(id.to_string());
            }
            if let Some(object) = chapter.as_object_mut() {
                object.insert("title".to_string(), json!("Opening pages"));
                if !object.contains_key("contentKind") {
                    object.insert("contentKind".to_string(), json!("opening"));
                }
                changed = true;
            }
        }
    }
    if opening_ids.is_empty() {
        return changed;
    }
    if let Some(paragraphs) = data.get_mut("paragraphs").and_then(Value::as_array_mut) {
        for paragraph in paragraphs {
            if paragraph
                .get("chapterId")
                .and_then(Value::as_str)
                .is_some_and(|id| opening_ids.contains(id))
            {
                if let Some(object) = paragraph.as_object_mut() {
                    object.insert("chapterTitle".to_string(), json!("Opening pages"));
                    changed = true;
                }
            }
        }
    }
    changed
}

pub fn exists(project: &Path) -> bool {
    manuscript_path(project).is_file()
}

/// (size, mtime_ns) - taken at preview time, re-checked at commit time so a
/// source file edited in between gets rejected instead of silently
/// importing stale content. Mirrors `hub_state.py::_fingerprint`.
pub fn fingerprint(path: &Path) -> Result<(u64, i128), String> {
    let metadata =
        fs::metadata(path).map_err(|_| "The selected manuscript no longer exists.".to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| format!("Could not read the selected manuscript: {error}"))?;
    let mtime_ns = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as i128)
        .unwrap_or(0);
    Ok((metadata.len(), mtime_ns))
}

/// Wipes everything derived from the manuscript (Story Bible, transcript
/// compare data, the reader notes sidecar) - only called after a
/// user-confirmed replacement or an explicit "clear project data".
/// Mirrors `hub_state.py::_reset_manuscript_derivatives`.
pub fn reset_derivatives(project: &Path) -> Result<(), String> {
    for target in [
        project.join("ManuscriptGuide"),
        project.join("TranscriptCompare"),
    ] {
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("Could not clear {}: {error}", target.display()))?;
        }
    }
    for target in [
        project.join("narration-utils/manuscript-notes.json"),
        project.join(".narration-last-comparison.json"),
    ] {
        if target.exists() {
            fs::remove_file(&target)
                .map_err(|error| format!("Could not remove {}: {error}", target.display()))?;
        }
    }
    Ok(())
}

/// Removes the canonical manuscript itself and its project-owned source
/// copies - only after `reset_derivatives` has already run, matching
/// `hub_state.py::clear_project_data`'s ordering.
pub fn clear(project: &Path) -> Result<(), String> {
    let folder = manuscript_dir(project);
    if folder.exists() {
        fs::remove_dir_all(&folder)
            .map_err(|error| format!("Could not clear manuscript storage: {error}"))?;
    }
    Ok(())
}

fn canonicalize(
    draft: &Value,
    source_name: &str,
    stored_path: &str,
    sha256: &str,
    section_kinds: &BTreeMap<String, String>,
) -> Result<Value, String> {
    let draft = draft
        .as_object()
        .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
    let source_paragraphs = draft
        .get("paragraphs")
        .and_then(Value::as_array)
        .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
    let mut chapters = Vec::<Value>::new();
    let mut chapter_ids = std::collections::BTreeMap::<String, usize>::new();
    let mut paragraphs = Vec::<Value>::new();
    let mut kind_by_title = BTreeMap::<String, String>::new();
    for section in draft
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let id = section
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let title = section
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let default_kind = section
            .get("contentKind")
            .and_then(Value::as_str)
            .unwrap_or("narration");
        let kind = section_kinds
            .get(id)
            .map(String::as_str)
            .unwrap_or(default_kind);
        if !matches!(kind, "narration" | "opening" | "reference") {
            return Err("The selected manuscript section classification is invalid.".to_string());
        }
        kind_by_title.insert(title.to_string(), kind.to_string());
    }
    for source in source_paragraphs {
        let source = source
            .as_object()
            .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
        let title = source
            .get("chapter")
            .and_then(Value::as_str)
            .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
        let chapter_index = match chapter_ids.get(title) {
            Some(index) => *index,
            None => {
                let index = chapters.len();
                chapters.push(json!({"id": format!("c-{:04}", index + 1), "title": title, "subtitle": source.get("chapterSubtitle").cloned().unwrap_or(Value::Null), "index": index, "wordCount": 0, "contentKind": kind_by_title.get(title).cloned().unwrap_or_else(|| "narration".to_string()), "sections": []}));
                chapter_ids.insert(title.to_string(), index);
                index
            }
        };
        let text = source
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| "The manuscript import preview is invalid.".to_string())?;
        let chapter = chapters[chapter_index]
            .as_object_mut()
            .expect("constructed chapter is object");
        let chapter_id = chapter
            .get("id")
            .and_then(Value::as_str)
            .expect("constructed chapter has id")
            .to_string();
        let word_count = chapter
            .get("wordCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + text.split_whitespace().count() as u64;
        chapter.insert("wordCount".to_string(), json!(word_count));
        let section_id = source
            .get("section")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|section| {
                let sections = chapter
                    .get_mut("sections")
                    .and_then(Value::as_array_mut)
                    .expect("constructed chapter has sections");
                let position = sections
                    .iter()
                    .position(|item| item.get("title").and_then(Value::as_str) == Some(section));
                match position {
                    Some(position) => sections[position]
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    None => {
                        let id = format!("{chapter_id}-s-{:03}", sections.len() + 1);
                        sections.push(json!({"id": id, "title": section}));
                        id
                    }
                }
            });
        paragraphs.push(json!({"id": format!("p-{:06}", paragraphs.len() + 1), "index": paragraphs.len(), "chapterId": chapter_id, "chapterTitle": title, "sectionId": section_id, "text": text, "sourceIndex": source.get("sourceIndex").cloned().unwrap_or(json!(paragraphs.len()))}));
    }
    let result = json!({"schemaVersion": 1, "documentId": Uuid::new_v4().simple().to_string(), "importedAt": Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, true), "importer": {"format": draft.get("format").cloned().unwrap_or(Value::Null), "version": 1}, "source": {"fileName": source_name, "sha256": sha256, "storedPath": stored_path}, "chapters": chapters, "paragraphs": paragraphs});
    validate(&result)?;
    Ok(result)
}

fn validate(data: &Value) -> Result<(), String> {
    let object = data
        .as_object()
        .ok_or_else(|| "The canonical manuscript data is invalid.".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || object.get("documentId").and_then(Value::as_str).is_none()
        || object.get("chapters").and_then(Value::as_array).is_none()
        || object.get("paragraphs").and_then(Value::as_array).is_none()
    {
        return Err("This manuscript data uses an unsupported schema version.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{commit_import, exists, load, prepare_import, preview, seed_character_candidates};
    use serde_json::{json, Value};
    use std::{
        collections::{BTreeMap, HashSet},
        path::PathBuf,
    };

    #[test]
    fn imports_the_markdown_fixture_into_project_owned_canonical_data() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = repo.join("shared/test-fixtures/alice.md");
        let project = std::env::temp_dir().join(format!(
            "narration-utils-canonical-test-{}",
            std::process::id()
        ));
        let draft = prepare_import(&source, 1).expect("fixture parses");
        assert_eq!(preview(&draft).unwrap()["format"], "markdown");
        let canonical =
            commit_import(&project, &source, &draft, &BTreeMap::new()).expect("commit succeeds");
        assert!(exists(&project));
        assert_eq!(
            load(&project).unwrap()["documentId"],
            canonical["documentId"]
        );
        assert!(canonical["source"]["storedPath"]
            .as_str()
            .unwrap()
            .starts_with("narration-utils/manuscript/sources/"));
        let _ = std::fs::remove_dir_all(project);
    }

    #[test]
    fn retains_reference_material_and_seeds_checked_character_suggestions() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = repo.join("shared/test-fixtures/alice.md");
        let project = std::env::temp_dir().join(format!(
            "narration-utils-reference-import-test-{}",
            std::process::id()
        ));
        let draft = json!({
            "format": "markdown", "sourceName": "fixture.md", "chapterTitles": ["Chapter 1"],
            "paragraphs": [
                {"chapter": "Chapter 1", "chapterSubtitle": null, "section": null, "text": "Narration text.", "sourceIndex": 0},
                {"chapter": "Characters", "chapterSubtitle": null, "section": null, "text": "Ada Finch — investigator", "sourceIndex": 1}
            ],
            "sections": [
                {"id": "section-0001", "title": "Chapter 1", "contentKind": "narration", "paragraphCount": 1},
                {"id": "section-0002", "title": "Characters", "contentKind": "reference", "paragraphCount": 1}
            ],
            "characterCandidates": [{"id": "candidate-1", "name": "Ada Finch", "description": "investigator", "sourceSectionId": "section-0002"}]
        });
        let canonical =
            commit_import(&project, &source, &draft, &BTreeMap::new()).expect("commit succeeds");
        assert_eq!(canonical["chapters"][1]["contentKind"], "reference");
        seed_character_candidates(
            &project,
            &canonical,
            &draft,
            &HashSet::from(["candidate-1".to_string()]),
        )
        .expect("seeding succeeds");
        let guide: Value = serde_json::from_str(
            &std::fs::read_to_string(project.join("ManuscriptGuide/manuscript_guide.json"))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(guide["entities"][0]["canonical_name"], "Ada Finch");
        assert_eq!(guide["entities"][0]["review_state"], "needs review");
        assert_eq!(guide["entities"][0]["manual"], true);
        let _ = std::fs::remove_dir_all(project);
    }

    #[test]
    fn migrates_legacy_front_matter_to_opening_pages_without_changing_ids() {
        let project = std::env::temp_dir().join(format!(
            "narration-utils-front-matter-migration-test-{}",
            std::process::id()
        ));
        let manuscript_dir = project.join("narration-utils/manuscript");
        std::fs::create_dir_all(&manuscript_dir).unwrap();
        let path = manuscript_dir.join("manuscript.json");
        std::fs::write(
            &path,
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "documentId": "legacy-document",
                "chapters": [{"id": "c-0001", "title": "Front Matter", "index": 0, "wordCount": 12}],
                "paragraphs": [{"id": "p-000001", "chapterId": "c-0001", "chapterTitle": "Front Matter", "index": 0, "text": "Copyright Example."}]
            }))
            .unwrap(),
        )
        .unwrap();

        let migrated = load(&project).expect("legacy manuscript loads");

        assert_eq!(migrated["chapters"][0]["id"], "c-0001");
        assert_eq!(migrated["chapters"][0]["title"], "Opening pages");
        assert_eq!(migrated["chapters"][0]["contentKind"], "opening");
        assert_eq!(migrated["paragraphs"][0]["chapterTitle"], "Opening pages");
        let persisted: Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(persisted["chapters"][0]["title"], "Opening pages");
        let _ = std::fs::remove_dir_all(project);
    }
}

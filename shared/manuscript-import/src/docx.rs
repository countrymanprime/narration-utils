//! Ports shared/python/narration_common/docx_chapters.py's
//! `load_docx_paragraph_records` (the one function actually used - see the
//! removed `load_docx_paragraphs`/`load_manuscript_paragraphs`, which were
//! dead code) and manuscript.py's `_docx_draft`.
//!
//! A .docx is a zip of XML parts. We only need two:
//! - word/styles.xml: styleId -> display name, for paragraph styles only.
//!   Word's built-in headings are styleId "Heading1".."Heading9" (and
//!   "Title"), whose <w:name val="heading 1"/> etc. is what python-docx's
//!   `paragraph.style.name` actually returns - so replicate the id->name
//!   lookup rather than assuming the id itself reads as "Heading 1".
//! - word/document.xml: the paragraph run text plus each paragraph's
//!   pStyle/outlineLvl.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::model::{classify_pre_heading, collapse_whitespace, non_chapter_headings, Draft, ManuscriptError, Paragraph};

struct ParagraphRecord {
    text: String,
    is_heading_outline: bool,
}

fn read_zip_entry(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    Some(buf)
}

fn attr_val(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.to_string()))
}

/// styleId -> lowercased display name, for w:type="paragraph" styles only
/// (character/table styles share the same styleId namespace in styles.xml
/// but are never referenced by a paragraph's pStyle).
fn parse_style_names(styles_xml: &str) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let mut reader = Reader::from_str(styles_xml);
    reader.config_mut().trim_text(false);

    let mut current_id: Option<String> = None;
    let mut current_is_paragraph = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"style" => {
                    current_is_paragraph = attr_val(&e, b"type").as_deref() == Some("paragraph");
                    current_id = attr_val(&e, b"styleId");
                }
                b"name" if current_is_paragraph => {
                    if let (Some(id), Some(val)) = (&current_id, attr_val(&e, b"val")) {
                        names.insert(id.clone(), val.to_lowercase());
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) if e.local_name().as_ref() == b"style" => {
                current_id = None;
                current_is_paragraph = false;
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    names
}

fn parse_paragraph_records(document_xml: &str, style_names: &HashMap<String, String>) -> Vec<ParagraphRecord> {
    let mut records = Vec::new();
    let mut reader = Reader::from_str(document_xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    // Per-paragraph accumulator state, reset on every <w:p>.
    let mut in_paragraph = false;
    let mut text = String::new();
    let mut style_id: Option<String> = None;
    let mut outline_level: Option<i32> = None;
    // Only Start (not a self-closing Empty <w:t/>) opens a text run - an
    // empty run has no matching End event, so treating Empty the same way
    // would leave this flag stuck on and swallow unrelated following text.
    let mut in_text_run = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"p" => {
                    in_paragraph = true;
                    text.clear();
                    style_id = None;
                    outline_level = None;
                }
                b"t" if in_paragraph => in_text_run = true,
                b"pStyle" if in_paragraph => style_id = attr_val(&e, b"val"),
                b"outlineLvl" if in_paragraph => {
                    outline_level = attr_val(&e, b"val").and_then(|v| v.parse::<i32>().ok());
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"pStyle" if in_paragraph => style_id = attr_val(&e, b"val"),
                b"outlineLvl" if in_paragraph => {
                    outline_level = attr_val(&e, b"val").and_then(|v| v.parse::<i32>().ok());
                }
                b"tab" if in_paragraph => text.push('\t'),
                b"br" | b"cr" if in_paragraph => text.push('\n'),
                _ => {}
            },
            Ok(Event::Text(e)) if in_text_run => {
                if let Ok(unescaped) = e.unescape() {
                    text.push_str(&unescaped);
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_text_run = false,
                b"p" => {
                    in_paragraph = false;
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        let style_name = style_id.as_ref().and_then(|id| style_names.get(id)).cloned().unwrap_or_default();
                        let is_heading = style_name.starts_with("heading") || style_name == "title";
                        let is_heading_outline = is_heading || outline_level.map(|v| v < 9).unwrap_or(false);
                        records.push(ParagraphRecord { text: trimmed, is_heading_outline });
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    records
}

pub fn build_draft(path: &Path) -> Result<Draft, ManuscriptError> {
    let file = std::fs::File::open(path).map_err(|e| ManuscriptError(format!("Could not open this Word document: {e}")))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| ManuscriptError(format!("Could not read this Word document: {e}")))?;

    let styles_xml = read_zip_entry(&mut archive, "word/styles.xml").unwrap_or_default();
    let document_xml = read_zip_entry(&mut archive, "word/document.xml")
        .ok_or_else(|| ManuscriptError("This .docx file is missing its document contents.".to_string()))?;

    let style_names = parse_style_names(&styles_xml);
    let records = parse_paragraph_records(&document_xml, &style_names);
    let non_chapter = non_chapter_headings();

    let mut chapter = "Front Matter".to_string();
    let mut chapter_subtitle = None;
    let mut paragraphs = Vec::new();
    let mut titles = Vec::new();
    let first_heading = records
        .iter()
        .position(|record| record.is_heading_outline && !non_chapter.contains(collapse_whitespace(&record.text).to_lowercase().as_str()))
        .unwrap_or(records.len());
    let pre_heading_indexes: Vec<usize> = records
        .iter()
        .enumerate()
        .filter(|(index, record)| *index < first_heading && !record.is_heading_outline)
        .map(|(index, _)| index)
        .collect();
    let pre_heading: Vec<String> = pre_heading_indexes.iter().map(|index| collapse_whitespace(&records[*index].text)).collect();
    let pre_heading_kinds = classify_pre_heading(&pre_heading);
    let mut pre_heading_kind_by_record = vec![None; records.len()];
    for (index, kind) in pre_heading_indexes.into_iter().zip(pre_heading_kinds) {
        pre_heading_kind_by_record[index] = Some(kind);
    }

    for (record_index, record) in records.into_iter().enumerate() {
        let text = collapse_whitespace(&record.text);
        if record.is_heading_outline {
            if non_chapter.contains(text.to_lowercase().as_str()) {
                continue;
            }
            let mut lines = record.text.lines().map(collapse_whitespace).filter(|line| !line.is_empty());
            let title = lines.next().unwrap_or_default();
            chapter_subtitle = {
                let subtitle = lines.collect::<Vec<_>>().join(" ");
                (!subtitle.is_empty()).then_some(subtitle)
            };
            chapter = title.clone();
            titles.push(title);
            continue;
        }
        if let Some(kind) = pre_heading_kind_by_record[record_index] {
            chapter = kind.chapter_name().to_string();
            chapter_subtitle = None;
        }
        paragraphs.push(Paragraph {
            chapter: chapter.clone(),
            chapter_subtitle: chapter_subtitle.clone(),
            section: None,
            text,
            source_index: paragraphs.len(),
        });
    }

    let source_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Draft::new("docx", source_name, paragraphs, titles)
}

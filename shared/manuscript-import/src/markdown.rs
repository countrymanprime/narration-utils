//! Ports manuscript.py's `_markdown_draft`.

use std::path::Path;

use regex::Regex;

use crate::model::{classify_pre_heading, collapse_whitespace, Draft, ManuscriptError, Paragraph};

pub fn build_draft(path: &Path, heading_level: u8) -> Result<Draft, ManuscriptError> {
    if !(1..=6).contains(&heading_level) {
        return Err(ManuscriptError(
            "Markdown chapter heading level must be between H1 and H6.".to_string(),
        ));
    }
    let heading_re = Regex::new(r"^(#{1,6})\s+(.+?)\s*#*\s*$").unwrap();

    let raw = std::fs::read_to_string(path)
        .map_err(|e| ManuscriptError(format!("Could not read this Markdown file: {e}")))?;
    // Mirrors Python's `encoding="utf-8-sig"`: strip a leading BOM if present.
    let content = raw.strip_prefix('\u{FEFF}').unwrap_or(&raw);

    let mut chapter = "Opening pages".to_string();
    let mut section: Option<String> = None;
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut titles: Vec<String> = Vec::new();
    let mut pending: Vec<String> = Vec::new();

    let flush = |pending: &mut Vec<String>,
                 chapter: &str,
                 section: &Option<String>,
                 paragraphs: &mut Vec<Paragraph>| {
        if !pending.is_empty() {
            let body = collapse_whitespace(&pending.join(" "));
            if !body.is_empty() {
                paragraphs.push(Paragraph {
                    chapter: chapter.to_string(),
                    chapter_subtitle: None,
                    section: section.clone(),
                    text: body,
                    source_index: paragraphs.len(),
                });
            }
            pending.clear();
        }
    };

    for raw_line in content.lines() {
        if let Some(caps) = heading_re.captures(raw_line) {
            flush(&mut pending, &chapter, &section, &mut paragraphs);
            let level = caps[1].len() as u8;
            let text = collapse_whitespace(&caps[2]);
            if level == heading_level {
                chapter = text.clone();
                section = None;
                titles.push(text);
            } else if level > heading_level {
                section = Some(text);
            }
            // Shallower headings than heading_level are document metadata,
            // not prose - dropped without changing chapter/section state.
            continue;
        }
        if raw_line.trim().is_empty() {
            flush(&mut pending, &chapter, &section, &mut paragraphs);
        } else {
            pending.push(raw_line.trim().to_string());
        }
    }
    flush(&mut pending, &chapter, &section, &mut paragraphs);

    let pre_heading: Vec<String> = paragraphs
        .iter()
        .filter(|paragraph| paragraph.chapter == "Opening pages")
        .map(|paragraph| paragraph.text.clone())
        .collect();
    for (paragraph, kind) in paragraphs
        .iter_mut()
        .filter(|paragraph| paragraph.chapter == "Opening pages")
        .zip(classify_pre_heading(&pre_heading))
    {
        paragraph.chapter = kind.chapter_name().to_string();
    }

    let source_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Draft::new("markdown", source_name, paragraphs, titles)
}

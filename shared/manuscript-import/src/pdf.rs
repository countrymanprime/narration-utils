//! Ports manuscript.py's `_pdf_draft`. Uses `pdf-extract` instead of pypdf;
//! text extraction between the two libraries is not guaranteed byte-identical
//! (page-break/whitespace placement can differ slightly), so this is a
//! functional port, not a byte-for-byte one - flagged since PDF is the
//! least-used of the three import formats.
//!
//! NOT wired into manuscript.py's prepare_import() - PDF still goes through
//! the Python path there. Two reasons: pypdf never produced a blank line
//! (`\n\s*\n+`) for a programmatically-generated PDF in testing (see
//! shared/test-fixtures/generate_alice.py's comments), making the whole
//! document one block regardless of chapter count; and this pdf-extract
//! path, tested against that same 3-chapter fixture
//! (shared/test-fixtures/alice.pdf), consistently (reproduced 4/4 runs)
//! extracted 14 "chapters" - including titles like "Chapter IV. The Rabbit
//! Sends in a Little Bill" that exist in the real novel but were never
//! included in this 3-chapter fixture. Not flaky, just wrong - the exact
//! mechanism (embedded-TrueType-font cmap misdecoding is the leading guess,
//! unconfirmed) needs to be root-caused before this is ever wired up.

use std::path::Path;

use regex::Regex;

use crate::model::{classify_pre_heading, collapse_whitespace, Draft, ManuscriptError, Paragraph};

pub fn build_draft(path: &Path) -> Result<Draft, ManuscriptError> {
    let bytes = std::fs::read(path).map_err(|e| ManuscriptError(format!("Could not read this PDF: {e}")))?;
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| ManuscriptError(format!("Could not read this PDF: {e}")))?;

    let whitespace_re = Regex::new(r"\s+").unwrap();
    if whitespace_re.replace_all(&text, "").len() < 80 {
        return Err(ManuscriptError(
            "This PDF has no selectable manuscript text. OCR support is not available yet; use a text-based PDF.".to_string(),
        ));
    }

    let block_split_re = Regex::new(r"\n\s*\n+").unwrap();
    let chapter_prefix_re = Regex::new(r"(?i)^(chapter|book|part)\b").unwrap();

    let mut chapter = "Front Matter".to_string();
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut titles: Vec<String> = Vec::new();

    for block in block_split_re.split(&text) {
        let lines: Vec<String> = block.lines().map(collapse_whitespace).filter(|l| !l.is_empty()).collect();
        if lines.is_empty() {
            continue;
        }
        let candidate = &lines[0];
        let is_chapter = chapter_prefix_re.is_match(candidate) || (lines.len() == 1 && candidate.chars().count() <= 90 && is_upper(candidate));
        if is_chapter {
            chapter = candidate.clone();
            titles.push(candidate.clone());
            continue;
        }
        paragraphs.push(Paragraph {
            chapter: chapter.clone(),
            chapter_subtitle: None,
            section: None,
            text: collapse_whitespace(&lines.join(" ")),
            source_index: paragraphs.len(),
        });
    }

    let pre_heading: Vec<String> = paragraphs
        .iter()
        .filter(|paragraph| paragraph.chapter == "Front Matter")
        .map(|paragraph| paragraph.text.clone())
        .collect();
    for (paragraph, kind) in paragraphs
        .iter_mut()
        .filter(|paragraph| paragraph.chapter == "Front Matter")
        .zip(classify_pre_heading(&pre_heading))
    {
        paragraph.chapter = kind.chapter_name().to_string();
    }

    let source_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Draft::new("pdf", source_name, paragraphs, titles)
}

/// Mirrors Python's `str.isupper()`: true iff there is at least one cased
/// character and every cased character is uppercase.
fn is_upper(s: &str) -> bool {
    let mut has_cased = false;
    for c in s.chars() {
        if c.is_lowercase() {
            return false;
        }
        if c.is_uppercase() {
            has_cased = true;
        }
    }
    has_cased
}

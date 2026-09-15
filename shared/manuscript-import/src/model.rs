use serde::Serialize;
use std::collections::HashSet;

/// Structural headings that describe the document rather than a narratable
/// chapter - mirrors NON_CHAPTER_HEADINGS in the Python this replaces
/// (shared/python/narration_common/docx_chapters.py).
pub fn non_chapter_headings() -> HashSet<&'static str> {
    ["table of contents", "contents"].into_iter().collect()
}

#[derive(Serialize)]
pub struct Paragraph {
    pub chapter: String,
    // Always serialized (as null when absent, matching manuscript.py's
    // markdown draft) - the only consumer, _canonical()'s
    // `source_paragraph.get("section")`, treats a missing key and an
    // explicit null identically, so one consistent shape across all three
    // source formats is simpler and exactly as safe.
    pub section: Option<String>,
    pub text: String,
    #[serde(rename = "sourceIndex")]
    pub source_index: usize,
}

#[derive(Serialize)]
pub struct Draft {
    pub format: &'static str,
    #[serde(rename = "sourceName")]
    pub source_name: String,
    pub paragraphs: Vec<Paragraph>,
    #[serde(rename = "chapterTitles")]
    pub chapter_titles: Vec<String>,
}

/// Collapses internal whitespace runs to single spaces and trims - mirrors
/// manuscript.py's `_text()`.
pub fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub struct ManuscriptError(pub String);

impl Draft {
    pub fn new(format: &'static str, source_name: String, paragraphs: Vec<Paragraph>, chapter_titles: Vec<String>) -> Result<Draft, ManuscriptError> {
        if paragraphs.is_empty() {
            return Err(ManuscriptError("The manuscript has no readable text paragraphs.".to_string()));
        }
        Ok(Draft { format, source_name, paragraphs, chapter_titles })
    }
}

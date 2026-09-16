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
    #[serde(rename = "chapterSubtitle", skip_serializing_if = "Option::is_none")]
    pub chapter_subtitle: Option<String>,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SectionKind {
    Cover,
    FrontMatter,
}

impl SectionKind {
    pub fn chapter_name(self) -> &'static str {
        match self {
            SectionKind::Cover => "Cover",
            SectionKind::FrontMatter => "Front Matter",
        }
    }
}

/// Categorize prose before the first chapter heading once, independently of
/// the source format.  A short opening run is a title/credits page; the
/// remainder is conventional front matter.  Keeping this deliberately
/// conservative avoids turning a long preface into a cover just because its
/// first paragraph happens to be short.
pub fn classify_pre_heading(paragraphs: &[String]) -> Vec<SectionKind> {
    const MAX_COVER_LINES: usize = 3;
    const MAX_COVER_LINE_CHARS: usize = 120;
    let cover_count = paragraphs
        .iter()
        .take(MAX_COVER_LINES)
        .take_while(|line| line.chars().count() <= MAX_COVER_LINE_CHARS)
        .count();
    let has_cover = (cover_count >= 2
        && (paragraphs.len() <= MAX_COVER_LINES
            || paragraphs.get(1).is_some_and(|line| {
                let lower = line.trim().to_ascii_lowercase();
                lower.starts_with("by ") || lower.contains("copyright") || lower.contains("author")
            })))
        || paragraphs
            .first()
            .is_some_and(|line| line.trim().to_ascii_lowercase().starts_with("title:"));
    paragraphs
        .iter()
        .enumerate()
        .map(|(index, _)| {
            if has_cover && index < cover_count {
                SectionKind::Cover
            } else {
                SectionKind::FrontMatter
            }
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::{classify_pre_heading, SectionKind};

    #[test]
    fn classifies_a_short_title_page_separately_from_front_matter() {
        let kinds = classify_pre_heading(&[
            "A Very Good Book".to_string(),
            "By Example Author".to_string(),
            "Copyright 2026 Example Press".to_string(),
            "This edition was prepared for narration.".to_string(),
        ]);
        assert_eq!(
            kinds[..3],
            [SectionKind::Cover, SectionKind::Cover, SectionKind::Cover]
        );
        assert_eq!(kinds[3], SectionKind::FrontMatter);
    }
}

/// Collapses internal whitespace runs to single spaces and trims - mirrors
/// manuscript.py's `_text()`.
pub fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug)]
pub struct ManuscriptError(pub String);

impl Draft {
    pub fn new(
        format: &'static str,
        source_name: String,
        paragraphs: Vec<Paragraph>,
        chapter_titles: Vec<String>,
    ) -> Result<Draft, ManuscriptError> {
        if paragraphs.is_empty() {
            return Err(ManuscriptError(
                "The manuscript has no readable text paragraphs.".to_string(),
            ));
        }
        Ok(Draft {
            format,
            source_name,
            paragraphs,
            chapter_titles,
        })
    }
}

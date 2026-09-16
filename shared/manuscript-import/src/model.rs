use serde::Serialize;
use std::collections::{HashMap, HashSet};

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
            SectionKind::FrontMatter => "Opening pages",
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
    pub sections: Vec<DraftSection>,
    #[serde(rename = "characterCandidates")]
    pub character_candidates: Vec<CharacterCandidate>,
    #[serde(rename = "chapterTitles")]
    pub chapter_titles: Vec<String>,
}

/// A reviewable source section.  Its id is derived from the source order, so
/// a preview decision can be carried through to commit without trusting a
/// display title (which may legitimately repeat in a manuscript).
#[derive(Serialize)]
pub struct DraftSection {
    pub id: String,
    pub title: String,
    #[serde(rename = "contentKind")]
    pub content_kind: String,
    #[serde(rename = "paragraphCount")]
    pub paragraph_count: usize,
}

#[derive(Serialize)]
pub struct CharacterCandidate {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "sourceSectionId")]
    pub source_section_id: String,
}

#[cfg(test)]
mod tests {
    use super::{classify_pre_heading, Draft, Paragraph, SectionKind};
    use std::collections::HashMap;

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

    #[test]
    fn exposes_reviewable_reference_sections_and_character_suggestions() {
        let draft = Draft::new(
            "docx",
            "fixture.docx".to_string(),
            vec![
                Paragraph {
                    chapter: "Cover".to_string(),
                    chapter_subtitle: None,
                    section: None,
                    text: "A Book".to_string(),
                    source_index: 0,
                },
                Paragraph {
                    chapter: "Chapter 1".to_string(),
                    chapter_subtitle: None,
                    section: None,
                    text: "Narration.".to_string(),
                    source_index: 1,
                },
                Paragraph {
                    chapter: "Characters".to_string(),
                    chapter_subtitle: None,
                    section: None,
                    text: "Ada Finch — a careful investigator; Ben Holt — her brother".to_string(),
                    source_index: 2,
                },
            ],
            vec!["Chapter 1".to_string(), "Characters".to_string()],
        )
        .expect("draft is valid");
        let kinds = draft
            .sections
            .iter()
            .map(|section| (section.title.as_str(), section.content_kind.as_str()))
            .collect::<HashMap<_, _>>();
        assert_eq!(kinds["Cover"], "opening");
        assert_eq!(kinds["Chapter 1"], "narration");
        assert_eq!(kinds["Characters"], "reference");
        assert_eq!(draft.character_candidates.len(), 2);
        assert_eq!(draft.character_candidates[0].name, "Ada Finch");
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
        let (sections, character_candidates) = derive_sections(&paragraphs, &chapter_titles);
        Ok(Draft {
            format,
            source_name,
            paragraphs,
            sections,
            character_candidates,
            chapter_titles,
        })
    }
}

fn normalized_heading(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn is_character_heading(value: &str) -> bool {
    matches!(
        normalized_heading(value).as_str(),
        "characters" | "character list" | "cast" | "cast of characters" | "dramatis personae"
    )
}

fn is_reference_heading(value: &str) -> bool {
    is_character_heading(value)
        || matches!(
            normalized_heading(value).as_str(),
            "table of contents"
                | "contents"
                | "glossary"
                | "pronunciation guide"
                | "acknowledgements"
                | "acknowledgments"
                | "about the author"
                | "reading group guide"
                | "discussion questions"
                | "family tree"
                | "maps"
        )
}

fn is_opening_heading(value: &str) -> bool {
    matches!(
        normalized_heading(value).as_str(),
        "cover" | "opening pages" | "front matter"
    )
}

fn is_narrative_marker(value: &str) -> bool {
    let value = normalized_heading(value);
    value.starts_with("chapter ")
        || value.starts_with("part ")
        || value.starts_with("book ")
        || matches!(value.as_str(), "prologue" | "epilogue" | "afterword")
}

fn looks_like_name(value: &str) -> bool {
    let words = value.split_whitespace().collect::<Vec<_>>();
    !words.is_empty()
        && words.len() <= 6
        && value.chars().count() <= 80
        && value.chars().all(|character| {
            character.is_alphabetic()
                || character.is_whitespace()
                || matches!(character, '\'' | '-' | '’')
        })
}

fn character_line(value: &str) -> Option<(String, String)> {
    let value = value.trim().trim_matches(['•', '-', '–', '—', '*', ' ']);
    if value.is_empty() || value.chars().count() > 240 {
        return None;
    }
    let split = [" — ", " – ", " - ", ": "]
        .iter()
        .find_map(|separator| value.split_once(*separator));
    let (name, description) = split
        .map(|(name, description)| (name.trim(), description.trim()))
        .unwrap_or((value, ""));
    looks_like_name(name).then(|| (name.to_string(), description.to_string()))
}

fn derive_sections(
    paragraphs: &[Paragraph],
    chapter_titles: &[String],
) -> (Vec<DraftSection>, Vec<CharacterCandidate>) {
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    let mut positions = HashMap::<String, usize>::new();
    // Heading-only Word paragraphs must remain visible to review. In
    // particular, a `Characters` heading can be followed by one heading per
    // character and no body text of its own.
    for title in chapter_titles {
        positions.entry(title.clone()).or_insert_with(|| {
            groups.push((title.clone(), Vec::new()));
            groups.len() - 1
        });
    }
    for (index, paragraph) in paragraphs.iter().enumerate() {
        let position = positions
            .entry(paragraph.chapter.clone())
            .or_insert_with(|| {
                groups.push((paragraph.chapter.clone(), Vec::new()));
                groups.len() - 1
            });
        groups[*position].1.push(index);
    }

    let mut sections = Vec::new();
    let mut candidates = Vec::new();
    let mut candidate_names = HashSet::new();
    let mut character_list_active = false;
    for (section_index, (title, paragraph_indexes)) in groups.into_iter().enumerate() {
        let id = format!("section-{:04}", section_index + 1);
        let characters_heading = is_character_heading(&title);
        let reference_heading = is_reference_heading(&title);
        let narrative_marker = is_narrative_marker(&title);
        let content_kind = if is_opening_heading(&title) {
            "opening"
        } else if reference_heading || (character_list_active && !narrative_marker) {
            "reference"
        } else {
            "narration"
        };
        if narrative_marker {
            character_list_active = false;
        }
        if characters_heading {
            character_list_active = true;
        }

        if characters_heading {
            for paragraph_index in &paragraph_indexes {
                for item in paragraphs[*paragraph_index].text.split(';') {
                    if let Some((name, description)) = character_line(item) {
                        let key = name.to_ascii_lowercase();
                        if candidate_names.insert(key) {
                            candidates.push(CharacterCandidate {
                                id: format!("candidate-{}-{:03}", id, candidates.len() + 1),
                                name,
                                description,
                                source_section_id: id.clone(),
                            });
                        }
                    }
                }
            }
        } else if character_list_active && content_kind == "reference" && looks_like_name(&title) {
            let key = title.to_ascii_lowercase();
            if candidate_names.insert(key) {
                let description = paragraph_indexes
                    .first()
                    .map(|index| paragraphs[*index].text.clone())
                    .unwrap_or_default();
                candidates.push(CharacterCandidate {
                    id: format!("candidate-{}-{:03}", id, candidates.len() + 1),
                    name: title.clone(),
                    description,
                    source_section_id: id.clone(),
                });
            }
        }

        sections.push(DraftSection {
            id,
            title,
            content_kind: content_kind.to_string(),
            paragraph_count: paragraph_indexes.len(),
        });
    }
    (sections, candidates)
}

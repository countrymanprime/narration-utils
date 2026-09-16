//! Reusable manuscript-source parsers.
//!
//! The command-line binary remains supported for manual use and for older
//! callers.  Keeping the parser here lets the Tauri host import DOCX and
//! Markdown in-process once the server cutover is complete.

pub mod docx;
pub mod markdown;
pub mod model;
pub mod pdf;

use std::path::Path;

use model::{Draft, ManuscriptError};

/// Select the parser from a source path, using the same extension contract as
/// the standalone `manuscript-import` command.
pub fn build_draft(path: &Path, markdown_heading_level: u8) -> Result<Draft, ManuscriptError> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    match extension.as_str() {
        "docx" => docx::build_draft(path),
        "md" | "markdown" => markdown::build_draft(path, markdown_heading_level),
        "pdf" => pdf::build_draft(path),
        _ => Err(ManuscriptError(
            "Choose a Word (.docx), Markdown (.md), or text-based PDF (.pdf) manuscript."
                .to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::build_draft;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../test-fixtures")
            .join(name)
    }

    #[test]
    fn parses_the_markdown_fixture_with_the_three_narrative_chapters() {
        let draft = build_draft(&fixture("alice.md"), 1).expect("fixture should parse");
        assert_eq!(draft.format, "markdown");
        // The fixture has a book-title heading followed by its first three
        // chapter headings.  The import contract keeps that title heading;
        // the important regression guard is that all three real chapters
        // remain separate and ordered.
        assert_eq!(draft.chapter_titles.len(), 4);
        assert!(draft.chapter_titles[1].starts_with("Chapter I:"));
        assert!(draft.chapter_titles[3].starts_with("Chapter III:"));
        assert!(!draft.paragraphs.is_empty());
    }

    #[test]
    fn parses_the_word_fixture_with_the_three_narrative_chapters() {
        let draft = build_draft(&fixture("alice.docx"), 1).expect("fixture should parse");
        assert_eq!(draft.format, "docx");
        assert_eq!(draft.chapter_titles.len(), 4);
        assert!(draft.chapter_titles[1].starts_with("Chapter I:"));
        assert!(draft.chapter_titles[3].starts_with("Chapter III:"));
        assert!(!draft.paragraphs.is_empty());
    }
}

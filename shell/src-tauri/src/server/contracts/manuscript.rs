use std::collections::BTreeMap;

use serde::Deserialize;

fn default_heading_level() -> u8 {
    1
}

#[derive(Deserialize)]
pub(crate) struct ImportPreviewRequest {
    #[serde(rename = "markdownHeadingLevel", default = "default_heading_level")]
    pub(crate) markdown_heading_level: u8,
}

#[derive(Deserialize, Default)]
pub(crate) struct ImportSelection {
    #[serde(rename = "sectionKinds", default)]
    pub(crate) section_kinds: BTreeMap<String, String>,
    #[serde(rename = "characterCandidateIds", default)]
    pub(crate) character_candidate_ids: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct ImportCommitRequest {
    #[serde(rename = "confirmedReset", default)]
    pub(crate) confirmed_reset: bool,
    #[serde(default)]
    pub(crate) selection: ImportSelection,
}

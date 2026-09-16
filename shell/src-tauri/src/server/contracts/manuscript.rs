use serde::Deserialize;

fn default_heading_level() -> u8 {
    1
}

#[derive(Deserialize)]
pub(crate) struct ImportPreviewRequest {
    #[serde(rename = "markdownHeadingLevel", default = "default_heading_level")]
    pub(crate) markdown_heading_level: u8,
}

#[derive(Deserialize)]
pub(crate) struct ImportCommitRequest {
    #[serde(rename = "confirmedReset", default)]
    pub(crate) confirmed_reset: bool,
}

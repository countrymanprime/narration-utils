#[derive(Clone, Copy)]
pub struct FieldSchema {
    pub key: &'static str,
    pub label: &'static str,
    pub kind: &'static str,
    pub choices: &'static [&'static str],
}

pub const FIELD_SCHEMAS: &[(&str, &[FieldSchema])] = &[
    (
        "General",
        &[FieldSchema {
            key: "log_verbosity",
            label: "Log verbosity",
            kind: "choice",
            choices: &["quiet", "normal", "verbose"],
        }],
    ),
    (
        "Manuscript",
        &[FieldSchema {
            key: "color_note",
            label: "Note color",
            kind: "color",
            choices: &[],
        }],
    ),
    (
        "ManuscriptGuide",
        &[
            FieldSchema {
                key: "spacy_model",
                label: "spaCy model",
                kind: "choice",
                choices: &["en_core_web_sm", "en_core_web_lg"],
            },
            FieldSchema {
                key: "espeak_library",
                label: "eSpeak NG DLL",
                kind: "text",
                choices: &[],
            },
        ],
    ),
    (
        "Piper",
        &[
            FieldSchema {
                key: "tts_provider",
                label: "TTS provider",
                kind: "choice",
                choices: &["piper"],
            },
            FieldSchema {
                key: "tts_voice_id",
                label: "Preview voice",
                kind: "choice",
                choices: &["en_US-ljspeech-high"],
            },
        ],
    ),
    (
        "TranscriptCompare",
        &[
            FieldSchema {
                key: "model_size",
                label: "Default Whisper model",
                kind: "choice",
                choices: &["tiny", "small", "medium", "large-v3-turbo", "large-v3"],
            },
            FieldSchema {
                key: "chunk_seconds",
                label: "Default chunk length",
                kind: "choice",
                choices: &["30", "60", "300", "600"],
            },
            FieldSchema {
                key: "color_misread",
                label: "Misread marker color",
                kind: "color",
                choices: &[],
            },
            FieldSchema {
                key: "color_skipped",
                label: "Skipped marker color",
                kind: "color",
                choices: &[],
            },
            FieldSchema {
                key: "color_extra",
                label: "Extra marker color",
                kind: "color",
                choices: &[],
            },
        ],
    ),
];

pub fn schemas_for(tool: &str) -> Option<&'static [FieldSchema]> {
    FIELD_SCHEMAS
        .iter()
        .find_map(|(name, schemas)| (*name == tool).then_some(*schemas))
}

pub fn is_valid_hex(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

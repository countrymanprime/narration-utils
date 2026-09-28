package continuity

import (
	"encoding/json"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
)

// Cue is one dialogue cue from the Manuscript Guide (Phase 2, ADR 0345): a
// quoted span and the character it is attributed to. SpeakerID is empty
// when the guide left the speaker unknown.
type Cue struct {
	ID            string
	ChapterID     string
	ParagraphID   string
	QuoteStart    int
	QuoteEnd      int
	QuoteText     string
	SpeakerID     string
	SpeakerSource string
	Excerpt       string
	Corrected     bool
}

// guideCue is a cue as manuscript_guide.py writes it.
type guideCue struct {
	ID            string  `json:"id"`
	ChapterID     string  `json:"chapterId"`
	ParagraphID   string  `json:"paragraphId"`
	QuoteStart    int     `json:"quote_start"`
	QuoteEnd      int     `json:"quote_end"`
	QuoteText     string  `json:"quote_text"`
	SpeakerID     *string `json:"speaker_entity_id"`
	SpeakerSource string  `json:"speaker_source"`
	Evidence      struct {
		Excerpt string `json:"excerpt"`
	} `json:"evidence"`
	Corrected bool `json:"corrected"`
}

// DecodeGuideCues reads the dialogue_cues of a Manuscript Guide JSON
// document. A guide without cues (built before Phase 2) has none.
func DecodeGuideCues(raw []byte) ([]Cue, error) {
	var guide struct {
		DialogueCues []guideCue `json:"dialogue_cues"`
	}
	if err := json.Unmarshal(raw, &guide); err != nil {
		return nil, fmt.Errorf("the manuscript guide's dialogue cues could not be read: %w", err)
	}
	cues := make([]Cue, 0, len(guide.DialogueCues))
	for _, c := range guide.DialogueCues {
		speaker := ""
		if c.SpeakerID != nil {
			speaker = *c.SpeakerID
		}
		cues = append(cues, Cue{
			ID: c.ID, ChapterID: c.ChapterID, ParagraphID: c.ParagraphID,
			QuoteStart: c.QuoteStart, QuoteEnd: c.QuoteEnd, QuoteText: c.QuoteText,
			SpeakerID: speaker, SpeakerSource: c.SpeakerSource, Excerpt: c.Evidence.Excerpt, Corrected: c.Corrected,
		})
	}
	return cues, nil
}

// SkipReason says why a cue produced no comparison.
type SkipReason string

const (
	SkipUnknownSpeaker        SkipReason = "unknown_speaker"
	SkipNoAlignment           SkipReason = "no_alignment"
	SkipTooShort              SkipReason = "too_short"
	SkipNoAudio               SkipReason = "no_audio"
	SkipNoMeasurablePitch     SkipReason = "no_measurable_pitch"
	SkipInsufficientReference SkipReason = "insufficient_reference"
)

// MinCandidateSeconds is the shortest located line that is compared: a
// line shorter than this gives the pitch tracker too few frames for a
// stable median. Provisional, like the rest of the Q6 calibration.
const MinCandidateSeconds = 0.5

// SkippedCue is a cue that produced no comparison, and why.
type SkippedCue struct {
	CueID       string     `json:"cue_id"`
	ChapterID   string     `json:"chapter_id"`
	CharacterID string     `json:"character_id,omitempty"`
	Reason      SkipReason `json:"reason"`
	Detail      string     `json:"detail,omitempty"`
}

// Candidate is a cue located in the recorded audio.
type Candidate struct {
	Cue       Cue
	Alignment Alignment
}

// Locate keeps the cues that can be compared: attributed to a character
// and reliably aligned to a long enough stretch of audio. Everything else is
// skipped with its reason, never guessed at: a line with no reliable
// alignment yields no candidate (PRD "Locating candidate audio"). A cue
// attributed to narration is not a character line, so it is skipped as
// unknown too.
func Locate(cues []Cue, aligner CueAligner) ([]Candidate, []SkippedCue, error) {
	var candidates []Candidate
	var skipped []SkippedCue
	for _, cue := range cues {
		skip := func(reason SkipReason, detail string) {
			skipped = append(skipped, SkippedCue{CueID: cue.ID, ChapterID: cue.ChapterID, CharacterID: cue.SpeakerID, Reason: reason, Detail: detail})
		}
		if cue.SpeakerID == "" || cue.SpeakerID == character.NarrationCharacterID {
			skip(SkipUnknownSpeaker, "the manuscript does not say who speaks this line")
			continue
		}
		alignment, err := aligner.Align(cue)
		if err != nil {
			return nil, nil, fmt.Errorf("could not locate line %s in the recording: %w", cue.ID, err)
		}
		if !alignment.Reliable {
			skip(SkipNoAlignment, alignment.Reason)
			continue
		}
		if alignment.Clip.Range.LengthSeconds < MinCandidateSeconds {
			skip(SkipTooShort, fmt.Sprintf("the line lasts %.2f s; at least %.1f s is compared", alignment.Clip.Range.LengthSeconds, MinCandidateSeconds))
			continue
		}
		candidates = append(candidates, Candidate{Cue: cue, Alignment: alignment})
	}
	return candidates, skipped, nil
}

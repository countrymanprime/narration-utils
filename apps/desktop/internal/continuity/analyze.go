package continuity

import (
	"errors"
	"fmt"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// Config is what Analyze needs: the four roles and the outlier rule.
type Config struct {
	References     ReferenceSource
	ReferenceAudio ReferenceAudio
	Aligner        CueAligner
	Measurer       ClipMeasurer
	Rule           Rule
	Project        findings.Project
}

func (c Config) validate() error {
	switch {
	case c.References == nil:
		return errors.New("character continuity needs the approved references")
	case c.ReferenceAudio == nil:
		return errors.New("character continuity needs a way to find a reference's audio")
	case c.Aligner == nil:
		return errors.New("character continuity needs aligned words to locate dialogue lines")
	case c.Measurer == nil:
		return errors.New("character continuity needs an audio measurer")
	}
	return c.Rule.Validate()
}

// ExclusionReason says why an approved reference is not in any baseline.
type ExclusionReason string

const (
	ExcludedChangedSinceApproval ExclusionReason = "changed_since_approval"
	ExcludedNoAudio              ExclusionReason = "no_audio"
	ExcludedNoMeasurablePitch    ExclusionReason = "no_measurable_pitch"
)

// ExcludedReference is an approved reference left out of its baseline.
type ExcludedReference struct {
	ReferenceID string          `json:"reference_id"`
	CharacterID string          `json:"character_id"`
	Reason      ExclusionReason `json:"reason"`
	Detail      string          `json:"detail,omitempty"`
}

// SubjectStatus says whether a character (or narration) has a baseline.
// An unavailable subject raises no flag: "insufficient reference" is shown
// as unavailable evidence, never as a low-confidence guess (Q6).
type SubjectStatus struct {
	CharacterID        string `json:"character_id"`
	UsableReferences   int    `json:"usable_references"`
	RequiredReferences int    `json:"required_references"`
	Available          bool   `json:"available"`
	Reason             string `json:"reason,omitempty"`
}

// Comparison is one located line measured against its character's
// baseline, flagged or not.
type Comparison struct {
	CueID       string  `json:"cue_id"`
	CharacterID string  `json:"character_id"`
	Distance    float64 `json:"distance"`
	Threshold   float64 `json:"threshold"`
	Outlier     bool    `json:"outlier"`
	ChainDiffer bool    `json:"chain_differs"`
}

// Result is one analysis run: the findings, and everything a narrator
// needs to see about what was not compared and why.
type Result struct {
	Findings []findings.Finding  `json:"findings"`
	Compared []Comparison        `json:"compared"`
	Skipped  []SkippedCue        `json:"skipped"`
	Excluded []ExcludedReference `json:"excluded"`
	Subjects []SubjectStatus     `json:"subjects"`
	// Chapters are the chapters whose cues this run covered: a full run
	// for each, so Save replaces each one's stored findings.
	Chapters []string `json:"chapters"`
	Rule     Rule     `json:"rule"`
}

// Subject returns characterID's status.
func (r Result) Subject(characterID string) (SubjectStatus, bool) {
	for _, subject := range r.Subjects {
		if subject.CharacterID == characterID {
			return subject, true
		}
	}
	return SubjectStatus{}, false
}

// subject is one character's (or narration's) usable references.
type subject struct {
	samples      []Sample
	measurements []Measurement
	baseline     *Baseline
	status       SubjectStatus
}

// Analyze compares each of cues' located lines against its character's
// baseline, built only from approved references whose regions are
// unchanged since approval.
func Analyze(config Config, cues []Cue) (Result, error) {
	if err := config.validate(); err != nil {
		return Result{}, err
	}
	result := Result{Rule: config.Rule}
	subjects, order, err := collectReferences(config, &result)
	if err != nil {
		return Result{}, err
	}

	var vectors [][]float64
	for _, id := range order {
		for _, sample := range subjects[id].samples {
			vectors = append(vectors, sample.Vector)
		}
	}
	scale := NewScale(vectors)
	for _, id := range order {
		s := subjects[id]
		s.status = SubjectStatus{CharacterID: id, UsableReferences: len(s.samples), RequiredReferences: config.Rule.MinReferences}
		baseline, err := BuildBaseline(id, s.samples, scale, config.Rule)
		switch {
		case errors.Is(err, ErrInsufficientReference):
			s.status.Reason = err.Error()
		case err != nil:
			return Result{}, err
		default:
			s.baseline = &baseline
			s.status.Available = true
		}
	}

	candidates, skipped, err := Locate(cues, config.Aligner)
	if err != nil {
		return Result{}, err
	}
	result.Skipped = skipped
	result.Chapters = chaptersOf(cues)

	narration := subjects[character.NarrationCharacterID]
	for _, candidate := range candidates {
		speaker := candidate.Cue.SpeakerID
		s, ok := subjects[speaker]
		if !ok {
			s = &subject{status: SubjectStatus{
				CharacterID: speaker, RequiredReferences: config.Rule.MinReferences,
				Reason: fmt.Sprintf("%s: 0 of the %d approved clips needed", ErrInsufficientReference, config.Rule.MinReferences),
			}}
			subjects[speaker] = s
			order = append(order, speaker)
		}
		skip := func(reason SkipReason, detail string) {
			result.Skipped = append(result.Skipped, SkippedCue{CueID: candidate.Cue.ID, ChapterID: candidate.Cue.ChapterID, CharacterID: speaker, Reason: reason, Detail: detail})
		}
		if s.baseline == nil {
			skip(SkipInsufficientReference, s.status.Reason)
			continue
		}
		measurement, err := config.Measurer.Measure(candidate.Alignment.Clip)
		if err != nil {
			skip(SkipNoAudio, err.Error())
			continue
		}
		vector, ok := Vector(measurement.Features)
		if !ok {
			skip(SkipNoMeasurablePitch, "no stretch of the line gave a confident pitch reading")
			continue
		}
		distance := s.baseline.Distance(scale, vector)
		chain := CheckChain(measurement, s.measurements)
		comparison := Comparison{
			CueID: candidate.Cue.ID, CharacterID: speaker, Distance: distance, Threshold: s.baseline.Threshold,
			Outlier: distance > s.baseline.Threshold, ChainDiffer: chain.Differs,
		}
		result.Compared = append(result.Compared, comparison)
		if !comparison.Outlier {
			continue
		}
		in := findingInput{
			project: config.Project, candidate: candidate, measurement: measurement, vector: vector,
			baseline: *s.baseline, scale: scale, distance: distance, chain: chain, rule: config.Rule,
			narration: narrationEvidence(narration, speaker, scale, vector),
		}
		result.Findings = append(result.Findings, newFinding(in))
	}
	for _, id := range order {
		result.Subjects = append(result.Subjects, subjects[id].status)
	}
	return result, nil
}

// collectReferences measures every approved, unchanged reference, grouped
// by character in first-seen order. A reference that cannot be measured is
// excluded with its reason rather than guessed at.
func collectReferences(config Config, result *Result) (map[string]*subject, []string, error) {
	references, err := config.References.References()
	if err != nil {
		return nil, nil, fmt.Errorf("could not read the approved voice references: %w", err)
	}
	subjects := map[string]*subject{}
	var order []string
	for _, reference := range references {
		id := reference.CharacterID
		if _, ok := subjects[id]; !ok {
			subjects[id] = &subject{}
			order = append(order, id)
		}
		exclude := func(reason ExclusionReason, detail string) {
			result.Excluded = append(result.Excluded, ExcludedReference{ReferenceID: reference.ID, CharacterID: id, Reason: reason, Detail: detail})
		}
		if reference.ChangedSinceApproval {
			exclude(ExcludedChangedSinceApproval, "the region was moved, renamed or deleted since it was approved; approve it again to use it")
			continue
		}
		clip, err := config.ReferenceAudio.Resolve(reference.Reference)
		if err != nil {
			exclude(ExcludedNoAudio, err.Error())
			continue
		}
		measurement, err := config.Measurer.Measure(clip)
		if err != nil {
			exclude(ExcludedNoAudio, err.Error())
			continue
		}
		vector, ok := Vector(measurement.Features)
		if !ok {
			exclude(ExcludedNoMeasurablePitch, "no stretch of the region gave a confident pitch reading")
			continue
		}
		s := subjects[id]
		s.samples = append(s.samples, Sample{ReferenceID: reference.ID, Vector: vector})
		s.measurements = append(s.measurements, measurement)
	}
	return subjects, order, nil
}

// narrationEvidence is the candidate's distance to the narration baseline
// (Q9 option A), or why there is none.
func narrationEvidence(narration *subject, speaker string, scale Scale, vector []float64) NarrationEvidence {
	switch {
	case speaker == character.NarrationCharacterID:
		return NarrationEvidence{Reason: "the line is compared with the narration reference itself"}
	case narration == nil:
		return NarrationEvidence{Reason: "no clip is approved as a narration reference"}
	case narration.baseline == nil:
		return NarrationEvidence{Reason: "narration reference: " + narration.status.Reason}
	}
	distance := narration.baseline.Distance(scale, vector)
	return NarrationEvidence{
		Available: true, Distance: round(distance), Threshold: round(narration.baseline.Threshold),
		ReferenceIDs: slices.Clone(narration.baseline.ReferenceIDs), ReferenceCount: len(narration.baseline.ReferenceIDs),
		WithinNarrationReference: distance <= narration.baseline.Threshold,
	}
}

func chaptersOf(cues []Cue) []string {
	var chapters []string
	for _, cue := range cues {
		if !slices.Contains(chapters, cue.ChapterID) {
			chapters = append(chapters, cue.ChapterID)
		}
	}
	return chapters
}

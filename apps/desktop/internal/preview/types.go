// Package preview is the proofing-preview-suggestion PRD's pure window
// engine (Phase 1): up to three ranked five-minute candidates from the
// imported manuscript, each a run of whole consecutive paragraphs within
// one chapter, scored on deterministic, explainable text features -
// boundary quality, a narration-and-dialogue mix, entity variety, hard-word
// density and position. It has no I/O and no clock: a later phase's host
// binding supplies the chapters, paragraphs and settings as plain values,
// read from the manuscript and guide services.
package preview

// ContentKind mirrors the manuscript's own chapter content kinds
// (apps/ui/src/api/contracts/manuscript.ts). A chapter imported before
// structural classification has no kind at all; Q4's D22 default treats a
// missing kind as narration and says so in the candidate's evidence.
type ContentKind string

const (
	ContentNarration ContentKind = "narration"
	ContentOpening   ContentKind = "opening"
	ContentReference ContentKind = "reference"
)

// Chapter is one manuscript chapter, as much as the window engine needs of
// it. Order is the chapter's position in the book (0-based), used for the
// ending-exclusion setting (Q4) and as this package's own tie-break key
// (Success Metrics: "ties broken by chapter then paragraph index").
type Chapter struct {
	ID          string
	Title       string
	ContentKind ContentKind
	Order       int
}

// Paragraph is one paragraph of one chapter. Index is the paragraph's
// 0-based position within its own chapter (not the whole book), the
// engine's other tie-break key. EntityIDs are the Story Bible entities the
// paragraph mentions.
type Paragraph struct {
	ID        string
	ChapterID string
	Index     int
	Text      string
	EntityIDs []string
}

// Preset selects the two weight sets Q1 asks for: Sample favours a clean,
// varied, shareable excerpt; SpotCheck favours a passage worth a second
// look. Phase 1 is text-only, so the two presets score identically until a
// later phase's audio evidence exists to actually pull them apart; the
// weights are already separate constants (presetWeights) so that phase
// changes no ranking logic here.
type Preset string

const (
	PresetSample    Preset = "sample"
	PresetSpotCheck Preset = "spot_check"
)

// WordsPerFinishedHour is the app's existing fixed pace estimate
// (apps/ui/src/state.ts's WORDS_PER_FINISHED_HOUR), reused here so this
// engine's length model agrees with Home's own "Est. proof time" (Q2
// option A: assumption, calibrate once real durations exist).
const WordsPerFinishedHour = 9300

// Settings are the narrator's target length, tolerance, preset and
// optional ending exclusion (SR D10: settings, no shipped default beyond
// what's stated here). DefaultSettings gives Q1/Q2's own stated defaults.
type Settings struct {
	TargetSeconds float64
	// ToleranceFraction is how far a candidate's estimated length may sit
	// from TargetSeconds and still count as "on target" (a fraction of
	// TargetSeconds, e.g. 0.1 for +/-10%).
	ToleranceFraction float64
	Preset            Preset
	// ExcludeEndingFraction, when above 0, drops the last this-much share of
	// the book's chapters (by Order) from eligibility, so a candidate never
	// spoils the ending (Q4, off by default).
	ExcludeEndingFraction float64
}

// DefaultSettings is 5:00 target, 10% tolerance, the Sample preset, ending
// exclusion off (Q1, Q2, Q4's own stated defaults).
func DefaultSettings() Settings {
	return Settings{TargetSeconds: 300, ToleranceFraction: 0.1, Preset: PresetSample}
}

// Input is everything Suggest reads. HardWords is optional (nil is "none
// known"): the lower-cased words a caller (a later phase, from the guide's
// vocabulary candidates) considers hard; every occurrence in a window's text
// counts toward its hard-word density feature.
type Input struct {
	Chapters   []Chapter
	Paragraphs []Paragraph
	HardWords  map[string]bool
	Settings   Settings
}

// Outcome names a manuscript-wide state with no ranked candidates to show,
// distinct from a normal empty Candidates list (never conflated with it: an
// empty list with OutcomeOK would read as "nothing eligible" for the wrong
// reason).
type Outcome string

const (
	// OutcomeOK: at least one candidate exists; Result.Candidates holds it or them.
	OutcomeOK Outcome = "ok"
	// OutcomeNoManuscript: no chapters at all.
	OutcomeNoManuscript Outcome = "no_manuscript"
	// OutcomeNothingEligible: chapters exist, but none is eligible content
	// (Q4) or none has a single paragraph.
	OutcomeNothingEligible Outcome = "nothing_eligible"
)

// Candidate is one suggested window: a contiguous run of whole paragraphs
// inside exactly one chapter (Q3), never crossing a chapter boundary.
type Candidate struct {
	ChapterID        string
	ChapterTitle     string
	ParagraphIDs     []string
	WordCount        int
	EstimatedSeconds float64
	// Shorter is true when even this chapter's every eligible paragraph
	// together falls short of the target's lower tolerance bound: the
	// candidate is the whole chapter, honestly labelled rather than padded
	// or hidden (Success Metrics: "a named state").
	Shorter  bool
	Reasons  []string
	Warnings []string

	// features holds this candidate's raw, unrounded scoring inputs, computed once when the candidate was built,
	// so score() never re-reads paragraph text and a caller outside this package never sees a raw, unexplained
	// number (SR's own "no single readiness score" stance, apps/desktop/internal/stages - a candidate's Reasons are
	// the explanation; this field is ranking machinery only).
	features candidateFeatures
}

// candidateFeatures are one candidate's named, explainable text features (Phase 1's own scope: "explainable text
// features; per-candidate reasons and warnings").
type candidateFeatures struct {
	// dialogueShare is the fraction of the window's paragraphs the quote heuristic (Q5) reads as dialogue; a value
	// inside a preferred band scores best (a monologue and an all-dialogue transcript both score lower).
	dialogueShare float64
	// distinctEntities is the count of distinct Story Bible entities mentioned across the window.
	distinctEntities int
	// hardWordDensity is hard words found over total words (0 when HardWords is nil: no evidence either way).
	hardWordDensity float64
}

// Result is Suggest's answer: either a manuscript-wide Outcome with no
// candidates, or OutcomeOK with up to three, one per chapter (Q12), ranked
// highest score first, ties broken by chapter Order then the window's first
// paragraph Index.
type Result struct {
	Outcome    Outcome
	Candidates []Candidate
}

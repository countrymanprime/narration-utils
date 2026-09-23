package stages

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Verdict is the engine's answer for one chapter.
type Verdict string

const (
	// VerdictRecommended means every required signal is met: suggest the
	// target stage, which the narrator confirms.
	VerdictRecommended Verdict = "recommended"
	// VerdictNotReady means at least one required signal is not_met. It
	// outranks unknown: neither may recommend, and the concrete reason is the
	// more useful one to show.
	VerdictNotReady Verdict = "not_ready"
	// VerdictUnknown means no required signal is not_met but at least one is
	// unknown. Never treated as met (D2).
	VerdictUnknown Verdict = "unknown"
	// VerdictDismissed means the verdict would be recommended, but the
	// narrator dismissed this exact basis; it returns when the basis changes
	// (Q7).
	VerdictDismissed Verdict = "dismissed"
	// VerdictNone means the chapter is not evaluated; NoneReason says why.
	VerdictNone Verdict = "none"
)

// NoneReason says why an assessment's verdict is none.
type NoneReason string

const (
	// NoneStageNotEvaluated: the chapter's status is not_started, finalized
	// or a value the engine does not know (Q4).
	NoneStageNotEvaluated NoneReason = "stage_not_evaluated"
	// NoneNoRequiredSignals: the stage's required set is empty, which never
	// recommends (Q8).
	NoneNoRequiredSignals NoneReason = "no_required_signals"
)

// ChapterContext identifies the chapter being evaluated. Status is its
// stored chapter status, which is its current stage.
type ChapterContext struct {
	DocumentID string
	ChapterID  string
	Title      string
	Status     Stage
}

// Input is everything the engine reads. Required is the set of signal ids
// that must be met to advance from Chapter.Status; Signals are what the
// providers reported (extra signals are ignored); DismissedBasisKeys are the
// basis keys the narrator dismissed for this chapter and target.
type Input struct {
	Chapter            ChapterContext
	Required           []string
	Signals            []Signal
	DismissedBasisKeys []string
}

// Assessment is the engine's result for one chapter. Signals holds one entry
// per required signal, sorted by id, with every missing, invalid or
// duplicated signal replaced by an unknown provider_error one. Causes lists
// the distinct causes of the unknown signals, sorted. BasisKey is empty only
// for a none verdict.
type Assessment struct {
	ChapterID  string         `json:"chapterId"`
	From       Stage          `json:"from"`
	Target     Stage          `json:"target,omitempty"`
	Verdict    Verdict        `json:"verdict"`
	NoneReason NoneReason     `json:"noneReason,omitempty"`
	Signals    []Signal       `json:"signals"`
	Causes     []UnknownCause `json:"causes"`
	BasisKey   string         `json:"basisKey,omitempty"`
}

// Evaluate applies the verdict rules to one chapter. It is pure: the same
// input gives the same assessment, it reads no file or clock, and it does not
// modify its input.
func Evaluate(in Input) Assessment {
	chapter := in.Chapter
	target, evaluated := chapter.Status.Next()
	if !evaluated {
		return noneAssessment(chapter, "", NoneStageNotEvaluated)
	}
	required := distinctSorted(in.Required)
	if len(required) == 0 {
		return noneAssessment(chapter, target, NoneNoRequiredSignals)
	}

	signals := requiredSignals(chapter.Status, required, in.Signals)
	verdict := verdictOf(signals)
	key := BasisKey(chapter.ChapterID, target, signals)
	if verdict == VerdictRecommended && slices.Contains(in.DismissedBasisKeys, key) {
		verdict = VerdictDismissed
	}
	return Assessment{
		ChapterID: chapter.ChapterID,
		From:      chapter.Status,
		Target:    target,
		Verdict:   verdict,
		Signals:   signals,
		Causes:    causesOf(signals),
		BasisKey:  key,
	}
}

func noneAssessment(chapter ChapterContext, target Stage, reason NoneReason) Assessment {
	return Assessment{
		ChapterID:  chapter.ChapterID,
		From:       chapter.Status,
		Target:     target,
		Verdict:    VerdictNone,
		NoneReason: reason,
		Signals:    []Signal{},
		Causes:     []UnknownCause{},
	}
}

// requiredSignals picks, for each required id in order, the one reported
// signal with that id, and replaces it with an unknown provider_error signal
// when it is missing, fails Validate, belongs to another stage, or was
// reported more than once (which answer to trust would be a guess).
func requiredSignals(stage Stage, required []string, reported []Signal) []Signal {
	byID := map[string][]Signal{}
	for _, signal := range reported {
		byID[signal.ID] = append(byID[signal.ID], signal)
	}
	signals := make([]Signal, 0, len(required))
	for _, id := range required {
		signals = append(signals, pickSignal(stage, id, byID[id]))
	}
	return signals
}

func pickSignal(stage Stage, id string, candidates []Signal) Signal {
	switch {
	case len(candidates) == 0:
		return UnknownSignal(id, stage, CauseProviderError, fmt.Sprintf("required signal %s was not reported", id))
	case len(candidates) > 1:
		return UnknownSignal(id, stage, CauseProviderError, fmt.Sprintf("required signal %s was reported %d times", id, len(candidates)))
	}
	signal := candidates[0]
	if err := signal.Validate(); err != nil {
		return UnknownSignal(id, stage, CauseProviderError, "invalid signal: "+err.Error())
	}
	// Validate ties a signal's id prefix to its own Stage, so this fires only
	// when the required set itself names another stage's id (bad settings
	// data). Keep it: such a signal must not satisfy this stage.
	if signal.Stage != stage {
		return UnknownSignal(id, stage, CauseProviderError, fmt.Sprintf("signal %s judges stage %s, not %s", id, signal.Stage, stage))
	}
	return signal
}

func verdictOf(signals []Signal) Verdict {
	verdict := VerdictRecommended
	for _, signal := range signals {
		switch signal.State {
		case SignalNotMet:
			return VerdictNotReady
		case SignalUnknown:
			verdict = VerdictUnknown
		}
	}
	return verdict
}

func causesOf(signals []Signal) []UnknownCause {
	causes := []UnknownCause{}
	for _, signal := range signals {
		if signal.State == SignalUnknown && !slices.Contains(causes, signal.Cause) {
			causes = append(causes, signal.Cause)
		}
	}
	slices.Sort(causes)
	return causes
}

// basisEntry is the part of a signal the basis key covers. ComputedAt, the
// project file's modified time, the reason and the evidence are left out, so
// a re-save or a reworded reason with identical fingerprints keeps a
// dismissal alive.
type basisEntry struct {
	ID              string      `json:"id"`
	State           SignalState `json:"state"`
	LedgerRecordIDs []string    `json:"ledgerRecordIds"`
	Fingerprint     string      `json:"fingerprint"`
}

type basisDocument struct {
	ChapterID string       `json:"chapterId"`
	Target    Stage        `json:"target"`
	Signals   []basisEntry `json:"signals"`
}

// BasisKey is the hex SHA-256 identifying what a verdict was based on: the
// chapter, the target stage, and each signal's id, state, ledger record ids
// and fingerprint, all sorted. The UI sends back the key it displayed so
// Confirm and Dismiss can refuse when the evidence changed in between.
func BasisKey(chapterID string, target Stage, signals []Signal) string {
	entries := make([]basisEntry, 0, len(signals))
	for _, signal := range signals {
		entries = append(entries, basisEntry{
			ID:              signal.ID,
			State:           signal.State,
			LedgerRecordIDs: distinctSorted(signal.Basis.LedgerRecordIDs),
			Fingerprint:     signal.Basis.Fingerprint,
		})
	}
	slices.SortFunc(entries, func(a, b basisEntry) int { return strings.Compare(a.ID, b.ID) })
	// JSON quotes and delimits every field, so adjacent values cannot run
	// together; encoding plain strings and slices cannot fail.
	encoded, _ := json.Marshal(basisDocument{ChapterID: chapterID, Target: target, Signals: entries})
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

// distinctSorted returns a sorted copy of values without duplicates, never
// nil and never aliasing values.
func distinctSorted(values []string) []string {
	out := slices.Clone(values)
	if out == nil {
		out = []string{}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

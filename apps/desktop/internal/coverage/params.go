package coverage

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	// AnalyzerID and AnalyzerVersion name coverage runs in the analysis ledger.
	// Raise the version when the sidecar's measurement changes meaning, so every
	// older record reads as stale (evidence.ReasonAnalyzerChanged).
	AnalyzerID      = "recording-coverage"
	AnalyzerVersion = "1"
	// wordsAnalyzerID and wordsVersion name the per-source words entries in the
	// analysis evidence cache. The version is the sidecar's words file schema.
	wordsAnalyzerID = "recording-coverage-words"
	wordsVersion    = "1"
	// vadFilter records that the sidecar always transcribes with Whisper's voice
	// activity filter (coverage_mode.WhisperTranscriber); it shapes the words.
	vadFilter = "vad=1"
)

// AlignmentParams are the two settings that change which words count as read
// (PRD Q3; the sidecar's --max-misread-run and --min-anchor-run). They are in
// the record's parameter hash, so changing one makes a result stale (Q13 B).
type AlignmentParams struct {
	MaxMisreadRun int `json:"maxMisreadRun"`
	MinAnchorRun  int `json:"minAnchorRun"`
}

// DefaultAlignmentParams are the shipped defaults (ADR 0132): calibrated on the
// synthetic fixtures only, so still Proposed and uncalibrated on real narration
// (Q15). They are the values the sidecar uses when no flag is given.
var DefaultAlignmentParams = AlignmentParams{MaxMisreadRun: 8, MinAnchorRun: 3}

func (p AlignmentParams) validate() error {
	if p.MaxMisreadRun < 0 || p.MinAnchorRun < 1 {
		return unknownf(ReasonInvalidParams, "alignment parameters must be a misread run of 0 or more and an anchor run of 1 or more (got %d and %d)", p.MaxMisreadRun, p.MinAnchorRun)
	}
	return nil
}

// Transcription is how the words are made: the Whisper model (the narrator's
// Transcript Compare model_size, Q7), its verified directory, and a forced
// language ("" means auto-detect). Model and language are kept OUT of the
// record's parameter hash (Q13 A: a record made with another model is still
// current, labeled with the model) but IN the words cache key, so a run with a
// new model transcribes again instead of reusing another model's words.
type Transcription struct {
	Model    string
	ModelDir string
	Language string
}

// projectInputs are the project files that shape a run besides the settings:
// the word equivalences (they change which words match, so they are in the
// record's parameter hash) and the vocabulary hints (Whisper hotwords, which
// shape the words: in both hashes). Both are read from the saved project's
// TranscriptCompare folder, where the sidecar reads them too.
type projectInputs struct {
	EquivalencesHash string
	HotwordsHash     string
}

func readProjectInputs(project string) projectInputs {
	folder := filepath.Join(project, "TranscriptCompare")
	inputs := projectInputs{}
	if bytes, err := os.ReadFile(filepath.Join(folder, "equivalences.csv")); err == nil {
		inputs.EquivalencesHash = digest(string(bytes))
	}
	if bytes, err := os.ReadFile(filepath.Join(folder, "vocabulary_hints.txt")); err == nil {
		if hints := strings.TrimSpace(string(bytes)); hints != "" {
			inputs.HotwordsHash = digest(hints)
		}
	}
	return inputs
}

// paramHash is the record's parameter hash, the value evidence.EvaluateFingerprints
// compares: the alignment parameters and everything that shapes the words or
// the match except the model and the language (Q13).
func paramHash(params AlignmentParams, inputs projectInputs) string {
	return hashParts("coverage-params", AnalyzerVersion,
		strconv.Itoa(params.MaxMisreadRun), strconv.Itoa(params.MinAnchorRun),
		inputs.EquivalencesHash, inputs.HotwordsHash, wordsVersion, vadFilter)
}

// wordsParamHash is the words cache entry's parameter hash: everything that
// shapes a transcript of the same audio, the model and language included.
func wordsParamHash(transcription Transcription, inputs projectInputs) string {
	return hashParts("coverage-words", wordsVersion, transcription.Model, transcription.Language, inputs.HotwordsHash, vadFilter)
}

func digest(text string) string {
	sum := sha256.Sum256([]byte(text))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// hashParts hashes length-prefixed parts, so ("ab","c") and ("a","bc") differ
// (the same encoding evidence and findings use).
func hashParts(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(part), part)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

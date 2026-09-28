package teleprompter

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
)

// Punch and roll's offline word-time alignment (teleprompter-manuscript-integration.prd.md Phase 12, ADR 0560, owner
// decision 2026-09-23: live anchors first, offline alignment as the fallback). When no anchor brackets a flagged word
// (anchors.go), the host runs the sidecar's `--align-word` mode (align_word.py) once over a stretch of the chapter's
// recorded audio: the tail-audio locate's own decode and placement (locate.go, ADR 0111) pointed at one word, which
// answers when that word starts in the recording's source file. Mapping that onto the project timeline is the
// caller's (apps/desktop), which knows the item the stretch was cut from.

// AlignRequest is one word to time: script word Word of Recording.Chapter, looked for in seconds Recording.From to
// Recording.To of Recording.Audio. Every rule a LocateRequest has applies to Recording (threat model row 4a).
type AlignRequest struct {
	Recording LocateRequest
	Word      int
}

// WordTime is the sidecar's `word_time` line (align_word.py). Time is seconds into the source file, nil when the word
// is not in the stretch; Exact is whether the word itself was heard rather than placed between two neighbours that were.
type WordTime struct {
	Word    int      `json:"word"`
	Time    *float64 `json:"time"`
	Exact   bool     `json:"exact"`
	Matched int      `json:"matched"`
	Heard   int      `json:"heard"`
	Tokens  int      `json:"tokens"`
}

// alignWordArgs is the sidecar's `--align-word` command line (live_asr.py, align_word.check_args).
func (s *Service) alignWordArgs(manuscript string, request AlignRequest) []string {
	return s.recordingArgs([]string{"--align-word", strconv.Itoa(request.Word)}, manuscript, request.Recording)
}

// AlignWord times one script word from the recording (align_word.py): one sidecar run, bounded by ctx, that never
// downloads a model and never touches a running session. A refused request, a sidecar failure, a timeout and output
// without a `word_time` line are errors; a word the stretch does not hold is not (Time is nil).
func (s *Service) AlignWord(ctx context.Context, request AlignRequest) (WordTime, error) {
	if request.Word < 0 {
		return WordTime{}, errors.New("choose a word of the chapter to time")
	}
	code, out, stderr, err := s.runOverRecording(ctx, request.Recording, func(manuscript string) []string { return s.alignWordArgs(manuscript, request) })
	if err != nil {
		return WordTime{}, err
	}
	if ctx.Err() != nil {
		return WordTime{}, errors.New("timing the word in the recording took too long")
	}
	if code != 0 {
		return WordTime{}, errors.New(failureMessage(code, stderr, "Could not time the word in the recording"))
	}
	return parseWordTime(out, request)
}

// parseWordTime finds the one `word_time` line among the sidecar's stdout lines (a library may print other lines).
func parseWordTime(out string, request AlignRequest) (WordTime, error) {
	scanner := bufio.NewScanner(strings.NewReader(out))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := []byte(strings.TrimSpace(scanner.Text()))
		if kind, ok := isEvent(line); !ok || kind != "word_time" {
			continue
		}
		var timed WordTime
		if err := json.Unmarshal(line, &timed); err != nil {
			return WordTime{}, errors.New("the teleprompter sidecar returned an unreadable word time")
		}
		if err := timed.check(request); err != nil {
			return WordTime{}, err
		}
		return timed, nil
	}
	return WordTime{}, errors.New("the teleprompter sidecar did not report when the word was read")
}

// wordTimeSlack is how far past the stretch's ends a word time may fall and still be the stretch's own: the audio cut
// is to the sample, and the sidecar rounds times to the millisecond.
const wordTimeSlack = 0.01

// check refuses a `word_time` line that is not about the word asked for, or whose time is outside the stretch that was
// decoded, so a punch is never moved by a time the recording could not have given.
func (timed WordTime) check(request AlignRequest) error {
	if timed.Word != request.Word || timed.Tokens < 0 || timed.Matched < 0 || timed.Heard < 0 {
		return errors.New("the teleprompter sidecar returned an inconsistent word time")
	}
	if timed.Time == nil {
		if timed.Exact {
			return errors.New("the teleprompter sidecar returned an inconsistent word time")
		}
		return nil
	}
	value := *timed.Time
	if math.IsNaN(value) || math.IsInf(value, 0) || value < request.Recording.From-wordTimeSlack || value > request.Recording.To+wordTimeSlack || timed.Word >= timed.Tokens {
		return errors.New("the teleprompter sidecar returned a word time outside the recording")
	}
	return nil
}

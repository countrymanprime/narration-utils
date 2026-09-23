package teleprompter

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultTailSeconds is how much of a recording's end the locate transcribes (teleprompter-manuscript-integration PRD
// Phase 9, ADR 0111): about seventy words of narration, enough to place the tail in a chapter and to tell a passage the
// chapter repeats from the one the narrator stopped in, and a few seconds of CPU decode with the tiny model.
const DefaultTailSeconds = 30.0

// MaxTailSeconds mirrors the sidecar's own limit (locate.py MAX_TAIL_SECONDS): a longer range is refused here, before
// any process starts.
const MaxTailSeconds = 120.0

// LocateRequest is one tail to place: seconds From to To of the source file Audio, in the manuscript chapter Chapter
// (an id), transcribed by the Whisper model installed in ModelDir.
type LocateRequest struct {
	Chapter  string
	Audio    string
	From     float64
	To       float64
	Model    string
	ModelDir string
	Language string
}

// Sentence is the script sentence holding the last word the tail placed: token indices [Start, End) and its text.
type Sentence struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

// Located is the sidecar's `locate` line (locate.py). Word is the script word to resume from (the index space of a
// position event's `read`); it and Last are nil when the tail could not be placed.
type Located struct {
	Word       *int      `json:"word"`
	Last       *int      `json:"last"`
	Sentence   *Sentence `json:"sentence"`
	Confidence float64   `json:"confidence"`
	Confident  bool      `json:"confident"`
	Matched    int       `json:"matched"`
	Heard      int       `json:"heard"`
	RunnerUp   int       `json:"runnerUp"`
	Tokens     int       `json:"tokens"`
	HeardText  string    `json:"heardText"`
}

// validate refuses a request the sidecar should never see. Every value becomes an argument of the sidecar (threat
// model row 4a): the audio is an existing regular file named by an absolute path (so it can never read as an option),
// the range is finite, ordered and bounded, and the model directory is the catalog's absolute install path.
func (request LocateRequest) validate() error {
	if strings.TrimSpace(request.Chapter) == "" {
		return errors.New("choose a chapter to locate")
	}
	if !filepath.IsAbs(request.Audio) {
		return errors.New("the recording's source file must be an absolute path")
	}
	info, err := os.Stat(request.Audio)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("the recording's source file could not be found")
	}
	for _, value := range []float64{request.From, request.To} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return errors.New("the recorded range is not a number of seconds")
		}
	}
	if request.From < 0 || request.To <= request.From {
		return errors.New("the recorded range is empty")
	}
	if request.To-request.From > MaxTailSeconds {
		return fmt.Errorf("the recorded range is longer than %g seconds", MaxTailSeconds)
	}
	if !filepath.IsAbs(request.ModelDir) {
		return errors.New("install the Whisper model before locating")
	}
	return nil
}

func seconds(value float64) string { return strconv.FormatFloat(value, 'f', 3, 64) }

// locateArgs is the sidecar's `--locate` command line (live_asr.py, locate.check_args).
func (s *Service) locateArgs(manuscript string, request LocateRequest) []string {
	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = "tiny"
	}
	args := []string{
		"--locate", "--engine", "whisper", "--model", model, "--model-dir", request.ModelDir,
		"--manuscript", manuscript, "--chapter", request.Chapter,
		"--wav", request.Audio, "--tail-start", seconds(request.From), "--tail-end", seconds(request.To),
	}
	if language := strings.TrimSpace(request.Language); language != "" {
		args = append(args, "--language", language)
	}
	if s.config.Backend != "" {
		args = append([]string{s.config.Backend}, args...)
	}
	return args
}

// Locate transcribes the tail of a recording and places it in the chapter (locate.py): one sidecar run, bounded by
// ctx. It never downloads a model and never touches a running session. A refused request, a sidecar failure, a
// timeout and output without a `locate` line are all errors; a tail that cannot be placed is not (Word is nil).
func (s *Service) Locate(ctx context.Context, request LocateRequest) (Located, error) {
	s.mu.RLock()
	project, python, sidecars := s.config.Project, s.config.Python, s.sidecars
	s.mu.RUnlock()
	if project == "" {
		return Located{}, errors.New("save the REAPER project and import a manuscript first")
	}
	manuscript := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if _, err := os.Stat(manuscript); err != nil {
		return Located{}, errors.New("import a manuscript first")
	}
	if python == "" || sidecars == nil {
		return Located{}, errors.New("configure the teleprompter executable before continuing")
	}
	if err := request.validate(); err != nil {
		return Located{}, err
	}
	code, out, stderr, err := sidecars.Run(ctx, python, s.locateArgs(manuscript, request)...)
	if err != nil {
		return Located{}, err
	}
	if ctx.Err() != nil {
		return Located{}, errors.New("finding where the recording stops took too long")
	}
	if code != 0 {
		return Located{}, errors.New(failureMessage(code, stderr, "Could not find where the recording stops"))
	}
	return parseLocated(out)
}

// parseLocated finds the one `locate` line among the sidecar's stdout lines (a library may print other lines).
func parseLocated(out string) (Located, error) {
	scanner := bufio.NewScanner(strings.NewReader(out))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := []byte(strings.TrimSpace(scanner.Text()))
		if kind, ok := isEvent(line); !ok || kind != "locate" {
			continue
		}
		var located Located
		if err := json.Unmarshal(line, &located); err != nil {
			return Located{}, errors.New("the teleprompter sidecar returned an unreadable locate result")
		}
		if err := located.check(); err != nil {
			return Located{}, err
		}
		return located, nil
	}
	return Located{}, errors.New("the teleprompter sidecar did not report where the recording stops")
}

// check refuses a `locate` line whose parts disagree, so the UI is never handed a word outside the chapter.
func (located Located) check() error {
	if located.Tokens < 0 || located.Confidence < 0 || located.Confidence > 1 {
		return errors.New("the teleprompter sidecar returned an inconsistent locate result")
	}
	if (located.Word == nil) != (located.Last == nil) || (located.Word == nil && located.Sentence != nil) {
		return errors.New("the teleprompter sidecar returned an inconsistent locate result")
	}
	if located.Word != nil && (*located.Word < 0 || *located.Word > located.Tokens || *located.Last < 0 || *located.Last >= located.Tokens) {
		return errors.New("the teleprompter sidecar returned a word outside the chapter")
	}
	if sentence := located.Sentence; sentence != nil && (sentence.Start < 0 || sentence.End > located.Tokens || sentence.Start >= sentence.End) {
		return errors.New("the teleprompter sidecar returned a sentence outside the chapter")
	}
	return nil
}

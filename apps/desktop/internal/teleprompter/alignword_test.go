package teleprompter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// runFakeAligner stands in for the sidecar's `--align-word` mode (align_word.py): one `word_time` line, then exit. In
// the ok mode the line's word is the one asked for and its heard count the number of arguments, and the arguments are
// echoed on a line of their own, so a test can check the command line the host built.
func runFakeAligner(mode string) bool {
	if len(os.Args) < 3 || os.Args[1] != "--align-word" {
		return false
	}
	switch mode {
	case "align-crash":
		fmt.Fprintln(os.Stderr, "live_asr.py: error: --align-word needs --model-dir: it never downloads a model")
		os.Exit(2)
	case "align-silent":
		fmt.Println("a library printed this")
	case "align-outside":
		fmt.Printf(`{"type":"word_time","word":%s,"time":12.5,"exact":true,"matched":30,"heard":32,"tokens":900}`+"\n", os.Args[2])
	case "align-missing":
		fmt.Printf(`{"type":"word_time","word":%s,"time":null,"exact":false,"matched":0,"heard":0,"tokens":900}`+"\n", os.Args[2])
	case "align-hang":
		time.Sleep(time.Minute)
	default:
		args, _ := json.Marshal(os.Args[1:])
		fmt.Printf(`{"type":"args","args":%s}`+"\n", args)
		fmt.Printf(`{"type":"word_time","word":%s,"time":820.125,"exact":true,"matched":30,"heard":32,"tokens":900}`+"\n", os.Args[2])
	}
	return true
}

func (f locateFixture) alignRequest(word int) AlignRequest {
	return AlignRequest{Recording: f.request(), Word: word}
}

func TestAlignWordRunsTheSidecarOnceAndReturnsItsWordTime(t *testing.T) {
	f := newLocateFixture(t, "align-ok")

	timed, err := f.service.AlignWord(context.Background(), f.alignRequest(412))

	if err != nil {
		t.Fatal(err)
	}
	if timed.Word != 412 || timed.Time == nil || *timed.Time != 820.125 || !timed.Exact || timed.Tokens != 900 {
		t.Fatalf("timed = %+v", timed)
	}
}

func TestAlignWordPassesTheWordAndTheLocatesOwnRecordingArguments(t *testing.T) {
	f := newLocateFixture(t, "align-ok")

	args := strings.Join(f.service.alignWordArgs("m.json", f.alignRequest(412)), " ")

	want := strings.Join([]string{
		"--align-word", "412", "--engine", "whisper", "--model", "tiny", "--model-dir", filepath.Join(f.project, "models", "tiny"),
		"--manuscript", "m.json", "--chapter", "c1", "--wav", f.audio, "--tail-start", "812.400", "--tail-end", "842.400", "--language", "en",
	}, " ")
	if args != want {
		t.Fatalf("sidecar arguments =\n%s\nwant\n%s", args, want)
	}
	f.service.config.Backend = "live_asr.py"
	if args := f.service.alignWordArgs("m.json", f.alignRequest(412)); args[0] != "live_asr.py" || args[1] != "--align-word" {
		t.Fatalf("a developer run's arguments = %v", args)
	}
}

func TestAlignWordRefusesARequestTheSidecarShouldNeverSee(t *testing.T) {
	f := newLocateFixture(t, "align-hang")
	for name, request := range map[string]AlignRequest{
		"a negative word":       {Recording: f.request(), Word: -1},
		"a relative audio path": {Recording: LocateRequest{Chapter: "c1", Audio: "--stop-file", From: 1, To: 2, ModelDir: f.project}, Word: 3},
		"a range too long":      {Recording: LocateRequest{Chapter: "c1", Audio: f.audio, From: 0, To: MaxTailSeconds + 1, ModelDir: f.project}, Word: 3},
		"no model directory":    {Recording: LocateRequest{Chapter: "c1", Audio: f.audio, From: 1, To: 2}, Word: 3},
	} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := f.service.AlignWord(ctx, request); err == nil || strings.Contains(err.Error(), "too long") {
				t.Fatalf("err = %v: the refused request reached the (hanging) sidecar", err)
			}
		})
	}
}

func TestAlignWordAnswersAWordTheStretchDoesNotHoldWithNoTime(t *testing.T) {
	f := newLocateFixture(t, "align-missing")

	timed, err := f.service.AlignWord(context.Background(), f.alignRequest(412))

	if err != nil || timed.Time != nil {
		t.Fatalf("timed = %+v, err = %v", timed, err)
	}
}

func TestAlignWordFailures(t *testing.T) {
	for mode, want := range map[string]string{
		"align-crash":   "needs --model-dir",
		"align-silent":  "did not report",
		"align-outside": "outside the recording",
	} {
		t.Run(mode, func(t *testing.T) {
			f := newLocateFixture(t, mode)
			if _, err := f.service.AlignWord(context.Background(), f.alignRequest(412)); err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("err = %v, want %q", err, want)
			}
		})
	}
}

func TestAlignWordHonoursTheCallersDeadline(t *testing.T) {
	f := newLocateFixture(t, "align-hang")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	if _, err := f.service.AlignWord(ctx, f.alignRequest(412)); err == nil || !strings.Contains(err.Error(), "too long") {
		t.Fatalf("err = %v", err)
	}
}

func TestParseWordTimeRefusesInconsistentLines(t *testing.T) {
	request := AlignRequest{Recording: LocateRequest{From: 700, To: 820}, Word: 27}
	for name, line := range map[string]string{
		"another word":            `{"type":"word_time","word":28,"time":706.5,"exact":true,"matched":30,"heard":31,"tokens":59}`,
		"before the stretch":      `{"type":"word_time","word":27,"time":699.5,"exact":true,"matched":30,"heard":31,"tokens":59}`,
		"after the stretch":       `{"type":"word_time","word":27,"time":820.5,"exact":true,"matched":30,"heard":31,"tokens":59}`,
		"a word past the chapter": `{"type":"word_time","word":27,"time":706.5,"exact":true,"matched":30,"heard":31,"tokens":20}`,
		"exact with no time":      `{"type":"word_time","word":27,"time":null,"exact":true,"matched":30,"heard":31,"tokens":59}`,
		"negative counts":         `{"type":"word_time","word":27,"time":null,"exact":false,"matched":-1,"heard":31,"tokens":59}`,
		"not json after the type": `{"type":"word_time","word":"twenty-seven"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseWordTime(line, request); err == nil {
				t.Fatal("expected the line to be refused")
			}
		})
	}
}

// The sidecar's own `word_time` lines, pinned by its Python contract test (teleprompter-word-time.json), parse here:
// the two halves of the boundary read the same file.
func TestContractTheSidecarsWordTimeLinesParse(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "teleprompter-word-time.json"))
	if err != nil {
		t.Fatalf("the sidecar's word-time file is missing (run the Python contract test with UPDATE_CONTRACTS=1): %v", err)
	}
	var lines []json.RawMessage
	if err := json.Unmarshal(raw, &lines); err != nil || len(lines) != 2 {
		t.Fatalf("lines = %d, err = %v", len(lines), err)
	}
	request := AlignRequest{Recording: LocateRequest{From: 700, To: 820}, Word: 27}
	line := func(raw json.RawMessage) string { // the sidecar prints each on one line
		var compact bytes.Buffer
		if err := json.Compact(&compact, raw); err != nil {
			t.Fatal(err)
		}
		return compact.String()
	}
	timed, err := parseWordTime(line(lines[0]), request)
	if err != nil || timed.Time == nil || *timed.Time != 706.5 || !timed.Exact {
		t.Fatalf("heard line = %+v, err = %v", timed, err)
	}
	missing, err := parseWordTime(line(lines[1]), request)
	if err != nil || missing.Time != nil {
		t.Fatalf("missing line = %+v, err = %v", missing, err)
	}
}

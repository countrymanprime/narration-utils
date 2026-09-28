//go:build audacitylive && windows

// The owner's verification pass, Part A (docs/operations/audacity-verification-pass.md, ADR 0355): it drives a real Audacity over
// its scripting pipe, unattended, against a scratch project, and writes a results file to paste into #510. It is behind the
// audacitylive build tag and NU_AUDACITY_PASS=1, so no ordinary test run, and no CI job, ever touches an Audacity.
//
//	go test -tags audacitylive -run TestAudacityVerificationPass -v -count=1 ./internal/dawport/audacity/
package audacity

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

type passStep struct {
	id, name, result, detail string
}

type passRun struct {
	steps []passStep
}

func (r *passRun) record(id, name string, err error, detail string) bool {
	result := "PASS"
	if err != nil {
		result = "FAIL"
		detail = strings.TrimSpace(detail + " " + err.Error())
	}
	r.steps = append(r.steps, passStep{id, name, result, detail})
	return err == nil
}

func (r *passRun) write(path string, started time.Time) error {
	var b strings.Builder
	fmt.Fprintf(&b, "## Audacity verification pass, Part A (%s)\n\n", started.Format("2006-01-02 15:04 MST"))
	fmt.Fprintf(&b, "- Audacity version (Help > About Audacity): %s\n", os.Getenv("NU_AUDACITY_VERSION"))
	fmt.Fprintf(&b, "- Windows: %s\n\n", os.Getenv("OS"))
	b.WriteString("| Step | What | Result | Detail |\n| --- | --- | --- | --- |\n")
	for _, s := range r.steps {
		fmt.Fprintf(&b, "| %s | %s | %s | %s |\n", s.id, s.name, s.result, strings.ReplaceAll(s.detail, "|", "\\|"))
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}

// writeTone writes seconds of a 440 Hz mono 16-bit tone at 44.1 kHz, so the pass has audio without touching the narrator's.
func writeTone(path string, seconds float64) error {
	const rate = 44100
	n := int(seconds * rate)
	data := make([]byte, 44+2*n)
	copy(data[0:], "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(36+2*n))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], rate)
	binary.LittleEndian.PutUint32(data[28:], rate*2)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(2*n))
	for i := range n {
		v := int16(8000 * math.Sin(2*math.Pi*440*float64(i)/rate))
		binary.LittleEndian.PutUint16(data[44+2*i:], uint16(v))
	}
	return os.WriteFile(path, data, 0o600)
}

func TestAudacityVerificationPass(t *testing.T) {
	if os.Getenv("NU_AUDACITY_PASS") != "1" {
		t.Skip("set NU_AUDACITY_PASS=1 and open a new, empty Audacity project (docs/operations/audacity-verification-pass.md)")
	}
	folder := os.Getenv("NU_AUDACITY_PASS_DIR")
	if folder == "" || !filepath.IsAbs(folder) {
		t.Fatal("set NU_AUDACITY_PASS_DIR to an absolute scratch folder")
	}
	out := filepath.Join(folder, "audacity-pass-results.md")
	started := time.Now()
	run := &passRun{}
	defer func() {
		if err := run.write(out, started); err != nil {
			t.Errorf("writing %s: %v", out, err)
		}
		t.Logf("results: %s", out)
		for _, s := range run.steps {
			t.Logf("%s %-4s %s: %s", s.id, s.result, s.name, s.detail)
			if s.result == "FAIL" {
				t.Fail()
			}
		}
	}()
	ctx := context.Background()
	client := audacitybridge.New(audacitybridge.PipeTransport(), audacitybridge.Options{})
	defer func() { _ = client.Close() }()
	session := NewSession(client)

	// A1: the pipe is there and in step.
	if !run.record("A1", "Ping (Message echo): the pipe is reachable", client.Ping(ctx), "") {
		run.record("A1b", "Stopped: nothing below can run without the pipe", fmt.Errorf("not reachable"), "On Audacity 4.0 this is expected: it has no scripting pipe (ADR 0355).")
		return
	}
	// A2: round-trip time.
	var times []time.Duration
	var pingErr error
	for range 20 {
		t0 := time.Now()
		if pingErr = client.Ping(ctx); pingErr != nil {
			break
		}
		times = append(times, time.Since(t0))
	}
	detail := ""
	if len(times) > 0 {
		slices.Sort(times)
		detail = fmt.Sprintf("20 pings: median %v, max %v", times[len(times)/2], times[len(times)-1])
	}
	run.record("A2", "Round-trip time", pingErr, detail)

	// A3: an empty project, as the pass needs.
	info, err := session.Project(ctx)
	if run.record("A3", "GetInfo Tracks and Labels parse", err, fmt.Sprintf("%d tracks, %d labels", len(info.Tracks), info.Labels)) && (len(info.Tracks) > 0 || info.Labels > 0) {
		run.record("A3b", "Stopped: the open project is not empty", fmt.Errorf("refusing to change it"), "Open File > New and run the pass again.")
		return
	}
	// A4: import a generated tone, so there is audio.
	tone := filepath.Join(folder, "pass-tone.wav")
	err = writeTone(tone, 12)
	if err == nil {
		err = client.Import(ctx, tone)
	}
	clips, cerr := client.Clips(ctx)
	if err == nil && cerr == nil && len(clips) != 1 {
		err = fmt.Errorf("want 1 clip after the import, got %d", len(clips))
	}
	run.record("A4", "Import2 a 12 s tone; GetInfo Clips sees it", err, fmt.Sprintf("%+v", clips))

	// A5: the hardest text the client accepts comes back unchanged.
	hard := "[nu:pass-0] Zoë’s ‘line’ — “quoted” ∖ café 100% & <ok> {x} 'single' =equals= é"
	res, err := session.ImportFindings(ctx, []Finding{{ID: "pass-0", Start: 1, End: 1, Words: strings.TrimPrefix(hard, "[nu:pass-0] ")}})
	found, ferr := session.FindingLabels(ctx)
	if err == nil {
		err = ferr
	}
	if err == nil && (len(found) != 1 || found[0].Label.Text != hard) {
		err = fmt.Errorf("read back %q, want %q", labelTexts(found), hard)
	}
	run.record("A5", "Label text round trip (escaping)", err, fmt.Sprintf("added %v", res.Added))

	// A6: import three findings, then again: nothing added the second time, all on the Narration Utils track.
	findings := []Finding{
		{ID: "pass-1", Start: 2, End: 2.5, Words: "misread: their for there"},
		{ID: "pass-2", Start: 5, End: 5, Words: "skipped: very"},
		{ID: "pass-3", Start: 8.25, End: 9, Words: "extra: um"},
	}
	first, err := session.ImportFindings(ctx, findings)
	if err == nil && len(first.Added) != 3 {
		err = fmt.Errorf("first import added %v", first.Added)
	}
	second, err2 := session.ImportFindings(ctx, findings)
	if err == nil {
		err = err2
	}
	if err == nil && (len(second.Added) != 0 || len(second.Skipped) != 3) {
		err = fmt.Errorf("second import added %v, skipped %v", second.Added, second.Skipped)
	}
	tracks, terr := client.Tracks(ctx)
	if err == nil {
		err = terr
	}
	labelTracks := 0
	for _, tr := range tracks {
		if tr.Kind == "label" {
			labelTracks++
			if tr.Name != LabelTrackName {
				err = fmt.Errorf("a label track is named %q, want %q", tr.Name, LabelTrackName)
			}
		}
	}
	if err == nil && labelTracks != 1 {
		err = fmt.Errorf("%d label tracks, want 1", labelTracks)
	}
	run.record("A6", "Import findings as labels, twice: idempotent, one Narration Utils track", err, fmt.Sprintf("first %+v, second %+v", first, second))

	// A7: mark one reviewed, in place.
	changed, err := session.MarkReviewed(ctx, "pass-2")
	after, ferr := session.FindingLabels(ctx)
	if err == nil {
		err = ferr
	}
	if err == nil && (!changed || len(after) != 4 || !reviewed(after, "pass-2") || reviewed(after, "pass-1")) {
		err = fmt.Errorf("changed=%v, labels %q", changed, labelTexts(after))
	}
	run.record("A7", "Mark reviewed rewrites the label in place", err, "")

	// A8: go to, navigate, loop, stop. Unattended, so this checks each command is accepted; Part B checks what Audacity shows.
	_, err = session.GoToFinding(ctx, "pass-3")
	run.record("A8", "Go to a finding's label (SelectTime)", err, "Part B: the selection is 8.25 to 9 s")
	_, err = session.Navigate(ctx, dawport.Target{SourceStart: ptr(3.0)})
	run.record("A9", "Navigate: cursor to 3 s", err, "")
	loop, err := session.Loop(ctx, dawport.Target{SourceStart: ptr(5.0), SourceEnd: ptr(5.5)})
	if err == nil {
		time.Sleep(2 * time.Second)
	}
	run.record("A10", "Loop 3 to 7.5 s (PlayAtSpeedLooped)", err, fmt.Sprintf("%+v; Part B: it loops at normal speed", loop))
	_, err = session.StopLoop(ctx)
	run.record("A11", "Stop", err, "")

	// A12: a marker, twice.
	m1, err := session.AddMarker(ctx, dawport.Target{SourceStart: ptr(10.0)}, dawport.Marker{Name: "pass marker"})
	m2, err2 := session.AddMarker(ctx, dawport.Target{SourceStart: ptr(10.0)}, dawport.Marker{Name: "pass marker"})
	if err == nil {
		err = err2
	}
	if err == nil && (!m1.Added || m2.Added) {
		err = fmt.Errorf("first added=%v, second added=%v", m1.Added, m2.Added)
	}
	run.record("A12", "Add a marker label twice: added once", err, "")

	// A13: export a chapter range and the reviewed labels.
	path, err := session.ExportChapter(ctx, folder, "pass chapter", 1, 6)
	if err == nil {
		err = waitForFile(path, 10*time.Second)
	}
	run.record("A13", "Export2 1 to 6 s to a new WAV", err, path)
	labelsPath, n, err := session.WriteReviewedLabels(ctx, folder)
	if err == nil && n != 1 {
		err = fmt.Errorf("%d reviewed labels, want 1", n)
	}
	run.record("A14", "Write the reviewed labels file", err, labelsPath)

	// A15: refusals never reach Audacity.
	err = client.Export(ctx, filepath.Join(folder, "x.CL"), 1)
	if err != nil && strings.Contains(err.Error(), audacitybridge.ErrInvalidValue.Error()) {
		err = nil
	} else if err == nil {
		err = fmt.Errorf("the .CL export was sent")
	}
	run.record("A15", "The external-program exporter (.CL) is refused before sending", err, "")
}

func ptr(v float64) *float64 { return &v }

func labelTexts(ls []FindingLabel) []string {
	var out []string
	for _, l := range ls {
		out = append(out, l.Label.Text)
	}
	return out
}

func reviewed(ls []FindingLabel, id string) bool {
	for _, l := range ls {
		if l.ID == id {
			return l.Reviewed
		}
	}
	return false
}

func waitForFile(path string, limit time.Duration) error {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if st, err := os.Stat(path); err == nil && st.Size() > 44 {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("%s did not appear with audio in it", path)
}

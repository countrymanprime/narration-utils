package coverage

import (
	"encoding/json"
	"os"
	"testing"
)

// creditsRequest is testRequest() for a credits row instead of the fixture manuscript chapter.
func creditsRequest(kind string) Request {
	return Request{ChapterID: CreditsChapterID(kind), Transcription: Transcription{Model: "small"}, Alignment: DefaultAlignmentParams}
}

func TestACreditsCheckRunsAgainstTheRenderedTemplateTextNotTheManuscript(t *testing.T) {
	p := newTestProject(t)
	p.setCredits("opening", "Opening credits", "Narrated by Alice Narrator.")
	p.confirm(testDocument, testTrack, CreditsChapterID("opening"))
	sidecar := &fakeSidecar{present: 10}
	// The run folder (and this stand-in manuscript with it) is removed as soon as the run finishes (run.go's
	// finish), so the file is read here, mid-run, before the sidecar writes its results and the job ends.
	var manuscriptPath string
	var raw []byte
	var readErr error
	sidecar.during = func() {
		manuscriptPath = sidecar.lastArgs()["--manuscript"]
		raw, readErr = os.ReadFile(manuscriptPath)
	}
	service := p.service(sidecar)

	state := run(t, service, creditsRequest("opening"))

	if state.Phase != PhaseComplete {
		t.Fatalf("state = %+v", state)
	}
	if args := sidecar.lastArgs(); args["--chapter-id"] != CreditsChapterID("opening") {
		t.Fatalf("chapter-id = %q", args["--chapter-id"])
	}
	if manuscriptPath == "" || manuscriptPath == p.dir {
		t.Fatalf("manuscript = %q", manuscriptPath)
	}
	if readErr != nil {
		t.Fatalf("the synthetic credits manuscript was not written: %v", readErr)
	}
	var decoded struct {
		DocumentID string `json:"documentId"`
		Chapters   []struct {
			ID          string `json:"id"`
			Title       string `json:"title"`
			ContentKind string `json:"contentKind"`
		} `json:"chapters"`
		Paragraphs []struct {
			ID        string `json:"id"`
			ChapterID string `json:"chapterId"`
			Text      string `json:"text"`
		} `json:"paragraphs"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("the synthetic credits manuscript did not decode: %v", err)
	}
	if decoded.DocumentID != testDocument || len(decoded.Chapters) != 1 || decoded.Chapters[0].ID != CreditsChapterID("opening") ||
		decoded.Chapters[0].Title != "Opening credits" || decoded.Chapters[0].ContentKind != "narration" {
		t.Fatalf("decoded chapters = %+v (documentId %q)", decoded.Chapters, decoded.DocumentID)
	}
	if len(decoded.Paragraphs) != 1 || decoded.Paragraphs[0].ChapterID != CreditsChapterID("opening") || decoded.Paragraphs[0].Text != "Narrated by Alice Narrator." {
		t.Fatalf("decoded paragraphs = %+v", decoded.Paragraphs)
	}

	// The run folder, and this stand-in manuscript file with it, are cleaned up once the run ends (run.go's finish).
	if _, err := os.Stat(manuscriptPath); !os.IsNotExist(err) {
		t.Fatalf("the synthetic credits manuscript was not removed: err = %v", err)
	}

	result, err := service.Result(CreditsChapterID("opening"), DefaultAlignmentParams)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Current() || result.Result.ManuscriptHash == "" {
		t.Fatalf("result = %+v", result)
	}
}

func TestACreditsTemplateChangeMarksAStoredResultStale(t *testing.T) {
	p := newTestProject(t)
	p.setCredits("closing", "Closing credits", "The end.")
	p.confirm(testDocument, testTrack, CreditsChapterID("closing"))
	service := p.service(&fakeSidecar{present: 10})
	run(t, service, creditsRequest("closing"))

	current, err := service.Result(CreditsChapterID("closing"), DefaultAlignmentParams)
	if err != nil {
		t.Fatal(err)
	}
	if !current.Current() {
		t.Fatalf("result = %+v", current)
	}

	p.setCredits("closing", "Closing credits", "The end. Thank you for listening.")
	stale, err := service.Result(CreditsChapterID("closing"), DefaultAlignmentParams)
	if err != nil {
		t.Fatal(err)
	}
	if stale.State != "stale" {
		t.Fatalf("state = %+v", stale.State)
	}
	found := false
	for _, reason := range stale.Reasons {
		if reason == string(ReasonCreditsChanged) {
			found = true
		}
		if reason == string(ReasonManuscriptChanged) {
			t.Fatalf("a credits result should report %q, not %q", ReasonCreditsChanged, ReasonManuscriptChanged)
		}
	}
	if !found {
		t.Fatalf("reasons = %v, want %q", stale.Reasons, ReasonCreditsChanged)
	}
}

func TestACreditsCheckIsRefusedWithoutATemplate(t *testing.T) {
	p := newTestProject(t)
	// No opening template was seeded (CT5): the row would show "Not set up" on Home.
	p.confirm(testDocument, testTrack, CreditsChapterID("opening"))
	service := p.service(&fakeSidecar{})

	_, err := service.Start(creditsRequest("opening"))
	reason, ok := ReasonOf(err)
	if !ok || reason != ReasonCreditsNotSetUp {
		t.Fatalf("err = %v", err)
	}
}

func TestACreditsCheckIsRefusedWhenNoLoaderIsConfigured(t *testing.T) {
	p := newTestProject(t)
	p.confirm(testDocument, testTrack, CreditsChapterID("opening"))
	service := New(Config{
		Project: p.dir, Python: "python-sidecar", Backend: "compare.py",
		ProjectFile: func() (string, error) { return p.rpp, nil }, LoadManuscript: p.loadManuscript,
	}, (&fakeSidecar{}).launcher(), nil)

	_, err := service.Start(creditsRequest("opening"))
	reason, ok := ReasonOf(err)
	if !ok || reason != ReasonCreditsNotSetUp {
		t.Fatalf("err = %v", err)
	}
}

func TestCreditsKindAndChapterID(t *testing.T) {
	if id := CreditsChapterID("opening"); id != "credits-opening" {
		t.Fatalf("id = %q", id)
	}
	for _, chapterID := range []string{"credits-opening", "credits-closing"} {
		if _, ok := CreditsKind(chapterID); !ok {
			t.Fatalf("%q should be a credits id", chapterID)
		}
	}
	for _, chapterID := range []string{"", "c-0001", "credits", "credits-middle"} {
		if kind, ok := CreditsKind(chapterID); ok {
			t.Fatalf("%q should not be a credits id (kind %q)", chapterID, kind)
		}
	}
}

func TestCreditsBasisHashChangesWithTitleOrText(t *testing.T) {
	a := creditsBasis(testDocument, "opening", "Opening credits", "Narrated by Alice.")
	b := creditsBasis(testDocument, "opening", "Opening credits", "Narrated by Bob.")
	c := creditsBasis(testDocument, "opening", "Opening Credits!", "Narrated by Alice.")
	if a.Hash == "" || a.Hash == b.Hash || a.Hash == c.Hash {
		t.Fatalf("hashes should differ: a=%q b=%q c=%q", a.Hash, b.Hash, c.Hash)
	}
	if a.DocumentID != testDocument || a.ChapterID != "credits-opening" || a.Title != "Opening credits" {
		t.Fatalf("basis = %+v", a)
	}
}

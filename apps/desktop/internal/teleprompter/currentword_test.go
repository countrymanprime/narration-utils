package teleprompter

import "testing"

// CurrentWord feeds the host's punch-anchor poll (teleprompter-manuscript-integration.prd.md Phase 12): it must say
// nothing while there is no word to anchor, so the poller never writes a bogus anchor.

func TestCurrentWordWhileListening(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a position event", func() bool { return f.recorder.firstEvent("position") != nil })
	chapter, word, ok := f.service.CurrentWord()
	if !ok || chapter != "c1" || word != 1 {
		t.Fatalf("CurrentWord = %q, %d, %v", chapter, word, ok)
	}
}

func TestCurrentWordBeforeAnySessionStarts(t *testing.T) {
	f := newFixture(t, "stream")
	if _, _, ok := f.service.CurrentWord(); ok {
		t.Fatal("resolved a word with no session running")
	}
}

func TestCurrentWordWhilePaused(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a position event", func() bool { return f.recorder.firstEvent("position") != nil })
	if err := f.service.Pause(true); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := f.service.CurrentWord(); ok {
		t.Fatal("resolved a word while paused")
	}
}

func TestCurrentWordExcludesAScriptCreditsSession(t *testing.T) {
	f := newFixture(t, "stream")
	script := Script{ID: "credits-open", Title: "Opening credits", Text: "Read by someone."}
	if err := f.service.StartScript(script, map[string]string{"device": "Microphone Array"}); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := f.service.CurrentWord(); ok {
		t.Fatal("resolved a word for a script/credits session, which has no manuscript chapter to anchor against")
	}
}

func TestCurrentWordAfterTheSessionStopsIsNothing(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a position event", func() bool { return f.recorder.firstEvent("position") != nil })
	f.service.Stop()
	waitFor(t, "stopped", func() bool { return phase(f.service) == "stopped" })
	if _, _, ok := f.service.CurrentWord(); ok {
		t.Fatal("resolved a word after the session stopped")
	}
}

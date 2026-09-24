package credits

import "testing"

func TestValidStatusAcceptsExactlyTheFiveChapterStatuses(t *testing.T) {
	for _, status := range []string{StatusNotStarted, StatusRecording, StatusEditing, StatusProofing, StatusFinalized} {
		if !ValidStatus(status) {
			t.Fatalf("ValidStatus(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"", "done", "Finalized", "not-started"} {
		if ValidStatus(status) {
			t.Fatalf("ValidStatus(%q) = true, want false", status)
		}
	}
}

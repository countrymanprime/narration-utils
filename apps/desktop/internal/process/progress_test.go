package process

import "testing"

func TestProgressLinesAreParsedAndAMalformedOneIsReportedNotZeroed(t *testing.T) {
	stage, percent, message, err := ParseProgress("EXTRACT|30|Finding people, places, and organizations...")
	if err != nil || stage != "EXTRACT" || percent != 30 || message != "Finding people, places, and organizations..." {
		t.Fatalf("got %q %v %q %v", stage, percent, message, err)
	}
	if _, percent, message, err := ParseProgress("LOAD|5"); err != nil || percent != 5 || message != "" {
		t.Fatalf("a line with no message: %v %q %v", percent, message, err)
	}
	if _, _, _, err := ParseProgress("LOAD|abc|Reading"); err == nil {
		t.Fatal("a percent that is not a number must be an error, not a silent 0")
	}
	if _, _, _, err := ParseProgress("just some text"); err == nil {
		t.Fatal("a line with no percent must be an error")
	}
	if _, _, _, err := ParseProgress("LOAD|140|Too far"); err == nil {
		t.Fatal("a percent over 100 must be an error")
	}
}

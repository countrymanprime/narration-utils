package repeats

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// TestToFindingsAcceptsNativeTakesTheSameAsReaperTakes is the native-recording-suite PRD Phase 3 contract test
// (Success: "the same analyzer test suite passes on a native take and an equivalent REAPER take"): ToFindings is
// the shared adapter every pickup/duplicate_read finding goes through (internal/takereview, "take review
// inputs"), and it must produce an equally valid finding whether a Member's identity came from a REAPER item/take
// GUID pair or, for a native take (recording.Take.Source), from a bare source file with no GUIDs at all.
func TestToFindingsAcceptsNativeTakesTheSameAsReaperTakes(t *testing.T) {
	project := findings.Project{Path: "P"}
	manuscript := findings.Manuscript{ChapterID: "c1"}

	reaper := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			{ItemGUID: "{A}", TakeGUID: "{T1}", SourceFile: "C:/Projects/Alice/audio/a.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.5},
			{ItemGUID: "{A}", TakeGUID: "{T2}", SourceFile: "C:/Projects/Alice/audio/b.wav", StartOffset: 0, Length: 4, Coverage: 0.4, Quality: 0.8},
		},
	}}
	native := []Group{{
		ID: 0, FirstUnit: 0, LastUnit: 3,
		Members: []Member{
			// Native takes have no REAPER item or take to give: ItemGUID and TakeGUID stay "", the same as
			// recording.Take.Source() leaves findings.Source.ItemGUID/TakeGUID for a native take.
			{SourceFile: "C:/Projects/Alice/Recordings/Take 001.wav", StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.5},
			{SourceFile: "C:/Projects/Alice/Recordings/Take 002.wav", StartOffset: 0, Length: 4, Coverage: 0.4, Quality: 0.8},
		},
	}}

	reaperOut := ToFindings(reaper, project, manuscript, DefaultThresholds())
	nativeOut := ToFindings(native, project, manuscript, DefaultThresholds())

	if len(reaperOut) != 1 || len(nativeOut) != 1 {
		t.Fatalf("want 1 finding each, got %d reaper, %d native", len(reaperOut), len(nativeOut))
	}
	rf, nf := reaperOut[0], nativeOut[0]

	if err := rf.Validate(); err != nil {
		t.Fatalf("the REAPER-sourced finding does not validate: %v", err)
	}
	if err := nf.Validate(); err != nil {
		t.Fatalf("the native-sourced finding does not validate: %v", err)
	}

	// Same shape apart from identity: category, severity and confidence come from Coverage/Quality alone, which
	// are equal between the two fixtures, so they must match exactly.
	if rf.Category != nf.Category || rf.Severity != nf.Severity {
		t.Fatalf("category/severity differ: reaper %v/%v, native %v/%v", rf.Category, rf.Severity, nf.Category, nf.Severity)
	}
	if *rf.Confidence != *nf.Confidence {
		t.Fatalf("confidence differs: reaper %v, native %v", *rf.Confidence, *nf.Confidence)
	}

	// The native finding's Source carries no synthetic stand-in for the REAPER-only GUIDs (docs/architecture/
	// findings-contract.md: "optional REAPER track, item, and take GUIDs") - they stay empty, exactly what
	// recording.Take.Source() already gives it.
	if nf.Source.ItemGUID != "" || nf.Source.TakeGUID != "" {
		t.Fatalf("native Source = %+v, want empty ItemGUID/TakeGUID", nf.Source)
	}
	if nf.Source.File == "" {
		t.Fatal("native Source.File is empty; the finding could not be navigated back to its audio at all")
	}
}

// TestNativeMembersWithoutGUIDsNeedSourceFileOrTakeIDToStayDistinct documents a real, narrow limit of today's
// identity keys (memberKey, evidenceVersion in adapter.go): they fold each member down to
// "ItemGUID:TakeGUID:offset:length" with no SourceFile. A REAPER item/take GUID pair is always unique per read,
// so this never collides there. A native take has no GUID at all (recording.Take.Source() leaves both empty), so
// two members that happen to share their offset and length - plausible for two short pickups both starting at
// 0s - fold to the *same* key despite coming from different take files. Nothing in this codebase constructs a
// Member with an empty GUID today (internal/takereview.buildManifest only ever reads a REAPER tracks.Project), so
// this is not yet reachable in production; it is recorded here, deliberately left unfixed, for whoever wires
// native takes into the take-review scan (phase 4, take review UI, explicitly out of this phase's scope) to
// settle - a per-member native take id (e.g. the take's own file name, which native-recording-suite's Q4/Q5 make
// stable and never reused) - before an ID-scheme change that would also reshape every *existing* REAPER-sourced
// take-review finding's id and evidence_version, and orphan its stored review decisions (findings-contract.md:
// "A decision survives ... a re-run with unchanged evidence"). That blast radius is why this phase documents the
// gap instead of closing it.
func TestNativeMembersWithoutGUIDsNeedSourceFileOrTakeIDToStayDistinct(t *testing.T) {
	project := findings.Project{Path: "P"}
	manuscript := findings.Manuscript{ChapterID: "c1"}
	memberAt := func(sourceFile string) Member {
		return Member{SourceFile: sourceFile, StartOffset: 0, Length: 4, Coverage: 1.0, Quality: 0.5}
	}
	groupOf := func(sourceFile string) []Group {
		return []Group{{ID: 0, FirstUnit: 0, LastUnit: 3, Members: []Member{memberAt(sourceFile), {SourceFile: sourceFile, StartOffset: 4, Length: 2, Coverage: 0.4, Quality: 0.8}}}}
	}

	takeOne := ToFindings(groupOf("C:/Projects/Alice/Recordings/Take 001.wav"), project, manuscript, DefaultThresholds())[0]
	takeFour := ToFindings(groupOf("C:/Projects/Alice/Recordings/Take 004.wav"), project, manuscript, DefaultThresholds())[0]

	// This pins today's actual behaviour, not the desired one: two groups built from different native take files
	// (everything else equal) still get the same id and evidence_version, because neither key looks at
	// SourceFile. If a future change adds per-member native identity to close this gap, this assertion starts
	// failing - that is the signal to update this test alongside it, not a regression to chase.
	if takeOne.ID != takeFour.ID {
		t.Fatalf("ids differ (%q vs %q); the documented gap is closed - update this test to match", takeOne.ID, takeFour.ID)
	}
	if takeOne.EvidenceVersion != takeFour.EvidenceVersion {
		t.Fatalf("evidence versions differ (%q vs %q); the documented gap is closed - update this test to match", takeOne.EvidenceVersion, takeFour.EvidenceVersion)
	}
}

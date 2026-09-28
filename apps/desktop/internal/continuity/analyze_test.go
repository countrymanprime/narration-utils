package continuity

import (
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func TestTheNarratorsNormalVoiceRaisesNoFlag(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.approve("bob", bobVoice, 5)
	f.line("cue-1", "alice", aliceVoice.jitter(3).measurement())
	f.line("cue-2", "bob", bobVoice.jitter(1).measurement())

	result := f.analyze(t)
	if len(result.Findings) != 0 {
		t.Fatalf("lines read in the approved voice raised %d findings: %+v", len(result.Findings), result.Findings)
	}
	if len(result.Compared) != 2 {
		t.Fatalf("Compared = %d lines, want 2", len(result.Compared))
	}
}

func TestALineOutsideTheReferenceDistributionIsFlaggedWithItsEvidence(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.approve("bob", bobVoice, 5)
	f.line("cue-drift", "alice", bobVoice.measurement())

	result := f.analyze(t)
	finding, ok := findingFor(t, result, "cue-drift")
	if !ok {
		t.Fatalf("a line read in another voice raised no finding: %+v", result)
	}
	if finding.Category != findings.CategoryCharacterContinuity || finding.Analyzer != AnalyzerName {
		t.Fatalf("category/analyzer = %s/%s", finding.Category, finding.Analyzer)
	}
	if finding.Severity != findings.SeverityWarning {
		t.Fatalf("Severity = %s, want warning (never error)", finding.Severity)
	}
	if finding.Confidence == nil || *finding.Confidence <= 0 || *finding.Confidence > 1 {
		t.Fatalf("Confidence = %v", finding.Confidence)
	}
	if !strings.Contains(finding.ConfidenceReason, "5 approved reference clips") {
		t.Fatalf("ConfidenceReason does not state the reference size: %q", finding.ConfidenceReason)
	}
	for _, banned := range []string{"out of character", "wrong", "bad", "emotion", "angry"} {
		if strings.Contains(strings.ToLower(finding.ConfidenceReason), banned) {
			t.Fatalf("ConfidenceReason uses judgement wording %q: %q", banned, finding.ConfidenceReason)
		}
	}
	evidence := finding.Evidence
	if evidence["character_id"] != "alice" || evidence["reference_count"] != 5 {
		t.Fatalf("evidence character/count = %v/%v", evidence["character_id"], evidence["reference_count"])
	}
	refs, _ := evidence["reference_ids"].([]string)
	if len(refs) != 5 || refs[0] != "ref-alice-0" {
		t.Fatalf("reference_ids = %v", evidence["reference_ids"])
	}
	distance, _ := evidence["distance"].(float64)
	threshold, _ := evidence["threshold"].(float64)
	if !(distance > threshold) {
		t.Fatalf("distance %v is not above threshold %v", distance, threshold)
	}
	table, _ := evidence["features"].([]FeatureEvidence)
	if len(table) != len(FeatureNames()) {
		t.Fatalf("feature table has %d rows, want %d", len(table), len(FeatureNames()))
	}
	f0 := table[0]
	if f0.Name != "f0_median_hz" || f0.Value != 115 || f0.ReferenceMin > f0.ReferenceMedian || f0.ReferenceMedian > f0.ReferenceMax || f0.SampleSize != 5 {
		t.Fatalf("f0 row = %+v", f0)
	}
	if finding.Source.File != "take-cue-drift.wav" || finding.TimeRange == nil || finding.TimeRange.Start != 100 {
		t.Fatalf("source/time range = %+v / %+v", finding.Source, finding.TimeRange)
	}
	if finding.Manuscript == nil || finding.Manuscript.ChapterID != "ch-01" || finding.Manuscript.Span == nil || finding.Manuscript.Span.ParagraphID != "p-cue-drift" {
		t.Fatalf("manuscript = %+v", finding.Manuscript)
	}
	if finding.SuggestedAction == nil || finding.SuggestedAction.Kind != SuggestedActionAudition || finding.SuggestedAction.RequiresConfirmation {
		t.Fatalf("suggested action = %+v, want a navigation-only audition", finding.SuggestedAction)
	}
	if finding.Review.Status != findings.StatusUnreviewed || finding.EvidenceVersion == "" {
		t.Fatalf("review/evidence version = %+v / %q", finding.Review, finding.EvidenceVersion)
	}
}

func TestAFindingShowsTheDistanceToTheNarrationBaselineToo(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 4)
	f.approve(character.NarrationCharacterID, narrationVoice, 4)
	f.line("cue-flat", "alice", narrationVoice.measurement())

	result := f.analyze(t)
	finding, ok := findingFor(t, result, "cue-flat")
	if !ok {
		t.Fatal("a line read in the narration voice was not flagged against the character's reference")
	}
	narration, _ := finding.Evidence["narration"].(NarrationEvidence)
	if !narration.Available || narration.ReferenceCount != 4 {
		t.Fatalf("narration evidence = %+v", narration)
	}
	if !(narration.Distance < narration.Threshold) || !narration.WithinNarrationReference {
		t.Fatalf("a line read in the narration voice is not shown as within the narration reference: %+v", narration)
	}
}

func TestNarrationEvidenceSaysWhyWhenThereIsNoNarrationBaseline(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 3)
	f.approve("bob", bobVoice, 3)
	f.approve(character.NarrationCharacterID, narrationVoice, 1)
	f.line("cue-drift", "alice", bobVoice.measurement())

	finding, ok := findingFor(t, f.analyze(t), "cue-drift")
	if !ok {
		t.Fatal("no finding")
	}
	narration, _ := finding.Evidence["narration"].(NarrationEvidence)
	if narration.Available || !strings.Contains(narration.Reason, "1 of the 3") {
		t.Fatalf("narration evidence = %+v, want unavailable with the reference count", narration)
	}
}

func TestOverlappingCharacterVoicesDoNotFlagEachOther(t *testing.T) {
	// Two characters voiced almost identically: a line of one read in the
	// other's voice is inside the reference distribution, so nothing is
	// flagged. The analyzer never claims to tell who is speaking.
	carol := aliceVoice
	carol.f0 += 2
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.approve("carol", carol, 5)
	f.approve("bob", bobVoice, 5)
	f.line("cue-1", "alice", carol.jitter(2).measurement())
	f.line("cue-2", "carol", aliceVoice.jitter(4).measurement())

	if result := f.analyze(t); len(result.Findings) != 0 {
		t.Fatalf("overlapping voices raised %d findings", len(result.Findings))
	}
}

func TestMissingOrAmbiguousSpeakerCuesProduceNoCandidate(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.line("cue-unknown", "", bobVoice.measurement())
	f.line("cue-unaligned", "alice", bobVoice.measurement())
	delete(f.aligner, "cue-unaligned")
	f.line("cue-short", "alice", bobVoice.measurement())
	short := f.aligner["cue-short"]
	short.Clip.Range.LengthSeconds = 0.2
	f.aligner["cue-short"] = short
	f.line("cue-nopitch", "alice", Measurement{})

	result := f.analyze(t)
	if len(result.Findings) != 0 {
		t.Fatalf("unattributed or unlocated lines raised findings: %+v", result.Findings)
	}
	reasons := map[string]SkipReason{}
	for _, skipped := range result.Skipped {
		reasons[skipped.CueID] = skipped.Reason
	}
	want := map[string]SkipReason{
		"cue-unknown":   SkipUnknownSpeaker,
		"cue-unaligned": SkipNoAlignment,
		"cue-short":     SkipTooShort,
		"cue-nopitch":   SkipNoMeasurablePitch,
	}
	for cue, reason := range want {
		if reasons[cue] != reason {
			t.Errorf("%s skipped as %q, want %q", cue, reasons[cue], reason)
		}
	}
}

func TestTooFewReferencesProduceNoFlagAndSayWhy(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 2)
	f.line("cue-drift", "alice", bobVoice.measurement())

	result := f.analyze(t)
	if len(result.Findings) != 0 {
		t.Fatalf("a character with 2 references raised %d findings", len(result.Findings))
	}
	subject, ok := result.Subject("alice")
	if !ok || subject.Available || subject.UsableReferences != 2 || subject.RequiredReferences != 3 {
		t.Fatalf("subject = %+v, %v", subject, ok)
	}
	if !strings.Contains(subject.Reason, "insufficient reference") {
		t.Fatalf("Reason = %q", subject.Reason)
	}
	if len(result.Skipped) != 1 || result.Skipped[0].Reason != SkipInsufficientReference {
		t.Fatalf("Skipped = %+v", result.Skipped)
	}
	// A character with no references at all is reported the same way.
	f.line("cue-bob", "bob", bobVoice.measurement())
	if subject, ok := f.analyze(t).Subject("bob"); !ok || subject.Available || subject.UsableReferences != 0 {
		t.Fatalf("bob = %+v, %v", subject, ok)
	}
}

func TestOnlyApprovedUnchangedReferencesFormABaseline(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 3)
	// A fourth reference whose region moved since approval, recorded in a
	// completely different voice: were it used, it would widen alice's
	// reference so far that the drifted line below would pass.
	f.approve("alice-moved", bobVoice, 1)
	f.refs[3].CharacterID = "alice"
	f.refs[3].ChangedSinceApproval = true
	f.line("cue-drift", "alice", bobVoice.measurement())

	result := f.analyze(t)
	finding, ok := findingFor(t, result, "cue-drift")
	if !ok {
		t.Fatal("the changed reference leaked into the baseline and hid the drift")
	}
	if refs := finding.Evidence["reference_ids"].([]string); slices.Contains(refs, "ref-alice-moved-0") {
		t.Fatalf("reference_ids includes the changed reference: %v", refs)
	}
	if len(result.Excluded) != 1 || result.Excluded[0].ReferenceID != "ref-alice-moved-0" || result.Excluded[0].Reason != ExcludedChangedSinceApproval {
		t.Fatalf("Excluded = %+v", result.Excluded)
	}
	for _, clip := range f.measurer.calls {
		if clip.File == "ref-alice-moved-0" {
			t.Fatal("a changed reference's audio was measured")
		}
	}
}

func TestAReferenceThatCannotBeMeasuredIsExcludedNotGuessed(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 4)
	f.measurer.byFile["ref-alice-1"] = Measurement{} // no pitch
	config := f.config()
	config.ReferenceAudio = fakeAudio{missing: map[string]string{"ref-alice-2": "no single item covers the region"}}
	f.line("cue-1", "alice", aliceVoice.measurement())

	result, err := Analyze(config, f.cues)
	if err != nil {
		t.Fatal(err)
	}
	reasons := map[string]ExclusionReason{}
	for _, excluded := range result.Excluded {
		reasons[excluded.ReferenceID] = excluded.Reason
	}
	if reasons["ref-alice-1"] != ExcludedNoMeasurablePitch || reasons["ref-alice-2"] != ExcludedNoAudio {
		t.Fatalf("Excluded = %+v", result.Excluded)
	}
	if subject, _ := result.Subject("alice"); subject.Available || subject.UsableReferences != 2 {
		t.Fatalf("alice = %+v, want 2 usable and unavailable", subject)
	}
}

func TestARecordingChainDifferenceSuppressesTheDriftFlag(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.approve("bob", bobVoice, 5)
	noisy := bobVoice.measurement()
	noisy.NoiseFloordBFS = ptr(-40.0) // references sit at -65 dBFS
	f.line("cue-noisy", "alice", noisy)
	f.line("cue-clean", "alice", bobVoice.measurement())

	result := f.analyze(t)
	noisyFinding, ok := findingFor(t, result, "cue-noisy")
	if !ok {
		t.Fatal("the chain difference was not reported at all")
	}
	cleanFinding, _ := findingFor(t, result, "cue-clean")
	if noisyFinding.Severity != findings.SeverityInfo {
		t.Fatalf("Severity = %s, want info: a chain difference is reported, not raised as drift", noisyFinding.Severity)
	}
	if !(*noisyFinding.Confidence < *cleanFinding.Confidence) {
		t.Fatalf("chain difference did not lower confidence: %v vs %v", *noisyFinding.Confidence, *cleanFinding.Confidence)
	}
	if !strings.Contains(noisyFinding.ConfidenceReason, "recording chain may differ") {
		t.Fatalf("ConfidenceReason = %q", noisyFinding.ConfidenceReason)
	}
	chain, _ := noisyFinding.Evidence["recording_chain"].(ChainCheck)
	if !chain.Differs || chain.NoiseFloorShiftDB == nil || *chain.NoiseFloorShiftDB < 20 {
		t.Fatalf("recording_chain = %+v", chain)
	}
}

func TestALevelShiftAloneAlsoReadsAsAChainDifference(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.approve("bob", bobVoice, 5)
	loud := bobVoice.measurement()
	loud.RMSdBFS = ptr(-8.0) // references at -20 dBFS
	f.line("cue-loud", "alice", loud)

	finding, ok := findingFor(t, f.analyze(t), "cue-loud")
	if !ok || finding.Severity != findings.SeverityInfo {
		t.Fatalf("finding = %+v, %v", finding, ok)
	}
	// A line inside the reference with a chain difference raises nothing:
	// the check only ever suppresses a flag, it never raises one.
	g := newFixture()
	g.approve("alice", aliceVoice, 5)
	quiet := aliceVoice.measurement()
	quiet.NoiseFloordBFS = ptr(-30.0)
	g.line("cue-ok", "alice", quiet)
	if result := g.analyze(t); len(result.Findings) != 0 {
		t.Fatalf("a chain difference alone raised %d findings", len(result.Findings))
	}
}

func TestFindingsAreIdenticalAcrossRuns(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.line("cue-drift", "alice", bobVoice.measurement())
	first, _ := findingFor(t, f.analyze(t), "cue-drift")
	second, _ := findingFor(t, f.analyze(t), "cue-drift")
	if first.ID != second.ID || first.EvidenceVersion != second.EvidenceVersion {
		t.Fatalf("re-run changed identity: %s/%s vs %s/%s", first.ID, first.EvidenceVersion, second.ID, second.EvidenceVersion)
	}
}

func TestTheEvidenceVersionFollowsTheAudioAndTheReferences(t *testing.T) {
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.line("cue-drift", "alice", bobVoice.measurement())
	before, _ := findingFor(t, f.analyze(t), "cue-drift")

	// Re-recorded: the same line, different audio.
	f.measurer.byFile["take-cue-drift.wav"] = bobVoice.jitter(2).measurement()
	rerecorded, _ := findingFor(t, f.analyze(t), "cue-drift")
	if rerecorded.ID != before.ID || rerecorded.EvidenceVersion == before.EvidenceVersion {
		t.Fatalf("re-recording: id %s->%s, evidence %s->%s", before.ID, rerecorded.ID, before.EvidenceVersion, rerecorded.EvidenceVersion)
	}

	// A reference revoked: the baseline changed, so the evidence did too.
	f.measurer.byFile["take-cue-drift.wav"] = bobVoice.measurement()
	f.refs = f.refs[:4]
	revoked, _ := findingFor(t, f.analyze(t), "cue-drift")
	if revoked.ID != before.ID || revoked.EvidenceVersion == before.EvidenceVersion {
		t.Fatalf("revoking a reference kept evidence version %s", revoked.EvidenceVersion)
	}
}

func TestADismissedFindingStaysDismissedForIdenticalEvidence(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.line("cue-drift", "alice", bobVoice.measurement())

	if _, err := Save(store, f.analyze(t)); err != nil {
		t.Fatal(err)
	}
	finding, _ := findingFor(t, f.analyze(t), "cue-drift")
	if _, found, err := store.RecordDecision(finding.ID, finding.EvidenceVersion, findings.StatusDismissed, "intentional: she has a cold here", "2026-09-28T01:00:00Z"); err != nil || !found {
		t.Fatalf("RecordDecision: %v, %v", found, err)
	}

	saved, err := Save(store, f.analyze(t))
	if err != nil {
		t.Fatal(err)
	}
	if got := statusOf(saved, finding.ID); got.Status != findings.StatusDismissed || got.Note == "" {
		t.Fatalf("identical evidence: review = %+v, want still dismissed with its note", got)
	}

	f.measurer.byFile["take-cue-drift.wav"] = bobVoice.jitter(1).measurement()
	saved, err = Save(store, f.analyze(t))
	if err != nil {
		t.Fatal(err)
	}
	if got := statusOf(saved, finding.ID); got.Status != findings.StatusUnreviewed || got.Note == "" {
		t.Fatalf("changed evidence: review = %+v, want unreviewed keeping the note", got)
	}
}

func TestSaveMarksAChaptersEarlierFindingAbsentWhenARunNoLongerRaisesIt(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	f := newFixture()
	f.approve("alice", aliceVoice, 5)
	f.line("cue-drift", "alice", bobVoice.measurement())
	if _, err := Save(store, f.analyze(t)); err != nil {
		t.Fatal(err)
	}
	f.measurer.byFile["take-cue-drift.wav"] = aliceVoice.measurement() // re-recorded in voice
	saved, err := Save(store, f.analyze(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(saved) != 1 || !saved[0].NotInLatestRun {
		t.Fatalf("saved = %+v, want the old finding carried forward as not in the latest run", saved)
	}
}

func statusOf(saved []findings.Finding, id string) findings.ReviewState {
	for _, finding := range saved {
		if finding.ID == id {
			return finding.Review
		}
	}
	return findings.ReviewState{}
}

func TestAnalyzeReportsAReferenceSourceFailure(t *testing.T) {
	config := newFixture().config()
	config.References = fakeReferences{err: errors.New("references.json could not be read")}
	if _, err := Analyze(config, nil); err == nil {
		t.Fatal("a reference read failure was swallowed")
	}
}

func TestAnalyzeRefusesAnIncompleteConfig(t *testing.T) {
	config := newFixture().config()
	config.Measurer = nil
	if _, err := Analyze(config, nil); err == nil {
		t.Fatal("a nil measurer was accepted")
	}
	config = newFixture().config()
	config.Rule = Rule{MinReferences: 3, Percentile: 150}
	if _, err := Analyze(config, nil); err == nil {
		t.Fatal("an invalid rule was accepted")
	}
}

// TestThePackageImportsNoNetworkCode backs the PRD's privacy metric
// ("the analyzer performs no network calls"): nothing here can open a
// connection, so nothing about the narrator's voice can leave the machine
// (D72).
func TestThePackageImportsNoNetworkCode(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		source, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), name, source, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, spec := range parsed.Imports {
			path := strings.Trim(spec.Path.Value, `"`)
			if path == "net" || strings.HasPrefix(path, "net/") || path == "os/exec" {
				t.Errorf("%s imports %s", name, path)
			}
		}
	}
}

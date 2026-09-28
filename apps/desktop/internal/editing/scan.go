package editing

import (
	"context"
	"os"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func projectModTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime().UTC(), nil
}

// run is the scan loop: cache-first per item, decode only misses, compose
// empty space, persist findings, real progress. It never returns an error:
// every outcome (complete, cancelled, one or more items failed) is recorded
// in s.state, matching Phase 5's "one failed item not aborting the rest."
func (s *Service) run(ctx context.Context, request Request, track tracks.Track, project tracks.Project, projectFile evidence.LedgerProjectFile) {
	resolutions := ResolveTrack(track)
	scanOpts := s.scanOptions()
	paramHash := scanParamHash(scanOpts)

	var audibleItems []ItemAudible
	var classScans []itemClassScan
	var itemFiles, itemTakes = map[string]string{}, map[string]string{}
	cacheHits, decoded, failed, done := 0, 0, 0, 0
	total := 0
	for _, res := range resolutions {
		if res.Analyzable() {
			total++
		}
	}

	for _, res := range resolutions {
		if ctx.Err() != nil {
			s.finish(request, projectFile, PhaseCancelled, done, total, cacheHits, decoded, failed, "Cancelled.")
			return
		}
		if !res.Analyzable() {
			continue
		}
		item, source := res.Item, res.Source
		identity, err := evidence.Identify(source.File, s.config.Project)
		if err != nil {
			failed++
			done++
			s.reportProgress(request.ChapterID, done, total, cacheHits, decoded, failed)
			continue
		}
		key := evidence.ComputeAnalysisKey(identity, evidence.PlayedRange{Start: source.PlayedRange.Start, End: source.PlayedRange.End}, 1)
		scopeIn := ItemScopeInput{DocumentID: request.DocumentID, ChapterID: request.ChapterID, TrackGUID: track.GUID, Item: item, Key: key}

		scan, hit, err := s.scanItem(ctx, scopeIn, source, scanOpts, paramHash)
		if err != nil {
			if ctx.Err() != nil {
				s.finish(request, projectFile, PhaseCancelled, done, total, cacheHits, decoded, failed, "Cancelled.")
				return
			}
			failed++
			s.writeFailure(scopeIn, projectFile, paramHash)
			done++
			s.reportProgress(request.ChapterID, done, total, cacheHits, decoded, failed)
			continue
		}
		if hit {
			cacheHits++
		} else {
			decoded++
			s.writeSuccess(scopeIn, projectFile, paramHash, scan)
		}
		audible := ItemAudibleFromItem(item.GUID, source.TakeGUID, item.Position, source, scan)
		audibleItems = append(audibleItems, audible)
		classScans = append(classScans, itemClassScan{audible: audible, scan: scan})
		itemFiles[item.GUID], itemTakes[item.GUID] = source.File, source.TakeGUID
		done++
		s.reportProgress(request.ChapterID, done, total, cacheHits, decoded, failed)
	}

	s.composeAndPersist(request, audibleItems, classScans, itemFiles, itemTakes)

	phase := PhaseComplete
	message := "Check complete."
	if failed > 0 {
		message = "Check complete; some items could not be read."
	}
	s.finish(request, projectFile, phase, done, total, cacheHits, decoded, failed, message)
}

// scanItem answers one item's ItemScan: from cache when the ledger says the
// item's own record is current (0 decodes), from a fresh Decode otherwise.
// hit reports which path was taken, for the run's own counters.
func (s *Service) scanItem(ctx context.Context, in ItemScopeInput, source Source, opts ScanOptions, paramHash string) (ItemScan, bool, error) {
	staleness, err := CurrentItemRecord(s.ledger, AnalyzerSilence, AnalyzerVersion, paramHash, in)
	if err != nil {
		return ItemScan{}, false, err
	}
	if staleness.State == evidence.StateCurrent {
		identity, err := evidence.Identify(source.File, s.config.Project)
		if err == nil {
			key := CacheKey(identity, scanCacheVersion, paramHash, source.PlayedRange)
			if scan, ok := ReadScan(s.cache, key); ok {
				return scan, true, nil
			}
		}
		// The ledger says current but the cache entry is gone (pruned, or
		// never written): fall through to a real decode rather than trusting
		// a record with nothing behind it.
	}
	scan, _, err := Decode(ctx, source, opts, nil)
	return scan, false, err
}

// scanCacheVersion is the version a cached decode is keyed on: one pass
// measures all three classes, so a new version of any one of them is a cache
// miss and a fresh decode.
const scanCacheVersion = AnalyzerVersion + "+" + ClickAnalyzerVersion + "+" + BreathAnalyzerVersion

// classRecords names each class's ledger record: its analyzer id, the
// version it is stamped with and the count it carries, so a class goes stale
// alone when its own detector version changes.
var classRecords = []struct{ analyzerID, version, count, class string }{
	{AnalyzerSilence, AnalyzerVersion, "silences", ""},
	{AnalyzerClick, ClickAnalyzerVersion, "clicks", string(measure.CleanupClick)},
	{AnalyzerBreath, BreathAnalyzerVersion, "breaths", string(measure.CleanupBreath)},
}

func (s *Service) writeSuccess(in ItemScopeInput, projectFile evidence.LedgerProjectFile, paramHash string, scan ItemScan) {
	identity, err := evidence.Identify(in.Item.Active().SourceFile, s.config.Project)
	if err != nil {
		return
	}
	key := CacheKey(identity, scanCacheVersion, paramHash, evidence.PlayedRange{Start: evidence.ItemPlayedRange(in.Item).Start, End: evidence.ItemPlayedRange(in.Item).End})
	_ = WriteScan(s.cache, key, scan)
	now := s.now()
	for _, record := range classRecords {
		count := len(scan.Silences)
		if record.class != "" {
			count = classCount(scan, record.class)
		}
		_, _ = WriteLedgerRecord(s.ledger, record.analyzerID, record.version, paramHash, in, projectFile, now, now, evidence.LedgerComplete, map[string]int{record.count: count})
	}
}

func (s *Service) writeFailure(in ItemScopeInput, projectFile evidence.LedgerProjectFile, paramHash string) {
	now := s.now()
	for _, record := range classRecords {
		_, _ = WriteLedgerRecord(s.ledger, record.analyzerID, record.version, paramHash, in, projectFile, now, now, evidence.LedgerFailed, nil)
	}
}

func classCount(scan ItemScan, class string) int {
	count := 0
	for _, candidate := range scan.Cleanup.Candidates {
		if string(candidate.Class) == class {
			count++
		}
	}
	return count
}

// itemClassScan pairs one scanned item's timeline placement with its scan,
// for the click and breath findings.
type itemClassScan struct {
	audible ItemAudible
	scan    ItemScan
}

// composeAndPersist runs Phase 3's composition, adds every item's click and
// breath candidates, and saves the resulting findings, replacing this
// chapter's own editing/<chapterID>.json findings scope entirely (a full run,
// so a candidate the latest run did not reproduce is carried forward marked
// NotInLatestRun rather than deleted - findings.Store.SaveAnalyzerFindings's
// own rule).
func (s *Service) composeAndPersist(request Request, items []ItemAudible, classScans []itemClassScan, itemFiles, itemTakes map[string]string) {
	if s.findings == nil {
		return
	}
	policy := s.policy()
	fresh := []findings.Finding{}
	if candidates, ok := ComposeEmptySpace(items, policy); ok {
		for _, candidate := range candidates {
			fresh = append(fresh, EmptySpaceFinding(request.DocumentID, request.ChapterID, request.ChapterTitle, candidate, itemFiles, itemTakes, policy))
		}
	}
	for _, item := range classScans {
		for _, candidate := range item.scan.Cleanup.Candidates {
			if candidate.Class == measure.CleanupClick || candidate.Class == measure.CleanupBreath {
				fresh = append(fresh, ClassCandidateFinding(request.DocumentID, request.ChapterID, request.ChapterTitle, item.audible, item.scan.Cleanup, candidate))
			}
		}
	}
	_, _ = s.findings.SaveAnalyzerFindings(analyzerName, request.ChapterID, fresh)
}

func (s *Service) reportProgress(chapterID string, done, total, cacheHits, decoded, failed int) {
	s.setState(func(state *State) {
		state.ChapterID, state.ItemsDone, state.ItemsTotal = chapterID, done, total
		state.CacheHits, state.Decoded, state.Failed = cacheHits, decoded, failed
		if total > 0 {
			state.Percent = float64(done) / float64(total)
		}
	})
}

func (s *Service) finish(request Request, projectFile evidence.LedgerProjectFile, phase Phase, done, total, cacheHits, decoded, failed int, message string) {
	completed := s.now()
	s.setState(func(state *State) {
		state.Phase, state.Message, state.CompletedAt = phase, message, &completed
		state.ChapterID, state.ItemsDone, state.ItemsTotal = request.ChapterID, done, total
		state.CacheHits, state.Decoded, state.Failed = cacheHits, decoded, failed
		if total > 0 {
			state.Percent = float64(done) / float64(total)
		}
	})
}

func (s *Service) policy() Policy {
	if s.config.Policy == nil {
		return Policy{}
	}
	return s.config.Policy()
}

func (s *Service) scanOptions() ScanOptions {
	if s.config.ScanOptions == nil {
		return DefaultScanOptions()
	}
	return s.config.ScanOptions()
}

// scanParamHash hashes the scan-time analyzer parameters only (silence floor,
// minimum silence, cleanup thresholds) - never the read-time policy
// (maximum gap, head or tail limit), so changing policy never invalidates a
// cache entry or ledger record ("policy change costs no decode").
func scanParamHash(opts ScanOptions) string {
	return hashParts(
		formatFloat(opts.Silence.SilenceFloordBFS), formatFloat(opts.Silence.MinSilenceSeconds),
		formatFloat(opts.Cleanup.PadSeconds), formatFloat(opts.Cleanup.MinBreathSeconds), formatFloat(opts.Cleanup.MaxBreathSeconds),
		formatFloat(opts.Cleanup.BreathBelowSpeechDB), formatFloat(opts.Cleanup.ClickAboveSilenceDB),
	)
}

// Candidates returns the chapter's current empty-space findings (Phase 5's
// own scope includes "bindings for start, state, cancel and candidates");
// dismissed/accepted/deferred state lives in the findings store's review
// history, already folded in by List.
func (s *Service) Candidates(chapterID string) ([]findings.Finding, error) {
	if s.findings == nil {
		return nil, nil
	}
	return s.findings.List(findings.Query{Analyzer: analyzerName, ChapterID: chapterID})
}

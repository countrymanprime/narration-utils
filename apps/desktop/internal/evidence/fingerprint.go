package evidence

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// This file is the analysis evidence ledger PRD's Phase 2
// (docs/prds/analysis-evidence-ledger.prd.md#phase-2---source-identity-fingerprint-and-analysis-key):
// the played range, the analysis key and the item/track fingerprints, over
// a canonical encoding. It builds on tracks.Item/tracks.Take (Phase 1) and
// SourceIdentity (Phase 1, identity.go). It writes nothing and reads no
// file itself; every input here is already in memory.

// PlayedRange is the portion of a take's source file that actually plays,
// in the source file's own seconds: [Start, End). It is the unit the Lua
// manifest already emits per item (integrations/reaper/narration_ui_bridge.lua:151,
// "index|source_file|startoffs|length*rate") and the PRD's Solution Detail
// names it by, because non-destructive edits (split, trim, fade) change
// item state, never source bytes (D6): the played range is what tells two
// items with the same source file apart.
type PlayedRange struct {
	Start float64
	End   float64
}

// ItemPlayedRange computes item's active take's PlayedRange as
// [SOFFS, SOFFS + Length*PlayRate), with SOFFS additionally offset by the
// take's SECTION wrapper's own StartPos when it has one. A <SOURCE SECTION>
// wrapper (tracks.Take.Section) means the take's own SOFFS is an offset
// within the wrapped, already-trimmed view, not within the real underlying
// file tracks.Take.SourceFile names - so the wrapper's StartPos has to be
// added to reach a range that means "this part of SourceFile", which is
// what SourceIdentity identifies. Without that addition, two different
// SECTION-trimmed regions of the same file could read as the same played
// range whenever their own SOFFS values coincide (in practice usually 0).
func ItemPlayedRange(item tracks.Item) PlayedRange {
	take := item.Active()
	start := take.SOFFS
	if take.Section != nil {
		start += take.Section.StartPos
	}
	return PlayedRange{Start: start, End: start + item.Length*take.PlayRate}
}

// AnalysisKey identifies what audio content an item's active take plays:
// the source file's identity, the played range within it, and the playback
// rate. Two items with equal analysis keys read the same audio the same
// way, so Phase 4's per-item result cache (keyed by the analysis key) hits
// across a position-only move, a mute toggle or an active-take switch to
// an otherwise-identical take.
//
// It deliberately hashes identity.Path/Size/PartialHash, never
// identity.ModTime: a source file that is merely touched (mtime changes,
// content and PartialHash do not) must not always read as "changed" - the
// edit-type table's "Source touched, identical content" row says the
// analysis key "changes only if the hash policy sees it" (Q1), i.e.
// depends on the file's sampled content, not on when it was last written.
// ModTime still matters (to the ledger's staleness warning, Phase 6/Q8),
// just not to what audio content this key names.
type AnalysisKey string

// ComputeAnalysisKey hashes identity, played and playRate per AnalysisKey's
// doc comment. playRate is passed separately from played (rather than
// derived back out of it) because a played range's width alone does not
// distinguish, for example, rate 2 over item length 1 from rate 1 over
// item length 2: both consume the same width of source content but play it
// at a different speed, which is a different analysis input.
func ComputeAnalysisKey(identity SourceIdentity, played PlayedRange, playRate float64) AnalysisKey {
	return AnalysisKey(hashParts(
		identity.Path,
		strconv.FormatInt(identity.Size, 10),
		identity.PartialHash,
		formatSeconds(played.Start),
		formatSeconds(played.End),
		formatSeconds(playRate),
	))
}

// ItemFingerprint identifies what an item is on the timeline right now: its
// AnalysisKey plus the fields the Open Questions' Q2 recommendation (option
// A) puts in scope - GUID, position, length, mute and active-take index.
// Item volume, fades and FX-chain presence are recorded as evidence
// elsewhere (tracks.Take.HasFXChain, tracks.Take.StretchMarkerCount) but
// deliberately excluded here, per Q2: analyses read source audio, so a
// cosmetic REAPER change (colour, name, notes, gain, a fade curve) must not
// make a signal read "stale" and teach the narrator to ignore staleness.
type ItemFingerprint string

// ComputeItemFingerprint hashes key with item's GUID, position, length,
// mute and active-take index. key is passed in rather than recomputed here
// so a caller that already has it (for example Phase 4's cache, which
// looks results up by AnalysisKey before it ever needs the fingerprint)
// pays for the hash once.
func ComputeItemFingerprint(key AnalysisKey, item tracks.Item) ItemFingerprint {
	return ItemFingerprint(hashParts(
		string(key),
		item.GUID,
		formatSeconds(item.Position),
		formatSeconds(item.Length),
		formatBool(item.Muted),
		strconv.Itoa(item.ActiveTake),
	))
}

// TrackFingerprint identifies a track's (or, scoped by the caller, a
// chapter's) played content as a whole: the ordered ItemFingerprints of its
// unmuted, supported (audio) items, per the Solution Detail's data model
// ("Track fingerprint: the ordered item fingerprints of the chapter's
// unmuted audio items"). Deleting, adding, muting or unmuting an item all
// change it, even when no remaining item's own fingerprint does.
type TrackFingerprint string

// TrackFingerprintEntry pairs an item with its own already-computed
// ItemFingerprint, so ComputeTrackFingerprint never has to recompute one or
// reach into a file system; the caller supplies entries in timeline order.
type TrackFingerprintEntry struct {
	Item        tracks.Item
	Fingerprint ItemFingerprint
}

// ComputeTrackFingerprint hashes the ItemFingerprints of entries whose item
// is neither muted nor unsupported (a MIDI or otherwise non-audio item),
// preserving entries' order.
func ComputeTrackFingerprint(entries []TrackFingerprintEntry) TrackFingerprint {
	parts := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Item.Muted || !entry.Item.Supported {
			continue
		}
		parts = append(parts, string(entry.Fingerprint))
	}
	return TrackFingerprint(hashParts(parts...))
}

// secondsPrecision is the canonical encoding's fixed decimal precision for
// every time-like value (position, length, SOFFS-derived range edges, play
// rate), microsecond resolution. The PRD's Architecture Notes flag the
// exact precision REAPER's own re-save rounding needs as TBD pending
// measurement; microsecond precision is far finer than any audible edit and
// the no-op re-save fixture pair (testdata/reaper/{saved-cases,resave-noop}.rpp)
// round-trips every item-level float this package reads unchanged at that
// precision (see fingerprint_test.go), so it is the working value until a
// real re-save is found that disagrees.
const secondsPrecision = 6

func formatSeconds(value float64) string {
	return strconv.FormatFloat(value, 'f', secondsPrecision, 64)
}

func formatBool(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

// hashParts hashes parts into one deterministic hex digest, each
// length-prefixed (as findings.StableID already does,
// apps/desktop/internal/findings/findings.go) so that, for instance,
// ("ab", "c") and ("a", "bc") never collide.
func hashParts(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		// hash.Hash.Write never returns an error (crypto/sha256, like every
		// hash.Hash); findings.StableID (apps/desktop/internal/findings/
		// findings.go) uses the same length-prefixed pattern via hash.Write.
		_, _ = fmt.Fprintf(hash, "%d:%s", len(part), part)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

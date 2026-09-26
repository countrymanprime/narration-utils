// This file is Phase 4 of docs/prds/proofing-readiness-signals.prd.md: which
// rendered file the delivery checks are about, and whether it is still the
// current one (Q8, Q9 A, Q10 A). The narrator chooses a chapter's render and so
// attests it was made from the chapter as it is; the association keeps the
// render's fingerprint and the chapter items' fingerprint at that moment, and a
// later change to either makes it stale. The association stores no
// measurement: measuring the render (the Delivery page's measurement job,
// DX-1) writes an analysis evidence ledger record with the Report, keyed by the
// render's fingerprint, and the narrator's limits are applied on read (Phase 5)
// so changing a limit never forces a re-measure.
package proofing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// AnalyzerRenderMeasurement is the ledger analyzer id of a render measurement.
const AnalyzerRenderMeasurement = "proofing-render-measure"

// renderMeasurementVersion versions the record, and includes measure's own
// AnalyzerVersion so a change in what a measured value means is visible.
var renderMeasurementVersion = fmt.Sprintf("1+measure.%d", measure.AnalyzerVersion)

// The formats a render is sniffed as. Only WAV is measured (measure reads WAV
// samples; an MP3 has its headers read only, DX Q2), so any other format is
// recorded as unsupported, never as a zero.
const (
	FormatWAV   = "wav"
	FormatMP3   = "mp3"
	FormatOther = "other"
)

// ErrRendersUnreadable is a renders.json that exists but cannot be read. It is
// surfaced, and the file is left alone, rather than read as "no renders".
var ErrRendersUnreadable = errors.New("the proofing render choices file could not be read")

// Dir is this package's sidecar folder under a project; manuscript.resetDerived
// clears it, since the associations name chapter ids a re-import renumbers.
func Dir(project string) string { return filepath.Join(project, "narration-utils", "proofing") }

// RendersFile is the chapter-to-render association sidecar.
func RendersFile(project string) string { return filepath.Join(Dir(project), "renders.json") }

// RenderFingerprint is the render file's identity under EL's hash policy (Q1
// C: size, modified time and a hash of its head, middle and tail blocks); Key
// hashes Path, Size and PartialHash, never ModTime.
type RenderFingerprint struct {
	Path        string    `json:"path"`
	Size        int64     `json:"size"`
	ModTime     time.Time `json:"modTime"`
	PartialHash string    `json:"partialHash"`
	Key         string    `json:"key"`
}

// RenderAssociation is one chapter's chosen render and what the narrator
// attested by choosing it.
type RenderAssociation struct {
	DocumentID string            `json:"documentId"`
	ChapterID  string            `json:"chapterId"`
	Path       string            `json:"path"`
	Render     RenderFingerprint `json:"render"`
	Format     string            `json:"format"`
	// TrackGUID and ItemsFingerprint are the chapter's confirmed track and the
	// fingerprint of its items in the saved project when the narrator chose
	// the render (EL's track fingerprint: unmuted audio items, in order).
	TrackGUID        string    `json:"trackGuid"`
	ItemsFingerprint string    `json:"itemsFingerprint"`
	AttestedAt       time.Time `json:"attestedAt"`
}

// rendersFileShape is renders.json: associations by documentId, then chapter id.
type rendersFileShape struct {
	Version   int                                     `json:"version"`
	Documents map[string]map[string]RenderAssociation `json:"documents"`
}

const rendersFileVersion = 1

// RenderStore reads and writes renders.json. Writes are temp-file-then-rename.
type RenderStore struct {
	project string
	mu      sync.Mutex
}

// NewRenderStore returns the store of project's render associations.
func NewRenderStore(project string) *RenderStore { return &RenderStore{project: project} }

// Get returns the chapter's association. A missing file is no association; a
// file that cannot be read or decoded, or was written by a newer version, is
// ErrRendersUnreadable.
func (s *RenderStore) Get(documentID, chapterID string) (RenderAssociation, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.read()
	if err != nil {
		return RenderAssociation{}, false, err
	}
	association, ok := file.Documents[documentID][chapterID]
	return association, ok, nil
}

// List returns every association of documentID.
func (s *RenderStore) List(documentID string) ([]RenderAssociation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.read()
	if err != nil {
		return nil, err
	}
	out := []RenderAssociation{}
	for _, association := range file.Documents[documentID] {
		out = append(out, association)
	}
	return out, nil
}

// Set stores association, replacing the chapter's previous one. It refuses,
// changing nothing, when the file on disk cannot be read.
func (s *RenderStore) Set(association RenderAssociation) error {
	return s.update(func(file *rendersFileShape) {
		chapters := file.Documents[association.DocumentID]
		if chapters == nil {
			chapters = map[string]RenderAssociation{}
			file.Documents[association.DocumentID] = chapters
		}
		chapters[association.ChapterID] = association
	})
}

// Clear removes the chapter's association.
func (s *RenderStore) Clear(documentID, chapterID string) error {
	return s.update(func(file *rendersFileShape) { delete(file.Documents[documentID], chapterID) })
}

func (s *RenderStore) update(change func(*rendersFileShape)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.read()
	if err != nil {
		return err
	}
	change(&file)
	encoded, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(Dir(s.project), 0o755); err != nil {
		return fmt.Errorf("could not create the proofing folder: %w", err)
	}
	path := RendersFile(s.project)
	temp := path + ".tmp"
	if err := os.WriteFile(temp, encoded, 0o600); err != nil {
		return fmt.Errorf("could not save the render choice: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return fmt.Errorf("could not save the render choice: %w", err)
	}
	return nil
}

func (s *RenderStore) read() (rendersFileShape, error) {
	empty := rendersFileShape{Version: rendersFileVersion, Documents: map[string]map[string]RenderAssociation{}}
	raw, err := os.ReadFile(RendersFile(s.project))
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, fmt.Errorf("%w: %v", ErrRendersUnreadable, err)
	}
	var file rendersFileShape
	if err := json.Unmarshal(raw, &file); err != nil {
		return empty, fmt.Errorf("%w: %v", ErrRendersUnreadable, err)
	}
	if file.Version > rendersFileVersion {
		return empty, fmt.Errorf("%w: written by a newer version of the app (version %d)", ErrRendersUnreadable, file.Version)
	}
	if file.Documents == nil {
		file.Documents = map[string]map[string]RenderAssociation{}
	}
	file.Version = rendersFileVersion
	return file, nil
}

// Attest records renderPath as the chapter's render, made from the chapter as
// the saved project in view has it now (Q9 A: the narrator's own statement is
// the basis, not a guess from timestamps). It refuses a file it cannot read and
// a chapter without one confirmed track in the saved project.
func Attest(store *RenderStore, chapter stages.ChapterContext, view stages.EvidenceView, renderPath string, now time.Time) (RenderAssociation, error) {
	render, err := fingerprintRender(renderPath, view.ProjectFolder)
	if err != nil {
		return RenderAssociation{}, fmt.Errorf("could not read the rendered file: %w", err)
	}
	track, problem := chapterTrack(chapter, view)
	if problem != nil {
		return RenderAssociation{}, errors.New(problem.Reason)
	}
	association := RenderAssociation{
		DocumentID: chapter.DocumentID, ChapterID: chapter.ChapterID, Path: renderPath, Render: render, Format: sniffFormat(renderPath),
		TrackGUID: track.GUID, ItemsFingerprint: itemsFingerprint(track.Items, view.ProjectFolder), AttestedAt: now.UTC(),
	}
	if err := store.Set(association); err != nil {
		return RenderAssociation{}, err
	}
	return association, nil
}

// RenderState is where a chapter's render stands now.
type RenderState string

const (
	RenderNone        RenderState = "none"
	RenderCurrent     RenderState = "current"
	RenderStale       RenderState = "stale"
	RenderMissing     RenderState = "missing"
	RenderUnsupported RenderState = "unsupported"
)

// RenderMeasurement is a stored measurement of the current render.
type RenderMeasurement struct {
	RecordID   string
	Report     measure.Report
	MeasuredAt time.Time
}

// RenderStatus is a chapter's render evaluated now, with the unknown cause and
// the narrator's action for anything but current, the latest measurement of
// exactly this render (nil when none), and whether that latest measurement
// failed.
type RenderStatus struct {
	State             RenderState
	Cause             stages.UnknownCause
	Reason            string
	Association       *RenderAssociation
	Measurement       *RenderMeasurement
	MeasurementFailed bool
	RecordIDs         []string
	Fingerprint       string
}

// EvaluateRender reads the chapter's association, the render file, the saved
// project in view and the ledger. It never measures anything.
func EvaluateRender(store *RenderStore, chapter stages.ChapterContext, view stages.EvidenceView) (RenderStatus, error) {
	association, ok, err := store.Get(chapter.DocumentID, chapter.ChapterID)
	if err != nil {
		return RenderStatus{}, err
	}
	if !ok {
		return RenderStatus{State: RenderNone, Cause: stages.CauseNeverAnalyzed, Reason: "Choose the rendered file for this chapter."}, nil
	}
	status := RenderStatus{Association: &association, Fingerprint: association.Render.Key + "|" + association.ItemsFingerprint}
	render, err := fingerprintRender(association.Path, view.ProjectFolder)
	if err != nil {
		status.State, status.Cause, status.Reason = RenderMissing, stages.CauseMeasurementUnavailable, fmt.Sprintf("The rendered file %s could not be read. Choose the rendered file again.", filepath.Base(association.Path))
		return status, nil
	}
	if render.Key != association.Render.Key {
		status.State, status.Cause, status.Reason = RenderStale, stages.CauseStale, "The rendered file changed since you chose it. Choose it again to say it was made from the chapter as it is now, then measure it."
		return status, nil
	}
	track, problem := chapterTrack(chapter, view)
	if problem != nil {
		status.State, status.Cause, status.Reason = RenderStale, problem.Cause, problem.Reason
		return status, nil
	}
	if track.GUID != association.TrackGUID || itemsFingerprint(track.Items, view.ProjectFolder) != association.ItemsFingerprint {
		status.State, status.Cause, status.Reason = RenderStale, stages.CauseStale, "The chapter's audio changed in the saved project since you chose the rendered file. Render the chapter again and choose the new file."
		return status, nil
	}
	if association.Format != FormatWAV {
		status.State, status.Cause, status.Reason = RenderUnsupported, stages.CauseMeasurementUnavailable, "The rendered file is not a WAV file; only a WAV render is measured. Choose the WAV render the delivered file was made from."
		return status, nil
	}
	status.State = RenderCurrent
	if view.Ledger == nil {
		return status, nil
	}
	records, err := view.Ledger.List(AnalyzerRenderMeasurement, chapter.ChapterID)
	if err != nil {
		return RenderStatus{}, err
	}
	for _, record := range records {
		payload, ok := decodeRenderMeasurement(record)
		if !ok || payload.RenderKey != association.Render.Key || record.Scope.DocumentID != chapter.DocumentID {
			continue
		}
		status.RecordIDs = []string{record.ID}
		if record.Outcome != evidence.LedgerComplete || payload.Report == nil {
			status.MeasurementFailed = true
		} else {
			status.Measurement = &RenderMeasurement{RecordID: record.ID, Report: *payload.Report, MeasuredAt: record.CompletedAt}
		}
		break
	}
	return status, nil
}

// RenderMeasurementPayload is a render measurement ledger record's payload:
// which render (its fingerprint key and path), measure's own whole-file SHA-256
// when it gave one, and the Report (nil for a failed measurement).
type RenderMeasurementPayload struct {
	RenderKey string          `json:"renderKey"`
	Path      string          `json:"path"`
	SHA256    string          `json:"sha256,omitempty"`
	Report    *measure.Report `json:"report,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// RecordRenderMeasurements writes one ledger record for every chapter of
// documentID whose chosen render is the measured file (the same file can be
// chosen for more than one chapter): complete with the Report, or failed with
// measureErr. A file that is no chapter's render writes nothing. It is called
// when the measurement job finishes a file; a cancelled file is not reported.
func RecordRenderMeasurements(ledger *evidence.LedgerStore, store *RenderStore, documentID, projectFolder, path string, report measure.Report, sha256 string, measureErr error, started, completed time.Time) ([]evidence.LedgerRecord, error) {
	if ledger == nil || store == nil || documentID == "" {
		return nil, nil
	}
	associations, err := store.List(documentID)
	if err != nil {
		return nil, err
	}
	render, err := fingerprintRender(path, projectFolder)
	if err != nil {
		return nil, nil
	}
	var written []evidence.LedgerRecord
	for _, association := range associations {
		if association.Render.Key != render.Key {
			continue
		}
		payload := RenderMeasurementPayload{RenderKey: render.Key, Path: path, SHA256: sha256}
		outcome := evidence.LedgerComplete
		if measureErr != nil {
			outcome, payload.Error = evidence.LedgerFailed, measureErr.Error()
		} else {
			measured := report
			payload.Report = &measured
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return written, err
		}
		record, err := ledger.Write(evidence.LedgerRecord{
			AnalyzerID: AnalyzerRenderMeasurement, AnalyzerVersion: renderMeasurementVersion,
			Scope:     evidence.LedgerScope{DocumentID: documentID, ChapterID: association.ChapterID, TrackGUID: association.TrackGUID},
			StartedAt: started.UTC(), CompletedAt: completed.UTC(), Outcome: outcome, Payload: encoded,
		})
		if err != nil {
			return written, err
		}
		written = append(written, record)
	}
	return written, nil
}

func decodeRenderMeasurement(record evidence.LedgerRecord) (RenderMeasurementPayload, bool) {
	var payload RenderMeasurementPayload
	if len(record.Payload) == 0 || json.Unmarshal(record.Payload, &payload) != nil {
		return RenderMeasurementPayload{}, false
	}
	return payload, true
}

func fingerprintRender(path, projectFolder string) (RenderFingerprint, error) {
	identity, err := evidence.Identify(path, projectFolder)
	if err != nil {
		return RenderFingerprint{}, err
	}
	return RenderFingerprint{Path: identity.Path, Size: identity.Size, ModTime: identity.ModTime, PartialHash: identity.PartialHash, Key: identityKey(identity)}, nil
}

// itemsFingerprint is EL's track fingerprint of the chapter's items as the
// saved project has them: each unmuted audio item's position, length, take and
// played source content, in order.
func itemsFingerprint(items []tracks.Item, projectFolder string) string {
	identify := func(source string) (evidence.SourceIdentity, error) {
		if source == "" {
			return evidence.SourceIdentity{}, errors.New("item has no source file")
		}
		return evidence.Identify(source, projectFolder)
	}
	fingerprint, _ := evidence.ComputeChapterFingerprint(items, identify)
	return string(fingerprint.TrackFingerprint)
}

// sniffFormat reads a file's first bytes: RIFF/WAVE is a WAV, an ID3 tag or an
// MPEG audio frame sync is an MP3, anything else is other.
func sniffFormat(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return FormatOther
	}
	defer func() { _ = file.Close() }()
	head := make([]byte, 12)
	n, _ := io.ReadFull(file, head)
	head = head[:n]
	switch {
	case len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WAVE")):
		return FormatWAV
	case len(head) >= 3 && bytes.Equal(head[:3], []byte("ID3")):
		return FormatMP3
	case len(head) >= 2 && head[0] == 0xFF && head[1]&0xE0 == 0xE0:
		return FormatMP3
	}
	return FormatOther
}

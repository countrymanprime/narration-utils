package dawcatalog

// DetectionResult reports whether a catalog entry appears to be installed.
// It is a fact ("detected" / "not detected"), not a launchable path:
// resolving *where* to launch an installed DAW's executable from stays
// apps/desktop/internal/daw's concern (project-workspace-and-daw-link Phase
// 6/8, W11), which this package's Phase 2 UI can hand off to once a DAW is
// detected.
type DetectionResult struct {
	EntryID   string
	Installed bool
	// Path and Source are set only when Installed is true. Source names
	// where the path came from (mirrors apps/desktop/internal/daw's
	// Source* constants, e.g. "uninstall_registry"), so a caller can
	// tell the narrator how confident the detection is.
	Path   string
	Source string
}

// Detector finds one catalog entry's installed executable. Its shape
// (path, source string, err error) matches
// apps/desktop/internal/daw.LocateReaperExecutable exactly, so the real
// production detector can be passed directly (see DefaultDetectors) and a
// test can fake registry/filesystem state without touching either.
type Detector func() (path, source string, err error)

// Detect runs detector for entry and turns its outcome into a
// DetectionResult. Any error, or a detector returning an empty path with no
// error, is reported as not installed — Phase 1 never claims more certainty
// than it has (PRD Technical Risks: a portable, non-registered install is a
// documented soft false negative, and this feature must never block the
// narrator on it). A nil detector (a catalog entry with no working probe
// yet) is likewise reported as not installed rather than panicking.
func Detect(entry Entry, detector Detector) DetectionResult {
	if detector == nil {
		return DetectionResult{EntryID: entry.ID}
	}
	path, source, err := detector()
	if err != nil || path == "" {
		return DetectionResult{EntryID: entry.ID}
	}
	return DetectionResult{EntryID: entry.ID, Installed: true, Path: path, Source: source}
}

// DetectAll runs Detect for every entry, looking up its Detector in
// detectors by Entry.ID. An entry with no matching key gets Detect(entry,
// nil): not installed, not a panic. Order matches entries.
func DetectAll(entries []Entry, detectors map[string]Detector) []DetectionResult {
	results := make([]DetectionResult, len(entries))
	for i, entry := range entries {
		results[i] = Detect(entry, detectors[entry.ID])
	}
	return results
}

// Package dawcatalog holds the hardcoded catalog of digital audio
// workstations this suite can use, and reports on demand whether each one
// appears to be installed.
//
// docs/prds/daw-selection-and-acquisition.prd.md Phase 1. This package never
// downloads, verifies, or executes a DAW installer, and never fetches its
// catalog from anywhere — every entry below is a Go literal, checked in
// code review, per the PRD's Decisions Log ("URL source: hardcoded Go
// constants, one per DAW, never fetched or user-editable"). It answers only
// "is a supported DAW installed" as a fact for a narrator with none; it does
// not decide *how* to launch one (that stays
// apps/desktop/internal/daw's concern, built by
// project-workspace-and-daw-link Phase 6 / ADR 0092, and reused here rather
// than duplicated — see DefaultDetectors in detectors.go).
package dawcatalog

// Entry is one DAW this suite can use: its display copy and its official,
// hardcoded download-page URL. Every field is fixed in Go, never loaded
// from a file a narrator or a remote source could edit (PRD Evidence:
// "a hardcoded, server-side URL per DAW, never anything derived from user
// input or a remote response").
type Entry struct {
	// ID crosses process boundaries (a future Wails binding looks a DAW
	// up by ID, never by a UI-supplied URL, per the PRD's architecture
	// notes) and must be stable and unique within Catalog.
	ID string
	// Name is the DAW's own name, shown to the narrator as-is.
	Name string
	// Publisher is the DAW's publisher, shown so the narrator can verify
	// they are being sent to the real vendor.
	Publisher string
	// LicenseNote is one neutral line about how the DAW is licensed. Per
	// the PRD's Open Question A5 recommendation, this stays factual and
	// does not try to explain or sell the vendor's licensing terms —
	// the vendor's own download page does that.
	LicenseNote string
	// DownloadURL is the DAW publisher's own official download page.
	// Opening it is the only thing this feature ever does with it; the
	// app never fetches it itself (see the package doc).
	DownloadURL string
}

// REAPER is the only catalog entry today. Audacity is deferred until its
// own roadmap precondition is met (PRD Decisions Log: "Audacity's place in
// the catalog"; docs/roadmap.md:59) and is deliberately not listed here as
// "coming soon", per the PRD's recommendation for Open Question A6.
var REAPER = Entry{
	ID:          "reaper",
	Name:        "REAPER",
	Publisher:   "Cockos Incorporated",
	LicenseNote: "A fully-functional evaluation license from the publisher's own site; see their page for terms.",
	DownloadURL: "https://www.reaper.fm/download.php",
}

// Catalog lists every DAW this suite can use today, in display order.
var Catalog = []Entry{REAPER}

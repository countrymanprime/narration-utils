package dawadapter

import (
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// Kind is which DAW a launch names. The host keeps the `--daw` argument as the free-form label the UI shows; Kind is the only
// thing it branches on, so an unknown label can never select behaviour (docs/architecture/threat-model.md, row 6f).
type Kind int

const (
	// KindNone is a launch with no DAW the suite drives: a standalone launch, a picker switch ("Standalone"), a developer
	// launch without --daw, or a label it does not know.
	KindNone Kind = iota
	// KindREAPER is `--daw REAPER`, which NarrationUtils_Launcher.lua always passes.
	KindREAPER
	// KindAudacity is `--daw Audacity` (audacity-integration PRD, Phase 5).
	KindAudacity
)

func (k Kind) String() string {
	switch k {
	case KindREAPER:
		return "REAPER"
	case KindAudacity:
		return "Audacity"
	default:
		return "none"
	}
}

// Classify maps a `--daw` label to the DAW it names, ignoring case and surrounding spaces.
func Classify(label string) Kind {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "reaper":
		return KindREAPER
	case "audacity":
		return KindAudacity
	default:
		return KindNone
	}
}

// NotAvailableError is a DAW the suite recognises but cannot drive yet. Its text is a whole sentence for the narrator (the review
// workflow shows it as the run's message), which is why it is a type rather than an errors.New lower-case fragment.
type NotAvailableError string

func (e NotAvailableError) Error() string { return string(e) }

// ErrAudacityNotAvailable is what every review request answers on an Audacity launch until the Audacity pipe client exists
// (PRD Phase 4, gated on the owner's mod-script-pipe spike S-A1).
const ErrAudacityNotAvailable = NotAvailableError("Audacity support is not available yet. This version can't read audio from Audacity or add labels to it, so open the project from REAPER to compare it.")

// ReviewForDAW picks the review adapter for a launch: on an Audacity launch one that refuses every request with
// ErrAudacityNotAvailable, whatever client is passed; on any other launch ReviewFor(client), the REAPER adapter or nil.
func ReviewForDAW(label string, client *bridge.Client) Review {
	if Classify(label) == KindAudacity {
		return unavailable{err: ErrAudacityNotAvailable}
	}
	return ReviewFor(client)
}

// unavailable is a Review for a DAW the suite recognises but cannot drive yet: every request fails with err, and it never has
// an event to deliver.
type unavailable struct{ err error }

var _ Review = unavailable{}

func (u unavailable) Subscribe(Subscription) (unsubscribe func()) { return func() {} }
func (u unavailable) Dispatch() error                             { return nil }
func (u unavailable) PrepareReview(string) error                  { return u.err }
func (u unavailable) InspectFindings(string, string) error        { return u.err }
func (u unavailable) NavigateToFinding(string, string) error      { return u.err }
func (u unavailable) ExportFindings(string, string, MarkerColors) error {
	return u.err
}

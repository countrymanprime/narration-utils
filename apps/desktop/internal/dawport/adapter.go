// Package dawport is the one way the host reaches an audio engine. An adapter per engine declares a Level
// for each Capability and returns one small role interface for each capability it has; the Resolver alone decides what is
// available now, from that declaration, the runtime state and the narrator's per-capability settings; callers get a role through
// Role[T] and never hold an adapter. Every adapter passes the conformance suite in dawporttest.
package dawport

import "strings"

// Kind is which engine an adapter drives.
type Kind int

const (
	// KindNone is a launch with no DAW the suite drives: a standalone launch, a picker switch ("Standalone"), a developer
	// launch without --daw, or a label it does not know.
	KindNone Kind = iota
	// KindREAPER is `--daw REAPER`, which NarrationStudio_Launcher.lua always passes, or a project that chose REAPER or holds a
	// REAPER project file (ProjectKind).
	KindREAPER
	// KindAudacity is `--daw Audacity`, or a project that chose Audacity.
	KindAudacity
	// KindBuiltIn is the app's own recorder (internal/recording) as the launch's engine: a launch with no DAW whose
	// project chose the built-in recorder (ProjectKind), or `--daw Built-in`.
	KindBuiltIn
)

func (k Kind) String() string {
	switch k {
	case KindREAPER:
		return "REAPER"
	case KindAudacity:
		return "Audacity"
	case KindBuiltIn:
		return "Built-in"
	default:
		return "none"
	}
}

// Classify maps a `--daw` label to the DAW it names, ignoring case and surrounding spaces. The host keeps the label itself as
// the free-form display fact; Classify is the one thing it branches on, so an unknown label can never select behaviour
// (docs/architecture/threat-model.md, row 6f).
func Classify(label string) Kind {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "reaper":
		return KindREAPER
	case "audacity":
		return KindAudacity
	case "built-in", "builtin", "built in":
		return KindBuiltIn
	default:
		return KindNone
	}
}

// Source is where a project's DAW came from (ProjectKind): the launch's label, the narrator's own choice, the project's linked DAW
// file, a DAW project file found in the folder, or the default when the folder holds none.
type Source string

const (
	// SourceLaunch is the launch's `--daw` label, an override while that launch runs.
	SourceLaunch Source = "launch"
	// SourceChosen is the project's own Recording.engine row, the narrator's choice.
	SourceChosen Source = "chosen"
	// SourceLinked is the REAPER project file the project's manifest links.
	SourceLinked Source = "linked"
	// SourceFound is a REAPER project file (.rpp) directly in the project folder.
	SourceFound Source = "found"
	// SourceDefault is a folder with no DAW project: the built-in recorder where it runs, else none.
	SourceDefault Source = "default"
)

// ProjectFacts is what ProjectKind decides from. Every field is the host's own fact, never a label from the page
// (docs/architecture/threat-model.md, row 6f).
type ProjectFacts struct {
	// Label is the launch's `--daw` label ("" or "Standalone" for a launch no DAW started).
	Label string
	// Saved is the project's own Recording.engine row: "reaper", "audacity" or "builtin"; anything else is no choice.
	Saved string
	// Linked is whether the project's manifest links a REAPER project file that still exists.
	Linked bool
	// ProjectFiles is how many REAPER project files (.rpp) sit directly in the project folder.
	ProjectFiles int
	// BuiltinAvailable is whether the built-in recorder's capture row runs here (Windows).
	BuiltinAvailable bool
}

// ProjectKind is the project's engine and why. The launch's label is an override; then the narrator's saved choice (the built-in
// recorder only where it runs); then the folder: a linked file or any .rpp means REAPER, so a folder holding a REAPER project is
// never silently the built-in recorder's; then the built-in recorder where it runs, else none. The host asks this in one place
// (bindings_daw.go) so nothing else decides the project's kind.
func ProjectKind(f ProjectFacts) (Kind, Source) {
	if kind := Classify(f.Label); kind != KindNone {
		return kind, SourceLaunch
	}
	switch kind := Classify(f.Saved); kind {
	case KindREAPER, KindAudacity:
		return kind, SourceChosen
	case KindBuiltIn:
		if f.BuiltinAvailable {
			return kind, SourceChosen
		}
	}
	switch {
	case f.Linked:
		return KindREAPER, SourceLinked
	case f.ProjectFiles > 0:
		return KindREAPER, SourceFound
	case f.BuiltinAvailable:
		return KindBuiltIn, SourceDefault
	}
	return KindNone, SourceDefault
}

// Choosable is every engine a narrator can choose for a project, in the order Settings > Recording lists them.
func Choosable() []Kind { return []Kind{KindREAPER, KindAudacity, KindBuiltIn} }

// SavedValue is k's Recording.engine row value ("reaper", "audacity", "builtin"), or "" for KindNone. Classify reads it back.
func (k Kind) SavedValue() string {
	switch k {
	case KindREAPER:
		return "reaper"
	case KindAudacity:
		return "audacity"
	case KindBuiltIn:
		return "builtin"
	default:
		return ""
	}
}

// IsDAW is whether k is a DAW outside the app (REAPER or Audacity), whose recordings live in the DAW.
func (k Kind) IsDAW() bool { return k == KindREAPER || k == KindAudacity }

// RecordsInApp is whether k is the app's own recorder.
func (k Kind) RecordsInApp() bool { return k == KindBuiltIn }

// RebuildsServices is whether moving a project from engine a to engine b changes the services the host builds when it attaches the
// project (an Audacity project gets Audacity's review refusal and backups), so the host attaches it again.
func RebuildsServices(a, b Kind) bool { return (a == KindAudacity) != (b == KindAudacity) }

// LinksProjectFile is whether k keeps its project in a file the app links (a REAPER .rpp, ProjectLinkDawFile).
func (k Kind) LinksProjectFile() bool { return k == KindREAPER }

// IsREAPERLaunch reports whether daw (the launch's own `daw` fact) names a live REAPER launch. It is the one place outside this
// package allowed to ask "is this REAPER" at all (boundary_test.go enforces it): a caller with a narrower question asks the
// resolver for a capability instead, but the launch's own identity (dawfacts.go's linked-launch case, app.go's
// unresolved-project-file wording) is still Kind.
func IsREAPERLaunch(daw string) bool {
	return Classify(daw) == KindREAPER
}

// Adapter is one engine. It only declares and implements: whether a capability can be used now is the Resolver's answer, never the
// adapter's.
type Adapter interface {
	Kind() Kind
	// Declares is the most this engine can do, per capability. It is static: the same map on every call. A capability left out is
	// Unsupported.
	Declares() map[Capability]Level
	// Role is the capability's role interface (its Spec.Role), non-nil for every capability declared Experimental or Supported,
	// and nil otherwise.
	Role(c Capability) any
}

// Explainer is an adapter that words its own refusals, for example Audacity's "not available yet" sentence or REAPER's
// "open this app from the Narration Utils action in REAPER". An empty answer falls back to the resolver's wording.
type Explainer interface {
	Explain(c Capability, r Reason) string
}

// Package deliveryprofile holds the delivery profiles a project's rendered files are judged against
// (docs/prds/delivery-platform-profiles.prd.md): a named, versioned set of rules, each citing the platform requirement it
// enforces and saying whether the app checks it, cannot check it yet, or leaves it to the narrator's ears. One built-in
// profile ships, ACX (acx@2026-09); a custom profile is a copy of a built-in with changed numbers or rules turned off.
//
// Evaluation is rule by rule, so a result tells met from not met from not measurable from not checked by the app: a
// rule the app cannot check is listed, never counted as met.
package deliveryprofile

import (
	"fmt"
	"strings"
	"time"
)

// Scope says what a rule is judged over: each measured file, or the set of files (the book).
type Scope string

const (
	ScopeFile Scope = "file"
	ScopeBook Scope = "book"
)

// Level says what a miss is: an error finding (required) or a warning (advice).
type Level string

const (
	LevelRequired Level = "required"
	LevelAdvice   Level = "advice"
)

// CheckedBy says how the app checks a rule: by measuring it, not yet (with why), or not at all (a listening check).
type CheckedBy string

const (
	CheckedMeasured CheckedBy = "measured"
	CheckedNotYet   CheckedBy = "not_yet"
	CheckedListen   CheckedBy = "listen"
)

// Verification says how a rule's requirement was established: read on the platform's own page on the date given
// (verified), from a secondary source only (to_verify), or read differently by different sources (conflicting, with
// the conflict and the reading the rule judges in the note).
type Verification string

const (
	Verified    Verification = "verified"
	ToVerify    Verification = "to_verify"
	Conflicting Verification = "conflicting"
)

// Source is where a rule's requirement comes from. Requirement is the platform's requirement as recorded; Quoted says
// whether it is the page's own words (a paraphrase otherwise).
type Source struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Requirement string `json:"requirement"`
	Quoted      bool   `json:"quoted"`
	ReadOn      string `json:"readOn"`
}

// Advice is a second, softer check on a rule: a value of Metric above Max adds Text to the result, and a warning.
type Advice struct {
	Metric string  `json:"metric"`
	Max    float64 `json:"max"`
	Unit   string  `json:"unit"`
	Text   string  `json:"text"`
}

// Rule is one requirement of a profile. A measured rule has a Metric and a bound: Min and/or Max (inclusive), or
// OneOf; a book rule may also require the value to be the same in every file. Off is set only on a custom profile's
// copy of a rule the narrator turned off: it is listed as off and never judged.
type Rule struct {
	ID     string    `json:"id"`
	Label  string    `json:"label"`
	Scope  Scope     `json:"scope"`
	Metric string    `json:"metric"`
	Unit   string    `json:"unit"`
	Min    *float64  `json:"min"`
	Max    *float64  `json:"max"`
	OneOf  []float64 `json:"oneOf"`
	// BoundText describes a bound the numbers cannot hold ("192 kbps+ CBR"); empty when Min, Max or OneOf say it all.
	BoundText        string       `json:"boundText,omitempty"`
	SameAcrossFiles  bool         `json:"sameAcrossFiles"`
	Advice           *Advice      `json:"advice"`
	Level            Level        `json:"level"`
	CheckedBy        CheckedBy    `json:"checkedBy"`
	NotCheckedWhy    string       `json:"notCheckedWhy,omitempty"`
	Source           Source       `json:"source"`
	Verification     Verification `json:"verification"`
	VerificationNote string       `json:"verificationNote,omitempty"`
	Off              bool         `json:"off,omitempty"`
}

// Adjustable reports whether a custom copy may change the rule's numbers: only a file rule's Min/Max range. Any rule
// may be turned off; none may be added (a copy cannot add a kind of rule the app does not check).
func (r Rule) Adjustable() bool {
	return r.Scope == ScopeFile && r.CheckedBy != CheckedListen && (r.Min != nil || r.Max != nil) && len(r.OneOf) == 0
}

// Profile is a named, versioned set of rules. A built-in's Version is the date its platform's page was read
// (YYYY-MM), so a report says exactly which rules judged it; a custom profile's Revision counts its saves.
type Profile struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Revision int    `json:"revision"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
	BuiltIn  bool   `json:"builtIn"`
	BasedOn  string `json:"basedOn,omitempty"`
	// Note says where a custom profile came from ("moved from your old Delivery limits"); empty on a built-in.
	Note   string `json:"note,omitempty"`
	Source Source `json:"source"`
	Rules  []Rule `json:"rules"`
}

// Key names one version of a profile: id@version for a built-in, id@r<revision> for a custom profile.
func (p Profile) Key() string {
	if p.BuiltIn {
		return p.ID + "@" + p.Version
	}
	return fmt.Sprintf("%s@r%d", p.ID, p.Revision)
}

// Title is how the page and the report name the profile: "ACX (September 2026)", or a custom profile's own name.
func (p Profile) Title() string {
	if !p.BuiltIn {
		return p.Name
	}
	if month, err := time.Parse("2006-01", p.Version); err == nil {
		return fmt.Sprintf("%s (%s)", p.Name, month.Format("January 2006"))
	}
	return fmt.Sprintf("%s (%s)", p.Name, p.Version)
}

// Rule finds a rule by id.
func (p Profile) Rule(id string) (Rule, bool) {
	for _, rule := range p.Rules {
		if rule.ID == id {
			return rule, true
		}
	}
	return Rule{}, false
}

// Clone copies a profile deeply, so a copy's numbers can change without touching the built-in.
func (p Profile) Clone() Profile {
	out := p
	out.Rules = make([]Rule, len(p.Rules))
	for i, rule := range p.Rules {
		out.Rules[i] = rule.clone()
	}
	return out
}

func (r Rule) clone() Rule {
	out := r
	out.Min, out.Max = copyFloat(r.Min), copyFloat(r.Max)
	out.OneOf = append([]float64(nil), r.OneOf...)
	if r.Advice != nil {
		advice := *r.Advice
		out.Advice = &advice
	}
	return out
}

func copyFloat(v *float64) *float64 {
	if v == nil {
		return nil
	}
	value := *v
	return &value
}

// Ref is a saved choice of profile: a built-in's id and version, or a custom profile's id (a custom profile always
// judges with its latest revision, so its Version is empty).
type Ref struct {
	ID      string `json:"id"`
	Version string `json:"version,omitempty"`
}

// ParseKey reads "acx@2026-09" or a bare id into a Ref.
func ParseKey(key string) Ref {
	id, version, _ := strings.Cut(key, "@")
	return Ref{ID: id, Version: version}
}

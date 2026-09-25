package credits

import (
	"fmt"
	"sort"
	"strings"
)

// SetupField is one token the credits setup prompt asks for (credits-token-setup-and-front-matter-detection PRD
// Phase 2): Token is its render name ("Copyright Holder"), Field the Values JSON key the save takes
// ("copyrightHolder"), and Candidate the detected value to prefill, when Detect found one.
type SetupField struct {
	Token     string     `json:"token"`
	Field     string     `json:"field"`
	Candidate *Candidate `json:"candidate"`
}

// setupTokenFields maps each render token a narrator can set to its Values JSON key. [Chapter] and [Chapter Title]
// are computed per chapter (ADR 0151), so they are never asked for.
var setupTokenFields = map[string]string{
	"Title": "title", "Subtitle": "subtitle", "Author": "author", "Series": "series", "Book Number": "bookNumber",
	"Copyright": "copyright", "Year": "year", "Copyright Holder": "copyrightHolder", "Publisher": "publisher",
	"Narrator": "narrator",
}

// SetupFields is what the prompt asks for (CS4 A): the tokens the first opening and the first closing template (the
// credits the app reads, ADR 0093) leave unresolved with the project's values and the global narrator, in the order
// they first appear, each with its detected candidate. Tokens only other templates use are left to Settings.
func SetupFields(templates []Template, values Values, globalNarrator string, candidates []Candidate) []SetupField {
	tokens := values.Resolve(globalNarrator)
	byToken := make(map[string]Candidate, len(candidates))
	for _, candidate := range candidates {
		byToken[candidate.Token] = candidate
	}
	fields := []SetupField{}
	seen := map[string]bool{}
	for _, kind := range []string{"opening", "closing"} {
		for _, template := range templates {
			if template.Kind != kind {
				continue
			}
			for _, name := range Render(template.Body, tokens).Unresolved {
				field, ok := setupTokenFields[name]
				if !ok || seen[name] {
					continue
				}
				seen[name] = true
				setup := SetupField{Token: name, Field: field}
				if candidate, found := byToken[candidateToken(field)]; found {
					setup.Candidate = &candidate
				}
				fields = append(fields, setup)
			}
			break // only the first template of each kind is read
		}
	}
	return fields
}

// candidateToken is the Candidate.Token for a Values JSON key ("copyrightHolder" -> "CopyrightHolder").
func candidateToken(field string) string { return strings.ToUpper(field[:1]) + field[1:] }

// OpenCandidates drops the candidates for tokens values already sets: a set value is never offered a replacement.
func OpenCandidates(candidates []Candidate, values Values) []Candidate {
	set := values.byField()
	open := []Candidate{}
	for _, candidate := range candidates {
		field := strings.ToLower(candidate.Token[:1]) + candidate.Token[1:]
		if set[field] == "" {
			open = append(open, candidate)
		}
	}
	return open
}

// FillEmpty sets each named field (Values JSON keys) that is empty in v to its trimmed value, never replacing a value
// already set and ignoring empty ones. It returns the filled values and the fields it changed, sorted. An unknown
// field is an error.
func (v Values) FillEmpty(fields map[string]string) (Values, []string, error) {
	current := v.byField()
	changed := []string{}
	for field, value := range fields {
		if _, known := current[field]; !known {
			return v, nil, fmt.Errorf("unknown credits field %q", field)
		}
		value = strings.TrimSpace(value)
		if value == "" || current[field] != "" {
			continue
		}
		current[field] = value
		changed = append(changed, field)
	}
	sort.Strings(changed)
	return Values{
		Title: current["title"], Subtitle: current["subtitle"], Author: current["author"], Series: current["series"],
		BookNumber: current["bookNumber"], Copyright: current["copyright"], Year: current["year"],
		CopyrightHolder: current["copyrightHolder"], Publisher: current["publisher"], Narrator: current["narrator"],
	}, changed, nil
}

// byField is v keyed by its JSON field names.
func (v Values) byField() map[string]string {
	return map[string]string{
		"title": v.Title, "subtitle": v.Subtitle, "author": v.Author, "series": v.Series, "bookNumber": v.BookNumber,
		"copyright": v.Copyright, "year": v.Year, "copyrightHolder": v.CopyrightHolder, "publisher": v.Publisher,
		"narrator": v.Narrator,
	}
}

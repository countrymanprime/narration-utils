package importer

import (
	"regexp"
	"strings"
)

// epubCSSRule matches one "<selector-list> { <body> }" rule. It is a
// deliberately light-weight scan, not a CSS parser: exporter stylesheets
// (Calibre, Vellum, Sigil) write one selector and one or two declarations
// per formatting class, and that is the only shape E3 (Phase 3) asks to
// recognize.
var epubCSSRule = regexp.MustCompile(`([^{}]+)\{([^{}]*)\}`)

// epubCSSClassSelector matches a bare single-class selector such as
// ".italic" - not a compound (".foo.bar"), tag-qualified ("p.foo") or
// descendant selector, which stay unresolved (E3: "anything else is text
// without a span and a count in Notices").
var epubCSSClassSelector = regexp.MustCompile(`^\.([A-Za-z0-9_-]+)$`)

// parseEPUBCSSClasses reads a stylesheet's simple single-class,
// single-declaration font-style/font-weight rules into a class -> Style map
// (E3's Phase 3 scope), and separately reports every class name that names a
// real rule but was not reduced to a Style bit (a multi-declaration rule, a
// property this importer does not model, or a compound selector) so the
// caller can count it in Notices rather than silently drop it.
func parseEPUBCSSClasses(css string) (styles map[string]Style, unresolved map[string]bool) {
	styles = map[string]Style{}
	unresolved = map[string]bool{}
	for _, rule := range epubCSSRule.FindAllStringSubmatch(css, -1) {
		selectors := strings.Split(rule[1], ",")
		declarations := epubCSSDeclarations(rule[2])
		for _, selector := range selectors {
			match := epubCSSClassSelector.FindStringSubmatch(strings.TrimSpace(selector))
			if match == nil {
				continue
			}
			class := match[1]
			if bit, ok := epubCSSSingleDeclarationStyle(declarations); ok {
				styles[class] |= bit
			} else if len(declarations) > 0 {
				unresolved[class] = true
			}
		}
	}
	for class := range styles {
		delete(unresolved, class)
	}
	return styles, unresolved
}

// epubCSSDeclarations splits a rule body into trimmed, non-empty
// "property:value" pairs.
func epubCSSDeclarations(body string) [][2]string {
	var out [][2]string
	for _, part := range strings.Split(body, ";") {
		property, value, found := strings.Cut(part, ":")
		if !found {
			continue
		}
		property = strings.ToLower(strings.TrimSpace(property))
		value = strings.ToLower(strings.TrimSpace(value))
		if property == "" || value == "" {
			continue
		}
		out = append(out, [2]string{property, value})
	}
	return out
}

// epubCSSSingleDeclarationStyle reports the Style a rule body implies when it
// carries exactly one declaration and that declaration is a recognized
// font-style or font-weight value (E3: "single-class font-style/font-weight
// rules"; anything with more than one declaration, or an unrecognized
// property or value, is not mapped).
func epubCSSSingleDeclarationStyle(declarations [][2]string) (Style, bool) {
	if len(declarations) != 1 {
		return 0, false
	}
	property, value := declarations[0][0], declarations[0][1]
	switch property {
	case "font-style":
		if value == "italic" || value == "oblique" {
			return styleItalic, true
		}
	case "font-weight":
		switch value {
		case "bold", "bolder", "700", "800", "900":
			return styleBold, true
		}
	}
	return 0, false
}

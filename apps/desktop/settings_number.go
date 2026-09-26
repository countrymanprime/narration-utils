package main

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
)

// numberSpec is the range of a "number" setting: an inclusive minimum and maximum, a step the value must sit on
// (counted from the minimum, or from zero when there is none), and the unit the page shows beside the box. A nil bound
// or step is unbounded. It is kept beside fieldSchemas, keyed by tool and key, rather than in fieldSchema itself, so
// adding the kind did not rewrite every existing field literal (docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md
// Phase 2); TestEveryNumberFieldHasARangeAndEveryRangeAField keeps the two in step.
type numberSpec struct {
	min, max, step *float64
	unit           string
}

func bound(value float64) *float64 { return &value }

var numberSpecs = map[string]map[string]numberSpec{
	// The recording check's settings (docs/utilities/recording-coverage.md Q3). The ranges keep a typo out: a share is a
	// fraction of the paragraph's words, the runs are whole words, and an anchor is at least one word.
	"RecordingCoverage": {
		"min_paragraph_present": {min: bound(0), max: bound(1), step: bound(0.01)},
		"max_missing_run":       {min: bound(0), max: bound(200), step: bound(1), unit: "words"},
		"max_misread_run":       {min: bound(0), max: bound(200), step: bound(1), unit: "words"},
		"min_anchor_run":        {min: bound(1), max: bound(50), step: bound(1), unit: "words"},
	},
	// Editing's three policy values (docs/prds/editing-readiness-analysis.prd.md Phase 3, Q2, Q3) are seconds, at
	// least 0 (a negative gap makes no sense) with no declared maximum (a narrator's own tolerance for a long dramatic
	// pause is not this range's business to cap) and a 0.1 s step, fine enough for a hold that is itself in the tens
	// or hundreds of milliseconds. Leaving the field blank (no builtinDefaults entry for "Editing") is what keeps it
	// unset (Store.Effective's own fallback), never validated as a number until the narrator actually sets one.
	"Editing": {
		"max_gap_seconds":  {min: bound(0), step: bound(0.1), unit: "s"},
		"head_max_seconds": {min: bound(0), step: bound(0.1), unit: "s"},
		"tail_max_seconds": {min: bound(0), step: bound(0.1), unit: "s"},
	},
	// The proofing render length tolerance (proofing-readiness-signals.prd.md Q9 C) is seconds, at least 0, with no
	// declared maximum and a 0.1 s step; blank (no default) keeps the length check not required.
	"Proofing": {
		"render_length_tolerance_seconds": {min: bound(0), step: bound(0.1), unit: "s"},
	},
}

// wire is the range as the Settings page receives it (the `number` object of a ScopedSettingField).
func (spec numberSpec) wire() map[string]any {
	optional := func(value *float64) any {
		if value == nil {
			return nil
		}
		return *value
	}
	return map[string]any{"min": optional(spec.min), "max": optional(spec.max), "step": optional(spec.step), "unit": spec.unit}
}

// plainNumber is a decimal written the way a person types one: an optional minus, digits, an optional fraction. No
// exponent, hex float, NaN, Inf, plus sign, spaces or unit, all of which strconv.ParseFloat would otherwise accept or
// the page could not show back as typed.
var plainNumber = regexp.MustCompile(`^-?(\d+(\.\d*)?|\.\d+)$`)

// stepTolerance absorbs the binary error of a decimal step (0.1 is not exact), relative to the number of steps.
const stepTolerance = 1e-9

func validateNumberSetting(key string, spec numberSpec, value string) error {
	if !plainNumber.MatchString(value) {
		return fmt.Errorf("setting %s must be a number, like -3 or 0.5", key)
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsInf(number, 0) {
		return fmt.Errorf("setting %s must be a number, like -3 or 0.5", key)
	}
	if (spec.min != nil && number < *spec.min) || (spec.max != nil && number > *spec.max) {
		return fmt.Errorf("setting %s must be %s", key, describeRange(spec))
	}
	if spec.step != nil && *spec.step > 0 {
		origin := 0.0
		if spec.min != nil {
			origin = *spec.min
		}
		steps := (number - origin) / *spec.step
		if math.Abs(steps-math.Round(steps)) > stepTolerance*math.Max(1, math.Abs(steps)) {
			return fmt.Errorf("setting %s must go in steps of %s", key, formatNumber(*spec.step))
		}
	}
	return nil
}

func describeRange(spec numberSpec) string {
	unit := ""
	if spec.unit != "" {
		unit = " " + spec.unit
	}
	switch {
	case spec.min != nil && spec.max != nil:
		return fmt.Sprintf("between %s and %s%s", formatNumber(*spec.min), formatNumber(*spec.max), unit)
	case spec.min != nil:
		return fmt.Sprintf("at least %s%s", formatNumber(*spec.min), unit)
	default:
		return fmt.Sprintf("at most %s%s", formatNumber(*spec.max), unit)
	}
}

func formatNumber(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }

func schemaFor(tool, key string) (fieldSchema, bool) {
	for _, schema := range fieldSchemas[tool] {
		if schema.key == key {
			return schema, true
		}
	}
	return fieldSchema{}, false
}

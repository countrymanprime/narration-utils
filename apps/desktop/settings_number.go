package main

import (
	"fmt"
	"math"
	"regexp"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
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

// The narrator's own delivery limits (Open Questions 1 and 9 of the diagnostics PRD, both on their recommendation, D22):
// one limit set per settings layer, no built-in numbers (config/defaults.json's Delivery section is empty, ADR 0025).
// The ranges only keep a typo out; they are not advice.
var numberSpecs = map[string]map[string]numberSpec{
	"Delivery": {
		"integrated_lufs_min":  {min: bound(-70), max: bound(0), step: bound(0.1), unit: "LUFS"},
		"integrated_lufs_max":  {min: bound(-70), max: bound(0), step: bound(0.1), unit: "LUFS"},
		"rms_dbfs_min":         {min: bound(-100), max: bound(0), step: bound(0.1), unit: "dBFS"},
		"rms_dbfs_max":         {min: bound(-100), max: bound(0), step: bound(0.1), unit: "dBFS"},
		"sample_peak_dbfs_max": {min: bound(-60), max: bound(0), step: bound(0.1), unit: "dBFS"},
		"true_peak_dbtp_max":   {min: bound(-60), max: bound(0), step: bound(0.1), unit: "dBTP"},
		"noise_floor_dbfs_max": {min: bound(-120), max: bound(0), step: bound(0.1), unit: "dBFS"},
	},
}

// numberPairs are a tool's lowest and highest keys of one quantity: the effective lowest may not be above the effective
// highest once a save lands.
var numberPairs = map[string][][2]string{"Delivery": measure.LimitPairs()}

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

// checkNumberPairs refuses a save that would leave a pair's effective lowest above its effective highest, looking at
// every layer as it will be once the save lands: a project maximum is compared with the global minimum beneath it, and a
// global change with the project override that stays on top of it.
func (h *Host) checkNumberPairs(tool, scope string, values map[string]*string) error {
	for _, pair := range numberPairs[tool] {
		lowText := h.valueAfterSave(tool, scope, pair[0], values)
		highText := h.valueAfterSave(tool, scope, pair[1], values)
		if lowText == "" || highText == "" {
			continue
		}
		low, lowErr := strconv.ParseFloat(lowText, 64)
		high, highErr := strconv.ParseFloat(highText, 64)
		if lowErr != nil || highErr != nil || low <= high {
			continue
		}
		lowField, _ := schemaFor(tool, pair[0])
		highField, _ := schemaFor(tool, pair[1])
		return fmt.Errorf("%s (%s) is above %s (%s)", lowField.label, lowText, highField.label, highText)
	}
	return nil
}

// valueAfterSave is key's effective value once values are saved to scope. A nil value removes the key from that scope.
func (h *Host) valueAfterSave(tool, scope, key string, values map[string]*string) string {
	store := h.services().settings
	layers := []struct {
		name   string
		values map[string]string
	}{{"project", store.Project(tool)}, {"global", store.Global(tool)}, {"repo_default", store.Defaults(tool)}}
	for _, layer := range layers {
		if layer.name == scope {
			if change, changed := values[key]; changed {
				if change != nil {
					return *change
				}
				continue
			}
		}
		if value, ok := layer.values[key]; ok {
			return value
		}
	}
	return ""
}

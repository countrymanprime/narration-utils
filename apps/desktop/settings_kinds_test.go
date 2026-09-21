package main

import (
	"strings"
	"testing"
)

// A setting's value is always a string in the settings files, so each kind says which strings it accepts.
func TestValidateSettingValueAcceptsWhatEachKindStores(t *testing.T) {
	choice := fieldSchema{key: "model_size", label: "Model", kind: "choice", choices: []string{"tiny", "small"}}
	color := fieldSchema{key: "color_note", label: "Note color", kind: "color"}
	flag := fieldSchema{key: "notify", label: "Notify", kind: "bool"}

	cases := []struct {
		name    string
		schema  fieldSchema
		value   string
		wantErr string
	}{
		{"choice in the list", choice, "small", ""},
		{"choice not in the list", choice, "huge", "unsupported value for model_size"},
		{"choice empty", choice, "", "unsupported value for model_size"},
		{"color six hex digits", color, "B85C1E", ""},
		{"color lower case", color, "b85c1e", ""},
		{"color too short", color, "B85C1", "must be a six-digit color"},
		{"color not hex", color, "ZZZZZZ", "must be a six-digit color"},
		{"bool true", flag, "true", ""},
		{"bool false", flag, "false", ""},
		{"bool empty", flag, "", "must be true or false"},
		{"bool capitalised", flag, "True", "must be true or false"},
		{"bool a number", flag, "1", "must be true or false"},
		{"bool yes", flag, "yes", "must be true or false"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateSettingValue(tc.schema, tc.value)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("validateSettingValue(%q) = %v, want no error", tc.value, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("validateSettingValue(%q) = %v, want an error containing %q", tc.value, err, tc.wantErr)
			}
		})
	}
}

// A kind the host does not know must fail closed: an unchecked value would be written to the settings file as it came.
func TestValidateSettingValueRejectsAnUnknownKind(t *testing.T) {
	err := validateSettingValue(fieldSchema{key: "x", label: "X", kind: "number"}, "3")
	if err == nil || !strings.Contains(err.Error(), "unsupported setting kind") {
		t.Fatalf("got %v, want an unsupported setting kind error", err)
	}
}

// The wire kinds the UI is written against; changing one is a contract change (hostAPIVersion).
func TestFieldSchemasUseOnlyKindsTheUIKnows(t *testing.T) {
	known := map[string]bool{"choice": true, "color": true, "text": true, "bool": true}
	for tool, schemas := range fieldSchemas {
		for _, schema := range schemas {
			if !known[schema.kind] {
				t.Errorf("%s.%s has kind %q, which the UI's ScopedSettingField does not know", tool, schema.key, schema.kind)
			}
		}
	}
}

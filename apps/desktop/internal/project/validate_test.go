package project

import "testing"

func TestValidateNameAcceptsAnOrdinaryName(t *testing.T) {
	if err := ValidateName("Alice's Adventures"); err != nil {
		t.Fatalf("ValidateName() error = %v, want nil", err)
	}
}

func TestValidateNameTrimsSurroundingWhitespace(t *testing.T) {
	if err := ValidateName("  Alice  "); err != nil {
		t.Fatalf("ValidateName() error = %v, want nil", err)
	}
}

func TestValidateNameRejectsEmpty(t *testing.T) {
	if err := ValidateName(""); err == nil {
		t.Fatal("ValidateName(\"\") error = nil, want an error")
	}
}

func TestValidateNameRejectsWhitespaceOnly(t *testing.T) {
	if err := ValidateName("   "); err == nil {
		t.Fatal("ValidateName(\"   \") error = nil, want an error")
	}
}

func TestValidateNameRejectsDotAndDotDot(t *testing.T) {
	for _, name := range []string{".", ".."} {
		if err := ValidateName(name); err == nil {
			t.Fatalf("ValidateName(%q) error = nil, want an error", name)
		}
	}
}

func TestValidateNameRejectsWindowsIllegalCharacters(t *testing.T) {
	for _, illegal := range []string{"<", ">", ":", `"`, "/", `\`, "|", "?", "*"} {
		name := "Alice" + illegal
		if err := ValidateName(name); err == nil {
			t.Fatalf("ValidateName(%q) error = nil, want an error for the illegal character %q", name, illegal)
		}
	}
}

func TestValidateNameRejectsControlCharacters(t *testing.T) {
	if err := ValidateName("Alice\x01book"); err == nil {
		t.Fatal("ValidateName() error = nil, want an error for a control character")
	}
}

func TestValidateNameRejectsReservedWindowsDeviceNames(t *testing.T) {
	for _, name := range []string{"CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"} {
		if err := ValidateName(name); err == nil {
			t.Fatalf("ValidateName(%q) error = nil, want an error for a reserved device name", name)
		}
	}
}

func TestValidateNameRejectsAReservedNameWithAnExtension(t *testing.T) {
	if err := ValidateName("CON.txt"); err == nil {
		t.Fatal("ValidateName(\"CON.txt\") error = nil, want an error")
	}
}

func TestValidateNameAcceptsANameThatOnlyStartsWithAReservedPrefix(t *testing.T) {
	if err := ValidateName("Constantinople"); err != nil {
		t.Fatalf("ValidateName() error = %v, want nil (not an exact reserved-name match)", err)
	}
}

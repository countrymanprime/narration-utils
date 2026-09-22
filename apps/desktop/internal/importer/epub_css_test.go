package importer

import "testing"

func TestParseEPUBCSSClassesMapsSingleDeclarationFontStyleAndWeight(t *testing.T) {
	styles, unresolved := parseEPUBCSSClasses(`.italic { font-style: italic; } .bold{font-weight:bold}`)
	if styles["italic"] != styleItalic {
		t.Fatalf("italic class style = %v", styles["italic"])
	}
	if styles["bold"] != styleBold {
		t.Fatalf("bold class style = %v", styles["bold"])
	}
	if len(unresolved) != 0 {
		t.Fatalf("expected no unresolved classes, got %#v", unresolved)
	}
}

func TestParseEPUBCSSClassesCombinesTwoSingleDeclarationRulesForOneClass(t *testing.T) {
	styles, _ := parseEPUBCSSClasses(`.calibre1{font-style:italic} .calibre1{font-weight:bold}`)
	if styles["calibre1"] != styleItalic|styleBold {
		t.Fatalf("calibre1 style = %v", styles["calibre1"])
	}
}

func TestParseEPUBCSSClassesLeavesMultiDeclarationRulesUnresolved(t *testing.T) {
	styles, unresolved := parseEPUBCSSClasses(`.fancy { font-style: italic; color: red; }`)
	if _, mapped := styles["fancy"]; mapped {
		t.Fatalf("a multi-declaration rule must not be reduced to a Style, got %v", styles["fancy"])
	}
	if !unresolved["fancy"] {
		t.Fatalf("expected \"fancy\" to be reported unresolved, got %#v", unresolved)
	}
}

func TestParseEPUBCSSClassesIgnoresCompoundAndTagSelectors(t *testing.T) {
	styles, unresolved := parseEPUBCSSClasses(`p.italic { font-style: italic; } .a.b { font-weight: bold; }`)
	if len(styles) != 0 {
		t.Fatalf("expected no classes mapped from compound selectors, got %#v", styles)
	}
	if len(unresolved) != 0 {
		t.Fatalf("compound selectors are not simple class rules at all, expected no unresolved report, got %#v", unresolved)
	}
}

func TestParseEPUBCSSClassesIgnoresUnrecognizedProperties(t *testing.T) {
	styles, unresolved := parseEPUBCSSClasses(`.big { font-size: 200%; }`)
	if len(styles) != 0 {
		t.Fatalf("expected no style mapped, got %#v", styles)
	}
	if !unresolved["big"] {
		t.Fatalf("expected \"big\" to be reported unresolved, got %#v", unresolved)
	}
}

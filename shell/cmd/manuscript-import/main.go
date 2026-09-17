package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
)

func main() {
	source := flag.String("source", "", "source manuscript")
	heading := flag.Int("markdown-heading-level", 1, "Markdown chapter heading level")
	out := flag.String("out", "", "write draft JSON to this file")
	flag.Parse()
	if *source == "" {
		fmt.Fprintln(os.Stderr, "--source is required")
		os.Exit(1)
	}
	if strings.EqualFold(filepath.Ext(*source), ".pdf") {
		fmt.Fprintln(os.Stderr, "PDF import is temporarily unavailable pending the approved corpus parity gate. Use DOCX or Markdown.")
		os.Exit(1)
	}
	draft, err := importer.BuildDraft(*source, *heading)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoded, err := json.Marshal(draft)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not serialize the parsed manuscript:", err)
		os.Exit(1)
	}
	if *out != "" {
		if err := os.WriteFile(*out, encoded, 0o600); err != nil {
			fmt.Fprintf(os.Stderr, "Could not write %s: %v\n", *out, err)
			os.Exit(1)
		}
		return
	}
	fmt.Println(string(encoded))
}

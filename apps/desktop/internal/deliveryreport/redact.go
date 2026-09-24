package deliveryreport

import (
	"regexp"
	"slices"
	"strings"
)

// removedPath replaces an absolute path the report does not know by name.
const removedPath = "[path removed]"

// absolutePath finds what is left of an absolute path after the known ones are replaced: a drive path (C:\ or C:/), a
// UNC path (\\server\share), or a Unix home or volume path. It runs to the next space, quote or bracket, so a
// path with spaces in a folder name loses its tail to the next word at worst; it is a backstop, not the main redaction.
var absolutePath = regexp.MustCompile(`(?i)(?:\b[a-z]:[\\/]|\\\\[^\\/\s"'<>]+[\\/]|/(?:users|home|volumes|mnt|media|tmp|private|var)/)[^\s"'<>]*`)

// scrubber takes local paths out of free text when the narrator did not include them: every known file path becomes the
// file's name, its folder becomes "[folder]", and any other absolute path is removed.
type scrubber struct {
	keep         bool
	replacements []string
}

func newScrubber(in Input) scrubber {
	if in.Options.IncludePaths {
		return scrubber{keep: true}
	}
	type pair struct{ from, to string }
	pairs := []pair{}
	add := func(path string) {
		if path == "" {
			return
		}
		name := baseName(path)
		for _, form := range []string{path, strings.ReplaceAll(path, `\`, "/"), strings.ReplaceAll(path, "/", `\`)} {
			pairs = append(pairs, pair{form, name})
			if dir := strings.TrimRight(form[:len(form)-len(name)], `\/`); dir != "" {
				pairs = append(pairs, pair{dir, "[folder]"})
			}
		}
	}
	for _, file := range in.Measured {
		add(file.Path)
	}
	for _, file := range in.Checked {
		add(file.Path)
	}
	for _, asset := range in.Assets {
		add(asset.Path)
	}
	// Longest first, so a file's full path is replaced before its folder.
	slices.SortStableFunc(pairs, func(a, b pair) int { return len(b.from) - len(a.from) })
	replacements := []string{}
	for _, p := range pairs {
		replacements = append(replacements, p.from, p.to)
	}
	return scrubber{replacements: replacements}
}

func (s scrubber) text(value string) string {
	if s.keep || value == "" {
		return value
	}
	if len(s.replacements) > 0 {
		value = strings.NewReplacer(s.replacements...).Replace(value)
	}
	return absolutePath.ReplaceAllString(value, removedPath)
}

// evidence scrubs every string in a finding's evidence, however deep, and returns a copy.
func (s scrubber) evidence(evidence map[string]any) map[string]any {
	if evidence == nil {
		return nil
	}
	out := make(map[string]any, len(evidence))
	for key, value := range evidence {
		out[key] = s.value(value)
	}
	return out
}

func (s scrubber) value(value any) any {
	switch typed := value.(type) {
	case string:
		return s.text(typed)
	case map[string]any:
		return s.evidence(typed)
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = s.value(item)
		}
		return out
	case []string:
		out := make([]string, len(typed))
		for i, item := range typed {
			out[i] = s.text(item)
		}
		return out
	}
	return value
}

// baseName is the last element of a Windows or a Unix path, whichever system the report is built on.
func baseName(path string) string {
	return path[strings.LastIndexAny(path, `\/`)+1:]
}

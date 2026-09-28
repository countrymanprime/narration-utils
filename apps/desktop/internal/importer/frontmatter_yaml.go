package importer

import "strings"

// maxYAMLFrontMatterFenceLines bounds how far extractYAMLFrontMatter searches for a closing "---" fence, so a
// hostile or malformed file with an opening fence and no closing one cannot make an unbounded scan of the whole
// file look like part of parsing every import (real front matter blocks run to a handful of lines).
const maxYAMLFrontMatterFenceLines = 200

// extractYAMLFrontMatter reads a leading YAML front matter fence ("---" ... "---") from a Markdown file's content
// (credits-token-setup-and-front-matter-detection.prd.md, Phase 4) and returns the title/author/series keys it
// recognizes plus the content with the whole fence removed. It returns a nil SourceMetadata, and the content
// unchanged, when the file has no opening fence, the fence never closes within maxYAMLFrontMatterFenceLines, or the
// fence contains none of the recognized keys - so a "---" horizontal rule or heading underline with no real front
// matter is left for the existing pipeline to read exactly as it always has.
func extractYAMLFrontMatter(content string) (*SourceMetadata, string) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], "\r") != "---" {
		return nil, content
	}
	limit := len(lines)
	if limit > maxYAMLFrontMatterFenceLines {
		limit = maxYAMLFrontMatterFenceLines
	}
	closeAt := -1
	for index := 1; index < limit; index++ {
		if strings.TrimRight(lines[index], "\r") == "---" {
			closeAt = index
			break
		}
	}
	if closeAt < 0 {
		return nil, content
	}
	metadata := &SourceMetadata{}
	found := false
	for _, line := range lines[1:closeAt] {
		key, value, ok := splitYAMLScalar(line)
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "title":
			metadata.Title = value
		case "author":
			metadata.Author = value
		case "series":
			metadata.Series = value
		default:
			continue
		}
		found = found || value != ""
	}
	if !found {
		return nil, strings.Join(lines[closeAt+1:], "\n")
	}
	return metadata, strings.Join(lines[closeAt+1:], "\n")
}

// splitYAMLScalar reads one "key: value" front matter line, unquoting a single- or double-quoted value. It is a
// minimal scalar reader, not a YAML parser: it has no notion of lists, nesting or multi-line values, which the
// recognized keys (title, author, series) never need.
func splitYAMLScalar(line string) (key, value string, ok bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}
	k, v, found := strings.Cut(trimmed, ":")
	if !found {
		return "", "", false
	}
	k = strings.TrimSpace(k)
	if k == "" {
		return "", "", false
	}
	return k, unquoteYAMLScalar(strings.TrimSpace(v)), true
}

func unquoteYAMLScalar(value string) string {
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

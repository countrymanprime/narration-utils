package guide

import (
	"encoding/csv"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// PronunciationQuery is one name whose pronunciation the author has not confirmed yet (prep-depth P3, ADR 0342): the entity's own
// name (AliasIndex nil) or one alias, with where the book first uses it. The list is derived from the Story Bible on every read, the
// way VocabularyCandidates is; nothing else stores it.
type PronunciationQuery struct {
	EntityID   string `json:"entityId"`
	AliasIndex *int   `json:"aliasIndex"`
	Name       string `json:"name"`
	Entry      string `json:"entry"`
	Category   string `json:"category"`
	IPA        string `json:"ipa"`
	Source     string `json:"source"`
	Status     string `json:"status"`
	Note       string `json:"note"`
	Chapter    string `json:"chapter"`
	Excerpt    string `json:"excerpt"`
	// position is the manuscript paragraph of the first occurrence, -1 when the name never occurs; it orders the list.
	position int
}

// pronunciationConfirmed is the one status that takes a name off the query list.
const pronunciationConfirmed = "author_confirmed"

// PronunciationQueries lists every name, the entity's own and each alias, whose pronunciation is not author_confirmed, each exactly
// once, in reading order: by the first paragraph that uses it, a name that never occurs last, ties by name. A status that is
// missing or unknown reads as researched. No Story Bible yet is an empty list.
func (s *Service) PronunciationQueries() ([]PronunciationQuery, error) {
	entities, err := s.Entities()
	if err != nil {
		return nil, err
	}
	queries := []PronunciationQuery{}
	for _, entity := range entities {
		id, _ := entity["id"].(string)
		entry, _ := entity["canonical_name"].(string)
		category, _ := entity["category"].(string)
		add := func(name string, aliasIndex *int, pronunciation map[string]any, occurrences []any) {
			status := pronunciationStatus(pronunciation)
			if status == pronunciationConfirmed {
				return
			}
			query := PronunciationQuery{EntityID: id, AliasIndex: aliasIndex, Name: name, Entry: entry, Category: category, Status: status, position: -1}
			query.IPA, _ = pronunciation["ipa"].(string)
			query.Source, _ = pronunciation["source"].(string)
			query.Note, _ = pronunciation["note"].(string)
			for _, raw := range occurrences {
				occurrence, _ := raw.(map[string]any)
				paragraph, ok := occurrence["paragraph"].(float64)
				if !ok || (query.position >= 0 && int(paragraph) >= query.position) {
					continue
				}
				query.position = int(paragraph)
				query.Chapter, _ = occurrence["chapter"].(string)
				query.Excerpt, _ = occurrence["excerpt"].(string)
			}
			queries = append(queries, query)
		}
		pronunciation, _ := entity["pronunciation"].(map[string]any)
		occurrences, _ := entity["occurrences"].([]any)
		add(entry, nil, pronunciation, occurrences)
		aliases, _ := entity["aliases"].([]any)
		for index, raw := range aliases {
			alias, _ := raw.(map[string]any)
			text, _ := alias["text"].(string)
			aliasPronunciation, _ := alias["pronunciation"].(map[string]any)
			aliasOccurrences, _ := alias["occurrences"].([]any)
			add(text, &index, aliasPronunciation, aliasOccurrences)
		}
	}
	sort.SliceStable(queries, func(left, right int) bool {
		a, b := queries[left], queries[right]
		if (a.position < 0) != (b.position < 0) {
			return a.position >= 0
		}
		if a.position != b.position {
			return a.position < b.position
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return queries, nil
}

// pronunciationStatus is a pronunciation's status, researched when it has none or one this host does not know.
func pronunciationStatus(pronunciation map[string]any) string {
	status, _ := pronunciation["status"].(string)
	if !slices.Contains(PronunciationStatuses, status) {
		return PronunciationStatuses[0]
	}
	return status
}

// QueryCSVHeader is the query export's first row. The columns a person reads come first; entry_id and alias_index come last and let a
// file sent back be matched to the entry it is about (Phase 6), whatever order the author leaves the columns in.
var QueryCSVHeader = []string{"word", "entry", "category", "chapter", "excerpt", "pronunciation", "source", "status", "note", "entry_id", "alias_index"}

// QueriesCSV writes the query list as CSV text for the narrator to send to the author (Q3: CSV, like the pickup list's export). The
// narrator's own pronunciation's source reads "Yours". A cell a spreadsheet would run as a formula (one starting with =, +, -, @, a
// tab or a carriage return) is written with a leading apostrophe, so opening the file never runs anything.
func QueriesCSV(queries []PronunciationQuery) string {
	var builder strings.Builder
	writer := csv.NewWriter(&builder)
	_ = writer.Write(QueryCSVHeader)
	for _, query := range queries {
		aliasIndex := ""
		if query.AliasIndex != nil {
			aliasIndex = strconv.Itoa(*query.AliasIndex)
		}
		source := query.Source
		if source == "user" {
			source = "Yours"
		}
		row := []string{query.Name, query.Entry, query.Category, query.Chapter, query.Excerpt, query.IPA, source, query.Status, query.Note, query.EntityID, aliasIndex}
		for index, cell := range row {
			row[index] = guardFormula(cell)
		}
		_ = writer.Write(row)
	}
	writer.Flush()
	return builder.String()
}

func guardFormula(cell string) string {
	if cell != "" && strings.ContainsRune("=+-@\t\r", rune(cell[0])) {
		return "'" + cell
	}
	return cell
}

func unguardFormula(cell string) string {
	if len(cell) > 1 && cell[0] == '\'' && strings.ContainsRune("=+-@\t\r", rune(cell[1])) {
		return cell[1:]
	}
	return cell
}

// QueryAnswer is one row of a query file read back: which name it is about, and the status and note it now carries.
type QueryAnswer struct {
	EntityID   string
	AliasIndex *int
	Name       string
	Status     string
	Note       string
}

// QueryIssue is one row ParseQueriesCSV could not use, with its 1-based line and why.
type QueryIssue struct {
	Line    int
	Message string
}

// ParseQueriesCSV reads a query file back, the one QueriesCSV wrote or one a person edited: the header names the columns (any order,
// any case), and word and entry_id are required. A status may be written as its key (author_confirmed) or its label (Author
// confirmed). A row that cannot be used is reported with its line, never dropped or guessed at. Matching a row to the Story Bible,
// and applying it, is Phase 6's; this only proves the file reads back.
func ParseQueriesCSV(text string) ([]QueryAnswer, []QueryIssue) {
	reader := csv.NewReader(strings.NewReader(text))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, []QueryIssue{{Line: 1, Message: "could not read the file: " + err.Error()}}
	}
	if len(records) == 0 {
		return nil, []QueryIssue{{Line: 1, Message: "the file is empty"}}
	}
	column := map[string]int{}
	for index, name := range records[0] {
		column[strings.ToLower(strings.TrimSpace(name))] = index
	}
	if _, ok := column["word"]; !ok {
		return nil, []QueryIssue{{Line: 1, Message: "the first row must name the columns, with word and entry_id among them"}}
	}
	if _, ok := column["entry_id"]; !ok {
		return nil, []QueryIssue{{Line: 1, Message: "the first row must name the columns, with word and entry_id among them"}}
	}
	cell := func(record []string, name string) string {
		index, ok := column[name]
		if !ok || index >= len(record) {
			return ""
		}
		return strings.TrimSpace(unguardFormula(record[index]))
	}
	var answers []QueryAnswer
	var issues []QueryIssue
	for index, record := range records[1:] {
		line := index + 2
		if strings.TrimSpace(strings.Join(record, "")) == "" {
			continue
		}
		answer := QueryAnswer{EntityID: cell(record, "entry_id"), Name: cell(record, "word"), Note: cell(record, "note")}
		if answer.EntityID == "" || answer.Name == "" {
			issues = append(issues, QueryIssue{Line: line, Message: "this row has no word or no entry_id, so it cannot be matched to an entry"})
			continue
		}
		status, ok := parseQueryStatus(cell(record, "status"))
		if !ok {
			issues = append(issues, QueryIssue{Line: line, Message: fmt.Sprintf("%q is not a status (researched, query sent or author confirmed)", cell(record, "status"))})
			continue
		}
		answer.Status = status
		if text := cell(record, "alias_index"); text != "" {
			number, err := strconv.Atoi(text)
			if err != nil || number < 0 {
				issues = append(issues, QueryIssue{Line: line, Message: fmt.Sprintf("%q is not an alias number", text)})
				continue
			}
			answer.AliasIndex = &number
		}
		answers = append(answers, answer)
	}
	return answers, issues
}

// parseQueryStatus accepts a status key or its label, in any case, with spaces or underscores; an empty cell is researched.
func parseQueryStatus(text string) (string, bool) {
	key := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(text)), " ", "_")
	if key == "" {
		return PronunciationStatuses[0], true
	}
	return key, slices.Contains(PronunciationStatuses, key)
}

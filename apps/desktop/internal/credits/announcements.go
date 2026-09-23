package credits

// Chapter is what a chapter announcement needs from one narration chapter of manuscript.json (PRD Open Questions C2 and
// C8: "[Chapter], [Chapter Title] computed from manuscript.json"): its heading as the manuscript names it ("Chapter 1",
// "Prologue") fills [Chapter], and the subtitle the importer split from that heading ("Down the Rabbit-Hole"), if any,
// fills [Chapter Title] (ADR 0151).
type Chapter struct {
	ID       string
	Heading  string
	Subtitle string
}

// Announcement is one chapter's rendered announcement.
type Announcement struct {
	ChapterID string `json:"chapterId"`
	Chapter   string `json:"chapter"`
	Result    Result `json:"result"`
}

// RenderAnnouncements renders body once per chapter with the project's own tokens plus that chapter's [Chapter] and
// [Chapter Title], through the one renderer (Render), so an optional `{: [Chapter Title]}` drops for a chapter with no
// subtitle. tokens is never changed.
func RenderAnnouncements(body string, tokens map[string]string, chapters []Chapter) []Announcement {
	announcements := make([]Announcement, 0, len(chapters))
	for _, chapter := range chapters {
		values := make(map[string]string, len(tokens)+2)
		for name, value := range tokens {
			values[name] = value
		}
		values["Chapter"] = chapter.Heading
		values["Chapter Title"] = chapter.Subtitle
		announcements = append(announcements, Announcement{ChapterID: chapter.ID, Chapter: chapter.Heading, Result: Render(body, values)})
	}
	return announcements
}

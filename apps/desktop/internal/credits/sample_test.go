package credits

import (
	"strings"
	"testing"
)

func words(n int) string { return strings.TrimSpace(strings.Repeat("word ", n)) }

func sampleBook() []SampleParagraph {
	return []SampleParagraph{
		{ID: "p1", ChapterID: "c-0001", Text: words(100)},
		{ID: "p2", ChapterID: "c-0001", Text: words(200)},
		{ID: "p3", ChapterID: "c-0002", Text: words(300)},
		{ID: "p4", ChapterID: "c-0002", Text: words(175)},
		{ID: "p5", ChapterID: "c-0002", Text: words(1)},
	}
}

func TestMeasureSampleCountsTheWordsAndLinesOfARangeAcrossChapters(t *testing.T) {
	measured, err := MeasureSample(sampleBook(), "p2", "p4")
	if err != nil {
		t.Fatal(err)
	}
	if measured.Words != 675 {
		t.Fatalf("Words = %d, want 675", measured.Words)
	}
	if measured.StartChapterID != "c-0001" || measured.StartLine != 2 || measured.EndChapterID != "c-0002" || measured.EndLine != 2 {
		t.Fatalf("measured = %+v, want chapter 1 line 2 to chapter 2 line 2", measured)
	}
	// 675 words at 9,300 words per finished hour.
	if want := 675.0 * 3600 / WordsPerFinishedHour; measured.Seconds != want {
		t.Fatalf("Seconds = %v, want %v", measured.Seconds, want)
	}
}

func TestMeasureSampleAcceptsExactlyFiveMinutes(t *testing.T) {
	// p2..p4 plus p1 is 775 words: exactly 5 minutes at 155 words a minute.
	book := sampleBook()
	measured, err := MeasureSample(book, "p1", "p4")
	if err != nil {
		t.Fatalf("a 5-minute sample was refused: %v", err)
	}
	if measured.Seconds != MaxRetailSampleSeconds {
		t.Fatalf("Seconds = %v, want exactly %v", measured.Seconds, MaxRetailSampleSeconds)
	}
}

func TestMeasureSampleRefusesARangeOverFiveMinutes(t *testing.T) {
	_, err := MeasureSample(sampleBook(), "p1", "p5")
	if err == nil || !strings.Contains(err.Error(), "5 minutes") {
		t.Fatalf("err = %v, want a refusal naming the 5-minute limit", err)
	}
}

func TestMeasureSampleSaysHowLongARefusedRangeIs(t *testing.T) {
	book := []SampleParagraph{{ID: "a", ChapterID: "c", Text: words(1000)}, {ID: "b", ChapterID: "c", Text: words(9300)}}
	if _, err := MeasureSample(book, "a", "a"); err == nil || !strings.Contains(err.Error(), "1000 words, about 6m 27s") {
		t.Fatalf("err = %v", err)
	}
	if _, err := MeasureSample(book, "a", "b"); err == nil || !strings.Contains(err.Error(), "about 1h 06m") {
		t.Fatalf("err = %v, want an hour-long range in hours", err)
	}
}

func TestMeasureSampleOfOneParagraphStartsAndEndsOnIt(t *testing.T) {
	measured, err := MeasureSample(sampleBook(), "p3", "p3")
	if err != nil {
		t.Fatal(err)
	}
	if measured.Words != 300 || measured.StartLine != 1 || measured.EndLine != 1 {
		t.Fatalf("measured = %+v", measured)
	}
}

func TestMeasureSampleRefusesAnEndBeforeTheStart(t *testing.T) {
	if _, err := MeasureSample(sampleBook(), "p3", "p2"); err == nil {
		t.Fatal("an end before the start was accepted")
	}
}

func TestMeasureSampleRefusesAParagraphTheManuscriptDoesNotHave(t *testing.T) {
	if _, err := MeasureSample(sampleBook(), "p1", "gone"); err == nil {
		t.Fatal("a missing end paragraph was accepted")
	}
	if _, err := MeasureSample(sampleBook(), "gone", "p1"); err == nil {
		t.Fatal("a missing start paragraph was accepted")
	}
}

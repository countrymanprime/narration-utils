package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

// Credits extras (audiobook-credits-templates.prd.md Phase 5): chapter announcements rendered per narration chapter from
// manuscript.json (Open Question C8, ADR 0151) and the retail sample range the narrator picks, stored on the project
// manifest (C10, ADR 0152). Both read the manuscript through h.services(), like every other manuscript binding.

// CreditsChapterAnnouncements renders body once per narration chapter, with the project's own tokens plus the chapter's
// [Chapter] and [Chapter Title]. The Settings preview shows the first; the estimate times them all.
func (h *Host) CreditsChapterAnnouncements(body string) (string, error) {
	data, err := h.services().manuscript.Load()
	if err != nil {
		return "", err
	}
	return encodeBinding(credits.RenderAnnouncements(body, h.creditTokens(), narrationChapters(data)), nil)
}

// retailSampleAnswer is what CreditsRetailSample and CreditsSaveRetailSample answer: the measured sample (nil when none is
// picked or it cannot be measured) and, when a saved sample cannot be measured any more, why.
type retailSampleAnswer struct {
	Sample  *credits.MeasuredSample `json:"sample"`
	Problem string                  `json:"problem"`
}

// CreditsRetailSample reads this project's retail sample and measures it against the current manuscript. A saved range
// whose lines are gone (the manuscript was replaced) is kept and reported as a problem rather than failing the read.
func (h *Host) CreditsRetailSample() (string, error) {
	projectFolder := h.services().config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before picking its retail sample")
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil || manifest.RetailSample == nil {
		return encodeBinding(retailSampleAnswer{}, nil)
	}
	measured, err := h.measureRetailSample(manifest.RetailSample.StartParagraphID, manifest.RetailSample.EndParagraphID)
	if err != nil {
		return encodeBinding(retailSampleAnswer{Problem: err.Error()}, nil)
	}
	return encodeBinding(retailSampleAnswer{Sample: &measured}, nil)
}

// CreditsSaveRetailSample picks startParagraphID..endParagraphID (both included) as the retail sample, refusing a range
// over 5 minutes (C10) and keeping the previous one when it does. Two empty ids clear it.
func (h *Host) CreditsSaveRetailSample(startParagraphID, endParagraphID string) (string, error) {
	svc := h.services()
	projectFolder := svc.config.projectFolder
	if projectFolder == "" {
		return "", fmt.Errorf("open a project before picking its retail sample")
	}
	var answer retailSampleAnswer
	var sample *credits.RetailSample
	if startParagraphID != "" || endParagraphID != "" {
		measured, err := h.measureRetailSample(startParagraphID, endParagraphID)
		if err != nil {
			return "", err
		}
		answer.Sample = &measured
		sample = &credits.RetailSample{StartParagraphID: startParagraphID, EndParagraphID: endParagraphID}
	}
	manifest, ok, err := project.Load(h.persist, projectFolder)
	if err != nil {
		return "", fmt.Errorf("could not read the project manifest: %w", err)
	}
	if !ok || manifest == nil {
		manifest = project.New(svc.config.projectName, time.Now())
	}
	manifest.RetailSample = sample
	if err := manifest.Save(projectFolder); err != nil {
		return "", fmt.Errorf("could not save the retail sample: %w", err)
	}
	return encodeBinding(answer, nil)
}

func (h *Host) measureRetailSample(startParagraphID, endParagraphID string) (credits.MeasuredSample, error) {
	data, err := h.services().manuscript.Load()
	if err != nil {
		return credits.MeasuredSample{}, err
	}
	return credits.MeasureSample(sampleParagraphs(data), startParagraphID, endParagraphID)
}

// narrationChapters are manuscript.json's narration chapters in book order: the chapters the estimate counts and the
// teleprompter reads ((contentKind ?? "narration") === "narration" in the UI), never front matter or reference.
func narrationChapters(data map[string]any) []credits.Chapter {
	chapters := []credits.Chapter{}
	for _, chapter := range jsonObjects(data["chapters"]) {
		if kind := jsonText(chapter, "contentKind"); kind != "" && kind != "narration" {
			continue
		}
		chapters = append(chapters, credits.Chapter{ID: jsonText(chapter, "id"), Heading: jsonText(chapter, "title"), Subtitle: jsonText(chapter, "subtitle")})
	}
	return chapters
}

// sampleParagraphs are manuscript.json's paragraphs in book order.
func sampleParagraphs(data map[string]any) []credits.SampleParagraph {
	paragraphs := []credits.SampleParagraph{}
	for _, paragraph := range jsonObjects(data["paragraphs"]) {
		paragraphs = append(paragraphs, credits.SampleParagraph{ID: jsonText(paragraph, "id"), ChapterID: jsonText(paragraph, "chapterId"), Text: jsonText(paragraph, "text")})
	}
	return paragraphs
}

func jsonObjects(value any) []map[string]any {
	items, _ := value.([]any)
	objects := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if object, ok := item.(map[string]any); ok {
			objects = append(objects, object)
		}
	}
	return objects
}

func jsonText(object map[string]any, key string) string {
	value, _ := object[key].(string)
	return value
}

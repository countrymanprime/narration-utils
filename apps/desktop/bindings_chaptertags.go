package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptertags"
)

// The Phase 12 (chapter tag embedding) bindings for the reaper-automation-follow-through PRD. Unlike every other
// bridge-consumer binding in this file's siblings, this feature never talks to REAPER: it reads the per-chapter
// MP3 files Phase 11's "Prepare chapter render" already named (renderConfig.Snapshot()'s targets, the last
// successful RENDER_TARGETS list) to learn each chapter's title and duration, then asks the narrator which
// already-rendered MP3 to tag - a separate, single combined file the per-chapter renders do not produce by
// themselves. See docs/adr/0099-... for why this only works on the combined file, not the per-chapter ones.
//
// Every mutation happens on a NEW copy beside the file the narrator names (chaptertags.Embed): ChapterTagsEmbed
// never writes to destPath itself, and the UI (ChapterTagsDialog) gates the call behind an explicit confirm, the
// same "narrator presses a button, nothing runs automatically" rule Phase 11 follows for Render itself.

// ChapterTagsPreview reports the chapters Phase 11's last successful render configuration knows about (title,
// source file, and whether that file exists on disk yet - it may not, if the narrator has not pressed Render
// since configuring), so the UI can show what will be embedded and disable the action until every file is ready.
func (h *Host) ChapterTagsPreview() (string, error) {
	service := h.services().renderConfig
	if service == nil {
		return encodeBinding(map[string]any{"chapters": []map[string]any{}, "ready": false}, nil)
	}
	snapshot := service.Snapshot()
	chapters := chapterCandidatesFromTargets(snapshot["targets"])
	ready := len(chapters) > 0
	result := make([]map[string]any, 0, len(chapters))
	for _, c := range chapters {
		exists := fileExists(c.Path)
		if !exists {
			ready = false
		}
		result = append(result, map[string]any{"title": c.Title, "path": c.Path, "rendered": exists})
	}
	return encodeBinding(map[string]any{"chapters": result, "ready": ready}, nil)
}

// ChapterTagsEmbed builds the chapter timeline from Phase 11's known per-chapter files and writes ID3v2 CHAP and
// CTOC frames into a NEW copy of destPath (the narrator-supplied combined-book MP3), returning that new file's
// path. destPath is never modified. The narrator confirms this explicitly in the UI before it is called.
func (h *Host) ChapterTagsEmbed(destPath string) (string, error) {
	destPath = strings.TrimSpace(destPath)
	if destPath == "" {
		return "", fmt.Errorf("choose the MP3 file to add chapters to")
	}
	service := h.services().renderConfig
	if service == nil {
		return "", fmt.Errorf("no chapter render has been configured yet")
	}
	candidates := chapterCandidatesFromTargets(service.Snapshot()["targets"])
	if len(candidates) == 0 {
		return "", fmt.Errorf("no chapter render has been configured yet; use \"Prepare chapter render\" first")
	}
	timeline, err := chaptertags.BuildTimeline(candidates)
	if err != nil {
		return "", err
	}
	outPath, err := chaptertags.Embed(destPath, timeline)
	return encodeBinding(map[string]any{"outputPath": outPath}, err)
}

// chapterCandidatesFromTargets turns renderConfig's RENDER_TARGETS-derived path list (Phase 11) into
// chaptertags.Chapter values, titled after each file's base name (the region name the render pattern used, per
// narration_render.lua's $region pattern) - the same title the narrator sees in "Prepare chapter render"'s
// results list.
func chapterCandidatesFromTargets(targets any) []chaptertags.Chapter {
	values, ok := targets.([]any)
	if !ok {
		return nil
	}
	chapters := make([]chaptertags.Chapter, 0, len(values))
	for _, v := range values {
		path, ok := v.(string)
		if !ok || strings.TrimSpace(path) == "" {
			continue
		}
		title := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		chapters = append(chapters, chaptertags.Chapter{Title: title, Path: path})
	}
	return chapters
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

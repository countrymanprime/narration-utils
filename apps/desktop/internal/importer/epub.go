package importer

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// Size limits (E5), a proposed judgement call revisited once real files are
// supplied (F1) and recorded in ADR 0101: a shared capped reader keeps a
// hostile zip entry or an oversized book from an unbounded read, the same
// hazard docxEntry has today (Evidence, threat-model row 6a, issue #239).
const (
	epubMaxFileSize  int64 = 64 * 1024 * 1024  // 64 MB EPUB on disk
	epubMaxEntrySize int64 = 16 * 1024 * 1024  // 16 MB per decompressed entry
	epubMaxTotalText int64 = 128 * 1024 * 1024 // 128 MB of decompressed text in total
)

// epubFontObfuscationAlgorithms are the two font-obfuscation algorithm URIs
// META-INF/encryption.xml may legally use without the book being DRM'd
// (Solution Detail's DRM paragraph); any other <EncryptedData> entry, or an
// Adobe rights.xml, refuses the import.
var epubFontObfuscationAlgorithms = map[string]bool{
	"http://www.idpf.org/2008/embedding": true,
	"http://ns.adobe.com/pdf/enc#RC":     true,
}

const epubDRMMessage = "This EPUB is copy-protected, so its text can't be read. Import a DRM-free copy, or a Word or Markdown version."

// epubContainer models META-INF/container.xml, whose one job is naming the
// package (OPF) document's path inside the archive.
type epubContainer struct {
	Rootfiles struct {
		Rootfile []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfile"`
	} `xml:"rootfiles"`
}

// epubManifestItem is one <manifest><item> of the package (OPF) document.
// Href is already resolved against the OPF's own directory and cleaned.
type epubManifestItem struct {
	Href      string
	MediaType string
}

type opfXML struct {
	Manifest struct {
		Item []struct {
			ID         string `xml:"id,attr"`
			Href       string `xml:"href,attr"`
			MediaType  string `xml:"media-type,attr"`
			Properties string `xml:"properties,attr"`
		} `xml:"item"`
	} `xml:"manifest"`
	Spine struct {
		TOC     string `xml:"toc,attr"`
		Itemref []struct {
			IDref  string `xml:"idref,attr"`
			Linear string `xml:"linear,attr"`
		} `xml:"itemref"`
	} `xml:"spine"`
}

type epubPackage struct {
	manifest map[string]epubManifestItem
	spine    []string // manifest ids, in reading order
	navID    string   // manifest id of the EPUB 3 nav document, "" if none
	ncxID    string   // manifest id of the NCX document, "" if none
	// nonLinear counts spine itemrefs with linear="no" (E4): a spine item marked non-linear is auxiliary
	// content (e.g. a sidebar or ancillary scene) the reading order does not visit in turn, so it is skipped
	// from the chapter build rather than read in the middle of the narrative; reported in a notice.
	nonLinear int
}

// parseOPF reads the package document's manifest and spine, resolving every
// href against the OPF's own directory (opfDir) up front so nothing past
// this point needs to know it.
func parseOPF(content []byte, opfDir string) epubPackage {
	var parsed opfXML
	_ = xml.Unmarshal(content, &parsed)
	pkg := epubPackage{manifest: map[string]epubManifestItem{}}
	for _, item := range parsed.Manifest.Item {
		href := resolveEPUBHref(opfDir, item.Href)
		if href == "" {
			continue
		}
		pkg.manifest[item.ID] = epubManifestItem{Href: href, MediaType: item.MediaType}
		for _, property := range strings.Fields(item.Properties) {
			if property == "nav" {
				pkg.navID = item.ID
			}
		}
		if item.MediaType == "application/x-dtbncx+xml" {
			pkg.ncxID = item.ID
		}
	}
	if parsed.Spine.TOC != "" {
		if _, ok := pkg.manifest[parsed.Spine.TOC]; ok {
			pkg.ncxID = parsed.Spine.TOC
		}
	}
	for _, itemref := range parsed.Spine.Itemref {
		if _, ok := pkg.manifest[itemref.IDref]; !ok {
			continue
		}
		if itemref.Linear == "no" {
			pkg.nonLinear++
			continue
		}
		pkg.spine = append(pkg.spine, itemref.IDref)
	}
	return pkg
}

// resolveEPUBHref resolves href against the directory it was found in
// (dir), cleans it, and rejects (returns "") anything that would resolve
// outside the archive - hrefs are read by name, never extracted, so
// zip-slip itself does not apply, but a crafted "../../secret" href must
// still not point outside the book.
func resolveEPUBHref(dir, href string) string {
	if href == "" {
		return ""
	}
	joined := href
	if dir != "" && dir != "." {
		joined = path.Join(dir, href)
	}
	joined = path.Clean(joined)
	if joined == ".." || strings.HasPrefix(joined, "../") || path.IsAbs(joined) {
		return ""
	}
	return strings.TrimPrefix(joined, "./")
}

// epubEntry reads one zip entry by name through a capped reader (E5): an
// entry whose declared or actual decompressed size exceeds epubMaxEntrySize
// is refused outright, and every read also draws down the archive-wide
// budget so many medium entries cannot add up to a decompression bomb
// either.
func epubEntry(files []*zip.File, name string, budget *int64) ([]byte, error) {
	for _, file := range files {
		if file.Name != name {
			continue
		}
		if file.UncompressedSize64 > uint64(epubMaxEntrySize) {
			return nil, fmt.Errorf("%q is too large to read", name)
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer func() { _ = reader.Close() }() // read-only
		data, err := io.ReadAll(io.LimitReader(reader, epubMaxEntrySize+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > epubMaxEntrySize {
			return nil, fmt.Errorf("%q is too large to read", name)
		}
		if budget != nil {
			*budget -= int64(len(data))
			if *budget < 0 {
				return nil, fmt.Errorf("this EPUB's decompressed text exceeds the size limit")
			}
		}
		return data, nil
	}
	return nil, fmt.Errorf("missing %q", name)
}

// epubDRMCheck reports whether the book refuses to open (Solution Detail's
// DRM paragraph): any META-INF/encryption.xml entry whose algorithm is not
// one of the two known font-obfuscation URIs, or the presence of an Adobe
// rights.xml, both mark the book DRM-protected rather than merely obfuscated.
func epubDRMCheck(files []*zip.File) (drm bool, message string) {
	for _, file := range files {
		if file.Name == "META-INF/rights.xml" {
			return true, epubDRMMessage
		}
	}
	data, err := epubEntry(files, "META-INF/encryption.xml", nil)
	if err != nil {
		return false, "" // no encryption.xml at all: not DRM'd
	}
	var parsed struct {
		EncryptedData []struct {
			EncryptionMethod struct {
				Algorithm string `xml:"Algorithm,attr"`
			} `xml:"EncryptionMethod"`
		} `xml:"EncryptedData"`
	}
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return true, epubDRMMessage
	}
	for _, entry := range parsed.EncryptedData {
		if !epubFontObfuscationAlgorithms[entry.EncryptionMethod.Algorithm] {
			return true, epubDRMMessage
		}
	}
	return false, ""
}

// chapterStart is one resolved chapter boundary: the absolute index into the
// book-wide block list, the title/subtitle it takes, and the contentKind its
// spine document's own epub:type implies ("" when the document carried none
// or its epub:type gave no classification signal).
type chapterStart struct {
	index    int
	title    string
	subtitle string
	kind     string
}

// epubTypeKindTable maps an EPUB epub:type token to the contentKind it
// implies (Architecture notes, "Classification"; ADR 0102): it takes
// precedence over model.go's title-text classifiers, which stay the fallback
// for a document that carries no epub:type or an unrecognized one.
var epubTypeKindTable = map[string]string{
	"cover": "opening", "titlepage": "opening", "frontmatter": "opening",
	"dedication": "opening", "epigraph": "opening", "copyright-page": "opening",
	"toc": "reference", "acknowledgments": "reference", "glossary": "reference",
	"index": "reference", "bibliography": "reference", "endnotes": "reference",
	"footnotes": "reference", "backmatter": "reference",
	"bodymatter": "narration", "chapter": "narration", "prologue": "narration", "epilogue": "narration",
}

// epubTypeKind classifies an epub:type attribute value (a space-separated
// token list) by its first recognized token, "" when none of its tokens are
// in the table.
func epubTypeKind(value string) string {
	for _, token := range strings.Fields(value) {
		if kind, ok := epubTypeKindTable[token]; ok {
			return kind
		}
	}
	return ""
}

// epubChapterStarts implements E1 (TOC first, spine-heading fallback) and E2
// (every TOC depth starts a chapter): it resolves each TOC entry to a block
// index via fileBlockRange and idIndex, falls back to spine documents that
// begin with h1/h2 when the TOC is missing or none of it resolved, and
// reports either case in notices.
func epubChapterStarts(entries []epubTOCEntry, blocks []epubBlock, fileBlockRange map[string][2]int, idIndex map[string]map[string]int, spine []string, manifest map[string]epubManifestItem, fileEpubType map[string]string) (starts []chapterStart, notices []string) {
	glued := func(target int, title, subtitle string, wasGlued bool) (string, string) {
		if wasGlued {
			notices = append(notices, fmt.Sprintf("Heading %q had no gap between its number and title; split into %q and %q.", collapse(blocks[target].text), title, subtitle))
		}
		return title, subtitle
	}
	seen := map[int]bool{}
	for _, entry := range entries {
		rng, ok := fileBlockRange[entry.file]
		if !ok {
			notices = append(notices, fmt.Sprintf("A table of contents entry, %q, pointed to a file that is not in the book's reading order; it was skipped.", entry.label))
			continue
		}
		target := rng[0]
		if entry.fragment != "" {
			if index, ok := idIndex[entry.file][entry.fragment]; ok {
				target = index
			}
		}
		if seen[target] {
			continue
		}
		seen[target] = true
		var title, subtitle string
		var wasGlued bool
		if target < len(blocks) && blocks[target].heading > 0 {
			title, subtitle, wasGlued = headingParts(blocks[target].text)
			title, subtitle = glued(target, title, subtitle, wasGlued)
		} else {
			title, subtitle, _ = headingParts(entry.label)
		}
		starts = append(starts, chapterStart{index: target, title: title, subtitle: subtitle, kind: epubTypeKind(fileEpubType[entry.file])})
	}
	if len(starts) > 0 {
		sort.Slice(starts, func(i, j int) bool { return starts[i].index < starts[j].index })
		return starts, notices
	}
	// E1's fallback: no TOC, or none of it resolved to a real block. Each
	// spine document whose own first block is a top-level heading starts a
	// chapter instead.
	for _, id := range spine {
		item, ok := manifest[id]
		if !ok {
			continue
		}
		rng, ok := fileBlockRange[item.Href]
		if !ok || rng[0] >= rng[1] {
			continue
		}
		first := blocks[rng[0]]
		if first.heading == 1 || first.heading == 2 {
			title, subtitle, wasGlued := headingParts(first.text)
			title, subtitle = glued(rng[0], title, subtitle, wasGlued)
			starts = append(starts, chapterStart{index: rng[0], title: title, subtitle: subtitle, kind: epubTypeKind(fileEpubType[item.Href])})
		}
	}
	if len(starts) > 0 {
		notices = append(notices, "No usable table of contents was found; chapters were detected from headings at the start of each file instead.")
	}
	return starts, notices
}

// epubWithProgress builds a Draft from an EPUB manuscript: container, OPF,
// spine order, its own table of contents (nav for EPUB 3, NCX for EPUB 2,
// falling back to headings), and XHTML content turned into the same
// paragraph/span shape every other importer produces (txt-and-epub-import
// PRD, Phase 2).
func epubWithProgress(filePath string, progress Progress) (Draft, error) {
	progress.report(5, "Opening EPUB %s", filepath.Base(filePath))
	info, err := os.Stat(filePath)
	if err != nil {
		return Draft{}, &Error{"Could not read this EPUB file: " + err.Error()}
	}
	if info.Size() > epubMaxFileSize {
		return Draft{}, &Error{"This EPUB is too large to import (over 64 MB)."}
	}
	archive, err := zip.OpenReader(filePath)
	if err != nil {
		return Draft{}, &Error{"Could not read this EPUB file: it is not a valid zip archive."}
	}
	defer func() { _ = archive.Close() }() // read-only

	budget := epubMaxTotalText
	containerBytes, err := epubEntry(archive.File, "META-INF/container.xml", &budget)
	if err != nil {
		return Draft{}, &Error{"This file is missing META-INF/container.xml; it is not a valid EPUB."}
	}
	var container epubContainer
	if err := xml.Unmarshal(containerBytes, &container); err != nil || len(container.Rootfiles.Rootfile) == 0 {
		return Draft{}, &Error{"This EPUB's container.xml could not be read."}
	}
	opfPath := container.Rootfiles.Rootfile[0].FullPath
	opfDir := path.Dir(opfPath)
	if opfDir == "." {
		opfDir = ""
	}
	opfBytes, err := epubEntry(archive.File, opfPath, &budget)
	if err != nil {
		return Draft{}, &Error{"This EPUB's package document (OPF) is missing or unreadable."}
	}
	progress.report(15, "Reading package structure")
	pkg := parseOPF(opfBytes, opfDir)
	if len(pkg.spine) == 0 {
		return Draft{}, &Error{"This EPUB has no readable chapters in its spine."}
	}

	if drm, message := epubDRMCheck(archive.File); drm {
		return Draft{}, &Error{message}
	}

	notices := []string{}
	if pkg.nonLinear > 0 {
		notices = append(notices, fmt.Sprintf("%d non-linear item(s) (marked linear=\"no\") were outside the book's reading order and were skipped.", pkg.nonLinear))
	}

	// E1: nav.xhtml (EPUB 3) first, NCX (EPUB 2) fallback.
	var tocEntries []epubTOCEntry
	if pkg.navID != "" {
		if navItem, ok := pkg.manifest[pkg.navID]; ok {
			if navBytes, err := epubEntry(archive.File, navItem.Href, &budget); err == nil {
				tocEntries = parseEPUBNav(navBytes, path.Dir(navItem.Href))
			}
		}
	}
	if len(tocEntries) == 0 && pkg.ncxID != "" {
		if ncxItem, ok := pkg.manifest[pkg.ncxID]; ok {
			if ncxBytes, err := epubEntry(archive.File, ncxItem.Href, &budget); err == nil {
				tocEntries = parseEPUBNCX(ncxBytes, path.Dir(ncxItem.Href))
			}
		}
	}

	progress.report(30, "Reading %d spine documents", len(pkg.spine))

	var blocks []epubBlock
	fileBlockRange := map[string][2]int{}
	idIndex := map[string]map[string]int{}
	fileEpubType := map[string]string{}
	cssCache := map[string]map[string]Style{}
	unresolvedClasses := map[string]bool{}
	for _, id := range pkg.spine {
		item := pkg.manifest[id]
		if item.Href == "" {
			continue
		}
		content, err := epubEntry(archive.File, item.Href, &budget)
		if err != nil {
			notices = append(notices, fmt.Sprintf("Could not read %q; it was skipped.", item.Href))
			continue
		}
		start := len(blocks)
		fileBlocks, ids, bodyType := parseEPUBXHTML(content, archive.File, &budget, path.Dir(item.Href), cssCache, unresolvedClasses)
		if bodyType != "" {
			fileEpubType[item.Href] = bodyType
		}
		if len(ids) > 0 {
			idIndex[item.Href] = make(map[string]int, len(ids))
			for id, localIndex := range ids {
				idIndex[item.Href][id] = start + localIndex
			}
		}
		blocks = append(blocks, fileBlocks...)
		fileBlockRange[item.Href] = [2]int{start, len(blocks)}
	}
	if len(blocks) == 0 {
		return Draft{}, &Error{"This EPUB has no readable text."}
	}
	if len(unresolvedClasses) > 0 {
		notices = append(notices, fmt.Sprintf("%d formatting class(es) in the book's stylesheet weren't recognized (not a single font-style or font-weight rule); their text imported without emphasis.", len(unresolvedClasses)))
	}

	starts, tocNotices := epubChapterStarts(tocEntries, blocks, fileBlockRange, idIndex, pkg.spine, pkg.manifest, fileEpubType)
	notices = append(notices, tocNotices...)
	startAt := make(map[int]int, len(starts))
	kindOverrides := map[string]string{}
	for index, start := range starts {
		startAt[start.index] = index
		if start.kind != "" {
			kindOverrides[start.title] = start.kind
		}
	}

	progress.report(60, "Building %d chapters from %d blocks", len(starts), len(blocks))

	chapter, subtitle := "Front Matter", ""
	paragraphs := []Paragraph{}
	titles := []string{}
	headingLevels := map[string]int{}
	preIndexes := []int{}
	levels := make([]int, len(blocks))
	for index, block := range blocks {
		levels[index] = block.heading
	}
	// openLevel is the heading level of the chapter start just read while nothing has followed it yet (0 when there is none), so
	// a subtitle set apart from its heading can still join it: a deeper heading alone at its level (subtitleHeading) or a
	// <p class="subtitle"> (import heading misreads F4 and F5, #387, #388). apart says the subtitle came from such a block, which
	// returns to the text if the narrator turns it off.
	openLevel, apart := 0, false
	for index, block := range blocks {
		if position, ok := startAt[index]; ok {
			chapter, subtitle = starts[position].title, starts[position].subtitle
			titles = append(titles, chapter)
			if _, seen := headingLevels[chapter]; !seen {
				headingLevels[chapter] = 1
			}
			apart = false
			if block.heading > 0 {
				openLevel = block.heading
				continue
			}
		} else if openLevel > 0 && subtitle == "" && (block.subtitle ||
			(block.heading > 0 && subtitleHeading(chapter, openLevel, collapse(block.text), block.heading) && aloneAtItsLevel(levels, index, openLevel))) {
			subtitle, apart, openLevel = collapse(block.text), true, 0
			continue
		}
		openLevel = 0
		// A heading that does not start a chapter (a scene heading, a subtitle that could not be read as one) is kept as the
		// chapter's text rather than dropped (#388).
		if block.text == "" {
			continue
		}
		var subtitlePointer *string
		if subtitle != "" {
			copySubtitle := subtitle
			subtitlePointer = &copySubtitle
		}
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, ChapterSubtitle: subtitlePointer, SubtitleReturnsToBody: apart && subtitlePointer != nil, Text: block.text, Spans: block.spans, SourceIndex: len(paragraphs)})
		apart = false
		if chapter == "Front Matter" {
			preIndexes = append(preIndexes, len(paragraphs)-1)
		}
	}

	pre := make([]string, len(preIndexes))
	for index, paragraphIndex := range preIndexes {
		pre[index] = paragraphs[paragraphIndex].Text
	}
	for index, kind := range classifyPreHeading(pre) {
		paragraphs[preIndexes[index]].Chapter = kind
	}

	// Parity with T4: an EPUB with no usable TOC and no headings at all
	// would otherwise import as all "opening" and be silently
	// un-narratable (Success Metrics, "No un-narratable import").
	if len(titles) == 0 && len(paragraphs) > 0 {
		name := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
		for index := range paragraphs {
			paragraphs[index].Chapter = name
		}
		titles = []string{name}
		notices = append(notices, fmt.Sprintf("No chapters were found in the table of contents or headings; the whole book was imported as one chapter, %q.", name))
	}

	progress.report(80, "Classifying front matter, chapters and reference sections")
	draft, err := newDraft("epub", filepath.Base(filePath), paragraphs, titles, headingLevels, kindOverrides)
	draft.Notices = notices
	if err == nil {
		progress.report(95, "Found %d chapters in %d sections", len(titles), len(draft.Sections))
	}
	return draft, err
}

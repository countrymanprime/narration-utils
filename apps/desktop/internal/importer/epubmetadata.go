package importer

import (
	"archive/zip"
	"encoding/xml"
	"strings"
)

// EPUBMetadata is the subset of an EPUB's OPF <metadata> block credits detection reads (credits-token-setup-and-
// front-matter-detection.prd.md, Phase 1, Should): never an ISBN or other retailer metadata, and never written back
// anywhere - like ReadCoreProps, this only offers a suggestion.
type EPUBMetadata struct {
	Title      string
	Subtitle   string
	Author     string
	Publisher  string
	Rights     string
	Year       string
	Series     string
	BookNumber string
}

// Empty reports whether every field is unset, so a caller can treat "found nothing" the same way ReadCoreProps does.
func (m EPUBMetadata) Empty() bool {
	return m == EPUBMetadata{}
}

type opfMetadataTitle struct {
	ID    string `xml:"id,attr"`
	Value string `xml:",chardata"`
}

type opfMetadataCreator struct {
	ID    string `xml:"id,attr"`
	Role  string `xml:"role,attr"`
	Value string `xml:",chardata"`
}

type opfMetadataDate struct {
	Value string `xml:",chardata"`
}

type opfMetadataMeta struct {
	Name     string `xml:"name,attr"`
	Content  string `xml:"content,attr"`
	Property string `xml:"property,attr"`
	Refines  string `xml:"refines,attr"`
	ID       string `xml:"id,attr"`
	Value    string `xml:",chardata"`
}

type opfMetadataXML struct {
	Title     []opfMetadataTitle   `xml:"title"`
	Creator   []opfMetadataCreator `xml:"creator"`
	Publisher string               `xml:"publisher"`
	Rights    string               `xml:"rights"`
	Date      []opfMetadataDate    `xml:"date"`
	Meta      []opfMetadataMeta    `xml:"meta"`
}

type opfPackageMetadataXML struct {
	Metadata opfMetadataXML `xml:"metadata"`
}

// ReadEPUBMetadata reads an EPUB's package (OPF) document's <metadata> block: title (with a title-type "subtitle"
// refinement), the creator with role "aut" (a creator with role "nrt", a narrator, is never read as Author - CS7),
// publisher, rights, date and series (EPUB 3 belongs-to-collection/group-position or Calibre's
// calibre:series/calibre:series_index meta tags). ok is false whenever the file cannot be opened, is not an EPUB, or
// its metadata has none of these fields set.
func ReadEPUBMetadata(filePath string) (EPUBMetadata, bool) {
	archive, err := zip.OpenReader(filePath)
	if err != nil {
		return EPUBMetadata{}, false
	}
	defer func() { _ = archive.Close() }() // read-only
	budget := epubMaxTotalText
	containerBytes, err := epubEntry(archive.File, "META-INF/container.xml", &budget)
	if err != nil {
		return EPUBMetadata{}, false
	}
	var container epubContainer
	if err := xml.Unmarshal(containerBytes, &container); err != nil || len(container.Rootfiles.Rootfile) == 0 {
		return EPUBMetadata{}, false
	}
	opfPath := container.Rootfiles.Rootfile[0].FullPath
	opfBytes, err := epubEntry(archive.File, opfPath, &budget)
	if err != nil {
		return EPUBMetadata{}, false
	}
	var parsed opfPackageMetadataXML
	if err := xml.Unmarshal(opfBytes, &parsed); err != nil {
		return EPUBMetadata{}, false
	}
	metadata := opfMetadata(parsed.Metadata)
	return metadata, !metadata.Empty()
}

func opfMetadata(raw opfMetadataXML) EPUBMetadata {
	var metadata EPUBMetadata

	titleByID := map[string]string{}
	for _, title := range raw.Title {
		if title.ID != "" {
			titleByID[title.ID] = strings.TrimSpace(title.Value)
		}
	}
	if len(raw.Title) > 0 {
		metadata.Title = strings.TrimSpace(raw.Title[0].Value)
	}
	for _, meta := range raw.Meta {
		if !strings.EqualFold(meta.Property, "title-type") {
			continue
		}
		id := strings.TrimPrefix(meta.Refines, "#")
		value := strings.TrimSpace(meta.Value)
		switch strings.ToLower(value) {
		case "main":
			if text, ok := titleByID[id]; ok {
				metadata.Title = text
			}
		case "subtitle":
			if text, ok := titleByID[id]; ok {
				metadata.Subtitle = text
			}
		}
	}

	roleByID := map[string]string{}
	for _, meta := range raw.Meta {
		if strings.EqualFold(meta.Property, "role") && meta.Refines != "" {
			roleByID[strings.TrimPrefix(meta.Refines, "#")] = strings.ToLower(strings.TrimSpace(meta.Value))
		}
	}
	var creatorsWithNoRole []string
	for _, creator := range raw.Creator {
		role := strings.ToLower(strings.TrimSpace(creator.Role))
		if role == "" {
			role = roleByID[creator.ID]
		}
		name := strings.TrimSpace(creator.Value)
		if name == "" {
			continue
		}
		switch role {
		case "aut":
			if metadata.Author == "" {
				metadata.Author = name
			}
		case "nrt":
			// A narrator credit, never read as Author (CS7): the app never guesses the narrator from metadata.
		case "":
			creatorsWithNoRole = append(creatorsWithNoRole, name)
		}
	}
	if metadata.Author == "" && len(creatorsWithNoRole) == 1 {
		metadata.Author = creatorsWithNoRole[0]
	}

	metadata.Publisher = strings.TrimSpace(raw.Publisher)
	metadata.Rights = strings.TrimSpace(raw.Rights)
	if len(raw.Date) > 0 {
		metadata.Year = yearFromDate(raw.Date[0].Value)
	}

	collectionByID := map[string]string{}
	for _, meta := range raw.Meta {
		if strings.EqualFold(meta.Property, "belongs-to-collection") {
			metadata.Series = strings.TrimSpace(meta.Value)
			if meta.ID != "" {
				collectionByID[meta.ID] = metadata.Series
			}
		}
	}
	for _, meta := range raw.Meta {
		if strings.EqualFold(meta.Property, "group-position") {
			id := strings.TrimPrefix(meta.Refines, "#")
			if _, ok := collectionByID[id]; ok || metadata.Series != "" {
				metadata.BookNumber = strings.TrimSpace(meta.Value)
			}
		}
		if strings.EqualFold(meta.Name, "calibre:series") {
			metadata.Series = strings.TrimSpace(meta.Content)
		}
		if strings.EqualFold(meta.Name, "calibre:series_index") {
			metadata.BookNumber = strings.TrimSpace(meta.Content)
		}
	}

	return metadata
}

// yearFromDate pulls the leading 4-digit year out of an OPF dc:date (usually an ISO 8601 date or just a year).
func yearFromDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 4 {
		candidate := value[:4]
		for _, r := range candidate {
			if r < '0' || r > '9' {
				return ""
			}
		}
		return candidate
	}
	return ""
}

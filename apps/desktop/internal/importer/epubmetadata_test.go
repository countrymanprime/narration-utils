package importer

import "testing"

func opfMetadataEPUB(t *testing.T, metadataXML string) string {
	t.Helper()
	return epubFixture(t, map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": epubContainerXML,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0">` +
			`<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` + metadataXML + `</metadata>` +
			`<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>` +
			`<spine><itemref idref="ch1"/></spine></package>`,
		"OEBPS/ch1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>Text.</p></body></html>`,
	})
}

func TestReadEPUBMetadataReadsTitleAuthorPublisherRightsAndDate(t *testing.T) {
	path := opfMetadataEPUB(t, `<dc:title>After the Applause</dc:title>`+
		`<dc:creator opf:role="aut">Adrian Crow</dc:creator>`+
		`<dc:publisher>Lighthouse Books</dc:publisher>`+
		`<dc:rights>Copyright (c) 2026 Adrian Crow</dc:rights>`+
		`<dc:date>2026-01-15</dc:date>`)

	metadata, ok := ReadEPUBMetadata(path)

	if !ok {
		t.Fatal("ok = false, want true")
	}
	if metadata.Title != "After the Applause" {
		t.Fatalf("Title = %q", metadata.Title)
	}
	if metadata.Author != "Adrian Crow" {
		t.Fatalf("Author = %q", metadata.Author)
	}
	if metadata.Publisher != "Lighthouse Books" {
		t.Fatalf("Publisher = %q", metadata.Publisher)
	}
	if metadata.Rights != "Copyright (c) 2026 Adrian Crow" {
		t.Fatalf("Rights = %q", metadata.Rights)
	}
	if metadata.Year != "2026" {
		t.Fatalf("Year = %q", metadata.Year)
	}
}

func TestReadEPUBMetadataIgnoresANarratorCreator(t *testing.T) {
	path := opfMetadataEPUB(t, `<dc:title>Book</dc:title>`+
		`<dc:creator opf:role="aut">Adrian Crow</dc:creator>`+
		`<dc:creator opf:role="nrt">Voice Actor</dc:creator>`)

	metadata, ok := ReadEPUBMetadata(path)

	if !ok || metadata.Author != "Adrian Crow" {
		t.Fatalf("metadata = %+v, %v, want only the aut creator", metadata, ok)
	}
}

func TestReadEPUBMetadataUsesTheLoneCreatorWhenNoRoleIsGiven(t *testing.T) {
	path := opfMetadataEPUB(t, `<dc:title>Book</dc:title><dc:creator>Adrian Crow</dc:creator>`)

	metadata, ok := ReadEPUBMetadata(path)

	if !ok || metadata.Author != "Adrian Crow" {
		t.Fatalf("metadata = %+v, %v, want the lone creator used as Author", metadata, ok)
	}
}

func TestReadEPUBMetadataReadsAnEPUB3SubtitleAndCollection(t *testing.T) {
	path := opfMetadataEPUB(t, `<dc:title id="t1">After the Applause</dc:title>`+
		`<meta refines="#t1" property="title-type">main</meta>`+
		`<dc:title id="t2">A Novel</dc:title>`+
		`<meta refines="#t2" property="title-type">subtitle</meta>`+
		`<meta id="c1" property="belongs-to-collection">Ember</meta>`+
		`<meta refines="#c1" property="group-position">2</meta>`)

	metadata, ok := ReadEPUBMetadata(path)

	if !ok {
		t.Fatal("ok = false, want true")
	}
	if metadata.Title != "After the Applause" || metadata.Subtitle != "A Novel" {
		t.Fatalf("Title = %q, Subtitle = %q", metadata.Title, metadata.Subtitle)
	}
	if metadata.Series != "Ember" || metadata.BookNumber != "2" {
		t.Fatalf("Series = %q, BookNumber = %q", metadata.Series, metadata.BookNumber)
	}
}

func TestReadEPUBMetadataReadsACalibreSeries(t *testing.T) {
	path := opfMetadataEPUB(t, `<dc:title>Book</dc:title>`+
		`<meta name="calibre:series" content="Ember"/>`+
		`<meta name="calibre:series_index" content="2"/>`)

	metadata, ok := ReadEPUBMetadata(path)

	if !ok || metadata.Series != "Ember" || metadata.BookNumber != "2" {
		t.Fatalf("metadata = %+v, %v", metadata, ok)
	}
}

func TestReadEPUBMetadataIsFalseWithNoMetadataFields(t *testing.T) {
	path := opfMetadataEPUB(t, ``)

	_, ok := ReadEPUBMetadata(path)

	if ok {
		t.Fatal("ok = true, want false: no metadata fields are set")
	}
}

func TestReadEPUBMetadataIsFalseForAMissingFile(t *testing.T) {
	_, ok := ReadEPUBMetadata("/no/such/file.epub")
	if ok {
		t.Fatal("ok = true, want false")
	}
}

func FuzzReadEPUBMetadata(f *testing.F) {
	f.Add(`<dc:title>Book</dc:title><dc:creator opf:role="aut">A. Writer</dc:creator>`)
	f.Add(``)
	f.Add(`<meta name="calibre:series" content="X"/><meta refines="#t1" property="title-type">main</meta>`)
	f.Fuzz(func(t *testing.T, metadataXML string) {
		path := opfMetadataEPUB(t, metadataXML)
		ReadEPUBMetadata(path)
	})
}

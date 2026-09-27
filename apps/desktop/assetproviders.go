package main

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/dictionary"
	"github.com/countrymanprime/narration-utils/shell/internal/ffmpeg"
	"github.com/countrymanprime/narration-utils/shell/internal/moonshine"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// ttsProvider serves the Piper preview voices.
type ttsProvider struct{ manager *tts.Manager }

func (ttsProvider) kind() string      { return installKindTts }
func (ttsProvider) label() string     { return "Preview voice" }
func (ttsProvider) noun() string      { return "voice" }
func (ttsProvider) endedKind() string { return jobKindTtsInstall }

func (p ttsProvider) items() []assetItem {
	voices := p.manager.Voices()
	items := make([]assetItem, 0, len(voices))
	for _, voice := range voices {
		items = append(items, p.itemFor(voice))
	}
	return items
}

func (p ttsProvider) itemFor(voice tts.Voice) assetItem {
	return assetItem{kind: installKindTts, id: voice.ID, displayName: voice.DisplayName, version: voice.Version, publisher: voice.Publisher, license: voice.License,
		licenseURL: voice.LicenseURL, modelCardURL: voice.ModelCardURL, provenanceURL: voice.ProvenanceURL, attribution: voice.Attribution, files: voice.Files, dir: p.manager.InstallDir(voice.ID)}
}

func (p ttsProvider) item(id string) (assetItem, bool) {
	voice, ok := p.manager.Voice(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(voice), true
}

func (p ttsProvider) state(id string) string {
	voice, ok := p.manager.Voice(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(voice)
}

func (p ttsProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p ttsProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p ttsProvider) remove(id string) error           { return p.manager.Remove(id) }

// whisperProvider serves the faster-whisper transcription models.
type whisperProvider struct{ manager *whisper.Manager }

func (whisperProvider) kind() string      { return installKindWhisper }
func (whisperProvider) label() string     { return "Whisper model" }
func (whisperProvider) noun() string      { return "Whisper model" }
func (whisperProvider) endedKind() string { return jobKindWhisperInstall }

func (p whisperProvider) items() []assetItem {
	models := p.manager.Models()
	items := make([]assetItem, 0, len(models))
	for _, model := range models {
		items = append(items, p.itemFor(model))
	}
	return items
}

func (p whisperProvider) itemFor(model whisper.Model) assetItem {
	return assetItem{kind: installKindWhisper, id: model.ID, displayName: model.DisplayName, version: model.Version, publisher: model.Publisher, license: model.License,
		licenseURL: model.LicenseURL, modelCardURL: model.ModelCardURL, provenanceURL: model.ProvenanceURL, attribution: model.Attribution, files: model.Files, dir: p.manager.InstallDir(model.ID)}
}

func (p whisperProvider) item(id string) (assetItem, bool) {
	model, ok := p.manager.Model(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(model), true
}

func (p whisperProvider) state(id string) string {
	model, ok := p.manager.Model(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(model)
}

func (p whisperProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p whisperProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p whisperProvider) remove(id string) error           { return p.manager.Remove(id) }

// spacyProvider serves the spaCy language models the Story Bible reads a manuscript with.
type spacyProvider struct{ manager *spacy.Manager }

func (spacyProvider) kind() string      { return installKindSpacy }
func (spacyProvider) label() string     { return "Story Bible language model" }
func (spacyProvider) noun() string      { return "language model" }
func (spacyProvider) endedKind() string { return jobKindSpacyInstall }

func (p spacyProvider) items() []assetItem {
	models := p.manager.Models()
	items := make([]assetItem, 0, len(models))
	for _, model := range models {
		items = append(items, p.itemFor(model))
	}
	return items
}

func (p spacyProvider) itemFor(model spacy.Model) assetItem {
	return assetItem{kind: installKindSpacy, id: model.ID, displayName: model.DisplayName, version: model.Version, publisher: model.Publisher, license: model.License,
		licenseURL: model.LicenseURL, modelCardURL: model.ModelCardURL, provenanceURL: model.ProvenanceURL, attribution: model.Attribution, files: model.Files,
		dir: p.manager.InstallDir(model.ID), diskSize: model.DiskSize()}
}

func (p spacyProvider) item(id string) (assetItem, bool) {
	model, ok := p.manager.Model(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(model), true
}

func (p spacyProvider) state(id string) string {
	model, ok := p.manager.Model(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(model)
}

func (p spacyProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p spacyProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p spacyProvider) remove(id string) error           { return p.manager.Remove(id) }

// moonshineProvider serves the Moonshine streaming speech-to-text models the live Teleprompter engine uses (phase 5). Its ids (`tiny`,
// `small`) are the same words the Whisper catalog uses; the two never collide because assetItem.dir is built from the catalog entry's own
// Provider ("moonshine" here), not the kind alone.
type moonshineProvider struct{ manager *moonshine.Manager }

func (moonshineProvider) kind() string      { return installKindMoonshine }
func (moonshineProvider) label() string     { return "Moonshine model" }
func (moonshineProvider) noun() string      { return "Moonshine model" }
func (moonshineProvider) endedKind() string { return jobKindMoonshineInstall }

func (p moonshineProvider) items() []assetItem {
	models := p.manager.Models()
	items := make([]assetItem, 0, len(models))
	for _, model := range models {
		items = append(items, p.itemFor(model))
	}
	return items
}

func (p moonshineProvider) itemFor(model moonshine.Model) assetItem {
	return assetItem{kind: installKindMoonshine, id: model.ID, displayName: model.DisplayName, version: model.Version, publisher: model.Publisher, license: model.License,
		licenseURL: model.LicenseURL, modelCardURL: model.ModelCardURL, provenanceURL: model.ProvenanceURL, attribution: model.Attribution, files: model.Files, dir: p.manager.InstallDir(model.ID)}
}

func (p moonshineProvider) item(id string) (assetItem, bool) {
	model, ok := p.manager.Model(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(model), true
}

func (p moonshineProvider) state(id string) string {
	model, ok := p.manager.Model(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(model)
}

func (p moonshineProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p moonshineProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p moonshineProvider) remove(id string) error           { return p.manager.Remove(id) }

// dictionaryProvider serves the offline dictionary the manuscript reader's Look up reads (ADR 0097). Its install unpacks the release and
// builds the lookup index from it (internal/dictionary), so what it takes on disk is the index, not the download.
type dictionaryProvider struct{ manager *dictionary.Manager }

func (dictionaryProvider) kind() string      { return installKindDictionary }
func (dictionaryProvider) label() string     { return "Dictionary" }
func (dictionaryProvider) noun() string      { return "dictionary" }
func (dictionaryProvider) endedKind() string { return jobKindDictionaryInstall }

func (p dictionaryProvider) items() []assetItem {
	dictionaries := p.manager.Dictionaries()
	items := make([]assetItem, 0, len(dictionaries))
	for _, entry := range dictionaries {
		items = append(items, p.itemFor(entry))
	}
	return items
}

func (p dictionaryProvider) itemFor(entry dictionary.Dictionary) assetItem {
	return assetItem{kind: installKindDictionary, id: entry.ID, displayName: entry.DisplayName, version: entry.Version, publisher: entry.Publisher, license: entry.License,
		licenseURL: entry.LicenseURL, modelCardURL: entry.ModelCardURL, provenanceURL: entry.ProvenanceURL, attribution: entry.Attribution, files: entry.Files,
		dir: p.manager.InstallDir(entry.ID), diskSize: entry.DiskSize()}
}

func (p dictionaryProvider) item(id string) (assetItem, bool) {
	entry, ok := p.manager.Dictionary(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(entry), true
}

func (p dictionaryProvider) state(id string) string {
	entry, ok := p.manager.Dictionary(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(entry)
}

func (p dictionaryProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p dictionaryProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p dictionaryProvider) remove(id string) error           { return p.manager.Remove(id) }

// encoderProvider serves the FFmpeg build the MP3 encoder runs (render-encode-master Phase 1, ADR 0342). Its install unpacks the
// pinned wheel and keeps only the executable (internal/ffmpeg), so what it takes on disk is ffmpeg.exe, not the download. It is
// offered on Windows only: the catalog has no build for another platform.
type encoderProvider struct{ manager *ffmpeg.Manager }

func (encoderProvider) kind() string      { return installKindEncoder }
func (encoderProvider) label() string     { return "Encoder" }
func (encoderProvider) noun() string      { return "encoder" }
func (encoderProvider) endedKind() string { return jobKindEncoderInstall }

func (p encoderProvider) items() []assetItem {
	builds := p.manager.Builds()
	items := make([]assetItem, 0, len(builds))
	for _, build := range builds {
		items = append(items, p.itemFor(build))
	}
	return items
}

func (p encoderProvider) itemFor(build ffmpeg.Build) assetItem {
	return assetItem{kind: installKindEncoder, id: build.ID, displayName: build.DisplayName, version: build.Version, publisher: build.Publisher, license: build.License,
		licenseURL: build.LicenseURL, modelCardURL: build.ModelCardURL, provenanceURL: build.ProvenanceURL, attribution: build.Attribution, files: build.Files,
		dir: p.manager.InstallDir(build.ID), diskSize: build.DiskSize()}
}

func (p encoderProvider) item(id string) (assetItem, bool) {
	build, ok := p.manager.Build(id)
	if !ok {
		return assetItem{}, false
	}
	return p.itemFor(build), true
}

func (p encoderProvider) state(id string) string {
	build, ok := p.manager.Build(id)
	if !ok {
		return "not_installed"
	}
	return p.manager.State(build)
}

func (p encoderProvider) install(ctx context.Context, id string, options assets.Options) error {
	if p.state(id) == "installed" {
		return nil
	}
	return p.manager.Repair(ctx, id, options)
}

func (p encoderProvider) verify(id string) (string, error) { return p.manager.Verify(id) }
func (p encoderProvider) remove(id string) error           { return p.manager.Remove(id) }

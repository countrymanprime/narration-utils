package main

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/moonshine"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// kind is one kind of approved asset as the seeding command sees it: the ids its catalog approves, and the operations on one of them. It
// is the same three managers the desktop host builds its registry from, so a seeded asset is exactly what the app would have installed.
type kind interface {
	name() string
	ids() []string
	state(id string) string
	install(ctx context.Context, id string, options assets.Options) error
	verify(id string) (string, error)
	dir(id string) string
}

// seeder installs approved catalog assets by kind[/id] into the per-user cache. It downloads only what the catalogs name (the same pinned
// URLs, sizes and SHA-256 the app uses) and refuses anything else.
type seeder struct {
	kinds []kind
	out   io.Writer
	// now is a seam for progress lines.
	now func() time.Time
}

// selection is one kind, optionally narrowed to one id.
type selection struct{ kind, id string }

// parse turns the command-line words into selections: "tts", "tts/en_US-ljspeech-high", or "all" (every asset of every kind). A word that is
// not one of those is an error before anything downloads.
func (s *seeder) parse(words []string) ([]selection, error) {
	var picked []selection
	for _, word := range words {
		if word == "all" {
			for _, k := range s.kinds {
				picked = append(picked, selection{kind: k.name()})
			}
			continue
		}
		name, id, _ := strings.Cut(word, "/")
		k, ok := s.find(name)
		if !ok {
			return nil, fmt.Errorf("%q is not an approved kind of asset (known: %s)", name, strings.Join(s.names(), ", "))
		}
		if id != "" && !contains(k.ids(), id) {
			return nil, fmt.Errorf("%q is not in the approved catalog of %s (approved: %s)", id, name, strings.Join(k.ids(), ", "))
		}
		picked = append(picked, selection{kind: name, id: id})
	}
	if len(picked) == 0 {
		return nil, fmt.Errorf("name what to install: a kind (%s), kind/id, or all", strings.Join(s.names(), ", "))
	}
	return picked, nil
}

func (s *seeder) find(name string) (kind, bool) {
	for _, k := range s.kinds {
		if k.name() == name {
			return k, true
		}
	}
	return nil, false
}

func (s *seeder) names() []string {
	names := make([]string, 0, len(s.kinds))
	for _, k := range s.kinds {
		names = append(names, k.name())
	}
	sort.Strings(names)
	return names
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// seed installs every selected asset (an asset that is installed and verifies is left alone), then reads every byte of each one again and
// requires it to verify. It stops at the first failure and says which asset failed; what was already installed stays installed.
func (s *seeder) seed(ctx context.Context, picked []selection) error {
	for _, pick := range picked {
		k, _ := s.find(pick.kind)
		ids := k.ids()
		if pick.id != "" {
			ids = []string{pick.id}
		}
		if len(ids) == 0 {
			// A catalog with nothing in it would otherwise "succeed" and leave a packaging check passing for the wrong reason.
			return fmt.Errorf("the approved catalog of %s has no assets", k.name())
		}
		for _, id := range ids {
			if err := s.one(ctx, k, id); err != nil {
				return fmt.Errorf("%s/%s: %w", k.name(), id, err)
			}
		}
	}
	return nil
}

func (s *seeder) one(ctx context.Context, k kind, id string) error {
	label := k.name() + "/" + id
	if k.state(id) == "installed" {
		if state, err := k.verify(id); err == nil && state == "installed" {
			s.printf("%s: already installed and verified at %s\n", label, k.dir(id))
			return nil
		}
	}
	last := time.Time{}
	options := assets.Options{
		OnProgress: func(file assets.File, done int64) {
			// One line a second, and one when a file is whole: enough to see it is moving, not a wall of text.
			if now := s.now(); done >= file.Size || now.Sub(last) >= time.Second {
				last = now
				s.printf("%s: %s %d of %d bytes\n", label, file.Name, done, file.Size)
			}
		},
	}
	if err := k.install(ctx, id, options); err != nil {
		return err
	}
	state, err := k.verify(id)
	if err != nil {
		return err
	}
	if state != "installed" {
		return fmt.Errorf("it did not verify after the install (%s)", state)
	}
	s.printf("%s: installed and verified at %s\n", label, k.dir(id))
	return nil
}

func (s *seeder) printf(format string, args ...any) { _, _ = fmt.Fprintf(s.out, format, args...) }

// list writes every approved asset and its state.
func (s *seeder) list() {
	for _, k := range s.kinds {
		for _, id := range k.ids() {
			s.printf("%s/%s\t%s\t%s\n", k.name(), id, k.state(id), k.dir(id))
		}
	}
}

// ttsKind, whisperKind and spacyKind adapt the three managers to kind. They are one-liners over the manager: the lifecycle is
// internal/assets, not here.
type ttsKind struct{ m *tts.Manager }

func (ttsKind) name() string { return "tts" }
func (k ttsKind) ids() []string {
	var ids []string
	for _, voice := range k.m.Voices() {
		ids = append(ids, voice.ID)
	}
	return ids
}
func (k ttsKind) state(id string) string {
	if voice, ok := k.m.Voice(id); ok {
		return k.m.State(voice)
	}
	return "not_installed"
}
func (k ttsKind) install(ctx context.Context, id string, o assets.Options) error {
	return k.m.Repair(ctx, id, o)
}
func (k ttsKind) verify(id string) (string, error) { return k.m.Verify(id) }
func (k ttsKind) dir(id string) string             { return k.m.InstallDir(id) }

type whisperKind struct{ m *whisper.Manager }

func (whisperKind) name() string { return "whisper" }
func (k whisperKind) ids() []string {
	var ids []string
	for _, model := range k.m.Models() {
		ids = append(ids, model.ID)
	}
	return ids
}
func (k whisperKind) state(id string) string {
	if model, ok := k.m.Model(id); ok {
		return k.m.State(model)
	}
	return "not_installed"
}
func (k whisperKind) install(ctx context.Context, id string, o assets.Options) error {
	return k.m.Repair(ctx, id, o)
}
func (k whisperKind) verify(id string) (string, error) { return k.m.Verify(id) }
func (k whisperKind) dir(id string) string             { return k.m.InstallDir(id) }

type spacyKind struct{ m *spacy.Manager }

func (spacyKind) name() string    { return "spacy" }
func (k spacyKind) ids() []string { return k.m.IDs() }
func (k spacyKind) state(id string) string {
	if model, ok := k.m.Model(id); ok {
		return k.m.State(model)
	}
	return "not_installed"
}
func (k spacyKind) install(ctx context.Context, id string, o assets.Options) error {
	return k.m.Repair(ctx, id, o)
}
func (k spacyKind) verify(id string) (string, error) { return k.m.Verify(id) }
func (k spacyKind) dir(id string) string             { return k.m.InstallDir(id) }

type moonshineKind struct{ m *moonshine.Manager }

func (moonshineKind) name() string { return "moonshine" }
func (k moonshineKind) ids() []string {
	var ids []string
	for _, model := range k.m.Models() {
		ids = append(ids, model.ID)
	}
	return ids
}
func (k moonshineKind) state(id string) string {
	if model, ok := k.m.Model(id); ok {
		return k.m.State(model)
	}
	return "not_installed"
}
func (k moonshineKind) install(ctx context.Context, id string, o assets.Options) error {
	return k.m.Repair(ctx, id, o)
}
func (k moonshineKind) verify(id string) (string, error) { return k.m.Verify(id) }
func (k moonshineKind) dir(id string) string             { return k.m.InstallDir(id) }

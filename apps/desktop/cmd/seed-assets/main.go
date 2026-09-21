// Command seed-assets installs approved catalog assets (the Piper voice, Whisper models and spaCy language models) into the per-user asset
// cache, hash-verified, without the app. It is a developer-only tool for offline tests and packaging checks: the release never runs it,
// `pnpm run bootstrap` never runs it (bootstrap preloads nothing), and a narrator uses the app's own first-use download instead.
//
// It uses the same managers, catalogs and cache layout as the desktop host, so what it installs is exactly what the app would have
// installed and the app recognises it on its next start. It installs only what the checkout's catalogs name, from their pinned URLs.
//
//	go run ./cmd/seed-assets --list
//	go run ./cmd/seed-assets tts                         (every approved voice)
//	go run ./cmd/seed-assets tts/en_US-ljspeech-high whisper/tiny spacy/en_core_web_sm
//	go run ./cmd/seed-assets --cache-dir D:\assets all   (a folder of your choice; the app reads only the per-user cache)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	// After the first Ctrl-C the default behavior comes back, so a second one ends a step that does not watch the context.
	go func() { <-ctx.Done(); stop() }()
	err := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	switch {
	case err == nil:
	case errors.Is(err, flag.ErrHelp):
		// The usage was printed; asking for it is not a failure.
	default:
		_, _ = fmt.Fprintln(os.Stderr, "seed-assets:", err)
		stop()
		os.Exit(1)
	}
	stop()
}

// run is main without the process: it parses args, builds the managers over the cache and does what was asked.
func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("seed-assets", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() {
		_, _ = fmt.Fprintln(stderr, "usage: seed-assets [--list] [--repo-root DIR] [--cache-dir DIR] <kind | kind/id | all>...")
		flags.PrintDefaults()
	}
	list := flags.Bool("list", false, "print every approved asset and its state, and install nothing")
	repoRoot := flags.String("repo-root", "", "the checkout whose config/*-assets.json catalogs are used (default: the checkout that holds the working directory); its catalogs are trusted input, so only use a checkout you trust")
	cacheDir := flags.String("cache-dir", "", "install here instead of the per-user asset cache (the app only reads the per-user cache)")
	// `pnpm run assets:seed -- --list` hands over the separator too; it is not an argument.
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	seeder, err := newSeeder(*repoRoot, *cacheDir, stdout)
	if err != nil {
		return err
	}
	if *list {
		seeder.list()
		return nil
	}
	picked, err := seeder.parse(flags.Args())
	if err != nil {
		return err
	}
	return seeder.seed(ctx, picked)
}

// newSeeder opens the three catalogs of a checkout over the cache folder. A catalog that cannot be read is an error here, not a quiet
// omission: a seeding command that skips a kind would leave a packaging check passing for the wrong reason.
func newSeeder(repoRoot, cacheDir string, out io.Writer) (*seeder, error) {
	if repoRoot == "" {
		working, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		repoRoot = layout.FindRoot(working)
	}
	base := cacheDir
	if base == "" {
		var err error
		if base, err = assets.CacheBase(); err != nil {
			return nil, err
		}
	}
	catalog := func(rel string) string { return layout.Path(repoRoot, rel) }
	voices, err := tts.New(catalog(layout.TTSCatalogFile), filepath.Join(base, assets.TTSDir))
	if err != nil {
		return nil, fmt.Errorf("the voice catalog: %w (run this from a checkout, or pass --repo-root)", err)
	}
	models, err := whisper.New(catalog(layout.WhisperCatalogFile), filepath.Join(base, assets.WhisperDir))
	if err != nil {
		return nil, fmt.Errorf("the Whisper catalog: %w", err)
	}
	languageModels, err := spacy.New(catalog(layout.SpacyCatalogFile), filepath.Join(base, assets.SpacyDir))
	if err != nil {
		return nil, fmt.Errorf("the spaCy catalog: %w", err)
	}
	return &seeder{kinds: []kind{ttsKind{voices}, whisperKind{models}, spacyKind{languageModels}}, out: out, now: time.Now}, nil
}

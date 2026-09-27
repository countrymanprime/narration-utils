package main

import (
	"context"
	"errors"
	"runtime"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// Wiring internal/measure's Decoder capability (Phase 8, P11) to the catalogued FFmpeg row internal/encodeport
// registers. internal/measure never imports encodeport (encodeport already imports measure, for ReadMP3), so this
// host-layer adapter is where the two meet, and where encodeport.ErrEncoderNotInstalled becomes
// measure.ErrDecoderNotAvailable: a not-yet-downloaded (or platform-unsupported) encoder reads to a delivery rule as
// "not checked", the same as before this phase existed, never as "not measurable" — that status is reserved for a
// decode that was actually attempted and found nothing usable.

// mp3Decoder adapts an encodeport.Decoder to measure.Decoder.
type mp3Decoder struct{ decoder encodeport.Decoder }

var _ measure.Decoder = mp3Decoder{}

func (d mp3Decoder) DecodeToWAV(ctx context.Context, src, dst string) error {
	err := d.decoder.DecodeToWAV(ctx, src, dst)
	if errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		return measure.ErrDecoderNotAvailable
	}
	return err
}

// mp3LevelDecoder answers the Decoder a measurement should use to read an MP3's levels on this platform, or nil when
// no catalogued row declares support here (render-encode-master Phase 1's FFmpeg row is Windows-only today). Whether
// that row's binary is actually installed yet is not checked here: DecodeToWAV answers ErrDecoderNotAvailable itself
// when it is not, at the moment a measurement actually needs it.
func mp3LevelDecoder() measure.Decoder {
	entry, err := encodeport.Decoders.Lookup(encodeport.FFmpegName)
	if err != nil || !entry.Descriptor.RunsOn(runtime.GOOS) {
		return nil
	}
	return mp3Decoder{decoder: entry.New()}
}

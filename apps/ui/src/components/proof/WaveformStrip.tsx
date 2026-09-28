import { useEffect, useRef, useState } from 'react';
import { Timeline, TimelineLane } from '../primitives/Timeline';
import type { PlaylistSegment } from './playlist';
import type { Flag } from './flags';
import type { WorkspaceItem, WorkspacePeaksResult, WorkspaceToken } from '../../api/contracts/workspace';
import { bucketAt, decodeMinMax } from './peaksDecode';
import { buildFlagMarkers, buildWaveformSegments, type WaveformSegment } from './waveformLayout';

const BACKDROP_HEIGHT = 56;

/** The canvas `Timeline` draws behind its lanes (its own `backdrop` prop, `aria-hidden`): one bar per pixel column,
 * resampled from each segment's own buckets, coloured played (before the playhead) or not yet played. An item with
 * no peaks (Reason set: not live, no source, or not a WAV, EP12 A) draws as a flat muted line rather than a gap. */
function WaveformBackdrop({ segments, duration, elapsed }: { segments: WaveformSegment[]; duration: number; elapsed: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    // jsdom (the component test environment) has no ResizeObserver; the canvas just stays at its initial width
    // there, and this backdrop draws nothing until it has one - the visual suite (a real browser) always has one.
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || duration <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = BACKDROP_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, BACKDROP_HEIGHT);

    const styles = getComputedStyle(canvas);
    const playedColor = styles.getPropertyValue('--accent').trim() || '#b85c1e';
    const unplayedColor = styles.getPropertyValue('--border').trim() || '#3c3527';
    const center = BACKDROP_HEIGHT / 2;
    const playheadX = (elapsed / duration) * width;

    for (const segment of segments) {
      const x0 = (segment.start / duration) * width;
      const x1 = Math.max(x0 + 1, (segment.end / duration) * width);
      const segmentWidth = x1 - x0;
      const decoded = segment.entry?.peaks ? decodeMinMax(segment.entry.peaks) : undefined;

      for (let px = 0; px < segmentWidth; px += 1) {
        const x = x0 + px;
        ctx.strokeStyle = x <= playheadX ? playedColor : unplayedColor;
        ctx.beginPath();
        if (decoded && segment.entry?.peaks) {
          const fraction = segmentWidth > 0 ? px / segmentWidth : 0;
          const [low, high] = bucketAt(decoded, segment.entry.peaks.buckets, fraction);
          const scale = center / 127;
          ctx.moveTo(x + 0.5, center - high * scale);
          ctx.lineTo(x + 0.5, center - low * scale);
        } else {
          // No peaks (not live, no source, or not a WAV, EP12 A): a flat line, not a gap.
          ctx.moveTo(x + 0.5, center - 0.5);
          ctx.lineTo(x + 0.5, center + 0.5);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = unplayedColor;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, 0);
      ctx.lineTo(x0 + 0.5, BACKDROP_HEIGHT);
      ctx.stroke();
    }
  }, [segments, width, elapsed, duration]);

  return (
    <div ref={containerRef}>
      <canvas ref={canvasRef} style={{ width: '100%', height: BACKDROP_HEIGHT, display: 'block' }} />
    </div>
  );
}

export type WaveformStripProps = {
  playlist: PlaylistSegment[];
  alignmentItems: WorkspaceItem[];
  peaks: WorkspacePeaksResult | undefined;
  tokens: WorkspaceToken[];
  flags: Flag[];
  elapsed: number;
  duration: number;
  /** Selects the flag a marker names, mirroring FlagsPanel's own onSelect (both read the same `flags` array, by
   * index) so a pin here and a row there stay the same selection. */
  onSelectFlag?: (index: number) => void;
};

/** The chapter workspace's waveform strip (edit-and-proof-workspace.prd.md Phase 5, ADR 0520): `Timeline`'s own
 * ruler and playhead (its `backdrop` prop, reserved for exactly this, studio-ui-primitives.prd.md mock 04) over
 * host-computed peaks (measure.ComputePeaks, EP12 A), with the check's flags marked on a `TimelineLane` so they
 * share NotesStrip.tsx's own accessible, keyboard-navigable markers rather than a second, bespoke implementation
 * (mockups/edit-and-proof-workspace/01-playing-follow.webp). Selection (Phase 9, an FX context menu over a
 * passage) is not built here - Phase 9 depends on it as its own step. */
export function WaveformStrip({ playlist, alignmentItems, peaks, tokens, flags, elapsed, duration, onSelectFlag }: WaveformStripProps) {
  const segments = buildWaveformSegments(playlist, alignmentItems, peaks);
  const markers = buildFlagMarkers(flags, tokens, alignmentItems, playlist);

  return (
    <section aria-label="The chapter's waveform" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 pt-2 pb-1 shadow-[var(--shadow)]">
      <Timeline
        duration={duration}
        playhead={duration > 0 ? elapsed : undefined}
        backdrop={<WaveformBackdrop segments={segments} duration={duration} elapsed={elapsed} />}
      >
        <TimelineLane
          label="Flags"
          duration={duration}
          markers={markers}
          onActivate={(id) => {
            const index = flags.findIndex((flag) => flag.id === id);
            if (index !== -1) onSelectFlag?.(index);
          }}
        />
      </Timeline>
    </section>
  );
}

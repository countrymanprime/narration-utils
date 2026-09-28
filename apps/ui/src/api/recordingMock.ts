// The mock built-in recorder (native-recording-suite Phase 2, ADR 0455; D67 mock-first): a stand-in for
// apps/desktop/bindings_recording.go over internal/recording, so the Booth's recorder and the visual suite run with no
// microphone. Its payloads follow the host goldens (tests/fixtures/contracts/recorder-*.json; wireContracts.test.ts
// pins them). A take "records" in memory: Start publishes a steady level and Stop adds the next take to the list.
import type { RecorderDevicesResult, RecorderLevel, RecorderState, RecorderTake, RecordingApi, RecordingEngine } from './contracts/recording';
import { wireClone } from './mockFixtures';

const FOLDER = 'C:/Projects/Alice/Recordings';
const DEVICES = ['Microphone Array (Realtek(R) Audio)', 'Analogue 1 + 2 (Focusrite USB Audio)'];
// The mock's level while it meters or records: steady, so a capture of it is the same every run (mock 03's "−14.2 pk").
const LEVEL: RecorderLevel = { peak: -14.2, rms: -24.6 };
const LEVEL_MS = 100;
const STOP_MS = 40;
// Unix milliseconds for the seeded takes' file times (the goldens' 1790000000000 base).
const RECORDED_AT = 1790000000000;

const take = (number: number, seconds: number, unfinished = false): RecorderTake => {
  const name = `Take ${String(number).padStart(3, '0')}`;
  return {
    name,
    path: `${FOLDER}/${name}${unfinished ? '.partial' : ''}.wav`,
    seconds,
    sampleRate: 48000,
    channels: 1,
    bits: 24,
    recordedAt: RECORDED_AT + number * 60000,
    unfinished,
    lineId: null,
    keeper: false,
  };
};

export type RecordingMockSeed = {
  /** The project's engine; defaults to REAPER ('daw'), or 'builtin' with `?mockEngine=builtin` (mockApi.ts passes it). */
  engine?: RecordingEngine;
  /** Whether a project is open; defaults to true. */
  hasProject?: boolean;
  /** The wasapi row is unavailable (as off Windows): the built-in recorder cannot be chosen. */
  unavailable?: boolean;
  /** Takes already in the folder: none, or three (the default) of which the second is an unfinished partial. */
  takes?: 'none' | 'some';
  /** Boot part-way through a take (42 s in). */
  recording?: boolean;
  /** The last take ended on its own: the device stopped delivering audio, with dropouts. */
  lastTakeFailed?: boolean;
  /** The device list: two devices (default), none, or a listing error. */
  devices?: 'ok' | 'none' | 'error';
  /** Start is refused with the sidecar's sentence (a device that will not open). */
  startFails?: boolean;
};

export function createRecordingMock(seed: RecordingMockSeed = {}): RecordingApi {
  const hasProject = seed.hasProject ?? true;
  const support: RecorderState['support'] = seed.unavailable
    ? { level: 'unsupported', available: false, reason: 'unsupported', message: 'WASAPI is not available on Linux.' }
    : { level: 'experimental', available: true };
  const takes: RecorderTake[] = hasProject && seed.takes !== 'none' ? [take(1, 38.4), take(2, 12.1, true), take(3, 64.9)] : [];
  let state: RecorderState = {
    hasProject,
    engine: hasProject && !seed.unavailable ? (seed.engine ?? 'daw') : 'daw',
    support,
    phase: 'idle',
    device: hasProject && takes.length > 0 ? DEVICES[1] : '',
    folder: hasProject ? FOLDER : '',
    take: null,
    startedAt: null,
    message: '',
    last: null,
    takes,
  };
  if (hasProject && seed.lastTakeFailed) {
    const message = `${DEVICES[1]} stopped delivering audio`;
    state = { ...state, message, last: { name: 'Take 003', seconds: 64.9, dropouts: 4, clipped: 0, latencyMs: 10, error: message, unfinished: false } };
  }
  const stateSubscribers = new Set<(value: RecorderState) => void>();
  const levelSubscribers = new Set<(value: RecorderLevel) => void>();
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  const publish = () => stateSubscribers.forEach((fn) => fn(wireClone(state)));
  const startLevels = () => {
    if (levelTimer !== undefined) return;
    const send = () => levelSubscribers.forEach((fn) => fn({ ...LEVEL }));
    send();
    levelTimer = setInterval(send, LEVEL_MS);
  };
  const stopLevels = () => {
    if (levelTimer !== undefined) clearInterval(levelTimer);
    levelTimer = undefined;
  };
  const nextNumber = () => state.takes.reduce((highest, t) => Math.max(highest, Number(t.name.slice(5))), 0) + 1;
  const builtin = () => {
    if (!hasProject) throw new Error('open a project before recording: its takes are saved in the project folder');
    if (state.engine !== 'builtin') throw new Error('choose the built-in recorder in the Booth before recording with it');
  };
  const answer = async () => wireClone(state);

  if (hasProject && seed.recording && state.engine === 'builtin') {
    state = { ...state, phase: 'recording', device: DEVICES[1], take: `Take ${String(nextNumber()).padStart(3, '0')}`, startedAt: Date.now() - 42000 };
    startLevels();
  }

  return {
    recorderState: answer,
    recorderChooseEngine: async (engine) => {
      if (!hasProject) throw new Error('open a project before choosing how it records');
      if (state.phase === 'recording' || state.phase === 'stopping') throw new Error('stop the take before changing how the project records');
      if (engine === 'builtin' && !support.available) throw new Error(support.message);
      if (engine === 'daw' && state.phase === 'metering') {
        stopLevels();
        state = { ...state, phase: 'idle' };
      }
      state = { ...state, engine };
      publish();
      return wireClone(state);
    },
    recorderDevices: async (): Promise<RecorderDevicesResult> => {
      if (seed.devices === 'error') return { devices: [], error: 'The built-in recorder cannot list devices here: PortAudio library not found' };
      if (seed.devices === 'none') return { devices: [], error: null };
      return { devices: DEVICES.map((name) => ({ name })), error: null };
    },
    recorderMeterStart: async (device) => {
      builtin();
      if (state.phase === 'recording' || state.phase === 'stopping') throw new Error('a take is recording; its level shows in the Booth');
      if (!device.trim()) throw new Error('choose a microphone');
      state = { ...state, phase: 'metering', device, message: '' };
      startLevels();
      publish();
      return wireClone(state);
    },
    recorderMeterStop: async () => {
      if (state.phase === 'metering') {
        stopLevels();
        state = { ...state, phase: 'idle' };
        publish();
      }
      return wireClone(state);
    },
    recorderStart: async (device) => {
      builtin();
      if (state.phase === 'recording' || state.phase === 'stopping') throw new Error('a take is already recording');
      if (!device.trim()) throw new Error('choose a microphone');
      if (seed.startFails) throw new Error(`The built-in recorder could not open ${device}: the device is in use by another application`);
      state = { ...state, phase: 'recording', device, take: `Take ${String(nextNumber()).padStart(3, '0')}`, startedAt: Date.now(), message: '' };
      startLevels();
      publish();
      return wireClone(state);
    },
    recorderStop: async () => {
      if (state.phase === 'metering') {
        stopLevels();
        state = { ...state, phase: 'idle' };
        publish();
        return wireClone(state);
      }
      if (state.phase !== 'recording') return wireClone(state);
      state = { ...state, phase: 'stopping' };
      publish();
      const stopping = wireClone(state);
      setTimeout(() => {
        stopLevels();
        const seconds = Math.max(1, Math.round((Date.now() - (state.startedAt ?? Date.now())) / 100) / 10);
        const number = nextNumber();
        state = {
          ...state,
          phase: 'idle',
          take: null,
          startedAt: null,
          last: { name: take(number, seconds).name, seconds, dropouts: 0, clipped: 0, latencyMs: 10, error: null, unfinished: false },
          takes: [...state.takes, take(number, seconds)],
        };
        publish();
      }, STOP_MS);
      return stopping;
    },
    recorderSetTakeLine: async (takeName, entityId) => {
      if (!hasProject) throw new Error('open a project before assigning a take a manuscript line');
      if (!state.takes.some((candidate) => candidate.name === takeName)) throw new Error(`${takeName} is not a take in this project`);
      const lineId = entityId === '' ? null : `${entityId}@mock-sha`;
      state = { ...state, takes: state.takes.map((candidate) => (candidate.name === takeName ? { ...candidate, lineId } : candidate)) };
      publish();
      return wireClone(state);
    },
    recorderSetTakeKeeper: async (takeName, keeper) => {
      if (!hasProject) throw new Error('open a project before marking a take the keeper');
      const target = state.takes.find((candidate) => candidate.name === takeName);
      if (!target) throw new Error(`${takeName} is not a take in this project`);
      state = {
        ...state,
        takes: state.takes.map((candidate) => {
          if (candidate.name === takeName) return { ...candidate, keeper };
          // Marking a take the keeper hands the mark over from any other take sharing its line; a take with no
          // line has no group to clear.
          if (keeper && target.lineId !== null && candidate.lineId === target.lineId) return { ...candidate, keeper: false };
          return candidate;
        }),
      };
      publish();
      return wireClone(state);
    },
    subscribeRecorderState: (onUpdate) => {
      stateSubscribers.add(onUpdate);
      return () => stateSubscribers.delete(onUpdate);
    },
    subscribeRecorderLevel: (onLevel) => {
      levelSubscribers.add(onLevel);
      return () => levelSubscribers.delete(onLevel);
    },
  };
}

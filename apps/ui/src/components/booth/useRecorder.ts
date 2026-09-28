import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { RecorderDevice, RecorderState, RecordingEngine } from '../../api/contracts/recording';
import { updateHeldPeak, type HeldPeak } from '../../levelMeter';
import type { InputLevel } from './useInputLevel';
import { errorText } from './useTeleprompterSession';

/** The Booth's built-in recorder (native-recording-suite PRD Phase 2, ADR 0455): the host's state, its live level and actions. */
export type Recorder = {
  /** The host's state; undefined until it first answers. */
  state?: RecorderState;
  /** The live level with the meter's peak hold, while the recorder meters or records. */
  level: InputLevel | null;
  /** The device the narrator chose here, else the one the project last recorded with. */
  device: string;
  chooseDevice: (device: string) => void;
  devices: RecorderDevice[];
  devicesError: string | null;
  devicesLoading: boolean;
  loadDevices: () => void;
  /** The last action's refusal, in a sentence; cleared by the next action. */
  error: string | null;
  /** True while an action waits for the host. */
  pending: boolean;
  builtin: boolean;
  recording: boolean;
  metering: boolean;
  chooseEngine: (engine: RecordingEngine) => void;
  toggleRecord: () => void;
  toggleMeter: () => void;
};

/** The project's recording engine for the engine chip (App.tsx): REAPER until the project chooses the built-in recorder. */
export function useRecordingEngine(): RecordingEngine {
  const api = useApi();
  const [engine, setEngine] = useState<RecordingEngine>('daw');
  useEffect(() => {
    let live = true;
    // A live change is newer than the first answer, which may still be on its way: once one arrives, the answer is dropped.
    let changed = false;
    const unsubscribe = api.subscribeRecorderState((state) => {
      changed = true;
      setEngine(state.engine);
    });
    void api
      .recorderState()
      .then((state) => live && !changed && setEngine(state.engine))
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api]);
  return engine;
}

export function useRecorder(): Recorder {
  const api = useApi();
  const [state, setState] = useState<RecorderState>();
  const [level, setLevel] = useState<InputLevel | null>(null);
  const [chosen, setChosen] = useState<string>();
  const [devices, setDevices] = useState<RecorderDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const held = useRef<HeldPeak>({ peak: -100, at: 0 });
  // ADR 0075's ref guard: a second click while the host answers the first does nothing.
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    let changed = false; // as in useRecordingEngine: a live change beats the first answer
    const unsubscribeState = api.subscribeRecorderState((next) => {
      changed = true;
      setState(next);
    });
    const unsubscribeLevel = api.subscribeRecorderLevel((next) => {
      held.current = updateHeldPeak(held.current, next.peak, Date.now());
      setLevel({ peak: held.current.peak, rms: next.rms });
    });
    void api
      .recorderState()
      .then((next) => live && !changed && setState(next))
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
      unsubscribeState();
      unsubscribeLevel();
    };
  }, [api]);

  const phase = state?.phase ?? 'idle';
  const builtin = state?.engine === 'builtin';
  // The level only means something while the device is open.
  useEffect(() => {
    if (phase === 'idle') {
      held.current = { peak: -100, at: 0 };
      setLevel(null);
    }
  }, [phase]);

  const loadDevices = useCallback(() => {
    setDevicesLoading(true);
    void api
      .recorderDevices()
      .then((result) => {
        setDevices(result.devices);
        setDevicesError(result.error);
      })
      .catch((reason) => {
        setDevices([]);
        setDevicesError(errorText(reason));
      })
      .finally(() => setDevicesLoading(false));
  }, [api]);
  useEffect(() => {
    if (builtin) loadDevices();
  }, [builtin, loadDevices]);

  const run = useCallback((action: () => Promise<RecorderState>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    void action()
      .then((next) => setState(next))
      .catch((reason) => setError(errorText(reason)))
      .finally(() => {
        busy.current = false;
        setPending(false);
      });
  }, []);

  const device = chosen ?? state?.device ?? '';
  const recording = phase === 'recording' || phase === 'stopping';
  const metering = phase === 'metering';

  // Leaving the Booth ends a meter, and a take too: the take is saved (Stop finishes its file), so a take never records on
  // with no Record control on screen to stop it.
  const openRef = useRef({ metering, recording });
  openRef.current = { metering, recording };
  useEffect(
    () => () => {
      if (openRef.current.recording) void api.recorderStop().catch(() => {});
      else if (openRef.current.metering) void api.recorderMeterStop().catch(() => {});
    },
    [api],
  );

  return {
    state,
    level,
    device,
    chooseDevice: (next) => {
      setChosen(next);
      if (metering && next) run(() => api.recorderMeterStart(next));
    },
    devices,
    devicesError,
    devicesLoading,
    loadDevices,
    error,
    pending,
    builtin,
    recording,
    metering,
    chooseEngine: (engine) => run(() => api.recorderChooseEngine(engine)),
    toggleRecord: () => run(() => (recording ? api.recorderStop() : api.recorderStart(device))),
    toggleMeter: () => run(() => (metering ? api.recorderMeterStop() : api.recorderMeterStart(device))),
  };
}

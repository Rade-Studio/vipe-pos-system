import { useRef, useState } from 'react';
import type { VipeApiClient } from '../api/contract';
import type { Bridge, StationSettings } from '../bridge/types';
import { backStep, nextStep, type StepId } from './flow';
import { Rail } from './Rail';
import { Resume } from './steps/Resume';
import { StepView } from './steps/StepView';
import '../styles/setup.css';

export interface SetupProps {
  api: VipeApiClient;
  bridge: Bridge;
  initial: StationSettings;
  onDone: () => void;
  onDefer: () => void;
}

export interface StepContext {
  api: VipeApiClient;
  bridge: Bridge;
  settings: StationSettings;
  /** Local change, saved on the next step change. */
  update: (patch: Partial<StationSettings>) => void;
  /** Save and go to the next step. */
  next: (patch?: Partial<StationSettings>) => Promise<void>;
  back: () => Promise<void>;
  finish: () => void;
}

function wasStarted(s: StationSettings) {
  return !s.setup.completed && s.setup.step !== 'welcome' && s.setup.maxStep > 1;
}

/** First-run setup: nine steps with the side menu, saved after every step. */
export function Setup({ api, bridge, initial, onDone, onDefer }: SetupProps) {
  const [settings, setSettings] = useState(initial);
  const [resuming, setResuming] = useState(wasStarted(initial));
  const current = useRef(initial);

  const persist = async (next: StationSettings) => {
    current.current = next;
    setSettings(next);
    await bridge.saveSettings(next);
  };

  const ctx: StepContext = {
    api,
    bridge,
    settings,
    update: (patch) => {
      const next = { ...current.current, ...patch };
      current.current = next;
      setSettings(next);
    },
    next: async (patch) => {
      const base = { ...current.current, ...patch };
      const setup = nextStep(base.setup, base.printers.length);
      const done = setup.step === 'done';
      await persist({ ...base, setup: { ...setup, completed: done || setup.completed, deferred: done ? false : setup.deferred } });
    },
    back: async () => {
      const s = current.current;
      await persist({ ...s, setup: backStep(s.setup, s.printers.length) });
    },
    finish: onDone,
  };

  const jump = async (step: StepId) => {
    const s = current.current;
    setResuming(false);
    await persist({ ...s, setup: { ...s.setup, step, printerIndex: 0 } });
  };

  const defer = async () => {
    const s = current.current;
    await persist({ ...s, setup: { ...s.setup, deferred: true } });
    onDefer();
  };

  const restart = async () => {
    const s = current.current;
    setResuming(false);
    await persist({ ...s, printers: [], setup: { ...s.setup, step: s.deviceToken ? 'prints' : 'welcome', printerIndex: 0, maxStep: s.deviceToken ? 3 : 1 } });
  };

  const canDefer = settings.setup.maxStep >= 3 && settings.setup.step !== 'done' && !resuming;

  return (
    <div className="shell">
      <div className="body">
        <Rail progress={settings.setup} onJump={jump} onDefer={canDefer ? defer : undefined} />
        <main className="run-main">
          {resuming ? (
            <Resume settings={settings} onContinue={() => setResuming(false)} onRestart={restart} />
          ) : (
            <StepView ctx={ctx} />
          )}
        </main>
      </div>
    </div>
  );
}

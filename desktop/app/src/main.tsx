import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { VipeApiClient } from './api/contract';
import { HttpApiClient } from './api/http';
import { MockApiClient } from './api/mock';
import { createDemoBridge, type DemoScenario } from './bridge/demo';
import { createTauriBridge, isDemoMode, isTauri } from './bridge/tauri';
import type { Bridge, StationSettings } from './bridge/types';
import { Panel } from './panel/Panel';
import { Setup } from './setup/Setup';
import { APP_VERSION } from './setup/steps/Welcome';
import { startSync } from './sync';
import { Titlebar } from './Titlebar';
import './styles/app.css';

// Routes (hash): #/titlebar (strip above the hosted VIPE web), #/estacion
// (panel or first-run setup). Outside Tauri, ?demo=<scenario>&theme=dark.
const params = new URLSearchParams(location.search);
const route = location.hash.replace(/^#\/?/, '').split('/');
const theme = params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';

async function boot(): Promise<{ bridge: Bridge; api: VipeApiClient; demo: boolean }> {
  if (isTauri() && !(await isDemoMode())) {
    const bridge = createTauriBridge();
    let token: string | null = null;
    const initial = await bridge.loadSettings();
    token = initial.deviceToken;
    const api = new HttpApiClient({ baseUrl: initial.webUrl, token: () => token });
    const save = bridge.saveSettings;
    bridge.saveSettings = async (s) => {
      token = s.deviceToken;
      await save(s);
    };
    return { bridge, api, demo: false };
  }
  const scenario = (params.get('demo') ?? 'fresh') as DemoScenario;
  const bridge = isTauri() ? createTauriBridge() : createDemoBridge({ scenario, storage: params.has('persist') ? localStorage : null });
  return { bridge, api: new MockApiClient(), demo: true };
}

function Station({ bridge, api }: { bridge: Bridge; api: VipeApiClient }) {
  const [settings, setSettings] = useState<StationSettings | null>(null);
  const [mode, setMode] = useState<'setup' | 'panel'>('panel');
  useEffect(() => {
    void bridge.loadSettings().then((s) => {
      setSettings(s);
      setMode(s.setup.completed || s.setup.deferred ? 'panel' : 'setup');
    });
  }, [bridge]);
  if (!settings) return null;
  if (mode === 'setup')
    return (
      <Setup
        api={api}
        bridge={bridge}
        initial={settings}
        onDone={() => void bridge.loadSettings().then((s) => (setSettings(s), setMode('panel'), bridge.showVipe()))}
        onDefer={() => void bridge.loadSettings().then((s) => (setSettings(s), setMode('panel'), bridge.showVipe()))}
      />
    );
  const addPrinter = async () => {
    const next = { ...settings, setup: { ...settings.setup, step: 'discover' as const, printerIndex: 0, completed: false, deferred: false, prints: true } };
    await bridge.saveSettings(next);
    setSettings(next);
    setMode('setup');
  };
  return <Panel api={api} bridge={bridge} initial={settings} initialPage={route[1] ?? params.get('vista') ?? undefined} onAddPrinter={() => void addPrinter()} />;
}

function Root({ bridge, api, demo }: { bridge: Bridge; api: VipeApiClient; demo: boolean }) {
  useEffect(() => {
    // The title bar lives as long as the VIPE window, so it runs the sync loop.
    if (route[0] !== 'titlebar' || demo) return;
    return startSync(api, bridge, () => bridge.loadSettings(), APP_VERSION);
  }, [api, bridge, demo]);
  if (route[0] === 'titlebar') return <Titlebar bridge={bridge} load={() => bridge.loadSettings()} />;
  return <Station bridge={bridge} api={api} />;
}

void boot().then((ctx) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root {...ctx} />
    </StrictMode>,
  ),
);

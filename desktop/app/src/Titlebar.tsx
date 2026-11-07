import { ChevronRight, Copy, Minus, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Bridge, StationSettings, StationStatus } from './bridge/types';
import { statusPill, TONE_CLASS, trayMenu } from './panel/model';

async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  // Closing hides VIPE to the tray (src-tauri keeps printing in the background).
  await w[action]();
}

/** Title bar of the VIPE window: restaurant, printing pill (opens the panel), window buttons. */
export function Titlebar({ bridge, load }: { bridge: Bridge; load: () => Promise<StationSettings> }) {
  const [settings, setSettings] = useState<StationSettings | null>(null);
  const [status, setStatus] = useState<StationStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [s, st] = await Promise.all([load(), bridge.status()]);
      if (!alive) return;
      setSettings(s);
      setStatus(st);
      const menu = trayMenu(s, st);
      await bridge.updateTray(menu.items, menu.tooltip);
    };
    void tick();
    const t = setInterval(() => void tick(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bridge, load]);

  const pill = settings && status ? statusPill(settings, status) : null;
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="logo" aria-hidden>V</span>
      <span className="t" data-tauri-drag-region>
        <b>VIPE</b>&nbsp;— {settings?.restaurant?.name ?? 'Sin vincular'}
      </span>
      {pill && (
        <button type="button" className={`ind ${TONE_CLASS[pill.tone]}`} onClick={() => void bridge.openPanel()}>
          {pill.tone === 'muted' ? <Printer aria-hidden /> : <span className="dot" />}
          {pill.label}
          <ChevronRight aria-hidden />
        </button>
      )}
      <span className="wctl">
        <button type="button" aria-label="Minimizar" onClick={() => void windowAction('minimize')}><Minus /></button>
        <button type="button" aria-label="Maximizar" onClick={() => void windowAction('toggleMaximize')}><Copy /></button>
        <button type="button" aria-label="Cerrar" onClick={() => void windowAction('close')}><X /></button>
      </span>
    </header>
  );
}

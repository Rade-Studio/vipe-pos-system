// "IP o nombre del equipo" + "Puerto" (L3), used by "Escribir IP a mano" in the
// wizard and the panel, and by the panel's edit card.
import { useId, useState } from 'react';
import { DEFAULT_PORT, checkNetworkInput, manualNetworkPrinter } from '../../bridge/printer-address';
import type { DiscoveredPrinter } from '../../bridge/types';

export interface NetworkDraft {
  host: string;
  port: string;
  hostError?: string;
  portError?: string;
}

export function NetworkFields({ draft, onChange }: { draft: NetworkDraft; onChange: (d: NetworkDraft) => void }) {
  const id = useId();
  return (
    <div className="ipf">
      <div className="field">
        <label htmlFor={`${id}-h`}>IP o nombre del equipo</label>
        <input id={`${id}-h`} className="input mono" value={draft.host} placeholder="192.168.1.52" spellCheck={false}
          aria-invalid={Boolean(draft.hostError)} aria-describedby={draft.hostError ? `${id}-he` : undefined}
          onChange={(e) => onChange({ ...draft, host: e.target.value, hostError: undefined })} />
        {draft.hostError && <small id={`${id}-he`} className="ferr">{draft.hostError}</small>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-p`}>Puerto</label>
        <input id={`${id}-p`} className="input mono" value={draft.port} inputMode="numeric"
          aria-invalid={Boolean(draft.portError)} aria-describedby={draft.portError ? `${id}-pe` : undefined}
          onChange={(e) => onChange({ ...draft, port: e.target.value, portError: undefined })} />
        {draft.portError && <small id={`${id}-pe`} className="ferr">{draft.portError}</small>}
      </div>
    </div>
  );
}

/** Validates the draft; returns the checked host and port or the draft with its errors. */
export function checkDraft(draft: NetworkDraft) {
  const r = checkNetworkInput(draft.host, draft.port);
  return r.ok ? { ok: true as const, host: r.host, port: r.port } : { ok: false as const, draft: { ...draft, ...r } };
}

/** The form revealed by "Escribir IP a mano"; `onAdd` gets a ready network printer. */
export function ManualIpForm({ onAdd, onClose }: { onAdd: (p: DiscoveredPrinter) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<NetworkDraft>({ host: '', port: String(DEFAULT_PORT) });
  const use = () => {
    const r = checkDraft(draft);
    if (!r.ok) return setDraft(r.draft);
    onAdd(manualNetworkPrinter(r.host, r.port));
  };
  return (
    <div className="card ipform" role="group" aria-label="Impresora de red por IP">
      <NetworkFields draft={draft} onChange={setDraft} />
      <div className="ipacts">
        <button type="button" className="btn primary" onClick={use}>Usar esta IP</button>
        <button type="button" className="btn ghost" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}

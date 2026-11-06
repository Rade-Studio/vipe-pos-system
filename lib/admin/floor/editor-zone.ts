/**
 * "Editar plano" on the overview opens the editor on the zone the mini map
 * shows (T26). The admin sections share no URL state, so the request is a
 * one-shot hand-off read when the editor mounts.
 */

let requested: string | null = null

export function requestEditorZone(zoneId: string | null | undefined): void {
  requested = zoneId ?? null
}

export function takeEditorZone(): string | null {
  const zoneId = requested
  requested = null
  return zoneId
}

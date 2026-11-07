"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, MonitorSmartphone, PowerOff, Split } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { CONFIG_QUERY_KEY, fetchConfig, saveConfig, type BusinessConfig } from "@/lib/api/config"
import {
  createDesktopPairingCode,
  DESKTOP_DEVICES_QUERY_KEY,
  listDesktopDevices,
  renameDesktopDevice,
  revokeDesktopDevice,
  type DesktopDeviceDto,
} from "@/lib/api/desktop"
import { listStations, STATIONS_QUERY_KEY } from "@/lib/api/stations"
import { newDevice, visibleDevices } from "@/lib/admin/print-station"
import { SettingsPage } from "./SettingsPage"
import { RenameDeviceDialog, RevokeDeviceDialog } from "./print-station/DeviceDialogs"
import { DeviceList } from "./print-station/DeviceList"
import { PairingCard, type PairingState } from "./print-station/PairingCard"
import { UpdateChannel, type UpdateChannelValue } from "./print-station/UpdateChannel"

const DESCRIPTION =
  "Los computadores con la app VIPE imprimen comandas y facturas, y abren el cajón. Qué imprime cada impresora se decide en Estaciones y rutas."

/**
 * Ajustes → Estación de impresión (F5a web, S4,
 * design/estacion-impresion-web/01-pagina-secciones.html, L34): pair a
 * computer with a 6-digit code, the paired computers with their printers,
 * stations and queue (rename, revoke), and the update channel. Revoked
 * computers are hidden. The legacy pos/ tokens stay under Impresoras.
 */
export function PrintStationPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [pairing, setPairing] = useState<PairingState>({ kind: "idle" })
  const [toRename, setToRename] = useState<DesktopDeviceDto | null>(null)
  const [toRevoke, setToRevoke] = useState<DesktopDeviceDto | null>(null)
  const known = useRef<Set<string>>(new Set())
  const [now, setNow] = useState(() => Date.now())

  const devicesQuery = useQuery({
    queryKey: DESKTOP_DEVICES_QUERY_KEY,
    queryFn: listDesktopDevices,
    refetchInterval: pairing.kind === "showing" ? 3000 : 30_000,
  })
  const stationsQuery = useQuery({ queryKey: STATIONS_QUERY_KEY, queryFn: listStations })
  const configQuery = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig })
  const devices = visibleDevices(devicesQuery.data ?? [])
  const fail = (err: unknown) =>
    toast({ title: "Error", description: err instanceof Error ? err.message : "Inténtalo de nuevo", variant: "destructive" })
  const refresh = () => queryClient.invalidateQueries({ queryKey: DESKTOP_DEVICES_QUERY_KEY })

  // "Sin señal hace X" follows the clock between polls.
  useEffect(() => setNow(Date.now()), [devicesQuery.dataUpdatedAt])

  useEffect(() => {
    if (pairing.kind !== "showing" || !devicesQuery.data) return
    const found = newDevice(devicesQuery.data, known.current)
    if (found) setPairing({ kind: "connected", device: found })
  }, [devicesQuery.data, pairing.kind])

  const generate = useMutation({
    mutationFn: createDesktopPairingCode,
    onSuccess: (code) => {
      known.current = new Set((devicesQuery.data ?? []).map((device) => device.id))
      setPairing({ kind: "showing", code })
    },
    onError: fail,
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameDesktopDevice(id, name),
    onSuccess: () => {
      setToRename(null)
      refresh()
      toast({ title: "Nombre guardado" })
    },
    onError: fail,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeDesktopDevice(id),
    onSuccess: () => {
      refresh()
      toast({ title: "Computador desvinculado", description: "Ya no recibe comandas ni facturas." })
    },
    onError: fail,
    onSettled: () => setToRevoke(null),
  })
  const channel = useMutation({
    mutationFn: (desktopUpdateChannel: UpdateChannelValue) => saveConfig({ desktopUpdateChannel }),
    onSuccess: (saved) => {
      queryClient.setQueryData<BusinessConfig>(CONFIG_QUERY_KEY, (old: BusinessConfig | undefined) => ({ ...(old ?? {}), ...saved }) as BusinessConfig)
      toast({ title: "Configuración guardada", description: saved.desktopUpdateChannel === "pilot" ? "Canal Piloto." : "Canal Estable." })
    },
    onError: fail,
  })

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast({ title: "Código copiado" })
    } catch {
      toast({ title: "Error", description: "No se pudo copiar el código", variant: "destructive" })
    }
  }

  const printingOff = configQuery.data?.printingEnabled === false
  const loading = devicesQuery.isLoading
  const empty = !loading && !devicesQuery.isError && devices.length === 0
  const idle = pairing.kind === "idle"

  return (
    <SettingsPage title="Estación de impresión" description={DESCRIPTION}>
      {printingOff && (
        <section aria-labelledby="off-h" className="grid gap-3 rounded-card border border-line bg-surface p-[18px]">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-status-warning-bg text-status-warning-fg">
              <PowerOff className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <h2 id="off-h" className="text-base font-semibold">La impresión está apagada</h2>
              <p className="mt-1 text-muted-fg">
                En Estaciones y rutas está apagado <b>“Este restaurante usa impresoras térmicas”</b>. Los computadores siguen conectados, pero no reciben comandas
                ni facturas. Las órdenes se ven en la pantalla de cocina.
              </p>
            </span>
          </div>
          <div>
            <Button asChild className="min-h-11 rounded-full">
              <a href="#settings/stations">
                <Split className="mr-2 h-4 w-4" aria-hidden />
                Ir a Estaciones y rutas
              </a>
            </Button>
          </div>
        </section>
      )}
      {!printingOff && (!empty || !idle) && (
        <PairingCard
          state={pairing}
          busy={generate.isPending}
          onGenerate={() => generate.mutate()}
          onCopy={copy}
          onExpire={() => setPairing((p) => (p.kind === "showing" ? { kind: "expired", code: p.code } : p))}
          onClose={() => setPairing({ kind: "idle" })}
        />
      )}
      {loading ? (
        <Skeleton className="h-40" />
      ) : devicesQuery.isError ? (
        <p className="text-sm text-destructive">No se pudieron cargar los computadores.</p>
      ) : empty ? (
        idle && (
          <section aria-labelledby="empty-h" className="rounded-card border border-line bg-surface px-5 py-9 text-center">
            <span className="mb-3 inline-grid h-16 w-16 place-items-center rounded-[20px] bg-brand-tint text-brand-strong">
              <MonitorSmartphone className="h-[30px] w-[30px]" aria-hidden />
            </span>
            <h2 id="empty-h" className="mb-1.5 text-lg font-semibold">Aún no hay computadores conectados</h2>
            <p className="mx-auto mb-4 max-w-[460px] text-muted-fg">
              Instala la app VIPE en el computador donde están conectadas las impresoras (por USB, red o Bluetooth) y conéctalo con un código.
            </p>
            {!printingOff && (
              <Button className="min-h-11 rounded-full" disabled={generate.isPending} onClick={() => generate.mutate()}>
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                Generar código
              </Button>
            )}
          </section>
        )
      ) : (
        <DeviceList devices={devices} stations={stationsQuery.data ?? []} now={now} onRename={setToRename} onRevoke={setToRevoke} />
      )}
      {!empty && !loading && (
        <UpdateChannel
          businessName={configQuery.data?.businessName ?? ""}
          value={configQuery.data?.desktopUpdateChannel}
          disabled={!configQuery.data || channel.isPending}
          onChange={(value) => channel.mutate(value)}
        />
      )}
      <RenameDeviceDialog device={toRename} busy={rename.isPending} onClose={() => setToRename(null)} onSave={(name) => toRename && rename.mutate({ id: toRename.id, name })} />
      <RevokeDeviceDialog device={toRevoke} busy={revoke.isPending} onClose={() => setToRevoke(null)} onRevoke={() => toRevoke && revoke.mutate(toRevoke.id)} />
    </SettingsPage>
  )
}

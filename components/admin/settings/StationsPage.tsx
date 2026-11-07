"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Plus, Split } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { CONFIG_QUERY_KEY, fetchConfig, saveConfig, type BusinessConfig } from "@/lib/api/config"
import {
  createStarterStations,
  createStation,
  deleteStation,
  fetchStationRoutes,
  listStations,
  setCategoryStation,
  setDishStation,
  STATION_ROUTES_QUERY_KEY,
  STATIONS_QUERY_KEY,
  updateStation,
  type StationDto,
} from "@/lib/api/stations"
import { defaultStation, dishCountByStation, joinNames, prepStations, splitPreview, unroutedGroups } from "@/lib/admin/stations"
import { SettingsPage } from "./SettingsPage"
import { CategoryRoutes, categorySelectId } from "./stations/CategoryRoutes"
import { SplitPreviewCard } from "./stations/SplitPreviewCard"
import { DeleteStationDialog, StationFormDialog } from "./stations/StationDialogs"
import { StationStrip } from "./stations/StationStrip"

const DESCRIPTION =
  "Cada plato sale en la comanda de su estación. Asigna una estación a cada categoría y cambia solo los platos que se preparan en otro lado."

/**
 * Ajustes → Estaciones y rutas (F6, design/admin-stations/02-tabla-por-categoria.html,
 * L10, L11): the stations, the route of every category with its dish
 * exceptions, the dishes that go to the default station only because nothing
 * routes them, a preview of how a comanda splits, and whether the restaurant
 * uses thermal printers at all (S2).
 */
export function StationsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<StationDto | "new" | null>(null)
  const [toDelete, setToDelete] = useState<StationDto | null>(null)
  const stationsQuery = useQuery({ queryKey: STATIONS_QUERY_KEY, queryFn: listStations })
  const routesQuery = useQuery({ queryKey: STATION_ROUTES_QUERY_KEY, queryFn: fetchStationRoutes })
  const configQuery = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig })

  const stations = stationsQuery.data ?? []
  const routes = routesQuery.data
  const prep = prepStations(stations)
  const fallback = defaultStation(stations)
  const counts = dishCountByStation(routes)
  const refresh = () => queryClient.invalidateQueries({ queryKey: STATIONS_QUERY_KEY })
  const fail = (err: unknown) =>
    toast({ title: "Error", description: err instanceof Error ? err.message : "Inténtalo de nuevo", variant: "destructive" })

  const starter = useMutation({ mutationFn: createStarterStations, onSuccess: refresh, onError: fail })
  const route = useMutation({
    mutationFn: (change: { kind: "category" | "dish"; id: string; stationId: string | null }) =>
      change.kind === "category" ? setCategoryStation(change.id, change.stationId) : setDishStation(change.id, change.stationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATION_ROUTES_QUERY_KEY }),
    onError: fail,
  })
  const printing = useMutation({
    mutationFn: (printingEnabled: boolean) => saveConfig({ printingEnabled }),
    onSuccess: (saved) => {
      queryClient.setQueryData<BusinessConfig>(CONFIG_QUERY_KEY, (old: BusinessConfig | undefined) => ({ ...(old ?? {}), ...saved }) as BusinessConfig)
      toast({ title: saved.printingEnabled ? "Impresión activada" : "Impresión desactivada" })
    },
    onError: fail,
  })

  const saveStation = (input: { name: string; color: StationDto["color"] }) =>
    (form && form !== "new" ? updateStation(form.id, input) : createStation(input)).then(refresh)
  const removeStation = (station: StationDto, moveTo: string | null) => deleteStation(station.id, moveTo).then(refresh)

  const loading = stationsQuery.isLoading || routesQuery.isLoading
  const empty = !loading && !stationsQuery.isError && stations.length === 0
  const deleteCategories = toDelete ? (routes?.categories ?? []).filter((c) => c.stationId === toDelete.id).map((c) => c.name) : []

  return (
    <SettingsPage
      title="Estaciones y rutas"
      description={DESCRIPTION}
      actions={
        !empty && !loading ? (
          <Button className="min-h-11 rounded-full" onClick={() => setForm("new")}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Nueva estación
          </Button>
        ) : null
      }
    >
      <section aria-labelledby="printing-h" className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="printing-h" className="font-semibold">
            Este restaurante usa impresoras térmicas
          </h2>
          <p className="mt-1 text-sm text-muted-fg">
            {configQuery.data?.printingEnabled === false
              ? "Apagado: no se ofrece imprimir; la cocina usa su pantalla y la factura se comparte digital."
              : "Las comandas y facturas se envían a la Estación VIPE; sin impresora, la estación las ve en su pantalla."}
          </p>
        </div>
        <Switch
          aria-labelledby="printing-h"
          checked={configQuery.data?.printingEnabled ?? true}
          disabled={!configQuery.data || printing.isPending}
          onCheckedChange={(checked) => printing.mutate(checked)}
          className="flex-none"
        />
      </section>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : stationsQuery.isError || routesQuery.isError ? (
        <p className="text-sm text-destructive">No se pudieron cargar las estaciones.</p>
      ) : empty ? (
        <section aria-labelledby="stations-empty-h" className="rounded-card border border-line bg-surface px-6 py-12 text-center">
          <span className="mb-3 inline-grid h-16 w-16 place-items-center rounded-[20px] bg-brand-tint text-brand-strong">
            <Split className="h-[30px] w-[30px]" aria-hidden />
          </span>
          <h2 id="stations-empty-h" className="mb-1.5 text-xl font-semibold">
            Todavía no hay estaciones
          </h2>
          <p className="mx-auto mb-4 max-w-[520px] text-muted-fg">
            Mientras tanto, todas las comandas van completas a la pantalla de cocina. Con estaciones, la barra recibe solo las bebidas y la
            cocina solo los platos.
          </p>
          <div className="mb-[18px] flex flex-wrap justify-center gap-2 text-[12.5px] font-semibold">
            <span className="rounded-full border border-status-kitchen-line bg-status-kitchen-bg px-2.5 py-1 text-status-kitchen-fg">Cocina</span>
            <span className="rounded-full border border-status-served-line bg-status-served-bg px-2.5 py-1 text-status-served-fg">Barra</span>
            <span className="rounded-full border border-status-occupied-line bg-status-occupied-bg px-2.5 py-1 text-status-occupied-fg">
              Caja · facturas y precuentas
            </span>
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button className="min-h-11 rounded-full" disabled={starter.isPending} onClick={() => starter.mutate()}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Crear Cocina, Barra y Caja
            </Button>
            <Button variant="outline" className="min-h-11 rounded-full" onClick={() => setForm("new")}>
              Crear otra estación
            </Button>
          </div>
        </section>
      ) : (
        <>
          {unroutedGroups(routes).map((group) => (
            <div
              key={group.categoryId ?? "none"}
              role="status"
              className="flex flex-wrap items-center gap-3 rounded-card border border-status-warning-line bg-status-warning-bg px-4 py-3 text-status-warning-fg md:flex-nowrap"
            >
              <AlertTriangle className="h-[18px] w-[18px] flex-none" aria-hidden />
              <span className="min-w-0 flex-1">
                <b className="font-bold">{group.categoryId ? `${group.categoryName} no tiene estación.` : "Platos sin categoría."}</b>{" "}
                {group.dishes.length === 1 ? `Su plato (${group.dishes[0]}) sale` : `Sus ${group.dishes.length} platos (${joinNames(group.dishes)}) salen`} en la
                comanda de {fallback?.name ?? "Cocina"}
                {group.categoryId ? " hasta que la asignes." : "."}
              </span>
              {group.categoryId && (
                <Button
                  variant="outline"
                  className="min-h-11 w-full rounded-full bg-card text-fg md:w-auto"
                  onClick={() => document.getElementById(categorySelectId(group.categoryId!))?.focus()}
                >
                  Asignar estación
                </Button>
              )}
            </div>
          ))}
          <StationStrip stations={stations} dishCounts={counts} onEdit={setForm} onDelete={setToDelete} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            {routes && (
              <CategoryRoutes
                routes={routes}
                prep={prep}
                fallbackName={fallback?.name ?? "Cocina"}
                busy={route.isPending}
                onCategory={(id, stationId) => route.mutate({ kind: "category", id, stationId })}
                onDish={(dish, stationId) => route.mutate({ kind: "dish", id: dish.id, stationId })}
              />
            )}
            <div className="lg:sticky lg:top-4">
              <SplitPreviewCard preview={splitPreview(routes, stations)} />
            </div>
          </div>
        </>
      )}

      <StationFormDialog target={form} onClose={() => setForm(null)} onSave={saveStation} />
      <DeleteStationDialog
        station={toDelete}
        targets={prep.filter((station) => station.id !== toDelete?.id)}
        categories={deleteCategories}
        dishCount={toDelete ? (counts.get(toDelete.id) ?? 0) : 0}
        onClose={() => setToDelete(null)}
        onDelete={removeStation}
      />
    </SettingsPage>
  )
}

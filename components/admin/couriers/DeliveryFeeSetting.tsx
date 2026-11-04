"use client"

/**
 * Suggested delivery fee: `deliveryDefaultFee` (whole pesos, server default 0)
 * of `GET /config`. The new-delivery dialog reads the same query
 * (`CONFIG_QUERY_KEY`), so writing the `PUT /config` answer into that cache
 * after a save is what refreshes the dialog. Config writes are admin-only.
 */

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { CONFIG_QUERY_KEY, fetchConfig, saveConfig } from "@/lib/api/config"
import { parseDefaultFeeInput } from "@/lib/delivery/courier-admin"
import { createSingleFlight, type SingleFlight } from "@/lib/payments/single-flight"
import { toast } from "@/utils/toast"
import { log } from "@/lib/log"


export function DeliveryFeeSetting() {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({ queryKey: CONFIG_QUERY_KEY, queryFn: fetchConfig })
  const stored = config?.deliveryDefaultFee

  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const gate: SingleFlight = useMemo(() => createSingleFlight(), [])

  useEffect(() => {
    setValue(stored === undefined ? "" : String(stored))
  }, [stored])

  const handleSave = async () => {
    const parsed = parseDefaultFeeInput(value)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    const run = gate.run(async () => {
      setSaving(true)
      try {
        const saved = await saveConfig({ deliveryDefaultFee: parsed.value })
        toast.success("Valor sugerido del domicilio guardado")
        queryClient.setQueryData(CONFIG_QUERY_KEY, saved)
      } catch (err) {
        log.error("Error al guardar el valor sugerido del domicilio:", { error: String(err) })
        toast.error("No se pudo guardar el valor sugerido del domicilio")
      } finally {
        setSaving(false)
      }
    })
    if (run) await run
  }

  return (
    <section className="rounded-lg border bg-card text-card-foreground">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="space-y-1 md:max-w-[50%]">
          <h2 className="text-base font-semibold">Valor sugerido del domicilio</h2>
          <p className="text-sm text-muted-foreground">
            Se propone al crear un domicilio; el operador puede cambiarlo en cada pedido.
          </p>
        </div>
        {isLoading ? (
          <Skeleton className="h-10 w-full md:w-64" />
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="delivery-default-fee" className="sr-only">
                Valor en pesos
              </Label>
              <Input
                id="delivery-default-fee"
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Ej. 5000"
                className="w-full md:w-40"
                disabled={saving}
              />
            </div>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        )}
      </div>
      {error && <p className="px-4 pb-4 text-sm text-destructive sm:px-6">{error}</p>}
    </section>
  )
}

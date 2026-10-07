"use client"

/**
 * Suggested delivery fee, stored in business_config under
 * `delivery_default_fee` (whole pesos). The new-delivery dialog reads it
 * on every open, so nothing else needs invalidating. business_config
 * writes are admin-only (RLS).
 *
 * `getConfigValue` returns null both for a missing key and for a failed
 * read, so the field starts empty instead of showing a value that might
 * not be the stored one.
 */

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { businessConfigService } from "@/lib/supabase/business-config-service"
import { DEFAULT_FEE_CONFIG_KEY, parseDefaultFeeInput } from "@/lib/delivery/courier-admin"
import { createSingleFlight, type SingleFlight } from "@/lib/payments/single-flight"
import { toast } from "@/utils/toast"
import { log } from "@/lib/log"

const FEE_QUERY_KEY = ["businessConfig", DEFAULT_FEE_CONFIG_KEY] as const

export function DeliveryFeeSetting() {
  const queryClient = useQueryClient()
  const { data: stored, isLoading } = useQuery<string | null>({
    queryKey: FEE_QUERY_KEY,
    queryFn: () => businessConfigService.getConfigValue(DEFAULT_FEE_CONFIG_KEY),
  })

  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const gate: SingleFlight = useMemo(() => createSingleFlight(), [])

  useEffect(() => {
    setValue(stored ?? "")
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
        await businessConfigService.saveConfigValue(DEFAULT_FEE_CONFIG_KEY, parsed.value)
        toast.success("Valor sugerido del domicilio guardado")
        await queryClient.invalidateQueries({ queryKey: FEE_QUERY_KEY })
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
    <Card>
      <CardHeader>
        <CardTitle>Valor sugerido del domicilio</CardTitle>
        <CardDescription>
          Se propone al crear un domicilio; el operador puede cambiarlo en cada pedido.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10 w-64" />
        ) : (
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="delivery-default-fee">Valor en pesos</Label>
              <Input
                id="delivery-default-fee"
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Ej. 5000"
                className="w-48"
                disabled={saving}
              />
            </div>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

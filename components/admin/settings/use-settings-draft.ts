"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useToast } from "@/hooks/use-toast"
import { useConfigStore } from "@/store/use-config-store"
import { changedSettingKeys, isDraftDirty, pickSettings, type SettingsKey, type SettingsValues } from "./settings-draft"

type Draft<K extends SettingsKey> = Pick<SettingsValues, K>

function applyToStore(values: Partial<SettingsValues>) {
  const store = useConfigStore.getState()
  if (values.tipPercentage !== undefined) store.setTipPercentage(values.tipPercentage)
  if (values.taxPercentage !== undefined) store.setTaxPercentage(values.taxPercentage)
  if (values.priceSuggestion !== undefined) store.setPriceSuggestion(values.priceSuggestion)
  if (values.inventoryControlEnabled !== undefined) store.setInventoryControlEnabled(values.inventoryControlEnabled)
  if (
    values.businessName !== undefined ||
    values.businessAddress !== undefined ||
    values.businessPhone !== undefined ||
    values.businessNIT !== undefined
  ) {
    store.setBusinessInfo({
      name: values.businessName,
      address: values.businessAddress,
      phone: values.businessPhone,
      nit: values.businessNIT,
    })
  }
}

/**
 * A local, editable copy of some `useConfigStore` keys. `save` writes only the
 * changed keys to the store and persists with `saveConfigToDB`; `discard`
 * restores the saved values. The draft follows the store while it is clean.
 */
export function useSettingsDraft<K extends SettingsKey>(keys: readonly K[]) {
  const { toast } = useToast()
  const isLoading = useConfigStore((s) => s.isLoading)
  const saved = useConfigStore(useShallow((s) => pickSettings(s, keys))) as Draft<K>
  const [draft, setDraft] = useState<Draft<K>>(saved)
  const [saving, setSaving] = useState(false)
  // Set while a failed save rolls the store back, so the rollback does not
  // overwrite the draft the user still has on screen.
  const keepDraftOnNextSync = useRef(false)

  const dirty = useMemo(() => isDraftDirty(saved, draft), [saved, draft])

  // A reload from the DB replaces the draft (same as the old panel did).
  useEffect(() => {
    if (keepDraftOnNextSync.current) {
      keepDraftOnNextSync.current = false
      return
    }
    setDraft(saved)
  }, [saved])

  useEffect(() => {
    void useConfigStore.getState().loadConfigFromDB()
  }, [])

  const update = useCallback(<P extends K>(key: P, value: Draft<K>[P]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const discard = useCallback(() => setDraft(saved), [saved])

  const save = useCallback(async () => {
    const changed: Partial<SettingsValues> = {}
    const previous: Partial<SettingsValues> = {}
    for (const key of changedSettingKeys(saved, draft)) {
      ;(changed as Record<string, unknown>)[key as string] = draft[key]
      ;(previous as Record<string, unknown>)[key as string] = saved[key]
    }
    setSaving(true)
    applyToStore(changed)
    // `saveConfigToDB` reports failures through `error`, it does not throw.
    await useConfigStore.getState().saveConfigToDB()
    setSaving(false)
    const error = useConfigStore.getState().error
    if (error) {
      // Nothing was persisted: put the store back and keep the draft dirty.
      keepDraftOnNextSync.current = true
      applyToStore(previous)
      toast({
        title: "Error",
        description: "No se pudieron guardar los cambios. Intente nuevamente.",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Configuración guardada", description: "Los cambios se han guardado correctamente." })
  }, [saved, draft, toast])

  return { draft, saved, update, dirty, save, discard, saving, isLoading }
}

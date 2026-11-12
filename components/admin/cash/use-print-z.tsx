"use client"

import { useState } from "react"
import { printSlip } from "@/components/printing/slip-format"
import { ZReportSlip, zReportTitle } from "@/components/printing/ZReportSlip"
import { useFetchZReport } from "@/hooks/admin/use-cash"
import { useToast } from "@/hooks/use-toast"
import type { CashZReport } from "@/lib/api/cash"
import { useConfigStore } from "@/store/use-config-store"

/**
 * Prints an informe Z from the browser (80 mm) with the business header of
 * settings: `print(z)` with the emitted Z, `reprint(number)` reads the stored
 * Z first. `printing` holds the number being read.
 */
export function usePrintZ() {
  const { toast } = useToast()
  const { businessName, businessNIT, businessAddress } = useConfigStore()
  const fetchZ = useFetchZReport()
  const [printing, setPrinting] = useState<number | null>(null)

  const print = (z: CashZReport) => {
    const printed = printSlip(
      <ZReportSlip business={{ name: businessName, nit: businessNIT, address: businessAddress }} z={z} printedAt={new Date()} />,
      { title: zReportTitle(z.number) },
    )
    if (!printed) toast({ title: "No se pudo imprimir", description: "El navegador bloqueó la ventana de impresión.", variant: "destructive" })
  }

  const reprint = async (number: number) => {
    setPrinting(number)
    try {
      print(await fetchZ(number))
    } catch {
      toast({ title: "Error", description: "No se pudo leer el informe Z. Intenta nuevamente.", variant: "destructive" })
    } finally {
      setPrinting(null)
    }
  }

  return { print, reprint, printing }
}

"use client"

import { useEffect, useState } from "react"

/** Below 768 px the cashier shows one step at a time (Órdenes → Detalle → Pago). */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const update = () => setPhone(window.innerWidth < 768)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return phone
}

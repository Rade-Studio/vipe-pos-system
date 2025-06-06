"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { MenuSection } from "@/components/pos/MenuSection"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfigStore } from "@/store/use-config-store"
import type { Dish, PaymentMethod } from "@/types"
import { formatCurrency } from "@/utils/helpers"

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
}

export default function PublicMenuPage() {
  const {
    businessName,
    businessPhone,
    menuPrimaryColor,
    menuSecondaryColor,
    menuLogo,
    menuSchedule,
    loadConfigFromDB,
  } = useConfigStore()

  const [mode, setMode] = useState<"view" | "delivery" | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerName, setCustomerName] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash")
  const [comments, setComments] = useState("")

  useEffect(() => {
    loadConfigFromDB()
  }, [loadConfigFromDB])

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", menuPrimaryColor)
    document.documentElement.style.setProperty("--secondary", menuSecondaryColor)
  }, [menuPrimaryColor, menuSecondaryColor])

  const addToCart = (dish: Dish) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === dish.id)
      if (existing) {
        return prev.map((i) => (i.id === dish.id ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [...prev, { id: dish.id, name: dish.name, price: dish.price, quantity: 1 }]
    })
  }

  const updateQuantity = (id: string, qty: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: qty } : i)))
  }

  const total = cart.reduce((t, i) => t + i.price * i.quantity, 0)

  const sendWhatsApp = () => {
    const items = cart.map((i) => `${i.quantity}x ${i.name}`).join("%0A")
    let message = `Hola, quiero hacer un pedido:%0A${items}%0ATotal: ${formatCurrency(total)}`
    if (comments) message += `%0AComentarios: ${comments}`
    message += `%0AForma de pago: ${paymentMethod}`
    message += `%0ANombre: ${customerName}`
    message += `%0ADirección: ${customerAddress}`
    const url = `https://wa.me/${businessPhone}?text=${encodeURIComponent(message)}`
    window.open(url, "_blank")
  }

  if (!mode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center">
        {menuLogo && (
          <Image src={menuLogo} alt="logo" width={120} height={120} className="mx-auto" />
        )}
        <h1 className="text-2xl font-bold">{businessName}</h1>
        {menuSchedule && <p className="text-sm text-muted-foreground">{menuSchedule}</p>}
        <div className="flex gap-4 mt-4">
          <Button onClick={() => setMode("view")}>Ver Carta</Button>
          <Button onClick={() => setMode("delivery")}>Domicilio</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {menuLogo && <Image src={menuLogo} alt="logo" width={40} height={40} />}
          <h1 className="font-bold">{businessName}</h1>
        </div>
        <Button variant="outline" onClick={() => setMode(null)}>Inicio</Button>
      </div>

      <MenuSection onAddToCart={mode === "delivery" ? addToCart : () => {}} />

      {mode === "delivery" && (
        <div className="space-y-4">
          <h2 className="font-semibold">Tu Pedido</h2>
          {cart.length === 0 && <p className="text-sm">El carrito está vacío</p>}
          {cart.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2">
              <span>{item.quantity}x {item.name}</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  className="w-16"
                  value={item.quantity}
                  min={1}
                  onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
                />
                <span>{formatCurrency(item.price * item.quantity)}</span>
              </div>
            </div>
          ))}
          {cart.length > 0 && <p className="font-medium">Total: {formatCurrency(total)}</p>}

          <Input placeholder="Nombre" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <Input placeholder="Dirección" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
          <Input placeholder="Comentarios" value={comments} onChange={(e) => setComments(e.target.value)} />

          <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Método de pago" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
              <SelectItem value="nequi">Nequi</SelectItem>
              <SelectItem value="bancolombia">Bancolombia</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={sendWhatsApp} disabled={cart.length === 0}>Enviar pedido por WhatsApp</Button>
        </div>
      )}
    </div>
  )
}

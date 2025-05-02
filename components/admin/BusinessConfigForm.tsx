"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { updateBusinessConfig } from "@/lib/api/business-config"

interface BusinessConfigFormProps {
  initialData: {
    business_name: string
    address: string
    phone: string
    tax_rate: number
    currency: string
    currency_symbol: string
    receipt_footer: string
    receipt_header: string
  }
}

export function BusinessConfigForm({ initialData }: BusinessConfigFormProps) {
  const [formData, setFormData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const mutation = useMutation(updateBusinessConfig, {
    onSuccess: () => {
      queryClient.invalidateQueries(["businessConfig"])
      toast({
        title: "Éxito",
        description: "Configuración del negocio actualizada correctamente.",
      })
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Hubo un error al actualizar la configuración.",
        variant: "destructive",
      })
    },
    onSettled: () => {
      setLoading(false)
    },
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value,
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    mutation.mutate(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="business_name">Nombre del Negocio</Label>
          <Input
            id="business_name"
            name="business_name"
            value={formData.business_name}
            onChange={handleChange}
            placeholder="Nombre del negocio"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Dirección</Label>
          <Input
            id="address"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Dirección del negocio"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            placeholder="Teléfono del negocio"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tax_rate">Tasa de Impuesto (%)</Label>
          <Input
            id="tax_rate"
            name="tax_rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={formData.tax_rate}
            onChange={handleChange}
            placeholder="Ej: 16.00"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Moneda</Label>
          <Input
            id="currency"
            name="currency"
            value={formData.currency}
            onChange={handleChange}
            placeholder="Ej: MXN, USD, EUR"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency_symbol">Símbolo de Moneda</Label>
          <Input
            id="currency_symbol"
            name="currency_symbol"
            value={formData.currency_symbol}
            onChange={handleChange}
            placeholder="Ej: $, €, £"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="receipt_header">Encabezado de Factura</Label>
          <Textarea
            id="receipt_header"
            name="receipt_header"
            value={formData.receipt_header}
            onChange={handleChange}
            placeholder="Texto que aparecerá en el encabezado de las facturas"
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="receipt_footer">Pie de Factura</Label>
          <Textarea
            id="receipt_footer"
            name="receipt_footer"
            value={formData.receipt_footer}
            onChange={handleChange}
            placeholder="Texto que aparecerá al pie de las facturas"
            rows={3}
          />
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-4">
        {loading ? "Guardando..." : "Guardar Configuración"}
      </Button>
    </form>
  )
}

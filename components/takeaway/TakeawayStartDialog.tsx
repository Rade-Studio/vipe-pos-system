"use client"

import { useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { checkTakeawayCustomer, type TakeawayCustomer } from "./customer"

interface TakeawayStartDialogProps {
  open: boolean
  onClose: () => void
  /** The checked customer; the caller opens the order flow with it. */
  onStart: (customer: TakeawayCustomer) => void
}

/** S8: "Para llevar" asks who the order is for before the order flow opens. */
export function TakeawayStartDialog({ open, onClose, onStart }: TakeawayStartDialogProps) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({})
  const nameRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setName("")
    setPhone("")
    setErrors({})
    onClose()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const check = checkTakeawayCustomer(name, phone)
    if (!check.ok) {
      setErrors(check.errors)
      if (check.errors.name) nameRef.current?.focus()
      return
    }
    setName("")
    setPhone("")
    setErrors({})
    onStart(check.customer)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Pedido para llevar</DialogTitle>
          <DialogDescription>El nombre sale en la comanda y en la caja.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="takeaway-name">Nombre del cliente</Label>
            <Input
              ref={nameRef}
              id="takeaway-name"
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "takeaway-name-error" : undefined}
              className="min-h-11 text-base"
            />
            {errors.name && (
              <p id="takeaway-name-error" className="text-sm text-status-danger-fg">
                {errors.name}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="takeaway-phone">
              Teléfono <span className="font-normal text-muted-fg">(opcional)</span>
            </Label>
            <Input
              id="takeaway-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? "takeaway-phone-error" : undefined}
              className="min-h-11 text-base"
            />
            {errors.phone && (
              <p id="takeaway-phone-error" className="text-sm text-status-danger-fg">
                {errors.phone}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button type="button" variant="outline" className="min-h-11" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11">
              Tomar pedido
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

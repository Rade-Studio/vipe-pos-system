"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import type { Profile } from "@/types"

interface WaiterSelectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  waiters: Profile[]
  onSelect: (waiterId: string) => void
}

export function WaiterSelectionDialog({ open, onOpenChange, waiters, onSelect }: WaiterSelectionDialogProps) {
  const [selectedWaiter, setSelectedWaiter] = useState<string>("")

  const handleSelect = () => {
    if (selectedWaiter) {
      onSelect(selectedWaiter)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Seleccionar Mesero</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <RadioGroup value={selectedWaiter} onValueChange={setSelectedWaiter}>
            {waiters.map((waiter) => (
              <div key={waiter.id} className="flex items-center space-x-2 py-2">
                <RadioGroupItem value={waiter.id} id={waiter.id} />
                <Label htmlFor={waiter.id} className="cursor-pointer">
                  {waiter.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSelect} disabled={!selectedWaiter}>
            Seleccionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

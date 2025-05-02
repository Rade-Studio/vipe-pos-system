"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/utils/helpers"
import type { CashRegister } from "@/types/cash-register"

interface RegisterSelectorProps {
  registers: CashRegister[]
  selectedRegisters: string[]
  onSelectionChange: (selectedIds: string[]) => void
}

export function RegisterSelector({ registers, selectedRegisters, onSelectionChange }: RegisterSelectorProps) {
  const [open, setOpen] = useState(false)

  const toggleRegister = (registerId: string) => {
    if (selectedRegisters.includes(registerId)) {
      onSelectionChange(selectedRegisters.filter((id) => id !== registerId))
    } else {
      onSelectionChange([...selectedRegisters, registerId])
    }
  }

  const selectAll = () => {
    onSelectionChange(registers.map((register) => register.id))
  }

  const clearSelection = () => {
    onSelectionChange([])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Cajas Registradoras</div>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={registers.length === 0}>
            Seleccionar Todas
          </Button>
          <Button variant="outline" size="sm" onClick={clearSelection} disabled={selectedRegisters.length === 0}>
            Limpiar
          </Button>
        </div>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            {selectedRegisters.length > 0
              ? `${selectedRegisters.length} ${selectedRegisters.length === 1 ? "caja seleccionada" : "cajas seleccionadas"}`
              : "Seleccionar cajas..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Buscar caja..." />
            <CommandList>
              <CommandEmpty>No se encontraron cajas.</CommandEmpty>
              <CommandGroup>
                {registers.map((register) => (
                  <CommandItem
                    key={register.id}
                    value={register.id}
                    onSelect={() => toggleRegister(register.id)}
                    className="flex items-center space-x-2"
                  >
                    <Checkbox
                      checked={selectedRegisters.includes(register.id)}
                      onCheckedChange={() => toggleRegister(register.id)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span>
                          {new Date(register.openingTimestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <Badge variant={register.status === "open" ? "default" : "secondary"}>
                          {register.status === "open" ? "Abierta" : "Cerrada"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Inicial: {formatCurrency(register.initialCash)}
                        {register.finalCash && ` • Final: ${formatCurrency(register.finalCash)}`}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedRegisters.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedRegisters.map((id) => {
            const register = registers.find((r) => r.id === id)
            if (!register) return null

            return (
              <Badge key={id} variant="outline" className="flex items-center gap-1">
                {new Date(register.openingTimestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <Button variant="ghost" size="sm" className="h-4 w-4 p-0 ml-1" onClick={() => toggleRegister(id)}>
                  <Check className="h-3 w-3" />
                </Button>
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}

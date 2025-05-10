"use client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ItemsPerPageProps {
  itemsPerPage: number
  onChange: (value: number) => void
  options?: number[]
  className?: string
}

export function ItemsPerPage({
  itemsPerPage,
  onChange,
  options = [10, 25, 50, 100],
  className = "",
}: ItemsPerPageProps) {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <span className="text-sm text-muted-foreground">Mostrar</span>
      <Select value={itemsPerPage.toString()} onValueChange={(value) => onChange(Number.parseInt(value))}>
        <SelectTrigger className="w-[70px]">
          <SelectValue placeholder={itemsPerPage.toString()} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option.toString()}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">por página</span>
    </div>
  )
}

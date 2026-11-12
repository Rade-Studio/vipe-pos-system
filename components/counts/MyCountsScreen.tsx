"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ClipboardCheck, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useMyCount, useMyCounts, useSetMyCountedQuantity, useSubmitMyCount } from "@/hooks/counts/use-counts"
import { useToast } from "@/hooks/use-toast"
import type { MyCountLine } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"

const errorMessage = (error: unknown) => (error as { message?: string })?.message ?? "Ocurrió un error."

const display = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value).replace(".", ","))

/** "4,5", "4.5" or "1.250,5"; NaN when it is not a quantity ≥ 0. */
const parse = (text: string) => {
  const s = text.trim()
  if (!s) return null
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

/**
 * The counter's screen (S5), mobile-first and for any role: the counts
 * assigned to the caller, counted blind. The API never sends the expected
 * stock, and this screen shows only what the counter typed.
 */
export function MyCountsScreen() {
  const counts = useMyCounts()
  const [openId, setOpenId] = useState<string | null>(null)
  const active = (counts.data ?? []).filter((c) => c.stage === "counting")

  if (openId) return <MyCountSheet countId={openId} onBack={() => setOpenId(null)} />

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 p-4">
      <h2 className="text-lg font-semibold">Conteos asignados</h2>
      {counts.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tienes conteos por hacer.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="flex min-h-16 w-full items-center gap-3 rounded-lg border p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b className="block">
                    Conteo #{c.number} · {c.locationName}
                  </b>
                  <span className="text-sm text-muted-foreground">
                    {c.recountLines > 0 ? `${c.recountLines} por recontar` : `${c.countedLines} de ${c.linesCount} contados`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MyCountSheet({ countId, onBack }: { countId: string; onBack: () => void }) {
  const { toast } = useToast()
  const detail = useMyCount(countId)
  const setCounted = useSetMyCountedQuantity()
  const submit = useSubmitMyCount()
  const [values, setValues] = useState<Record<string, number | null>>({})
  const [error, setError] = useState<string | null>(null)

  const count = detail.data
  useEffect(() => {
    if (count) setValues(Object.fromEntries(count.lines.map((l) => [l.id, l.countedQuantity])))
  }, [count])

  if (!count) return <p className="p-4 text-sm text-muted-foreground">Cargando…</p>

  const recounting = count.lines.some((l) => l.recount)
  const lines = recounting ? count.lines.filter((l) => l.recount) : count.lines
  const done = lines.filter((l) => values[l.id] !== null && values[l.id] !== undefined).length
  const total = lines.length

  const save = async (line: MyCountLine, value: number | null) => {
    setError(null)
    const previous = values[line.id] ?? null
    setValues((v) => ({ ...v, [line.id]: value }))
    try {
      await setCounted.mutateAsync({ countId, lineId: line.id, countedQuantity: value })
    } catch (err) {
      setValues((v) => ({ ...v, [line.id]: previous }))
      setError(errorMessage(err))
    }
  }

  const send = async () => {
    setError(null)
    try {
      await submit.mutateAsync(countId)
      toast({ title: `Conteo #${count.number} enviado a revisión` })
      onBack()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 p-4 pb-24">
      <Button variant="ghost" onClick={onBack} className="-ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" /> Mis conteos
      </Button>
      <div>
        <h2 className="text-lg font-semibold">
          Conteo #{count.number} · {count.locationName}
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <EyeOff className="h-4 w-4" aria-hidden /> Conteo a ciegas: escribe lo que hay. No cuentes lo que está en tránsito.
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-sm">
          <b className="tabular-nums">
            {done} de {total}
          </b>{" "}
          {recounting ? "por recontar" : "artículos"}
        </p>
        <Progress value={total ? (done / total) * 100 : 0} aria-label="Avance del conteo" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {lines.map((line) => (
          <CountLineCard key={line.id} line={line} value={values[line.id] ?? null} onSave={(v) => save(line, v)} />
        ))}
      </ul>
      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <Button className="mx-auto flex h-12 w-full max-w-lg text-base" disabled={done < total || submit.isPending} onClick={send}>
          Enviar a revisión
        </Button>
      </div>
    </div>
  )
}

function CountLineCard({ line, value, onSave }: { line: MyCountLine; value: number | null; onSave: (value: number | null) => void }) {
  const name = line.itemName ?? ""
  const unit = line.unit ?? ""
  const [text, setText] = useState(display(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setText(display(value)), [value])

  const commit = () => {
    const next = parse(text)
    if (Number.isNaN(next)) return setInvalid(true)
    setInvalid(false)
    if (next !== value) onSave(next)
  }

  return (
    <li className={cn("rounded-lg border p-3", value !== null && "border-primary/40")}>
      <p className="font-medium">{name}</p>
      <p className="mb-2 font-mono text-xs text-muted-foreground">
        {line.sku} · se cuenta en {unit}
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="Cantidad"
            aria-label={`Cantidad contada de ${name} en ${unit}`}
            aria-invalid={invalid || undefined}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="h-14 pr-14 text-xl tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-4 text-sm text-muted-foreground">{unit}</span>
        </div>
        <Button variant="outline" className="h-14 px-3" aria-label={`No hay (0) ${name}`} onClick={() => onSave(0)}>
          No hay (0)
        </Button>
      </div>
      {invalid && <p className="mt-1 text-xs text-destructive">Escribe un número, por ejemplo 4,5.</p>}
    </li>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import { publishMenu, type MenuPublicationDto } from "@/lib/api/catalog"
import {
  ADMIN_LIST_STALE_MS,
  catalogKeys,
  errorMessage,
  fetchMenuPublication,
  invalidateMenuReaders,
  pendingChangesLabel,
  publishedAgo,
} from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"

const changes = (n: number) => `${n} ${n === 1 ? "cambio" : "cambios"}`

/** How often "Publicado hace n min" is re-read from the clock. */
const AGO_REFRESH_MS = 30_000

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** The publication status line: when and by whom, or that waiters still see the live menu. */
function publishedLine(publication: MenuPublicationDto, now: number) {
  if (!publication.publishedAt) return "Sin publicar todavía: los meseros ven lo guardado"
  const ago = `Publicado ${publishedAgo(publication.publishedAt, now)}`
  return publication.publishedByName ? `${ago} · por ${publication.publishedByName}` : ago
}

/**
 * "Publicar a meseros" (redesign T27): the waiters' step picker serves the last
 * publication, so structure edits wait here as "n cambios sin publicar" until
 * the admin publishes them. Phone: the bar sticks to the bottom of the screen.
 */
export function PublishBar({ className }: { className?: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const now = useNow()
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const { data: publication } = useQuery<MenuPublicationDto>({
    queryKey: catalogKeys.publication,
    queryFn: fetchMenuPublication,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const pending = publication?.pendingChanges ?? 0

  const publish = async () => {
    setConfirming(false)
    setPublishing(true)
    try {
      const saved = await publishMenu()
      queryClient.setQueryData(catalogKeys.publication, saved)
      toast({ title: "Menú publicado", description: "Los meseros verán el nuevo menú al abrir su próximo pedido." })
      void invalidateMenuReaders(queryClient)
    } catch (error) {
      log.error("Error publishing the menu:", { error: String(error) })
      toast({ variant: "destructive", title: "No se publicó el menú", description: errorMessage(error) })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <section
        aria-label="Publicación del menú"
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-card px-3 py-2.5 shadow-[0_-8px_24px_-16px_rgba(0,0,0,.35)] md:shadow-none"
      >
        <div className="min-w-0 flex-1 basis-48 space-y-0.5">
          {pending > 0 && (
            <span className="inline-flex min-h-6 items-center rounded-pill border border-status-warning-line bg-status-warning-bg px-2 text-xs font-medium text-status-warning-fg">
              {pendingChangesLabel(pending)}
            </span>
          )}
          {publication && <p className="break-words text-[13px] text-muted-fg [overflow-wrap:anywhere]">{publishedLine(publication, now)}</p>}
        </div>
        <Button
          type="button"
          className="min-h-11 shrink-0 max-sm:flex-1"
          disabled={pending === 0 || publishing}
          aria-label={pending > 0 ? `Publicar ${changes(pending)} a meseros` : "Publicar a meseros, sin cambios"}
          onClick={() => setConfirming(true)}
        >
          <Send className="mr-2 h-4 w-4" aria-hidden />
          Publicar a meseros
        </Button>
      </section>
      {pending > 0 && (
        <div className="flex min-w-0 items-start gap-2.5 rounded-[14px] border border-status-warning-line bg-status-warning-bg px-3 py-2.5 text-sm leading-snug text-status-warning-fg max-md:hidden">
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <p className="min-w-0">
            <b>{pendingChangesLabel(pending)}.</b> Los meseros siguen viendo el menú anterior hasta que publiques; avísales antes,
            porque cambia su memoria de posiciones.
          </p>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar {changes(pending)} a meseros?</AlertDialogTitle>
            <AlertDialogDescription>
              Los meseros y domicilios verán el nuevo orden, colores y categorías al abrir su próximo pedido. Precios y
              disponibilidad ya están al día.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()}>Publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

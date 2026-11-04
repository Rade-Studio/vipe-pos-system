import { supabase } from "./client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import {toast} from "@/components/ui/use-toast";
import {CartItem, CommandPayload, PrintableInvoice} from "@/types";

// Printing broadcasts only. Table, order and kitchen changes moved to the API
// socket (lib/api/realtime.ts, T8b); these three functions move to the printing
// bridge in T8c.

type GenericPayload = Record<string, any>;
type PosEventCallback<T extends GenericPayload> = (payload: T) => void;

// Broadcast listener registry: channelKey -> eventName -> Set of handlers.
// Allows per-handler unsubscribe without tearing down the whole channel.
const broadcastListenerRegistry = new Map<string, Map<string, Set<Function>>>()

// Module-private. Acquires (or creates) a broadcast channel WITHOUT registering
// any listener and WITHOUT touching broadcastListenerRegistry (D8). Used by
// sendFactura/sendCommand, which only need a reference to send on, and by
// subscribeToPosEvents, which performs its own registry insert and `.on()`
// binding on top of the channel this returns.
const getBroadcastChannel = (channelKey: string): RealtimeChannel => {
  if (!realtimeService.channels[channelKey]) {
    const channel = supabase.channel(channelKey)

    channel.subscribe(() => {
      realtimeService.isConnected = true
    })

    realtimeService.channels[channelKey] = channel
  }

  return realtimeService.channels[channelKey]
}

export const realtimeService = {
  // Canales activos
  channels: {} as Record<string, RealtimeChannel>,

  // Estado de la conexión
  isConnected: false,

  subscribeToPosEvents: <T extends GenericPayload>(channelKey: string, eventName: string, callback: PosEventCallback<T>) => {

    const channel = getBroadcastChannel(channelKey)

    // Register handler in our registry so it can be removed individually.
    if (!broadcastListenerRegistry.has(channelKey)) {
      broadcastListenerRegistry.set(channelKey, new Map())
    }
    const eventMap = broadcastListenerRegistry.get(channelKey)!
    if (!eventMap.has(eventName)) {
      eventMap.set(eventName, new Set())
    }
    eventMap.get(eventName)!.add(callback)

    // Attach the broadcast listener to the channel. This can run after
    // getBroadcastChannel() above has already called channel.subscribe() for a
    // pre-existing channel (D8 confirm-at-apply). Verified against the
    // installed @supabase/realtime-js@2.116.0 source
    // (RealtimeChannel.js `on()`): the "cannot add callbacks after subscribe()"
    // guard checks `type === PRESENCE || type === POSTGRES_CHANGES` only —
    // "broadcast" is exempt, and `_on()` registers the handler directly on the
    // channel's live message dispatcher, not into the one-shot join payload
    // that postgres_changes bindings need. So binding here, after subscribe(),
    // does bind correctly for broadcast events.
    channel.on("broadcast", { event: eventName}, ({payload}) => {
      callback(payload as T)
    })

    // Return a per-handler unsubscribe — removes only this handler,
    // does NOT tear down the channel if other handlers are registered.
    return () => {
      const evMap = broadcastListenerRegistry.get(channelKey)
      if (!evMap) return
      const handlerSet = evMap.get(eventName)
      if (handlerSet) {
        handlerSet.delete(callback)
        if (handlerSet.size === 0) {
          evMap.delete(eventName)
        }
      }
      // Note: we do NOT call supabase.removeChannel here because other
      // handlers on the same channel (different event names) may still be active.
    }
  },

  // enviar factura a un canal de realtime
  sendFactura: (invoiceNumber: string, invoice: PrintableInvoice, displayItems: CartItem[]) => {
    // enviar factura por broadcast
    const channelKey = "room_bills"
    const channel = getBroadcastChannel(channelKey)
    const payload = {
      invoiceNumber,
      invoice,
      displayItems,
    }

    channel.send({
      type: "broadcast",
      event: "new_invoice",
      payload,
    }).catch((error) => {
      toast({
        title: "Error",
        description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
        variant: "destructive",
      })
    })
  },

  sendCommand: (command: CommandPayload) => {
      // enviar factura por broadcast
      const channelKey = "room_commands"
      const channel = getBroadcastChannel(channelKey)

      channel.send({
        type: "broadcast",
        event: "new_command",
        payload: {
          ...command,
        },
      }).catch((error) => {
        toast({
          title: "Error",
          description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
          variant: "destructive",
        })
      })
  },
}

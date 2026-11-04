/**
 * T8b — after the table, order and kitchen subscriptions moved to the API
 * socket (lib/api/realtime.test.ts), this module only keeps the printing
 * broadcasts until T8c. Their contract is pinned here: one channel per room,
 * reused across sends, and the payload the print listener reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({
  created: [] as string[],
  sent: [] as { channel: string; message: unknown }[],
  handlers: [] as { channel: string; event: string; handler: (message: { payload: unknown }) => void }[],
}))

vi.mock("./client", () => ({
  supabase: {
    channel: (name: string) => {
      env.created.push(name)
      const channel = {
        subscribe: () => channel,
        on: (_type: string, filter: { event: string }, handler: (message: { payload: unknown }) => void) => {
          env.handlers.push({ channel: name, event: filter.event, handler })
          return channel
        },
        send: (message: unknown) => {
          env.sent.push({ channel: name, message })
          return Promise.resolve("ok")
        },
      }
      return channel
    },
  },
}))

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }))

import { realtimeService } from "./realtime-service"

beforeEach(() => {
  env.created.length = 0
  env.sent.length = 0
  env.handlers.length = 0
  realtimeService.channels = {}
})

describe("printing broadcasts kept until T8c", () => {
  it("sends a kitchen command on room_commands and reuses the channel", () => {
    const command = { invoiceNumber: "1234", table: 4, waiter: "Ana", items: [] }
    realtimeService.sendCommand(command)
    realtimeService.sendCommand(command)

    expect(env.created).toEqual(["room_commands"])
    expect(env.sent).toEqual([
      { channel: "room_commands", message: { type: "broadcast", event: "new_command", payload: command } },
      { channel: "room_commands", message: { type: "broadcast", event: "new_command", payload: command } },
    ])
  })

  it("sends an invoice on room_bills with its display items", () => {
    realtimeService.sendFactura("F-1", { invoiceNumber: "F-1" } as never, [])

    expect(env.sent).toEqual([
      {
        channel: "room_bills",
        message: { type: "broadcast", event: "new_invoice", payload: { invoiceNumber: "F-1", invoice: { invoiceNumber: "F-1" }, displayItems: [] } },
      },
    ])
  })

  it("hands broadcast payloads to subscribeToPosEvents listeners", () => {
    const seen: unknown[] = []
    realtimeService.subscribeToPosEvents("room_pos", "ping", (payload) => seen.push(payload))

    env.handlers[0].handler({ payload: { ok: true } })

    expect(env.handlers.map(({ channel, event }) => [channel, event])).toEqual([["room_pos", "ping"]])
    expect(seen).toEqual([{ ok: true }])
  })

  it("no longer exposes the table, order or kitchen subscriptions", () => {
    expect(Object.keys(realtimeService).sort()).toEqual(
      ["channels", "isConnected", "sendCommand", "sendFactura", "subscribeToPosEvents"].sort(),
    )
  })
})

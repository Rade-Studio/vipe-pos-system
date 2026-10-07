import { describe, expect, it } from "vitest"

import { mapWaiterRowsToProfiles } from "./waiters"

/**
 * T6 (S1) — the waiters list used to be fetched twice per interaction: once by
 * `WaiterView.loadWaiters` (re-run on every `activeTable` change) and again by
 * `WaiterSelectionModal` (re-run on every open). Both now read one shared React
 * Query, so the row -> `Profile` mapping lives here, decided once.
 */

const rows = [
  { id: "w-1", full_name: "Ana Gómez", username: "ana", role: "waiter" },
  { id: "w-2", full_name: "Luis Pérez", username: "luis", role: "waiter" },
]

describe("mapWaiterRowsToProfiles (T6/S1)", () => {
  it("maps every row to the Profile shape the views render", () => {
    expect(mapWaiterRowsToProfiles(rows)).toEqual([
      { id: "w-1", name: "Ana Gómez", full_name: "Ana Gómez", username: "ana", role: "waiter", hasPassword: false },
      { id: "w-2", name: "Luis Pérez", full_name: "Luis Pérez", username: "luis", role: "waiter", hasPassword: false },
    ])
  })

  it("returns an empty list for no rows", () => {
    expect(mapWaiterRowsToProfiles([])).toEqual([])
  })

  it("skips rows without an id instead of crashing the whole list", () => {
    const withHoles = [
      { id: "w-1", full_name: "Ana Gómez", username: "ana", role: "waiter" },
      { id: "", full_name: "Sin id", username: null, role: "waiter" },
      null as unknown as (typeof rows)[number],
    ]
    expect(mapWaiterRowsToProfiles(withHoles).map((p) => p.id)).toEqual(["w-1"])
  })

  it("skips rows without a full name", () => {
    const withHoles = [{ id: "w-9", full_name: "", username: "x", role: "waiter" }]
    expect(mapWaiterRowsToProfiles(withHoles)).toEqual([])
  })

  it("keeps a null username as null", () => {
    expect(mapWaiterRowsToProfiles([{ id: "w-1", full_name: "Ana", username: null, role: "waiter" }])[0].username).toBeNull()
  })

  it("returns a new array on every call so callers can not share the reference", () => {
    expect(mapWaiterRowsToProfiles(rows)).not.toBe(mapWaiterRowsToProfiles(rows))
  })
})
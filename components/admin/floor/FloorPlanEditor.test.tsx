import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T5 (S4) — the admin floor plan editor: tables on their zone, palette adds a
 * table at a free spot, keyboard moves, inspector edits, ONE
 * `PUT /tables/layout` for every unsaved change (its 422 shown), zone sheet
 * (create, rename, delete with the API's 409) and the waiter preview.
 */

const env = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; init?: any }[],
  errors: {} as Record<string, unknown>,
  zones: null as unknown[] | null,
  tables: null as unknown[] | null,
}))

const tableDto = (id: string, number: number, extra: Record<string, unknown> = {}) => ({
  id,
  number,
  status: "available",
  waiterId: null,
  waiterName: null,
  zoneId: "z-1",
  x: 0.5,
  y: 0.5,
  w: 0.1,
  h: 0.1,
  shape: "square",
  rotation: 0,
  seats: null,
  createdAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
})

const zoneDto = (id: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  aspect: 1.6,
  sortOrder,
  labels: [],
  active: true,
  widthM: null,
  depthM: null,
  createdAt: null,
  updatedAt: null,
  ...extra,
})

const TABLES = [tableDto("t-1", 1), tableDto("t-2", 2, { x: 0.2, seats: 4 })]
const ZONES = [zoneDto("z-1", "Salón principal", 0), zoneDto("z-2", "Terraza", 1)]

vi.mock("@/lib/api/client", () => {
  const record = (method: string) => async (path: string, init?: any) => {
    env.calls.push({ method, path, init })
    const error = env.errors[`${method} ${path}`]
    if (error) throw error
    if (method === "GET" && path === "/api/tables") return { data: env.tables ?? TABLES }
    if (method === "GET" && path === "/api/zones") return { data: env.zones ?? ZONES }
    if (method === "GET" && path === "/api/staff/waiters") return { data: [{ id: "w-1", name: "Ana Gómez", username: "ana" }] }
    if (method === "PUT" && path === "/api/tables/layout") {
      return { data: TABLES.map((t) => ({ ...t, ...init.body.tables.find((row: any) => row.id === t.id) })) }
    }
    if (method === "POST" && path === "/api/tables") return { data: tableDto("t-new", init.body.number, init.body) }
    if (method === "POST" && path === "/api/zones") return { data: zoneDto("z-new", init.body.name, 2) }
    if (method === "PATCH" && path === "/api/zones/{id}") return { data: { ...ZONES[0], ...init.body } }
    if (method === "PATCH" && path === "/api/tables/{id}") return { data: { ...TABLES[0], ...init.body } }
    return { data: undefined }
  }
  return {
    api: { GET: record("GET"), POST: record("POST"), PATCH: record("PATCH"), PUT: record("PUT"), DELETE: record("DELETE") },
    onSessionRefreshed: () => () => {},
  }
})

const toastMock = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: { subscribeToTables: vi.fn(() => () => {}), subscribeToZones: vi.fn(() => () => {}) },
}))

import { ApiError } from "@/lib/api/errors"

Element.prototype.scrollIntoView = vi.fn()
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.releasePointerCapture = vi.fn()
import { FloorPlanEditor } from "./FloorPlanEditor"
import { requestEditorZone } from "@/lib/admin/floor/editor-zone"

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <FloorPlanEditor />
    </QueryClientProvider>,
  )
}

const table = (number: number) => screen.getByRole("button", { name: new RegExp(`^Mesa ${number},`) })
const calls = (method: string, path: string) => env.calls.filter((call) => call.method === method && call.path === path)

beforeEach(() => {
  env.calls.length = 0
  env.errors = {}
  env.zones = null
  env.tables = null
  toastMock.mockReset()
})

async function ready() {
  renderEditor()
  await waitFor(() => expect(table(1)).toBeInTheDocument())
}

describe("FloorPlanEditor — canvas", () => {
  it("shows the zone tabs and the zone's tables in edit mode (shape and chairs, no status)", async () => {
    await ready()
    expect(screen.getByRole("tab", { name: /Salón principal/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /Terraza/ })).toBeInTheDocument()
    expect(table(2)).toHaveAccessibleName("Mesa 2, Cuadrada, 4 sillas")
    expect(screen.queryByText("Libre")).not.toBeInTheDocument()
  })

  it("adds a table from the palette at a free spot of the zone with the next number", async () => {
    await ready()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agregar mesa Redonda" }))
    })
    const [post] = calls("POST", "/api/tables")
    expect(post.init.body).toMatchObject({ number: 3, zoneId: "z-1", shape: "round", w: 0.1, h: 0.1, rotation: 0, seats: null })
    expect(post.init.body.x).toBeCloseTo(0.0625)
    expect(post.init.body.y).toBeCloseTo(0.08)
    expect(await screen.findByRole("button", { name: /^Mesa 3,/ })).toHaveAttribute("aria-pressed", "true")
  })

  it("moves the selected table with the arrows (Shift: bigger steps) and counts the unsaved change", async () => {
    await ready()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowRight" })
    fireEvent.keyDown(table(1), { key: "ArrowRight", shiftKey: true })
    expect(table(1).style.left).toBe("62.5%")
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument()
  })
})

describe("FloorPlanEditor — save", () => {
  it("saves every changed table in ONE PUT /tables/layout and clears the bar", async () => {
    await ready()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowDown" })
    act(() => table(2).click())
    fireEvent.keyDown(table(2), { key: "ArrowLeft" })
    expect(screen.getByText("2 cambios sin guardar")).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })

    const puts = calls("PUT", "/api/tables/layout")
    expect(puts).toHaveLength(1)
    expect(puts[0].init.body.tables.map((row: any) => row.id)).toEqual(["t-1", "t-2"])
    expect(puts[0].init.body.tables[1]).toEqual({
      id: "t-2",
      zoneId: "z-1",
      x: 0.175,
      y: 0.5,
      w: 0.1,
      h: 0.1,
      shape: "square",
      rotation: 0,
      seats: 4,
    })
    await waitFor(() => expect(screen.queryByText(/sin guardar/)).not.toBeInTheDocument())
  })

  it("shows the API's 422 message and keeps the changes", async () => {
    env.errors["PUT /api/tables/layout"] = new ApiError(422, "Unprocessable Entity", "Unknown table")
    await ready()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowDown" })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown table")
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument()
  })

  it("Descartar puts the tables back", async () => {
    await ready()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowRight" })
    act(() => screen.getByRole("button", { name: "Descartar" }).click())
    expect(table(1).style.left).toBe("50%")
    expect(screen.queryByText(/sin guardar/)).not.toBeInTheDocument()
  })
})

describe("FloorPlanEditor — inspector", () => {
  it("edits shape, chairs and rotation of the selected table as unsaved changes", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    act(() => within(inspector).getByRole("radio", { name: "Redonda" }).click())
    act(() => within(inspector).getByRole("switch", { name: "Sillas" }).click())
    fireEvent.change(within(inspector).getByLabelText("Número de sillas"), { target: { value: "6" } })
    fireEvent.change(within(inspector).getByLabelText("Rotación (°)"), { target: { value: "45" } })

    expect(table(1)).toHaveAccessibleName("Mesa 1, Redonda, 6 sillas")
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    expect(calls("PUT", "/api/tables/layout")[0].init.body.tables).toEqual([
      expect.objectContaining({ id: "t-1", shape: "round", seats: 6, rotation: 45 }),
    ])
  })

  it("saves the table data (number) with PATCH /tables/:id", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    fireEvent.change(within(inspector).getByLabelText("Número"), { target: { value: "12" } })
    await act(async () => {
      fireEvent.click(within(inspector).getByRole("button", { name: "Guardar datos" }))
    })
    expect(calls("PATCH", "/api/tables/{id}")[0].init).toEqual({
      params: { path: { id: "t-1" } },
      body: { number: 12, status: "available", waiterId: null },
    })
  })

  it("asks the reservation name when Estado is Reservada and sends it with the save", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    expect(within(inspector).queryByLabelText("¿A nombre de quién?")).not.toBeInTheDocument()
    fireEvent.change(within(inspector).getByLabelText("Estado"), { target: { value: "reserved" } })
    const name = within(inspector).getByLabelText("¿A nombre de quién?")
    const save = within(inspector).getByRole("button", { name: "Guardar datos" })
    expect(save).toBeDisabled()
    fireEvent.change(name, { target: { value: "  Familia López " } })
    expect(save).toBeEnabled()
    await act(async () => {
      fireEvent.click(save)
    })
    expect(calls("PATCH", "/api/tables/{id}")[0].init).toEqual({
      params: { path: { id: "t-1" } },
      body: { number: 1, status: "reserved", waiterId: null, reservationName: "Familia López" },
    })
  })

  it("hides the reservation fields and sends none when Estado goes back to Libre", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    const status = within(inspector).getByLabelText("Estado")
    fireEvent.change(status, { target: { value: "reserved" } })
    fireEvent.change(within(inspector).getByLabelText("¿A nombre de quién?"), { target: { value: "Ana" } })
    fireEvent.change(status, { target: { value: "available" } })
    expect(within(inspector).queryByLabelText("¿A nombre de quién?")).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(inspector).getByRole("button", { name: "Guardar datos" }))
    })
    expect(calls("PATCH", "/api/tables/{id}")[0].init).toEqual({
      params: { path: { id: "t-1" } },
      body: { number: 1, status: "available", waiterId: null },
    })
  })

  it("lets a number field be emptied while typing and puts the value back on blur", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    const rotation = within(inspector).getByLabelText("Rotación (°)")
    fireEvent.change(rotation, { target: { value: "" } })
    expect(rotation).toHaveValue(null)
    fireEvent.blur(rotation)
    expect(rotation).toHaveValue(0)
    expect(screen.queryByText(/cambios? sin guardar/)).not.toBeInTheDocument()

    const number = within(inspector).getByLabelText("Número")
    fireEvent.change(number, { target: { value: "" } })
    expect(number).toHaveValue(null)
    fireEvent.change(number, { target: { value: "7" } })
    fireEvent.blur(number)
    expect(number).toHaveValue(7)
  })

  it("offers only Libre, Reservada and Ocupada as manual statuses", async () => {
    env.tables = [tableDto("t-1", 1), tableDto("t-3", 3, { x: 0.8, status: "served" })]
    await ready()
    act(() => table(1).click())
    const status = within(screen.getByRole("region", { name: "Mesa 1" })).getByLabelText("Estado")
    expect(within(status).getAllByRole("option").map((option) => option.textContent)).toEqual(["Libre", "Reservada", "Ocupada"])

    act(() => table(3).click())
    const served = within(screen.getByRole("region", { name: "Mesa 3" })).getByLabelText("Estado")
    expect(served).toHaveValue("served")
    const options = within(served).getAllByRole("option") as HTMLOptionElement[]
    expect(options.map((option) => [option.textContent, option.disabled])).toEqual([
      ["Libre", false],
      ["Reservada", false],
      ["Ocupada", false],
      ["Servida (la pone el pedido)", true],
    ])
  })

  it("puts the saved data back and shows the API's 409 when Guardar datos fails", async () => {
    const message = "La mesa tiene una orden abierta: cóbrala o cancélala antes de dejarla libre o reservada."
    env.errors["PATCH /api/tables/{id}"] = new ApiError(409, "Conflict", message)
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    fireEvent.change(within(inspector).getByLabelText("Estado"), { target: { value: "reserved" } })
    fireEvent.change(within(inspector).getByLabelText("¿A nombre de quién?"), { target: { value: "Ana" } })
    fireEvent.change(within(inspector).getByLabelText("Número"), { target: { value: "12" } })
    await act(async () => {
      fireEvent.click(within(inspector).getByRole("button", { name: "Guardar datos" }))
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: message, variant: "destructive" }))
    expect(within(inspector).getByLabelText("Estado")).toHaveValue("available")
    expect(within(inspector).getByLabelText("Número")).toHaveValue(1)
    expect(table(1)).toBeInTheDocument()
  })

  it("deletes once per confirm and closes the confirm after the API's 409", async () => {
    env.errors["DELETE /api/tables/{id}"] = new ApiError(409, "Conflict", "La mesa tiene órdenes abiertas")
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    act(() => within(inspector).getByRole("button", { name: "Eliminar mesa" }).click())
    const confirm = within(inspector).getByRole("button", { name: "Eliminar" })
    await act(async () => {
      confirm.click()
      confirm.click()
      confirm.click()
    })
    expect(calls("DELETE", "/api/tables/{id}")).toHaveLength(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No se puede eliminar", description: "La mesa tiene órdenes abiertas" }),
    )
    expect(within(inspector).queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Eliminar mesa" })).toBeInTheDocument()
    expect(table(1)).toBeInTheDocument()
  })
})

describe("FloorPlanEditor — zones sheet", () => {
  it("creates and renames zones", async () => {
    await ready()
    act(() => screen.getByRole("button", { name: "Gestionar zonas" }).click())
    const sheet = await screen.findByRole("dialog", { name: "Gestionar zonas" })

    fireEvent.change(within(sheet).getByLabelText("Nueva zona"), { target: { value: "Patio" } })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Crear zona" }))
    })
    expect(calls("POST", "/api/zones")[0].init.body).toEqual({ name: "Patio", sortOrder: 2 })

    fireEvent.change(within(sheet).getByLabelText("Nombre de Salón principal"), { target: { value: "Salón" } })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Guardar Salón principal" }))
    })
    expect(calls("PATCH", "/api/zones/{id}")[0].init).toEqual({
      params: { path: { id: "z-1" } },
      body: { name: "Salón", aspect: 1.6, labels: [], active: true },
    })
  })

  it("shows the API's 409 when a zone with tables is deleted", async () => {
    env.errors["DELETE /api/zones/{id}"] = new ApiError(409, "Conflict", "La zona tiene mesas; muévelas o elimínalas primero")
    await ready()
    act(() => screen.getByRole("button", { name: "Gestionar zonas" }).click())
    const sheet = await screen.findByRole("dialog", { name: "Gestionar zonas" })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Eliminar Salón principal" }))
    })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Confirmar eliminar Salón principal" }))
    })
    expect(within(sheet).getByRole("alert")).toHaveTextContent("La zona tiene mesas; muévelas o elimínalas primero")
  })

  it("reorders zones through sortOrder", async () => {
    await ready()
    act(() => screen.getByRole("button", { name: "Gestionar zonas" }).click())
    const sheet = await screen.findByRole("dialog", { name: "Gestionar zonas" })
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Bajar Salón principal" }))
    })
    const patches = calls("PATCH", "/api/zones/{id}").map((call) => [call.init.params.path.id, call.init.body])
    expect(patches).toEqual([
      ["z-2", { sortOrder: 0 }],
      ["z-1", { sortOrder: 1 }],
    ])
  })
})

describe("FloorPlanEditor — waiter preview", () => {
  it("renders the read-only waiter floor with statuses and hides the palette", async () => {
    await ready()
    act(() => screen.getByRole("button", { name: "Vista previa mesero" }).click())
    expect(screen.getByRole("button", { name: "Vista previa mesero" })).toHaveAttribute("aria-pressed", "true")
    expect(table(1)).toHaveAccessibleName("Mesa 1, Libre, sin sillas")
    expect(screen.queryByRole("button", { name: "Agregar mesa Redonda" })).not.toBeInTheDocument()
  })
})

describe("FloorPlanEditor — T26 real sizes", () => {
  const SIZED = [zoneDto("z-1", "Salón principal", 0, { widthM: 16, depthM: 10 }), zoneDto("z-2", "Terraza", 1)]

  it("shows sizes and positions in cm on a zone with dimensions and snaps arrows to 10 cm", async () => {
    env.zones = SIZED
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    expect(within(inspector).getByText("160 × 160 cm")).toBeInTheDocument()
    expect(within(inspector).getByLabelText("Tamaño (cm)")).toHaveValue(160)
    expect(within(inspector).getByLabelText("Posición X (cm)")).toHaveValue(800)
    expect(within(inspector).getByLabelText("Posición Y (cm)")).toHaveValue(500)
    expect(screen.getByText(/imán de 10 cm/)).toBeInTheDocument()

    fireEvent.keyDown(table(1), { key: "ArrowRight" })
    expect(within(inspector).getByLabelText("Posición X (cm)")).toHaveValue(810)
    fireEvent.change(within(inspector).getByLabelText("Tamaño (cm)"), { target: { value: "120" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    const [row] = calls("PUT", "/api/tables/layout")[0].init.body.tables
    expect(row.w).toBeCloseTo(0.075)
    expect(row.x).toBeCloseTo(0.50625)
  })

  it("keeps the % of the width without dimensions and says how to get cm", async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    expect(within(inspector).getByLabelText("Tamaño (% del ancho)")).toHaveValue(10)
    expect(within(inspector).getByText(/Indica el ancho y el fondo de la zona en Gestionar zonas/)).toBeInTheDocument()
  })

  it('saves "Ancho × fondo (m)" with the zone and derives its proportion', async () => {
    await ready()
    act(() => screen.getByRole("button", { name: "Gestionar zonas" }).click())
    const sheet = await screen.findByRole("dialog", { name: "Gestionar zonas" })
    const group = within(sheet).getAllByRole("group", { name: "Ancho × fondo (m)" })[0]
    fireEvent.change(within(group).getByLabelText("Ancho (m)"), { target: { value: "12" } })
    fireEvent.change(within(group).getByLabelText("Fondo (m)"), { target: { value: "8" } })
    expect(within(sheet).getAllByLabelText("Proporción (ancho / alto)")[0]).toBeDisabled()
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Guardar Salón principal" }))
    })
    expect(calls("PATCH", "/api/zones/{id}")[0].init.body).toEqual({ name: "Salón principal", aspect: 1.5, labels: [], active: true, widthM: 12, depthM: 8 })
  })
})

describe("FloorPlanEditor — T26 undo/redo", () => {
  it("undoes and redoes layout edits with the buttons and Ctrl/Cmd+Z", async () => {
    await ready()
    const undoButton = screen.getByRole("button", { name: /^Deshacer/ })
    const redoButton = screen.getByRole("button", { name: /^Rehacer/ })
    expect(undoButton).toBeDisabled()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowRight" })
    expect(table(1).style.left).toBe("52.5%")
    act(() => undoButton.click())
    expect(table(1).style.left).toBe("50%")
    expect(screen.queryByText(/sin guardar/)).not.toBeInTheDocument()
    act(() => redoButton.click())
    expect(table(1).style.left).toBe("52.5%")

    fireEvent.keyDown(window, { key: "z", ctrlKey: true })
    expect(table(1).style.left).toBe("50%")
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true })
    expect(table(1).style.left).toBe("52.5%")
  })

  it("starts a fresh history after saving", async () => {
    await ready()
    act(() => table(1).click())
    fireEvent.keyDown(table(1), { key: "ArrowRight" })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    expect(screen.getByRole("button", { name: /^Deshacer/ })).toBeDisabled()
  })
})

describe("FloorPlanEditor — T26 multi-select and align", () => {
  it("Shift-click selects several tables and aligns them in one undo step", async () => {
    await ready()
    act(() => table(1).click())
    fireEvent.pointerDown(table(2), { button: 0, shiftKey: true, pointerId: 1 })
    fireEvent.click(table(2))
    expect(table(1)).toHaveAttribute("aria-pressed", "true")
    expect(table(2)).toHaveAttribute("aria-pressed", "true")
    const bar = screen.getByRole("toolbar", { name: "Acciones de selección múltiple" })
    expect(bar).toHaveTextContent("2 seleccionadas")
    expect(within(bar).getByRole("button", { name: "Distribuir en horizontal" })).toBeDisabled()

    act(() => within(bar).getByRole("button", { name: "Alinear a la izquierda" }).click())
    expect(table(1).style.left).toBe("20%")
    expect(table(2).style.left).toBe("20%")
    act(() => screen.getByRole("button", { name: /^Deshacer/ }).click())
    expect(table(1).style.left).toBe("50%")
    act(() => screen.getByRole("button", { name: /^Rehacer/ }).click())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    })
    expect(calls("PUT", "/api/tables/layout")).toHaveLength(1)
    expect(calls("PUT", "/api/tables/layout")[0].init.body.tables).toEqual([expect.objectContaining({ id: "t-1", x: 0.2 })])
  })
})

describe("FloorPlanEditor — T26 inactive tables", () => {
  it('"Activa" switches the table with PATCH isActive and greys it on the plan', async () => {
    await ready()
    act(() => table(1).click())
    const inspector = screen.getByRole("region", { name: "Mesa 1" })
    await act(async () => {
      fireEvent.click(within(inspector).getByRole("switch", { name: "Activa" }))
    })
    const patch = calls("PATCH", "/api/tables/{id}")[0]
    expect(patch.init).toEqual({ params: { path: { id: "t-1" } }, body: { isActive: false } })
    expect(table(1)).toHaveAccessibleName("Mesa 1, Cuadrada, sin sillas, inactiva")
    expect(calls("PUT", "/api/tables/layout")).toHaveLength(0)
  })
})

describe("FloorPlanEditor — T26 Editar plano", () => {
  it("opens on the zone the overview asked for", async () => {
    requestEditorZone("z-2")
    renderEditor()
    await waitFor(() => expect(screen.getByRole("tab", { name: /Terraza/ })).toHaveAttribute("aria-selected", "true"))
  })
})

describe("FloorPlanEditor — T26 save bar space", () => {
  it("reserves the sticky bar's height under the plan while it is shown", async () => {
    const original = Element.prototype.getBoundingClientRect
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.getAttribute("aria-label") === "Cambios del plano" ? ({ height: 96, width: 300 } as DOMRect) : original.call(this)
    })
    try {
      await ready()
      expect(screen.getByTestId("plan-body").style.paddingBottom).toBe("")
      act(() => table(1).click())
      fireEvent.keyDown(table(1), { key: "ArrowRight" })
      await waitFor(() => expect(screen.getByTestId("plan-body").style.paddingBottom).toBe("108px"))
      act(() => screen.getByRole("button", { name: "Descartar" }).click())
      await waitFor(() => expect(screen.getByTestId("plan-body").style.paddingBottom).toBe(""))
    } finally {
      spy.mockRestore()
    }
  })
})

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useHashSection } from "@/hooks/use-hash-section"
import { ADMIN_NAV_GROUPS, sectionsInGroup } from "@/lib/admin/navigation"
import { useConfigStore } from "@/store/use-config-store"
import { AdminShell } from "./AdminShell"

// cmdk measures and scrolls its list; jsdom implements neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

const profile = { id: "p-1", name: "Ana Admin", role: "admin" as const }

function Harness({ onChangeProfile = () => {} }: { onChangeProfile?: () => void }) {
  const [section, navigate] = useHashSection()
  return (
    <AdminShell profile={profile} authRole="admin" onChangeProfile={onChangeProfile} section={section} onNavigate={navigate}>
      <p data-testid="page">{section}</p>
    </AdminShell>
  )
}

beforeEach(() => {
  window.location.hash = ""
})

describe("AdminShell sidebar", () => {
  it("renders every group with every section", () => {
    render(<Harness />)

    for (const group of ADMIN_NAV_GROUPS) {
      const element = screen.getByTestId(`nav-group-${group.id}`)
      expect(within(element).getByText(group.label)).toBeInTheDocument()
      for (const section of sectionsInGroup(group.id)) {
        expect(within(element).getByTestId(`nav-${section.id}`)).toHaveTextContent(section.label)
      }
    }
  })

  it("starts on Resumen and marks it active", () => {
    render(<Harness />)

    expect(screen.getByTestId("page")).toHaveTextContent("overview")
    expect(screen.getByTestId("nav-overview")).toHaveAttribute("aria-current", "page")
  })

  it("switches section on click, writes the hash and updates the breadcrumb", async () => {
    render(<Harness />)

    await act(async () => {
      fireEvent.click(screen.getByTestId("nav-inventory/items"))
    })

    expect(screen.getByTestId("page")).toHaveTextContent("inventory/items")
    expect(window.location.hash).toBe("#inventory/items")
    expect(screen.getByTestId("nav-inventory/items")).toHaveAttribute("aria-current", "page")
    expect(screen.getByTestId("nav-overview")).not.toHaveAttribute("aria-current")
    const breadcrumb = screen.getByRole("navigation", { name: "breadcrumb" })
    expect(breadcrumb).toHaveTextContent("Inventario")
    expect(breadcrumb).toHaveTextContent("Artículos")
  })

  it("opens the section in the hash on mount and follows later hash changes", async () => {
    window.location.hash = "#settings/taxes"
    render(<Harness />)
    expect(screen.getByTestId("page")).toHaveTextContent("settings/taxes")

    await act(async () => {
      window.location.hash = "#cash"
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    })
    expect(screen.getByTestId("page")).toHaveTextContent("cash")
  })

  it("opens the default section for an unknown hash", () => {
    window.location.hash = "#does-not-exist"
    render(<Harness />)
    expect(screen.getByTestId("page")).toHaveTextContent("overview")
  })
})

describe("AdminShell command menu", () => {
  it("opens with Ctrl+K, filters by typing and navigates on select", async () => {
    render(<Harness />)

    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    })
    const input = await screen.findByPlaceholderText("Ir a una sección o acción…")

    await act(async () => {
      fireEvent.change(input, { target: { value: "bodeg" } })
    })
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Bodegas")).toBeInTheDocument()
    expect(within(dialog).queryByText("Caja")).not.toBeInTheDocument()
    expect(within(dialog).queryByText("Negocio")).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByText("Bodegas"))
    })

    expect(screen.getByTestId("page")).toHaveTextContent("inventory/locations")
    expect(window.location.hash).toBe("#inventory/locations")
    expect(screen.queryByPlaceholderText("Ir a una sección o acción…")).not.toBeInTheDocument()
  })

  it("opens from the top-bar search button and offers Cambiar perfil to the admin", async () => {
    const onChangeProfile = vi.fn()
    render(<Harness onChangeProfile={onChangeProfile} />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Buscar sección o acción" }))
    })
    const dialog = await screen.findByRole("dialog")

    await act(async () => {
      fireEvent.click(within(dialog).getByText("Cambiar perfil"))
    })
    expect(onChangeProfile).toHaveBeenCalledTimes(1)
  })
})

describe("AdminShell sidebar width", () => {
  const setWidth = (width: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width })
  }

  it("starts collapsed to icons on tablet widths so the page keeps its room", () => {
    setWidth(800)
    const { container } = render(<Harness />)
    expect(container.ownerDocument.querySelector('[data-state="collapsed"][data-collapsible="icon"]')).not.toBeNull()
  })

  it("follows the window across 1280 px: rail on tablet, full sidebar on desktop", async () => {
    setWidth(1440)
    const { container } = render(<Harness />)
    const doc = container.ownerDocument
    expect(doc.querySelector('[data-state="expanded"]')).not.toBeNull()

    await act(async () => {
      setWidth(1024)
      window.dispatchEvent(new Event("resize"))
    })
    expect(doc.querySelector('[data-state="collapsed"][data-collapsible="icon"]')).not.toBeNull()

    await act(async () => {
      setWidth(1440)
      window.dispatchEvent(new Event("resize"))
    })
    expect(doc.querySelector('[data-state="expanded"]')).not.toBeNull()
  })

  it("starts expanded on wide screens", () => {
    setWidth(1440)
    const { container } = render(<Harness />)
    expect(container.ownerDocument.querySelector('[data-state="expanded"]')).not.toBeNull()
    expect(container.ownerDocument.querySelector('[data-state="collapsed"][data-collapsible="icon"]')).toBeNull()
  })
})

describe("AdminShell brand and phone drawer", () => {
  const setWidth = (width: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width })
  }

  it("names the product VipePOS with the restaurant and the role under it", () => {
    setWidth(1440)
    useConfigStore.setState({ businessName: "Asadero La Fonda" })
    render(<Harness />)

    const sidebar = screen.getByTestId("admin-brand")
    expect(sidebar).toHaveTextContent("VipePOS")
    expect(sidebar).toHaveTextContent("Asadero La Fonda · Administrador")
    expect(document.body).not.toHaveTextContent("VibePOS")
  })

  it("opens the navigation as a drawer from the top-bar menu button on phones and closes it on navigate", async () => {
    setWidth(390)
    render(<Harness />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }))
    })
    const drawer = await screen.findByRole("dialog")
    expect(within(drawer).getByTestId("nav-overview")).toHaveAttribute("aria-current", "page")

    await act(async () => {
      fireEvent.click(within(drawer).getByTestId("nav-tables"))
    })
    expect(screen.getByTestId("page")).toHaveTextContent("tables")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

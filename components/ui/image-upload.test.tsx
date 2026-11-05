import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S1, S2) — dish images upload through the presign flow of `lib/api/storage`. */

const storage = vi.hoisted(() => ({ uploadImage: vi.fn(), deleteImage: vi.fn() }))
vi.mock("@/lib/api/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/storage")>()),
  ...storage,
}))
vi.mock("next/image", () => ({ default: () => null }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { ImageUpload } from "./image-upload"

const png = new File([new Uint8Array(4)], "sopa.png", { type: "image/png" })
const publicUrl = "http://localhost:9000/vipe-dev/r-1/dishes/abc.png"

function pick(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>("#image-upload")!
  return act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
}

beforeEach(() => {
  storage.uploadImage.mockReset().mockResolvedValue(publicUrl)
  storage.deleteImage.mockReset().mockResolvedValue(undefined)
  toastMock.mockClear()
})

describe("ImageUpload", () => {
  it("uploads to the dishes folder, reports the public URL and deletes it on remove", async () => {
    const onChange = vi.fn()
    const { container } = render(<ImageUpload value="" onChange={onChange} />)
    await pick(container, png)

    expect(storage.uploadImage).toHaveBeenCalledWith(png, "dishes")
    expect(onChange).toHaveBeenLastCalledWith(publicUrl)

    await act(async () => {
      fireEvent.click(container.querySelector("button.absolute")!)
    })
    expect(storage.deleteImage).toHaveBeenCalledWith(publicUrl)
    expect(onChange).toHaveBeenLastCalledWith("")
  })

  it("shows the 503 text and keeps the value untouched", async () => {
    storage.uploadImage.mockRejectedValueOnce(new Error("El almacenamiento de imágenes no está configurado"))
    const onChange = vi.fn()
    const { container } = render(<ImageUpload value="" onChange={onChange} />)
    await pick(container, png)

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        description: "El almacenamiento de imágenes no está configurado",
      }),
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(storage.deleteImage).not.toHaveBeenCalled()
  })

  it("refuses an SVG before any request", async () => {
    const { container } = render(<ImageUpload value="" onChange={vi.fn()} />)
    await pick(container, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))
    expect(storage.uploadImage).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Tipo de archivo no válido" }))
  })

  it("never writes a placeholder into the value when an upload fails (item 1)", async () => {
    storage.uploadImage.mockRejectedValueOnce(new Error("No se pudo subir la imagen"))
    const onChange = vi.fn()
    const { container } = render(<ImageUpload value="" onChange={onChange} />)
    await pick(container, png)
    expect(onChange).not.toHaveBeenCalled()
  })
})

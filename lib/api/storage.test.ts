import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T12 (S1, S2) — dish images: the API presigns a PUT bound to type and size,
 * the browser PUTs the bytes straight to the bucket, the dish keeps `publicUrl`.
 */

const api = vi.hoisted(() => ({ POST: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { deleteImage, getPlaceholderUrl, isPlaceholderUrl, uploadImage, validateImage } from "./storage"

const fetchMock = vi.fn()
const ticket = {
  uploadUrl: "http://localhost:9000/vipe-dev/r-1/dishes/abc.png?X-Amz-Signature=x",
  key: "r-1/dishes/abc.png",
  publicUrl: "http://localhost:9000/vipe-dev/r-1/dishes/abc.png",
}
const png = (size = 4) => new File([new Uint8Array(size)], "sopa.png", { type: "image/png" })

beforeEach(() => {
  api.POST.mockReset().mockResolvedValue({ data: ticket })
  api.DELETE.mockReset().mockResolvedValue({ data: undefined })
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("uploadImage", () => {
  it("presigns, PUTs the file with exactly that Content-Type and returns the public URL", async () => {
    const file = png(4)
    await expect(uploadImage(file, "dishes")).resolves.toBe(ticket.publicUrl)

    expect(api.POST).toHaveBeenCalledWith("/api/storage/uploads", {
      body: { kind: "dish", contentType: "image/png", size: 4 },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: file,
    })
  })

  it("fails when the bucket refuses the PUT", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(uploadImage(png(), "dishes")).rejects.toThrow("No se pudo subir la imagen")
  })

  it("explains a 503 as storage not configured", async () => {
    api.POST.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", "Storage is not configured"))
    await expect(uploadImage(png(), "dishes")).rejects.toThrow("El almacenamiento de imágenes no está configurado")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("checks type and size on the client like the server, without asking the API", async () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" })
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })

    expect(validateImage(png())).toBeNull()
    expect(validateImage(svg)).toBe("Por favor, selecciona una imagen (JPG, PNG, GIF)")
    expect(validateImage(pdf)).toBe("Por favor, selecciona una imagen (JPG, PNG, GIF)")
    expect(validateImage(big)).toBe("El tamaño máximo permitido es 5MB")
    await expect(uploadImage(big, "dishes")).rejects.toThrow("El tamaño máximo permitido es 5MB")
    expect(api.POST).not.toHaveBeenCalled()
  })
})

describe("deleteImage", () => {
  it("asks the API to delete the object by its public URL", async () => {
    await deleteImage(ticket.publicUrl)
    expect(api.DELETE).toHaveBeenCalledWith("/api/storage/objects", { body: { publicUrl: ticket.publicUrl } })
  })

  it("never deletes a placeholder or an empty URL", async () => {
    await deleteImage(getPlaceholderUrl("Sopa"))
    await deleteImage("")
    expect(isPlaceholderUrl("/placeholder.svg?height=300")).toBe(true)
    expect(api.DELETE).not.toHaveBeenCalled()
  })

describe("correction batch", () => {
  it("rejects a network or CORS failure of the PUT with the Spanish text (item 3)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(uploadImage(png(), "dishes")).rejects.toThrow("No se pudo subir la imagen")
  })

  it("refuses an empty file before any request (item 4)", async () => {
    const empty = new File([], "vacia.png", { type: "image/png" })
    expect(validateImage(empty)).toBe("El archivo está vacío")
    await expect(uploadImage(empty, "dishes")).rejects.toThrow("El archivo está vacío")
    expect(api.POST).not.toHaveBeenCalled()
  })

  it("treats a 422 on delete as nothing of ours to delete (item 7)", async () => {
    api.DELETE.mockRejectedValueOnce(new ApiError(422, "Unprocessable Entity", "Not an object of this restaurant"))
    await expect(deleteImage("https://x.supabase.co/storage/v1/object/public/dishes/a.png")).resolves.toBeUndefined()
    api.DELETE.mockRejectedValueOnce(new ApiError(500, "Internal Server Error", "boom"))
    await expect(deleteImage(ticket.publicUrl)).rejects.toBeInstanceOf(ApiError)
  })
})
})

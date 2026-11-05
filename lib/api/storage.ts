import { api } from "./client"
import { ApiError } from "./errors"

/**
 * Dish images through S3-compatible storage (T12). The API presigns a PUT
 * bound to the declared Content-Type and size; the browser sends the bytes
 * straight to the bucket (plain `fetch`: the presigned URL is not the API)
 * and the dish stores `publicUrl`. The client checks mirror the server's so a
 * bad file never costs a request.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const STORAGE_MESSAGES = {
  type: "Por favor, selecciona una imagen (JPG, PNG, GIF)",
  size: "El tamaño máximo permitido es 5MB",
  unconfigured: "El almacenamiento de imágenes no está configurado",
  upload: "No se pudo subir la imagen",
  empty: "El archivo está vacío",
} as const

/** Upload folders the API knows (`kind`). */
const KIND_BY_FOLDER = { dishes: "dish" } as const
export type ImageFolder = keyof typeof KIND_BY_FOLDER

/** The Spanish reason a file cannot be uploaded, or null when it can. */
export function validateImage(file: File): string | null {
  if (!/^image\//i.test(file.type) || /^image\/svg/i.test(file.type)) return STORAGE_MESSAGES.type
  if (file.size === 0) return STORAGE_MESSAGES.empty
  if (file.size > MAX_IMAGE_BYTES) return STORAGE_MESSAGES.size
  return null
}

/** Uploads the file and returns its public URL. */
export async function uploadImage(file: File, folder: ImageFolder = "dishes"): Promise<string> {
  const invalid = validateImage(file)
  if (invalid) throw new Error(invalid)

  let ticket
  try {
    ticket = (
      await api.POST("/api/storage/uploads", {
        body: { kind: KIND_BY_FOLDER[folder], contentType: file.type, size: file.size },
      })
    ).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw new Error(STORAGE_MESSAGES.unconfigured)
    throw error
  }
  if (!ticket) throw new Error(STORAGE_MESSAGES.upload)

  let response: Response
  try {
    response = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    })
  } catch {
    // Network error or a bucket without CORS for this origin.
    throw new Error(STORAGE_MESSAGES.upload)
  }
  if (!response.ok) throw new Error(STORAGE_MESSAGES.upload)
  return ticket.publicUrl
}

export function getPlaceholderUrl(name = "food"): string {
  return `/placeholder.svg?height=300&width=400&query=${encodeURIComponent(name)}`
}

export function isPlaceholderUrl(url: string): boolean {
  return url.includes("placeholder.svg")
}

/**
 * Deletes an uploaded image; empty and placeholder URLs are never sent. A 422
 * means the URL is not an object of this restaurant's bucket (a legacy
 * Supabase URL, say): there is nothing of ours to delete.
 */
export async function deleteImage(publicUrl: string): Promise<void> {
  if (!publicUrl || isPlaceholderUrl(publicUrl)) return
  try {
    await api.DELETE("/api/storage/objects", { body: { publicUrl } })
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) return
    throw error
  }
}

/** Whether a stored image URL still answers (a HEAD to the public URL). */
export async function isImageAccessible(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: "HEAD" })).ok
  } catch {
    return false
  }
}

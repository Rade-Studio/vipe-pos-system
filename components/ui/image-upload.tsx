"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, X } from "lucide-react"
import Image from "next/image"
import { useToast } from "@/hooks/use-toast"
import { STORAGE_MESSAGES, deleteImage, getPlaceholderUrl, uploadImage as uploadToStorage, validateImage, type ImageFolder } from "@/lib/api/storage"
import { log } from "@/lib/log"

interface ImageUploadProps {
  value: string
  onChange: (url: string) => void
  /** Storage folder of the upload (the API `kind`). */
  bucketName?: ImageFolder
  maxWidth?: number
  maxHeight?: number
}

export function ImageUpload({
  value,
  onChange,
  bucketName = "dishes",
  maxWidth = 1200,
  maxHeight = 800,
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (value) {
      setPreview(value)
      setImageError(false)
    }
  }, [value])

  const uploadImage = async (file: File) => {
    setIsUploading(true)
    setImageError(false)

    try {
      // Presigned PUT through the API; the bytes go straight to the bucket.
      const imageUrl = await uploadToStorage(file, bucketName)

      log.info("URL de imagen obtenida:", { imageUrl })

      setPreview(imageUrl)
      onChange(imageUrl)

      toast({
        title: "Imagen subida",
        description: "La imagen se ha subido correctamente",
      })
    } catch (error: any) {
      log.error("Error completo al subir imagen:", { error: String(error) })

      // The value stays as it was: a placeholder is never stored as the image.
      toast({
        variant: "destructive",
        title: "Error al subir la imagen",
        description: error.message || "Ocurrió un error al subir la imagen",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    log.info("Archivo seleccionado:", { name: file.name, type: file.type, size: file.size })

    // Same checks as the API (image/* except SVG, 5 MB): a bad file costs no request.
    const invalid = validateImage(file)
    if (invalid) {
      toast({
        variant: "destructive",
        title: invalid === STORAGE_MESSAGES.size ? "Archivo demasiado grande" : "Tipo de archivo no válido",
        description: invalid,
      })
      return
    }

    uploadImage(file)
  }

  const handleRemoveImage = () => {
    if (preview) {
      try {
        // Placeholder URLs are never sent (deleteImage skips them).
        deleteImage(preview).catch((err) => {
          log.error("Error al eliminar imagen:", { err: String(err) })
        })
      } catch (e) {
        log.error("Error al intentar eliminar imagen:", { e: String(e) })
      }
    }

    setPreview(null)
    setImageError(false)
    onChange("")
  }

  const handleImageError = () => {
    log.warn("Error al cargar la imagen:", { preview })
    setImageError(true)

    // Display fallback only (see `src` below); the value keeps the real URL.
  }

  return (
    <div className="space-y-4">
      {preview ? (
        <div className="relative rounded-md overflow-hidden border border-gray-200 dark:border-gray-800">
          <div className="aspect-video relative">
            <Image
              src={imageError || !preview ? getPlaceholderUrl() : preview}
              alt="Preview"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 600px"
              onError={handleImageError}
            />
            {imageError && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400">No se pudo cargar la imagen</p>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 rounded-full"
            onClick={handleRemoveImage}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-md p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
          onClick={() => document.getElementById("image-upload")?.click()}
        >
          <Upload className="h-10 w-10 text-gray-400 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Arrastra una imagen o haz clic para seleccionar
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">PNG, JPG o GIF (máx. 5MB)</p>
        </div>
      )}

      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          disabled={isUploading}
          onClick={() => document.getElementById("image-upload")?.click()}
          className={preview ? "w-full" : "hidden"}
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Subiendo...
            </>
          ) : (
            "Cambiar imagen"
          )}
        </Button>
        <input id="image-upload" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
      </div>
    </div>
  )
}

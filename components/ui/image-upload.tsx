"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, X } from "lucide-react"
import Image from "next/image"
import { useToast } from "@/hooks/use-toast"
import { storageService } from "@/lib/supabase/storage-service"
import { log } from "@/lib/log"

interface ImageUploadProps {
  value: string
  onChange: (url: string) => void
  bucketName?: string
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
      log.info("Iniciando carga de imagen usando StorageService...")

      // Usar el servicio para subir la imagen
      const imageUrl = await storageService.uploadImage(file, bucketName)

      log.info("URL de imagen obtenida:", { imageUrl })

      setPreview(imageUrl)
      onChange(imageUrl)

      toast({
        title: "Imagen subida",
        description: "La imagen se ha subido correctamente",
      })
    } catch (error: any) {
      log.error("Error completo al subir imagen:", { error: String(error) })

      // Usar un placeholder en caso de error
      const placeholderUrl = storageService.getPlaceholderUrl(file.name.split(".")[0])
      setPreview(placeholderUrl)
      onChange(placeholderUrl)
      setImageError(true)

      toast({
        variant: "destructive",
        title: "Error al subir la imagen",
        description: "Se usará una imagen de placeholder. " + (error.message || "Ocurrió un error al subir la imagen"),
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    log.info("Archivo seleccionado:", { name: file.name, type: file.type, size: file.size })

    // Check file type
    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Tipo de archivo no válido",
        description: "Por favor, selecciona una imagen (JPG, PNG, GIF)",
      })
      return
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Archivo demasiado grande",
        description: "El tamaño máximo permitido es 5MB",
      })
      return
    }

    uploadImage(file)
  }

  const handleRemoveImage = () => {
    if (preview && !imageError) {
      try {
        // Intentar eliminar la imagen del storage
        storageService.deleteImage(preview).catch((err) => {
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

    // Si hay un error al cargar la imagen, usar un placeholder
    if (preview) {
      const placeholderUrl = storageService.getPlaceholderUrl()
      setPreview(placeholderUrl)
      onChange(placeholderUrl)
    }
  }

  return (
    <div className="space-y-4">
      {preview ? (
        <div className="relative rounded-md overflow-hidden border border-gray-200 dark:border-gray-800">
          <div className="aspect-video relative">
            <Image
              src={preview || "/placeholder.svg"}
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

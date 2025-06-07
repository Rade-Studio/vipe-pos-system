import { supabase } from "@/lib/db/client"

export const storageService = {
  /**
   * Sube una imagen a Supabase Storage
   */
  async uploadImage(file: File, bucketName = "dishes"): Promise<string> {
    console.log(`StorageService: Iniciando carga de imagen en bucket ${bucketName}`)

    try {
      // Generar nombre de archivo único
      const fileExt = file.name.split(".").pop()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`

      console.log(`StorageService: Subiendo archivo ${fileName} al bucket ${bucketName}...`)

      // Subir archivo
      const { error: uploadError, data: uploadData } = await supabase.storage.from(bucketName).upload(fileName, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type,
      })

      if (uploadError) {
        // Si el error es porque el bucket no existe, proporcionar un mensaje claro
        if (uploadError.message.includes("bucket") && uploadError.message.includes("not found")) {
          console.error(`StorageService: El bucket ${bucketName} no existe.`)
          throw new Error(
            `El bucket "${bucketName}" no existe. Por favor, créalo manualmente en el panel de Supabase Storage.`,
          )
        }

        console.error(`StorageService: Error al subir archivo:`, uploadError)
        throw new Error(`Error al subir archivo: ${uploadError.message}`)
      }

      // Obtener URL pública
      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName)

      if (!urlData || !urlData.publicUrl) {
        throw new Error("No se pudo obtener la URL pública de la imagen")
      }

      // Construir URL manualmente para asegurar el formato correcto
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || supabase.supabaseUrl
      const manualUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${fileName}`

      console.log(`StorageService: URL generada por Supabase:`, urlData.publicUrl)
      console.log(`StorageService: URL construida manualmente:`, manualUrl)

      // Verificar si la URL es accesible
      try {
        const response = await fetch(urlData.publicUrl, { method: "HEAD" })
        if (response.ok) {
          console.log(`StorageService: La URL es accesible`)
          return urlData.publicUrl
        } else {
          console.warn(`StorageService: La URL no es accesible, usando URL manual`)
          return manualUrl
        }
      } catch (error) {
        console.warn(`StorageService: Error al verificar URL, usando URL manual:`, error)
        return manualUrl
      }
    } catch (error: any) {
      console.error("StorageService: Error completo:", error)
      throw error
    }
  },

  /**
   * Elimina una imagen de Supabase Storage
   */
  async deleteImage(url: string): Promise<void> {
    try {
      // Extraer el bucket y el path del archivo de la URL
      const urlObj = new URL(url)
      const pathParts = urlObj.pathname.split("/")

      // La estructura típica es /storage/v1/object/public/[bucket]/[filename]
      const bucketIndex = pathParts.indexOf("public") + 1

      if (bucketIndex <= 0 || bucketIndex >= pathParts.length) {
        throw new Error("No se pudo determinar el bucket y el path del archivo desde la URL")
      }

      const bucket = pathParts[bucketIndex]
      const filePath = pathParts.slice(bucketIndex + 1).join("/")

      console.log(`StorageService: Eliminando archivo ${filePath} del bucket ${bucket}...`)

      const { error } = await supabase.storage.from(bucket).remove([filePath])

      if (error) {
        console.error("StorageService: Error al eliminar archivo:", error)
        throw new Error(`Error al eliminar archivo: ${error.message}`)
      }

      console.log("StorageService: Archivo eliminado exitosamente")
    } catch (error: any) {
      console.error("StorageService: Error al eliminar imagen:", error)
      throw error
    }
  },

  /**
   * Verifica si una URL de imagen es accesible
   */
  async isImageAccessible(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: "HEAD" })
      return response.ok
    } catch (error) {
      console.error("Error al verificar accesibilidad de imagen:", error)
      return false
    }
  },

  /**
   * Obtiene una URL de imagen alternativa si la original no es accesible
   */
  getPlaceholderUrl(name = "food"): string {
    return `/placeholder.svg?height=300&width=400&query=${encodeURIComponent(name)}`
  },
}

import qrcode from "qrcode-generator"

/**
 * Table QR images (S18): a standalone SVG of the code (black modules on white,
 * sized in modules so it scales crisply) and its PNG for download.
 */

export type QrEcc = "L" | "M" | "Q" | "H"

export function qrSvg(text: string, { margin = 4, ecc = "M" }: { margin?: number; ecc?: QrEcc } = {}): string {
  const code = qrcode(0, ecc)
  code.addData(text)
  code.make()
  const count = code.getModuleCount()
  const size = count + margin * 2
  let d = ""
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  )
}

/** Rasterizes the QR to a square PNG through an offscreen canvas (browser only). */
export async function qrPngBlob(text: string, sizePx = 1024): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([qrSvg(text)], { type: "image/svg+xml" }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("No se pudo dibujar el QR"))
      image.src = url
    })
    const canvas = document.createElement("canvas")
    canvas.width = sizePx
    canvas.height = sizePx
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No se pudo dibujar el QR")
    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0, sizePx, sizePx)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo dibujar el QR"))), "image/png"),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function fileName(restaurantSlug: string, tableNumber: number): string {
  return `carta-${restaurantSlug}-mesa-${tableNumber}.png`
}

/** Saves a blob under a file name through a temporary link. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

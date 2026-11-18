import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet"

/** H-103: the built-in close button of dialogs and sheets is announced in Spanish. */
describe("dialog and sheet close button (H-103)", () => {
  it("names the dialog close button Cerrar", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Texto</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("names the sheet close button Cerrar", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Título</SheetTitle>
          <SheetDescription>Texto</SheetDescription>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument()
  })
})

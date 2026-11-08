import { describe, expect, it } from "vitest"
import { formatCurrency } from "@/utils/helpers"
import { modifierGroup } from "./fixtures"
import {
  blockReason,
  chosenModifiers,
  counterText,
  lineKey,
  missingGroups,
  modifierLabel,
  priceSummary,
  ruleText,
  selectionOf,
  toggleOption,
} from "./rules"

const termino = modifierGroup({ id: "g-t", name: "Término de la carne", minSelect: 1, maxSelect: 1, options: [["o-azul", "Azul", 0], ["o-medio", "Medio", 0]] })
const adic = modifierGroup({
  id: "g-a",
  name: "Adiciones",
  minSelect: 0,
  maxSelect: 3,
  options: [["o-ched", "Queso cheddar", 3000], ["o-toc", "Tocineta", 4000], ["o-hue", "Huevo", 2500], ["o-agu", "Aguacate", 3500]],
})
const sin = modifierGroup({ id: "g-s", name: "Sin", minSelect: 0, maxSelect: null, options: [["o-ceb", "Sin cebolla", 0]] })
const groups = [termino, adic, sin]

describe("modifier rules", () => {
  it("words each rule", () => {
    expect(ruleText(termino)).toBe("Obligatorio · elige 1")
    expect(ruleText(modifierGroup({ minSelect: 1, maxSelect: 3 }))).toBe("Obligatorio · de 1 a 3")
    expect(ruleText(modifierGroup({ minSelect: 2, maxSelect: null }))).toBe("Obligatorio · al menos 2")
    expect(ruleText(adic)).toBe("Opcional · hasta 3")
    expect(ruleText(sin)).toBe("Opcional · sin límite")
  })

  it("counts the choices: Listo / Falta elegir, n de max, n elegidas", () => {
    expect(counterText(termino, 0)).toBe("Falta elegir")
    expect(counterText(termino, 1)).toBe("Listo")
    expect(counterText(adic, 2)).toBe("2 de 3")
    expect(counterText(sin, 0)).toBe("")
    expect(counterText(sin, 1)).toBe("1 elegida")
    expect(counterText(sin, 2)).toBe("2 elegidas")
  })

  it("a required group blocks the add until it holds, naming what is missing", () => {
    expect(missingGroups(groups, {}).map((g) => g.id)).toEqual(["g-t"])
    expect(blockReason(missingGroups(groups, {}))).toBe("Falta: Término de la carne")
    expect(missingGroups(groups, { "g-t": ["o-medio"] })).toEqual([])
    expect(blockReason([])).toBeNull()
  })

  it("single choice replaces; a required one cannot be cleared, an optional one can", () => {
    let sel = toggleOption(termino, {}, "o-azul").selection
    sel = toggleOption(termino, sel, "o-medio").selection
    expect(sel["g-t"]).toEqual(["o-medio"])
    expect(toggleOption(termino, sel, "o-medio").selection["g-t"]).toEqual(["o-medio"])
    const optional = modifierGroup({ id: "g-o", minSelect: 0, maxSelect: 1, options: [["o-1", "Uno", 0]] })
    expect(toggleOption(optional, { "g-o": ["o-1"] }, "o-1").selection["g-o"]).toEqual([])
  })

  it("enforces the max: the 4th pick is refused and the selection is unchanged", () => {
    let sel = {}
    for (const id of ["o-ched", "o-toc", "o-hue"]) sel = toggleOption(adic, sel, id).selection
    const refused = toggleOption(adic, sel, "o-agu")
    expect(refused.refused).toBe("max")
    expect(refused.selection).toBe(sel)
    expect(toggleOption(adic, sel, "o-toc").selection["g-a"]).toEqual(["o-ched", "o-hue"])
  })

  it("prices the line: dish + options, in group then option order", () => {
    const chosen = chosenModifiers(groups, { "g-a": ["o-toc", "o-ched"], "g-t": ["o-medio"] })
    expect(chosen.map((m) => m.optionId)).toEqual(["o-medio", "o-ched", "o-toc"])
    expect(chosen.reduce((sum, m) => sum + m.price, 0)).toBe(7000)
    expect(priceSummary("Hamburguesa artesanal", 22000, 7000)).toBe(
      `Hamburguesa ${formatCurrency(22000)} + ${formatCurrency(7000)} = ${formatCurrency(29000)} c/u`,
    )
  })

  it("rebuilds the selection of a line to edit it", () => {
    const chosen = chosenModifiers(groups, { "g-t": ["o-azul"], "g-a": ["o-hue"] })
    expect(selectionOf(chosen)).toEqual({ "g-t": ["o-azul"], "g-a": ["o-hue"] })
  })

  it("keys a line by dish + sorted option ids + trimmed note", () => {
    expect(lineKey("d-1", ["o-2", "o-1"], " poca sal ")).toBe(lineKey("d-1", ["o-1", "o-2"], "poca sal"))
    expect(lineKey("d-1", ["o-1"], "")).not.toBe(lineKey("d-1", [], ""))
    expect(lineKey("d-1", [], "a")).not.toBe(lineKey("d-1", [], ""))
  })

  it("labels a cart option: priced as '+ name', $0 as 'Group: name' unless the name says it", () => {
    const [medio, ched] = chosenModifiers(groups, { "g-t": ["o-medio"], "g-a": ["o-ched"] })
    expect(modifierLabel({ ...medio, groupName: "Término" })).toBe("Término: Medio")
    expect(modifierLabel(ched)).toBe("+ Queso cheddar")
    expect(modifierLabel(chosenModifiers(groups, { "g-s": ["o-ceb"] })[0])).toBe("Sin cebolla")
  })
})

/**
 * promociones-mejoras M8 (S7): a combo picked in the builder is one cart line
 * of the delivery draft, priced in the preview as combo lines and sent in
 * `combos` (one per unit), never in `items`.
 */

import { describe, expect, it } from 'vitest'
import type { CartCombo } from '@/lib/promotions/waiter'
import { draftTotals, initialOrderDraft, orderDraftReducer, previewDraftLines, toCreateInput, validateDraft, type OrderDraft } from './order-draft'

const menu: CartCombo = {
  promotionId: 'p-ejec',
  comboPrice: 24000,
  listPrice: 33000,
  choices: [
    { groupId: 'g-sopa', dishId: 'd-ajiaco', name: 'Ajiaco', price: 9000 },
    { groupId: 'g-principio', dishId: 'd-bandeja', name: 'Bandeja', price: 17000 },
    { groupId: 'g-bebida', dishId: 'd-mora', name: 'Jugo de mora', price: 7000 },
  ],
}

function draftWithCombo(): OrderDraft {
  let draft = initialOrderDraft({ suggestedFee: 4000 })
  draft = orderDraftReducer(draft, { type: 'setPhoneInput', value: '3001234567' })
  draft = orderDraftReducer(draft, { type: 'setCustomerName', value: 'Ana' })
  draft = orderDraftReducer(draft, { type: 'setAddressNew', addressLine: 'Calle 1', neighborhood: null, reference: null, label: null })
  draft = orderDraftReducer(draft, {
    type: 'addItem',
    line: { dishId: 'd-arepa', name: 'Arepa', unitPrice: 5000, quantity: 1, comments: null },
  })
  return orderDraftReducer(draft, { type: 'addCombo', name: 'Menú ejecutivo', combo: menu })
}

describe('combo lines', () => {
  it('addCombo appends one line at the list price; a second combo is its own line', () => {
    const draft = draftWithCombo()
    expect(draft.cartLines[1]).toMatchObject({ name: 'Menú ejecutivo', unitPrice: 33000, quantity: 1, comments: null, combo: menu })
    const twice = orderDraftReducer(draft, { type: 'addCombo', name: 'Menú ejecutivo', combo: menu })
    expect(twice.cartLines).toHaveLength(3)
    expect(twice.cartLines[2]!.id).not.toBe(twice.cartLines[1]!.id)
  })

  it('a dish line never merges into a combo line', () => {
    const draft = orderDraftReducer(draftWithCombo(), {
      type: 'addItem',
      line: { dishId: 'd-arepa', name: 'Arepa', unitPrice: 5000, quantity: 2, comments: null },
    })
    expect(draft.cartLines.map((l) => [l.name, l.quantity])).toEqual([
      ['Arepa', 3],
      ['Menú ejecutivo', 1],
    ])
  })

  it('previewDraftLines sends one combo line per unit, in cart order, each indexed to its cart line', () => {
    const draft = draftWithCombo()
    const comboLineId = draft.cartLines[1]!.id
    const doubled = orderDraftReducer(draft, { type: 'incrementItem', lineId: comboLineId })
    const combo = {
      comboPromotionId: 'p-ejec',
      choices: [
        { groupId: 'g-sopa', dishId: 'd-ajiaco' },
        { groupId: 'g-principio', dishId: 'd-bandeja' },
        { groupId: 'g-bebida', dishId: 'd-mora' },
      ],
    }
    expect(previewDraftLines(doubled.cartLines)).toEqual({
      lines: [{ dishId: 'd-arepa', quantity: 1 }, combo, combo],
      lineIds: [draft.cartLines[0]!.id, comboLineId, comboLineId],
    })
  })

  it('toCreateInput sends the combo in combos (one per unit) and only dish lines in items', () => {
    const draft = draftWithCombo()
    const doubled = orderDraftReducer(draft, { type: 'incrementItem', lineId: draft.cartLines[1]!.id })
    const input = toCreateInput(doubled)
    expect(input.items).toEqual([{ dishId: 'd-arepa', quantity: 1 }])
    const combo = {
      comboPromotionId: 'p-ejec',
      choices: [
        { groupId: 'g-sopa', dishId: 'd-ajiaco' },
        { groupId: 'g-principio', dishId: 'd-bandeja' },
        { groupId: 'g-bebida', dishId: 'd-mora' },
      ],
    }
    expect(input.combos).toEqual([combo, combo])
  })

  it('toCreateInput leaves combos out when the cart has none (the body stays as before)', () => {
    const draft = draftWithCombo()
    const plain = orderDraftReducer(draft, { type: 'removeItem', lineId: draft.cartLines[1]!.id })
    expect('combos' in toCreateInput(plain)).toBe(false)
  })

  it('a combo-only cart is a valid draft with no items', () => {
    const draft = draftWithCombo()
    const onlyCombo = orderDraftReducer(draft, { type: 'removeItem', lineId: draft.cartLines[0]!.id })
    expect(validateDraft(onlyCombo, 0).map((i) => i.field)).toEqual([])
    expect(toCreateInput(onlyCombo).items).toEqual([])
  })

  it('without a preview the total already takes off the combo saving; with one it uses the net', () => {
    const draft = draftWithCombo()
    // 5.000 + 33.000 − 9.000 + fee 4.000.
    expect(draftTotals(draft, 0)).toEqual({ subtotal: 38000, discounts: 9000, tax: 0, fee: 4000, total: 33000 })
    expect(draftTotals(draft, 0, { netSubtotal: 29000 })).toEqual({ subtotal: 38000, discounts: 9000, tax: 0, fee: 4000, total: 33000 })
  })
})

import { describe, expect, it } from 'vitest'
import { buildSplitItems, pickSplitParent } from './split'

// -----------------------------------------------------------
// pickSplitParent
// -----------------------------------------------------------

describe('pickSplitParent', () => {
  it('returns the only non-partial active order', () => {
    const orders = [
      { id: 'a', isPartialOrder: false, status: 'active' as const },
    ]
    expect(pickSplitParent(orders)).toBe('a')
  });

  it('accepts kitchen and delivered in addition to active', () => {
    const orders = [
      { id: 'k', isPartialOrder: false, status: 'kitchen' as const },
    ]
    expect(pickSplitParent(orders)).toBe('k')

    const delivered = [
      { id: 'd', isPartialOrder: false, status: 'delivered' as const },
    ]
    expect(pickSplitParent(delivered)).toBe('d')
  });

  it('ignores partial children even when status matches', () => {
    const orders = [
      { id: 'partial-1', isPartialOrder: true, status: 'active' as const },
    ]
    expect(pickSplitParent(orders)).toBeNull()
  });

  it('ignores orders with status paid', () => {
    const orders = [
      { id: 'paid-1', isPartialOrder: false, status: 'paid' as const },
    ]
    expect(pickSplitParent(orders)).toBeNull()
  });

  it('returns null when more than one non-partial candidate exists (ambiguous)', () => {
    const orders = [
      { id: 'a', isPartialOrder: false, status: 'active' as const },
      { id: 'b', isPartialOrder: false, status: 'kitchen' as const },
    ]
    expect(pickSplitParent(orders)).toBeNull()
  });

  it('returns null on empty input', () => {
    expect(pickSplitParent([])).toBeNull()
  });

  it('skips paid/partial and returns the single remaining candidate', () => {
    const orders = [
      { id: 'paid-1', isPartialOrder: false, status: 'paid' as const },
      { id: 'partial-1', isPartialOrder: true, status: 'active' as const },
      { id: 'main', isPartialOrder: false, status: 'delivered' as const },
    ]
    expect(pickSplitParent(orders)).toBe('main')
  });
})

// -----------------------------------------------------------
// buildSplitItems
// -----------------------------------------------------------

describe('buildSplitItems', () => {
  const parentItems = [
    { id: 'i1', quantity: 2 },
    { id: 'i2', quantity: 1 },
    { id: 'i3', quantity: 4 },
  ]

  it('drops zero quantities and returns the requested lines', () => {
    const result = buildSplitItems(parentItems, { i1: 1, i2: 0, i3: 2 })
    expect(result).toEqual({
      items: [
        { order_item_id: 'i1', quantity: 1 },
        { order_item_id: 'i3', quantity: 2 },
      ],
    })
  });

  it('returns error=empty when nothing is selected', () => {
    expect(buildSplitItems(parentItems, {})).toEqual({ error: 'empty' })
    expect(buildSplitItems(parentItems, { i1: 0, i2: 0 })).toEqual({
      error: 'empty',
    })
  });

  it('returns error=over-quantity when a requested qty is greater than parent qty', () => {
    const result = buildSplitItems(parentItems, { i1: 5 })
    expect(result).toEqual({ error: 'over-quantity' })
  });

  it('returns error=unknown-item for ids not in parentItems', () => {
    const result = buildSplitItems(parentItems, { bogus: 1 })
    expect(result).toEqual({ error: 'unknown-item' })
  });

  it('returns error=moves-everything when every line moves in full', () => {
    const result = buildSplitItems(parentItems, { i1: 2, i2: 1, i3: 4 })
    expect(result).toEqual({ error: 'moves-everything' })
  });

  it('does NOT flag moves-everything when one line keeps at least 1 unit', () => {
    const result = buildSplitItems(parentItems, { i1: 2, i2: 1 })
    expect(result).toEqual({
      items: [
        { order_item_id: 'i1', quantity: 2 },
        { order_item_id: 'i2', quantity: 1 },
      ],
    })
  });

  it('returns error=too-many-lines above 50', () => {
    const manyParents = Array.from({ length: 51 }, (_, i) => ({
      id: `i${i}`,
      quantity: 1,
    }))
    const selection: Record<string, number> = {}
    for (const p of manyParents) selection[p.id] = 1
    const result = buildSplitItems(manyParents, selection)
    expect(result).toEqual({ error: 'too-many-lines' })
  });

  it('accepts exactly 50 lines', () => {
    const manyParents = Array.from({ length: 50 }, (_, i) => ({
      id: `i${i}`,
      quantity: 2,
    }))
    const selection: Record<string, number> = {}
    for (const p of manyParents) selection[p.id] = 1
    const result = buildSplitItems(manyParents, selection)
    expect('items' in result).toBe(true)
    if ('items' in result) {
      expect(result.items.length).toBe(50)
    }
  });

  it('ignores unknown keys mixed with valid ones (treats as unknown-item)', () => {
    const result = buildSplitItems(parentItems, { i1: 1, bogus: 1 })
    expect(result).toEqual({ error: 'unknown-item' })
  });

  it('preserves id order from parentItems in the output', () => {
    const result = buildSplitItems(parentItems, { i3: 1, i1: 1 })
    expect(result).toEqual({
      items: [
        { order_item_id: 'i1', quantity: 1 },
        { order_item_id: 'i3', quantity: 1 },
      ],
    })
  });
})
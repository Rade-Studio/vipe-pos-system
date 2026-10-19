import { describe, expect, it } from 'vitest'

import { inventoryKeys, menuStockKey } from '@/lib/inventory/query-keys'
import { invalidationsFor } from './invalidations'

// `.tsx` so the dom project picks it up (hooks/** has no node-project glob).

describe('inventoryKeys', () => {
  it('nests every key under ["inventory"] and details under their list', () => {
    expect(inventoryKeys.all).toEqual(['inventory'])
    expect(inventoryKeys.items()).toEqual(['inventory', 'items'])
    expect(inventoryKeys.item('i1')).toEqual(['inventory', 'items', 'i1'])
    expect(inventoryKeys.lots('i1')).toEqual(['inventory', 'lots', 'i1'])
    expect(inventoryKeys.movements({ itemId: 'i1' })).toEqual(['inventory', 'movements', { itemId: 'i1' }])
    expect(inventoryKeys.purchase('p1')).toEqual(['inventory', 'purchases', 'detail', 'p1'])
    expect(inventoryKeys.purchases({ status: 'draft' })).toEqual(['inventory', 'purchases', 'list', { status: 'draft' }])
    expect(inventoryKeys.count('c1')).toEqual(['inventory', 'counts', 'c1'])
    expect(inventoryKeys.overview(30)).toEqual(['inventory', 'overview', 30])
    for (const key of [inventoryKeys.formulas(), inventoryKeys.suppliers(), inventoryKeys.counts(), inventoryKeys.batches(), inventoryKeys.locations(), inventoryKeys.categories()]) {
      expect(key[0]).toBe('inventory')
    }
  })
})

const stockChange = (itemId?: string) => [
  inventoryKeys.items(),
  itemId ? inventoryKeys.lots(itemId) : inventoryKeys.lots(),
  inventoryKeys.movements(),
  inventoryKeys.overview(),
  menuStockKey,
]

describe('invalidationsFor', () => {
  it('stock RPCs on one item invalidate items, that item lots, movements, overview and the menu stock', () => {
    expect(invalidationsFor({ type: 'adjust', itemId: 'i1' })).toEqual(stockChange('i1'))
    expect(invalidationsFor({ type: 'transfer', itemId: 'i1' })).toEqual(stockChange('i1'))
  })

  it('multi-item stock RPCs invalidate every lot plus their documents', () => {
    expect(invalidationsFor({ type: 'receivePurchase' })).toEqual([...stockChange(), inventoryKeys.purchases()])
    expect(invalidationsFor({ type: 'applyCount' })).toEqual([...stockChange(), inventoryKeys.counts()])
    expect(invalidationsFor({ type: 'produce' })).toEqual([...stockChange(), inventoryKeys.batches()])
    expect(invalidationsFor({ type: 'consumeOrder' })).toEqual(stockChange())
  })

  it('save_formula invalidates formulas and the menu availability', () => {
    expect(invalidationsFor({ type: 'saveFormula' })).toEqual([inventoryKeys.formulas(), menuStockKey])
  })

  it('catalog writes invalidate only their lists', () => {
    expect(invalidationsFor({ type: 'saveItem' })).toEqual([inventoryKeys.items(), inventoryKeys.overview()])
    expect(invalidationsFor({ type: 'saveCategory' })).toEqual([inventoryKeys.categories(), inventoryKeys.items()])
    expect(invalidationsFor({ type: 'saveLocation' })).toEqual([inventoryKeys.locations()])
    expect(invalidationsFor({ type: 'saveSupplier' })).toEqual([inventoryKeys.suppliers()])
    expect(invalidationsFor({ type: 'savePurchase' })).toEqual([inventoryKeys.purchases(), inventoryKeys.overview()])
  })

  it('count edits invalidate the count; opening or cancelling invalidates the list', () => {
    expect(invalidationsFor({ type: 'countLine', countId: 'c1' })).toEqual([inventoryKeys.count('c1')])
    expect(invalidationsFor({ type: 'openCount' })).toEqual([inventoryKeys.counts()])
    expect(invalidationsFor({ type: 'cancelCount' })).toEqual([inventoryKeys.counts()])
  })
})

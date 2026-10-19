import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adjustStock,
  applyCount,
  cancelCount,
  checkDishesStock,
  consumeOrderStock,
  createPreparation,
  createPurchaseOrder,
  getInventoryOverview,
  getPurchaseOrder,
  listFormulas,
  listItems,
  listLots,
  listMovements,
  openCount,
  producePreparation,
  receivePurchaseOrder,
  saveFormula,
  setCountedQuantity,
  setPurchaseOrderStatus,
  transferStock,
} from './index'

// -----------------------------------------------------------
// Fake Supabase client (same idea as delivery-service.test.ts).
// -----------------------------------------------------------
// Every builder call is recorded as [method, ...args] per `from(table)`
// so the tests can assert the exact query a service builds. Each
// `from` call pops the next queued result (default: empty list).

const state = vi.hoisted(() => ({
  rpc: [] as Array<[string, Record<string, unknown> | undefined]>,
  rpcResult: { data: null as unknown, error: null as unknown },
  queries: [] as Array<{ table: string; calls: unknown[][] }>,
  results: [] as Array<{ data: unknown; error: unknown; count?: number | null }>,
}))

vi.mock('@/lib/supabase/client', () => {
  const makeChain = (calls: unknown[][], result: { data: unknown; error: unknown; count?: number | null }) => {
    const promise = Promise.resolve(result)
    const chain: Record<string, unknown> = {}
    for (const m of [
      'select', 'eq', 'neq', 'in', 'gte', 'lte', 'lt', 'or', 'order', 'range', 'limit',
      'insert', 'update', 'delete', 'single', 'maybeSingle',
    ]) {
      chain[m] = (...args: unknown[]) => {
        calls.push([m, ...args])
        return chain
      }
    }
    chain.then = promise.then.bind(promise)
    return chain
  }
  return {
    supabase: {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        state.rpc.push([fn, args])
        return Promise.resolve(state.rpcResult)
      },
      from: (table: string) => {
        const calls: unknown[][] = []
        state.queries.push({ table, calls })
        return makeChain(calls, state.results.shift() ?? { data: [], error: null })
      },
    },
  }
})

beforeEach(() => {
  state.rpc = []
  state.rpcResult = { data: null, error: null }
  state.queries = []
  state.results = []
})

const rpcReturns = (data: unknown) => {
  state.rpcResult = { data, error: null }
}

// -----------------------------------------------------------
// RPC wrappers: exact function name + argument object
// -----------------------------------------------------------

describe('RPC wrappers', () => {
  it('adjustStock sends inventory_adjust with every p_ argument and normalizes numerics', async () => {
    rpcReturns({ ingredient_id: 'i1', location_id: 'l1', movement_type: 'waste', quantity: '2.500', total_cost: '1200.0000', stock: '7.5' })
    const result = await adjustStock({
      itemId: 'i1', locationId: 'l1', movementType: 'waste', quantity: 2.5,
      unitCost: null, reason: 'vencido', notes: null, lotId: 'lot1', lotCode: null, expiresOn: null,
    })
    expect(state.rpc).toEqual([['inventory_adjust', {
      p_ingredient_id: 'i1', p_location_id: 'l1', p_movement_type: 'waste', p_quantity: 2.5,
      p_unit_cost: null, p_reason: 'vencido', p_notes: null, p_lot_id: 'lot1', p_lot_code: null, p_expires_on: null,
    }]])
    expect(result).toEqual({ itemId: 'i1', locationId: 'l1', movementType: 'waste', quantity: 2.5, totalCost: 1200, stock: 7.5 })
  })

  it('transferStock sends inventory_transfer', async () => {
    rpcReturns({ transfer_id: 't1', ingredient_id: 'i1', from_location_id: 'a', to_location_id: 'b', quantity: '3', total_cost: 90 })
    const result = await transferStock({ itemId: 'i1', fromLocationId: 'a', toLocationId: 'b', quantity: 3 })
    expect(state.rpc).toEqual([['inventory_transfer', {
      p_ingredient_id: 'i1', p_from_location_id: 'a', p_to_location_id: 'b', p_quantity: 3, p_notes: null,
    }]])
    expect(result).toEqual({ transferId: 't1', itemId: 'i1', fromLocationId: 'a', toLocationId: 'b', quantity: 3, totalCost: 90 })
  })

  it('saveFormula sends save_formula with snake_case lines', async () => {
    rpcReturns({ recipe_id: 'r1', target_type: 'prep', target_id: 'p1', yield_quantity: '2000', lines_count: 2, total_cost: '5000', unit_cost: '2.5' })
    const result = await saveFormula({
      targetType: 'prep', targetId: 'p1', yieldQuantity: 2000, notes: 'licuar',
      lines: [{ ingredientId: 'a', quantity: 500 }, { ingredientId: 'b', quantity: 0.25 }],
    })
    expect(state.rpc).toEqual([['save_formula', {
      p_target_type: 'prep', p_target_id: 'p1', p_yield_quantity: 2000, p_notes: 'licuar',
      p_lines: [{ ingredient_id: 'a', quantity: 500 }, { ingredient_id: 'b', quantity: 0.25 }],
    }]])
    expect(result).toEqual({ recipeId: 'r1', targetType: 'prep', targetId: 'p1', yieldQuantity: 2000, linesCount: 2, totalCost: 5000, unitCost: 2.5 })
  })

  it('receivePurchaseOrder sends receive_purchase_order with only the provided optional fields', async () => {
    rpcReturns({ purchase_order_id: 'po1', status: 'partially_received', received_lines: 1, total_cost: '100' })
    const result = await receivePurchaseOrder('po1', [
      { lineId: 'l1', quantity: 2, unitCost: 50, lotCode: 'A1', expiresOn: '2026-12-01' },
      { lineId: 'l2', quantity: 1 },
    ])
    expect(state.rpc).toEqual([['receive_purchase_order', {
      p_purchase_order_id: 'po1',
      p_lines: [
        { line_id: 'l1', quantity: 2, unit_cost: 50, lot_code: 'A1', expires_on: '2026-12-01' },
        { line_id: 'l2', quantity: 1 },
      ],
    }]])
    expect(result).toEqual({ purchaseOrderId: 'po1', status: 'partially_received', receivedLines: 1, totalCost: 100 })
  })

  it('openCount sends open_inventory_count; applyCount sends apply_inventory_count', async () => {
    rpcReturns({ count_id: 'c1', number: 4, location_id: 'l1', status: 'open', lines_count: 12 })
    expect(await openCount({ locationId: 'l1', itemIds: ['a', 'b'] })).toEqual({ countId: 'c1', number: 4, locationId: 'l1', status: 'open', linesCount: 12 })
    rpcReturns({ count_id: 'c1', status: 'applied', adjusted_lines: 3, value_delta: '-150.5' })
    expect(await applyCount('c1')).toEqual({ countId: 'c1', status: 'applied', adjustedLines: 3, valueDelta: -150.5 })
    expect(state.rpc).toEqual([
      ['open_inventory_count', { p_location_id: 'l1', p_ingredient_ids: ['a', 'b'], p_notes: null }],
      ['apply_inventory_count', { p_count_id: 'c1' }],
    ])
  })

  it('producePreparation sends produce_preparation and maps the consumed list', async () => {
    rpcReturns({
      batch_id: 'b1', lot_id: 'lot1', lot_code: 'PB-1', ingredient_id: 'p1', location_id: 'l1', quantity: '2000',
      unit_cost: '2.5', total_cost: '5000', expires_on: '2026-10-22',
      consumed: [{ ingredient_id: 'a', name: 'Tomate', quantity: '500', total_cost: '3000' }],
    })
    const result = await producePreparation({ itemId: 'p1', quantity: 2000 })
    expect(state.rpc).toEqual([['produce_preparation', {
      p_ingredient_id: 'p1', p_quantity: 2000, p_location_id: null, p_lot_code: null, p_notes: null,
    }]])
    expect(result).toEqual({
      batchId: 'b1', lotId: 'lot1', lotCode: 'PB-1', itemId: 'p1', locationId: 'l1', quantity: 2000,
      unitCost: 2.5, totalCost: 5000, expiresOn: '2026-10-22',
      consumed: [{ itemId: 'a', name: 'Tomate', quantity: 500, totalCost: 3000 }],
    })
  })

  it('consumeOrderStock and checkDishesStock map shortages', async () => {
    rpcReturns({ order_id: 'o1', enabled: true, consumed_items: 2, total_cost: '10', shortages: [{ ingredient_id: 'a', name: 'Pan', unit: 'und', missing: '1' }] })
    expect(await consumeOrderStock('o1')).toEqual({
      orderId: 'o1', enabled: true, consumedItems: 2, totalCost: 10,
      shortages: [{ itemId: 'a', name: 'Pan', unit: 'und', missing: 1 }],
    })
    rpcReturns({ ok: false, enabled: true, shortages: [{ ingredient_id: 'a', name: 'Pan', unit: 'und', required: '3', available: '1', missing: '2' }] })
    expect(await checkDishesStock([{ dishId: 'd1', quantity: 3 }])).toEqual({
      ok: false, enabled: true,
      shortages: [{ itemId: 'a', name: 'Pan', unit: 'und', required: 3, available: 1, missing: 2 }],
    })
    expect(state.rpc).toEqual([
      ['consume_order_stock', { p_order_id: 'o1' }],
      ['check_dishes_stock', { p_items: [{ dish_id: 'd1', quantity: 3 }] }],
    ])
  })

  it('getInventoryOverview sends inventory_overview and normalizes every numeric', async () => {
    rpcReturns({
      days: 30, generated_at: '2026-10-19T00:00:00Z',
      kpis: {
        total_value: '1000.5', items_count: 10, active_items: 9, low_stock_count: 2, out_of_stock_count: 1,
        expiring_soon_count: 0, expired_count: 0, waste_value: '5', purchases_value: '300', consumption_value: '200', open_purchase_orders: 1,
      },
      series: [{ date: '2026-10-18', in_value: '10', out_value: '4', waste_value: '0' }],
      value_by_category: [{ category_id: null, category_name: null, value: '7' }],
      top_consumed: [{ ingredient_id: 'a', name: 'Tomate', unit: 'g', quantity: '500', value: '3000' }],
    })
    const result = await getInventoryOverview(30)
    expect(state.rpc).toEqual([['inventory_overview', { p_days: 30 }]])
    expect(result).toEqual({
      days: 30, generatedAt: '2026-10-19T00:00:00Z',
      kpis: {
        totalValue: 1000.5, itemsCount: 10, activeItems: 9, lowStockCount: 2, outOfStockCount: 1,
        expiringSoonCount: 0, expiredCount: 0, wasteValue: 5, purchasesValue: 300, consumptionValue: 200, openPurchaseOrders: 1,
      },
      series: [{ date: '2026-10-18', inValue: 10, outValue: 4, wasteValue: 0 }],
      valueByCategory: [{ categoryId: null, categoryName: null, value: 7 }],
      topConsumed: [{ itemId: 'a', name: 'Tomate', unit: 'g', quantity: 500, value: 3000 }],
    })
  })

  it('rethrows the raw Supabase error so hooks can map it', async () => {
    state.rpcResult = { data: null, error: { code: 'P0002', message: 'not found' } }
    await expect(applyCount('x')).rejects.toMatchObject({ code: 'P0002' })
  })
})

// -----------------------------------------------------------
// Row mapping
// -----------------------------------------------------------

describe('row mapping', () => {
  it('listItems maps snake_case rows (string numerics included) to InventoryItem', async () => {
    state.results.push({
      data: [{
        id: 'i1', sku: 'MP-0001', name: 'Tomate', description: null, kind: 'raw', unit: 'g', barcode: null,
        cost: '12.5000', stock: '1500.000', min_stock: '200', max_stock: null, purchase_unit: 'kg', purchase_factor: '1000',
        default_supplier_id: 's1', track_lots: true, shelf_life_days: 5, is_active: true, category_id: 'c1',
        ingredient_categories: { name: 'Verduras' },
      }],
      error: null,
    })
    expect(await listItems()).toEqual([{
      id: 'i1', sku: 'MP-0001', name: 'Tomate', description: null, kind: 'raw', unit: 'g', barcode: null,
      cost: 12.5, stock: 1500, minStock: 200, maxStock: null, purchaseUnit: 'kg', purchaseFactor: 1000,
      defaultSupplierId: 's1', trackLots: true, shelfLifeDays: 5, isActive: true, categoryId: 'c1', categoryName: 'Verduras',
    }])
    expect(state.queries[0].table).toBe('ingredients')
  })

  it('listLots filters by item and maps location names', async () => {
    state.results.push({
      data: [{ id: 'l1', ingredient_id: 'i1', location_id: 'loc', lot_code: null, expires_on: null, quantity: '-2', unit_cost: '3', received_at: 'r', inventory_locations: { name: 'Bodega' } }],
      error: null,
    })
    expect(await listLots('i1')).toEqual([{
      id: 'l1', itemId: 'i1', locationId: 'loc', locationName: 'Bodega', lotCode: null, expiresOn: null, quantity: -2, unitCost: 3, receivedAt: 'r',
    }])
    expect(state.queries[0].table).toBe('inventory_lots')
    expect(state.queries[0].calls).toContainEqual(['eq', 'ingredient_id', 'i1'])
  })

  it('getPurchaseOrder computes line totals, pending quantities and the order total', async () => {
    state.results.push({
      data: {
        id: 'po1', number: 7, supplier_id: 's1', location_id: 'l1', status: 'ordered', expected_on: null, payment_status: 'pending',
        notes: null, ordered_at: 'o', received_at: null, created_at: 'c',
        suppliers: { name: 'Fruver' }, inventory_locations: { name: 'Bodega' },
        purchase_order_lines: [
          { id: 'a', ingredient_id: 'i1', quantity: '2.5', unit_cost: '100', received_quantity: '1', ingredients: { name: 'Tomate', unit: 'kg', sku: 'MP-0001' } },
          { id: 'b', ingredient_id: 'i2', quantity: 3, unit_cost: 10, received_quantity: 0, ingredients: { name: 'Pan', unit: 'und', sku: 'MP-0002' } },
        ],
      },
      error: null,
    })
    const po = await getPurchaseOrder('po1')
    expect(po.total).toBe(280)
    expect(po.lines.map((l) => [l.total, l.pendingQuantity])).toEqual([[250, 1.5], [30, 3]])
    expect(po.supplierName).toBe('Fruver')
    expect(state.queries[0].calls).toContainEqual(['eq', 'id', 'po1'])
  })
})

// -----------------------------------------------------------
// Direct writes
// -----------------------------------------------------------

describe('direct writes', () => {
  it('createPreparation inserts a prep item without a SKU so the server assigns one', async () => {
    state.results.push({
      data: { id: 'p1', sku: 'PR-0001', name: 'Salsa roja', description: null, kind: 'prep', unit: 'ml', barcode: null, cost: 0, stock: 0, min_stock: 0, max_stock: null, purchase_unit: null, purchase_factor: 1, default_supplier_id: null, track_lots: false, shelf_life_days: null, is_active: true, category_id: null, ingredient_categories: null },
      error: null,
    })
    const item = await createPreparation({ name: '  Salsa roja ', unit: 'ml' })
    const insert = state.queries[0].calls.find((c) => c[0] === 'insert')
    expect(state.queries[0].table).toBe('ingredients')
    expect(insert?.[1]).toEqual({ name: 'Salsa roja', unit: 'ml', kind: 'prep', category_id: null })
    expect(item.kind).toBe('prep')
    expect(item.sku).toBe('PR-0001')
  })

  it('createPurchaseOrder inserts the header then its lines', async () => {
    state.results.push({ data: { id: 'po1' }, error: null }, { data: null, error: null }, {
      data: { id: 'po1', number: 1, supplier_id: 's1', location_id: 'l1', status: 'draft', expected_on: null, payment_status: 'pending', notes: null, ordered_at: null, received_at: null, created_at: 'c', suppliers: null, inventory_locations: null, purchase_order_lines: [] },
      error: null,
    })
    await createPurchaseOrder({ supplierId: 's1', locationId: 'l1', lines: [{ itemId: 'i1', quantity: 2, unitCost: 5 }] })
    expect(state.queries.map((q) => q.table)).toEqual(['purchase_orders', 'purchase_order_lines', 'purchase_orders'])
    expect(state.queries[0].calls.find((c) => c[0] === 'insert')?.[1]).toEqual({ supplier_id: 's1', location_id: 'l1', expected_on: null, notes: null, status: 'draft' })
    expect(state.queries[1].calls.find((c) => c[0] === 'insert')?.[1]).toEqual([{ purchase_order_id: 'po1', ingredient_id: 'i1', quantity: 2, unit_cost: 5 }])
  })

  it('setPurchaseOrderStatus updates the status only', async () => {
    state.results.push({ data: null, error: null })
    await setPurchaseOrderStatus('po1', 'ordered')
    expect(state.queries[0].calls).toEqual([['update', { status: 'ordered' }], ['eq', 'id', 'po1']])
  })

  it('setCountedQuantity updates counted_quantity on one line; cancelCount sets cancelled', async () => {
    state.results.push({ data: null, error: null }, { data: null, error: null })
    await setCountedQuantity('line1', 4.5)
    await cancelCount('c1')
    expect(state.queries[0]).toEqual({ table: 'inventory_count_lines', calls: [['update', { counted_quantity: 4.5 }], ['eq', 'id', 'line1']] })
    expect(state.queries[1]).toEqual({ table: 'inventory_counts', calls: [['update', { status: 'cancelled' }], ['eq', 'id', 'c1']] })
  })
})

// -----------------------------------------------------------
// listFormulas: exactly two reads, keyed for dishes and preps
// -----------------------------------------------------------

describe('listFormulas', () => {
  it('reads recipes and recipe_ingredients once each and indexes by dish and prep', async () => {
    state.results.push(
      {
        data: [
          { id: 'r1', dish_id: 'd1', ingredient_id: null, yield_quantity: '1', notes: null },
          { id: 'r2', dish_id: null, ingredient_id: 'p1', yield_quantity: '2000', notes: 'n' },
        ],
        error: null,
      },
      {
        data: [
          { recipe_id: 'r1', ingredient_id: 'a', quantity: '150' },
          { recipe_id: 'r1', ingredient_id: 'p1', quantity: '30' },
          { recipe_id: 'r2', ingredient_id: 'b', quantity: '0.5' },
        ],
        error: null,
      },
    )
    const index = await listFormulas()
    expect(state.queries.map((q) => q.table)).toEqual(['recipes', 'recipe_ingredients'])
    expect(index.byDish.d1).toEqual({
      recipeId: 'r1', targetType: 'dish', targetId: 'd1', yieldQuantity: 1, notes: null,
      lines: [{ ingredientId: 'a', quantity: 150 }, { ingredientId: 'p1', quantity: 30 }],
    })
    expect(index.byPrep.p1).toEqual({
      recipeId: 'r2', targetType: 'prep', targetId: 'p1', yieldQuantity: 2000, notes: 'n',
      lines: [{ ingredientId: 'b', quantity: 0.5 }],
    })
  })
})

// -----------------------------------------------------------
// listMovements: filters + pagination + total count
// -----------------------------------------------------------

describe('listMovements', () => {
  it('applies every filter, the page range and requests an exact count', async () => {
    state.results.push({
      data: [{
        id: 'm1', ingredient_id: 'i1', location_id: 'l1', lot_id: null, movement_type: 'waste', quantity: '-2', unit_cost: '3', total_cost: '-6',
        reason: 'r', notes: null, reference_type: null, reference_id: null, created_by: null, created_at: 'c',
        ingredients: { name: 'Tomate', sku: 'MP-0001', unit: 'g' }, inventory_locations: { name: 'Bodega' },
      }],
      error: null,
      count: 41,
    })
    const page = await listMovements({
      itemId: 'i1', locationId: 'l1', types: ['waste', 'adjustment'], from: '2026-10-01', to: '2026-10-19', page: 2, pageSize: 20,
    })
    const calls = state.queries[0].calls
    expect(state.queries[0].table).toBe('inventory_movements')
    expect(calls[0][0]).toBe('select')
    expect(calls[0][2]).toEqual({ count: 'exact' })
    expect(calls).toContainEqual(['eq', 'ingredient_id', 'i1'])
    expect(calls).toContainEqual(['eq', 'location_id', 'l1'])
    expect(calls).toContainEqual(['in', 'movement_type', ['waste', 'adjustment']])
    expect(calls).toContainEqual(['gte', 'created_at', '2026-10-01'])
    expect(calls).toContainEqual(['lte', 'created_at', '2026-10-19T23:59:59.999'])
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(calls).toContainEqual(['range', 20, 39])
    expect(page.total).toBe(41)
    expect(page.rows[0]).toMatchObject({ id: 'm1', itemName: 'Tomate', sku: 'MP-0001', quantity: -2, totalCost: -6, locationName: 'Bodega' })
  })

  it('without filters it only orders and paginates the first page', async () => {
    state.results.push({ data: [], error: null, count: 0 })
    const page = await listMovements({})
    const methods = state.queries[0].calls.map((c) => c[0])
    expect(methods).toEqual(['select', 'order', 'range'])
    expect(state.queries[0].calls).toContainEqual(['range', 0, 49])
    expect(page).toEqual({ rows: [], total: 0 })
  })
})

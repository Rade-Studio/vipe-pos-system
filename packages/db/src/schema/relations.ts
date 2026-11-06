import { relations } from "drizzle-orm/relations";
import { restaurants, businessConfig, cashRegisters, cashTransactions, categories, couriers, customers, customerAddresses, dishes, ingredientCategories, ingredients, ingredientTransactions, ingredientTransactionsOrders, orders, suppliers, inventoryCounts, inventoryCountLines, profiles, inventoryLocations, inventoryLots, inventoryMovements, orderDeliveries, orderItems, tables, paymentMethods, payments, paymentTenders, paymentTransactions, productionBatches, users, promotionDishes, promotions, purchaseOrderLines, purchaseOrders, recipeIngredients, recipes, authSessions, printerTokens, printJobs, zones, subcategories } from "./schema";

export const businessConfigRelations = relations(businessConfig, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [businessConfig.restaurantId],
		references: [restaurants.id]
	}),
}));

export const restaurantsRelations = relations(restaurants, ({many}) => ({
	businessConfigs: many(businessConfig),
	cashRegisters: many(cashRegisters),
	cashTransactions: many(cashTransactions),
	categories: many(categories),
	couriers: many(couriers),
	customerAddresses: many(customerAddresses),
	customers: many(customers),
	dishes: many(dishes),
	ingredientCategories: many(ingredientCategories),
	ingredientTransactions: many(ingredientTransactions),
	ingredients: many(ingredients),
	inventoryCountLines: many(inventoryCountLines),
	inventoryCounts: many(inventoryCounts),
	inventoryLocations: many(inventoryLocations),
	inventoryLots: many(inventoryLots),
	inventoryMovements: many(inventoryMovements),
	orderDeliveries: many(orderDeliveries),
	orderItems: many(orderItems),
	orders: many(orders),
	paymentMethods: many(paymentMethods),
	paymentTenders: many(paymentTenders),
	paymentTransactions: many(paymentTransactions),
	payments: many(payments),
	productionBatches: many(productionBatches),
	profiles: many(profiles),
	promotionDishes: many(promotionDishes),
	promotions: many(promotions),
	purchaseOrderLines: many(purchaseOrderLines),
	purchaseOrders: many(purchaseOrders),
	recipeIngredients: many(recipeIngredients),
	recipes: many(recipes),
	suppliers: many(suppliers),
	tables: many(tables),
	printerTokens: many(printerTokens),
	printJobs: many(printJobs),
	zones: many(zones),
	subcategories: many(subcategories),
}));

export const cashRegistersRelations = relations(cashRegisters, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [cashRegisters.restaurantId],
		references: [restaurants.id]
	}),
	cashTransactions: many(cashTransactions),
	paymentTransactions: many(paymentTransactions),
	payments: many(payments),
}));

export const cashTransactionsRelations = relations(cashTransactions, ({one}) => ({
	cashRegister: one(cashRegisters, {
		fields: [cashTransactions.cashRegisterId],
		references: [cashRegisters.id]
	}),
	restaurant: one(restaurants, {
		fields: [cashTransactions.restaurantId],
		references: [restaurants.id]
	}),
}));

export const categoriesRelations = relations(categories, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [categories.restaurantId],
		references: [restaurants.id]
	}),
	dishes: many(dishes),
	subcategories: many(subcategories),
}));

export const couriersRelations = relations(couriers, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [couriers.restaurantId],
		references: [restaurants.id]
	}),
	orderDeliveries: many(orderDeliveries),
}));

export const customerAddressesRelations = relations(customerAddresses, ({one}) => ({
	customer: one(customers, {
		fields: [customerAddresses.customerId],
		references: [customers.id]
	}),
	restaurant: one(restaurants, {
		fields: [customerAddresses.restaurantId],
		references: [restaurants.id]
	}),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	customerAddresses: many(customerAddresses),
	restaurant: one(restaurants, {
		fields: [customers.restaurantId],
		references: [restaurants.id]
	}),
	orderDeliveries: many(orderDeliveries),
}));

export const dishesRelations = relations(dishes, ({one, many}) => ({
	category: one(categories, {
		fields: [dishes.categoryId],
		references: [categories.id]
	}),
	restaurant: one(restaurants, {
		fields: [dishes.restaurantId],
		references: [restaurants.id]
	}),
	orderItems: many(orderItems),
	promotionDishes: many(promotionDishes),
	recipes: many(recipes),
	subcategory: one(subcategories, {
		fields: [dishes.subcategoryId],
		references: [subcategories.id]
	}),
}));

export const ingredientCategoriesRelations = relations(ingredientCategories, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [ingredientCategories.restaurantId],
		references: [restaurants.id]
	}),
	ingredients: many(ingredients),
}));

export const ingredientTransactionsRelations = relations(ingredientTransactions, ({one, many}) => ({
	ingredient: one(ingredients, {
		fields: [ingredientTransactions.ingredientId],
		references: [ingredients.id]
	}),
	restaurant: one(restaurants, {
		fields: [ingredientTransactions.restaurantId],
		references: [restaurants.id]
	}),
	ingredientTransactionsOrders: many(ingredientTransactionsOrders),
}));

export const ingredientsRelations = relations(ingredients, ({one, many}) => ({
	ingredientTransactions: many(ingredientTransactions),
	ingredientCategory: one(ingredientCategories, {
		fields: [ingredients.categoryId],
		references: [ingredientCategories.id]
	}),
	supplier: one(suppliers, {
		fields: [ingredients.defaultSupplierId],
		references: [suppliers.id]
	}),
	restaurant: one(restaurants, {
		fields: [ingredients.restaurantId],
		references: [restaurants.id]
	}),
	inventoryCountLines: many(inventoryCountLines),
	inventoryLots: many(inventoryLots),
	inventoryMovements: many(inventoryMovements),
	productionBatches: many(productionBatches),
	purchaseOrderLines: many(purchaseOrderLines),
	recipeIngredients: many(recipeIngredients),
	recipes: many(recipes),
}));

export const ingredientTransactionsOrdersRelations = relations(ingredientTransactionsOrders, ({one}) => ({
	ingredientTransaction: one(ingredientTransactions, {
		fields: [ingredientTransactionsOrders.ingredientTransactionId],
		references: [ingredientTransactions.id]
	}),
	order: one(orders, {
		fields: [ingredientTransactionsOrders.orderId],
		references: [orders.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	ingredientTransactionsOrders: many(ingredientTransactionsOrders),
	orderDeliveries: many(orderDeliveries),
	orderItems: many(orderItems),
	order: one(orders, {
		fields: [orders.parentOrderId],
		references: [orders.id],
		relationName: "orders_parentOrderId_orders_id"
	}),
	orders: many(orders, {
		relationName: "orders_parentOrderId_orders_id"
	}),
	restaurant: one(restaurants, {
		fields: [orders.restaurantId],
		references: [restaurants.id]
	}),
	table: one(tables, {
		fields: [orders.tableId],
		references: [tables.id]
	}),
	profile: one(profiles, {
		fields: [orders.waiterId],
		references: [profiles.id]
	}),
	paymentTransactions: many(paymentTransactions),
	payments: many(payments),
}));

export const suppliersRelations = relations(suppliers, ({one, many}) => ({
	ingredients: many(ingredients),
	purchaseOrders: many(purchaseOrders),
	restaurant: one(restaurants, {
		fields: [suppliers.restaurantId],
		references: [restaurants.id]
	}),
}));

export const inventoryCountLinesRelations = relations(inventoryCountLines, ({one}) => ({
	inventoryCount: one(inventoryCounts, {
		fields: [inventoryCountLines.countId],
		references: [inventoryCounts.id]
	}),
	ingredient: one(ingredients, {
		fields: [inventoryCountLines.ingredientId],
		references: [ingredients.id]
	}),
	restaurant: one(restaurants, {
		fields: [inventoryCountLines.restaurantId],
		references: [restaurants.id]
	}),
}));

export const inventoryCountsRelations = relations(inventoryCounts, ({one, many}) => ({
	inventoryCountLines: many(inventoryCountLines),
	profile: one(profiles, {
		fields: [inventoryCounts.createdBy],
		references: [profiles.id]
	}),
	inventoryLocation: one(inventoryLocations, {
		fields: [inventoryCounts.locationId],
		references: [inventoryLocations.id]
	}),
	restaurant: one(restaurants, {
		fields: [inventoryCounts.restaurantId],
		references: [restaurants.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	inventoryCounts: many(inventoryCounts),
	inventoryMovements: many(inventoryMovements),
	orders: many(orders),
	paymentTransactions: many(paymentTransactions),
	payments: many(payments),
	productionBatches: many(productionBatches),
	user: one(users, {
		fields: [profiles.userId],
		references: [users.id]
	}),
	restaurant: one(restaurants, {
		fields: [profiles.restaurantId],
		references: [restaurants.id]
	}),
	purchaseOrders: many(purchaseOrders),
	tables: many(tables),
}));

export const inventoryLocationsRelations = relations(inventoryLocations, ({one, many}) => ({
	inventoryCounts: many(inventoryCounts),
	restaurant: one(restaurants, {
		fields: [inventoryLocations.restaurantId],
		references: [restaurants.id]
	}),
	inventoryLots: many(inventoryLots),
	inventoryMovements: many(inventoryMovements),
	productionBatches: many(productionBatches),
	purchaseOrders: many(purchaseOrders),
}));

export const inventoryLotsRelations = relations(inventoryLots, ({one, many}) => ({
	ingredient: one(ingredients, {
		fields: [inventoryLots.ingredientId],
		references: [ingredients.id]
	}),
	inventoryLocation: one(inventoryLocations, {
		fields: [inventoryLots.locationId],
		references: [inventoryLocations.id]
	}),
	restaurant: one(restaurants, {
		fields: [inventoryLots.restaurantId],
		references: [restaurants.id]
	}),
	inventoryMovements: many(inventoryMovements),
	productionBatches: many(productionBatches),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({one}) => ({
	profile: one(profiles, {
		fields: [inventoryMovements.createdBy],
		references: [profiles.id]
	}),
	ingredient: one(ingredients, {
		fields: [inventoryMovements.ingredientId],
		references: [ingredients.id]
	}),
	inventoryLocation: one(inventoryLocations, {
		fields: [inventoryMovements.locationId],
		references: [inventoryLocations.id]
	}),
	inventoryLot: one(inventoryLots, {
		fields: [inventoryMovements.lotId],
		references: [inventoryLots.id]
	}),
	restaurant: one(restaurants, {
		fields: [inventoryMovements.restaurantId],
		references: [restaurants.id]
	}),
}));

export const orderDeliveriesRelations = relations(orderDeliveries, ({one}) => ({
	courier: one(couriers, {
		fields: [orderDeliveries.courierId],
		references: [couriers.id]
	}),
	customer: one(customers, {
		fields: [orderDeliveries.customerId],
		references: [customers.id]
	}),
	order: one(orders, {
		fields: [orderDeliveries.orderId],
		references: [orders.id]
	}),
	restaurant: one(restaurants, {
		fields: [orderDeliveries.restaurantId],
		references: [restaurants.id]
	}),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	dish: one(dishes, {
		fields: [orderItems.dishId],
		references: [dishes.id]
	}),
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
	restaurant: one(restaurants, {
		fields: [orderItems.restaurantId],
		references: [restaurants.id]
	}),
}));

export const tablesRelations = relations(tables, ({one, many}) => ({
	orders: many(orders),
	paymentTransactions: many(paymentTransactions),
	restaurant: one(restaurants, {
		fields: [tables.restaurantId],
		references: [restaurants.id]
	}),
	profile: one(profiles, {
		fields: [tables.waiterId],
		references: [profiles.id]
	}),
	zone: one(zones, {
		fields: [tables.zoneId],
		references: [zones.id]
	}),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [paymentMethods.restaurantId],
		references: [restaurants.id]
	}),
	paymentTenders: many(paymentTenders),
}));

export const paymentTendersRelations = relations(paymentTenders, ({one}) => ({
	payment: one(payments, {
		fields: [paymentTenders.paymentId],
		references: [payments.id]
	}),
	paymentMethod: one(paymentMethods, {
		fields: [paymentTenders.paymentMethodId],
		references: [paymentMethods.id]
	}),
	restaurant: one(restaurants, {
		fields: [paymentTenders.restaurantId],
		references: [restaurants.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one, many}) => ({
	paymentTenders: many(paymentTenders),
	cashRegister: one(cashRegisters, {
		fields: [payments.cashRegisterId],
		references: [cashRegisters.id]
	}),
	profile: one(profiles, {
		fields: [payments.cashierProfileId],
		references: [profiles.id]
	}),
	order: one(orders, {
		fields: [payments.orderId],
		references: [orders.id]
	}),
	restaurant: one(restaurants, {
		fields: [payments.restaurantId],
		references: [restaurants.id]
	}),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({one}) => ({
	cashRegister: one(cashRegisters, {
		fields: [paymentTransactions.cashRegisterId],
		references: [cashRegisters.id]
	}),
	order: one(orders, {
		fields: [paymentTransactions.orderId],
		references: [orders.id]
	}),
	restaurant: one(restaurants, {
		fields: [paymentTransactions.restaurantId],
		references: [restaurants.id]
	}),
	table: one(tables, {
		fields: [paymentTransactions.tableId],
		references: [tables.id]
	}),
	profile: one(profiles, {
		fields: [paymentTransactions.waiterId],
		references: [profiles.id]
	}),
}));

export const productionBatchesRelations = relations(productionBatches, ({one}) => ({
	profile: one(profiles, {
		fields: [productionBatches.createdBy],
		references: [profiles.id]
	}),
	ingredient: one(ingredients, {
		fields: [productionBatches.ingredientId],
		references: [ingredients.id]
	}),
	inventoryLocation: one(inventoryLocations, {
		fields: [productionBatches.locationId],
		references: [inventoryLocations.id]
	}),
	inventoryLot: one(inventoryLots, {
		fields: [productionBatches.lotId],
		references: [inventoryLots.id]
	}),
	restaurant: one(restaurants, {
		fields: [productionBatches.restaurantId],
		references: [restaurants.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	profiles: many(profiles),
	authSessions: many(authSessions),
}));

export const promotionDishesRelations = relations(promotionDishes, ({one}) => ({
	dish: one(dishes, {
		fields: [promotionDishes.dishId],
		references: [dishes.id]
	}),
	promotion: one(promotions, {
		fields: [promotionDishes.promotionId],
		references: [promotions.id]
	}),
	restaurant: one(restaurants, {
		fields: [promotionDishes.restaurantId],
		references: [restaurants.id]
	}),
}));

export const promotionsRelations = relations(promotions, ({one, many}) => ({
	promotionDishes: many(promotionDishes),
	restaurant: one(restaurants, {
		fields: [promotions.restaurantId],
		references: [restaurants.id]
	}),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({one}) => ({
	ingredient: one(ingredients, {
		fields: [purchaseOrderLines.ingredientId],
		references: [ingredients.id]
	}),
	purchaseOrder: one(purchaseOrders, {
		fields: [purchaseOrderLines.purchaseOrderId],
		references: [purchaseOrders.id]
	}),
	restaurant: one(restaurants, {
		fields: [purchaseOrderLines.restaurantId],
		references: [restaurants.id]
	}),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({one, many}) => ({
	purchaseOrderLines: many(purchaseOrderLines),
	profile: one(profiles, {
		fields: [purchaseOrders.createdBy],
		references: [profiles.id]
	}),
	inventoryLocation: one(inventoryLocations, {
		fields: [purchaseOrders.locationId],
		references: [inventoryLocations.id]
	}),
	restaurant: one(restaurants, {
		fields: [purchaseOrders.restaurantId],
		references: [restaurants.id]
	}),
	supplier: one(suppliers, {
		fields: [purchaseOrders.supplierId],
		references: [suppliers.id]
	}),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({one}) => ({
	ingredient: one(ingredients, {
		fields: [recipeIngredients.ingredientId],
		references: [ingredients.id]
	}),
	recipe: one(recipes, {
		fields: [recipeIngredients.recipeId],
		references: [recipes.id]
	}),
	restaurant: one(restaurants, {
		fields: [recipeIngredients.restaurantId],
		references: [restaurants.id]
	}),
}));

export const recipesRelations = relations(recipes, ({one, many}) => ({
	recipeIngredients: many(recipeIngredients),
	dish: one(dishes, {
		fields: [recipes.dishId],
		references: [dishes.id]
	}),
	ingredient: one(ingredients, {
		fields: [recipes.ingredientId],
		references: [ingredients.id]
	}),
	restaurant: one(restaurants, {
		fields: [recipes.restaurantId],
		references: [restaurants.id]
	}),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	user: one(users, {
		fields: [authSessions.userId],
		references: [users.id]
	}),
}));

export const printerTokensRelations = relations(printerTokens, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [printerTokens.restaurantId],
		references: [restaurants.id]
	}),
	printJobs: many(printJobs),
}));

export const printJobsRelations = relations(printJobs, ({one}) => ({
	restaurant: one(restaurants, {
		fields: [printJobs.restaurantId],
		references: [restaurants.id]
	}),
	printerToken: one(printerTokens, {
		fields: [printJobs.printerTokenId],
		references: [printerTokens.id]
	}),
}));

export const zonesRelations = relations(zones, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [zones.restaurantId],
		references: [restaurants.id]
	}),
	tables: many(tables),
}));

export const subcategoriesRelations = relations(subcategories, ({one, many}) => ({
	restaurant: one(restaurants, {
		fields: [subcategories.restaurantId],
		references: [restaurants.id]
	}),
	category: one(categories, {
		fields: [subcategories.categoryId],
		references: [categories.id]
	}),
	dishes: many(dishes),
}));

import { pgTable, index, foreignKey, unique, pgPolicy, uuid, varchar, text, timestamp, uniqueIndex, numeric, check, boolean, bigint, integer, date, jsonb, smallint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { citext } from "./citext"



export const businessConfig = pgTable("business_config", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: varchar({ length: 100 }).notNull(),
	value: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_business_config_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "business_config_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("business_config_restaurant_id_key_key").on(table.key, table.restaurantId),
	pgPolicy("business_config_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("business_config_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("business_config_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("business_config_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const cashRegisters = pgTable("cash_registers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	openingTimestamp: timestamp("opening_timestamp", { withTimezone: true, mode: 'string' }).notNull(),
	closingTimestamp: timestamp("closing_timestamp", { withTimezone: true, mode: 'string' }),
	initialCash: numeric("initial_cash", { precision: 10, scale:  2 }).notNull(),
	finalCash: numeric("final_cash", { precision: 10, scale:  2 }),
	status: varchar({ length: 20 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_cash_registers_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("one_open_register_per_restaurant").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")).where(sql`((status)::text = 'open'::text)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "cash_registers_restaurant_id_fkey"
		}),
	pgPolicy("cash_registers_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("cash_registers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("cash_registers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("cash_registers_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const cashTransactions = pgTable("cash_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	type: varchar({ length: 20 }).notNull(),
	description: text(),
	timestamp: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	cashRegisterId: uuid("cash_register_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_cash_transactions_cash_register_id").using("btree", table.cashRegisterId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_transactions_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_transactions_timestamp").using("btree", table.timestamp.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.cashRegisterId],
			foreignColumns: [cashRegisters.id],
			name: "cash_transactions_cash_register_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "cash_transactions_restaurant_id_fkey"
		}),
	pgPolicy("cash_transactions_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("cash_transactions_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("cash_transactions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("cash_transactions_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("cash_transactions_type_check", sql`(type)::text = ANY (ARRAY[('deposit'::character varying)::text, ('withdrawal'::character varying)::text])`),
]);

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	icon: varchar({ length: 50 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	color: text().default('neutral').notNull(),
}, (table) => [
	index("idx_categories_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "categories_restaurant_id_fkey"
		}),
	pgPolicy("categories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("categories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("categories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("categories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	unique("categories_restaurant_id_id_key").on(table.restaurantId, table.id),
	check("categories_color_check", sql`color = ANY (ARRAY['neutral'::text, 'yellow'::text, 'orange'::text, 'sky'::text, 'violet'::text, 'emerald'::text, 'rose'::text])`),
]);

export const couriers = pgTable("couriers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	name: text().notNull(),
	phone: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_couriers_restaurant_id_is_active").using("btree", table.restaurantId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "couriers_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("couriers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`  }),
	pgPolicy("couriers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("couriers_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("couriers_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80)`),
	check("couriers_phone_check", sql`(phone IS NULL) OR (phone ~ '^[0-9]{7,15}$'::text)`),
]);

export const customerAddresses = pgTable("customer_addresses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	customerId: uuid("customer_id").notNull(),
	label: text(),
	addressLine: text("address_line").notNull(),
	neighborhood: text(),
	reference: text(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_customer_addresses_restaurant_id_customer_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.customerId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_customer_addresses_one_default_per_customer").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")).where(sql`is_default`),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "customer_addresses_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "customer_addresses_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("customer_addresses_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)) AND (( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'cashier'::text, 'delivery_operator'::text])))` }),
	pgPolicy("customer_addresses_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("customer_addresses_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("customer_addresses_address_line_check", sql`(length(btrim(address_line)) >= 1) AND (length(btrim(address_line)) <= 200)`),
	check("customer_addresses_label_check", sql`(label IS NULL) OR (length(label) <= 40)`),
	check("customer_addresses_neighborhood_check", sql`(neighborhood IS NULL) OR (length(neighborhood) <= 80)`),
	check("customer_addresses_reference_check", sql`(reference IS NULL) OR (length(reference) <= 200)`),
]);

export const customers = pgTable("customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	phone: text().notNull(),
	name: text().notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_customers_restaurant_id_phone").using("btree", table.restaurantId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "customers_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("customers_restaurant_id_phone_key").on(table.restaurantId, table.phone),
	pgPolicy("customers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: sql`((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'cashier'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`  }),
	pgPolicy("customers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("customers_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("customers_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)`),
	check("customers_phone_check", sql`phone ~ '^[0-9]{7,15}$'::text`),
]);

export const dishes = pgTable("dishes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	categoryId: uuid("category_id"),
	imageUrl: text("image_url"),
	active: boolean().default(true).notNull(),
	allowComments: boolean("allow_comments").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	subcategoryId: uuid("subcategory_id"),
}, (table) => [
	index("idx_dishes_category").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_dishes_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "dishes_category_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "dishes_restaurant_id_fkey"
		}),
	pgPolicy("dishes_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("dishes_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("dishes_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("dishes_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	index("idx_dishes_subcategory_id").using("btree", table.subcategoryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId, table.categoryId, table.subcategoryId],
			foreignColumns: [subcategories.restaurantId, subcategories.categoryId, subcategories.id],
			name: "dishes_subcategory_id_fkey"
		}).onDelete("restrict"),
	check("dishes_subcategory_category_check", sql`(subcategory_id IS NULL) OR (category_id IS NOT NULL)`),
]);

export const ingredientCategories = pgTable("ingredient_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_ingredient_categories_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "ingredient_categories_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("ingredient_categories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("ingredient_categories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("ingredient_categories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("ingredient_categories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const ingredientTransactions = pgTable("ingredient_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ingredientId: uuid("ingredient_id"),
	quantity: numeric({ precision: 10, scale:  2 }).notNull(),
	totalCost: numeric("total_cost", { precision: 10, scale:  2 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 10, scale:  2 }).notNull(),
	transactionType: varchar("transaction_type", { length: 20 }).notNull(),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pagado').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_ingredient_transactions_ingredient").using("btree", table.ingredientId.asc().nullsLast().op("uuid_ops")),
	index("idx_ingredient_transactions_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_ingredient_transactions_status").using("btree", table.paymentStatus.asc().nullsLast().op("text_ops")),
	index("idx_ingredient_transactions_type").using("btree", table.transactionType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "ingredient_transactions_ingredient_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "ingredient_transactions_restaurant_id_fkey"
		}),
	pgPolicy("ingredient_transactions_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("ingredient_transactions_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("ingredient_transactions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("ingredient_transactions_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const ingredientTransactionsOrders = pgTable("ingredient_transactions_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	ingredientTransactionId: uuid("ingredient_transaction_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	quantityCents: bigint("quantity_cents", { mode: "number" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ingredientTransactionId],
			foreignColumns: [ingredientTransactions.id],
			name: "ingredient_transactions_orders_ingredient_transaction_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "ingredient_transactions_orders_order_id_fkey"
		}).onDelete("cascade"),
	unique("ingredient_transactions_order_order_id_ingredient_transacti_key").on(table.orderId, table.ingredientTransactionId),
	pgPolicy("ingredient_transactions_orders_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = ingredient_transactions_orders.order_id) AND (o.restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))))` }),
	pgPolicy("ingredient_transactions_orders_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("ingredient_transactions_orders_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("ingredient_transactions_orders_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const ingredients = pgTable("ingredients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	stock: numeric({ precision: 14, scale:  3 }).default('0').notNull(),
	unit: varchar({ length: 20 }).notNull(),
	minStock: numeric("min_stock", { precision: 14, scale:  3 }).default('0').notNull(),
	categoryId: uuid("category_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	cost: numeric({ precision: 14, scale:  4 }).default('0'),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	sku: text().default('').notNull(),
	kind: text().default('raw').notNull(),
	barcode: text(),
	maxStock: numeric("max_stock", { precision: 14, scale:  3 }),
	purchaseUnit: varchar("purchase_unit", { length: 20 }),
	purchaseFactor: numeric("purchase_factor", { precision: 14, scale:  4 }).default('1').notNull(),
	defaultSupplierId: uuid("default_supplier_id"),
	trackLots: boolean("track_lots").default(false).notNull(),
	shelfLifeDays: integer("shelf_life_days"),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	index("idx_ingredients_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [ingredientCategories.id],
			name: "ingredients_category_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.defaultSupplierId],
			foreignColumns: [suppliers.id],
			name: "ingredients_default_supplier_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "ingredients_restaurant_id_fkey"
		}),
	unique("ingredients_restaurant_id_sku_key").on(table.restaurantId, table.sku),
	pgPolicy("ingredients_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("ingredients_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("ingredients_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("ingredients_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("ingredients_kind_check", sql`kind = ANY (ARRAY['raw'::text, 'prep'::text])`),
	check("ingredients_max_stock_check", sql`(max_stock IS NULL) OR (max_stock >= (0)::numeric)`),
	check("ingredients_purchase_factor_check", sql`purchase_factor > (0)::numeric`),
	check("ingredients_shelf_life_days_check", sql`(shelf_life_days IS NULL) OR ((shelf_life_days >= 1) AND (shelf_life_days <= 3650))`),
	check("ingredients_sku_check", sql`sku ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'::text`),
]);

export const inventoryCountLines = pgTable("inventory_count_lines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	countId: uuid("count_id").notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	expectedQuantity: numeric("expected_quantity", { precision: 14, scale:  3 }).default('0').notNull(),
	countedQuantity: numeric("counted_quantity", { precision: 14, scale:  3 }),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.countId],
			foreignColumns: [inventoryCounts.id],
			name: "inventory_count_lines_count_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "inventory_count_lines_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "inventory_count_lines_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("inventory_count_lines_count_ingredient_key").on(table.countId, table.ingredientId),
	pgPolicy("inventory_count_lines_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("inventory_count_lines_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("inventory_count_lines_counted_quantity_check", sql`(counted_quantity IS NULL) OR (counted_quantity >= (0)::numeric)`),
]);

export const inventoryCounts = pgTable("inventory_counts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	number: integer().notNull(),
	locationId: uuid("location_id").notNull(),
	status: text().default('open').notNull(),
	notes: text(),
	appliedAt: timestamp("applied_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "inventory_counts_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [inventoryLocations.id],
			name: "inventory_counts_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "inventory_counts_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("inventory_counts_restaurant_id_number_key").on(table.restaurantId, table.number),
	pgPolicy("inventory_counts_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("inventory_counts_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("inventory_counts_status_check", sql`status = ANY (ARRAY['open'::text, 'applied'::text, 'cancelled'::text])`),
]);

export const inventoryLocations = pgTable("inventory_locations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	name: text().notNull(),
	code: text().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_inventory_locations_one_default").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")).where(sql`is_default`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "inventory_locations_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("inventory_locations_restaurant_id_code_key").on(table.restaurantId, table.code),
	pgPolicy("inventory_locations_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`  }),
	pgPolicy("inventory_locations_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("inventory_locations_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("inventory_locations_code_check", sql`code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'::text`),
	check("inventory_locations_default_active_check", sql`(NOT is_default) OR is_active`),
	check("inventory_locations_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80)`),
]);

export const inventoryLots = pgTable("inventory_lots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	locationId: uuid("location_id").notNull(),
	lotCode: text("lot_code"),
	expiresOn: date("expires_on"),
	quantity: numeric({ precision: 14, scale:  3 }).default('0').notNull(),
	unitCost: numeric("unit_cost", { precision: 14, scale:  4 }).default('0').notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_inventory_lots_fefo").using("btree", table.ingredientId.asc().nullsLast().op("timestamptz_ops"), table.locationId.asc().nullsLast().op("timestamptz_ops"), table.expiresOn.asc().nullsLast().op("date_ops"), table.receivedAt.asc().nullsLast().op("uuid_ops")),
	index("idx_inventory_lots_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_inventory_lots_general").using("btree", table.ingredientId.asc().nullsLast().op("uuid_ops"), table.locationId.asc().nullsLast().op("uuid_ops")).where(sql`((lot_code IS NULL) AND (expires_on IS NULL))`),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "inventory_lots_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [inventoryLocations.id],
			name: "inventory_lots_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "inventory_lots_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("inventory_lots_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'kitchen'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	check("inventory_lots_lot_code_check", sql`(lot_code IS NULL) OR ((length(btrim(lot_code)) >= 1) AND (length(btrim(lot_code)) <= 60))`),
	check("inventory_lots_quantity_check", sql`(quantity >= (0)::numeric) OR ((lot_code IS NULL) AND (expires_on IS NULL))`),
	check("inventory_lots_unit_cost_check", sql`unit_cost >= (0)::numeric`),
]);

export const inventoryMovements = pgTable("inventory_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	locationId: uuid("location_id").notNull(),
	lotId: uuid("lot_id"),
	movementType: text("movement_type").notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 14, scale:  4 }).default('0').notNull(),
	totalCost: numeric("total_cost", { precision: 18, scale:  4 }).default('0').notNull(),
	reason: text(),
	notes: text(),
	referenceType: text("reference_type"),
	referenceId: uuid("reference_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_inventory_movements_ingredient_id_created_at").using("btree", table.ingredientId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_inventory_movements_reference").using("btree", table.referenceType.asc().nullsLast().op("uuid_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
	index("idx_inventory_movements_restaurant_id_created_at").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "inventory_movements_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "inventory_movements_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [inventoryLocations.id],
			name: "inventory_movements_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.lotId],
			foreignColumns: [inventoryLots.id],
			name: "inventory_movements_lot_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "inventory_movements_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("inventory_movements_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	check("inventory_movements_movement_type_check", sql`movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'sale'::text, 'production_consume'::text, 'production_output'::text, 'adjustment'::text, 'waste'::text, 'transfer_out'::text, 'transfer_in'::text, 'count_adjustment'::text])`),
	check("inventory_movements_quantity_check", sql`quantity <> (0)::numeric`),
	check("inventory_movements_reason_check", sql`(reason IS NULL) OR (length(reason) <= 200)`),
]);

export const orderDeliveries = pgTable("order_deliveries", {
	orderId: uuid("order_id").primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	customerId: uuid("customer_id").notNull(),
	customerName: text("customer_name").notNull(),
	customerPhone: text("customer_phone").notNull(),
	addressLine: text("address_line").notNull(),
	neighborhood: text(),
	addressReference: text("address_reference"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	deliveryFee: bigint("delivery_fee", { mode: "number" }).default(0).notNull(),
	paymentMode: text("payment_mode").default('cash_on_delivery').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	cashChangeFor: bigint("cash_change_for", { mode: "number" }),
	courierId: uuid("courier_id"),
	deliveryStatus: text("delivery_status").default('received').notNull(),
	failureReason: text("failure_reason"),
	dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	failedAt: timestamp("failed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notes: text(),
}, (table) => [
	index("idx_order_deliveries_restaurant_id_courier_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.courierId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_deliveries_restaurant_id_delivery_status").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.deliveryStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.courierId],
			foreignColumns: [couriers.id],
			name: "order_deliveries_courier_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customers.id],
			name: "order_deliveries_customer_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_deliveries_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "order_deliveries_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("order_deliveries_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_deliveries_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("order_deliveries_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("order_deliveries_failure_reason_check", sql`((delivery_status = 'failed'::text) AND (failure_reason IS NOT NULL) AND ((length(btrim(failure_reason)) >= 1) AND (length(btrim(failure_reason)) <= 200))) OR ((delivery_status <> 'failed'::text) AND ((failure_reason IS NULL) OR (length(failure_reason) <= 200)))`),
	check("order_deliveries_address_line_check", sql`(length(btrim(address_line)) >= 1) AND (length(btrim(address_line)) <= 200)`),
	check("order_deliveries_address_reference_check", sql`(address_reference IS NULL) OR (length(address_reference) <= 200)`),
	check("order_deliveries_cash_change_for_check", sql`((payment_mode = 'cash_on_delivery'::text) AND ((cash_change_for IS NULL) OR (cash_change_for >= 0))) OR ((payment_mode = 'prepaid'::text) AND (cash_change_for IS NULL))`),
	check("order_deliveries_customer_name_check", sql`(length(btrim(customer_name)) >= 1) AND (length(btrim(customer_name)) <= 120)`),
	check("order_deliveries_customer_phone_check", sql`customer_phone ~ '^[0-9]{7,15}$'::text`),
	check("order_deliveries_delivery_fee_check", sql`delivery_fee >= 0`),
	check("order_deliveries_delivery_status_check", sql`delivery_status = ANY (ARRAY['received'::text, 'preparing'::text, 'ready'::text, 'out_for_delivery'::text, 'delivered'::text, 'failed'::text, 'cancelled'::text])`),
	check("order_deliveries_neighborhood_check", sql`(neighborhood IS NULL) OR (length(neighborhood) <= 80)`),
	check("order_deliveries_notes_check", sql`(notes IS NULL) OR (char_length(notes) <= 300)`),
	check("order_deliveries_payment_mode_check", sql`payment_mode = ANY (ARRAY['prepaid'::text, 'cash_on_delivery'::text])`),
]);

export const orderItems = pgTable("order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id"),
	dishId: uuid("dish_id"),
	name: varchar({ length: 100 }).notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	quantity: integer().notNull(),
	comments: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	status: varchar({ length: 20 }).default('kitchen'),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	stockConsumedAt: timestamp("stock_consumed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_order_items_order").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_items_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_items_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_items_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.dishId],
			foreignColumns: [dishes.id],
			name: "order_items_dish_id_fkey"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_items_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "order_items_restaurant_id_fkey"
		}),
	pgPolicy("order_items_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_items_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("order_items_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("order_items_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tableId: uuid("table_id"),
	waiterId: uuid("waiter_id"),
	status: text().default('').notNull(),
	subtotal: numeric({ precision: 10, scale:  2 }).notNull(),
	tax: numeric({ precision: 10, scale:  2 }).notNull(),
	taxPercentage: numeric("tax_percentage", { precision: 5, scale:  2 }).notNull(),
	tip: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	tipPercentage: numeric("tip_percentage", { precision: 5, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	isPartialOrder: boolean("is_partial_order").default(false).notNull(),
	parentOrderId: uuid("parent_order_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	itemsJson: jsonb("items_json"),
	totalDiscounts: numeric("total_discounts", { precision: 10, scale:  2 }).default('0'),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	orderType: text("order_type").default('dine_in').notNull(),
}, (table) => [
	index("idx_orders_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_orders_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_orders_table").using("btree", table.tableId.asc().nullsLast().op("uuid_ops")),
	index("idx_orders_table_id").using("btree", table.tableId.asc().nullsLast().op("uuid_ops")),
	index("idx_orders_waiter").using("btree", table.waiterId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parentOrderId],
			foreignColumns: [table.id],
			name: "orders_parent_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "orders_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.tableId],
			foreignColumns: [tables.id],
			name: "orders_table_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.waiterId],
			foreignColumns: [profiles.id],
			name: "orders_waiter_id_fkey"
		}).onDelete("set null"),
	pgPolicy("orders_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("orders_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("orders_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("orders_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("orders_order_type_check", sql`order_type = ANY (ARRAY['dine_in'::text, 'delivery'::text])`),
	check("orders_order_type_table_id_check", sql`(order_type = 'dine_in'::text) OR (table_id IS NULL)`),
	check("orders_status_check", sql`status = ANY (ARRAY['active'::text, 'kitchen'::text, 'delivered'::text, 'cancelled'::text, 'paid'::text])`),
]);

export const paymentMethods = pgTable("payment_methods", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	code: text().notNull(),
	name: text().notNull(),
	kind: text().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payment_methods_restaurant_id_sort_order").using("btree", table.restaurantId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "payment_methods_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("payment_methods_restaurant_id_code_key").on(table.restaurantId, table.code),
	pgPolicy("payment_methods_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("payment_methods_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("payment_methods_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("payment_methods_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("payment_methods_code_check", sql`code ~ '^[a-z0-9_]{2,32}$'::text`),
	check("payment_methods_kind_check", sql`kind = ANY (ARRAY['cash'::text, 'electronic'::text])`),
	check("payment_methods_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)`),
]);

export const paymentTenders = pgTable("payment_tenders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	paymentId: uuid("payment_id").notNull(),
	lineNo: smallint("line_no").notNull(),
	paymentMethodId: uuid("payment_method_id").notNull(),
	methodCode: text("method_code").notNull(),
	methodKind: text("method_kind").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amount: bigint({ mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	cashReceived: bigint("cash_received", { mode: "number" }),
}, (table) => [
	index("idx_payment_tenders_restaurant_id_payment_method_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.paymentMethodId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payments.id],
			name: "payment_tenders_payment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paymentMethodId],
			foreignColumns: [paymentMethods.id],
			name: "payment_tenders_payment_method_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "payment_tenders_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("payment_tenders_payment_id_line_no_key").on(table.paymentId, table.lineNo),
	pgPolicy("payment_tenders_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("payment_tenders_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("payment_tenders_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("payment_tenders_amount_check", sql`amount > 0`),
	check("payment_tenders_cash_received_check", sql`((method_kind = 'cash'::text) AND (cash_received IS NOT NULL) AND (cash_received >= amount)) OR ((method_kind = 'electronic'::text) AND (cash_received IS NULL))`),
	check("payment_tenders_line_no_check", sql`line_no >= 1`),
	check("payment_tenders_method_kind_check", sql`method_kind = ANY (ARRAY['cash'::text, 'electronic'::text])`),
]);

export const paymentTransactions = pgTable("payment_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	tableId: uuid("table_id"),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	method: varchar({ length: 20 }).notNull(),
	cashReceived: numeric("cash_received", { precision: 10, scale:  2 }),
	cashChange: numeric("cash_change", { precision: 10, scale:  2 }),
	timestamp: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	cashRegisterId: uuid("cash_register_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	waiterId: uuid("waiter_id"),
	tipAmount: numeric("tip_amount", { precision: 10, scale:  2 }).default('0'),
	totalDiscounts: numeric("total_discounts", { precision: 10, scale:  2 }).default('0'),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_payment_transactions_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("payment_transactions_cash_register_id_idx").using("btree", table.cashRegisterId.asc().nullsLast().op("uuid_ops")),
	index("payment_transactions_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("payment_transactions_waiter_id_idx").using("btree", table.waiterId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.cashRegisterId],
			foreignColumns: [cashRegisters.id],
			name: "payment_transactions_cash_register_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "payment_transactions_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "payment_transactions_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.tableId],
			foreignColumns: [tables.id],
			name: "payment_transactions_table_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.waiterId],
			foreignColumns: [profiles.id],
			name: "payment_transactions_waiter_id_fkey"
		}).onDelete("set null"),
	unique("payment_transactions_order_id_unique").on(table.orderId),
	pgPolicy("payment_transactions_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("payment_transactions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("payment_transactions_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const payments = pgTable("payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	orderId: uuid("order_id").notNull(),
	cashRegisterId: uuid("cash_register_id").notNull(),
	cashierProfileId: uuid("cashier_profile_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amountDue: bigint("amount_due", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tipAmount: bigint("tip_amount", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalCharged: bigint("total_charged", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	changeGiven: bigint("change_given", { mode: "number" }).default(0).notNull(),
	idempotencyKey: uuid("idempotency_key").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payments_restaurant_id_cash_register_id_created_at").using("btree", table.restaurantId.asc().nullsLast().op("timestamptz_ops"), table.cashRegisterId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.cashRegisterId],
			foreignColumns: [cashRegisters.id],
			name: "payments_cash_register_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.cashierProfileId],
			foreignColumns: [profiles.id],
			name: "payments_cashier_profile_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "payments_order_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "payments_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("payments_restaurant_id_idempotency_key_key").on(table.restaurantId, table.idempotencyKey),
	unique("payments_order_id_key").on(table.orderId),
	pgPolicy("payments_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("payments_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("payments_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("payments_amount_due_check", sql`amount_due >= 0`),
	check("payments_change_given_check", sql`change_given >= 0`),
	check("payments_tip_amount_check", sql`tip_amount >= 0`),
	check("payments_total_charged_check", sql`total_charged = (amount_due + tip_amount)`),
]);

export const productionBatches = pgTable("production_batches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	locationId: uuid("location_id").notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	lotId: uuid("lot_id"),
	unitCost: numeric("unit_cost", { precision: 14, scale:  4 }).default('0').notNull(),
	totalCost: numeric("total_cost", { precision: 18, scale:  4 }).default('0').notNull(),
	expiresOn: date("expires_on"),
	notes: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_production_batches_restaurant_id_created_at").using("btree", table.restaurantId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "production_batches_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "production_batches_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [inventoryLocations.id],
			name: "production_batches_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.lotId],
			foreignColumns: [inventoryLots.id],
			name: "production_batches_lot_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "production_batches_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("production_batches_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'kitchen'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	check("production_batches_quantity_check", sql`quantity > (0)::numeric`),
]);

export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: varchar("full_name", { length: 100 }).notNull(),
	username: varchar({ length: 50 }),
	email: varchar({ length: 100 }),
	role: varchar({ length: 20 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	userId: uuid("user_id"),
}, (table) => [
	index("idx_profiles_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_profiles_role").using("btree", table.role.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profiles_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "profiles_restaurant_id_fkey"
		}),
	unique("profiles_username_key").on(table.username),
	unique("profiles_email_key").on(table.email),
	unique("profiles_user_id_unique").on(table.userId),
	pgPolicy("profiles_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("profiles_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("profiles_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("profiles_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const promotionDishes = pgTable("promotion_dishes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	promotionId: uuid("promotion_id").notNull(),
	dishId: uuid("dish_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_promotion_dishes_dish_id").using("btree", table.dishId.asc().nullsLast().op("uuid_ops")),
	index("idx_promotion_dishes_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.dishId],
			foreignColumns: [dishes.id],
			name: "promotion_dishes_dish_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.promotionId],
			foreignColumns: [promotions.id],
			name: "promotion_dishes_promotion_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotion_dishes_restaurant_id_fkey"
		}),
	unique("promotion_dishes_promotion_id_dish_id_key").on(table.promotionId, table.dishId),
	pgPolicy("promotion_dishes_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("promotion_dishes_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("promotion_dishes_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("promotion_dishes_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const promotions = pgTable("promotions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	discountType: varchar("discount_type", { length: 20 }).notNull(),
	discountValue: numeric("discount_value", { precision: 10, scale:  2 }).notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }).notNull(),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_promotions_active").using("btree", table.active.asc().nullsLast().op("bool_ops")),
	index("idx_promotions_dates").using("btree", table.startDate.asc().nullsLast().op("timestamptz_ops"), table.endDate.asc().nullsLast().op("timestamptz_ops")),
	index("idx_promotions_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotions_restaurant_id_fkey"
		}),
	pgPolicy("promotions_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("promotions_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("promotions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("promotions_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("promotions_discount_type_check", sql`(discount_type)::text = ANY (ARRAY[('percentage'::character varying)::text, ('fixed_amount'::character varying)::text])`),
]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	purchaseOrderId: uuid("purchase_order_id").notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 14, scale:  4 }).default('0').notNull(),
	receivedQuantity: numeric("received_quantity", { precision: 14, scale:  3 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_purchase_order_lines_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "purchase_order_lines_ingredient_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.purchaseOrderId],
			foreignColumns: [purchaseOrders.id],
			name: "purchase_order_lines_purchase_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "purchase_order_lines_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("purchase_order_lines_order_ingredient_key").on(table.purchaseOrderId, table.ingredientId),
	pgPolicy("purchase_order_lines_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("purchase_order_lines_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("purchase_order_lines_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("purchase_order_lines_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("purchase_order_lines_quantity_check", sql`quantity > (0)::numeric`),
	check("purchase_order_lines_received_quantity_check", sql`received_quantity >= (0)::numeric`),
	check("purchase_order_lines_unit_cost_check", sql`unit_cost >= (0)::numeric`),
]);

export const purchaseOrders = pgTable("purchase_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	number: integer().notNull(),
	supplierId: uuid("supplier_id").notNull(),
	locationId: uuid("location_id").notNull(),
	status: text().default('draft').notNull(),
	expectedOn: date("expected_on"),
	paymentStatus: text("payment_status").default('pending').notNull(),
	notes: text(),
	orderedAt: timestamp("ordered_at", { withTimezone: true, mode: 'string' }),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_purchase_orders_restaurant_id_status").using("btree", table.restaurantId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "purchase_orders_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.locationId],
			foreignColumns: [inventoryLocations.id],
			name: "purchase_orders_location_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "purchase_orders_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.supplierId],
			foreignColumns: [suppliers.id],
			name: "purchase_orders_supplier_id_fkey"
		}).onDelete("restrict"),
	unique("purchase_orders_restaurant_id_number_key").on(table.restaurantId, table.number),
	pgPolicy("purchase_orders_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("purchase_orders_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("purchase_orders_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("purchase_orders_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("purchase_orders_payment_status_check", sql`payment_status = ANY (ARRAY['pending'::text, 'paid'::text])`),
	check("purchase_orders_status_check", sql`status = ANY (ARRAY['draft'::text, 'ordered'::text, 'partially_received'::text, 'received'::text, 'cancelled'::text])`),
]);

export const recipeIngredients = pgTable("recipe_ingredients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	recipeId: uuid("recipe_id").notNull(),
	ingredientId: uuid("ingredient_id").notNull(),
	quantity: numeric({ precision: 14, scale:  4 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
}, (table) => [
	index("idx_recipe_ingredients_ingredient_id").using("btree", table.ingredientId.asc().nullsLast().op("uuid_ops")),
	index("idx_recipe_ingredients_recipe_id").using("btree", table.recipeId.asc().nullsLast().op("uuid_ops")),
	index("idx_recipe_ingredients_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "recipe_ingredients_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "recipe_ingredients_recipe_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "recipe_ingredients_restaurant_id_fkey"
		}),
	unique("recipe_ingredients_recipe_id_ingredient_id_key").on(table.recipeId, table.ingredientId),
	pgPolicy("recipe_ingredients_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("recipe_ingredients_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("recipe_ingredients_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("recipe_ingredients_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
]);

export const recipes = pgTable("recipes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	dishId: uuid("dish_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	ingredientId: uuid("ingredient_id"),
	yieldQuantity: numeric("yield_quantity", { precision: 14, scale:  3 }).default('1').notNull(),
	notes: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_recipes_dish_id").using("btree", table.dishId.asc().nullsLast().op("uuid_ops")),
	index("idx_recipes_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.dishId],
			foreignColumns: [dishes.id],
			name: "recipes_dish_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ingredientId],
			foreignColumns: [ingredients.id],
			name: "recipes_ingredient_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "recipes_restaurant_id_fkey"
		}),
	unique("recipes_dish_id_key").on(table.dishId),
	unique("recipes_ingredient_id_key").on(table.ingredientId),
	pgPolicy("recipes_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("recipes_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("recipes_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("recipes_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("recipes_target_check", sql`num_nonnulls(dish_id, ingredient_id) = 1`),
	check("recipes_yield_quantity_check", sql`yield_quantity > (0)::numeric`),
]);

export const restaurants = pgTable("restaurants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	name: text().notNull(),
	timezone: text().default('America/Bogota').notNull(),
	currency: text().default('COP').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("restaurants_slug_key").on(table.slug),
	pgPolicy("restaurants_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
]);

export const suppliers = pgTable("suppliers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	name: text().notNull(),
	taxId: text("tax_id"),
	contactName: text("contact_name"),
	phone: text(),
	email: text(),
	leadTimeDays: integer("lead_time_days"),
	notes: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_suppliers_restaurant_id_is_active").using("btree", table.restaurantId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "suppliers_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("suppliers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`  }),
	pgPolicy("suppliers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("suppliers_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("suppliers_contact_name_check", sql`(contact_name IS NULL) OR (length(contact_name) <= 120)`),
	check("suppliers_email_check", sql`(email IS NULL) OR (length(email) <= 160)`),
	check("suppliers_lead_time_days_check", sql`(lead_time_days IS NULL) OR ((lead_time_days >= 0) AND (lead_time_days <= 365))`),
	check("suppliers_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)`),
	check("suppliers_phone_check", sql`(phone IS NULL) OR (length(phone) <= 30)`),
	check("suppliers_tax_id_check", sql`(tax_id IS NULL) OR (length(tax_id) <= 30)`),
]);

export const tables = pgTable("tables", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	number: integer().notNull(),
	status: varchar({ length: 20 }).default('available').notNull(),
	waiterId: uuid("waiter_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	zoneId: uuid("zone_id"),
	x: numeric(),
	y: numeric(),
	w: numeric(),
	h: numeric(),
	shape: text().default('square').notNull(),
	rotation: numeric().default('0').notNull(),
	seats: integer(),
}, (table) => [
	index("idx_tables_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_tables_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "tables_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.waiterId],
			foreignColumns: [profiles.id],
			name: "tables_waiter_id_fkey"
		}),
	index("idx_tables_zone_id").using("btree", table.zoneId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId, table.zoneId],
			foreignColumns: [zones.restaurantId, zones.id],
			name: "tables_zone_id_fkey"
		}).onDelete("restrict"),
	unique("tables_restaurant_id_number_key").on(table.number, table.restaurantId),
	pgPolicy("tables_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("tables_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("tables_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("tables_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("tables_layout_check", sql`num_nulls(x, y, w, h) = ANY (ARRAY[0, 4])`),
	check("tables_x_check", sql`(x >= (0)::numeric) AND (x <= (1)::numeric)`),
	check("tables_y_check", sql`(y >= (0)::numeric) AND (y <= (1)::numeric)`),
	check("tables_w_check", sql`(w > (0)::numeric) AND (w <= (1)::numeric)`),
	check("tables_h_check", sql`(h > (0)::numeric) AND (h <= (1)::numeric)`),
	check("tables_shape_check", sql`shape = ANY (ARRAY['round'::text, 'square'::text, 'rect'::text, 'bar'::text])`),
	check("tables_rotation_check", sql`(rotation >= (0)::numeric) AND (rotation < (360)::numeric)`),
	check("tables_seats_check", sql`(seats >= 0) AND (seats <= 20)`),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: citext("email").notNull(),
	passwordHash: text("password_hash").notNull(),
	passwordAlgo: text("password_algo").default('argon2id').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
	pgPolicy("users_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((id = ( SELECT private.current_user_id() AS current_user_id)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = users.id) AND (p.restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))))))` }),
]);

export const authSessions = pgTable("auth_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	refreshHash: text("refresh_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_auth_sessions_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "auth_sessions_user_id_fkey"
		}).onDelete("cascade"),
	unique("auth_sessions_refresh_hash_key").on(table.refreshHash),
	pgPolicy("auth_sessions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(user_id = ( SELECT private.current_user_id() AS current_user_id))` }),
]);

export const printerTokens = pgTable("printer_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	name: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "printer_tokens_restaurant_id_fkey"
		}).onDelete("cascade"),
	unique("printer_tokens_token_hash_key").on(table.tokenHash),
	pgPolicy("printer_tokens_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("printer_tokens_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("printer_tokens_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("printer_tokens_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)`),
]);

export const printJobs = pgTable("print_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	kind: text().notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	printedAt: timestamp("printed_at", { withTimezone: true, mode: 'string' }),
	printerTokenId: uuid("printer_token_id"),
}, (table) => [
	index("print_jobs_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("print_jobs_pending_idx").using("btree", table.restaurantId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(printed_at IS NULL)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "print_jobs_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.printerTokenId],
			foreignColumns: [printerTokens.id],
			name: "print_jobs_printer_token_id_fkey"
		}).onDelete("set null"),
	pgPolicy("print_jobs_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("print_jobs_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	check("print_jobs_kind_check", sql`kind = ANY (ARRAY['invoice'::text, 'command'::text])`),
]);

export const zones = pgTable("zones", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	name: text().notNull(),
	aspect: numeric().default('1.6').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	labels: jsonb().default([]).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("zones_restaurant_id_name_key").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), sql`lower(name)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "zones_restaurant_id_fkey"
		}),
	unique("zones_restaurant_id_id_key").on(table.restaurantId, table.id),
	pgPolicy("zones_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("zones_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("zones_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("zones_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("zones_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40)`),
	check("zones_aspect_check", sql`(aspect > 0.25) AND (aspect < (4)::numeric)`),
	// Array of at most 12 {text, side: top|right|bottom|left}; full expression in 0012_floor_plan.sql.
	check("zones_labels_check", sql`jsonb_typeof(labels) = 'array'::text`),
]);

export const subcategories = pgTable("subcategories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	categoryId: uuid("category_id").notNull(),
	name: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("subcategories_category_id_name_key").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops"), sql`lower(name)`),
	index("idx_subcategories_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "subcategories_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.categoryId],
			foreignColumns: [categories.restaurantId, categories.id],
			name: "subcategories_category_id_fkey"
		}).onDelete("restrict"),
	unique("subcategories_restaurant_id_category_id_id_key").on(table.restaurantId, table.categoryId, table.id),
	pgPolicy("subcategories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("subcategories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("subcategories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("subcategories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("subcategories_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40)`),
]);

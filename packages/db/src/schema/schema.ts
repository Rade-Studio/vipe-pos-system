import { pgTable, index, foreignKey, unique, pgPolicy, uuid, varchar, text, timestamp, uniqueIndex, numeric, check, boolean, bigint, integer, date, jsonb, smallint, primaryKey } from "drizzle-orm/pg-core"
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
	check("business_config_waiter_access_mode", sql`((key)::text <> 'waiter_access_mode'::text) OR (value = ANY (ARRAY['own_accounts'::text, 'shared_terminal'::text]))`),
	check("business_config_allow_self_authorization", sql`((key)::text <> 'allow_self_authorization'::text) OR (value = ANY (ARRAY['true'::text, 'false'::text]))`),
	check("business_config_business_day_cutoff_hour", sql`((key)::text <> 'business_day_cutoff_hour'::text) OR (value = ANY (ARRAY['0'::text, '1'::text, '2'::text, '3'::text, '4'::text, '5'::text, '6'::text]))`),
	check("business_config_tax_type", sql`((key)::text <> 'tax_type'::text) OR (value = ANY (ARRAY['INC'::text, 'IVA'::text]))`),
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
	openedBy: uuid("opened_by").default(sql`private.current_profile_id()`),
	countedCash: numeric("counted_cash", { precision: 10, scale:  2 }),
	cashDifference: numeric("cash_difference", { precision: 10, scale:  2 }),
	closeNote: text("close_note"),
	denominations: jsonb(),
	closedBy: uuid("closed_by"),
	validatedBy: uuid("validated_by"),
	validatedAt: timestamp("validated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_cash_registers_closed_by").using("btree", table.closedBy.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_registers_validated_by").using("btree", table.validatedBy.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_registers_opened_by").using("btree", table.openedBy.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_registers_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("one_open_register_per_restaurant").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")).where(sql`((status)::text = 'open'::text)`),
	foreignKey({
			columns: [table.restaurantId, table.openedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "cash_registers_opened_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.closedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "cash_registers_closed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.validatedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "cash_registers_validated_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "cash_registers_restaurant_id_fkey"
		}),
	pgPolicy("cash_registers_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("cash_registers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("cash_registers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("cash_registers_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("cash_registers_counted_cash_check", sql`(counted_cash >= (0)::numeric) AND (counted_cash = trunc(counted_cash))`),
	check("cash_registers_count_pair_check", sql`(counted_cash IS NULL) = (cash_difference IS NULL)`),
	check("cash_registers_close_note_check", sql`(char_length(close_note) >= 3) AND (char_length(close_note) <= 300)`),
	check("cash_registers_count_note_check", sql`(cash_difference = (0)::numeric) OR (close_note IS NOT NULL)`),
	check("cash_registers_denominations_check", sql`jsonb_typeof(denominations) = 'array'::text`),
	check("cash_registers_validated_closed_check", sql`(validated_at IS NULL) OR ((status)::text = 'closed'::text)`),
]);

export const zReports = pgTable("z_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	number: integer().notNull(),
	businessDay: date("business_day", { mode: 'string' }).notNull(),
	snapshot: jsonb().notNull(),
	emittedBy: uuid("emitted_by").default(sql`private.current_profile_id()`),
	emittedAt: timestamp("emitted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_z_reports_emitted_by").using("btree", table.emittedBy.asc().nullsLast().op("uuid_ops")),
	unique("z_reports_restaurant_id_number_key").on(table.restaurantId, table.number),
	unique("z_reports_restaurant_id_business_day_key").on(table.restaurantId, table.businessDay),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "z_reports_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.emittedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "z_reports_emitted_by_fkey"
		}).onDelete("set null"),
	pgPolicy("z_reports_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("z_reports_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	check("z_reports_number_check", sql`number >= 1`),
	check("z_reports_snapshot_check", sql`jsonb_typeof(snapshot) = 'object'::text`),
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
	reason: varchar({ length: 20 }),
	createdBy: uuid("created_by").default(sql`private.current_profile_id()`),
}, (table) => [
	index("idx_cash_transactions_cash_register_id").using("btree", table.cashRegisterId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_transactions_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_transactions_created_by").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("idx_cash_transactions_timestamp").using("btree", table.timestamp.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.restaurantId, table.createdBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "cash_transactions_created_by_fkey"
		}).onDelete("set null"),
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
	check("cash_transactions_reason_check", sql`(reason)::text = ANY (ARRAY['change_fund'::text, 'supplier'::text, 'petty_cash'::text, 'tips_payout'::text, 'safe_deposit'::text, 'other'::text])`),
	check("cash_transactions_other_description_check", sql`((reason)::text IS DISTINCT FROM 'other'::text) OR (btrim(COALESCE(description, ''::text)) <> ''::text)`),
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
	// Default station of the category's dishes; FK (restaurant_id, station_id) -> stations (0020).
	stationId: uuid("station_id"),
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
	pgPolicy("couriers_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: sql`((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`  }),
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
	sortOrder: integer("sort_order").default(0).notNull(),
	// Station exception (NULL = same as the category); FK (restaurant_id, station_id) -> stations (0020).
	stationId: uuid("station_id"),
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
	index("idx_dishes_menu_order").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.categoryId.asc().nullsLast().op("uuid_ops"), table.subcategoryId.asc().nullsLast().op("uuid_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	// Same-restaurant key of dish_modifier_groups (0023).
	unique("dishes_restaurant_id_id_key").on(table.restaurantId, table.id),
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
	// Same-restaurant key of modifier_options.ingredient_id (0023).
	unique("ingredients_restaurant_id_id_key").on(table.restaurantId, table.id),
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
	prepaidMethodId: uuid("prepaid_method_id"),
	courierEta: timestamp("courier_eta", { withTimezone: true, mode: 'string' }),
	courierLocation: text("courier_location"),
	returnedAt: timestamp("returned_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_order_deliveries_prepaid_method_id").using("btree", table.prepaidMethodId.asc().nullsLast().op("uuid_ops")),
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
	foreignKey({
			columns: [table.restaurantId, table.prepaidMethodId],
			foreignColumns: [paymentMethods.restaurantId, paymentMethods.id],
			name: "order_deliveries_prepaid_method_id_fkey"
		}).onDelete("restrict"),
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
	check("order_deliveries_prepaid_method_check", sql`(prepaid_method_id IS NULL) OR (payment_mode = 'prepaid'::text)`),
	check("order_deliveries_courier_location_check", sql`(length(btrim(courier_location)) >= 1) AND (length(btrim(courier_location)) <= 60)`),
	check("order_deliveries_returned_at_check", sql`(returned_at IS NULL) OR ((dispatched_at IS NOT NULL) AND (returned_at >= dispatched_at))`),
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
	createdByProfileId: uuid("created_by_profile_id"),
	// Set once by the order_items_route_station trigger (0020): dish -> category -> default station.
	stationId: uuid("station_id"),
	stationSource: text("station_source"),
	// 0025: the automatic promotion the line qualified for when sent, its rule then, and the shared id of a combo's lines.
	promotionId: uuid("promotion_id"),
	promotionSnapshot: jsonb("promotion_snapshot"),
	comboId: uuid("combo_id"),
}, (table) => [
	index("idx_order_items_promotion_id").using("btree", table.promotionId.asc().nullsLast().op("uuid_ops")).where(sql`(promotion_id IS NOT NULL)`),
	index("idx_order_items_combo_id").using("btree", table.comboId.asc().nullsLast().op("uuid_ops")).where(sql`(combo_id IS NOT NULL)`),
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
	foreignKey({
			columns: [table.restaurantId, table.createdByProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_items_created_by_profile_fkey"
		}).onDelete("set null"),
	// ON DELETE SET NULL (promotion_id) in SQL: only promotion_id is cleared.
	foreignKey({
			columns: [table.restaurantId, table.promotionId],
			foreignColumns: [promotions.restaurantId, promotions.id],
			name: "order_items_promotion_id_fkey"
		}).onDelete("set null"),
	pgPolicy("order_items_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_items_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("order_items_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("order_items_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	unique("order_items_restaurant_id_id_key").on(table.restaurantId, table.id),
	check("order_items_quantity_check", sql`quantity >= 0`),
	check("order_items_cancelled_quantity_check", sql`((status)::text = 'cancelled'::text) = (quantity = 0)`),
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
	orderNumber: integer("order_number").notNull(),
	guests: smallint(),
	notes: text(),
	createdByProfileId: uuid("created_by_profile_id"),
	customerName: text("customer_name"),
	customerPhone: text("customer_phone"),
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
	foreignKey({
			columns: [table.restaurantId, table.createdByProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "orders_created_by_profile_fkey"
		}).onDelete("set null"),
	pgPolicy("orders_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("orders_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("orders_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("orders_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("orders_order_type_check", sql`order_type = ANY (ARRAY['dine_in'::text, 'takeaway'::text, 'delivery'::text])`),
	check("orders_customer_name_check", sql`(customer_name IS NULL) OR ((customer_name = btrim(customer_name)) AND ((char_length(customer_name) >= 2) AND (char_length(customer_name) <= 60)))`),
	check("orders_customer_phone_check", sql`(customer_phone IS NULL) OR (customer_phone ~ '^[0-9]{7,15}$'::text)`),
	check("orders_takeaway_customer_check", sql`CASE WHEN (order_type = 'takeaway'::text) THEN (customer_name IS NOT NULL) ELSE ((customer_name IS NULL) AND (customer_phone IS NULL)) END`),
	check("orders_order_type_table_id_check", sql`(order_type = 'dine_in'::text) OR (table_id IS NULL)`),
	unique("orders_restaurant_id_order_number_key").on(table.restaurantId, table.orderNumber),
	check("orders_order_number_check", sql`order_number >= 1`),
	check("orders_guests_check", sql`(guests >= 1) AND (guests <= 99)`),
	check("orders_notes_check", sql`(length(btrim(notes)) >= 1) AND (length(btrim(notes)) <= 300)`),
	check("orders_status_check", sql`status = ANY (ARRAY['active'::text, 'kitchen'::text, 'delivered'::text, 'cancelled'::text, 'paid'::text])`),
	unique("orders_restaurant_id_id_key").on(table.restaurantId, table.id),
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
	reference: text(),
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
	check("payment_tenders_amount_check", sql`(amount > 0) OR ((amount = 0) AND (line_no = 1) AND (method_kind = 'cash'::text) AND (cash_received = 0))`),
	check("payment_tenders_cash_received_check", sql`((method_kind = 'cash'::text) AND (cash_received IS NOT NULL) AND (cash_received >= amount)) OR ((method_kind = 'electronic'::text) AND (cash_received IS NULL))`),
	check("payment_tenders_line_no_check", sql`line_no >= 1`),
	check("payment_tenders_method_kind_check", sql`method_kind = ANY (ARRAY['cash'::text, 'electronic'::text])`),
	check("payment_tenders_reference_check", sql`(length(btrim(reference)) >= 1) AND (length(btrim(reference)) <= 60)`),
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
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_payments_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("payments_order_id_live_key").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where(sql`(voided_at IS NULL)`),
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
	unique("payments_restaurant_id_id_key").on(table.restaurantId, table.id),
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
	producedOn: date("produced_on").default(sql`CURRENT_DATE`).notNull(),
	producedBy: uuid("produced_by"),
}, (table) => [
	index("idx_production_batches_restaurant_id_produced_on").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.producedOn.desc().nullsFirst().op("date_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.producedBy],
			foreignColumns: [profiles.id],
			name: "production_batches_produced_by_fkey"
		}).onDelete("set null"),
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

export const productionTemplates = pgTable("production_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.default_restaurant_id()`).notNull(),
	name: text().notNull(),
	lines: jsonb().default([]).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("production_templates_restaurant_id_name_key").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), sql`regexp_replace(lower(btrim(name)), '\\s+'::text, ' '::text, 'g'::text)`),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "production_templates_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "production_templates_restaurant_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	pgPolicy("production_templates_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("production_templates_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("production_templates_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	pgPolicy("production_templates_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"] }),
	check("production_templates_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80)`),
	check("production_templates_lines_check", sql`jsonb_typeof(lines) = 'array'::text`),
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
	// Required for product_discount and bill_discount, NULL otherwise (promotions_discount_check, 0025).
	discountType: varchar("discount_type", { length: 20 }),
	discountValue: numeric("discount_value", { precision: 10, scale:  2 }),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	// NULL = no end (0025).
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	active: boolean().default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	kind: varchar({ length: 20 }).default('product_discount').notNull(),
	mode: varchar({ length: 20 }).default('automatic').notNull(),
	buyQuantity: integer("buy_quantity"),
	payQuantity: integer("pay_quantity"),
	restDiscountPercent: integer("rest_discount_percent"),
	comboPrice: numeric("combo_price", { precision: 10, scale:  2 }),
	minSubtotal: numeric("min_subtotal", { precision: 10, scale:  2 }),
	maxDiscount: numeric("max_discount", { precision: 10, scale:  2 }),
	// ISO 1 = Monday .. 7 = Sunday; {} = every day.
	daysOfWeek: smallint("days_of_week").array().default(sql`'{}'::smallint[]`).notNull(),
	// [{ from: "HH:MM", to: "HH:MM" }] with from < to; [] = all day.
	timeWindows: jsonb("time_windows").default(sql`'[]'::jsonb`).notNull(),
	// dine_in, takeaway, delivery; {} = every channel.
	channels: text().array().default(sql`'{}'::text[]`).notNull(),
	maxUsesPerOrder: integer("max_uses_per_order"),
}, (table) => [
	unique("promotions_restaurant_id_id_key").on(table.restaurantId, table.id),
	index("idx_promotions_kind").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.kind.asc().nullsLast().op("text_ops")),
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
	check("promotions_kind_check", sql`(kind)::text = ANY (ARRAY['product_discount'::text, 'buy_x_pay_y'::text, 'combo'::text, 'bill_discount'::text])`),
	check("promotions_mode_check", sql`(mode)::text = ANY (ARRAY['automatic'::text, 'manual'::text, 'manual_pin'::text])`),
	check("promotions_discount_check", sql`CASE WHEN ((kind)::text = ANY (ARRAY['product_discount'::text, 'bill_discount'::text])) THEN ((discount_type IS NOT NULL) AND (discount_value IS NOT NULL) AND (discount_value >= (0)::numeric)) ELSE ((discount_type IS NULL) AND (discount_value IS NULL)) END`),
	check("promotions_buy_x_pay_y_check", sql`CASE WHEN ((kind)::text = 'buy_x_pay_y'::text) THEN COALESCE(((buy_quantity >= 2) AND (pay_quantity >= 1) AND (pay_quantity < buy_quantity) AND ((rest_discount_percent >= 1) AND (rest_discount_percent <= 100))), false) ELSE ((buy_quantity IS NULL) AND (pay_quantity IS NULL) AND (rest_discount_percent IS NULL)) END`),
	check("promotions_combo_check", sql`CASE WHEN ((kind)::text = 'combo'::text) THEN COALESCE((combo_price > (0)::numeric), false) ELSE (combo_price IS NULL) END`),
	check("promotions_bill_discount_check", sql`(((kind)::text = 'bill_discount'::text) OR ((min_subtotal IS NULL) AND (max_discount IS NULL))) AND ((min_subtotal IS NULL) OR (min_subtotal >= (0)::numeric)) AND ((max_discount IS NULL) OR (max_discount > (0)::numeric))`),
	check("promotions_days_of_week_check", sql`(days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]) AND (array_position(days_of_week, NULL::smallint) IS NULL)`),
	check("promotions_time_windows_check", sql`private.promotion_time_windows_valid(time_windows)`),
	check("promotions_channels_check", sql`(channels <@ ARRAY['dine_in'::text, 'takeaway'::text, 'delivery'::text]) AND (array_position(channels, NULL::text) IS NULL)`),
	check("promotions_max_uses_per_order_check", sql`(max_uses_per_order IS NULL) OR (max_uses_per_order > 0)`),
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
	// No new order on an inactive table: trigger orders_table_active (23514, 0015).
	isActive: boolean("is_active").default(true).notNull(),
	// Set exactly when status = 'reserved' (tables_reservation_check, 0022).
	reservationName: text("reservation_name"),
	reservationArrivalAt: timestamp("reservation_arrival_at", { withTimezone: true, mode: 'string' }),
	reservedBy: uuid("reserved_by"),
	reservedAt: timestamp("reserved_at", { withTimezone: true, mode: 'string' }),
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
	foreignKey({
			columns: [table.reservedBy],
			foreignColumns: [profiles.id],
			name: "tables_reserved_by_fkey"
		}).onDelete("set null"),
	check("tables_reservation_name_check", sql`(length(btrim(reservation_name)) >= 1) AND (length(btrim(reservation_name)) <= 80)`),
	check("tables_reservation_check", sql`(status::text = 'reserved'::text) = (reservation_name IS NOT NULL)`),
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
	kind: text().default('user').notNull(),
	parentSessionId: uuid("parent_session_id"),
}, (table) => [
	index("idx_auth_sessions_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_auth_sessions_parent_session_id").using("btree", table.parentSessionId.asc().nullsLast().op("uuid_ops")).where(sql`(parent_session_id IS NOT NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "auth_sessions_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentSessionId],
			foreignColumns: [table.id],
			name: "auth_sessions_parent_session_id_fkey"
		}).onDelete("cascade"),
	unique("auth_sessions_refresh_hash_key").on(table.refreshHash),
	pgPolicy("auth_sessions_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(user_id = ( SELECT private.current_user_id() AS current_user_id))` }),
	check("auth_sessions_kind_check", sql`kind = ANY (ARRAY['user'::text, 'terminal'::text, 'acting'::text])`),
	check("auth_sessions_acting_parent", sql`(kind = 'acting'::text) = (parent_session_id IS NOT NULL)`),
]);

export const staffPins = pgTable("staff_pins", {
	profileId: uuid("profile_id").primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	pinHash: text("pin_hash").notNull(),
	pinPepperVersion: smallint("pin_pepper_version").default(1).notNull(),
	setBy: uuid("set_by"),
	setAt: timestamp("set_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_staff_pins_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "staff_pins_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.profileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "staff_pins_profile_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.setBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "staff_pins_set_by_fkey"
		}).onDelete("set null"),
	pgPolicy("staff_pins_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("staff_pins_pin_hash_argon2id", sql`pin_hash ~ '^\\$argon2id\\$v=19\\$m=[0-9]+,[pt]=[0-9]+,[pt]=[0-9]+\\$[A-Za-z0-9+/]{16,}\\$[A-Za-z0-9+/]{32,}$'::text`),
	check("staff_pins_pepper_version", sql`pin_pepper_version = ANY (ARRAY[1, 2])`),
]);

export const supervisorAuthorizations = pgTable("supervisor_authorizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	action: text().notNull(),
	supervisorProfileId: uuid("supervisor_profile_id"),
	requestedByProfileId: uuid("requested_by_profile_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_supervisor_authorizations_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "supervisor_authorizations_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.supervisorProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "supervisor_authorizations_supervisor_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.requestedByProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "supervisor_authorizations_requested_by_fkey"
		}).onDelete("set null"),
	pgPolicy("supervisor_authorizations_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("supervisor_authorizations_action_format", sql`action ~ '^[a-z][a-z_]{0,39}$'::text`),
	check("supervisor_authorizations_window", sql`(expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval))`),
	check("supervisor_authorizations_consumed_after", sql`(consumed_at IS NULL) OR (consumed_at >= created_at)`),
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
	// Comanda station or Caja for a factura; NULL without stations (0020).
	stationId: uuid("station_id"),
}, (table) => [
	index("print_jobs_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("print_jobs_restaurant_created_idx").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("uuid_ops")),
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
	widthM: numeric("width_m"),
	depthM: numeric("depth_m"),
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
	check("zones_dimensions_check", sql`(width_m IS NULL) = (depth_m IS NULL)`),
	check("zones_width_m_check", sql`(width_m > (0)::numeric) AND (width_m <= (200)::numeric)`),
	check("zones_depth_m_check", sql`(depth_m > (0)::numeric) AND (depth_m <= (200)::numeric)`),
]);

/** Published menu structure (0015): insert-only history, the latest row wins; written by public.publish_menu(). */
export const menuPublications = pgTable("menu_publications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	publishedBy: uuid("published_by"),
	snapshot: jsonb().notNull(),
}, (table) => [
	index("idx_menu_publications_latest").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.publishedAt.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "menu_publications_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.publishedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "menu_publications_published_by_fkey"
		}).onDelete("set null"),
	pgPolicy("menu_publications_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("menu_publications_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	check("menu_publications_snapshot_check", sql`jsonb_typeof(snapshot) = 'object'::text`),
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
	unique("subcategories_restaurant_id_id_key").on(table.restaurantId, table.id),
	pgPolicy("subcategories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("subcategories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("subcategories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	pgPolicy("subcategories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("subcategories_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40)`),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	eventType: text("event_type").notNull(),
	orderId: uuid("order_id").notNull(),
	paymentId: uuid("payment_id"),
	actorProfileId: uuid("actor_profile_id"),
	actorName: text("actor_name").notNull(),
	authorizedByProfileId: uuid("authorized_by_profile_id"),
	authorizedByName: text("authorized_by_name"),
	authorizationId: uuid("authorization_id"),
	selfAuthorized: boolean("self_authorized").default(false).notNull(),
	reasonCode: text("reason_code").notNull(),
	reasonText: text("reason_text"),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("audit_log_authorization_id_key").using("btree", table.authorizationId.asc().nullsLast().op("uuid_ops")).where(sql`(authorization_id IS NOT NULL)`),
	index("idx_audit_log_restaurant_id_created_at").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_audit_log_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "audit_log_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.orderId],
			foreignColumns: [orders.restaurantId, orders.id],
			name: "audit_log_order_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.paymentId],
			foreignColumns: [payments.restaurantId, payments.id],
			name: "audit_log_payment_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.actorProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "audit_log_actor_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.authorizedByProfileId],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "audit_log_authorizer_fkey"
		}).onDelete("set null"),
	pgPolicy("audit_log_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("audit_log_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("audit_log_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("audit_log_event_type_check", sql`event_type = ANY (ARRAY['order_cancelled'::text, 'items_voided'::text, 'payment_voided'::text])`),
	check("audit_log_amount_check", sql`amount >= (0)::numeric`),
	check("audit_log_reason_code_check", sql`reason_code = ANY (ARRAY['waiter_error'::text, 'customer_left'::text, 'dish_returned'::text, 'duplicate_charge'::text, 'wrong_payment_method'::text, 'other'::text])`),
	check("audit_log_reason_text_check", sql`(reason_text IS NULL) OR ((length(btrim(reason_text)) >= 3) AND (length(btrim(reason_text)) <= 200))`),
	check("audit_log_other_reason_check", sql`(reason_code <> 'other'::text) OR (reason_text IS NOT NULL)`),
	check("audit_log_payment_check", sql`(event_type = 'payment_voided'::text) = (payment_id IS NOT NULL)`),
	check("audit_log_authorizer_check", sql`(authorization_id IS NULL) = (authorized_by_name IS NULL)`),
	check("audit_log_self_check", sql`(NOT self_authorized) OR (authorization_id IS NOT NULL)`),
	check("audit_log_self_match_check", sql`(authorized_by_profile_id IS NULL) OR (actor_profile_id IS NULL) OR (self_authorized = (authorized_by_profile_id = actor_profile_id))`),
	check("audit_log_details_check", sql`jsonb_typeof(details) = 'object'::text`),
]);

export const orderCancellations = pgTable("order_cancellations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	orderId: uuid("order_id").notNull(),
	auditId: uuid("audit_id").notNull(),
	previousStatus: text("previous_status").notNull(),
	reasonCode: text("reason_code").notNull(),
	reasonText: text("reason_text"),
	cancelledBy: uuid("cancelled_by"),
	cancelledByName: text("cancelled_by_name").notNull(),
	authorizedBy: uuid("authorized_by"),
	authorizedByName: text("authorized_by_name"),
	authorizationId: uuid("authorization_id"),
	selfAuthorized: boolean("self_authorized").default(false).notNull(),
	subtotal: numeric({ precision: 10, scale:  2 }).notNull(),
	tax: numeric({ precision: 10, scale:  2 }).notNull(),
	tip: numeric({ precision: 10, scale:  2 }).notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	items: jsonb().notNull(),
	sentItems: integer("sent_items").notNull(),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_order_cancellations_restaurant_id_cancelled_at").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.cancelledAt.asc().nullsLast().op("timestamptz_ops")),
	unique("order_cancellations_order_id_key").on(table.orderId),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "order_cancellations_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.auditId],
			foreignColumns: [auditLog.id],
			name: "order_cancellations_audit_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.orderId],
			foreignColumns: [orders.restaurantId, orders.id],
			name: "order_cancellations_order_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.cancelledBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_cancellations_cancelled_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.authorizedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_cancellations_authorized_by_fkey"
		}).onDelete("set null"),
	pgPolicy("order_cancellations_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_cancellations_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_cancellations_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("order_cancellations_previous_status_check", sql`previous_status = ANY (ARRAY['active'::text, 'kitchen'::text, 'delivered'::text])`),
	check("order_cancellations_sent_items_check", sql`sent_items >= 0`),
	check("order_cancellations_reason_code_check", sql`reason_code = ANY (ARRAY['waiter_error'::text, 'customer_left'::text, 'dish_returned'::text, 'duplicate_charge'::text, 'wrong_payment_method'::text, 'other'::text])`),
	check("order_cancellations_reason_text_check", sql`(reason_text IS NULL) OR ((length(btrim(reason_text)) >= 3) AND (length(btrim(reason_text)) <= 200))`),
	check("order_cancellations_other_reason_check", sql`(reason_code <> 'other'::text) OR (reason_text IS NOT NULL)`),
	check("order_cancellations_amounts_check", sql`(subtotal >= (0)::numeric) AND (tax >= (0)::numeric) AND (tip >= (0)::numeric) AND (total >= (0)::numeric)`),
	check("order_cancellations_items_check", sql`jsonb_typeof(items) = 'array'::text`),
	check("order_cancellations_authorizer_check", sql`(authorization_id IS NULL) = (authorized_by_name IS NULL)`),
	check("order_cancellations_self_check", sql`(NOT self_authorized) OR (authorization_id IS NOT NULL)`),
	check("order_cancellations_self_match_check", sql`(authorized_by IS NULL) OR (cancelled_by IS NULL) OR (self_authorized = (authorized_by = cancelled_by))`),
]);

export const orderItemVoids = pgTable("order_item_voids", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	orderId: uuid("order_id").notNull(),
	orderItemId: uuid("order_item_id").notNull(),
	auditId: uuid("audit_id").notNull(),
	dishId: uuid("dish_id"),
	itemName: text("item_name").notNull(),
	quantity: integer().notNull(),
	remainingQuantity: integer("remaining_quantity").notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	sentToKitchen: boolean("sent_to_kitchen").notNull(),
	stockConsumed: boolean("stock_consumed").notNull(),
	reasonCode: text("reason_code").notNull(),
	reasonText: text("reason_text"),
	voidedBy: uuid("voided_by"),
	voidedByName: text("voided_by_name").notNull(),
	authorizedBy: uuid("authorized_by"),
	authorizedByName: text("authorized_by_name"),
	authorizationId: uuid("authorization_id"),
	selfAuthorized: boolean("self_authorized").default(false).notNull(),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_order_item_voids_restaurant_id_voided_at").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.voidedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_order_item_voids_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "order_item_voids_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.auditId],
			foreignColumns: [auditLog.id],
			name: "order_item_voids_audit_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.orderId],
			foreignColumns: [orders.restaurantId, orders.id],
			name: "order_item_voids_order_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.orderItemId],
			foreignColumns: [orderItems.restaurantId, orderItems.id],
			name: "order_item_voids_item_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.voidedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_item_voids_voided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.authorizedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_item_voids_authorized_by_fkey"
		}).onDelete("set null"),
	pgPolicy("order_item_voids_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_item_voids_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("order_item_voids_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("order_item_voids_quantity_check", sql`quantity >= 1`),
	check("order_item_voids_remaining_check", sql`remaining_quantity >= 0`),
	check("order_item_voids_unit_price_check", sql`unit_price >= (0)::numeric`),
	check("order_item_voids_amount_check", sql`amount >= (0)::numeric`),
	check("order_item_voids_reason_code_check", sql`reason_code = ANY (ARRAY['waiter_error'::text, 'customer_left'::text, 'dish_returned'::text, 'duplicate_charge'::text, 'wrong_payment_method'::text, 'other'::text])`),
	check("order_item_voids_reason_text_check", sql`(reason_text IS NULL) OR ((length(btrim(reason_text)) >= 3) AND (length(btrim(reason_text)) <= 200))`),
	check("order_item_voids_other_reason_check", sql`(reason_code <> 'other'::text) OR (reason_text IS NOT NULL)`),
	check("order_item_voids_authorizer_check", sql`(authorization_id IS NULL) = (authorized_by_name IS NULL)`),
	check("order_item_voids_sent_check", sql`(NOT sent_to_kitchen) OR (authorization_id IS NOT NULL)`),
	check("order_item_voids_self_check", sql`(NOT self_authorized) OR (authorization_id IS NOT NULL)`),
	check("order_item_voids_self_match_check", sql`(authorized_by IS NULL) OR (voided_by IS NULL) OR (self_authorized = (authorized_by = voided_by))`),
]);

export const paymentVoids = pgTable("payment_voids", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	paymentId: uuid("payment_id").notNull(),
	orderId: uuid("order_id").notNull(),
	cashRegisterId: uuid("cash_register_id").notNull(),
	auditId: uuid("audit_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amountDue: bigint("amount_due", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tipAmount: bigint("tip_amount", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalCharged: bigint("total_charged", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	changeGiven: bigint("change_given", { mode: "number" }).notNull(),
	methods: text().notNull(),
	tenders: jsonb().notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }).notNull(),
	reasonCode: text("reason_code").notNull(),
	reasonText: text("reason_text"),
	voidedBy: uuid("voided_by"),
	voidedByName: text("voided_by_name").notNull(),
	authorizedBy: uuid("authorized_by"),
	authorizedByName: text("authorized_by_name").notNull(),
	authorizationId: uuid("authorization_id").notNull(),
	selfAuthorized: boolean("self_authorized").default(false).notNull(),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_payment_voids_restaurant_id_voided_at").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), table.voidedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_payment_voids_cash_register_id").using("btree", table.cashRegisterId.asc().nullsLast().op("uuid_ops")),
	unique("payment_voids_payment_id_key").on(table.paymentId),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "payment_voids_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.auditId],
			foreignColumns: [auditLog.id],
			name: "payment_voids_audit_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.paymentId],
			foreignColumns: [payments.restaurantId, payments.id],
			name: "payment_voids_payment_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.orderId],
			foreignColumns: [orders.restaurantId, orders.id],
			name: "payment_voids_order_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.voidedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "payment_voids_voided_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.authorizedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "payment_voids_authorized_by_fkey"
		}).onDelete("set null"),
	pgPolicy("payment_voids_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("payment_voids_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("payment_voids_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	check("payment_voids_amounts_check", sql`(amount_due >= 0) AND (tip_amount >= 0) AND (change_given >= 0) AND (total_charged = (amount_due + tip_amount))`),
	check("payment_voids_tenders_check", sql`(jsonb_typeof(tenders) = 'array'::text) AND (jsonb_array_length(tenders) >= 1)`),
	check("payment_voids_reason_code_check", sql`reason_code = ANY (ARRAY['waiter_error'::text, 'customer_left'::text, 'dish_returned'::text, 'duplicate_charge'::text, 'wrong_payment_method'::text, 'other'::text])`),
	check("payment_voids_reason_text_check", sql`(reason_text IS NULL) OR ((length(btrim(reason_text)) >= 3) AND (length(btrim(reason_text)) <= 200))`),
	check("payment_voids_other_reason_check", sql`(reason_code <> 'other'::text) OR (reason_text IS NOT NULL)`),
	check("payment_voids_self_match_check", sql`(authorized_by IS NULL) OR (voided_by IS NULL) OR (self_authorized = (authorized_by = voided_by))`),
]);

/** Preparation stations and the one cashier station (Caja) of a restaurant (0020, F6). Deleted only through public.delete_station. */
export const stations = pgTable("stations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	name: text().notNull(),
	kind: text().default('prep').notNull(),
	color: text().default('kitchen').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("stations_restaurant_id_name_key").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), sql`lower(name)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "stations_restaurant_id_fkey"
		}),
	unique("stations_restaurant_id_id_key").on(table.restaurantId, table.id),
	pgPolicy("stations_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))` }),
	pgPolicy("stations_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"] }),
	pgPolicy("stations_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("stations_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 40)`),
	check("stations_kind_check", sql`kind = ANY (ARRAY['prep'::text, 'cashier'::text])`),
	check("stations_color_check", sql`color = ANY (ARRAY['kitchen'::text, 'served'::text, 'occupied'::text, 'free'::text, 'reserved'::text])`),
	check("stations_default_prep_check", sql`(NOT is_default) OR (kind = 'prep'::text)`),
]);

/** Paired VIPE desktop apps (0021, F5a). token_hash (sha256 of the vdt_ token) is not readable by vipe_api. */
export const desktopDevices = pgTable("desktop_devices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	name: text().notNull(),
	platform: text().default('windows').notNull(),
	appVersion: text("app_version").notNull(),
	tokenHash: text("token_hash").notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	queuePending: integer("queue_pending").default(0).notNull(),
	queueFailed: integer("queue_failed").default(0).notNull(),
	printerStatus: jsonb("printer_status").default([]).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "desktop_devices_restaurant_id_fkey"
		}).onDelete("cascade"),
	unique("desktop_devices_token_hash_key").on(table.tokenHash),
	unique("desktop_devices_restaurant_id_id_key").on(table.restaurantId, table.id),
	pgPolicy("desktop_devices_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))` }),
	pgPolicy("desktop_devices_update_policy", { as: "permissive", for: "update", to: ["vipe_api"] }),
	check("desktop_devices_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)`),
	check("desktop_devices_platform_check", sql`platform = 'windows'::text`),
]);

/** Single-use 6-digit pairing codes (sha256 only), valid 10 minutes (0021). No grant to vipe_api. */
export const desktopPairingCodes = pgTable("desktop_pairing_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	codeHash: text("code_hash").notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '00:10:00'::interval)`).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	deviceId: uuid("device_id"),
}, (table) => [
	uniqueIndex("desktop_pairing_codes_live_key").using("btree", table.codeHash.asc().nullsLast().op("text_ops")).where(sql`(claimed_at IS NULL)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "desktop_pairing_codes_restaurant_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [desktopDevices.id],
			name: "desktop_pairing_codes_device_id_fkey"
		}).onDelete("set null"),
]);

/** Printers of a desktop device; id is the app's local id (0021). Written by private.desktop_put_printers. */
export const desktopPrinters = pgTable("desktop_printers", {
	deviceId: uuid("device_id").notNull(),
	id: text().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	name: text().notNull(),
	model: text().default('').notNull(),
	connection: text().notNull(),
	paperMm: integer("paper_mm").notNull(),
	hasDrawer: boolean("has_drawer").default(false).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.deviceId, table.id], name: "desktop_printers_pkey" }),
	foreignKey({
			columns: [table.restaurantId, table.deviceId],
			foreignColumns: [desktopDevices.restaurantId, desktopDevices.id],
			name: "desktop_printers_device_fkey"
		}).onDelete("cascade"),
	pgPolicy("desktop_printers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	check("desktop_printers_connection_check", sql`connection = ANY (ARRAY['usb'::text, 'network'::text, 'bluetooth'::text])`),
	check("desktop_printers_paper_mm_check", sql`paper_mm = ANY (ARRAY[58, 80])`),
]);

/** Stations a desktop printer serves (0021). */
export const desktopPrinterStations = pgTable("desktop_printer_stations", {
	deviceId: uuid("device_id").notNull(),
	printerId: text("printer_id").notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	stationId: uuid("station_id").notNull(),
}, (table) => [
	primaryKey({ columns: [table.deviceId, table.printerId, table.stationId], name: "desktop_printer_stations_pkey" }),
	foreignKey({
			columns: [table.deviceId, table.printerId],
			foreignColumns: [desktopPrinters.deviceId, desktopPrinters.id],
			name: "desktop_printer_stations_printer_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.stationId],
			foreignColumns: [stations.restaurantId, stations.id],
			name: "desktop_printer_stations_station_fkey"
		}).onDelete("cascade"),
	pgPolicy("desktop_printer_stations_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
]);

/** Per-device acknowledgement of a print job; the first wins (0021). Reached only through private.desktop_ack_job. */
export const desktopJobAcks = pgTable("desktop_job_acks", {
	jobId: uuid("job_id").notNull(),
	deviceId: uuid("device_id").notNull(),
	status: text().notNull(),
	reason: text(),
	ackedAt: timestamp("acked_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("desktop_job_acks_device_job_idx").using("btree", table.deviceId.asc().nullsLast().op("uuid_ops"), table.jobId.asc().nullsLast().op("uuid_ops")),
	primaryKey({ columns: [table.jobId, table.deviceId], name: "desktop_job_acks_pkey" }),
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [printJobs.id],
			name: "desktop_job_acks_job_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [desktopDevices.id],
			name: "desktop_job_acks_device_id_fkey"
		}).onDelete("cascade"),
	check("desktop_job_acks_status_check", sql`status = ANY (ARRAY['printed'::text, 'skipped'::text, 'cancelled'::text])`),
]);

/** Cash drawer openings reported by a desktop device (0021, L10). */
export const desktopDrawerEvents = pgTable("desktop_drawer_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	deviceId: uuid("device_id").notNull(),
	printerId: text("printer_id").notNull(),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'string' }).notNull(),
	reason: text().notNull(),
	profileId: uuid("profile_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId, table.deviceId],
			foreignColumns: [desktopDevices.restaurantId, desktopDevices.id],
			name: "desktop_drawer_events_device_fkey"
		}).onDelete("cascade"),
	pgPolicy("desktop_drawer_events_select_policy", { as: "permissive", for: "select", to: ["vipe_api"] }),
	check("desktop_drawer_events_reason_check", sql`reason = ANY (ARRAY['manual'::text, 'cash_payment'::text])`),
]);

/** Signed desktop builds per channel and target; global, written by the publishing script (0021). */
export const desktopReleases = pgTable("desktop_releases", {
	channel: text().notNull(),
	target: text().notNull(),
	version: text().notNull(),
	file: text().notNull(),
	signature: text().notNull(),
	notes: text().default('').notNull(),
	pubDate: timestamp("pub_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	required: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.channel, table.target, table.version], name: "desktop_releases_pkey" }),
	pgPolicy("desktop_releases_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: sql`true` }),
	check("desktop_releases_channel_check", sql`channel = ANY (ARRAY['stable'::text, 'pilot'::text])`),
]);

const ADMIN_TENANT = sql`((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))`;
const TENANT = sql`(restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))`;

/** Reusable modifier groups (0023, F7): required exactly when min_select >= 1; max_select NULL = no limit. Staff read, admin writes. */
export const modifierGroups = pgTable("modifier_groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	name: text().notNull(),
	required: boolean().default(false).notNull(),
	minSelect: integer("min_select").default(0).notNull(),
	maxSelect: integer("max_select"),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("modifier_groups_restaurant_id_id_key").on(table.restaurantId, table.id),
	uniqueIndex("modifier_groups_restaurant_id_name_key").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops"), sql`lower(name)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "modifier_groups_restaurant_id_fkey"
		}),
	pgPolicy("modifier_groups_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("modifier_groups_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: ADMIN_TENANT }),
	pgPolicy("modifier_groups_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: ADMIN_TENANT, withCheck: ADMIN_TENANT }),
	pgPolicy("modifier_groups_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: ADMIN_TENANT }),
	check("modifier_groups_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60) AND (name = btrim(name))`),
	check("modifier_groups_select_check", sql`(min_select >= 0) AND (min_select <= 50) AND ((max_select IS NULL) OR ((max_select >= 1) AND (max_select <= 50) AND (max_select >= min_select))) AND (required = (min_select >= 1))`),
]);

/** Options of a modifier group (0023): price added to the line; optional ingredient_qty of ingredient_id per unit. */
export const modifierOptions = pgTable("modifier_options", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	groupId: uuid("group_id").notNull(),
	name: text().notNull(),
	price: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	ingredientId: uuid("ingredient_id"),
	ingredientQty: numeric("ingredient_qty", { precision: 14, scale:  3 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("modifier_options_group_id_name_key").using("btree", table.groupId.asc().nullsLast().op("uuid_ops"), sql`lower(name)`),
	index("idx_modifier_options_ingredient_id").using("btree", table.ingredientId.asc().nullsLast().op("uuid_ops")).where(sql`(ingredient_id IS NOT NULL)`),
	foreignKey({
			columns: [table.restaurantId, table.groupId],
			foreignColumns: [modifierGroups.restaurantId, modifierGroups.id],
			name: "modifier_options_group_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.ingredientId],
			foreignColumns: [ingredients.restaurantId, ingredients.id],
			name: "modifier_options_ingredient_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("modifier_options_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("modifier_options_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: ADMIN_TENANT }),
	pgPolicy("modifier_options_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: ADMIN_TENANT, withCheck: ADMIN_TENANT }),
	pgPolicy("modifier_options_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: ADMIN_TENANT }),
	check("modifier_options_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60) AND (name = btrim(name))`),
	check("modifier_options_price_check", sql`price >= (0)::numeric`),
	check("modifier_options_ingredient_check", sql`((ingredient_id IS NULL) = (ingredient_qty IS NULL)) AND ((ingredient_qty IS NULL) OR (ingredient_qty > (0)::numeric))`),
]);

/** Groups a dish offers, in sort_order (0023). */
export const dishModifierGroups = pgTable("dish_modifier_groups", {
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	dishId: uuid("dish_id").notNull(),
	groupId: uuid("group_id").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	primaryKey({ columns: [table.dishId, table.groupId], name: "dish_modifier_groups_pkey" }),
	index("idx_dish_modifier_groups_group_id").using("btree", table.groupId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId, table.dishId],
			foreignColumns: [dishes.restaurantId, dishes.id],
			name: "dish_modifier_groups_dish_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.groupId],
			foreignColumns: [modifierGroups.restaurantId, modifierGroups.id],
			name: "dish_modifier_groups_group_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("dish_modifier_groups_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("dish_modifier_groups_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: ADMIN_TENANT }),
	pgPolicy("dish_modifier_groups_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: ADMIN_TENANT, withCheck: ADMIN_TENANT }),
	pgPolicy("dish_modifier_groups_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: ADMIN_TENANT }),
]);

/** Snapshot of the options chosen on an order line (0023); vipe_api only reads (written by SECURITY DEFINER functions). */
export const orderItemModifiers = pgTable("order_item_modifiers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").notNull(),
	orderItemId: uuid("order_item_id").notNull(),
	groupId: uuid("group_id").notNull(),
	groupName: text("group_name").notNull(),
	optionId: uuid("option_id").notNull(),
	optionName: text("option_name").notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	ingredientId: uuid("ingredient_id"),
	ingredientQty: numeric("ingredient_qty", { precision: 14, scale:  3 }),
	sortOrder: integer("sort_order").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("order_item_modifiers_order_item_id_option_id_key").on(table.orderItemId, table.optionId),
	index("idx_order_item_modifiers_order_item_id").using("btree", table.orderItemId.asc().nullsLast().op("uuid_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.restaurantId, table.orderItemId],
			foreignColumns: [orderItems.restaurantId, orderItems.id],
			name: "order_item_modifiers_item_fkey"
		}).onDelete("cascade"),
	pgPolicy("order_item_modifiers_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	check("order_item_modifiers_price_check", sql`price >= (0)::numeric`),
	check("order_item_modifiers_ingredient_check", sql`((ingredient_id IS NULL) = (ingredient_qty IS NULL)) AND ((ingredient_qty IS NULL) OR (ingredient_qty > (0)::numeric))`),
]);

/** Categories a product_discount or buy_x_pay_y promotion targets (0025). */
export const promotionCategories = pgTable("promotion_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	promotionId: uuid("promotion_id").notNull(),
	categoryId: uuid("category_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_promotion_categories_category_id").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_promotion_categories_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotion_categories_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.promotionId],
			foreignColumns: [promotions.restaurantId, promotions.id],
			name: "promotion_categories_promotion_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.categoryId],
			foreignColumns: [categories.restaurantId, categories.id],
			name: "promotion_categories_category_id_fkey"
		}).onDelete("cascade"),
	unique("promotion_categories_promotion_id_category_id_key").on(table.promotionId, table.categoryId),
	pgPolicy("promotion_categories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("promotion_categories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: TENANT }),
	pgPolicy("promotion_categories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: TENANT, withCheck: TENANT }),
	pgPolicy("promotion_categories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: TENANT }),
]);

/** Subcategories a product_discount or buy_x_pay_y promotion targets (0025). */
export const promotionSubcategories = pgTable("promotion_subcategories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	promotionId: uuid("promotion_id").notNull(),
	subcategoryId: uuid("subcategory_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_promotion_subcategories_subcategory_id").using("btree", table.subcategoryId.asc().nullsLast().op("uuid_ops")),
	index("idx_promotion_subcategories_restaurant_id").using("btree", table.restaurantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotion_subcategories_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.promotionId],
			foreignColumns: [promotions.restaurantId, promotions.id],
			name: "promotion_subcategories_promotion_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.subcategoryId],
			foreignColumns: [subcategories.restaurantId, subcategories.id],
			name: "promotion_subcategories_subcategory_id_fkey"
		}).onDelete("cascade"),
	unique("promotion_subcategories_promotion_id_subcategory_id_key").on(table.promotionId, table.subcategoryId),
	pgPolicy("promotion_subcategories_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("promotion_subcategories_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: TENANT }),
	pgPolicy("promotion_subcategories_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: TENANT, withCheck: TENANT }),
	pgPolicy("promotion_subcategories_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: TENANT }),
]);

/** Groups of a combo promotion in position order; one option of each is picked (0025). */
export const promotionComboGroups = pgTable("promotion_combo_groups", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	promotionId: uuid("promotion_id").notNull(),
	name: text().notNull(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_promotion_combo_groups_promotion_id").using("btree", table.promotionId.asc().nullsLast().op("uuid_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotion_combo_groups_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.promotionId],
			foreignColumns: [promotions.restaurantId, promotions.id],
			name: "promotion_combo_groups_promotion_id_fkey"
		}).onDelete("cascade"),
	unique("promotion_combo_groups_restaurant_id_id_key").on(table.restaurantId, table.id),
	pgPolicy("promotion_combo_groups_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("promotion_combo_groups_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: TENANT }),
	pgPolicy("promotion_combo_groups_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: TENANT, withCheck: TENANT }),
	pgPolicy("promotion_combo_groups_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: TENANT }),
	check("promotion_combo_groups_name_check", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)`),
	check("promotion_combo_groups_position_check", sql`"position" >= 0`),
]);

/** Dishes the customer can pick in one combo group (0025). */
export const promotionComboOptions = pgTable("promotion_combo_options", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	groupId: uuid("group_id").notNull(),
	dishId: uuid("dish_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_promotion_combo_options_dish_id").using("btree", table.dishId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "promotion_combo_options_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.groupId],
			foreignColumns: [promotionComboGroups.restaurantId, promotionComboGroups.id],
			name: "promotion_combo_options_group_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.dishId],
			foreignColumns: [dishes.restaurantId, dishes.id],
			name: "promotion_combo_options_dish_id_fkey"
		}).onDelete("cascade"),
	unique("promotion_combo_options_group_id_dish_id_key").on(table.groupId, table.dishId),
	pgPolicy("promotion_combo_options_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("promotion_combo_options_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: TENANT }),
	pgPolicy("promotion_combo_options_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: TENANT, withCheck: TENANT }),
	pgPolicy("promotion_combo_options_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: TENANT }),
]);

/**
 * One discount of an order (0025, S2): on a line or on the bill, from a promotion or manual.
 * orders.total_discounts and the net orders.subtotal come from private.order_bill_base().
 * The promotion, created_by and authorized_by foreign keys are ON DELETE SET NULL (column) in SQL.
 */
export const orderDiscounts = pgTable("order_discounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	restaurantId: uuid("restaurant_id").default(sql`private.current_restaurant_id()`).notNull(),
	orderId: uuid("order_id").notNull(),
	orderItemId: uuid("order_item_id"),
	promotionId: uuid("promotion_id"),
	kind: text().notNull(),
	source: text().notNull(),
	label: text().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	comboId: uuid("combo_id"),
	reason: text(),
	createdBy: uuid("created_by"),
	authorizedBy: uuid("authorized_by"),
	requiresAuthorization: boolean("requires_authorization").default(true).notNull(),
	lineQuantity: integer("line_quantity"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_order_discounts_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("idx_order_discounts_order_item_id").using("btree", table.orderItemId.asc().nullsLast().op("uuid_ops")).where(sql`(order_item_id IS NOT NULL)`),
	index("idx_order_discounts_promotion_id").using("btree", table.promotionId.asc().nullsLast().op("uuid_ops")).where(sql`(promotion_id IS NOT NULL)`),
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "order_discounts_restaurant_id_fkey"
		}),
	foreignKey({
			columns: [table.restaurantId, table.orderId],
			foreignColumns: [orders.restaurantId, orders.id],
			name: "order_discounts_order_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.orderItemId],
			foreignColumns: [orderItems.restaurantId, orderItems.id],
			name: "order_discounts_item_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.restaurantId, table.promotionId],
			foreignColumns: [promotions.restaurantId, promotions.id],
			name: "order_discounts_promotion_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.createdBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_discounts_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.restaurantId, table.authorizedBy],
			foreignColumns: [profiles.restaurantId, profiles.id],
			name: "order_discounts_authorized_by_fkey"
		}).onDelete("set null"),
	pgPolicy("order_discounts_select_policy", { as: "permissive", for: "select", to: ["vipe_api"], using: TENANT }),
	pgPolicy("order_discounts_insert_policy", { as: "permissive", for: "insert", to: ["vipe_api"], withCheck: TENANT }),
	pgPolicy("order_discounts_update_policy", { as: "permissive", for: "update", to: ["vipe_api"], using: TENANT, withCheck: TENANT }),
	pgPolicy("order_discounts_delete_policy", { as: "permissive", for: "delete", to: ["vipe_api"], using: TENANT }),
	check("order_discounts_kind_check", sql`kind = ANY (ARRAY['promotion_item'::text, 'promotion_bill'::text, 'combo'::text, 'manual_item'::text, 'manual_bill'::text])`),
	check("order_discounts_source_check", sql`source = ANY (ARRAY['automatic'::text, 'manual'::text])`),
	check("order_discounts_kind_source_check", sql`((kind <> ALL (ARRAY['manual_item'::text, 'manual_bill'::text])) OR (source = 'manual'::text)) AND ((kind <> 'combo'::text) OR (source = 'automatic'::text))`),
	check("order_discounts_item_check", sql`CASE kind WHEN 'promotion_item'::text THEN (order_item_id IS NOT NULL) WHEN 'manual_item'::text THEN (order_item_id IS NOT NULL) WHEN 'combo'::text THEN (combo_id IS NOT NULL) ELSE (order_item_id IS NULL) END`),
	check("order_discounts_label_check", sql`(length(btrim(label)) >= 1) AND (length(btrim(label)) <= 255)`),
	check("order_discounts_amount_check", sql`(amount > (0)::numeric) AND (amount = trunc(amount))`),
	check("order_discounts_line_quantity_check", sql`(line_quantity IS NULL) OR (line_quantity > 0)`),
	check("order_discounts_reason_check", sql`CASE WHEN (source = 'manual'::text) THEN ((reason IS NOT NULL) AND ((length(btrim(reason)) >= 3) AND (length(btrim(reason)) <= 200))) ELSE (reason IS NULL) END`),
]);

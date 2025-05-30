import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import type { Order, CartItem, OrderByStatusWithAllData } from '@/types'; // Asume estos tipos
import { BaseRepository } from './baseRepository';
import { TableRepository } from './tableRepository';

export class OrderRepository extends BaseRepository<Order> {
    private tableRepository: TableRepository;

    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'orders');
        this.tableRepository = new TableRepository(supabase);
    }

    /**
     * Crea una nueva orden y sus items asociados.
     * @param orderData Los datos de la orden a crear.
     * @returns Una promesa que resuelve a la orden creada o null si no se pudo crear.
     */
    async createOrder(orderData: {

    }): Promise<Order> {
        try {
            // Primero creamos la orden
            const { data: order, error: orderError } = await this.supabase
                .from(this.tableName)
                .insert({
                    table_id: orderData.table_id,
                    waiter_id: orderData.waiter_id,
                    subtotal: orderData.subtotal,
                    tax: orderData.tax,
                    tax_percentage: orderData.tax_percentage,
                    tip: orderData.tip,
                    tip_percentage: orderData.tip_percentage,
                    total: orderData.total,
                    status: "active",
                    is_partial_order: orderData.is_partial_order || false,
                    parent_order_id: orderData.parent_order_id || null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (orderError) {
                this.handleError(orderError, "Error creating order:");
            }

            if (!order) {
                throw new Error("Could not get the ID of the created order.");
            }

            console.log("Order created with ID:", order.id);

            // Luego creamos los items de la orden
            const orderItems = orderData.items.map((item) => ({
                order_id: order.id,
                dish_id: item.id.includes("-") ? null : item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                comments: item.comments || null,
                status: "kitchen", // Estado inicial de los items: "kitchen"
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }));

            const { error: itemsError } = await this.supabase
                .from("order_items")
                .insert(orderItems);

            if (itemsError) {
                console.error("Error creating order items, attempting to delete order:", itemsError);
                // Intentar eliminar la orden si hubo un error al crear los items
                await this.supabase.from("orders").delete().eq("id", order.id);
                throw itemsError;
            }

            // Actualizar el estado de la mesa a "kitchen"
            try {
                await this.tableRepository.updateTableStatus(orderData.table_id, "kitchen");
            } catch (error) {
                console.error("Error updating table status after order creation:", error);
            }

            return order;
        } catch (error) {
            this.handleError(error, "Error in createOrder:");
        }
    }

    /**
     * Crea una orden parcial a partir de una orden existente.
     * @param parentOrderId El ID de la orden original.
     * @param items Los items seleccionados para la orden parcial.
     * @param bill La factura calculada para la orden parcial.
     * @returns Una promesa que resuelve a la orden parcial creada.
     */
    async createPartialOrder(parentOrderId: string, items: CartItem[], bill: any): Promise<Order> {
        try {
            const { data: parentOrder, error: parentError } = await this.supabase
                .from(this.tableName)
                .select("*")
                .eq("id", parentOrderId)
                .single();

            if (parentError || !parentOrder) {
                this.handleError(parentError, "Error fetching parent order:");
            }

            const { data: partialOrder, error: partialOrderError } = await this.supabase
                .from(this.tableName)
                .insert({
                    table_id: parentOrder!.table_id,
                    waiter_id: parentOrder!.waiter_id,
                    subtotal: bill.subtotal,
                    tax: bill.tax,
                    tax_percentage: bill.taxPercentage,
                    tip: bill.tip,
                    tip_percentage: bill.tipPercentage,
                    total: bill.total,
                    status: "active",
                    is_partial_order: true,
                    parent_order_id: parentOrderId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (partialOrderError || !partialOrder) {
                this.handleError(partialOrderError, "Error creating partial order:");
            }

            const orderItems = items.map((item) => ({
                order_id: partialOrder.id,
                dish_id: item.id.includes("-") ? null : item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                comments: item.comments || null,
                status: "kitchen",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }));

            const { error: itemsError } = await this.supabase
                .from("order_items")
                .insert(orderItems);
            if (itemsError) throw itemsError;

            const { data: originalItems, error: originalItemsError } = await this.supabase
                .from("order_items")
                .select("*")
                .eq("order_id", parentOrderId);

            if (originalItemsError) throw originalItemsError;
            if (!originalItems) throw new Error("Could not find items of the original order.");

            for (const partialItem of items) {
                const originalItem = originalItems.find(
                    (item) =>
                        item.name === partialItem.name &&
                        ((item.comments === null && partialItem.comments === undefined) ||
                            item.comments === partialItem.comments)
                );

                if (originalItem) {
                    if (originalItem.quantity === partialItem.quantity) {
                        const { error: deleteError } = await this.supabase
                            .from("order_items")
                            .delete()
                            .eq("id", originalItem.id);
                        if (deleteError) throw deleteError;
                    } else {
                        const { error: updateError } = await this.supabase
                            .from("order_items")
                            .update({ quantity: originalItem.quantity - partialItem.quantity })
                            .eq("id", originalItem.id);

                        if (updateError) throw updateError;
                    }
                }
            }

            await this.recalculateOrderTotals(parentOrderId);

            return partialOrder;
        } catch (error) {
            this.handleError(error, "Error in createPartialOrder:");
        }
    }

    /**
     * Elimina una orden parcial y devuelve sus items a la orden original.
     * @param orderId El ID de la orden parcial a eliminar.
     * @returns Una promesa que resuelve cuando la operación se completa.
     * @throws Error si la orden no es parcial o no tiene una orden padre.
     */
    async deletePartialOrder(orderId: string): Promise<void> {
        try {
            const { data: order, error: orderError } = await this.supabase
                .from(this.tableName)
                .select("*")
                .eq("id", orderId)
                .eq("is_partial_order", true)
                .single();

            if (orderError) {
                this.handleError(orderError, "Error verifying partial order:");
            }

            if (!order) {
                throw new Error("The order is not a partial order or does not exist.");
            }
            if (!order.parent_order_id) {
                throw new Error("The partial order has no parent order.");
            }

            const { data: partialOrderWithItems, error: partialError } = await this.supabase
                .from(this.tableName)
                .select("*, order_items(*)")
                .eq("id", orderId)
                .single();

            if (partialError || !partialOrderWithItems) {
                this.handleError(partialError, "Partial order not found for deletion.");
            }

            const { data: parentOrderWithItems, error: parentError } = await this.supabase
                .from(this.tableName)
                .select("*, order_items(*)")
                .eq("id", partialOrderWithItems!.parent_order_id!)
                .single();

            if (parentError || !parentOrderWithItems) {
                this.handleError(parentError, "Parent order not found for partial order deletion.");
            }

            for (const partialItem of partialOrderWithItems!.order_items) {
                const parentItem = parentOrderWithItems!.order_items.find(
                    (item: any) =>
                        item.name === partialItem.name &&
                        (item.comments || "") === (partialItem.comments || "")
                );

                if (parentItem) {
                    const { error: updateError } = await this.supabase
                        .from("order_items")
                        .update({ quantity: parentItem.quantity + partialItem.quantity })
                        .eq("id", parentItem.id);

                    if (updateError) throw updateError;
                } else {
                    const { error: insertError } = await this.supabase
                        .from("order_items")
                        .insert({
                            order_id: parentOrderWithItems!.id,
                            dish_id: partialItem.dish_id,
                            name: partialItem.name,
                            price: partialItem.price,
                            quantity: partialItem.quantity,
                            comments: partialItem.comments,
                            status: "kitchen",
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                        });

                    if (insertError) throw insertError;
                }
            }

            await this.recalculateOrderTotals(parentOrderWithItems!.id);

            const { error: itemsError } = await this.supabase
                .from("order_items")
                .delete()
                .eq("order_id", orderId);

            if (itemsError) {
                this.handleError(itemsError, "Error deleting partial order items:");
            }

            const { error: orderDeleteError } = await this.supabase
                .from(this.tableName)
                .delete()
                .eq("id", orderId);

            if (orderDeleteError) {
                this.handleError(orderDeleteError, "Error deleting partial order:");
            }
        } catch (error) {
            this.handleError(error, "Error in deletePartialOrder:");
        }
    }

    /**
     * Obtiene todas las órdenes con sus items.
     * @returns Una promesa que resuelve a un array de órdenes.
     */
    async getAllWithItems(): Promise<Order[]> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(`*, order_items (*)`)
                .order("created_at", { ascending: false });

            if (error) {
                this.handleError(error, "Error fetching orders with items:");
            }

            return data as Order[] || [];
        } catch (error) {
            this.handleError(error, "Error in getAllWithItems of orders:");
        }
    }

    /**
     * Obtiene órdenes por el ID de la mesa con sus items.
     * @param tableId El ID de la mesa.
     * @returns Una promesa que resuelve a un array de órdenes de la mesa.
     */
    async getByTableWithItems(tableId: string): Promise<Order[]> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(`*, order_items (*)`)
                .eq("table_id", tableId)
                .order("created_at", { ascending: false });

            if (error) {
                this.handleError(error, "Error fetching orders by table with items:");
            }

            return data as Order[] || [];
        } catch (error) {
            this.handleError(error, "Error in getByTableWithItems of orders:");
        }
    }

    async getByStatusWithAllData(statuses: string | string[]): Promise<OrderByStatusWithAllData[]> {
        const statusArray = Array.isArray(statuses) ? statuses : [statuses];

        const { data, error } = await this.supabase
            .from(this.tableName)
            .select(`
          *,
          order_items(*),
          tables(number),
          profiles(full_name)
        `)
            .in("status", statusArray)
            .order("created_at", {ascending: false})

        if (error) {
            this.handleError(error, "Error obteniendo órdenes con todos los datos");
        }

        return data || [];
    }

    /**
     * Obtiene órdenes por su estado con sus items.
     * @param statuses Uno o más estados de orden.
     * @returns Una promesa que resuelve a un array de órdenes con los estados especificados.
     */
    async getByStatusWithItems(statuses: string | string[]): Promise<Order[]> {
        const statusArray = Array.isArray(statuses) ? statuses : [statuses];

        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(`*, order_items(*)`)
                .in("status", statusArray)
                .order("created_at", { ascending: false });

            if (error) {
                this.handleError(error, "Error fetching orders by status with items:");
            }

            return data as Order[] || [];
        } catch (error) {
            this.handleError(error, "Error in getByStatusWithItems of orders:");
        }
    }


    async getOrdersByDate(date: Date): Promise<OrderByStatusWithAllData[]> {
        // Crear fechas para el inicio y fin del día
        const startOfDay = new Date(date)
        startOfDay.setHours(0, 0, 0, 0)

        const endOfDay = new Date(date)
        endOfDay.setHours(23, 59, 59, 999)

        // Formatear fechas para la consulta
        const startDate = startOfDay.toISOString()
        const endDate = endOfDay.toISOString()

        try {

            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(`
          *,
          order_items(*),
          tables(number),
          profiles(full_name)
        `)
                .eq("status", "paid")
                .gte("created_at", startDate)
                .lte("created_at", endDate)

            if (error) {
                this.handleError(error, "Error obteniendo órdenes con todos los datos");
            }

            return data as OrderByStatusWithAllData[] || [];

        } catch (error) {
            throw error
        }
    }

    /**
     * Actualiza el estado de una orden.
     * @param orderId El ID de la orden.
     * @param status El nuevo estado de la orden.
     * @returns Una promesa que resuelve a la orden actualizada.
     */
    async updateOrderStatus(orderId: string, status: string): Promise<Order> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .update({
                    status,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", orderId)
                .select()
                .single();

            if (error) {
                this.handleError(error, "Error updating order status:");
            }

            const order = data;

            if (status === "delivered" && order?.table_id) {
                await this.tableRepository.updateTableStatus(order.table_id, "served");
            }

            if (status === "paid" && order?.table_id) {
                const { data: activeOrders, error: activeOrdersError } = await this.supabase
                    .from(this.tableName)
                    .select("id")
                    .eq("table_id", order.table_id)
                    .neq("id", orderId)
                    .neq("status", "paid");

                if (activeOrdersError) {
                    console.error("Error checking active orders:", activeOrdersError);
                } else if (!activeOrders || activeOrders.length === 0) {
                    console.log(
                        `No more active orders for table ${order.table_id}, releasing...`
                    );
                    await this.tableRepository.releaseTable(order.table_id);
                }
            }

            return order as Order;
        } catch (error) {
            this.handleError(error, "Error in updateOrderStatus:");
        }
    }

    /**
     * Marca una orden como pagada y genera un número de factura.
     * @param orderId El ID de la orden.
     * @param paymentMethod El método de pago.
     * @returns Una promesa que resuelve al número de factura generado.
     */
    async completePayment(orderId: string, paymentMethod: string): Promise<string> {
        try {
            const { data: order, error: orderUpdateError } = await this.supabase
                .from(this.tableName)
                .update({
                    status: "paid",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", orderId)
                .select()
                .single();

            if (orderUpdateError) {
                this.handleError(orderUpdateError, "Error completing order payment:");
            }

            const invoiceNumber = `INV-${Date.now()}`;

            if (order?.table_id) {
                const { data: activeOrders, error: activeOrdersError } = await this.supabase
                    .from(this.tableName)
                    .select("id")
                    .eq("table_id", order.table_id)
                    .neq("id", orderId)
                    .neq("status", "paid");

                if (activeOrdersError) {
                    console.error("Error checking active orders for table:", activeOrdersError);
                } else if (!activeOrders || activeOrders.length === 0) {
                    console.log(
                        `No more active orders for table ${order.table_id}, releasing...`
                    );
                    await this.tableRepository.releaseTable(order.table_id);
                }
            }

            return invoiceNumber;
        } catch (error) {
            this.handleError(error, "Error in completePayment of orders:");
        }
    }

    /**
     * Añade nuevos items a una orden existente.
     * @param orderId El ID de la orden a la que se añadirán los items.
     * @param items Los items a añadir.
     * @returns Una promesa que resuelve con los datos de los items insertados o un error.
     */
    async addItemsToOrder(orderId: string, items: any[]): Promise<any[]> {
        try {
            const { data, error } = await this.supabase
                .from("order_items")
                .insert(items)
                .select();

            if (error) throw error;
            return data;
        } catch (error) {
            this.handleError(error, "Error adding items to order:");
        }
    }

    /**
     * Recalcula los totales de una orden (subtotal, impuestos, propina, total)
     * basándose en sus items actuales.
     * @param orderId El ID de la orden a recalcular.
     */
    async recalculateOrderTotals(orderId: string): Promise<void> {
        try {
            const { data: items, error: itemsError } = await this.supabase
                .from("order_items")
                .select("*")
                .eq("order_id", orderId);

            if (itemsError) throw itemsError;

            const { data: order, error: orderError } = await this.supabase
                .from(this.tableName)
                .select("tax_percentage, tip_percentage")
                .eq("id", orderId)
                .single();

            if (orderError || !order) {
                this.handleError(orderError, "Order not found for recalculation.");
            }

            const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

            const taxPercentage = order!.tax_percentage || 8;
            const tipPercentage = order!.tip_percentage || 10;
            const tax = subtotal * (taxPercentage / 100);
            const tip = subtotal * (tipPercentage / 100);
            const total = subtotal + tax + tip;

            const { error: updateError } = await this.supabase
                .from(this.tableName)
                .update({
                    subtotal,
                    tax,
                    tip,
                    total,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", orderId);

            if (updateError) throw updateError;
        } catch (error) {
            this.handleError(error, "Error recalculating order totals:");
        }
    }

    /**
     * Obtiene órdenes pagadas dentro de un rango de fechas específico.
     * @param date La fecha para la cual se desean obtener las órdenes.
     * @returns Una promesa que resuelve a un array de órdenes pagadas.
     */
    async getPaidOrdersByDate(date: Date): Promise<Order[]> {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const startDate = startOfDay.toISOString();
        const endDate = endOfDay.toISOString();

        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(`*, order_items(*)`)
                .eq("status", "paid")
                .gte("created_at", startDate)
                .lte("created_at", endDate);

            if (error) {
                this.handleError(error, "Error fetching orders by date:");
            }

            return (data || []).map((order: any) => ({
                id: order.id,
                table_id: order.table_id,
                waiter_id: order.waiter_id,
                status: order.status,
                items: order.order_items || [],
                subtotal: order.subtotal || 0,
                tax: order.tax || 0,
                tax_percentage: order.tax_percentage || 0,
                tip: order.tip || 0,
                tip_percentage: order.tip_percentage || 0,
                total: order.total || 0,
                total_discounts: order.total_discounts || 0,
                created_at: new Date(order.created_at),
                updated_at: order.updated_at ? new Date(order.updated_at) : undefined,
                is_partial_order: order.is_partial_order || false,
                parent_order_id: order.parent_order_id || null,
            })) as unknown as Order[];
        } catch (error) {
            this.handleError(error, "Error fetching orders by date:");
        }
    }

    /**
     * Actualiza el estado de todos los items de una orden
     * @param orderId El ID de la orden.
     * @param status El nuevo estado de los items.
     */
    async updateOrderItemsStatus(orderId: string, status: string) {
        try {
            const { error } = await this.supabase
                .from("order_items")
                .update({ status: status, updated_at: new Date().toISOString() })
                .eq("order_id", orderId)

            if (error) {
                throw error;
            }

            return true;
        } catch (error) {
            throw error;
        }

    }

    /**
     * Actualiza el estado de todas las órdenes de una mesa
     * @param table_id El ID de la mesa.
     * @param orderId El ID de la orden.
     *
     * @returns La lista de órdenes actualizadas.
     * @throws Error si la mesa no existe.
     */
    async getByTable(table_id: string, orderId: string) : Promise<Order[] | null> {
        try {
            const { data, error } = await this.supabase
                .from("orders")
                .select("*")
                .eq("table_id", table_id)
                .neq("id", orderId)
                .neq("status", "paid")

            if (error) {
                this.handleError(error, "No se pudieron obtener órdenes de la mesa");
            }

            return data;

        } catch (error) {
            throw error;
        }

    }
}
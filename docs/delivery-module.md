# Módulo de domicilios

> Resumen para revisión. Migraciones: `20261007100000_delivery_schema.sql` (esquema) y
> `20261007110000_delivery_rpcs.sql` (RPCs). Plan y evidencia: `odd/tasks/domicilios.md`.

## Modelo de datos

| Tabla / columna | Descripción |
|-----------------|-------------|
| `couriers` | Repartidores por restaurante (`name`, `phone`, `is_active`). Sin login; se desactivan, no se borran (no hay política DELETE). |
| `customers` | Clientes por restaurante, `phone` solo dígitos (7–15) y `UNIQUE (restaurant_id, phone)`. |
| `customer_addresses` | Direcciones del cliente (`ON DELETE CASCADE`), a lo sumo una `is_default` por cliente. |
| `orders.order_type` | `dine_in` (por defecto) o `delivery`; un pedido `delivery` no puede tener `table_id`. |
| `order_deliveries` | Relación 1:1 con `orders`: instantánea del cliente y la dirección usada, `delivery_fee`, `payment_mode` (`prepaid` / `cash_on_delivery`), `cash_change_for` (solo contra entrega), `notes`, `courier_id`, `delivery_status`, `failure_reason` (obligatorio si `failed`) y marcas de tiempo. |

`orders.status` conserva su significado; el avance del domicilio vive en `order_deliveries.delivery_status`.
Los valores se manejan en pesos enteros (`bigint`).

## RPCs

Todas son `SECURITY DEFINER`, con el restaurante tomado del perfil de quien llama.

| RPC | Quién puede llamarla | Comportamiento |
|-----|----------------------|----------------|
| `create_delivery_order` | `admin`, `delivery_operator` (otro rol: 42501) | Crea de forma atómica cliente/dirección (si no existen), pedido (`order_type=delivery`, estado `kitchen`), ítems y `order_deliveries`. Los precios salen del menú en el servidor. Valida el valor del domicilio (≥ 0), el modo de pago y `cash_change_for`. |
| `set_delivery_status` | Según la acción (ver abajo) | Máquina de estados; repetir el estado actual lanza P0001. |
| `pay_order` | `cashier`, `admin`, `delivery_operator` | Para un pedido de domicilio, el monto a cobrar es `subtotal + impuesto + delivery_fee` (sin impuesto ni propina sobre el domicilio). Requiere una caja abierta. |
| `split_order` | — | Rechaza pedidos de domicilio. |
| `register_summary` | también `delivery_operator` | Lectura del resumen de caja. |

## Máquina de estados

| Acción | Desde | Hacia | Roles |
|--------|-------|-------|-------|
| `start_preparing` | `received` | `preparing` | kitchen, delivery_operator, admin |
| `mark_ready` | `received`, `preparing` | `ready` | kitchen, delivery_operator, admin |
| `dispatch` (repartidor activo del restaurante) | `ready`, `failed` | `out_for_delivery` | delivery_operator, admin |
| `deliver` | `out_for_delivery` | `delivered` | delivery_operator, admin |
| `fail` (motivo 1–200 caracteres) | `out_for_delivery` | `failed` | delivery_operator, admin |
| `cancel` | `received`, `preparing`, `ready`, `failed` | `cancelled` | delivery_operator, admin |

`cancel` bloquea el pedido y se rechaza (P0001) si ya existe un pago o el pedido está `paid`; también marca `orders.status = cancelled`. Un reenvío (`dispatch` desde `failed`) limpia `failure_reason`.

## Roles y permisos

- `delivery_operator`: toma pedidos, despacha, cierra, registra clientes y cobra con `pay_order`. No abre ni cierra cajas.
- `admin`: además administra repartidores (único rol con escritura en `couriers`) y el valor sugerido del domicilio (`business_config.delivery_default_fee`).
- `cashier`: lee, crea y edita clientes y direcciones, lee repartidores y cobra desde "Domicilios por cobrar".
- `kitchen`: lee `order_deliveries` (no clientes ni direcciones) y marca el pedido listo.
- `waiter`: sin acceso a las tablas de domicilios.
- `order_deliveries` no tiene política INSERT y un guard lanza 42501 ante UPDATE/DELETE de sesiones autenticadas: solo escriben las RPCs.

## Impresión

La comanda (`CommandPayload`) y la factura (`PrintableInvoice`) llevan un bloque opcional `delivery`:
`customerName`, `phone`, `address`, `paymentMode`, `deliveryFee`, y opcionalmente `notes` y `cashChangeFor` (solo contra entrega). Se construye desde la instantánea de `order_deliveries` (`lib/delivery/print.ts`).

- Comanda: `COMANDA — DOMICILIO`, `Cliente:` y notas.
- Factura: `CLIENTE`/`TEL`/`DIRECCION` en lugar de MESA/MESERO, línea `DOMICILIO` dentro del total sin propina y `CAMBIO PARA` si aplica.
- El renderizador TypeScript y `pos/print_renderer.py` tienen paridad; sin `delivery`, la salida es la de siempre. `handle_comanda` reenvía `data.get("delivery")` al renderizador (`pos/app.py`).

## Alta de cuentas de personal

Edge Function `create-staff-account` (`verify_jwt = true`):

1. Exige un JWT de un administrador activo (401 sin sesión, 403 en otro caso).
2. El restaurante sale siempre del perfil de quien llama; los roles permitidos son `waiter`, `kitchen`, `cashier` y `delivery_operator` (`admin` responde 400).
3. Crea el usuario **bloqueado** (`ban_duration`), aplica rol, restaurante y nombre al perfil creado por `handle_new_user`, lo lee de vuelta y solo entonces lo desbloquea.
4. Si un paso posterior falla, borra el usuario (si el borrado falla, queda bloqueado). Correo repetido → 409.

## Limitaciones conocidas

- "Entregado" no pide confirmación ni se puede deshacer; dos rechazos del servidor (ya pagado, no cobrable) se muestran sin traducir.
- El store de caja puede mostrar la caja cerrada tras iniciar sesión; `pay_order` responde con su propio mensaje.
- `create_delivery_order` toma los precios del menú sin promociones (hoy se aplican a nivel de pedido).
- Los PIN de perfil no se cargan desde la base de datos (preexistente para todos los roles).
- Edge Function: si la lectura del perfil de quien llama falla, responde 403 en lugar de 500; el borrado de reversión no informa su error.
- La comanda se emite por broadcast sin persistencia: si el listener está desconectado, no se reimprime.
- El valor sugerido del domicilio se edita en Configuración > Repartidores (`BusinessConfigForm` no está montado).
- Fuera de alcance: integración con WhatsApp (se apoyará en el registro de clientes) y zonas con tarifa propia.

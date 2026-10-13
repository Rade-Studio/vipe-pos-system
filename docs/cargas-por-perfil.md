# Cargas por perfil

Qué pide cada perfil al servidor y cuándo. Objetivo: cada pantalla pide solo lo que necesita y seleccionar una mesa, orden o domicilio nunca recarga ni vacía la pantalla.

## Reglas

1. **Arranque por rol.** `app/page.tsx` carga en paralelo solo lo que usa el rol que inicia sesión. Sin espera fija ni `initializeDefaultConfig` en tiempo de ejecución.
2. **Un solo `QueryClient`.** `ClientProviders` y `lib/queryClient` comparten la misma instancia; `setQueryData` e `invalidateQueries` llegan a la caché que leen las vistas.
3. **Tiempo real sin recargas.** Mesas, órdenes de mesero y cajero aplican los eventos de Supabase Realtime sobre la caché sin volver a consultar; cocina lee la orden una vez por ráfaga (regla 4). Mesas (`lib/realtime/table-merge.ts`) y domicilios (`lib/delivery/realtime.ts`) descartan filas con `updated_at` más antiguo. Excepción: el tablero de domicilios (`hooks/use-active-deliveries.ts`) fusiona los cambios de `order_deliveries` que puede; si no puede, o si cambia una orden de domicilio en `orders`, invalida su consulta una sola vez por ráfaga. Los cambios en órdenes de mesa no lo tocan.
4. **Ráfagas agrupadas.** Cocina lee una orden una sola vez por ráfaga (150 ms por orden); el tablero de domicilios se actualiza una vez por ráfaga (150 ms) y solo con cambios de domicilios.
5. **Ecos propios.** Los cambios hechos desde la misma pantalla no provocan una nueva lectura cuando vuelven por tiempo real.
6. **Refrescar no vacía.** Al refrescar se mantiene el contenido actual; los esqueletos solo aparecen en la primera carga.
7. **Lecturas compartidas.** Meseros, menú, tarifa sugerida de domicilio, listas de configuración y resúmenes de caja son consultas compartidas y en caché. La caja abierta se consulta con `loadOpenRegister` (1 petición).
8. **Selectores en la raíz.** `app/page.tsx` lee los stores de caja y configuración con selectores, así que una escritura ya no vuelve a renderizar toda la aplicación. Los componentes hijos todavía leen el store completo y se vuelven a renderizar solos ante cualquier cambio de ese store (pendiente).

## Antes y después

Conteos por acción, obtenidos de la lectura del código y de las pruebas de presupuesto de lecturas (no medidos en producción).

| Perfil | Acción | Antes | Después |
|---|---|---|---|
| Todos | Inicio de sesión | 19 peticiones en serie + 500 ms de espera | mesero 1, cocina 2, cajero 3, domicilios 1, admin 7 (en paralelo) |
| Todos | Abrir PIN de perfil | 9 | 0 |
| Todos | Eventos de autenticación | recarga el perfil en cada evento (incluido el refresco del token) | solo al cerrar sesión o si cambia el usuario (`lib/shell/auth-events.ts`) |
| Mesero | Elegir mesa | 42 + canales reconectados | 4 la primera vez, 0 después |
| Mesero | Cambiar de mesa | 1 + canales reconectados | 0 |
| Mesero | Cambiar de categoría | 39 | 4 la primera vez, 0 al volver |
| Mesero | Abrir selector de meseros | 1 | 0 |
| Cocina | Orden nueva con 5 ítems | 12 | 1 |
| Cocina | Marcar un ítem servido | 2 | 0 |
| Cocina | Marcar 5 ítems listos | 10 | 0 |
| Cocina | Refrescar | vacía el tablero y lo vuelve a llenar | sin vaciar |
| Cajero | Abrir Órdenes | 3 | 1 |
| Cajero | Abrir Transacciones | 5 | 2 |
| Cajero | Abrir pago | vuelve a leer la orden | 0 (usa la orden cargada) |
| Cajero | Refrescar tras pagar, dividir o deshacer | esqueletos en toda la pestaña | sin vaciar |
| Admin | Montaje con Dashboard cerrado | 13 | 0 |
| Admin | Montaje con Dashboard abierto | 13 en serie | 5 en paralelo |
| Admin | Actualizar | 4 | 1 |
| Admin | Volver a una pestaña de configuración | 4 | 0 |
| Domicilios | Cambio en una orden de mesa | recarga el tablero (y el panel del cajero) | 0 |
| Domicilios | Acción en una tarjeta | 3 recargas | 0 |
| Domicilios | Comprobar caja abierta | 3 | 1 (también al abrir la pestaña Domicilios del cajero, aunque `CashierView` ya cargó la caja) |
| Domicilios | Abrir "Nuevo domicilio" | formulario vacío hasta cargar la tarifa | inmediato (tarifa en caché) |

## Dónde mirar

| Perfil | Archivos |
|---|---|
| Arranque | `app/page.tsx`, `lib/shell/startup-loads.ts`, `lib/shell/auth-events.ts`, `components/ClientProviders.tsx`, `lib/queryClient.ts` |
| Mesero | `components/views/WaiterView.tsx`, `components/pos/MenuSection.tsx` |
| Cocina | `components/views/KitchenView.tsx`, `lib/supabase/realtime-service.ts` |
| Cajero | `components/views/CashierView.tsx`, `lib/cashier/orders.ts`, `components/cashier/PaymentMethodDialog.tsx` |
| Admin | `components/views/AdminView.tsx` |
| Domicilios | `hooks/use-active-deliveries.ts`, `lib/delivery/realtime.ts` |

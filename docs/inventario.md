# Inventario y fórmulas

Guía para el administrador. Todo está en el panel de administración, grupos **Catálogo** e **Inventario**.

## Conceptos

| Concepto | Qué es |
|----------|--------|
| **Artículo (SKU)** | Todo lo que se guarda en inventario. Cada uno tiene un código único: `MP-0001` para materia prima, `PR-0001` para preparaciones (se asigna solo; puedes cambiarlo). |
| **Materia prima** | Se compra a un proveedor (tomate, carne, gaseosa). |
| **Preparación** | Se produce en cocina a partir de otros artículos (salsa, pico de gallo). Tiene su propio stock. |
| **Bodega** | Lugar donde está el stock. Hay una **bodega predeterminada**: de ella descuentan las ventas. |
| **Lote** | Una entrada de stock con su costo y, si aplica, su **fecha de vencimiento**. Se consume primero lo que vence antes. Cada artículo tiene además un lote general por bodega. |
| **Movimiento** | Cada entrada o salida queda registrada (compra, venta, producción, ajuste, merma, traslado, conteo). El stock nunca se edita a mano: cambia solo con movimientos. |

## Fórmulas y sub-fórmulas

**Catálogo › Fórmulas**. Cada plato tiene una fórmula (qué lleva y cuánto). Cada preparación también tiene la suya y un **rendimiento** (por ejemplo, la fórmula produce 2 L de salsa).

- **Vender un plato** descuenta su fórmula. Si el plato lleva salsa, descuenta la salsa, no sus ingredientes.
- **Producir una preparación** (**Inventario › Producción**) descuenta la fórmula de la preparación y crea un lote con el costo calculado y su vencimiento.
- El costo, el margen y el precio sugerido se calculan mientras editas.

Atajos del editor:

| Acción | Cómo |
|--------|------|
| Buscar ingrediente | `/` y escribe |
| Agregar | `Enter` |
| Cantidad con unidad | Escribe `1,5 kg` aunque el artículo se mida en g: se convierte |
| Guardar | `Ctrl+S` |
| Cerrar o cancelar | `Esc` |
| Nueva sub-fórmula | Escribe un nombre que no existe y elige **Crear preparación «…»**. Al guardarla vuelves a la fórmula anterior con la preparación ya agregada. |

Desde **Menú**, el botón **Fórmula** de un plato lleva a esta sección.

## Compras

**Inventario › Compras**: sugerencia → borrador → enviar → recibir.

1. La **sugerencia** propone qué pedir según el stock mínimo y máximo.
2. El **borrador** se puede editar (proveedor, cantidades, costos).
3. **Enviar** marca la orden como pedida.
4. **Recibir** registra lo que llegó, con lote y vencimiento. Se puede recibir por partes. El costo del artículo se actualiza con el promedio ponderado.

## Conteos

**Inventario › Conteos**. Abre un conteo por bodega: por defecto es **a ciegas** (no muestra lo esperado mientras cuentas); el interruptor **Mostrar esperado** lo enseña si lo necesitas. Las líneas que no cuentes quedan sin cambios. Al **aplicar**, el stock queda igual a lo contado y la diferencia se registra como movimiento.

## Mermas y traslados

Desde **Inventario › Artículos**, en el detalle del artículo:

- **Merma**: lo que se dañó o se perdió, con motivo (vencido, dañado, derrame, preparación fallida u otro). Se registra desde la ficha del artículo en **Inventario › Artículos**.
- **Traslado**: mueve stock entre bodegas (sale primero lo que vence antes).

## Resumen de inventario

**Inventario › Resumen** muestra para el rango elegido: valor del inventario, artículos bajo mínimo, por vencer, consumo y mermas del período, órdenes de compra abiertas, entradas vs salidas, valor por categoría, más consumidos y una lista para **reponer ahora**.

## Control de inventario

**Configuración › Inventario › Control de inventario**.

- **Activo**: cada venta descuenta la fórmula de sus platos en la bodega predeterminada.
- **Inactivo**: las ventas no tocan el inventario.

## Si falta stock

- Antes de enviar un pedido, el sistema avisa qué falta.
- **La venta igual se registra.** El faltante deja negativo el lote general del artículo.
- Para corregirlo, haz un **conteo** de esa bodega (o registra la compra que faltaba).
- Producir una preparación sí se bloquea si faltan ingredientes, e indica cuáles.

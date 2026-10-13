import type { LucideIcon } from "lucide-react"
import {
  BarChart3,
  Bike,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  BellRing,
  Boxes,
  Building2,
  ChefHat,
  Cloud,
  FileSpreadsheet,
  Languages,
  Lock,
  MonitorSmartphone,
  Printer,
  QrCode,
  Receipt,
  ShieldCheck,
  ShieldPlus,
  Undo2,
  UtensilsCrossed,
  Wallet,
  WifiOff,
  Zap,
  CreditCard,
  Laptop,
} from "lucide-react"

// Every current feature on the landing page is verified in code (the delivery
// module is documented in docs/delivery-module.md); roadmap items are
// explicitly presented as upcoming work.

export type Pain = { before: string; after: string }

export const pains: Pain[] = [
  { before: "Comandas en papel que se pierden", after: "El pedido llega a cocina con un toque" },
  { before: "Refrescar la pantalla para ver si hay pedidos", after: "Todo se sincroniza en vivo entre dispositivos" },
  { before: "Cobrar dos veces por un doble clic", after: "Pagos atómicos e idempotentes en el servidor" },
  { before: "Cuadrar la caja a mano al cierre", after: "Cierre con desglose por método de pago" },
  { before: "Vender un plato que ya no se puede preparar", after: "Agotado automático según la receta" },
  { before: "Llevar el inventario en una libreta", after: "Descuento automático de ingredientes al pagar" },
  { before: "Imprimir tickets uno por uno", after: "Impresión automática en impresora térmica" },
  { before: "Domicilios anotados en un cuaderno", after: "El cliente se reconoce por su teléfono, con su dirección guardada" },
  { before: "No saber dónde va cada domicilio", after: "Tablero en vivo: de recibido a entregado, con tiempos" },
  { before: "Datos encerrados en el sistema", after: "Exportación a CSV para tu contador" },
]

export type FlowStep = {
  role: string
  title: string
  description: string
  icon: LucideIcon
  status: string
}

export const flow: FlowStep[] = [
  {
    role: "Mesero",
    title: "Toma el pedido en la mesa",
    description: "Mapa de mesas en vivo, menú con fotos y notas por producto: “sin cebolla”, “salsa aparte”.",
    icon: UtensilsCrossed,
    status: "Mesa 7 · 3 productos",
  },
  {
    role: "Cocina",
    title: "Aparece al instante en cocina",
    description: "Sin refrescar. Cada producto avanza de pendiente a en preparación a listo, y el ticket sale impreso solo.",
    icon: ChefHat,
    status: "En preparación",
  },
  {
    role: "Caja",
    title: "Se cobra sin errores",
    description: "Pago completo o dividido, en efectivo con cambio automático, transferencia, Nequi o Bancolombia.",
    icon: Wallet,
    status: "Pagado · Nequi",
  },
  {
    role: "Admin",
    title: "Y el negocio se actualiza solo",
    description: "Inventario descontado por receta, ventas en los reportes y la caja cuadrada sin libretas.",
    icon: BarChart3,
    status: "Reporte actualizado",
  },
]

export type Role = { name: string; tagline: string; icon: LucideIcon; features: string[]; accent: string }

export const roles: Role[] = [
  {
    name: "Mesero",
    tagline: "Toma de pedidos",
    icon: UtensilsCrossed,
    accent: "from-violet-500 to-indigo-500",
    features: [
      "Mapa visual de mesas con estado en vivo",
      "Menú digital por categorías con fotos",
      "Notas por producto en cada pedido",
      "Carrito flotante en el celular",
    ],
  },
  {
    name: "Cocina",
    tagline: "Gestión de comandas",
    icon: ChefHat,
    accent: "from-orange-500 to-rose-500",
    features: [
      "Cola de pedidos en tiempo real",
      "Estados: pendiente, en preparación, listo",
      "Ticket de cocina impreso automáticamente",
    ],
  },
  {
    name: "Cajero",
    tagline: "Cobro y caja",
    icon: Wallet,
    accent: "from-emerald-500 to-teal-500",
    features: [
      "Apertura y cierre de caja",
      "Pagos parciales y divididos",
      "Efectivo, transferencia, Nequi y Bancolombia",
      "Entradas y salidas de efectivo del turno",
    ],
  },
  {
    name: "Domicilios",
    tagline: "Pedidos a domicilio",
    icon: Bike,
    accent: "from-fuchsia-500 to-pink-500",
    features: [
      "Cliente reconocido por su número de teléfono",
      "Tablero en vivo por estado del domicilio",
      "Despacho con repartidor asignado",
      "Pago anticipado o contra entrega con cambio",
    ],
  },
  {
    name: "Administrador",
    tagline: "Control total del negocio",
    icon: BarChart3,
    accent: "from-sky-500 to-violet-500",
    features: [
      "Menú, recetas, mesas y personal",
      "Inventario inteligente con alertas",
      "Promociones por porcentaje o monto fijo",
      "Reportes, ranking de platos y CSV",
    ],
  },
]

export type Feature = { title: string; description: string; icon: LucideIcon; wide?: boolean }

export const features: Feature[] = [
  {
    title: "Tiempo real de verdad",
    description: "Varios dispositivos ven exactamente el mismo estado al mismo tiempo. Nadie refresca nada.",
    icon: Zap,
    wide: true,
  },
  {
    title: "Cobros blindados",
    description: "Transacción con bloqueo de fila e idempotencia: un corte de red no genera un cobro doble.",
    icon: ShieldCheck,
  },
  {
    title: "Impresión por hardware",
    description: "App para Windows compatible con Epson TM-T88 y térmicas USB genéricas.",
    icon: Printer,
  },
  {
    title: "Permisos en la base de datos",
    description: "Los roles no solo ocultan botones: están reforzados en el propio motor de datos.",
    icon: Lock,
  },
  {
    title: "Nube o servidor propio",
    description: "Listo para usar en la nube o auto-alojado con Docker, con control total de tus datos.",
    icon: Cloud,
    wide: true,
  },
  {
    title: "Cualquier pantalla",
    description: "Tablet, celular o computador, con modo claro y oscuro.",
    icon: MonitorSmartphone,
  },
  {
    title: "Tus datos, afuera",
    description: "Ventas y movimientos de caja exportables a CSV por turno.",
    icon: FileSpreadsheet,
    wide: true,
  },
  {
    title: "Inventario por receta",
    description: "Cada plato descuenta sus ingredientes exactos al pagarse, con historial filtrable.",
    icon: Boxes,
    wide: true,
  },
]

export const marquee = [
  "Efectivo",
  "Domicilios",
  "Nequi",
  "Bancolombia",
  "Transferencia",
  "Pagos divididos",
  "Epson TM-T88",
  "Modo oscuro",
  "Exportación CSV",
  "Docker",
  "PostgreSQL",
  "Promociones",
  "Recetas",
  "Alertas de stock",
  "COP",
]

export type RoadmapItem = { title: string; description: string; icon: LucideIcon }

export const roadmap: RoadmapItem[] = [
  {
    title: "Pagos en línea",
    description: "Stripe, Wompi, Mercado Pago o datáfono integrado para cobrar con tarjeta desde el sistema.",
    icon: CreditCard,
  },
  {
    title: "Devoluciones parciales",
    description: "Devolver 2 de 5 productos ya pagados, sin anular el pedido completo.",
    icon: Undo2,
  },
  {
    title: "Modo offline y app instalable",
    description: "Seguir tomando pedidos sin señal y sincronizar cuando vuelva la conexión.",
    icon: WifiOff,
  },
  {
    title: "Seguimiento para el cliente",
    description: "Un enlace o código QR para que el cliente vea el estado de su pedido en vivo.",
    icon: QrCode,
  },
  {
    title: "Alertas proactivas de stock",
    description: "Avisos por push, correo o SMS antes de quedarte sin un ingrediente.",
    icon: BellRing,
  },
  {
    title: "Multi-sede y franquicias",
    description: "La base ya está preparada; llega la gestión de varias sedes desde una sola cuenta.",
    icon: Building2,
  },
  {
    title: "Impresión en macOS y Linux",
    description: "El cliente de impresión automática, más allá de Windows.",
    icon: Laptop,
  },
  {
    title: "Multi-idioma",
    description: "La interfaz en más idiomas para equipos y clientes diversos.",
    icon: Languages,
  },
  {
    title: "Pedidos por WhatsApp",
    description: "Recibir domicilios desde WhatsApp, apoyados en el registro de clientes que ya existe.",
    icon: MessageCircle,
  },
  {
    title: "Zonas con tarifa propia",
    description: "Valor del domicilio según la zona de entrega, en lugar de un valor sugerido único.",
    icon: MapIcon,
  },
  {
    title: "Producción endurecida",
    description: "SSL y proxy reverso incluidos por defecto en el despliegue con Docker.",
    icon: ShieldPlus,
  },
]

export const stats = [
  { value: 5, suffix: "", label: "vistas especializadas por rol" },
  { value: 4, suffix: "", label: "métodos de pago integrados" },
  { value: 0, suffix: "", label: "cobros duplicados posibles" },
  { value: 1, suffix: "", label: "toque para enviar a cocina" },
]

export const heroChips = [
  { icon: UtensilsCrossed, text: "Mesa 4 → Cocina" },
  { icon: Receipt, text: "Pago confirmado · Nequi" },
  { icon: Boxes, text: "Stock bajo: queso" },
  { icon: Bike, text: "Domicilio #88 en camino" },
]

export type DeliveryStep = { label: string; detail: string; icon: LucideIcon }

// Mirrors the delivery_status state machine documented in docs/delivery-module.md.
export const deliverySteps: DeliveryStep[] = [
  { label: "Recibido", detail: "El operador registra el pedido; los precios salen del menú en el servidor.", icon: Phone },
  { label: "En preparación", detail: "La comanda llega a cocina marcada como DOMICILIO, con el nombre del cliente.", icon: ChefHat },
  { label: "Listo", detail: "Cocina lo marca listo y aparece en el tablero para despachar.", icon: PackageCheck },
  { label: "En camino", detail: "Se despacha con un repartidor activo asignado.", icon: Bike },
  { label: "Entregado", detail: "Se marca como entregado y el cobro se registra en la caja abierta.", icon: MapPin },
]

export const deliveryFeatures = [
  "Cliente reconocido por su teléfono, con sus direcciones guardadas",
  "Pago anticipado o contra entrega, con “cambio para” calculado",
  "Valor del domicilio sugerido, sin impuesto ni propina encima",
  "Gestión de repartidores desde administración",
  "Factura impresa con cliente, teléfono y dirección",
  "Si una entrega falla, se registra el motivo y se reenvía",
  "Caja con lista de domicilios por cobrar",
]

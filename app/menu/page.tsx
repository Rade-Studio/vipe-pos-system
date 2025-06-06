"use client";

import { useEffect, useState, useRef } from "react";
import { useTheme } from "next-themes";
import Image from "next/image";
import PublicMenu from "@/components/public-menu/PublicMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfigStore } from "@/store/use-config-store";
import { usePublicCart } from "@/store/use-public-cart";
import type { Dish, PaymentMethod } from "@/types";
import { formatCurrency, hexToHsl } from "@/utils/helpers";
import { toast } from "@/hooks/use-toast";

export default function PublicMenuPage() {
  const {
    businessName,
    businessPhone,
    menuPrimaryColor,
    menuSecondaryColor,
    menuLogo,
    menuSchedule,
    menuDarkMode,
    deliveryEnabled,
    loadConfigFromDB,
    isLoading,
  } = useConfigStore();
  const { setTheme } = useTheme();

  const [mode, setMode] = useState<"view" | "delivery" | null>(null);
  const { items: cart, add, update, remove } = usePublicCart();
  const cartAnchorRef = useRef<HTMLDivElement>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [orderComments, setOrderComments] = useState("");

  useEffect(() => {
    loadConfigFromDB();
  }, [loadConfigFromDB]);

  useEffect(() => {
    setTheme(menuDarkMode ? "dark" : "light");
  }, [menuDarkMode, setTheme]);

  useEffect(() => {
    const primary = hexToHsl(menuPrimaryColor);
    const secondary = hexToHsl(menuSecondaryColor);
    const getFg = (hsl: string) => {
      const l = Number(hsl.split(" ")[2].replace("%", ""));
      return l > 50 ? "0 0% 0%" : "0 0% 100%";
    };
    document.documentElement.style.setProperty("--primary", primary);
    document.documentElement.style.setProperty(
      "--primary-foreground",
      getFg(primary),
    );
    document.documentElement.style.setProperty("--secondary", secondary);
    document.documentElement.style.setProperty(
      "--secondary-foreground",
      getFg(secondary),
    );
  }, [menuPrimaryColor, menuSecondaryColor]);

  const addToCart = (dish: Dish) => {
    add(dish);
    toast.success("Producto agregado");
  };
  const updateQuantity = (id: string, qty: number, comment?: string) =>
    update(id, qty, comment);

  const total = cart.reduce((t, i) => t + i.price * i.quantity, 0);

  const sendWhatsApp = () => {
    const items = cart
      .map(
        (i) => `${i.quantity}x ${i.name}${i.comment ? ` (${i.comment})` : ""}`,
      )
      .join("%0A");
    let message = `Hola, quiero hacer un pedido:%0A${items}%0ATotal: ${formatCurrency(total)}`;
    if (orderComments) message += `%0AComentarios: ${orderComments}`;
    message += `%0AForma de pago: ${paymentMethod}`;
    message += `%0ANombre: ${customerName}`;
    message += `%0ADirección: ${customerAddress}`;
    const url = `https://wa.me/${businessPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
        {menuLogo && (
          <Image
            src={menuLogo}
            alt="logo"
            width={120}
            height={120}
            className="animate-pulse"
          />
        )}
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!mode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center space-y-6 bg-gradient-to-b from-primary to-secondary/70">
        {menuLogo && (
          <Image
            src={menuLogo}
            alt="logo"
            width={140}
            height={140}
            className="rounded-full shadow-lg"
          />
        )}
        <h1 className="text-3xl font-bold text-primary-foreground">
          ¡Bienvenido a {businessName}!
        </h1>
        {menuSchedule && (
          <p className="text-sm text-primary-foreground">{menuSchedule}</p>
        )}
        <p className="text-primary-foreground">
          Elige una opción para continuar
        </p>
        <div className="flex gap-4 mt-2">
          <Button variant="secondary" onClick={() => setMode("view")}>
            Ver Carta
          </Button>
          {deliveryEnabled && (
            <Button onClick={() => setMode("delivery")}>Domicilio</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <header className="sticky top-0 z-10 rounded-b-lg bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-md flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          {menuLogo && (
            <Image src={menuLogo} alt="logo" width={40} height={40} className="rounded-md" />
          )}
          <h1 className="font-semibold text-lg">{businessName}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMode(null)}>
          Inicio
        </Button>
      </header>

      <PublicMenu onAdd={addToCart} enableAdd={mode === "delivery"} />

      {mode === "delivery" && cart.length > 0 && (
        <Button
          id="cart-icon"
          className="fixed bottom-4 right-4 rounded-full w-14 h-14 shadow-lg flex items-center justify-center z-50"
          size="icon"
          onClick={() =>
            cartAnchorRef.current?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9h12l-2-9M9 21a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z"
            />
          </svg>
          <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
            {cart.reduce((t, i) => t + i.quantity, 0)}
          </span>
        </Button>
      )}

      {mode === "delivery" && (
        <div ref={cartAnchorRef} className="space-y-4">
          <h2 className="font-semibold">Tu Pedido</h2>
          {cart.length === 0 && (
            <p className="text-sm">El carrito está vacío</p>
          )}
          {cart.map((item) => (
            <div key={item.id} className="space-y-1 border rounded-md p-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {item.quantity}x {item.name}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-16"
                    value={item.quantity}
                    min={1}
                    onChange={(e) =>
                      updateQuantity(
                        item.id,
                        Number(e.target.value),
                        item.comment,
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(item.id)}
                  >
                    <svg
                      className="h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </Button>
                  <span>{formatCurrency(item.price * item.quantity)}</span>
                </div>
              </div>
              <Input
                placeholder="Comentario"
                value={item.comment}
                onChange={(e) =>
                  updateQuantity(item.id, item.quantity, e.target.value)
                }
              />
            </div>
          ))}
          {cart.length > 0 && (
            <p className="font-medium">Total: {formatCurrency(total)}</p>
          )}

          <Input
            placeholder="Nombre"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Input
            placeholder="Dirección"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
          <Input
            placeholder="Comentarios"
            value={orderComments}
            onChange={(e) => setOrderComments(e.target.value)}
          />

          <Select
            value={paymentMethod}
            onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Método de pago" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
              <SelectItem value="nequi">Nequi</SelectItem>
              <SelectItem value="bancolombia">Bancolombia</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={sendWhatsApp} disabled={cart.length === 0}>
            Enviar pedido por WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}

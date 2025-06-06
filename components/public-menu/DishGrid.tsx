"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useState } from "react";
import type { Dish } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/utils/helpers";
import { FlyImage } from "@/components/animations/FlyImage";
import { Plus } from "lucide-react";

interface DishGridProps {
  dishes: Dish[];
  onAdd?: (dish: Dish) => void;
  showAddButton?: boolean;
}

export default function DishGrid({
  dishes,
  onAdd,
  showAddButton,
}: DishGridProps) {
  const [flyImg, setFlyImg] = useState<null | {
    src: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }>(null);

  const triggerImageFly = (img: HTMLImageElement) => {
    const fromRect = img.getBoundingClientRect();
    const toElement = document.getElementById("cart-icon");
    if (!toElement) return;

    const toRect = toElement.getBoundingClientRect();

    setFlyImg({
      src: img.src,
      from: { x: fromRect.left, y: fromRect.top },
      to: {
        x: toRect.left + toRect.width / 2 - 40,
        y: toRect.top + toRect.height / 2 - 40,
      },
    });
  };

  if (dishes.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-10">
        No hay productos disponibles
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {dishes.map((d) => (
          <Card key={d.id} className="overflow-hidden" data-dish-id={d.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-4 sm:flex-col sm:text-center">
                <Image
                  src={d.image_url || "/placeholder.svg?height=160&width=160"}
                  alt={d.name}
                  width={160}
                  height={120}
                  className="rounded-md object-cover w-20 h-20 sm:w-full sm:h-32"
                />
                <div className="flex-1 space-y-1">
                  <p className="font-medium line-clamp-2">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {d.description}
                    </p>
                  )}
                </div>
                <p className="text-sm font-medium text-muted-foreground sm:mt-2 sm:w-full sm:text-center">
                  {formatCurrency(d.price)}
                </p>
              </div>
              {showAddButton && onAdd && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={(e) => {
                    const card =
                      (e.currentTarget.closest(
                        "[data-dish-id]",
                      ) as HTMLElement) || undefined;
                    const img = card?.querySelector(
                      "img",
                    ) as HTMLImageElement | null;
                    if (img) triggerImageFly(img);
                    onAdd(d);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {flyImg &&
        createPortal(
          <FlyImage
            src={flyImg.src}
            from={flyImg.from}
            to={flyImg.to}
            onDone={() => setFlyImg(null)}
          />,
          document.body,
        )}
    </>
  );
}

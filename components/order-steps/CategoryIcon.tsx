import {
  Apple,
  Banana,
  Beef,
  Beer,
  Cake,
  Carrot,
  Coffee,
  Croissant,
  CupSoda,
  Dessert,
  Drumstick,
  Egg,
  Fish,
  GlassWater,
  IceCream,
  Martini,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react"

/**
 * The category's icon name (the admin stores a Lucide name, lower or Pascal
 * case) to its glyph; an unknown name falls back to cutlery.
 */
const ICONS: Record<string, LucideIcon> = {
  apple: Apple,
  banana: Banana,
  beef: Beef,
  beer: Beer,
  cake: Cake,
  carrot: Carrot,
  coffee: Coffee,
  croissant: Croissant,
  cupsoda: CupSoda,
  dessert: Dessert,
  drumstick: Drumstick,
  chicken: Drumstick,
  egg: Egg,
  fish: Fish,
  glasswater: GlassWater,
  water: GlassWater,
  icecream: IceCream,
  martini: Martini,
  cocktail: Martini,
  pizza: Pizza,
  salad: Salad,
  sandwich: Sandwich,
  soup: Soup,
  utensils: Utensils,
  wine: Wine,
}

export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = ICONS[(name ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? Utensils
  return <Icon className={className} aria-hidden />
}

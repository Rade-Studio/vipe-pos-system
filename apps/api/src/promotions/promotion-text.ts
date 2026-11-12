import { formatPesos } from './engine';
import type { EnginePromotion, PromotionTargets } from './engine';

/**
 * The rule of a promotion in Spanish, modelled on the 02 artboard ("Lleva 2
 * cócteles y paga 1; sale gratis el más económico."), and its short badge
 * ("2x1", "20%", "Combo"). Pure: the caller supplies the target names.
 */

export interface TargetNames {
  dishes: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  subcategories: ReadonlyMap<string, string>;
}

type Rule = EnginePromotion<string>;

/** Minutes since local midnight as HH:MM (24:00 for the end of the day). */
export const clockText = (minutes: number | null): string | null =>
  minutes === null ? null : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const lower = (value: string) => value.toLocaleLowerCase('es');

const listed = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

const targetCount = (t: PromotionTargets) => t.dishIds.length + t.categoryIds.length + t.subcategoryIds.length;

/** "la categoría Postres", "la subcategoría Hamburguesas", "Hamburguesa clásica y Papas", "3 productos o grupos", or null. */
function targetPhrase(t: PromotionTargets, names: TargetNames): string | null {
  const count = targetCount(t);
  if (count === 0) return null;
  if (t.categoryIds.length === 1 && count === 1) return `la categoría ${names.categories.get(t.categoryIds[0]) ?? 'elegida'}`;
  if (t.subcategoryIds.length === 1 && count === 1) return `la subcategoría ${names.subcategories.get(t.subcategoryIds[0]) ?? 'elegida'}`;
  if (count === t.dishIds.length && count <= 3) return listed(t.dishIds.map((id) => names.dishes.get(id) ?? 'producto'));
  return `${count} productos o grupos`;
}

/** Plural noun of what a buy_x_pay_y counts: the single category or subcategory, else "productos". */
function unitsNoun(t: PromotionTargets, names: TargetNames): string {
  const count = targetCount(t);
  if (count === 1 && t.categoryIds.length === 1) return lower(names.categories.get(t.categoryIds[0]) ?? 'productos');
  if (count === 1 && t.subcategoryIds.length === 1) return lower(names.subcategories.get(t.subcategoryIds[0]) ?? 'productos');
  return 'productos';
}

const amount = (rule: Rule) =>
  rule.discountType === 'percentage' ? `${rule.discountValue ?? 0}%` : formatPesos(rule.discountValue ?? 0);

function buyXPayYSentence(rule: Rule, names: TargetNames): string {
  const n = rule.buyQuantity;
  const free = n - rule.payQuantity;
  const noun = unitsNoun(rule.targets, names);
  if (rule.restDiscountPercent === 100) {
    const tail = free === 1 ? 'sale gratis el más económico' : `salen gratis los ${free} más económicos`;
    return `Lleva ${n} ${noun} y paga ${rule.payQuantity}; ${tail}.`;
  }
  if (n === 2 && free === 1 && rule.restDiscountPercent === 50) return `Lleva 2 ${noun}; la segunda al 50%.`;
  const who = free === 1 ? 'la más económica' : `las ${free} más económicas`;
  return `Lleva ${n} ${noun}; ${who} con ${rule.restDiscountPercent}% de descuento.`;
}

function productSentence(rule: Rule, names: TargetNames): string {
  const where = targetPhrase(rule.targets, names);
  if (rule.discountType === 'percentage') return where ? `${amount(rule)} en ${where}.` : `${amount(rule)} de descuento.`;
  return where ? `${amount(rule)} menos por unidad en ${where}.` : `${amount(rule)} menos por unidad.`;
}

function billSentence(rule: Rule): string {
  const cap = rule.maxDiscount !== null ? formatPesos(rule.maxDiscount) : null;
  const benefit = rule.discountType === 'percentage' ? amount(rule) : `${amount(rule)} menos`;
  if (rule.minSubtotal !== null && rule.minSubtotal > 0) {
    const base = `${benefit} en cuentas desde ${formatPesos(rule.minSubtotal)}`;
    return cap ? `${base}, con tope de ${cap}.` : `${base}.`;
  }
  return cap ? `${benefit} sobre la cuenta, con tope de ${cap} por pedido.` : `${benefit} sobre la cuenta.`;
}

export function promotionSentence(rule: Rule, names: TargetNames): string {
  switch (rule.kind) {
    case 'buy_x_pay_y':
      return buyXPayYSentence(rule, names);
    case 'combo': {
      const groups = rule.comboGroups.map((group) => `1 ${lower(group.name)}`).join(' + ');
      return `${groups || 'Combo'} por ${formatPesos(rule.comboPrice)}.`;
    }
    case 'bill_discount':
      return billSentence(rule);
    default:
      return productSentence(rule, names);
  }
}

export function promotionBadge(rule: Rule): string {
  switch (rule.kind) {
    case 'buy_x_pay_y':
      return rule.restDiscountPercent === 100
        ? `${rule.buyQuantity}x${rule.payQuantity}`
        : `${rule.payQuantity + 1}º ${rule.restDiscountPercent}%`;
    case 'combo':
      return 'Combo';
    default:
      return rule.discountType === 'percentage' ? `${rule.discountValue ?? 0}%` : `-${formatPesos(rule.discountValue ?? 0)}`;
  }
}

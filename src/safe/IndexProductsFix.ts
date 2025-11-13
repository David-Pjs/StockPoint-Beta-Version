// src/safe/IndexProductsFix.ts
// Safe replacements for product CRUD that match the project's types and helpers.

import {
  readJSON,
  writeJSON,
  signalChange,
  KEYS,
  getCurrentUser,
  uid,
  limits,
} from "../index";
import type { Product, NewProductInput } from "../index";

/**
 * Read product list from localStorage
 */
export function getProducts(): Product[] {
  return readJSON<Product[]>(KEYS.products, []);
}

/**
 * Persist product list and notify listeners
 */
export function saveProducts(list: Product[]): void {
  writeJSON(KEYS.products, list);
  signalChange();
}

/**
 * Add a product (accepts partial input; will normalize important fields)
 * Returns the created Product.
 */
export function addProduct(input: Partial<NewProductInput> & { name?: string; sell_price?: number }): Product {
  const list = getProducts();

  // plan limit check
  const planLimits = limits();
  if (typeof planLimits.products === "number" && list.length >= planLimits.products) {
    throw new Error("Product limit reached for your plan. Please upgrade.");
  }

  // Basic validation
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Product name is required");
  const sell_price = Number(input.sell_price ?? input.sell_price ?? 0);
  if (!Number.isFinite(sell_price) || sell_price <= 0) throw new Error("Valid sell price required");

  const currentUser = getCurrentUser();

  const newProd: Product = {
    id: (typeof crypto !== "undefined" && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : uid(),
    name,
    sku: input.sku?.trim() || undefined,
    category: input.category?.trim() || undefined,
    cost_price: Number(input.cost_price ?? 0) || 0,
    sell_price,
    qty_in_stock: Number(input.qty_in_stock ?? 0) || 0,
    alert_threshold: Number(input.alert_threshold ?? 0) || 0,
    createdAt: Date.now(),
    createdBy: currentUser ? { id: currentUser.id, username: currentUser.username, role: currentUser.role } : null,
  };

  list.push(newProd);
  saveProducts(list);
  return newProd;
}

/**
 * Update product stock quantity by delta (positive or negative).
 * If product not found, does nothing.
 */
export function updateProductQty(productId: string, delta: number): void {
  if (!productId) return;
  const list = getProducts();
  const idx = list.findIndex(p => p.id === productId);
  if (idx === -1) return;
  const existing = list[idx];
  const nextQty = Math.max(0, (existing.qty_in_stock ?? 0) + Number(delta || 0));
  list[idx] = { ...existing, qty_in_stock: nextQty };
  saveProducts(list);
}

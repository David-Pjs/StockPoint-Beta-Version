
// src/types/product.d.ts
export type MiniUser = { id: string; username: string; role: string; photoUrl?: string } | null;

export interface Product {
  id: string;
  name: string;
  sku: string;
  cost: number;
  sell: number;
  stock_qty: number;
  createdBy?: MiniUser;
  createdAt?: number;
  // ... keep your other fields
}

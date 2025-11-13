// src/app/currentUser.ts
import type { MinimalUser } from "../index";

/**
 * Minimal getCurrentUser helper used across the app.
 * Reads the same localStorage keys that src/index.ts uses.
 */
export function getCurrentUser(): MinimalUser | null {
  try {
    const sRaw = localStorage.getItem("sp_session");
    if (!sRaw) return null;
    const session = JSON.parse(sRaw) as { userId?: string } | null;
    if (!session?.userId) return null;

    const usersRaw = localStorage.getItem("sp_users");
    if (!usersRaw) return null;
    const users = JSON.parse(usersRaw) as MinimalUser[];
    return users.find(u => u.id === session.userId) ?? null;
  } catch {
    return null;
  }
}

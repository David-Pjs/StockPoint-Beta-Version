// src/lib/avatars.ts

const KEY = "sp_user_avatars:v1";

export type AvatarMap = Record<string, string>; // userId -> dataURL (e.g. "data:image/png;base64,...")

function safeParse(json: string | null): AvatarMap {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    // Ensure shape is { [id: string]: string }
    if (obj && typeof obj === "object") {
      const out: AvatarMap = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof k === "string" && typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {}
  return {};
}

function read(): AvatarMap {
  try {
    return safeParse(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function write(map: AvatarMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore quota / privacy errors
  }
  // Notify other tabs/components to sync
  try {
    localStorage.setItem("__sp_changed__", String(Date.now()));
  } catch {
    // ignore
  }
}

/** Returns the dataURL for a user's avatar, or null if not set. */
export function getAvatar(userId?: string | null): string | null {
  if (!userId) return null;
  const map = read();
  const url = map[userId];
  return typeof url === "string" && url ? url : null;
}

/**
 * Sets or clears an avatar for a user.
 * Pass a dataURL (e.g. "data:image/png;base64,...") to set,
 * or null to remove the avatar.
 */
export function setAvatar(userId: string, dataUrl: string | null): void {
  if (!userId) return;
  const map = read();

  if (dataUrl && typeof dataUrl === "string") {
    map[userId] = dataUrl;
  } else {
    delete map[userId];
  }

  write(map);
}

/** Export all avatars (for backup). */
export function exportAvatars(): AvatarMap {
  return read();
}

/** Import/merge avatars (for restore). */
export function importAvatars(map: AvatarMap): void {
  const current = read();
  const next: AvatarMap = { ...current };

  // Only merge string values
  for (const [k, v] of Object.entries(map || {})) {
    if (typeof k === "string" && typeof v === "string") next[k] = v;
  }

  write(next);
}

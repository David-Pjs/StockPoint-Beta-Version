// src/features/settings/ProfilePhotoCard.tsx
import { useMemo, useRef, useState } from "react";
import { getCurrentUser } from "../../index";
import { getAvatar, setAvatar } from "../../lib/avatars";

export default function ProfilePhotoCard() {
  const user = useMemo(() => getCurrentUser(), []);
  const [img, setImg] = useState<string | null>(() => getAvatar(user?.id || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick() { inputRef.current?.click(); }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatar(user.id, dataUrl);
      setImg(dataUrl);
    };
    reader.readAsDataURL(file);
  }
  function onRemove() {
    if (!user) return;
    setAvatar(user.id, null);
    setImg(null);
  }

  return (
    <div className="p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <h3 className="text-lg font-semibold mb-2">Profile picture</h3>
      <p className="text-sm opacity-75 mb-3">
        This photo is attached to your user and can be shown on receipts, records, and staff lists.
      </p>

      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-[var(--line)] overflow-hidden flex items-center justify-center">
          {img ? <img src={img} alt="avatar" className="w-full h-full object-cover" /> : <span className="opacity-60 text-sm">No photo</span>}
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={onPick}>Upload</button>
          <button className="px-3 py-2 rounded-lg border border-[var(--line)] hover:bg-[var(--line)]/50" onClick={onRemove}>Remove</button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
      </div>
    </div>
  );
}

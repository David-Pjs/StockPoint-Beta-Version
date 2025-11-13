// src/ui/Modal.tsx
import React from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export default function Modal({ open, onClose, title, children, actions }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[min(680px,95vw)] rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl">
        {title && <h3 className="text-lg font-semibold mb-3">{title}</h3>}
        <div className="max-h-[70vh] overflow-auto">{children}</div>
        {actions && <div className="mt-4 flex items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

interface Props {
  label?: string;
  children?: ReactNode;
}

/**
 * Wraps an input or group of inputs with a label and consistent spacing.
 */
export default function InputRow(props?: Props) {
  const { label = "", children } = props ?? {};
  return (
    <div className="grid gap-1">
      {label && <label className="text-sm text-[var(--muted)]">{label}</label>}
      {children}
    </div>
  );
}
import type { ReactNode } from "react";

interface Props {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
}

/**
 * A simple button component with optional variants.
 */
export default function Button(props?: Props) {
  const {
    children,
    onClick,
    variant = "solid",
    className = "",
    disabled = false,
  } = props ?? {};
  let base = "px-4 py-2 rounded-md font-medium transition-colors";
  if (variant === "ghost") {
    base += " border border-[var(--line)] bg-transparent hover:bg-[#0e1430]";
  } else if (variant === "danger") {
    base += " bg-red-600 hover:bg-red-700";
  } else {
    base += " bg-[var(--accent)] hover:brightness-110";
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${className}`}>
      {children}
    </button>
  );
}
import type { PropsWithChildren, HTMLAttributes } from "react";

export default function Card(
  { children, className = "", ...rest }: PropsWithChildren<HTMLAttributes<HTMLElement>>
) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

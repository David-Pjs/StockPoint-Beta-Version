import React, { ReactNode, useEffect, useMemo, useState } from "react";
import { getLicense, daysLeft } from "../index";

/** Small hook that stays in sync with localStorage heartbeat. */
export function useLicense() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__") setVersion((v) => v + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const lic = useMemo(() => getLicense(), [version]);
  const left = useMemo(() => daysLeft(lic), [lic]);
  const active = lic.expiresAt === 0 || left > 0;

  // effective plan (expired paid -> free)
  const plan = active ? lic.plan : "free";

  return { plan, lic, left, active };
}

/** Show only for FREE plan (or expired). */
export function FreeOnly({ children }: { children: ReactNode }) {
  const { plan } = useLicense();
  return plan === "free" ? <>{children}</> : null;
}

/** Show only for PRO/SMALL plan (and TRIAL). */
export function ProOnly({ children }: { children: ReactNode }) {
  const { plan } = useLicense();
  return plan === "small" || plan === "trial" ? <>{children}</> : null;
}

/** Show only for ENTERPRISE/LARGE plan. */
export function EnterpriseOnly({ children }: { children: ReactNode }) {
  const { plan } = useLicense();
  return plan === "large" ? <>{children}</> : null;
}

/** Feature flag helper: pass a test fn or list of plans. */
export function PlanSwitch({
  when,
  children,
}: {
  when: ((plan: string) => boolean) | Array<"free" | "trial" | "small" | "large">;
  children: ReactNode;
}) {
  const { plan } = useLicense();
  const ok = Array.isArray(when) ? when.includes(plan as any) : when(plan);
  return ok ? <>{children}</> : null;
}

import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import { getLicense, daysLeft } from "../../index";

import DashboardFree from "./DashboardFree";
import DashboardPro from "./DashboardPro";
import DashboardEnterprise from "./DashboardEnterprise";

/* -----------------------------------------------------------------------------
   Robust license store bridge
   - Triggers on:
     • custom "sp:changed" events dispatched in this tab
     • cross-tab "storage" writes
     • tab focus (visibilitychange)
     • light polling fallback (every 1s)
   - To signal changes when you write to localStorage, also do:
       window.dispatchEvent(new Event("sp:changed"));
     (Add that wherever you mutate license or other plan-related data.)
----------------------------------------------------------------------------- */

const SNAPSHOT = () => JSON.stringify(getLicense());

function subscribe(onStoreChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    // If you want to narrow this, check e.key === "__sp_changed__" or your license key.
    onStoreChange();
  };
  const onCustom = () => onStoreChange();
  const onVisible = () => {
    if (!document.hidden) onStoreChange();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("sp:changed", onCustom);
  document.addEventListener("visibilitychange", onVisible);

  // Lightweight polling as last resort (handles cases where writers forget to dispatch)
  const id = window.setInterval(onStoreChange, 1000);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("sp:changed", onCustom);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(id);
  };
}

function useLicense() {
  // useSyncExternalStore guarantees correct subscription semantics in React 18+
  const snap = useSyncExternalStore(subscribe, SNAPSHOT, SNAPSHOT);
  // Parse once per snapshot
  return useMemo(() => JSON.parse(snap) as ReturnType<typeof getLicense>, [snap]);
}

/** Chooses which dashboard to show based on current license. */
export default function DashboardByPlan() {
  const lic = useLicense();
  const left = useMemo(() => daysLeft(lic), [lic]);
  const active = lic.expiresAt === 0 || left > 0;

  if (!active) return <DashboardFree />;

  switch (lic.plan) {
    case "large":
      return <DashboardEnterprise />;
    case "small":
    case "trial": // trial gets full features of "small"
      return <DashboardPro />;
    case "free":
    default:
      return <DashboardFree />;
  }
}

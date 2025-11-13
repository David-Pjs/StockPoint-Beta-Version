import { useEffect, useMemo, useState } from "react";
import { getLicense, daysLeft } from "../index";

export default function useLicense() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ping = () => setVersion(v => v + 1);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__" || e.key === "sp_license") ping();
    };
    const onVis = () => document.visibilityState === "visible" && ping();
    const onFocus = () => ping();

    window.addEventListener("storage", onStorage);
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    // tiny fallback so same-tab dev changes get noticed
    const id = window.setInterval(ping, 1500);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, []);

  const lic = useMemo(() => getLicense(), [version]);
  const left = useMemo(() => daysLeft(lic), [lic]);
  const active = lic.expiresAt === 0 || left > 0;
  const plan = active ? lic.plan : "free";

  return { plan, lic, left, active, version };
}

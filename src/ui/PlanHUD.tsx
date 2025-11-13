// src/ui/PlanHUD.tsx
import React from "react";
import { getLicense, limits } from "../index";

export default function PlanHUD() {
  const lic = getLicense();
  const lim = limits() as { products: number; users: number };

  // show 'unlimited' label if cap is not finite
  const productsCap = Number.isFinite(lim.products) && lim.products > 0 ? String(lim.products) : "unlimited";
  const usersCap = Number.isFinite(lim.users) && lim.users > 0 ? String(lim.users) : "unlimited";

  return (
    <div className="text-sm opacity-80">
      Plan: <span className="font-medium">{lic.plan}</span> — Products cap {productsCap}, Users cap {usersCap}
    </div>
  );
}

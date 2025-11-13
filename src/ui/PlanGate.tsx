// src/ui/PlanGate.tsx
import React from "react";
import { limits, isReadOnly, getLicense } from "../index";

/**
 * PlanGate
 * - kind: "product" | "user"
 * - count: current count (products or users)
 * - children: UI to show when under the cap
 */
export function PlanGate(props: { kind: "product" | "user"; count: number; children: React.ReactNode }) {
  const { kind, count, children } = props;
  const lic = getLicense();

  // ensure stable shape for limits
  const caps = limits() as { products: number; users: number };

  // treat 0 or non-finite as unlimited
  const rawCap = kind === "product" ? caps.products : caps.users;
  const cap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : Infinity;

  const over = Number.isFinite(cap) ? count >= cap : false;
  const ro = isReadOnly();

  if (over || ro) {
    const capLabel = Number.isFinite(cap) ? String(cap) : "unlimited";
    const reason = over
      ? `You’ve reached the ${lic.plan.toUpperCase()} plan ${kind} limit (${capLabel}).`
      : `Your subscription is past due. New ${kind}${kind === "product" ? "s" : "s"} are blocked.`;

    return (
      <div className="p-4 text-red-300 border rounded-md border-red-500/30 bg-red-500/10">
        <div className="font-semibold">{reason}</div>

        <div className="mt-2 text-sm opacity-80">
          {over ? (
            <>
              You currently have <b>{count}</b> {kind}
              {count === 1 ? "" : "s"} and the cap for your plan (<b>{lic.plan.toUpperCase()}</b>) is <b>{capLabel}</b>.
            </>
          ) : (
            <>Please resolve your billing in Settings to continue creating new items.</>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            className="px-3 py-1 text-sm text-black bg-white rounded"
            onClick={() => (window.location.href = "/settings")}
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

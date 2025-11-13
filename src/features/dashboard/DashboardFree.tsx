import { useEffect, useMemo, useState } from "react";
import {
  getSales,
  getSaleItems,
  getProducts,
  money,
  type SaleItem,
} from "../../index";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";
import Button from "../../ui/Button";
import { Link } from "react-router-dom";

/* ---------------- local date helper (no UTC drift) ---------------- */
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DashboardFree() {
  const [pulse, setPulse] = useState(0);
  const today = todayYMD();

  // live refresh across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "__sp_changed__") setPulse((x) => x + 1);
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(() => setPulse((x) => x + 1), 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(id);
    };
  }, []);

  const allSales = useMemo(() => getSales(), [pulse]);
  const allSaleItems = useMemo(() => getSaleItems(), [pulse]);
  const allProducts = useMemo(() => getProducts(), [pulse]);

  // --- today snapshot ---
  const todaysSales = useMemo(
    () => allSales.filter((s) => s.sold_on === today),
    [allSales, today]
  );
  const todaysSaleIds = useMemo(
    () => new Set(todaysSales.map((s) => s.id)),
    [todaysSales]
  );
  const todaysItems = useMemo(
    () => allSaleItems.filter((it) => todaysSaleIds.has(it.sale_id)),
    [allSaleItems, todaysSaleIds]
  );

  const ordersCount = todaysSales.length;
  const itemsCount = todaysItems.reduce((n, it) => n + (it.qty || 0), 0);
  const income = todaysSales.reduce((n, s) => n + (s.total || 0), 0);

  const lowStockCount = useMemo(
    () =>
      allProducts.filter(
        (p) => (p.alert_threshold ?? 0) > 0 && p.qty_in_stock <= (p.alert_threshold ?? 0)
      ).length,
    [allProducts]
  );

  const invValue = useMemo(
    () => allProducts.reduce((s, p) => s + (p.qty_in_stock * (p.cost_price ?? 0)), 0),
    [allProducts]
  );

  return (
    <div className="grid gap-6">
      <Card>
        <div className="mb-3">
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard <span className="opacity-70">— Free</span></h1>
          <div className="text-sm muted">
            Lite snapshot. Upgrade to unlock full analytics, CSV export, roles, and more.
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Pill label="Today Income" value={money(income)} color="ok" />
          <Pill label="Orders (today)" value={String(ordersCount)} color="ok" />
          <Pill label="Items (today)" value={String(itemsCount)} color="ok" />
          <Pill label="Low-stock Items" value={String(lowStockCount)} color="bad" />
          <Pill label="Inventory Value" value={money(invValue)} color="ok" />
          <Pill label="Plan" value="FREE" color="bad" />
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Link to="/sales"><Button>Sell Now</Button></Link>
          <Link to="/products"><Button variant="ghost">Add Product</Button></Link>
          <Link to="/settings"><Button variant="ghost">Settings</Button></Link>
         
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Today’s Top Items (Lite)</h2>
        {todaysItems.length === 0 ? (
          <div className="muted">No sales yet today.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Product</th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">Qty</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(
                  todaysItems.reduce<Record<string, number>>((acc, it) => {
                    const name = (it as SaleItem).name_snapshot || "Unnamed";
                    acc[name] = (acc[name] || 0) + (it.qty || 0);
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([name, qty], i) => (
                    <tr key={name} className={`border-b border-[var(--line)]/40 ${i%2===0 ? "bg-[#0e1526]/30" : ""}`}>
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2 font-extrabold">{qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm">
          Need exports, multi-range trends & reports?{" "}
          <Link to="/settings" className="link">Upgrade</Link>.
        </div>
      </Card>
    </div>
  );
}

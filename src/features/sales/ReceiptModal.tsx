import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../ui/Modal";
import { getCompany } from "../../lib/company";
import { getAvatar } from "../../lib/avatars";
import { getAuthor } from "../../lib/txmeta";
import { getUsers, money, getLicense } from "../../index";

/* ----------------------------- Types ----------------------------- */
export type Tx = {
  id: string;
  occurred_on: string;
  customer_name: string | null;
  description: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  method: string | null;
  reference: string | null;
};

type EReceipt = {
  id: string;
  txId: string;
  savedAt: number;
  company: {
    name?: string;
    address?: string;
    email?: string;
    phone?: string;
    logo?: string | null;
  };
  cashier?: { id: string; username: string; role?: string; avatar?: string | null };
  payload: Tx;
  previewPng?: string;
};

const EREC_KEY = "sp_ereceipts:v1";

/* --------------------------- Storage utils --------------------------- */
function readEReceipts(): EReceipt[] {
  try {
    const raw = localStorage.getItem(EREC_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as EReceipt[]) : [];
  } catch {
    return [];
  }
}
function writeEReceipts(list: EReceipt[]) {
  try { localStorage.setItem(EREC_KEY, JSON.stringify(list)); } catch {}
  try { localStorage.setItem("__sp_changed__", String(Date.now())); } catch {}
}

/* ----------------------------- Quotas ----------------------------- */
function eReceiptLimit(plan: string): number {
  if (plan === "large") return Infinity;
  if (plan === "small") return 500;
  return 20; // Free & Trial
}

/* ---------------------- Helpers (math + format) ---------------------- */
function safeQty(n: any): number {
  const q = Number(n);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function safeUnit(qty: number, unit_price: any, amount: any): number {
  const u = Number(unit_price);
  if (Number.isFinite(u)) return u;
  const amt = Number(amount);
  const q = safeQty(qty);
  const derived = q > 0 ? amt / q : amt;
  return Number.isFinite(derived) ? derived : 0;
}

/* --------- Inline <img> sources as data URLs for crisp exports --------- */
async function inlineImages(node: HTMLElement) {
  const imgs = Array.from(node.querySelectorAll("img")) as HTMLImageElement[];
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("data:")) return;
        const res = await fetch(src, { mode: "cors" });
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve) => {
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", dataUrl);
        img.setAttribute("crossorigin", "anonymous");
      } catch { /* ignore errors for remote images */ }
    })
  );
}

/* ---------------------- PNG export (no deps) ---------------------- */
async function capturePng(el: HTMLElement, opts?: { scale?: number }): Promise<string> {
  const scale = Math.max(1, Math.min(4, opts?.scale ?? 2));
  const rect = el.getBoundingClientRect();
  const w = Math.ceil(rect.width || 720);
  const h = Math.ceil(rect.height || 512);

  const clone = el.cloneNode(true) as HTMLElement;
  await inlineImages(clone);

  clone.style.margin = "0";
  clone.style.background = "#ffffff";
  clone.style.color = "#000000";
  clone.style.transform = `scale(${scale})`;
  clone.style.transformOrigin = "top left";
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;

  const wrapper = document.createElement("div");
  wrapper.style.width = `${w * scale}px`;
  wrapper.style.height = `${h * scale}px`;
  wrapper.appendChild(clone);

  const xml = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}">
    <foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject>
  </svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(w * scale);
    canvas.height = Math.floor(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------- Render a minimal receipt HTML for consistent captures ------------- */
/* This returns an HTML string we will wrap into SVG -> PNG for crisp multi-capture */
function renderReceiptHtml(company: ReturnType<typeof getCompany>, tx: Tx, opts?: { width?: number }) {
  const w = opts?.width || 820;
  const q = safeQty(tx.qty);
  const u = safeUnit(q, tx.unit_price, tx.amount);
  const total = Number(tx.amount) || q * u || 0;
  const companyName = company.name || "Your Company";

  // inline basic styles to ensure consistent captures
  const styles = `
    <style>
      :root{ --ink:#0f1724; --muted:#64748b; --accent:#4f46e5; }
      body{ margin:0; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial; color:var(--ink); background:#fff; -webkit-font-smoothing:antialiased; }
      .wrap{ width:${w}px; padding:28px; box-sizing:border-box; }
      .ribbon{ display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; }
      .brand{ font-weight:800; font-size:22px; letter-spacing: -0.01em; }
      .meta{ font-size:12px; color:var(--muted); }
      .card{ border:1px solid #e6eef6; border-radius:8px; padding:12px; margin-bottom:18px; background:#fff; }
      table{ width:100%; border-collapse:collapse; font-size:13px; }
      thead th{ text-align:left; font-weight:700; padding:12px; background:#f5f7fb; border-bottom:1px solid #e6eef6; color:var(--muted); }
      tbody td{ padding:12px; border-bottom:1px solid #f0f3f7; }
      tfoot td{ padding:12px; font-weight:800; }
      .right{ text-align:right; font-variant-numeric: tabular-nums; }
      .total{ background:linear-gradient(90deg,var(--accent), color-mix(in srgb,var(--accent),white 24%)); color:#fff; padding:8px 12px; border-radius:6px; display:inline-block; font-weight:900; }
      .footnote{ margin-top:18px; font-size:12px; color:var(--muted); }
      img.logo{ max-height:48px; object-fit:contain; border-radius:6px; }
    </style>
  `;

  const logo = company.logo ? `<img class="logo" src="${company.logo}" alt="logo" />` : "";

  const html = `
    <!doctype html><html><head><meta charset="utf-8">${styles}</head>
    <body>
      <div class="wrap">
        <div class="ribbon">
          <div>
            <div class="brand">${companyName}</div>
            <div class="meta">${company.address || ""}${company.address && (company.email || company.phone) ? " · " : ""}${company.email || ""}${company.email && company.phone ? " · " : ""}${company.phone || ""}</div>
          </div>
          <div>${logo}</div>
        </div>

        <div class="card">
          <div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:12px;color:var(--muted)">Date</div>
              <div style="font-weight:800">${tx.occurred_on || "-"}</div>
              <div style="margin-top:8px;font-size:12px;color:var(--muted)">Customer</div>
              <div style="font-weight:800">${tx.customer_name || "-"}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;color:var(--muted)">Ref</div>
              <div style="font-weight:800">${tx.reference || tx.id}</div>
              <div style="height:10px"></div>
              <div style="font-size:12px;color:var(--muted)">Method</div>
              <div style="font-weight:800">${tx.method || "-"}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <table>
            <thead>
              <tr><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>${tx.description || "-"}</td>
                <td class="right">${q}</td>
                <td class="right">${money(u)}</td>
                <td class="right">${money(total)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colspan="3" class="right">Total</td><td class="right">${money(total)}</td></tr>
            </tfoot>
          </table>
        </div>

        <div class="footnote">Thank you for your business. ${companyName} · ${company.email || ""} ${company.phone ? "· " + company.phone : ""}</div>
      </div>
    </body>
    </html>
  `;
  return html;
}

/* ---------- Convert raw HTML string into PNG data URL (using svg+foreignObject) ---------- */
async function captureHtmlToPng(html: string, width = 820, height = 1120, scale = 2): Promise<string> {
  // wrap html into foreignObject; we must ensure the height is enough for the content:
  // If you want a dynamic height, you can measure by rendering off-DOM then measuring, but for simplicity we use a tall canvas.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width * scale}' height='${height * scale}'>
    <foreignObject x='0' y='0' width='${width * scale}' height='${height * scale}'>
      ${new XMLSerializer().serializeToString(new DOMParser().parseFromString(html, 'text/html').documentElement)}
    </foreignObject>
  </svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    // Height may be large; keep the height parameter flexible. Try a standard A4 ratio if not given.
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* helper to download DataURL */
function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/* Open multi-image print window (each image on its own A4 page) */
function openPrintWindowForPngs(pngs: string[], fileBase: string) {
  const imgsHtml = pngs
    .map(
      (p, i) => `<div class="page"><img src="${p}" alt="${fileBase}-${i}" /></div>`
    )
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${fileBase}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      html,body{ background:#fff; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page{ page-break-after: always; display:flex; align-items:center; justify-content:center; height:100vh; box-sizing:border-box; padding:14mm; }
      img{ max-width:100%; max-height:100%; object-fit:contain; display:block; }
    </style>
  </head><body>${imgsHtml}<script>window.onload = ()=>{ setTimeout(()=>{ window.print(); setTimeout(()=>window.close(),500); }, 200); };</script></body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ---------------------- Share as plain text ---------------------- */
function buildShareText(rows: Tx[], company: ReturnType<typeof getCompany>, grandTotal: number) {
  const lines: string[] = [];
  lines.push(`${company.name || "Receipt"}`);
  const meta = [company.address, company.email, company.phone].filter(Boolean).join(" • ");
  if (meta) lines.push(meta);
  lines.push("");

  const uniq = (vals: (string | null)[]) => {
    const u = Array.from(new Set(vals.map((v) => v || "—")));
    return u.length === 1 ? u[0] : "Multiple";
  };

  lines.push(`Date: ${uniq(rows.map((r) => r.occurred_on))}`);
  lines.push(`Ref: ${uniq(rows.map((r) => r.reference || r.id))}`);
  lines.push(`Customer: ${uniq(rows.map((r) => r.customer_name))}`);
  lines.push(`Method: ${uniq(rows.map((r) => r.method))}`);
  lines.push("");

  lines.push(`Items:`);
  lines.push(`Description | Qty | Unit | Total`);
  rows.forEach((r) => {
    const q = safeQty(r.qty);
    const u = safeUnit(q, r.unit_price, r.amount);
    const rowTotal = Number(r.amount) || q * u || 0;
    lines.push(`${r.description || "—"} | ${q} | ${money(u)} | ${money(rowTotal)}`);
  });

  if (rows.length > 1) {
    lines.push("");
    lines.push(`Total: ${money(grandTotal)}`);
  }

  return lines.join("\n");
}

/* ================================================================== */

export default function ReceiptModal({
  tx,
  open,
  onClose,
}: {
  tx: Tx | Tx[] | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!tx) return null;

  const isMulti = Array.isArray(tx);
  const rows: Tx[] = isMulti ? tx : [tx];

  const uniqOrMulti = (vals: (string | null)[]) => {
    const u = Array.from(new Set(vals.map((v) => v || "—")));
    return u.length === 1 ? u[0] : "Multiple";
  };
  const headerCustomer = uniqOrMulti(rows.map((r) => r.customer_name));
  const headerMethod = uniqOrMulti(rows.map((r) => r.method));
  const headerRef = uniqOrMulti(rows.map((r) => r.reference || r.id));
  const headerDate = uniqOrMulti(rows.map((r) => r.occurred_on));
  const grandTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const company = getCompany();
  const lic = useMemo(() => getLicense(), []);
  const limit = eReceiptLimit(lic.plan);

  // Single-author display
  const single = !isMulti ? rows[0] : null;
  const authorId = single ? getAuthor(single.id) : null;
  const author = authorId ? getUsers().find((u) => u.id === authorId) || null : null;
  const avatar = author ? getAvatar(author.id) : null;

  const [count, setCount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setCount(readEReceipts().length);
  }, [open]);

  /* -------------------------- Actions -------------------------- */
  async function onSavePng() {
    const node = containerRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const dataUrl = await capturePng(node, { scale: 2 });
      downloadDataUrl(
        dataUrl,
        `receipt-${isMulti ? "multi" : single?.reference || single?.id || "receipt"}.png`
      );
    } catch (e: any) {
      setMsg(e?.message || "Failed to save PNG.");
    } finally {
      setBusy(false);
    }
  }

  async function onPrintPdf() {
    const node = containerRef.current;
    if (!node) return;
    setBusy(true);
    try {
      // if single or multi already rendered in container, capture container as single page
      const dataUrl = await capturePng(node, { scale: 2 });
      openPrintWindowForPngs([dataUrl], `receipt-${isMulti ? "multi" : single?.reference || single?.id || "receipt"}`);
    } catch (e: any) {
      setMsg(e?.message || "Failed to generate PDF.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------ NEW: Multi-print/export using generated HTML per Tx ------------------ */
  async function onPrintPdfMulti() {
    if (!rows || rows.length === 0) return;
    setBusy(true);
    try {
      const pngs: string[] = [];
      // choose an approximate height for each generated receipt (A4 portrait ~ 1120px @ 72dpi)
      for (const r of rows) {
        // render the html and capture PNG.
        const html = renderReceiptHtml(company, r, { width: 820 });
        // height 1120 should be enough for a single receipt page; if your receipts are longer, increase height.
        const png = await captureHtmlToPng(html, 820, 1120, 2);
        pngs.push(png);
      }
      openPrintWindowForPngs(pngs, `receipts-${rows.length}`);
    } catch (e: any) {
      setMsg(e?.message || "Failed to export receipts.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------ NEW: Share images (Web Share API with files) ------------------ */
  async function onShareImages() {
    try {
      setBusy(true);
      const pngs: string[] = [];
      for (const r of rows) {
        const html = renderReceiptHtml(company, r, { width: 820 });
        const png = await captureHtmlToPng(html, 820, 1120, 2);
        pngs.push(png);
      }

      // Convert dataURLs to Blobs / Files
      const files: File[] = [];
      for (let i = 0; i < pngs.length; i++) {
        const dataUrl = pngs[i];
        const res = await (await fetch(dataUrl)).blob();
        const file = new File([res], `receipt-${i + 1}.png`, { type: "image/png" });
        files.push(file);
      }

      // If navigator.canShare files, share them (works on many mobile browsers)
      // navigator.canShare may not be present in all browsers.
      const nav: any = navigator;
      if (nav && nav.canShare && nav.canShare({ files })) {
        await nav.share({ files, title: company.name || "Receipts", text: `${company.name || ""} receipts` });
        return;
      }

      // Fallback: if single receipt, try navigator.share({files}) where supported
      if (nav && nav.share && files.length === 1) {
        await nav.share({ files, title: company.name || "Receipt", text: "Receipt" });
        return;
      }

      // Final fallback: save first PNG locally and open WhatsApp web with text
      // (WhatsApp web doesn't accept image data in the share URL — user will have to attach file manually)
      const firstText = buildShareText(rows, company, grandTotal);
      const encoded = encodeURIComponent(firstText + "\n\n(Attach the exported image from your downloads)");
      window.open(`https://wa.me/?text=${encoded}`, "_blank", "noopener");
    } catch (e: any) {
      setMsg(e?.message || "Failed to share images.");
    } finally {
      setBusy(false);
    }
  }

  async function onShare() {
    try {
      const title = company.name || "Receipt";
      const text = isMulti
        ? `Receipt (${rows.length} items) — ${money(grandTotal)}`
        : `Receipt ${single?.reference || single?.id} — ${money(single?.amount || 0)}`;
      if ("share" in navigator) {
        await (navigator as any).share({ title, text });
      } else {
        await onPrintPdf();
      }
    } catch { /* noop */ }
  }

  async function onShareText() {
    const text = buildShareText(rows, company, grandTotal);
    try {
      if ("share" in navigator) {
        await (navigator as any).share({ text, title: company.name || "Receipt" });
        return;
      }
    } catch { /* fallthrough to WhatsApp */ }
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, "_blank", "noopener");
  }

  async function onSaveEReceipt() {
    if (!single) {
      setMsg("Save eReceipt is available for single receipts only.");
      return;
    }
    if (limit !== Infinity && count >= limit) {
      setMsg(`You've reached your eReceipt limit for this plan (${count}/${limit}).`);
      return;
    }
    setSaving(true);
    try {
      const previewPng = await capturePng(containerRef.current!, { scale: 2 });
      const list = readEReceipts();
      const entry: EReceipt = {
        id: `${single.id}:${Date.now()}`,
        txId: single.id,
        savedAt: Date.now(),
        company: {
          name: company.name,
          address: company.address,
          email: company.email,
          phone: company.phone,
          logo: company.logo || null,
        },
        cashier: author
          ? { id: author.id, username: author.username, role: String(author.role), avatar: avatar || null }
          : undefined,
        payload: single,
        previewPng,
      };
      list.unshift(entry);
      writeEReceipts(list);
      setCount(list.length);
      setMsg("eReceipt saved.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save eReceipt.");
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ UI ------------------------------ */
  return (
    <Modal open={open} onClose={onClose} title="Receipt">
      {/* Capture/Print area */}
      <div
        ref={containerRef}
        className="overflow-hidden text-black bg-white shadow-sm rounded-2xl print:bg-white"
        style={{ maxWidth: 820, margin: "0 auto", border: "1px solid #e5e7eb" }}
      >
        {/* Ribbon header */}
        <div
          className="relative p-5 sm:p-7"
          style={{
            background:
              "linear-gradient(135deg, rgba(2,132,199,0.06), rgba(16,185,129,0.06))",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[24px] sm:text-[26px] font-extrabold tracking-tight">
                {company.name || "Your Company"}
              </div>
              {(company.address || company.email || company.phone) && (
                <div className="mt-1 text-[13px] text-neutral-700 space-y-0.5">
                  {company.address && <div className="truncate">{company.address}</div>}
                  {(company.email || company.phone) && (
                    <div className="truncate">
                      {company.email || ""}{company.email && company.phone ? " · " : ""}{company.phone || ""}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="w-16 h-16 overflow-hidden bg-white border shrink-0 sm:w-20 sm:h-20 rounded-xl border-neutral-200">
              {company.logo ? <img src={company.logo} className="object-cover w-full h-full" /> : null}
            </div>
          </div>
        </div>

        {/* Meta + Summary */}
        <div className="p-5 sm:p-7">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="p-3 border rounded-xl border-neutral-200">
              <div className="text-[11px] text-neutral-500">Date</div>
              <div className="font-semibold">{headerDate}</div>
              <div className="mt-2 text-[11px] text-neutral-500">Reference</div>
              <div className="font-semibold truncate">{headerRef}</div>
            </div>
            <div className="p-3 border rounded-xl border-neutral-200">
              <div className="text-[11px] text-neutral-500">Customer</div>
              <div className="font-semibold truncate">{headerCustomer}</div>
              <div className="mt-2 text-[11px] text-neutral-500">Method</div>
              <div className="font-semibold">{headerMethod}</div>
            </div>
            <div className="p-3 border rounded-xl border-neutral-200 bg-neutral-50">
              <div className="text-[11px] text-neutral-500">Total</div>
              <div className="text-[22px] font-extrabold">{money(grandTotal)}</div>
            </div>
          </div>

          {/* Items table */}
          <div className="mt-5 overflow-hidden border rounded-xl border-neutral-200">
            <table className="w-full text-[13px]">
              <thead className="bg-neutral-50 text-neutral-700">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-2 font-medium text-left">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">Unit</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const q = safeQty(r.qty);
                  const u = safeUnit(q, r.unit_price, r.amount);
                  const rowTotal = Number(r.amount) || q * u || 0;
                  return (
                    <tr key={r.id} className={i % 2 ? "bg-neutral-50/40" : ""}>
                      <td className="px-3 py-2">{r.description || "—"}</td>
                      <td className="px-3 py-2 text-right">{q}</td>
                      <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{money(u)}</td>
                      <td className="px-3 py-2 font-medium text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{money(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-neutral-200 bg-neutral-50/60">
                    <td className="px-3 py-2 font-semibold text-right" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 font-bold text-right">{money(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Cashier (single only) */}
          {!isMulti && author && (
            <div className="flex items-center gap-2 mt-5">
              <div className="flex items-center justify-center overflow-hidden rounded-full w-9 h-9 bg-neutral-200">
                {avatar ? (
                  <img src={avatar} className="object-cover w-full h-full" />
                ) : (
                  <span className="text-xs text-neutral-600">
                    {author.username.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="text-[12px] text-neutral-600">
                Processed by <b className="text-neutral-800">{author.username}</b>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action bar (with Save, Save as PNG, Share, Share as Text, Print) */}
      <div className="flex flex-wrap items-center gap-2 mt-4 print:hidden">
        <button
          type="button"
          className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
          onClick={onSaveEReceipt}
          disabled={isMulti || saving || (limit !== Infinity && count >= limit)}
          title={limit === Infinity ? "" : `Saved: ${count}/${limit}`}
        >
          {isMulti ? "Save (single only)" : saving ? "Saving…" : "Save"}
        </button>

        <button
          type="button"
          className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
          onClick={onSavePng}
          disabled={busy}
        >
          Save as PNG
        </button>

        <button
          type="button"
          className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
          onClick={onShare}
          disabled={busy}
        >
          Share
        </button>

        <button
          type="button"
          className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
          onClick={onShareText}
        >
          Share as Text
        </button>

        <button
          type="button"
          className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
          onClick={onPrintPdf}
        >
          Print / Save as PDF
        </button>

        {/* New multi-export/share buttons */}
        {rows.length > 1 && (
          <>
            <button
              type="button"
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={onPrintPdfMulti}
              disabled={busy}
            >
              Export all as PDF
            </button>

            <button
              type="button"
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={onShareImages}
              disabled={busy}
            >
              Share images (WhatsApp / share)
            </button>
          </>
        )}

        <span className="text-[12px] text-neutral-500 ml-auto">
          {limit === Infinity ? `Saved: ${count} · Unlimited` : `Saved: ${count}/${limit}`}
        </span>
        {msg && <span className="text-[12px] text-neutral-600">{msg}</span>}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </Modal>
  );
}

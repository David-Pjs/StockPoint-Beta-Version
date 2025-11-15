// TransactionsPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../ui/Card";
import Pill from "../../ui/Pill";

import {
  addTransaction,
  getTransactionsForDay,
  deleteTransaction,
  restoreTransaction,
  getDeletedTransactions,
  purgeDeletedTransaction,
  purgeAllDeletedTransactions,
  setPaidFlag,
  getPaidMap,
  isAdmin,
  money,
  type Transaction,
  type TxKind,
} from "../../spCore";

import { subscribeChanges } from "../../index"; // same-tab notifier
import Modal from "../../ui/Modal";
import { getCompany } from "../../lib/company";
import ReceiptModal from "./ReceiptModal";

import html2canvas from "html2canvas";

/* ---------- helpers ---------- */
function todayISO(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tz);
  return local.toISOString().slice(0, 10);
}

/* ---------- types ---------- */
type LineItem = {
  id: string;
  description: string;
  qty: string;
  unit_price: string;
  amount: string;
  dirty?: boolean;
};
const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `li_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const newItem = (): LineItem => ({
  id: makeId(),
  description: "",
  qty: "1",
  unit_price: "0",
  amount: "0.00",
});

const CUST_SET_KEY = "sp_custSet:v1";
const DESC_SET_KEY = "sp_descSet:v1";
function readSet(k: string): Set<string> {
  try {
    const r = localStorage.getItem(k);
    return r ? new Set(JSON.parse(r)) : new Set();
  } catch {
    return new Set();
  }
}
function writeSet(k: string, s: Set<string>) {
  try {
    localStorage.setItem(k, JSON.stringify([...s]));
  } catch {}
}

/* ---------- Quick-sale draft persistence (IndexedDB) ---------- */

type DraftPayload = {
  kind: TxKind;
  customer: string;
  method: string;
  reference: string;
  items: LineItem[];
};

const IDB_DRAFT_DB = "sp_quicksale_drafts";
const IDB_DRAFT_STORE = "drafts";
const IDB_DRAFT_KEY = "current";

function hasIndexedDB() {
  return typeof indexedDB !== "undefined";
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(IDB_DRAFT_DB, 1);
    req.onerror = () => reject(req.error || new Error("IndexedDB error"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_DRAFT_STORE)) {
        db.createObjectStore(IDB_DRAFT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function saveDraftToIdb(draft: DraftPayload): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDraftDb();
    const tx = db.transaction(IDB_DRAFT_STORE, "readwrite");
    tx.objectStore(IDB_DRAFT_STORE).put(draft, IDB_DRAFT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("tx error"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("tx abort"));
      };
    });
  } catch {
    // fail silently – UI must not break
  }
}

async function loadDraftFromIdb(): Promise<DraftPayload | null> {
  if (!hasIndexedDB()) return null;
  try {
    const db = await openDraftDb();
    return await new Promise<DraftPayload | null>((resolve, reject) => {
      const tx = db.transaction(IDB_DRAFT_STORE, "readonly");
      const store = tx.objectStore(IDB_DRAFT_STORE);
      const req = store.get(IDB_DRAFT_KEY);
      req.onsuccess = () => {
        const val = (req.result as DraftPayload | undefined) || null;
        db.close();
        resolve(val);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error("get error"));
      };
    });
  } catch {
    return null;
  }
}

async function clearDraftFromIdb(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDraftDb();
    const tx = db.transaction(IDB_DRAFT_STORE, "readwrite");
    tx.objectStore(IDB_DRAFT_STORE).delete(IDB_DRAFT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("tx error"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("tx abort"));
      };
    });
  } catch {
    // ignore
  }
}

/* ---------- Receipt bridge ---------- */
type TxReceipt = {
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

function qtyOf(t: Transaction): number {
  const q = Number((t as any).qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function unitOf(t: Transaction): number {
  const q = qtyOf(t);
  const u = Number((t as any).unit_price);
  if (Number.isFinite(u)) return u;
  const derived = q > 0 ? t.amount / q : t.amount;
  return Number.isFinite(derived) ? derived : 0;
}
function toReceipt(t: Transaction): TxReceipt {
  return {
    id: t.id,
    occurred_on: t.occurred_on,
    customer_name: t.customer_name ?? null,
    description: t.description ?? null,
    qty: qtyOf(t),
    unit_price: unitOf(t),
    amount: t.amount,
    method: t.method ?? null,
    reference: t.reference ?? null,
  };
}

/* ----- invoice paging (for multi-page PNGs) ----- */
const MAX_ITEMS_PER_PAGE = 18; // hard limit per invoice page

function chunkItems<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/* ================= PNG capture helpers ================= */
async function captureElementAsPngBlob(el: HTMLElement, scale = 1): Promise<Blob> {
  const clone = el.cloneNode(true) as HTMLElement;
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.zIndex = "999999";
  container.style.background = "#ffffff";
  container.appendChild(clone);
  document.body.appendChild(container);

  clone.style.boxSizing = "border-box";
  clone.style.width = "760px";
  clone.style.maxWidth = "760px";
  clone.style.overflow = "visible";

  const innerEls = clone.querySelectorAll<HTMLElement>("*");
  innerEls.forEach((n) => {
    n.style.maxHeight = "none";
    n.style.overflow = "visible";
  });

  await new Promise((r) => requestAnimationFrame(r));

  const canvas = await html2canvas(clone, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: clone.scrollWidth,
    height: clone.scrollHeight,
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? null), "image/png")
  );
  document.body.removeChild(container);
  if (!blob) throw new Error("Capture failed");
  return blob;
}
function downloadBlobAsPng(blob: Blob, filename = "invoice.png") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return blob;
}
async function tryShareImageBlob(blob: Blob, filename = "invoice.png") {
  try {
    const file = new File([blob], filename, { type: blob.type });
    // @ts-ignore
    if (navigator && (navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
      // @ts-ignore
      await (navigator as any).share({ files: [file], title: filename, text: "Invoice" });
      return true;
    }
  } catch {}
  return false;
}

/* ================= Reusable receipt view ================= */
function ReceiptView({
  meta,
  items,
  company,
}: {
  meta: { customer: string; invoiceRef: string; date: string; method?: string };
  items: { description: string; qty: number; unit: number; total: number }[];
  company: ReturnType<typeof getCompany>;
}) {
  const subtotal = items.reduce((s, it) => s + (Number(it.total) || 0), 0);
  return (
    <div
      id="sp-receipt-card"
      style={{
        width: 760,
        maxWidth: "100%",
        boxSizing: "border-box",
        fontFamily: "Inter, Arial, sans-serif",
        color: "#0f1724",
        padding: 18,
        background: "#ffffff",
        borderRadius: 12,
        border: "1px solid #e6eef6",
        boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: "#0b1220", letterSpacing: 0.3 }}>
            {company.name || "Your Company"}
          </div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
            {company.address && <div>Address: {company.address}</div>}
            {company.phone && <div>Phone: {company.phone}</div>}
            {company.email && <div>Email: {company.email}</div>}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              textTransform: "uppercase",
              fontWeight: 800,
              fontSize: 22,
              color: "#0b1220",
              letterSpacing: 2,
            }}
          >
            INVOICE
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>#{meta.invoiceRef}</div>
        </div>
      </div>

      <div style={{ height: 6, background: "#0f62ff", margin: "14px 0", borderRadius: 999 }} />

      {/* Meta blocks */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "stretch",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 220,
            padding: 12,
            border: "1px solid #eef2f7",
            borderRadius: 10,
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Invoice to
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>
            {meta.customer || "Customer"}
          </div>
        </div>

        <div
          style={{
            width: 260,
            minWidth: 220,
            padding: 12,
            border: "1px solid #eef2f7",
            borderRadius: 10,
            background: "#f9fafb",
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280" }}>Invoice #</div>
          <div style={{ fontWeight: 800, fontSize: 13, wordBreak: "break-word" }}>
            {meta.invoiceRef}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>Date</div>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{meta.date}</div>
          {meta.method ? (
            <>
              <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>Payment</div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  textTransform: "capitalize",
                }}
              >
                {meta.method}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Items table */}
      <div style={{ overflow: "hidden", borderRadius: 10, border: "1px solid #eef2f7" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            tableLayout: "fixed",
            wordBreak: "break-word",
          }}
        >
          <thead style={{ background: "#0b1220", color: "#fff" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10, width: "55%" }}>Description</th>
              <th style={{ textAlign: "right", padding: 10, width: "15%" }}>Qty</th>
              <th style={{ textAlign: "right", padding: 10, width: "15%" }}>Unit</th>
              <th style={{ textAlign: "right", padding: 10, width: "15%" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#f9fafb" : "#ffffff" }}>
                <td style={{ padding: 10 }}>{it.description || "-"}</td>
                <td style={{ padding: 10, textAlign: "right" }}>{it.qty}</td>
                <td style={{ padding: 10, textAlign: "right" }}>{money(it.unit)}</td>
                <td
                  style={{
                    padding: 10,
                    textAlign: "right",
                    fontWeight: 700,
                  }}
                >
                  {money(it.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13 }}>
            Sub Total: <span style={{ fontWeight: 800 }}>{money(subtotal)}</span>
          </div>
          <div
            style={{
              fontSize: 16,
              marginTop: 8,
              color: "#0f62ff",
              fontWeight: 800,
            }}
          >
            Total: {money(subtotal)}
          </div>
        </div>
      </div>

      {/* Footer – small and stacked, no overlap */}
      <div
        style={{
          borderTop: "1px solid #eef2f7",
          marginTop: 14,
          paddingTop: 8,
        }}
      >
        <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.4 }}>
          {company.phone && <div>Phone: {company.phone}</div>}
          {company.email && <div>Email: {company.email}</div>}
          {company.address && <div>Address: {company.address}</div>}
          {!company.phone && !company.email && !company.address && <div>-</div>}
        </div>
      </div>
    </div>
  );
}

/* ================= InvoicePreviewModal (saved receipts) ================= */
function InvoicePreviewModal({
  open,
  receipts,
  onClose,
  company,
}: {
  open: boolean;
  receipts: TxReceipt[];
  onClose: () => void;
  company: ReturnType<typeof getCompany>;
}) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIndex(0);
    setBusy(false);
  }, [open, receipts]);

  if (!open || !receipts || receipts.length === 0) return null;

  const current = receipts[index];

  function itemsFromReceipt(r: TxReceipt) {
    return [
      {
        description: r.description || "-",
        qty: r.qty || 1,
        unit: r.unit_price || 0,
        total: r.amount || 0,
      },
    ];
  }

  const combinedItems = receipts.flatMap((r) => itemsFromReceipt(r));
  const singleItems = itemsFromReceipt(current);
  const baseItems = receipts.length > 1 ? combinedItems : singleItems;
  const pages = chunkItems(baseItems, MAX_ITEMS_PER_PAGE);

  async function downloadPng() {
    if (!previewRef.current) return alert("Not ready");
    setBusy(true);
    try {
      const pageEls =
        previewRef.current.querySelectorAll<HTMLElement>(".sp-receipt-page");
      const ts = Date.now();

      if (!pageEls.length) {
        const blob = await captureElementAsPngBlob(previewRef.current, 1);
        downloadBlobAsPng(blob, `invoice-batch-${ts}.png`);
      } else if (pageEls.length === 1) {
        const blob = await captureElementAsPngBlob(pageEls[0], 1);
        downloadBlobAsPng(blob, `invoice-batch-${ts}.png`);
      } else {
        for (let i = 0; i < pageEls.length; i++) {
          const blob = await captureElementAsPngBlob(pageEls[i], 1);
          downloadBlobAsPng(blob, `invoice-batch-${ts}-p${i + 1}.png`);
        }
      }
    } catch (e: any) {
      alert(e?.message || "Failed to create PNG");
    } finally {
      setBusy(false);
    }
  }

  async function sharePng() {
    if (!previewRef.current) return alert("Not ready");
    setBusy(true);
    try {
      const pageEls =
        previewRef.current.querySelectorAll<HTMLElement>(".sp-receipt-page");
      const ts = Date.now();

      if (!pageEls.length || pageEls.length === 1) {
        const target = pageEls[0] || previewRef.current;
        const blob = await captureElementAsPngBlob(target, 1);
        const shared = await tryShareImageBlob(
          blob,
          `invoice-batch-${ts}.png`
        );
        if (!shared) {
          downloadBlobAsPng(blob, `invoice-batch-${ts}.png`);
          const text = encodeURIComponent(
            "I've downloaded the invoice PNG. Please attach it to the chat."
          );
          window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
        }
      } else {
        const blobs: Blob[] = [];
        for (let i = 0; i < pageEls.length; i++) {
          blobs.push(await captureElementAsPngBlob(pageEls[i], 1));
        }

        let shared = false;
        try {
          const files = blobs.map(
            (b, i) =>
              new File(
                [b],
                `invoice-batch-${ts}-p${i + 1}.png`,
                { type: b.type }
              )
          );
          // @ts-ignore
          if (
            navigator &&
            (navigator as any).canShare &&
            (navigator as any).canShare({ files })
          ) {
            // @ts-ignore
            await (navigator as any).share({
              files,
              title: "Invoice batch",
              text: "Invoice batch from StockPoint",
            });
            shared = true;
          }
        } catch {
          shared = false;
        }

        if (!shared) {
          blobs.forEach((b, i) =>
            downloadBlobAsPng(b, `invoice-batch-${ts}-p${i + 1}.png`)
          );
          const text = encodeURIComponent(
            "I've downloaded the invoice PNGs. Please attach them to the chat."
          );
          window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
        }
      }
    } catch (e: any) {
      alert(e?.message || "Failed to share PNG");
    } finally {
      setBusy(false);
    }
  }

  function printReceipt() {
    if (!previewRef.current) return alert("Not ready");
    const clone = previewRef.current.cloneNode(true) as HTMLElement;
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font-family:Inter,Arial,sans-serif;margin:12px;color:#0f1724}
      table{border-collapse:collapse;width:100%;table-layout:fixed;word-break:break-word}th,td{padding:8px}
      @media print{body{margin:6mm}}
    </style></head><body>${clone.outerHTML}<script>setTimeout(()=>window.print(),200)</script></body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return alert("Pop-up blocked. Allow pop-ups to print.");
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  const rightMeta =
    receipts.length > 1
      ? {
          customer: receipts[0].customer_name || "Customer",
          // short, clean batch ref: BATCH-YYYYMMDD-N
          invoiceRef: `BATCH-${
            (receipts[0].occurred_on || "").replace(/-/g, "") || "SP"
          }-${receipts.length}`,
          date: receipts[0].occurred_on || "",
          method:
            receipts
              .map((r) => r.method)
              .filter(Boolean)
              .join(", ") || "-",
        }
      : {
          customer: current.customer_name || "Customer",
          invoiceRef: current.reference || current.id,
          date: current.occurred_on || "",
          method: current.method || "-",
        };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Preview (${receipts.length} invoice${
        receipts.length > 1 ? "s" : ""
      })`}
    >
      <div
        className="flex flex-col gap-4 md:grid md:grid-cols-6"
        style={{ alignItems: "stretch" }}
      >
        {/* Left panel: list + actions */}
        <div
          className="md:col-span-2"
          style={{
            padding: 12,
            borderRadius: 16,
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button
              className="btn-ghost"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              Prev
            </button>
            <button
              className="btn-ghost"
              onClick={() =>
                setIndex((i) => Math.min(receipts.length - 1, i + 1))
              }
              disabled={index === receipts.length - 1}
            >
              Next
            </button>
            <div
              style={{
                marginLeft: "auto",
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              {index + 1}/{receipts.length}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxHeight: "40vh",
              overflowY: "auto",
            }}
          >
            {receipts.map((x, i) => (
              <div
                key={x.id}
                onClick={() => setIndex(i)}
                style={{
                  cursor: "pointer",
                  padding: 10,
                  borderRadius: 10,
                  background:
                    i === index ? "rgba(59,130,246,0.16)" : "transparent",
                  border:
                    i === index
                      ? "1px solid rgba(59,130,246,0.5)"
                      : "1px solid transparent",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {x.customer_name || "Customer"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {(x.reference || x.id).split("|")[0]} • {x.occurred_on}
                </div>
                <div style={{ marginTop: 6, fontWeight: 800 }}>
                  {money(x.amount)}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <button className="btn" onClick={downloadPng} disabled={busy}>
              {busy ? "Working…" : "Download PNG"}
            </button>
            <button className="btn" onClick={sharePng} disabled={busy}>
              {busy ? "Working…" : "Share PNG"}
            </button>
            <button className="btn-ghost" onClick={printReceipt}>
              Print
            </button>
          </div>
        </div>

        {/* Right panel: invoice pages */}
        <div
          className="md:col-span-4"
          style={{
            padding: 12,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            ref={previewRef as any}
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            {pages.map((pageItems, idx) => (
              <div
                key={idx}
                className="sp-receipt-page"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {pages.length > 1 && (
                  <div
                    style={{
                      alignSelf: "flex-end",
                      marginBottom: 6,
                      fontSize: 11,
                      color: "#6b7280",
                    }}
                  >
                    Page {idx + 1} of {pages.length}
                  </div>
                )}
                <ReceiptView
                  meta={rightMeta}
                  items={pageItems}
                  company={company}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/* =================== Main TransactionsPage =================== */
export default function TransactionsPage() {
  const [currentDate, setCurrentDate] = useState<string>(todayISO());
  const [kind, setKind] = useState<TxKind>("income");
  const [customer, setCustomer] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [items, setItems] = useState<LineItem[]>([newItem()]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paidMap, setPaidMapState] = useState<Record<string, boolean>>(
    () => getPaidMap()
  );
  const [filterKind, setFilterKind] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [custSet, setCustSet] = useState<Set<string>>(() =>
    readSet(CUST_SET_KEY)
  );
  const [descSet, setDescSet] = useState<Set<string>>(() =>
    readSet(DESC_SET_KEY)
  );
  const admin = isAdmin();
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<Transaction[]>([]);
  const [invoicePreviewOpen, setInvoicePreviewOpen] = useState(false);
  const [invoicePreviewRows, setInvoicePreviewRows] = useState<TxReceipt[]>(
    []
  );
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<TxReceipt | TxReceipt[] | null>(
    null
  );
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const company = getCompany();
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [pulse, setPulse] = useState(0);

  // --- load quick-sale draft from IndexedDB on first mount ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadDraftFromIdb();
      if (!draft || cancelled) return;
      setKind(draft.kind);
      setCustomer(draft.customer);
      setMethod(draft.method);
      setReference(draft.reference);
      if (draft.items && draft.items.length > 0) {
        setItems(draft.items.map((it) => ({ ...it })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- keep draft in IndexedDB so quick-sale table never clears until deleted ---
  useEffect(() => {
    const hasContent =
      customer.trim().length > 0 ||
      method.trim().length > 0 ||
      reference.trim().length > 0 ||
      items.some(
        (it) =>
          it.description.trim().length > 0 ||
          (parseFloat(it.amount || "0") || 0) > 0 ||
          (parseFloat(it.qty || "0") || 0) > 0 ||
          (parseFloat(it.unit_price || "0") || 0) > 0
      );

    if (!hasContent) {
      // nothing meaningful – clear stored draft
      clearDraftFromIdb();
      return;
    }

    const draft: DraftPayload = {
      kind,
      customer,
      method,
      reference,
      items,
    };
    saveDraftToIdb(draft);
  }, [kind, customer, method, reference, items]);

  useEffect(() => {
    refreshDay();
    // eslint-disable-next-line
  }, [currentDate]);

  useEffect(() => {
    const cb = () => setPulse((p) => p + 1);
    const off = subscribeChanges(cb);
    const onDom = () => cb();
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "__sp_changed__") return;
      cb();
    };
    window.addEventListener("sp:changed", onDom);
    window.addEventListener("storage", onStorage);
    return () => {
      off();
      window.removeEventListener("sp:changed", onDom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    refreshDay();
    if (showTrash) refreshTrash();
    // eslint-disable-next-line
  }, [pulse, showTrash]);

  useEffect(() => {
    if (showTrash) refreshTrash();
    // eslint-disable-next-line
  }, [showTrash, currentDate]);

  const totals = useMemo(() => {
    let inc = 0,
      exp = 0;
    transactions.forEach((t) =>
      t.kind === "income" ? (inc += t.amount) : (exp += t.amount)
    );
    return { income: inc, expense: exp, net: inc - exp };
  }, [transactions]);

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + (parseFloat(it.amount || "0") || 0),
        0
      ),
    [items]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (filterKind !== "all" && t.kind !== filterKind) return false;
      const paid = !!paidMap[t.id];
      if (paidFilter === "paid" && !paid) return false;
      if (paidFilter === "unpaid" && paid) return false;
      if (!s) return true;
      return (
        (t.customer_name || "").toLowerCase().includes(s) ||
        (t.description || "").toLowerCase().includes(s) ||
        (t.reference || "").toLowerCase().includes(s)
      );
    });
  }, [transactions, filterKind, paidFilter, search, paidMap]);

  function refreshDay() {
    const list = getTransactionsForDay(currentDate);
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    setTransactions(list);

    const cs = new Set(custSet),
      ds = new Set(descSet);
    list.forEach((t) => {
      if (t.customer_name) cs.add(t.customer_name);
      if (t.description) ds.add(t.description);
    });
    setCustSet(cs);
    setDescSet(ds);
    writeSet(CUST_SET_KEY, cs);
    writeSet(DESC_SET_KEY, ds);

    setPaidMapState({ ...getPaidMap() });
  }

  function refreshTrash() {
    const all = getDeletedTransactions();
    const sameDay = all.filter((t) => t.occurred_on === currentDate);
    sameDay.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    setTrash(sameDay);
  }

  function recalc(it: LineItem): LineItem {
    if (it.dirty) return it;
    const q = parseFloat(it.qty || "0");
    const u = parseFloat(it.unit_price || "0");
    return { ...it, amount: (q * u).toFixed(2) };
  }
  function setItem<K extends keyof LineItem>(
    id: string,
    key: K,
    val: LineItem[K]
  ) {
    setItems((prev) =>
      prev.map((x) => (x.id === id ? recalc({ ...x, [key]: val }) : x))
    );
  }
  function setItemAmount(id: string, val: string) {
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, amount: val, dirty: true } : x))
    );
  }
  function addItem() {
    setItems((p) => [...p, newItem()]);
  }
  function removeItem(id: string) {
    setItems((p) => (p.length > 1 ? p.filter((x) => x.id !== id) : p));
  }

  function saveBatch() {
    setErr("");
    const normalized = items.map(recalc);

    const valid = normalized.filter((it) => {
      const amt = parseFloat(it.amount || "0");
      return (
        it.description.trim().length > 0 &&
        Number.isFinite(amt) &&
        amt > 0
      );
    });
    if (!customer.trim()) {
      setErr("Add a customer name.");
      return;
    }
    if (valid.length === 0) {
      setErr("Add at least one line with description and amount.");
      return;
    }

    const group = `SP-${currentDate.replace(/-/g, "")}-${makeId().slice(
      0,
      8
    )}`;

    try {
      for (const it of valid) {
        addTransaction({
          kind,
          customer_name: customer.trim(),
          description: it.description.trim(),
          qty: parseFloat(it.qty || "0"),
          unit_price: parseFloat(it.unit_price || "0"),
          amount: parseFloat(it.amount || "0"),
          method: method || null,
          reference: reference ? `${reference} | ${group}` : group,
          occurred_on: currentDate,
        });
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to save.");
      return;
    }

    const cs = new Set(custSet).add(customer.trim());
    const ds = new Set(descSet);
    valid.forEach((v) => ds.add(v.description.trim()));
    setCustSet(cs);
    setDescSet(ds);
    writeSet(CUST_SET_KEY, cs);
    writeSet(DESC_SET_KEY, ds);

    setItems([newItem()]);
    setMethod("");
    setReference("");
    refreshDay();

    // clear quick-sale draft from IndexedDB after successful save
    clearDraftFromIdb();

    try {
      localStorage.setItem("__sp_changed__", String(Date.now()));
    } catch {}
  }

  function togglePaid(id: string) {
    const paid = !!paidMap[id];
    setPaidFlag(id, !paid);
    setPaidMapState({ ...getPaidMap() });
  }

  function removeTx(id: string) {
    const snap = transactions.find((t) => t.id === id);
    if (!snap) return;
    if (!window.confirm("Delete this transaction? You can Undo.")) return;

    deleteTransaction(id, "user-delete");
    refreshDay();
    if (showTrash) refreshTrash();

    const undoSecs = 8;
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#0f1722;border:1px solid var(--line);padding:10px 14px;border-radius:12px;z-index:9999;display:flex;gap:8px;align-items:center";
    bar.innerHTML =
      `<span>Deleted.</span><button id="sp-undo" class="btn-ghost">Undo</button>`;
    document.body.appendChild(bar);

    let undone = false;
    const timer = setTimeout(() => {
      if (!undone && document.body.contains(bar))
        document.body.removeChild(bar);
    }, undoSecs * 1000);

    bar.querySelector("#sp-undo")?.addEventListener("click", () => {
      undone = true;
      clearTimeout(timer);
      restoreTransaction(id);
      refreshDay();
      if (showTrash) refreshTrash();
      if (document.body.contains(bar)) document.body.removeChild(bar);
    });
  }

  function openReceiptFor(t: Transaction) {
    const rr = [toReceipt(t)];
    setInvoicePreviewRows(rr);
    setInvoicePreviewOpen(true);
  }

  function openSelectedReceipt() {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) {
      alert("Select one or more transactions to open a receipt.");
      return;
    }
    const rows = filtered.filter((x) => ids.includes(x.id)).map(toReceipt);
    setInvoicePreviewRows(rows);
    setInvoicePreviewOpen(true);
  }

  function toggleSelectAll(e: React.ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    const next: Record<string, boolean> = {};
    filtered.forEach((t) => (next[t.id] = checked));
    setSelected(next);
  }

  function bulkMarkPaid(flag: boolean) {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (ids.length === 0) return;
    ids.forEach((id) => setPaidFlag(id, flag));
    setPaidMapState({ ...getPaidMap() });
  }

  function previewWhatsAppText() {
    const lines: string[] = [];
    lines.push(`${company.name || "Your Company"}`);
    const meta = [company.address, company.email, company.phone]
      .filter(Boolean)
      .join(" • ");
    if (meta) lines.push(meta);
    lines.push("");
    lines.push(`Customer: ${customer || "-"}`);
    if (reference) lines.push(`Ref: ${reference}`);
    if (method) lines.push(`Method: ${method}`);
    lines.push("");
    lines.push("Items:");
    lines.push("Desc | Qty | Unit | Total");
    items
      .map(recalc)
      .filter((it) => it.description.trim() && Number(it.amount) > 0)
      .forEach((it) => {
        const q = parseFloat(it.qty || "0") || 0;
        const u = parseFloat(it.unit_price || "0") || 0;
        const tot = parseFloat(it.amount || "0") || 0;
        lines.push(`${it.description} | ${q} | ${money(u)} | ${money(tot)}`);
      });
    lines.push("");
    lines.push(`Subtotal: ${money(subtotal)}`);
    return lines.join("\n");
  }
  function sharePreviewWhatsApp() {
    const text = encodeURIComponent(previewWhatsAppText());
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
  }

  // unsaved preview refs & helpers (uses same ReceiptView)
  const unsavedPreviewRef = useRef<HTMLDivElement | null>(null);
  async function downloadUnsavedPreviewPng() {
    if (!unsavedPreviewRef.current) return alert("Preview not ready.");
    setPreviewBusy(true);
    try {
      const pageEls =
        unsavedPreviewRef.current.querySelectorAll<HTMLElement>(
          ".sp-receipt-page"
        );
      const ts = Date.now();

      if (!pageEls.length) {
        const blob = await captureElementAsPngBlob(
          unsavedPreviewRef.current,
          1
        );
        downloadBlobAsPng(blob, `invoice-preview-${ts}.png`);
      } else if (pageEls.length === 1) {
        const blob = await captureElementAsPngBlob(pageEls[0], 1);
        downloadBlobAsPng(blob, `invoice-preview-${ts}.png`);
      } else {
        for (let i = 0; i < pageEls.length; i++) {
          const blob = await captureElementAsPngBlob(pageEls[i], 1);
          downloadBlobAsPng(blob, `invoice-preview-${ts}-p${i + 1}.png`);
        }
      }
    } catch (e: any) {
      alert(e?.message || "Failed to create PNG");
    } finally {
      setPreviewBusy(false);
    }
  }
  async function shareUnsavedPreviewPng() {
    if (!unsavedPreviewRef.current) return alert("Preview not ready.");
    setPreviewBusy(true);
    try {
      const pageEls =
        unsavedPreviewRef.current.querySelectorAll<HTMLElement>(
          ".sp-receipt-page"
        );
      const ts = Date.now();

      if (!pageEls.length || pageEls.length === 1) {
        const target = pageEls[0] || unsavedPreviewRef.current;
        const blob = await captureElementAsPngBlob(target, 1);
        const shared = await tryShareImageBlob(
          blob,
          `invoice-preview-${ts}.png`
        );
        if (!shared) {
          downloadBlobAsPng(blob, `invoice-preview-${ts}.png`);
          const text = encodeURIComponent(
            "I've downloaded the invoice PNG. Please attach it to the chat."
          );
          window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
        }
      } else {
        const blobs: Blob[] = [];
        for (let i = 0; i < pageEls.length; i++) {
          blobs.push(await captureElementAsPngBlob(pageEls[i], 1));
        }

        let shared = false;
        try {
          const files = blobs.map(
            (b, i) =>
              new File(
                [b],
                `invoice-preview-${ts}-p${i + 1}.png`,
                { type: b.type }
              )
          );
          // @ts-ignore
          if (
            navigator &&
            (navigator as any).canShare &&
            (navigator as any).canShare({ files })
          ) {
            // @ts-ignore
            await (navigator as any).share({
              files,
              title: "Invoice preview",
              text: "Invoice preview from StockPoint",
            });
            shared = true;
          }
        } catch {
          shared = false;
        }

        if (!shared) {
          blobs.forEach((b, i) =>
            downloadBlobAsPng(
              b,
              `invoice-preview-${ts}-p${i + 1}.png`
            )
          );
          const text = encodeURIComponent(
            "I've downloaded the invoice PNGs. Please attach them to the chat."
          );
          window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
        }
      }
    } catch (e: any) {
      alert(e?.message || "Failed to share PNG");
    } finally {
      setPreviewBusy(false);
    }
  }
  function printUnsavedPreview() {
    if (!unsavedPreviewRef.current) return alert("Preview not ready.");
    const clone = unsavedPreviewRef.current.cloneNode(true) as HTMLElement;
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{font-family:Inter,Arial,sans-serif;margin:12px;color:#0f1724}table{border-collapse:collapse;width:100%;table-layout:fixed;word-break:break-word}th,td{padding:8px}@media print{body{margin:6mm}}
    </style></head><body>${clone.outerHTML}<script>setTimeout(()=>window.print(),200)</script></body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return alert("Pop-up blocked. Allow pop-ups to print.");
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // unsaved preview metadata + items for ReceiptView
  const unsavedMeta = {
    customer: customer || "-",
    invoiceRef: reference || `PREVIEW-${makeId().slice(0, 6)}`,
    date: todayISO(),
    method: method || "-",
  };
  const unsavedItems = items
    .map(recalc)
    .filter((it) => it.description.trim() && Number(it.amount) > 0)
    .map((it) => ({
      description: it.description,
      qty: Number(it.qty) || 1,
      unit: Number(it.unit_price) || 0,
      total: Number(it.amount) || 0,
    }));
  const unsavedPages = chunkItems(unsavedItems, MAX_ITEMS_PER_PAGE);

  return (
    <div className="grid gap-4">
      {/* Header */}
      <Card>
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Quick Sales & Expenses
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <label className="label">Day</label>
            <input
              className="w-auto control"
              type="date"
              value={currentDate}
              onChange={(e) => setCurrentDate(e.target.value || todayISO())}
            />
            <button
              className="btn-ghost"
              onClick={() => setCurrentDate(todayISO())}
            >
              Today
            </button>
            <button className="btn-ghost" onClick={refreshDay}>
              Refresh
            </button>
            {admin && (
              <label className="flex items-center gap-2 ml-2 text-sm">
                <input
                  type="checkbox"
                  checked={showTrash}
                  onChange={(e) => setShowTrash(e.target.checked)}
                />
                <span>Show Trash</span>
              </label>
            )}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Pill label="Total Income" value={money(totals.income)} color="ok" />
          <Pill
            label="Total Expense"
            value={money(totals.expense)}
            color="bad"
          />
          <Pill
            label="Net"
            value={money(totals.net)}
            color={totals.net >= 0 ? "ok" : "bad"}
          />
        </div>
      </Card>

      {/* Entry */}
      <Card>
        <h2 className="mb-3 text-xl font-bold">Add Transaction</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-12">
            <span className="label">Type</span>
            <div className="segment">
              <input
                id="t-income"
                type="radio"
                name="type"
                value="income"
                checked={kind === "income"}
                onChange={() => setKind("income")}
              />
              <label htmlFor="t-income" className="positive">
                Income
              </label>
              <input
                id="t-expense"
                type="radio"
                name="type"
                value="expense"
                checked={kind === "expense"}
                onChange={() => setKind("expense")}
              />
              <label htmlFor="t-expense" className="negative">
                Expense
              </label>
            </div>
          </div>

          <div className="field md:col-span-6">
            <label className="label">Customer Name</label>
            <input
              className="control"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              list="customerList"
              placeholder="e.g., Best Customer Ltd."
            />
            <datalist id="customerList">
              {[...custSet]
                .slice(0, 100)
                .sort()
                .map((v) => (
                  <option key={v} value={v} />
                ))}
            </datalist>
          </div>

          <div className="field md:col-span-3">
            <label className="label">Method</label>
            <select
              className="select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">—</option>
              <option>cash</option>
              <option>transfer</option>
              <option>POS</option>
            </select>
          </div>

          <div className="field md:col-span-3">
            <label className="label">Reference / Note</label>
            <input
              className="control"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="optional note or bank ref"
            />
          </div>
        </div>

        {/* Line items */}
        <div className="mt-4">
          {/* Mobile layout */}
          <div className="grid gap-3 md:hidden">
            {items.map((it, idx) => (
              <div key={it.id} className="card">
                <div className="field">
                  <label className="label">Description</label>
                  <input
                    className="control"
                    value={it.description}
                    onChange={(e) =>
                      setItem(it.id, "description", e.target.value)
                    }
                    list="descList"
                    placeholder="e.g., iPhone case"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field">
                    <label className="label">Qty</label>
                    <input
                      className="control"
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.qty}
                      onChange={(e) =>
                        setItem(it.id, "qty", e.target.value)
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label">Unit (₦)</label>
                    <div className="input-wrap">
                      <span className="input-prefix">₦</span>
                      <input
                        className="control with-prefix"
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.unit_price}
                        onChange={(e) =>
                          setItem(it.id, "unit_price", e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label className="label">Amount (₦)</label>
                  <div className="input-wrap">
                    <span className="input-prefix">₦</span>
                    <input
                      className="control with-prefix"
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.amount}
                      onChange={(e) =>
                        setItemAmount(it.id, e.target.value)
                      }
                      placeholder="auto (qty × unit)"
                    />
                  </div>
                </div>
                <div className="flex justify-between mt-2">
                  <span className="muted">Item {idx + 1}</span>
                  <button
                    className="btn-ghost"
                    onClick={() => removeItem(it.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop layout – table, aligned columns */}
          <div className="hidden overflow-auto md:block">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="sticky top-0 bg-[#0f1722]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                    Description
                  </th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[120px] text-right">
                    Qty
                  </th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[160px] text-right">
                    Unit (₦)
                  </th>
                  <th className="px-3 py-2 font-extrabold text-[var(--muted)] w-[180px] text-right">
                    Amount (₦)
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr
                    key={it.id}
                    className={idx % 2 ? "bg-[#0e1526]/30" : ""}
                  >
                    <td className="px-3 py-2 align-middle">
                      <input
                        className="control"
                        value={it.description}
                        onChange={(e) =>
                          setItem(it.id, "description", e.target.value)
                        }
                        list="descList"
                        placeholder="description"
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <input
                        className="text-right control"
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.qty}
                        onChange={(e) =>
                          setItem(it.id, "qty", e.target.value)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="input-wrap">
                        <span className="input-prefix">₦</span>
                        <input
                          className="text-right control with-prefix"
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.unit_price}
                          onChange={(e) =>
                            setItem(it.id, "unit_price", e.target.value)
                          }
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="input-wrap">
                        <span className="input-prefix">₦</span>
                        <input
                          className="text-right control with-prefix"
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.amount}
                          onChange={(e) =>
                            setItemAmount(it.id, e.target.value)
                          }
                          placeholder="auto (qty × unit)"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <button
                        className="btn-ghost"
                        onClick={() => removeItem(it.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="descList">
            {[...descSet]
              .slice(0, 100)
              .sort()
              .map((v) => (
                <option key={v} value={v} />
              ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-3 mt-3 md:flex-row md:items-center md:justify-between">
          <button
            className="w-full btn-ghost md:w-auto"
            onClick={addItem}
          >
            + Add another item
          </button>
          <div className="text-right">
            <div className="text-sm text-[var(--muted)]">Subtotal</div>
            <div className="text-2xl font-extrabold">
              {money(subtotal)}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-3 md:flex-row md:items-center">
          {err && <span className="err md:flex-1">{err}</span>}
          <button
            className="btn-ghost"
            onClick={() => setPreviewOpen(true)}
          >
            Preview Receipt
          </button>
          <button
            className="btn md:ml-auto"
            onClick={saveBatch}
          >
            Save
          </button>
        </div>
      </Card>

      {/* LIST */}
      <Card>
        <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-center">
          <h2 className="text-lg font-bold">
            Transactions —{" "}
            <span className="text-[var(--muted)]">{currentDate}</span>
          </h2>
          <div className="flex flex-col gap-2 md:ml-auto sm:flex-row sm:flex-wrap sm:items-center">
            <select
              className="w-full select sm:w-auto"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
            >
              <option value="all">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <select
              className="w-full select sm:w-auto"
              value={paidFilter}
              onChange={(e) => setPaidFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
            <input
              className="control w-full sm:w-[240px]"
              placeholder="Search customer / description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 ml-0 text-sm sm:ml-2">
              <input
                type="checkbox"
                checked={selectMode}
                onChange={(e) => {
                  setSelectMode(e.target.checked);
                  setSelected({});
                }}
              />
              <span>Select receipts</span>
            </label>

            {selectMode ? (
              <>
                <button
                  className="btn-ghost"
                  onClick={openSelectedReceipt}
                >
                  Open receipt for selected
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => bulkMarkPaid(true)}
                >
                  Mark selected Paid
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => bulkMarkPaid(false)}
                >
                  Mark selected Unpaid
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn-ghost"
                  onClick={openSelectedReceipt}
                  disabled
                >
                  Open receipt for selected
                </button>
              </>
            )}
          </div>
        </div>

        {/* Responsive list: cards on mobile, table on md+ */}
        <div className="grid gap-2 md:hidden">
          {filtered.length === 0 ? (
            <div className="p-3 rounded bg-[#07132b] text-center text-[var(--muted)]">
              No transactions for {currentDate}.
            </div>
          ) : (
            filtered.map((t) => {
              const isPaid = !!paidMap[t.id];
              const q = qtyOf(t);
              const u = unitOf(t);
              return (
                <div
                  key={t.id}
                  className="p-3 rounded-lg bg-[#07132b] border border-[#10203a]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">
                          {t.customer_name || "—"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(t.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {t.description || "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-extrabold">
                        {money(t.amount)}
                      </div>
                      <div className="text-xs">
                        {t.kind} • {isPaid ? "Paid" : "Unpaid"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      className="btn-ghost"
                      onClick={() => togglePaid(t.id)}
                    >
                      {isPaid ? "Mark Unpaid" : "Mark Paid"}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => openReceiptFor(t)}
                    >
                      Receipt
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => removeTx(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="w-full border-collapse text-[0.94rem]">
            <thead className="sticky top-0 bg-[#0f1722]">
              <tr className="text-left">
                {selectMode && (
                  <th className="px-3 py-2 w-[44px]">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={
                        filtered.length > 0 &&
                        filtered.every((t) => selected[t.id])
                      }
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Date/Time
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Customer
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Type
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Qty
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Unit (₦)
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Amount (₦)
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Description
                </th>
                <th className="px-3 py-2 font-extrabold text-[var(--muted)]">
                  Method / Ref
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={selectMode ? 10 : 9}
                    className="px-3 py-3 text-center text-[var(--muted)]"
                  >
                    No transactions for {currentDate}.
                  </td>
                </tr>
              ) : (
                filtered.map((t, i) => {
                  const isPaid = !!paidMap[t.id];
                  const q = qtyOf(t);
                  const u = unitOf(t);
                  return (
                    <tr
                      key={t.id}
                      className={`border-b border-[var(--line)]/40 ${
                        i % 2 === 0 ? "bg-[#0e1526]/30" : ""
                      }`}
                    >
                      {selectMode && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!selected[t.id]}
                            onChange={(e) =>
                              setSelected((s) => ({
                                ...s,
                                [t.id]: e.target.checked,
                              }))
                            }
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(t.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        {t.customer_name || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="tag">{t.kind}</span>{" "}
                        <span
                          className={`tag ${
                            isPaid ? "paid-pill" : "unpaid-pill"
                          }`}
                        >
                          {isPaid ? "Paid" : "Unpaid"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{q}</td>
                      <td className="px-3 py-2">{money(u)}</td>
                      <td className="px-3 py-2 font-extrabold">
                        {money(t.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {t.description || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {[t.method, t.reference]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-ghost"
                            onClick={() => togglePaid(t.id)}
                          >
                            {isPaid ? "Mark Unpaid" : "Mark Paid"}
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() => openReceiptFor(t)}
                          >
                            Receipt
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() => removeTx(t.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* TRASH */}
      {admin && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Trash</h2>
            {showTrash && trash.length > 0 && (
              <button
                className="btn-ghost"
                onClick={() => {
                  if (
                    !confirm(
                      "Permanently purge ALL deleted transactions?"
                    )
                  )
                    return;
                  purgeAllDeletedTransactions();
                  refreshTrash();
                }}
              >
                Purge All
              </button>
            )}
          </div>

          {!showTrash ? (
            <p className="text-sm text-[var(--muted)]">
              Hidden. Toggle “Show Trash” above to review.
            </p>
          ) : trash.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nothing in trash for this day.
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Description</th>
                    <th>Deleted At</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trash.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[var(--line)]/40"
                    >
                      <td className="py-2">
                        {new Date(t.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span className="tag">{t.kind}</span>
                      </td>
                      <td className="font-semibold">
                        {money(t.amount)}
                      </td>
                      <td>{t.description || "—"}</td>
                      <td>
                        {(t as any).deleted_at
                          ? new Date(
                              (t as any).deleted_at
                            ).toLocaleString()
                          : "—"}
                      </td>
                      <td className="text-[var(--muted)]">
                        {(t as any).deleted_reason || "—"}
                      </td>
                      <td className="flex gap-2">
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            restoreTransaction(t.id);
                            refreshTrash();
                            refreshDay();
                          }}
                        >
                          Restore
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => {
                            if (
                              !confirm(
                                "Permanently delete this transaction?"
                              )
                            )
                              return;
                            purgeDeletedTransaction(t.id);
                            refreshTrash();
                          }}
                        >
                          Purge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Modals */}
      <InvoicePreviewModal
        open={invoicePreviewOpen}
        receipts={invoicePreviewRows}
        onClose={() => setInvoicePreviewOpen(false)}
        company={company}
      />
      <ReceiptModal
        tx={receiptTx as any}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />

      {/* UNSAVED PREVIEW */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview Receipt"
      >
        <div style={{ padding: 14 }}>
          <div
            ref={unsavedPreviewRef as any}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            {unsavedPages.length === 0 ? (
              <div style={{ fontSize: 13, color: "#6b7280" }}>
                Add at least one line item to preview the invoice.
              </div>
            ) : (
              unsavedPages.map((pageItems, idx) => (
                <div
                  key={idx}
                  className="sp-receipt-page"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  {unsavedPages.length > 1 && (
                    <div
                      style={{
                        alignSelf: "flex-end",
                        marginBottom: 6,
                        fontSize: 11,
                        color: "#6b7280",
                      }}
                    >
                      Page {idx + 1} of {unsavedPages.length}
                    </div>
                  )}
                  <ReceiptView
                    meta={unsavedMeta}
                    items={pageItems}
                    company={company}
                  />
                </div>
              ))
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={sharePreviewWhatsApp}
              type="button"
            >
              Share via WhatsApp (text)
            </button>

            <button
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={downloadUnsavedPreviewPng}
              type="button"
              disabled={previewBusy}
            >
              {previewBusy ? "Working…" : "Download PNG"}
            </button>

            <button
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={shareUnsavedPreviewPng}
              type="button"
              disabled={previewBusy}
            >
              {previewBusy ? "Working…" : "Share PNG"}
            </button>

            <button
              className="px-3 py-2 border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={printUnsavedPreview}
              type="button"
            >
              Print
            </button>

            <button
              className="px-3 py-2 ml-auto border rounded-lg border-neutral-300 hover:bg-neutral-100"
              onClick={() => setPreviewOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

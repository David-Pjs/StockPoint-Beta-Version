import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

type CompanyPayload = {
  companyName: string;
  branchName?: string;
  currency: string;
  invoicePrefix?: string;
  createdAt?: string;
};

const API_URL = null as string | null; // set to your API endpoint string (e.g. "/api/companies") to enable server save

const OrganizeBusiness: React.FC = () => {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [invoicePrefix, setInvoicePrefix] = useState("INV");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const saveLocally = (payload: CompanyPayload) => {
    try {
      localStorage.setItem("stockpoint_company", JSON.stringify(payload));
      localStorage.setItem("stockpoint_org_complete", "1");
      return true;
    } catch (e) {
      console.error("local save failed", e);
      return false;
    }
  };

  const saveToServer = async (payload: CompanyPayload) => {
    if (!API_URL) throw new Error("API_URL not configured");
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Server responded ${resp.status}: ${txt}`);
    }
    return await resp.json();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const name = companyName.trim();
    if (!name) {
      setMessage({ type: "error", text: "Business name is required." });
      nameRef.current?.focus();
      return;
    }

    setLoading(true);

    const payload: CompanyPayload = {
      companyName: name,
      branchName: branchName.trim() || "Main branch",
      currency,
      invoicePrefix: invoicePrefix.trim() || "INV",
      createdAt: new Date().toISOString(),
    };

    try {
      // Try server save first if configured, fallback to local save
      if (API_URL) {
        try {
          await saveToServer(payload);
          saveLocally(payload); // keep local copy in sync
        } catch (serverErr) {
          console.warn("Server save failed, falling back to local:", serverErr);
          saveLocally(payload);
          setMessage({ type: "success", text: "Saved locally (server failed). You can sync later." });
        }
      } else {
        saveLocally(payload);
      }

      // show success and redirect
      setMessage({ type: "success", text: "Business saved. Redirecting to dashboard…" });

      // small delay so user sees success
      setTimeout(() => {
        navigate("/dashboard");
      }, 900);
    } catch (err: any) {
      console.error("Organize save failed", err);
      setMessage({
        type: "error",
        text:
          err?.message ||
          "Failed to save company settings. Check console or your network, then try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen py-12 bg-slate-900 text-slate-100">
      <div className="max-w-4xl px-6 mx-auto">
        <div className="p-6 mb-8 bg-slate-800/60 rounded-2xl">
          <h1 className="text-3xl font-extrabold">Organize Your Business</h1>
          <p className="mt-2 text-slate-400">
            Set up your store name, branch, currency and invoice defaults. You can change these later in Settings.
          </p>
        </div>

        <form onSubmit={onSubmit} className="p-8 shadow-lg bg-slate-800 rounded-2xl">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block mb-2 text-sm font-medium text-slate-300">Business name</label>
              <input
                ref={nameRef}
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. John's Tech Shop"
                className="w-full px-4 py-3 text-white rounded-lg bg-slate-900/80 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                maxLength={80}
                autoComplete="organization"
              />
              <p className="mt-1 text-xs text-slate-500">This will appear on invoices and receipts.</p>
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-slate-300">Primary branch name</label>
              <input
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="Main branch"
                className="w-full px-4 py-3 text-white rounded-lg bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                maxLength={60}
              />
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-slate-300">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-4 py-3 text-white rounded-lg bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="NGN">₦ Nigerian Naira (NGN)</option>
                <option value="USD">$ US Dollar (USD)</option>
                <option value="EUR">€ Euro (EUR)</option>
              </select>
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-slate-300">Invoice prefix</label>
              <input
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                placeholder="INV"
                className="w-full px-4 py-3 text-white rounded-lg bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                maxLength={8}
              />
            </div>
          </div>

          {message && (
            <div
              className={`mt-5 p-3 rounded-md text-sm ${
                message.type === "success" ? "bg-emerald-600/20 text-emerald-300" : "bg-rose-600/10 text-rose-300"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex flex-col items-stretch gap-3 mt-6 md:flex-row md:items-center">
            <button
              type="submit"
              className="inline-flex items-center justify-center flex-1 gap-3 px-5 py-3 font-semibold rounded-lg shadow bg-emerald-500 hover:bg-emerald-600 text-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? (
                <>
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save and continue"
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="w-full px-4 py-3 bg-transparent border rounded-lg md:w-auto border-slate-700 text-slate-300 hover:bg-slate-700/40"
            >
              Skip for now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrganizeBusiness;

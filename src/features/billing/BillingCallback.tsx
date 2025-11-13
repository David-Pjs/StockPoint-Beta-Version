import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { verifyPaymentAndActivate, getLicense } from "../../index";

export default function BillingCallback() {
  const [status, setStatus] = useState<"working" | "ok" | "fail">("working");
  const [msg, setMsg] = useState("Verifying payment…");
  const [plan, setPlan] = useState<string>("");

  useEffect(() => {
    const ref = new URLSearchParams(location.search).get("reference") || "";
    if (!ref) {
      setStatus("fail");
      setMsg("Missing reference in URL.");
      return;
    }
    (async () => {
      try {
        const lic = await verifyPaymentAndActivate(ref);
        setPlan(lic.plan.toUpperCase());
        setStatus("ok");
        setMsg("Payment verified and license activated.");
      } catch (e: any) {
        setStatus("fail");
        setMsg(e?.message || "Verification failed.");
      }
    })();
  }, []);

  const lic = getLicense();

  return (
    <div className="max-w-xl p-6 mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Billing</h1>
      {status === "working" && <p>{msg}</p>}
      {status === "ok" && (
        <>
          <p className="text-[var(--ok)]">{msg}</p>
          <p>
            Plan: <b className="uppercase">{plan || lic.plan}</b>
          </p>
          <Link className="underline" to="/settings">Back to Settings</Link>
        </>
      )}
      {status === "fail" && (
        <>
          <p className="text-[var(--bad)]">{msg}</p>
          <Link className="underline" to="/settings">Back to Settings</Link>
        </>
      )}
    </div>
  );
}

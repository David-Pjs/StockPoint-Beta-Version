// lib/pay.ts
export async function startPayment(amountKobo: number, email: string) {
  const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string;
  return new Promise<void>((resolve, reject) => {
    // @ts-ignore
    const handler = window.PaystackPop.setup({
      key,
      email,
      amount: amountKobo, // 250000 or 500000
      metadata: { app: "StockPoint" },
      callback: async (resp: { reference: string }) => {
        try {
          const base = import.meta.env.VITE_API_BASE as string;
          const verify = await fetch(`${base}/verify?ref=${encodeURIComponent(resp.reference)}`);
          const data = await verify.json();
          if (!data.ok) throw new Error(data.error || "Verify failed");

          // Map to your local license (your index.ts already has this):
          // activatePaid("small"|"large", months, ref)
          const plan = data.plan as "small" | "large";
          // RIGHT
const { activatePaid } = await import("../index");

          activatePaid(plan, data.months ?? 1, data.ref);

          alert("Payment successful. Your plan is now active.");
          resolve();
        } catch (e: any) {
          alert(e?.message || "Verification failed");
          reject(e);
        }
      },
      onClose: () => reject(new Error("Payment cancelled"))
    });
    handler.openIframe();
  });
}

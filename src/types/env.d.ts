/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYSTACK_PUBLIC_KEY: string;
  readonly VITE_API_BASE?: string; // your backend verifier URL (optional in dev)
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

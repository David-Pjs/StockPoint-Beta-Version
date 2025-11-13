declare global {
  interface Window {
    PaystackPop: {
      setup(cfg: any): {
        openIframe: () => void;
        close: () => void;
        // ... (their type isn’t public; any is fine)
      };
    };
  }
}
export {};

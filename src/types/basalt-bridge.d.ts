import type { BasaltBridge } from '@/engine/bridge';

declare global {
  interface Window {
    /** Present only in the Electron desktop shell (injected by the preload). */
    basalt?: BasaltBridge;
  }
}

export {};

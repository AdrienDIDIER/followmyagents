import type { FmaApi } from "../shared/types";

export type FmaBridge = FmaApi & {
  onAttention(cb: (pendingId: string) => void): () => void;
  onPanelShown(cb: (reason: string) => void): () => void;
  contextMenu(): void;
};

declare global {
  interface Window {
    fma: FmaBridge;
  }
}

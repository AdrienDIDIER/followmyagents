// Pont sécurisé entre le renderer (sans accès Node) et le process principal.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppSnapshot, FmaApi, PendingAnswer, Prefs } from "../shared/types";

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const api: FmaApi & {
  onAttention(cb: (pendingId: string) => void): () => void;
  onPanelShown(cb: (reason: string) => void): () => void;
  contextMenu(): void;
} = {
  onSnapshot: (cb) => on<AppSnapshot>("snapshot", cb),
  onFocusPending: (cb) => on<string | null>("focus-pending", cb),
  onShowSession: (cb) => on<string>("show-session", cb),
  onAttention: (cb) => on<string>("attention", cb),
  onPanelShown: (cb) => on<string>("panel-shown", cb),
  ready: () => ipcRenderer.send("ready"),
  answer: (id: string, a: PendingAnswer) => ipcRenderer.send("answer", id, a),
  dismiss: (id: string) => ipcRenderer.send("dismiss", id),
  jump: (id: string) => ipcRenderer.send("jump", id),
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => ipcRenderer.send("set-pref", k, v),
  hide: () => ipcRenderer.send("hide"),
  toggleDetach: () => ipcRenderer.send("toggle-detach"),
  resize: (h: number) => ipcRenderer.send("resize", h),
  wantFocus: () => ipcRenderer.send("want-focus"),
  contextMenu: () => ipcRenderer.send("context-menu"),
};

contextBridge.exposeInMainWorld("fma", api);

// Fenêtre du panneau : sans cadre, toujours au premier plan, verre natif,
// positionnée sous (macOS) / au-dessus (Windows) de l'icône système.
// Ne vole jamais le focus : showInactive() ; sous Windows la fenêtre n'est
// focalisable que le temps d'une saisie clavier (champ « Autre… », raccourci).
import { BrowserWindow, screen, type Rectangle } from "electron";
import path from "node:path";

export const PANEL_WIDTH = 320;
export const MIN_WIDTH = 300;
export const MAX_WIDTH = 600;
const MARGIN = 8;

export type OpenReason = "auto" | "click" | "shortcut";

export interface PanelOptions {
  preload: string;
  rendererUrl?: string;
  rendererFile: string;
  getTrayBounds: () => Rectangle | null;
  detached: () => boolean;
  /** largeur choisie par l'utilisateur (poignée du bord gauche) */
  width: () => number;
  detachedPos: () => { x: number; y: number } | undefined;
  onMoved: (pos: { x: number; y: number }) => void;
  onHidden: () => void;
  /** désactive le verre natif (captures d'écran, tests) */
  noGlass?: boolean;
}

export class Panel {
  readonly win: BrowserWindow;
  private contentHeight = 120;
  openedBy: OpenReason | null = null;
  private readonly isMac = process.platform === "darwin";
  private readonly isWin = process.platform === "win32";
  private programmaticMove = false;

  constructor(private o: PanelOptions) {
    const glass = !o.noGlass;
    this.win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: this.contentHeight,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      title: "FollowMyAgents",
      // macOS : NSPanel non activant + vibrancy ; Windows : acrylique
      // FMA_VIBRANCY=hud pour comparer avec "popover" (BRIEF §4.7)
      ...(this.isMac
        ? {
            type: "panel",
            vibrancy: glass ? ((process.env.FMA_VIBRANCY as "popover" | "hud") || "popover") : undefined,
            visualEffectState: "active" as const,
            // coins arrondis par le système (le CSS ne peut pas découper le verre natif)
            roundedCorners: true,
            backgroundColor: glass ? "#00000000" : "#1E1E22",
          }
        : {}),
      ...(this.isWin
        ? {
            focusable: false,
            backgroundMaterial: glass ? ("acrylic" as const) : undefined,
            backgroundColor: glass ? "#00000000" : "#1E1E22",
          }
        : {}),
      webPreferences: {
        preload: o.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    if (this.isMac) {
      this.win.setAlwaysOnTop(true, "screen-saver");
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else {
      this.win.setAlwaysOnTop(true, "floating");
    }
    this.win.on("moved", () => {
      if (this.programmaticMove || !this.o.detached()) return;
      const [x, y] = this.win.getPosition();
      this.o.onMoved({ x, y });
    });
    this.win.on("hide", () => this.o.onHidden());
    this.win.on("blur", () => {
      // rend la main : le panneau n'est focalisable que pendant une saisie
      if (this.isWin) this.win.setFocusable(false);
    });
    if (o.rendererUrl) this.win.loadURL(o.rendererUrl);
    else this.win.loadFile(o.rendererFile);
  }

  get visible(): boolean {
    return this.win.isVisible();
  }

  /** Taille selon le contenu (max 70 % de l'écran). */
  setContentHeight(h: number) {
    this.contentHeight = Math.max(60, Math.ceil(h));
    if (this.visible) this.place();
  }

  private display() {
    const tb = this.o.getTrayBounds();
    if (tb && tb.width > 0) return screen.getDisplayNearestPoint({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 });
    return screen.getPrimaryDisplay();
  }

  maxHeight(): number {
    return Math.floor(this.display().workArea.height * 0.7);
  }

  computeBounds(): Rectangle {
    const disp = this.display();
    const wa = disp.workArea;
    const height = Math.min(this.contentHeight, Math.floor(wa.height * 0.7));
    const width = clamp(Math.round(this.o.width()), MIN_WIDTH, MAX_WIDTH);
    if (this.o.detached()) {
      const pos = this.o.detachedPos();
      if (pos) {
        const d = screen.getDisplayNearestPoint(pos).workArea;
        return {
          x: clamp(pos.x, d.x, d.x + d.width - width),
          y: clamp(pos.y, d.y, d.y + d.height - height),
          width,
          height,
        };
      }
    }
    const tb = this.o.getTrayBounds();
    let x: number;
    let y: number;
    if (tb && tb.width > 0) {
      // bord DROIT fixe (celui de la largeur par défaut centrée sous l'icône) : élargir
      // avec la poignée gauche étend le panneau vers la gauche
      const right = Math.min(Math.round(tb.x + tb.width / 2 + PANEL_WIDTH / 2), wa.x + wa.width - MARGIN);
      x = right - width;
      const trayInBottomHalf = tb.y + tb.height / 2 > wa.y + wa.height / 2;
      y = trayInBottomHalf ? wa.y + wa.height - height - MARGIN : Math.max(wa.y, tb.y + tb.height) + 4;
    } else {
      // pas de position d'icône : coin du bureau (haut droit sur macOS, bas droit sur Windows)
      x = wa.x + wa.width - width - MARGIN;
      y = this.isMac ? wa.y + 4 : wa.y + wa.height - height - MARGIN;
    }
    x = clamp(x, wa.x + MARGIN, Math.max(wa.x + MARGIN, wa.x + wa.width - width - MARGIN));
    y = clamp(y, wa.y, wa.y + wa.height - height);
    return { x, y, width, height };
  }

  place() {
    const b = this.computeBounds();
    this.programmaticMove = true;
    this.win.setBounds(b);
    setTimeout(() => (this.programmaticMove = false), 50);
  }

  show(reason: OpenReason) {
    this.openedBy = reason;
    this.place();
    if (reason === "shortcut") {
      // l'utilisateur a demandé le panneau au clavier : on prend le focus
      if (this.isWin) this.win.setFocusable(true);
      this.win.show();
      this.win.focus();
    } else {
      this.win.showInactive();
    }
    this.win.webContents.send("panel-shown", reason);
  }

  hide() {
    this.openedBy = null;
    if (this.isWin) this.win.setFocusable(false);
    this.win.hide();
  }

  /** Saisie clavier demandée par l'utilisateur (clic dans un champ texte). */
  takeFocus() {
    if (this.isWin) this.win.setFocusable(true);
    this.win.focus();
  }

  setDraggable() {
    this.place();
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function rendererPaths(dirname: string) {
  return {
    preload: path.join(dirname, "../preload/index.js"),
    rendererFile: path.join(dirname, "../renderer/index.html"),
  };
}

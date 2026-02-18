export type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
};

export const defaultLayout: LayoutState = {
  leftWidth: 280,
  rightWidth: 360,
  bottomHeight: 240
};

export const LAYOUT_STORAGE_KEY = "enterprise-ide-layout-v1";

export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return defaultLayout;
    const parsed = JSON.parse(raw) as LayoutState;
    return {
      leftWidth: clamp(parsed.leftWidth, 220, 520),
      rightWidth: clamp(parsed.rightWidth, 280, 600),
      bottomHeight: clamp(parsed.bottomHeight, 160, 420)
    };
  } catch {
    return defaultLayout;
  }
}

export function saveLayout(layout: LayoutState): void {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function clearLayout(): void {
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

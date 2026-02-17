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

const KEY = "enterprise-ide-layout-v1";

export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(KEY);
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
  localStorage.setItem(KEY, JSON.stringify(layout));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const VIRTUALIZE_AFTER = 300;
export const RESULT_ROW_HEIGHT = 38;

export interface VirtualWindow {
  start: number;
  end: number;
  before: number;
  after: number;
}

/** Calculates the small row window that should exist in the DOM. */
export function virtualWindow(scrollTop: number, viewportHeight: number, rows: number, overscan = 8): VirtualWindow {
  const visible = Math.max(1, Math.ceil(viewportHeight / RESULT_ROW_HEIGHT));
  const start = Math.max(0, Math.floor(scrollTop / RESULT_ROW_HEIGHT) - overscan);
  const end = Math.min(rows, start + visible + overscan * 2);
  return {
    start,
    end,
    before: start * RESULT_ROW_HEIGHT,
    after: Math.max(0, (rows - end) * RESULT_ROW_HEIGHT),
  };
}

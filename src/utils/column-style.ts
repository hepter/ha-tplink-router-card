export type ColumnFixedSide = "start" | "end";

// Sticky columns must never take more than half of the table viewport, even when the
// user configures a larger max_width; `cqw` follows the card width, `vw` is the fallback.
export const STICKY_COLUMN_MAX_WIDTH_FALLBACK = "50vw";
export const STICKY_COLUMN_MAX_WIDTH = "50cqw";

export const buildColumnMaxWidthStyle = (
  maxWidth: string | undefined,
  fixed: ColumnFixedSide | undefined,
): string => {
  const value = maxWidth?.trim();
  if (!fixed) return value ? `max-width:${value};` : "";
  if (!value) return "";
  return (
    `max-width:min(${value},${STICKY_COLUMN_MAX_WIDTH_FALLBACK});` +
    `max-width:min(${value},${STICKY_COLUMN_MAX_WIDTH});`
  );
};

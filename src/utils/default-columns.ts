import { OPT_IN_COLUMN_KEYS } from "../adapters/integration-profile";

// Opt-in columns are allowed for their domains but never part of the default layout;
// explicit `columns` / `column_layout` keys bypass this and are honoured as-is.
export const selectDefaultColumnKeys = (
  orderedKeys: readonly string[],
  allowed: ReadonlySet<string>,
): string[] => {
  const optIn = new Set<string>(OPT_IN_COLUMN_KEYS);
  return orderedKeys.filter((key) => allowed.has(key) && !optIn.has(key));
};

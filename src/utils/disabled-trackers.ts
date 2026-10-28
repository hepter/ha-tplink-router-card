import type { EntityRegistryEntry } from "../core/types";

// Only `integration`: trackers a user disabled on purpose must not keep a notice on screen.
export const countIntegrationDisabledTrackers = (entries: readonly EntityRegistryEntry[]) =>
  entries.filter(
    (entry) => entry.entity_id.startsWith("device_tracker.") && entry.disabled_by === "integration",
  ).length;

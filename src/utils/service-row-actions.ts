export type ServiceRowActionRow = {
  entity_id: string;
  mac: string;
  macNormalized: string;
  isOnline: boolean;
  deviceId?: string;
};

export type ServiceRowAction = {
  entity_id: string;
  domain: "service";
  label: string;
  icon: string;
  isOn: boolean;
  available: boolean;
  requiresHold: boolean;
  deviceId?: string;
  role: "reconnect";
  service: { domain: string; service: string; data: Record<string, unknown> };
};

// Core tplink_omada exposes no per-client entity; its only client control is a service.
export const buildServiceRowActions = (
  entryDomain: string | undefined,
  entryId: string | undefined,
  rows: readonly ServiceRowActionRow[],
  reconnectLabel: string,
): Map<string, ServiceRowAction[]> => {
  const byEntity = new Map<string, ServiceRowAction[]>();
  if (entryDomain !== "tplink_omada" || !entryId) return byEntity;
  for (const row of rows) {
    if (!row.entity_id.startsWith("device_tracker.")) continue;
    if (row.mac === "—" || row.macNormalized.length === 0) continue;
    byEntity.set(row.entity_id, [
      {
        entity_id: row.entity_id,
        domain: "service",
        label: reconnectLabel,
        icon: "mdi:wifi-refresh",
        isOn: false,
        available: row.isOnline,
        requiresHold: true,
        deviceId: row.deviceId,
        role: "reconnect",
        service: {
          domain: "tplink_omada",
          service: "reconnect_client",
          data: { mac: row.mac, config_entry_id: entryId },
        },
      },
    ]);
  }
  return byEntity;
};

import type { DeviceRegistryEntry, EntityRegistryEntry } from "../core/types";

export interface LinkedDevice {
  deviceId: string;
  name: string;
  // Domain of the integration that owns the device; empty when it is not known.
  integration: string;
  // Other integrations' devices that declare the same MAC.
  others: number;
}

const macKey = (value: string) => value.replace(/[^0-9a-f]/gi, "").toLowerCase();

const deviceEntryIds = (device: DeviceRegistryEntry): string[] => {
  if (Array.isArray(device.config_entries) && device.config_entries.length > 0) {
    return device.config_entries;
  }
  const single = device.config_entry_id ?? device.primary_config_entry;
  return typeof single === "string" && single.length > 0 ? [single] : [];
};

// Since Home Assistant 2026.10 a device belongs to one config entry: the router integration
// registers its own device for a client another integration knows, and both carry the same
// MAC. Map each MAC to the device of that other integration, so a client row can point to it.
// Before 2026.10 both integrations shared one device; it is returned as well.
export const buildLinkedDeviceIndex = (
  devices: readonly DeviceRegistryEntry[],
  entityRegistry: readonly EntityRegistryEntry[],
  domainByEntryId: ReadonlyMap<string, string>,
  routerEntryId: string,
  routerDomains: ReadonlySet<string>,
): Map<string, LinkedDevice> => {
  const entityCount = new Map<string, number>();
  for (const entry of entityRegistry) {
    if (!entry.device_id) continue;
    entityCount.set(entry.device_id, (entityCount.get(entry.device_id) ?? 0) + 1);
  }

  const isRouterEntry = (entryId: string) =>
    entryId === routerEntryId || routerDomains.has(domainByEntryId.get(entryId) ?? "");

  const candidates = new Map<string, Array<LinkedDevice & { disabled: boolean; rank: number }>>();
  for (const device of devices) {
    const owners = deviceEntryIds(device).filter((entryId) => !isRouterEntry(entryId));
    if (owners.length === 0) continue;
    const primary =
      device.primary_config_entry && owners.includes(device.primary_config_entry)
        ? device.primary_config_entry
        : (owners.find((entryId) => domainByEntryId.has(entryId)) ?? owners[0]);
    const candidate = {
      deviceId: device.id,
      name: (device.name_by_user ?? device.name ?? "").trim(),
      integration: domainByEntryId.get(primary) ?? "",
      others: 0,
      disabled: Boolean(device.disabled_by),
      rank: entityCount.get(device.id) ?? 0,
    };
    const seen = new Set<string>();
    for (const [type, value] of device.connections ?? []) {
      if (String(type).toLowerCase() !== "mac") continue;
      const key = macKey(String(value));
      if (key.length !== 12 || seen.has(key)) continue;
      seen.add(key);
      const list = candidates.get(key) ?? [];
      list.push(candidate);
      candidates.set(key, list);
    }
  }

  const index = new Map<string, LinkedDevice>();
  for (const [key, list] of candidates) {
    // Enabled first, then the device with the most entities, then by name.
    const [best] = [...list].sort(
      (a, b) =>
        Number(a.disabled) - Number(b.disabled) ||
        b.rank - a.rank ||
        a.name.localeCompare(b.name) ||
        a.deviceId.localeCompare(b.deviceId),
    );
    index.set(key, {
      deviceId: best.deviceId,
      name: best.name,
      integration: best.integration,
      others: list.length - 1,
    });
  }
  return index;
};

export interface DeviceIconTarget {
  deviceId: string;
  // True when the target is the device of another integration found by MAC.
  linked: boolean;
}

// Device opened by the icon next to a router client name. A client tracker's own device is
// only the router side of the client: none on Home Assistant 2026.11 with older tplink_router
// versions, one described by the MAC alone with tplink_router 2.47+ (sometimes with a
// "Blocked" switch). The device of the integration that declares the client's MAC is used
// instead. The router itself and mesh nodes, whose device carries an identifier of the router
// integration, keep their own device.
export const resolveDeviceIconTarget = (
  row: {
    deviceId?: string;
    linkedDeviceId?: string;
    meshRole?: string | null;
  },
  ownDeviceIsRouterHardware = false,
): DeviceIconTarget | null => {
  const own = row.deviceId ? { deviceId: row.deviceId, linked: false } : null;
  const linked = row.linkedDeviceId ? { deviceId: row.linkedDeviceId, linked: true } : null;
  return row.meshRole || ownDeviceIsRouterHardware ? (own ?? linked) : (linked ?? own);
};

// Devices that carry an identifier of one of the given integrations: the router and its mesh
// nodes. Client devices registered from a tracker carry the MAC connection only.
export const routerHardwareDevices = (
  devices: readonly DeviceRegistryEntry[],
  routerDomains: ReadonlySet<string>,
): Set<string> =>
  new Set(
    devices
      .filter((device) =>
        (device.identifiers ?? []).some(([domain]) => routerDomains.has(String(domain))),
      )
      .map((device) => device.id),
  );

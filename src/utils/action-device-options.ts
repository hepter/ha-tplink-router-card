import type { DeviceRegistryEntry } from "../core/types";

export type ActionDeviceCandidate = {
  deviceId?: string;
  deviceName?: string;
  isGlobalCommon?: boolean;
};

export type ActionDeviceOption = { deviceId: string; deviceName: string };

const compareNames = (a: string, b: string) =>
  new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare(a, b);

export const buildActionDeviceOptions = (
  actionItems: ActionDeviceCandidate[],
  devices: DeviceRegistryEntry[],
): ActionDeviceOption[] => {
  const byDevice = new Map<string, ActionDeviceOption>();
  const deviceById = new Map(devices.map((device) => [device.id, device] as const));

  for (const item of actionItems) {
    if (item.isGlobalCommon) continue;
    if (!item.deviceId) continue;
    if (byDevice.has(item.deviceId)) continue;
    const device = deviceById.get(item.deviceId);
    byDevice.set(item.deviceId, {
      deviceId: item.deviceId,
      deviceName:
        item.deviceName ??
        device?.name_by_user ??
        device?.name ??
        item.deviceId.slice(0, 8),
    });
  }

  return [...byDevice.values()].sort((a, b) => compareNames(a.deviceName, b.deviceName));
};


export type SupportedIntegrationDomain =
  | "tplink_router"
  | "tplink_deco"
  | "omada"
  | "tplink_omada"
  | "omada_open_api";

export const OMADA_DOMAINS: readonly SupportedIntegrationDomain[] = [
  "omada",
  "tplink_omada",
  "omada_open_api",
];

export const isOmadaIntegrationDomain = (domain: string | undefined): boolean =>
  domain !== undefined && (OMADA_DOMAINS as readonly string[]).includes(domain);

export const COMMON_COLUMN_KEYS = [
  "status",
  "connection",
  "band",
  "apName",
  "ip",
  "mac",
  "hostname",
  "packetsSent",
  "packetsReceived",
  "down",
  "up",
  "tx",
  "rx",
  "online",
  "traffic",
  "signal",
] as const;

export const TRAFFIC_PRIMITIVE_COLUMN_KEYS = [
  "downloaded",
  "uploaded",
] as const;

export const DEVICE_METADATA_COLUMN_KEYS = [
  "deviceType",
  "deviceModel",
  "deviceFirmware",
  "deviceStatus",
] as const;

export const OMADA_EXTRA_COLUMN_KEYS = [
  "actions",
  "snr",
  "powerSave",
  "channel",
  "wifiMode",
  "lastSeen",
  ...TRAFFIC_PRIMITIVE_COLUMN_KEYS,
] as const;

// Published by both Omada HACS integrations: tracker `ssid`, AP / switch name, device CPU and
// memory sensors.
export const OMADA_SHARED_DETAIL_COLUMN_KEYS = ["ssid", "connectedTo", "cpu", "memory"] as const;

// omada_open_api only: controller signal quality in percent, client vendor, per-device client
// count and uplink sensors.
export const OMADA_OPEN_API_DETAIL_COLUMN_KEYS = [
  "signalStrength",
  "vendor",
  "clients",
  "uplink",
] as const;

export const TPLINK_DECO_EXTRA_COLUMN_KEYS = [
  "deviceType",
  "deviceModel",
  "deviceFirmware",
  "deviceStatus",
] as const;
const TPLINK_DECO_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS,
  ...TPLINK_DECO_EXTRA_COLUMN_KEYS,
] as const;

const OMADA_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS,
  ...DEVICE_METADATA_COLUMN_KEYS,
  ...OMADA_EXTRA_COLUMN_KEYS,
  ...OMADA_SHARED_DETAIL_COLUMN_KEYS,
] as const;

// Core tplink_omada trackers carry no AP, client metric or power-save data.
const TPLINK_OMADA_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS.filter((key) => key !== "apName"),
  ...DEVICE_METADATA_COLUMN_KEYS,
  "actions",
] as const;

// omada_open_api trackers publish the access point / switch name and the client sensors
// carry traffic, activity, RSSI, SNR, uptime and power save; packet counters, link rates,
// channel and WiFi mode are never exposed.
const OMADA_OPEN_API_HIDDEN_COMMON_KEYS: readonly ColumnKey[] = [
  "packetsSent",
  "packetsReceived",
  "tx",
  "rx",
];
const OMADA_OPEN_API_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS.filter((key) => !OMADA_OPEN_API_HIDDEN_COMMON_KEYS.includes(key)),
  ...DEVICE_METADATA_COLUMN_KEYS,
  "actions",
  "snr",
  "powerSave",
  ...TRAFFIC_PRIMITIVE_COLUMN_KEYS,
  ...OMADA_SHARED_DETAIL_COLUMN_KEYS,
  ...OMADA_OPEN_API_DETAIL_COLUMN_KEYS,
] as const;

// Allowed for their domains but only rendered when listed in `columns` / `column_layout`.
// signalStrength is not opt-in: it is populated for every wireless omada_open_api client.
export const OPT_IN_COLUMN_KEYS = [
  "apName",
  "channel",
  "wifiMode",
  "lastSeen",
  "ssid",
  "connectedTo",
  "vendor",
  "clients",
  "cpu",
  "memory",
  "uplink",
] as const;

export const BASE_COLUMN_KEYS = COMMON_COLUMN_KEYS;
export const ALL_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS,
  ...DEVICE_METADATA_COLUMN_KEYS,
  ...OMADA_EXTRA_COLUMN_KEYS,
  ...OMADA_SHARED_DETAIL_COLUMN_KEYS,
  ...OMADA_OPEN_API_DETAIL_COLUMN_KEYS,
] as const;

export type ColumnKey = (typeof ALL_COLUMN_KEYS)[number];

// EasyMesh node trackers (tplink_router v2.41+) carry role, model and client count.
const TPLINK_ROUTER_MESH_COLUMN_KEYS = ["deviceType", "deviceModel", "clients"] as const;

const TPLINK_ROUTER_COLUMN_KEYS = [...COMMON_COLUMN_KEYS, ...TPLINK_ROUTER_MESH_COLUMN_KEYS] as const;

// Opt-in only for these domains; other domains show the same keys by default.
const DOMAIN_OPT_IN_COLUMN_KEYS: Partial<Record<SupportedIntegrationDomain, readonly ColumnKey[]>> = {
  tplink_router: TPLINK_ROUTER_MESH_COLUMN_KEYS,
};

export const getOptInColumnsForDomain = (domain?: string): ReadonlySet<string> =>
  new Set<string>([
    ...OPT_IN_COLUMN_KEYS,
    ...(domain && domain in DOMAIN_OPT_IN_COLUMN_KEYS
      ? DOMAIN_OPT_IN_COLUMN_KEYS[domain as SupportedIntegrationDomain] ?? []
      : []),
  ]);

const DOMAIN_COLUMN_KEYS: Record<SupportedIntegrationDomain, readonly ColumnKey[]> = {
  tplink_router: TPLINK_ROUTER_COLUMN_KEYS,
  tplink_deco: TPLINK_DECO_COLUMN_KEYS,
  omada: OMADA_COLUMN_KEYS,
  tplink_omada: TPLINK_OMADA_COLUMN_KEYS,
  omada_open_api: OMADA_OPEN_API_COLUMN_KEYS,
};

export const getAllowedColumnsForDomain = (
  domain?: string,
): readonly ColumnKey[] => {
  if (!domain) return COMMON_COLUMN_KEYS;
  if (domain in DOMAIN_COLUMN_KEYS) {
    return DOMAIN_COLUMN_KEYS[domain as SupportedIntegrationDomain];
  }
  return COMMON_COLUMN_KEYS;
};

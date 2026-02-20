export type SupportedIntegrationDomain =
  | "tplink_router"
  | "tplink_deco"
  | "omada"
  | "tplink_omada";

export const COMMON_COLUMN_KEYS = [
  "status",
  "connection",
  "band",
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
  ...TRAFFIC_PRIMITIVE_COLUMN_KEYS,
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
] as const;

export const BASE_COLUMN_KEYS = COMMON_COLUMN_KEYS;
export const ALL_COLUMN_KEYS = [
  ...COMMON_COLUMN_KEYS,
  ...DEVICE_METADATA_COLUMN_KEYS,
  ...OMADA_EXTRA_COLUMN_KEYS,
] as const;

export type ColumnKey = (typeof ALL_COLUMN_KEYS)[number];

const DOMAIN_COLUMN_KEYS: Record<SupportedIntegrationDomain, readonly ColumnKey[]> = {
  tplink_router: COMMON_COLUMN_KEYS,
  tplink_deco: TPLINK_DECO_COLUMN_KEYS,
  omada: OMADA_COLUMN_KEYS,
  tplink_omada: OMADA_COLUMN_KEYS,
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

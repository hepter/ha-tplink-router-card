import {
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatNumber,
  normalizeLinkMbps,
  safeString,
} from "../utils/format";
import {
  normalizeMac,
  signalColor,
  toNumber,
  type MappedTrackerRow,
} from "./tplink";
import type {
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassEntity,
} from "../core/types";

const STATUS_ONLINE = new Set(["home", "on", "connected"]);

type OmadaBandType = MappedTrackerRow["bandType"];
type OmadaConnectionType = MappedTrackerRow["connectionType"];

type OmadaClientMetrics = {
  downloadedMB: number | null;
  uploadedMB: number | null;
  rxActivityMBps: number | null;
  txActivityMBps: number | null;
  rssi: number | null;
  snr: number | null;
  uptimeSeconds: number | null;
};

const defaultMetrics = (): OmadaClientMetrics => ({
  downloadedMB: null,
  uploadedMB: null,
  rxActivityMBps: null,
  txActivityMBps: null,
  rssi: null,
  snr: null,
  uptimeSeconds: null,
});

const isDeviceTrackerEntity = (state: HassEntity) =>
  state.entity_id.startsWith("device_tracker.");

const toText = (value: unknown) => String(value ?? "").trim();

const isLikelyOmadaTrackerByAttrs = (state: HassEntity) => {
  if (!isDeviceTrackerEntity(state)) return false;
  const attrs = state.attributes as Record<string, unknown>;
  const sourceType = String(attrs.source_type ?? "").toLowerCase();
  if (sourceType && sourceType !== "router") return false;
  return (
    "wireless" in attrs ||
    "guest" in attrs ||
    "ssid" in attrs ||
    "ap_name" in attrs ||
    "ap_mac" in attrs ||
    "switch_port" in attrs ||
    "channel_width" in attrs ||
    "radio" in attrs
  );
};

const normalizeBand = (attrs: Record<string, unknown>): OmadaBandType => {
  const candidates = [attrs.band, attrs.radio, attrs.wifi_mode, attrs.ssid]
    .map((value) => String(value ?? "").toLowerCase())
    .filter((value) => value.length > 0);

  for (const text of candidates) {
    if (
      text.includes("6g") ||
      text.includes("6ghz") ||
      text.includes("6 ghz") ||
      text.includes("11bea")
    ) {
      return "6g";
    }
    if (
      text.includes("5g") ||
      text.includes("5ghz") ||
      text.includes("5 ghz") ||
      text.includes("11ac") ||
      text.includes("11axa")
    ) {
      return "5g";
    }
    if (
      text.includes("2.4") ||
      text.includes("2g") ||
      text.includes("2ghz") ||
      text.includes("11ng")
    ) {
      return "2g";
    }
  }

  return "unknown";
};

const resolveConnection = (
  attrs: Record<string, unknown>,
): { label: string; type: OmadaConnectionType } => {
  const guest = attrs.guest === true || String(attrs.guest).toLowerCase() === "true";
  const wireless =
    attrs.wireless === true || String(attrs.wireless).toLowerCase() === "true";
  const switchLinked =
    attrs.switch_port !== undefined ||
    attrs.switchPort !== undefined ||
    attrs.standard_port !== undefined ||
    attrs.switch_name !== undefined ||
    attrs.switchName !== undefined ||
    attrs.switch_mac !== undefined ||
    attrs.switchMac !== undefined;
  const apLinked =
    attrs.ap_name !== undefined ||
    attrs.apName !== undefined ||
    attrs.ap_mac !== undefined ||
    attrs.apMac !== undefined ||
    attrs.ssid !== undefined;
  const connectionText = [
    attrs.connection,
    attrs.connect_type,
    attrs.connectType,
    attrs.connect_dev_type,
    attrs.connectDevType,
    attrs.network_name,
    attrs.networkName,
  ]
    .map((value) => toText(value).toLowerCase())
    .join(" ");
  const deviceTypeText = toText(attrs.type).toLowerCase();

  if (guest) return { label: "Guest", type: "guest" };
  if (wireless) return { label: "WiFi", type: "wifi" };
  if (switchLinked) return { label: "Wired", type: "wired" };
  if (apLinked) return { label: "WiFi", type: "wifi" };
  if (attrs.wireless === false || String(attrs.wireless).toLowerCase() === "false") {
    return { label: "Wired", type: "wired" };
  }
  if (
    connectionText.includes("wired") ||
    connectionText.includes("ethernet") ||
    connectionText.includes("lan") ||
    connectionText.includes("switch") ||
    connectionText.includes("gateway")
  ) {
    return { label: "Wired", type: "wired" };
  }
  if (
    connectionText.includes("wifi") ||
    connectionText.includes("wireless") ||
    connectionText.includes("wlan") ||
    connectionText.includes("ap")
  ) {
    return { label: "WiFi", type: "wifi" };
  }
  if (deviceTypeText === "gateway") return { label: "Gateway", type: "unknown" };
  if (deviceTypeText === "switch") return { label: "Switch", type: "unknown" };
  if (deviceTypeText === "ap") return { label: "Access Point", type: "unknown" };
  if (attrs.ip !== undefined || attrs.ip_address !== undefined || attrs.mac !== undefined) {
    return { label: "Wired", type: "wired" };
  }
  return {
    label: safeString(attrs.connection ?? attrs.type ?? "—"),
    type: "unknown",
  };
};

const parseUptimeSeconds = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const asNumber = toNumber(value);
  if (asNumber !== null) return asNumber;
  if (typeof value === "string") {
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, Math.floor((Date.now() - dateMs) / 1000));
    }
  }
  return null;
};

const formatTransferSpeed = (mbPerSecond: number | null, unit: "MBps" | "Mbps") => {
  if (mbPerSecond === null || !Number.isFinite(mbPerSecond)) return "—";

  if (unit === "MBps") {
    if (mbPerSecond >= 1000) {
      const gb = mbPerSecond / 1000;
      const decimals = gb >= 100 ? 0 : gb >= 10 ? 1 : 2;
      return `${gb.toFixed(decimals)} GB/s`;
    }
    const decimals = mbPerSecond >= 100 ? 0 : mbPerSecond >= 10 ? 1 : 2;
    return `${mbPerSecond.toFixed(decimals)} MB/s`;
  }

  const mbps = mbPerSecond * 8;
  if (mbps >= 1000) {
    const gbps = mbps / 1000;
    const decimals = gbps >= 100 ? 0 : gbps >= 10 ? 1 : 2;
    return `${gbps.toFixed(decimals)} Gbps`;
  }
  const decimals = mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2;
  return `${mbps.toFixed(decimals)} Mbps`;
};

const resolveLinkRateRaw = (
  attrs: Record<string, unknown>,
  aliases: string[],
): number | null => {
  for (const key of aliases) {
    const value = toNumber(attrs[key]);
    if (value !== null) return value;
  }
  return null;
};

const mapSensorMetric = (state: HassEntity, target: OmadaClientMetrics) => {
  const id = state.entity_id.toLowerCase();
  const name = String((state.attributes as Record<string, unknown>).friendly_name ?? "")
    .toLowerCase()
    .trim();
  const text = `${id} ${name}`;

  if (text.includes("downloaded") || /\bdownload\b/.test(text)) {
    target.downloadedMB = toNumber(state.state);
    return;
  }
  if (text.includes("uploaded") || /\bupload\b/.test(text)) {
    target.uploadedMB = toNumber(state.state);
    return;
  }
  if (
    text.includes("rx_activity") ||
    text.includes("rx activity") ||
    (/\brx\b/.test(text) && !text.includes("utilization"))
  ) {
    target.rxActivityMBps = toNumber(state.state);
    return;
  }
  if (
    text.includes("tx_activity") ||
    text.includes("tx activity") ||
    (/\btx\b/.test(text) && !text.includes("utilization"))
  ) {
    target.txActivityMBps = toNumber(state.state);
    return;
  }
  if (text.includes("snr")) {
    target.snr = toNumber(state.state);
    return;
  }
  if (text.includes("rssi") || text.includes("signal")) {
    target.rssi = toNumber(state.state);
    return;
  }
  if (text.includes("uptime") || text.includes("duration") || text.includes("connected")) {
    target.uptimeSeconds = parseUptimeSeconds(state.state);
  }
};

const normalizeDeviceType = (value: unknown) => {
  const text = toText(value).toLowerCase();
  if (!text) return "—";
  if (text === "ap") return "Access Point";
  if (text === "gateway") return "Gateway";
  if (text === "switch") return "Switch";
  return safeString(value);
};

const inferDeviceTypeFromModel = (model?: string) => {
  if (!model) return undefined;
  const text = model.toLowerCase();
  if (text.startsWith("eap")) return "Access Point";
  if (text.startsWith("er")) return "Gateway";
  if (text.startsWith("sg") || text.startsWith("tl-sg")) return "Switch";
  return undefined;
};

const enrichRowWithDevice = (
  row: MappedTrackerRow,
  device: DeviceRegistryEntry | undefined,
): MappedTrackerRow => {
  if (!device) return row;
  const macFromConnections = device.connections?.find((item) => {
    const kind = String(item[0] ?? "").toLowerCase();
    return kind.includes("mac");
  })?.[1];

  return {
    ...row,
    name: row.name === "—" ? safeString(device.name_by_user ?? device.name ?? "—") : row.name,
    nameRaw:
      row.nameRaw === "—"
        ? safeString(device.name_by_user ?? device.name ?? "—")
        : row.nameRaw,
    mac:
      row.mac === "—"
        ? safeString(macFromConnections ?? row.mac)
        : row.mac,
    macNormalized:
      row.macNormalized.length === 0 && macFromConnections
        ? normalizeMac(macFromConnections)
        : row.macNormalized,
    deviceType:
      row.deviceType && row.deviceType !== "—"
        ? row.deviceType
        : inferDeviceTypeFromModel(device.model) ?? row.deviceType,
    deviceModel:
      row.deviceModel && row.deviceModel !== "—"
        ? row.deviceModel
        : safeString(device.model ?? row.deviceModel ?? "—"),
    deviceFirmware:
      row.deviceFirmware && row.deviceFirmware !== "—"
        ? row.deviceFirmware
        : safeString(device.sw_version ?? row.deviceFirmware ?? "—"),
  };
};

const pickStatusFromStates = (states: HassEntity[]): { isOnline: boolean; raw: string } => {
  for (const state of states) {
    const normalized = String(state.state ?? "").toLowerCase();
    if (STATUS_ONLINE.has(normalized)) return { isOnline: true, raw: state.state };
    if (normalized === "off" || normalized === "not_home") {
      return { isOnline: false, raw: state.state };
    }
  }

  const switchState = states.find((state) => state.entity_id.startsWith("switch."));
  if (switchState) {
    const isOnline = String(switchState.state).toLowerCase() !== "off";
    return { isOnline, raw: switchState.state };
  }

  return { isOnline: false, raw: "unknown" };
};

const pickPrimaryEntity = (states: HassEntity[]): HassEntity | undefined => {
  const priority = [
    (state: HassEntity) => state.entity_id.startsWith("device_tracker."),
    (state: HassEntity) => state.entity_id.startsWith("switch."),
    (state: HassEntity) => state.entity_id.startsWith("button."),
    (state: HassEntity) => state.entity_id.startsWith("sensor."),
  ];
  for (const selector of priority) {
    const match = states.find(selector);
    if (match) return match;
  }
  return states[0];
};

const shouldSkipDeviceOnlyRow = (states: HassEntity[]): boolean => {
  if (states.some((state) => state.entity_id.startsWith("device_tracker."))) return false;
  // Skip only update-only groups.
  return states.every((state) => state.entity_id.startsWith("update."));
};

const hasWirelessDeviceSignals = (states: HassEntity[]) =>
  states.some((state) => {
    const id = state.entity_id.toLowerCase();
    const attrs = state.attributes as Record<string, unknown>;
    const friendly = String(attrs.friendly_name ?? "").toLowerCase();
    const text = `${id} ${friendly}`;
    return (
      text.includes("reconnect") ||
      text.includes("rssi") ||
      text.includes(" snr") ||
      text.includes(" 5g") ||
      text.includes(" 6g") ||
      text.includes(" 2.4g") ||
      attrs.wireless === true ||
      String(attrs.wireless).toLowerCase() === "true"
    );
  });

const findNumberFromStates = (states: HassEntity[], keywords: string[]): number | null => {
  for (const state of states) {
    const id = state.entity_id.toLowerCase();
    const attrs = state.attributes as Record<string, unknown>;
    const friendly = String(attrs.friendly_name ?? "").toLowerCase();
    const text = `${id} ${friendly}`;
    if (!keywords.some((keyword) => text.includes(keyword))) continue;
    const value = toNumber(state.state);
    if (value !== null) return value;
  }
  return null;
};

const findPowerSaveFromStates = (states: HassEntity[]): { text: string; value: number | null } => {
  for (const state of states) {
    const id = state.entity_id.toLowerCase();
    if (!id.includes("power_save")) continue;
    const normalized = String(state.state ?? "").toLowerCase();
    if (normalized === "on") return { text: "On", value: 1 };
    if (normalized === "off") return { text: "Off", value: 0 };
    return { text: safeString(state.state), value: null };
  }
  return { text: "—", value: null };
};

type OmadaClientLookup = {
  ip?: string;
  name?: string;
  mac?: string;
};

const normalizeNameKey = (value: string) => value.trim().toLowerCase();

const buildControllerClientLookup = (states: HassEntity[]) => {
  const byMac = new Map<string, OmadaClientLookup>();
  const byName = new Map<string, OmadaClientLookup>();

  for (const state of states) {
    if (!state.entity_id.startsWith("sensor.")) continue;
    const attrs = state.attributes as Record<string, unknown>;
    const clients = attrs.clients;
    if (!Array.isArray(clients)) continue;

    for (const item of clients) {
      if (!item || typeof item !== "object") continue;
      const client = item as Record<string, unknown>;
      const macText = safeString(client.mac);
      const normalizedMac = normalizeMac(macText);
      const name = safeString(client.name);
      const ip = safeString(client.ip);
      const value: OmadaClientLookup = {
        ip: ip === "—" ? undefined : ip,
        name: name === "—" ? undefined : name,
        mac: macText === "—" ? undefined : macText,
      };
      if (normalizedMac.length > 0) {
        byMac.set(normalizedMac, value);
      }
      if (name !== "—") {
        byName.set(normalizeNameKey(name), value);
      }
    }
  }

  return { byMac, byName };
};

const enrichRowWithControllerClientLookup = (
  row: MappedTrackerRow,
  lookup: ReturnType<typeof buildControllerClientLookup>,
) => {
  const matchByMac =
    row.macNormalized.length > 0 ? lookup.byMac.get(row.macNormalized) : undefined;
  const matchByName = lookup.byName.get(normalizeNameKey(row.nameRaw));
  const match = matchByMac ?? matchByName;
  if (!match) return row;

  const nextMac = row.mac === "—" ? safeString(match.mac ?? "—") : row.mac;
  const nextMacNormalized = normalizeMac(nextMac);
  return {
    ...row,
    ip: row.ip === "—" ? safeString(match.ip ?? row.ip) : row.ip,
    name: row.name === "—" ? safeString(match.name ?? row.name) : row.name,
    nameRaw: row.nameRaw === "—" ? safeString(match.name ?? row.nameRaw) : row.nameRaw,
    hostname:
      row.hostname === "—" ? safeString(match.name ?? row.hostname) : row.hostname,
    mac: nextMac,
    macNormalized: nextMacNormalized.length > 0 ? nextMacNormalized : row.macNormalized,
  };
};

const applyOmadaDeviceContext = (
  row: MappedTrackerRow,
  states: HassEntity[],
): MappedTrackerRow => {
  const hasWireless = hasWirelessDeviceSignals(states);
  const inferredSnr = row.snrValue ?? findNumberFromStates(states, ["snr"]);
  const inferredSignal = row.signalValue ?? findNumberFromStates(states, ["rssi", " signal"]);
  const powerSave = findPowerSaveFromStates(states);

  const nextConnectionType =
    row.connectionType === "wired" && hasWireless ? "wifi" : row.connectionType;
  const nextConnection =
    row.connectionType === "wired" && hasWireless ? "WiFi" : row.connection;

  return {
    ...row,
    connectionType: nextConnectionType,
    connection: nextConnection,
    signal: inferredSignal !== null ? `${inferredSignal} dBm` : row.signal,
    signalValue: inferredSignal,
    signalColor: signalColor(inferredSignal),
    snr: inferredSnr !== null ? `${inferredSnr} dB` : row.snr,
    snrValue: inferredSnr,
    powerSave: powerSave.text,
    powerSaveValue: powerSave.value,
  };
};

const buildRowFromDeviceOnlyStates = (
  deviceId: string,
  states: HassEntity[],
  metrics: OmadaClientMetrics | undefined,
  speedUnit: "MBps" | "Mbps",
  device: DeviceRegistryEntry | undefined,
): MappedTrackerRow | null => {
  if (states.length === 0 || shouldSkipDeviceOnlyRow(states)) return null;

  const primary = pickPrimaryEntity(states);
  if (!primary) return null;

  const attrs = primary.attributes as Record<string, unknown>;
  const status = pickStatusFromStates(states);
  const normalizedType = normalizeDeviceType(attrs.type ?? inferDeviceTypeFromModel(device?.model));
  const connectionLabel =
    normalizedType === "Gateway" || normalizedType === "Switch" || normalizedType === "Access Point"
      ? normalizedType
      : "Wired";

  const downloadedMB = metrics?.downloadedMB ?? null;
  const uploadedMB = metrics?.uploadedMB ?? null;
  const downloadedBytes = downloadedMB !== null ? downloadedMB * 1024 * 1024 : null;
  const uploadedBytes = uploadedMB !== null ? uploadedMB * 1024 * 1024 : null;
  const trafficUsageValue =
    downloadedBytes !== null || uploadedBytes !== null
      ? (downloadedBytes ?? 0) + (uploadedBytes ?? 0)
      : null;

  const row: MappedTrackerRow = {
    entity_id: primary.entity_id,
    deviceId,
    name: safeString(device?.name_by_user ?? device?.name ?? primary.attributes.friendly_name ?? primary.entity_id),
    nameRaw: safeString(device?.name_by_user ?? device?.name ?? primary.attributes.friendly_name ?? primary.entity_id),
    macNormalized: normalizeMac(
      safeString(
        attrs.mac ??
          attrs.mac_address ??
          device?.connections?.find((entry) => String(entry[0]).toLowerCase().includes("mac"))?.[1] ??
          "",
      ),
    ),
    isOnline: status.isOnline,
    statusValue: status.isOnline ? 1 : 0,
    statusColor: status.isOnline ? "#3aa45b" : "#9aa0a6",
    connection: connectionLabel,
    connectionType: normalizedType === "—" ? "wired" : "unknown",
    band: "—",
    bandType: "unknown",
    ip: safeString(attrs.ip ?? attrs.ip_address ?? "—"),
    mac: safeString(
      attrs.mac ??
        attrs.mac_address ??
        device?.connections?.find((entry) => String(entry[0]).toLowerCase().includes("mac"))?.[1] ??
        "—",
    ),
    hostname: safeString(attrs.host_name ?? attrs.hostname ?? attrs.name ?? device?.name_by_user ?? device?.name ?? "—"),
    packetsSent: "—",
    packetsSentValue: null,
    packetsReceived: "—",
    packetsReceivedValue: null,
    upSpeed: formatTransferSpeed(metrics?.txActivityMBps ?? null, speedUnit),
    upSpeedValue:
      metrics?.txActivityMBps !== null && metrics?.txActivityMBps !== undefined
        ? metrics.txActivityMBps * 8
        : null,
    downSpeed: formatTransferSpeed(metrics?.rxActivityMBps ?? null, speedUnit),
    downSpeedValue:
      metrics?.rxActivityMBps !== null && metrics?.rxActivityMBps !== undefined
        ? metrics.rxActivityMBps * 8
        : null,
    txRate: "—",
    txRateValue: null,
    rxRate: "—",
    rxRateValue: null,
    onlineTime: formatDuration(metrics?.uptimeSeconds ?? null),
    onlineTimeValue: metrics?.uptimeSeconds ?? null,
    downloaded: formatBytes(downloadedBytes),
    downloadedValue: downloadedBytes,
    uploaded: formatBytes(uploadedBytes),
    uploadedValue: uploadedBytes,
    trafficUsage: formatBytes(trafficUsageValue),
    trafficUsageValue,
    signal:
      metrics?.rssi !== null && metrics?.rssi !== undefined
        ? `${metrics.rssi} dBm`
        : "—",
    signalValue: metrics?.rssi ?? null,
    signalColor: signalColor(metrics?.rssi ?? null),
    snr:
      metrics?.snr !== null && metrics?.snr !== undefined
        ? `${metrics.snr} dB`
        : "—",
    snrValue: metrics?.snr ?? null,
    powerSave: "—",
    powerSaveValue: null,
    deviceType: normalizedType,
    deviceModel: safeString(device?.model ?? attrs.model ?? attrs.device_model ?? "—"),
    deviceFirmware: safeString(device?.sw_version ?? attrs.firmware ?? attrs.firmware_version ?? "—"),
    deviceStatus:
      status.raw !== "unknown" ? safeString(status.raw) : safeString(attrs.status ?? "—"),
  };

  return enrichRowWithDevice(applyOmadaDeviceContext(row, states), device);
};

export const buildOmadaClientMetrics = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
) => {
  const byDevice = new Map<string, OmadaClientMetrics>();
  if (!entryId || entityRegistry.length === 0) return byDevice;

  for (const entry of entityRegistry) {
    if (entry.config_entry_id !== entryId) continue;
    if (!entry.device_id) continue;
    if (!entry.entity_id.startsWith("sensor.")) continue;
    const state = allStates[entry.entity_id];
    if (!state) continue;
    if (!byDevice.has(entry.device_id)) byDevice.set(entry.device_id, defaultMetrics());
    mapSensorMetric(state, byDevice.get(entry.device_id) as OmadaClientMetrics);
  }

  return byDevice;
};

export const selectOmadaTrackers = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  entryId: string | undefined,
  registryFailed: boolean,
) => {
  const fallbackTrackers = Object.values(allStates).filter((state) =>
    isLikelyOmadaTrackerByAttrs(state),
  );

  if (!entryId) return fallbackTrackers;
  if (!registryFailed && entityRegistry.length === 0) return [];
  if (registryFailed || entityRegistry.length === 0) return fallbackTrackers;

  const selected = entityRegistry
    .filter((entry) => entry.config_entry_id === entryId)
    .filter((entry) => entry.entity_id.startsWith("device_tracker."))
    .map((entry) => allStates[entry.entity_id])
    .filter((state): state is HassEntity => state !== undefined);

  if (selected.length > 0) return selected;
  return [];
};

export const mapOmadaStateToRow = (
  state: HassEntity,
  speedUnit: "MBps" | "Mbps",
  metrics?: OmadaClientMetrics,
): MappedTrackerRow => {
  const attrs = state.attributes as Record<string, unknown>;
  const nameRaw = safeString(attrs.friendly_name ?? attrs.name ?? state.entity_id);
  const isOnline = STATUS_ONLINE.has(state.state);
  const { label: connection, type: connectionType } = resolveConnection(attrs);
  const bandType = normalizeBand(attrs);
  const band =
    bandType === "2g" ? "2G" : bandType === "5g" ? "5G" : bandType === "6g" ? "6G" : "—";

  const ip = safeString(attrs.ip ?? attrs.ip_address ?? "—");
  const mac = safeString(attrs.mac ?? attrs.mac_address ?? attrs.client_mac ?? "—");
  const hostname = safeString(
    attrs.host_name ?? attrs.hostname ?? attrs.hostName ?? attrs.name ?? attrs.model ?? "—",
  );

  const packetsSentValue = toNumber(attrs.packets_sent ?? attrs.up_packet ?? attrs.upPacket);
  const packetsReceivedValue = toNumber(
    attrs.packets_received ?? attrs.down_packet ?? attrs.downPacket,
  );

  const upMBps = metrics?.txActivityMBps ?? null;
  const downMBps = metrics?.rxActivityMBps ?? null;
  const upSpeedValue = upMBps !== null ? upMBps * 8 : null;
  const downSpeedValue = downMBps !== null ? downMBps * 8 : null;

  const txRateRaw = resolveLinkRateRaw(attrs, [
    "tx_rate",
    "txRate",
    "link_tx_rate",
    "linkTxRate",
    "tx_link_speed",
    "txLinkSpeed",
  ]);
  const rxRateRaw = resolveLinkRateRaw(attrs, [
    "rx_rate",
    "rxRate",
    "link_rx_rate",
    "linkRxRate",
    "rx_link_speed",
    "rxLinkSpeed",
  ]);
  const txRateValue = normalizeLinkMbps(txRateRaw, bandType, "auto");
  const rxRateValue = normalizeLinkMbps(rxRateRaw, bandType, "auto");

  const downloadedMB = metrics?.downloadedMB ?? null;
  const uploadedMB = metrics?.uploadedMB ?? null;
  const downloadedBytes = downloadedMB !== null ? downloadedMB * 1024 * 1024 : null;
  const uploadedBytes = uploadedMB !== null ? uploadedMB * 1024 * 1024 : null;
  const trafficDownBytes = toNumber(attrs.traffic_down ?? attrs.trafficDown);
  const trafficUpBytes = toNumber(attrs.traffic_up ?? attrs.trafficUp);
  const fallbackTraffic = toNumber(attrs.traffic_usage);
  const downloadedValue = downloadedBytes ?? trafficDownBytes;
  const uploadedValue = uploadedBytes ?? trafficUpBytes;
  const trafficUsageValue =
    downloadedBytes !== null || uploadedBytes !== null
      ? (downloadedBytes ?? 0) + (uploadedBytes ?? 0)
      : trafficDownBytes !== null || trafficUpBytes !== null
        ? (trafficDownBytes ?? 0) + (trafficUpBytes ?? 0)
        : fallbackTraffic;

  const onlineTimeValue =
    metrics?.uptimeSeconds ??
    parseUptimeSeconds(attrs.uptime ?? attrs.online_time ?? attrs.connected_since) ??
    null;
  const signalValue = toNumber(attrs.rssi ?? attrs.signal) ?? metrics?.rssi ?? null;
  const snrValue = toNumber(attrs.snr) ?? metrics?.snr ?? null;
  const powerSaveRaw = attrs.power_save ?? attrs.powerSave;
  const powerSaveValue =
    String(powerSaveRaw).toLowerCase() === "on" || powerSaveRaw === true
      ? 1
      : String(powerSaveRaw).toLowerCase() === "off" || powerSaveRaw === false
        ? 0
        : null;
  const powerSave =
    powerSaveValue === 1 ? "On" : powerSaveValue === 0 ? "Off" : "—";
  const deviceTypeRaw = toText(attrs.type);
  const deviceType =
    deviceTypeRaw.toLowerCase() === "ap"
      ? "Access Point"
      : deviceTypeRaw.toLowerCase() === "gateway"
        ? "Gateway"
        : deviceTypeRaw.toLowerCase() === "switch"
          ? "Switch"
          : safeString(attrs.connect_dev_type ?? attrs.connectDevType ?? "—");
  const deviceModel = safeString(attrs.model ?? attrs.device_model ?? "—");
  const deviceFirmware = safeString(attrs.firmware ?? attrs.firmware_version ?? "—");
  const deviceStatus = safeString(attrs.status ?? attrs.status_category ?? "—");

  return {
    entity_id: state.entity_id,
    name: nameRaw,
    nameRaw,
    macNormalized: normalizeMac(mac),
    isOnline,
    statusValue: isOnline ? 1 : 0,
    statusColor: isOnline ? "#3aa45b" : "#9aa0a6",
    connection,
    connectionType,
    band,
    bandType,
    ip,
    mac,
    hostname,
    packetsSent: formatNumber(packetsSentValue ?? Number.NaN),
    packetsSentValue,
    packetsReceived: formatNumber(packetsReceivedValue ?? Number.NaN),
    packetsReceivedValue,
    upSpeed: formatTransferSpeed(upMBps, speedUnit),
    upSpeedValue,
    downSpeed: formatTransferSpeed(downMBps, speedUnit),
    downSpeedValue,
    txRate: formatLinkSpeed(txRateRaw, bandType, "auto"),
    txRateValue,
    rxRate: formatLinkSpeed(rxRateRaw, bandType, "auto"),
    rxRateValue,
    onlineTime: formatDuration(onlineTimeValue),
    onlineTimeValue,
    downloaded: formatBytes(downloadedValue),
    downloadedValue,
    uploaded: formatBytes(uploadedValue),
    uploadedValue,
    trafficUsage: formatBytes(trafficUsageValue),
    trafficUsageValue,
    signal: signalValue !== null ? `${signalValue} dBm` : "—",
    signalValue,
    signalColor: signalColor(signalValue),
    snr: snrValue !== null ? `${snrValue} dB` : "—",
    snrValue,
    powerSave,
    powerSaveValue,
    deviceType,
    deviceModel,
    deviceFirmware,
    deviceStatus,
  };
};

export const buildOmadaRows = (
  allStates: Record<string, HassEntity>,
  entityRegistry: EntityRegistryEntry[],
  deviceRegistry: DeviceRegistryEntry[],
  entryId: string | undefined,
  registryFailed: boolean,
  speedUnit: "MBps" | "Mbps",
): MappedTrackerRow[] => {
  if (!entryId) return [];

  if (!registryFailed && entityRegistry.length === 0) return [];
  if (registryFailed || entityRegistry.length === 0) {
    return selectOmadaTrackers(allStates, entityRegistry, entryId, registryFailed).map((tracker) =>
      mapOmadaStateToRow(tracker, speedUnit),
    );
  }

  const entryEntities = entityRegistry.filter((entry) => entry.config_entry_id === entryId);
  if (entryEntities.length === 0) return [];

  const byGroupKey = new Map<string, { deviceId?: string; entries: EntityRegistryEntry[] }>();
  for (const entry of entryEntities) {
    const key = entry.device_id ? `device:${entry.device_id}` : `entity:${entry.entity_id}`;
    const group = byGroupKey.get(key) ?? { deviceId: entry.device_id, entries: [] };
    group.entries.push(entry);
    byGroupKey.set(key, group);
  }

  if (byGroupKey.size === 0) return [];

  const metricsByDevice = buildOmadaClientMetrics(allStates, entityRegistry, entryId);
  const devicesById = new Map(deviceRegistry.map((device) => [device.id, device] as const));
  const controllerClientLookup = buildControllerClientLookup(
    entryEntities
      .map((entry) => allStates[entry.entity_id])
      .filter((state): state is HassEntity => state !== undefined),
  );
  const rows: MappedTrackerRow[] = [];

  for (const group of byGroupKey.values()) {
    const { deviceId, entries } = group;
    const states = entries
      .map((entry) => allStates[entry.entity_id])
      .filter((state): state is HassEntity => state !== undefined);

    if (states.length === 0) continue;

    const tracker = states.find((state) => state.entity_id.startsWith("device_tracker."));
    const metrics = deviceId ? metricsByDevice.get(deviceId) : undefined;
    const device = deviceId ? devicesById.get(deviceId) : undefined;

    if (tracker) {
      const row = enrichRowWithControllerClientLookup(
        applyOmadaDeviceContext(
          {
            ...mapOmadaStateToRow(tracker, speedUnit, metrics),
            deviceId,
          },
          states,
        ),
        {
          byMac: controllerClientLookup.byMac,
          byName: controllerClientLookup.byName,
        },
      );
      rows.push(enrichRowWithDevice(row, device));
      continue;
    }

    const fallbackRow = buildRowFromDeviceOnlyStates(
      deviceId ?? entries[0]?.entity_id,
      states,
      metrics,
      speedUnit,
      device,
    );
    if (fallbackRow) {
      rows.push(
        enrichRowWithControllerClientLookup(fallbackRow, controllerClientLookup),
      );
    }
  }

  return rows;
};

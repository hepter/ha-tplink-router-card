export type ActionDomain = "switch" | "button";
export type ActionKind = "host" | "guest" | "iot" | "router";
export type ActionBand = "2g" | "5g" | "6g";

export type HeaderActionGroup =
  | "wifi"
  | "guest"
  | "iot"
  | "reboot"
  | "scanning"
  | "controller"
  | "vpn"
  | "dhcp"
  | "wan";

export const HEADER_ACTION_GROUPS: readonly HeaderActionGroup[] = [
  "wifi",
  "guest",
  "iot",
  "reboot",
  "scanning",
  "controller",
  "vpn",
  "dhcp",
  "wan",
];

// Groups that can lock the operator out (DHCP, VPN, WAN) or are rarely toggled (IoT) stay opt-in.
export const DEFAULT_HEADER_ACTION_GROUPS: readonly HeaderActionGroup[] = [
  "wifi",
  "guest",
  "reboot",
  "scanning",
  "controller",
];

export type MatchedAction = {
  kind: ActionKind;
  group: HeaderActionGroup;
  band?: ActionBand;
  requiresHold: boolean;
};

const parseBand = (text: string): ActionBand | undefined => {
  if (/(2\.4|2g|2ghz|24g)/i.test(text)) return "2g";
  if (/(5g|5ghz)/i.test(text)) return "5g";
  if (/(6g|6ghz)/i.test(text)) return "6g";
  return undefined;
};

export const resolveHeaderActionGroups = (
  configured: unknown,
): ReadonlySet<HeaderActionGroup> => {
  if (!Array.isArray(configured)) return new Set(DEFAULT_HEADER_ACTION_GROUPS);
  const values = configured.map((value) => String(value ?? "").trim().toLowerCase());
  if (values.includes("all")) return new Set(HEADER_ACTION_GROUPS);
  return new Set(
    values.filter((value): value is HeaderActionGroup =>
      (HEADER_ACTION_GROUPS as readonly string[]).includes(value),
    ),
  );
};

export const matchAction = (
  domain: ActionDomain,
  entityId: string,
  friendlyName: string,
  integrationDomain?: string,
): MatchedAction | null => {
  const text = `${entityId} ${friendlyName}`.toLowerCase();
  const isOmadaIntegration =
    integrationDomain === "omada" || integrationDomain === "tplink_omada";

  if (domain === "button") {
    if (text.includes("reboot") || text.includes("restart")) {
      return { kind: "router", group: "reboot", requiresHold: true };
    }
    if (isOmadaIntegration && text.includes("reconnect")) {
      return { kind: "router", group: "controller", requiresHold: true };
    }
    if (
      isOmadaIntegration &&
      (text.includes("wlan optimization") || text.includes("rf planning"))
    ) {
      return { kind: "router", group: "controller", requiresHold: true };
    }
    return null;
  }

  // switch domain
  const isScanning =
    text.includes("data fetching") ||
    text.includes("scanning") ||
    (integrationDomain === "tplink_deco" && text.includes("polling"));
  if (isScanning) return { kind: "router", group: "scanning", requiresHold: false };

  if (text.includes("guest")) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "guest", group: "guest", band, requiresHold: true };
  }

  if (text.includes("iot")) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "iot", group: "iot", band, requiresHold: true };
  }

  if (integrationDomain === "tplink_router" && text.includes("vpn")) {
    return { kind: "router", group: "vpn", requiresHold: true };
  }
  if (integrationDomain === "tplink_router" && text.includes("dhcp")) {
    return { kind: "router", group: "dhcp", requiresHold: true };
  }
  if (integrationDomain === "tplink_omada" && text.includes("wan_connect")) {
    return { kind: "router", group: "wan", requiresHold: true };
  }

  if (
    text.includes("wifi") ||
    text.includes("wlan") ||
    text.includes("radio") ||
    text.includes("ssid")
  ) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "host", group: "wifi", band, requiresHold: true };
  }

  return null;
};

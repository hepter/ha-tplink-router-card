export type ActionDomain = "switch" | "button";
export type ActionKind = "host" | "guest" | "iot" | "router";
export type ActionBand = "2g" | "5g" | "6g";

export type MatchedAction = {
  kind: ActionKind;
  band?: ActionBand;
  requiresHold: boolean;
};

const parseBand = (text: string): ActionBand | undefined => {
  if (/(2\.4|2g|2ghz|24g)/i.test(text)) return "2g";
  if (/(5g|5ghz)/i.test(text)) return "5g";
  if (/(6g|6ghz)/i.test(text)) return "6g";
  return undefined;
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
      return { kind: "router", requiresHold: true };
    }
    if (isOmadaIntegration && text.includes("reconnect")) {
      return { kind: "router", requiresHold: true };
    }
    if (
      isOmadaIntegration &&
      (text.includes("wlan optimization") || text.includes("rf planning"))
    ) {
      return { kind: "router", requiresHold: true };
    }
    return null;
  }

  // switch domain
  const isScanning = text.includes("data fetching") || text.includes("scanning");
  if (isScanning) return { kind: "router", requiresHold: false };

  if (text.includes("guest")) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "guest", band, requiresHold: true };
  }

  if (text.includes("iot")) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "iot", band, requiresHold: true };
  }

  if (
    text.includes("wifi") ||
    text.includes("wlan") ||
    text.includes("radio") ||
    text.includes("ssid")
  ) {
    const band = parseBand(text);
    if (!band) return null;
    return { kind: "host", band, requiresHold: true };
  }

  return null;
};

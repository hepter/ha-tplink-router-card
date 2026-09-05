export type ActionRole = "block" | "reconnect" | "wlanOptimization" | "reboot" | "toggle";

export type ActionRoleContext = {
  domain: "switch" | "button";
  text: string;
  integrationDomain?: string;
  deviceHasTracker: boolean;
  entityName?: string;
  deviceName?: string;
};

const INFRASTRUCTURE_SWITCH_PATTERN =
  /(wifi|wlan|radio|ssid|guest|iot|poe|wan|scanning|data fetching|optimization|led|vpn|dhcp)/;

const HOLD_SWITCH_PATTERN = /(wifi|wlan|radio|ssid|guest|iot|block|blocked|vpn|dhcp|poe|wan)/;

const isBlockText = (text: string) =>
  text.includes(" block") ||
  text.includes("_block") ||
  text.includes("block_") ||
  text.includes("blocked");

const normalizeName = (value: string | undefined) => (value ?? "").trim().toLowerCase();

// ha-omada gives the client block switch no name of its own, so its friendly name equals
// the client device name and the entity text carries no "block" hint.
const looksLikeUnnamedOmadaBlockSwitch = (context: ActionRoleContext) => {
  if (context.domain !== "switch") return false;
  if (context.integrationDomain !== "omada") return false;
  if (!context.deviceHasTracker) return false;
  if (INFRASTRUCTURE_SWITCH_PATTERN.test(context.text)) return false;
  const deviceName = normalizeName(context.deviceName);
  if (deviceName.length === 0) return true;
  return normalizeName(context.entityName) === deviceName;
};

export const resolveActionRole = (context: ActionRoleContext): ActionRole => {
  const { text } = context;
  if (isBlockText(text)) return "block";
  if (text.includes("reconnect")) return "reconnect";
  if (
    text.includes("wlan optimization") ||
    text.includes("rf planning") ||
    text.includes("ai optimization")
  ) {
    return "wlanOptimization";
  }
  if (text.includes("reboot") || text.includes("restart")) return "reboot";
  if (looksLikeUnnamedOmadaBlockSwitch(context)) return "block";
  return "toggle";
};

export const requiresHoldForAction = (context: ActionRoleContext, role: ActionRole): boolean => {
  if (role === "block" || role === "reconnect" || role === "wlanOptimization" || role === "reboot") {
    return true;
  }
  const { domain, text } = context;
  if (
    text.includes("reboot") ||
    text.includes("restart") ||
    text.includes("reconnect") ||
    text.includes("wlan optimization") ||
    text.includes("rf planning")
  ) {
    return true;
  }
  return domain === "switch" && HOLD_SWITCH_PATTERN.test(text);
};

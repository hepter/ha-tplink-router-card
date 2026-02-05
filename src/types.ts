export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
  };
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>;
  callApi?: <T>(method: string, path: string, parameters?: Record<string, unknown>) => Promise<T>;
  callService?: (domain: string, service: string, data: Record<string, unknown>) => Promise<void>;
  language?: string;
  locale?: { language: string };
  localize?: (key: string, ...args: unknown[]) => string;
}

export interface TplinkRouterCardConfig {
  type: string;
  entity_id?: string;
  entry_id?: string;
  title?: string;
  speed_unit?: "MBps" | "Mbps";
  columns?: string[];
}

export interface ConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
}

export interface EntityRegistryEntry {
  entity_id: string;
  platform: string;
  config_entry_id?: string;
  device_id?: string;
}

export interface DeviceRegistryEntry {
  id: string;
  name?: string;
  name_by_user?: string;
  configuration_url?: string;
  identifiers?: Array<[string, string]>;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
  hw_version?: string;
  connections?: Array<[string, string]>;
}

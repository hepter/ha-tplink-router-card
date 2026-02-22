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
  txrx_color?: boolean;
  updown_color?: boolean;
  hide_header?: boolean;
  hide_filter_section?: boolean;
  shift_click_underline?: boolean;
  show_hidden_entities?: boolean;
  header_action_render?: "icon" | "name" | "icon_name";
  row_action_render?: "icon" | "name" | "icon_name";
  default_filters?: {
    band?: "all" | "2g" | "5g" | "6g";
    connection?: "all" | "wifi" | "wired" | "iot" | "guest";
    status?: "all" | "online" | "offline";
  };
  default_filter_band?: "all" | "2g" | "5g" | "6g" | "" | "__saved__";
  default_filter_connection?: "all" | "wifi" | "wired" | "iot" | "guest" | "" | "__saved__";
  default_filter_status?: "all" | "online" | "offline" | "" | "__saved__";
  upload_speed_color_max?: number;
  download_speed_color_max?: number;
  columns?: string[];
  column_layout?: Array<{
    key: string;
    fixed?: "start" | "end";
    name?: string;
    max_width?: string | number;
    maxWidth?: string | number;
  }>;
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
  hidden_by?: string | null;
  disabled_by?: string | null;
  options?: Record<string, unknown>;
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

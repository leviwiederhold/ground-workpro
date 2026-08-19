export enum ProviderKey {
  QuickBooks = "quickbooks",
  Xero = "xero",
  Stripe = "stripe",
  Square = "square",
  Expensify = "expensify",
  Samsara = "samsara",
  VerizonConnect = "verizon-connect",
  Geotab = "geotab",
  Fleetio = "fleetio",
  ClockShark = "clockshark",
  BusyBusy = "busybusy",
  Gusto = "gusto",
  ADP = "adp",
  QuickBooksTime = "quickbooks-time",
  Procore = "procore",
  PlanGrid = "plangrid",
  Buildertrend = "buildertrend",
  HCSS = "hcss",
  Twilio = "twilio",
  Slack = "slack",
  Teams = "teams",
  Calendly = "calendly",
  DocuSign = "docusign",
  Dropbox = "dropbox",
  GoogleDrive = "google-drive",
  Box = "box",
  TomorrowIO = "tomorrow-io",
  OpenWeather = "openweather",
  DTN = "dtn",
  WEX = "wex",
  Fleetcor = "fleetcor",
  Grainger = "grainger",
  SafetyCulture = "safetyculture",
  ISNetworld = "isnetworld",
  Avetta = "avetta",
  HubSpot = "hubspot",
  Salesforce = "salesforce",
  Pipedrive = "pipedrive",
}

export type ProviderCategory =
  | "financial"
  | "fleet"
  | "time"
  | "project"
  | "communication"
  | "documents"
  | "weather"
  | "fuel"
  | "compliance"
  | "crm";

export type ProviderCapabilities = {
  canConnect: boolean;
  canDisconnect: boolean;
  hasSync: boolean;
};

export type ProviderSyncResult = {
  status: "not_implemented" | "ok" | "error";
  message: string;
};

export interface ProviderAdapter {
  key: ProviderKey;
  name: string;
  category: ProviderCategory;
  icon: string;
  description: string;
  popular?: boolean;
  capabilities: ProviderCapabilities;
  getConnectUrlPlaceholder(): string;
  sync(): Promise<ProviderSyncResult>;
}

type ProviderDefinition = Omit<ProviderAdapter, "getConnectUrlPlaceholder" | "sync">;

function createStateOnlyAdapter(definition: ProviderDefinition): ProviderAdapter {
  return {
    ...definition,
    getConnectUrlPlaceholder() {
      return `/api/integrations/${definition.key}/connect`;
    },
    async sync() {
      return {
        status: "not_implemented",
        message: `${definition.name} sync is not implemented yet`,
      };
    },
  };
}

const providerDefinitions: ProviderDefinition[] = [
  { key: ProviderKey.QuickBooks, name: "QuickBooks Online", category: "financial", icon: "calculator", description: "Sync invoices, expenses, and payroll data automatically", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Xero, name: "Xero", category: "financial", icon: "coins", description: "Cloud accounting with real-time financial data", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Stripe, name: "Stripe", category: "financial", icon: "credit-card", description: "Accept payments and process deposits online", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Square, name: "Square", category: "financial", icon: "square", description: "Point-of-sale and payment processing", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Expensify, name: "Expensify", category: "financial", icon: "receipt", description: "Receipt capture and expense report automation", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Samsara, name: "Samsara", category: "fleet", icon: "satellite-dish", description: "Real-time GPS tracking, telematics, and driver safety", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.VerizonConnect, name: "Verizon Connect", category: "fleet", icon: "location-crosshairs", description: "Equipment tracking and workforce management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Geotab, name: "Geotab", category: "fleet", icon: "map-pin", description: "Telematics and equipment optimization platform", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Fleetio, name: "Fleetio", category: "fleet", icon: "truck", description: "Equipment maintenance and fuel management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.ClockShark, name: "ClockShark", category: "time", icon: "clock", description: "GPS time tracking built for field crews", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.BusyBusy, name: "busybusy", category: "time", icon: "stopwatch", description: "Construction time tracking and job costing", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Gusto, name: "Gusto", category: "time", icon: "money-bill-wave", description: "Full-service payroll, benefits, and HR", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.ADP, name: "ADP", category: "time", icon: "building", description: "Enterprise payroll and workforce management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.QuickBooksTime, name: "QuickBooks Time", category: "time", icon: "user-clock", description: "Time tracking synced with QuickBooks", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Procore, name: "Procore", category: "project", icon: "helmet-safety", description: "Industry-leading construction management platform", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.PlanGrid, name: "PlanGrid", category: "project", icon: "drafting-compass", description: "Blueprints, punch lists, and field reports", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Buildertrend, name: "Buildertrend", category: "project", icon: "house-chimney", description: "Project management and client portal", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.HCSS, name: "HCSS HeavyBid", category: "project", icon: "calculator", description: "Heavy civil estimating and bidding", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Twilio, name: "Twilio", category: "communication", icon: "comment-sms", description: "SMS alerts for weather, schedules, and emergencies", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Slack, name: "Slack", category: "communication", icon: "hashtag", description: "Team messaging and channel-based communication", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Teams, name: "Microsoft Teams", category: "communication", icon: "users", description: "Chat, meetings, and file collaboration", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Calendly, name: "Calendly", category: "communication", icon: "calendar-check", description: "Easy scheduling for client meetings", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.DocuSign, name: "DocuSign", category: "documents", icon: "file-signature", description: "Digital signatures for contracts and change orders", popular: true, capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Dropbox, name: "Dropbox", category: "documents", icon: "box", description: "Cloud file storage and sharing", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.GoogleDrive, name: "Google Drive", category: "documents", icon: "google-drive", description: "Cloud storage with docs, sheets, and slides", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Box, name: "Box", category: "documents", icon: "box-archive", description: "Secure enterprise content management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.TomorrowIO, name: "Tomorrow.io", category: "weather", icon: "cloud-sun", description: "Hyperlocal weather forecasting and alerts", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.OpenWeather, name: "OpenWeatherMap", category: "weather", icon: "temperature-half", description: "Weather data API for job site conditions", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.DTN, name: "DTN", category: "weather", icon: "cloud-bolt", description: "Agriculture and construction-grade weather data", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.WEX, name: "WEX", category: "fuel", icon: "gas-pump", description: "Equipment fuel cards and spend management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Fleetcor, name: "Fleetcor", category: "fuel", icon: "credit-card", description: "Fuel cards and workforce payments", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Grainger, name: "Grainger", category: "fuel", icon: "screwdriver-wrench", description: "Industrial supplies and parts ordering", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.SafetyCulture, name: "SafetyCulture", category: "compliance", icon: "clipboard-check", description: "Digital inspections and safety checklists", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.ISNetworld, name: "ISNetworld", category: "compliance", icon: "shield-halved", description: "Contractor safety management network", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Avetta, name: "Avetta", category: "compliance", icon: "certificate", description: "Supply chain risk management", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.HubSpot, name: "HubSpot", category: "crm", icon: "chart-line", description: "CRM, marketing, and sales automation", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Salesforce, name: "Salesforce", category: "crm", icon: "cloud", description: "Enterprise CRM and customer platform", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
  { key: ProviderKey.Pipedrive, name: "Pipedrive", category: "crm", icon: "filter", description: "Sales pipeline and deal tracking", capabilities: { canConnect: true, canDisconnect: true, hasSync: false } },
];

const adapters = providerDefinitions.map(createStateOnlyAdapter);

const adapterByKey = new Map<ProviderKey, ProviderAdapter>(
  adapters.map((adapter) => [adapter.key, adapter])
);

export function listProviderAdapters(): ProviderAdapter[] {
  return [...adapters];
}

export function parseProviderKey(value: string): ProviderKey | null {
  const match = (Object.values(ProviderKey) as string[]).find((providerKey) => providerKey === value);
  return (match as ProviderKey | undefined) ?? null;
}

export function getProviderAdapter(providerKey: ProviderKey): ProviderAdapter {
  const adapter = adapterByKey.get(providerKey);
  if (!adapter) {
    throw new Error(`Unknown provider key: ${providerKey}`);
  }
  return adapter;
}

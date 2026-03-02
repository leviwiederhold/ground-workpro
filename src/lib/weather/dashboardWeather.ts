type DashboardWeather = {
  locationLabel: string;
  tempF: number;
  condition: string;
  highF: number;
  lowF: number;
  mode: "live" | "placeholder";
  note?: string;
};

const PLACEHOLDER: DashboardWeather = {
  locationLabel: "Cincinnati",
  tempF: 47,
  condition: "Partly Cloudy",
  highF: 52,
  lowF: 39,
  mode: "placeholder",
  note: "Not connected to external weather provider",
};

const asNumber = (value: unknown, fallback: number) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export async function getDashboardWeather(): Promise<DashboardWeather> {
  const apiKey = String(process.env.WEATHER_API_KEY ?? "").trim();
  const provider = String(process.env.WEATHER_PROVIDER ?? "openweather").trim().toLowerCase();
  const location = String(process.env.WEATHER_LOCATION ?? "Cincinnati,US").trim();

  if (!apiKey || provider !== "openweather") {
    return PLACEHOLDER;
  }

  try {
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("q", location);
    url.searchParams.set("units", "imperial");
    url.searchParams.set("appid", apiKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return PLACEHOLDER;
    }
    const payload = (await response.json()) as {
      name?: string;
      weather?: Array<{ main?: string; description?: string }>;
      main?: { temp?: number; temp_min?: number; temp_max?: number };
    };

    const name = String(payload.name ?? "").trim();
    const condition = String(payload.weather?.[0]?.main ?? payload.weather?.[0]?.description ?? "Clear").trim();
    const temp = Math.round(asNumber(payload.main?.temp, PLACEHOLDER.tempF));
    const low = Math.round(asNumber(payload.main?.temp_min, temp));
    const high = Math.round(asNumber(payload.main?.temp_max, temp));

    return {
      locationLabel: name || location,
      tempF: temp,
      condition,
      highF: high,
      lowF: low,
      mode: "live",
    };
  } catch {
    return PLACEHOLDER;
  }
}


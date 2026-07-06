/* eslint-disable @typescript-eslint/no-explicit-any */
// Provider-agnostic geocoding/address autocomplete. Keys are read from env and
// never hardcoded. Supported (in priority order):
//   Geoapify : GEOAPIFY_API_KEY | NEXT_PUBLIC_GEOAPIFY_API_KEY   (chosen provider)
//   Mapbox   : MAPBOX_SERVER_TOKEN | NEXT_PUBLIC_MAPBOX_TOKEN
//   Google   : GOOGLE_MAPS_SERVER_KEY | NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
// Only one key is required — Geoapify alone is sufficient; Mapbox/Google are not
// needed. If no key is set, isGeocodeConfigured() is false and the UI falls back
// to plain manual entry (address stored unverified, no coordinates).

export type GeocodeSuggestion = { placeId: string; description: string };

export type GeocodeResult = {
  placeId: string;
  formatted: string;
  lat: number;
  lng: number;
  components: { street?: string; city?: string; state?: string; zip?: string };
};

type Provider = { kind: 'geoapify' | 'mapbox' | 'google'; token: string };

function getProvider(): Provider | null {
  const geoapify = (process.env.GEOAPIFY_API_KEY || process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY || '').trim();
  if (geoapify) return { kind: 'geoapify', token: geoapify };
  const mapbox = (process.env.MAPBOX_SERVER_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (mapbox) return { kind: 'mapbox', token: mapbox };
  const google = (process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
  if (google) return { kind: 'google', token: google };
  return null;
}

// --- Geoapify --------------------------------------------------------------
function geoapifyResult(r: any): GeocodeResult | null {
  const lat = Number(r?.lat);
  const lng = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    placeId: String(r.place_id ?? ''),
    formatted: String(r.formatted ?? ''),
    lat,
    lng,
    components: {
      street: r.address_line1 || [r.housenumber, r.street].filter(Boolean).join(' ') || undefined,
      city: r.city || r.county,
      state: r.state_code || r.state,
      zip: r.postcode,
    },
  };
}

async function geoapifyQuery(token: string, path: 'autocomplete' | 'search', text: string, limit: number): Promise<any[]> {
  const url = `https://api.geoapify.com/v1/geocode/${path}?text=${encodeURIComponent(text)}&format=json&limit=${limit}&apiKey=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.results) ? json.results : [];
}

export function isGeocodeConfigured(): boolean {
  return getProvider() !== null;
}

// --- Mapbox ----------------------------------------------------------------
function mapboxComponents(feature: any): GeocodeResult['components'] {
  const ctx: any[] = Array.isArray(feature?.context) ? feature.context : [];
  const find = (prefix: string) => ctx.find((c) => String(c?.id || '').startsWith(prefix))?.text;
  return {
    street: [feature?.address, feature?.text].filter(Boolean).join(' ') || undefined,
    city: find('place'),
    state: find('region'),
    zip: find('postcode'),
  };
}

async function mapboxForward(token: string, query: string, limit: number): Promise<any[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?autocomplete=true&types=address,place,poi&limit=${limit}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.features) ? json.features : [];
}

// --- Google ----------------------------------------------------------------
async function googleAutocomplete(token: string, query: string): Promise<GeocodeSuggestion[]> {
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&key=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return (json?.predictions ?? []).map((p: any) => ({ placeId: String(p.place_id), description: String(p.description) }));
}

async function googleDetails(token: string, placeId: string): Promise<GeocodeResult | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,geometry,address_component&key=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const r = json?.result;
  const loc = r?.geometry?.location;
  if (!r || !loc) return null;
  const comp = (type: string) => (r.address_components ?? []).find((c: any) => (c.types || []).includes(type))?.short_name;
  return {
    placeId,
    formatted: String(r.formatted_address || ''),
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    components: {
      street: [comp('street_number'), comp('route')].filter(Boolean).join(' ') || undefined,
      city: comp('locality') || comp('sublocality'),
      state: comp('administrative_area_level_1'),
      zip: comp('postal_code'),
    },
  };
}

// --- Public API ------------------------------------------------------------
export async function suggestAddresses(query: string): Promise<GeocodeSuggestion[]> {
  const q = query.trim();
  const provider = getProvider();
  if (!provider || q.length < 3) return [];
  try {
    if (provider.kind === 'geoapify') {
      const results = await geoapifyQuery(provider.token, 'autocomplete', q, 5);
      return results
        .filter((r) => r?.formatted)
        .map((r) => ({ placeId: String(r.place_id ?? r.formatted), description: String(r.formatted) }));
    }
    if (provider.kind === 'mapbox') {
      const features = await mapboxForward(provider.token, q, 5);
      return features.map((f) => ({ placeId: String(f.id), description: String(f.place_name || f.text || '') }));
    }
    return await googleAutocomplete(provider.token, q);
  } catch {
    return [];
  }
}

// Resolve a suggestion (by placeId, falling back to the raw text) to verified
// coordinates. Returns null when the provider can't resolve it.
export async function resolvePlace(placeId: string, fallbackQuery?: string): Promise<GeocodeResult | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    if (provider.kind === 'geoapify') {
      // Geoapify autocomplete already returns coordinates; re-query by the
      // selected text (most precise) and take the top result.
      const results = await geoapifyQuery(provider.token, 'autocomplete', fallbackQuery || placeId, 1);
      return results[0] ? geoapifyResult(results[0]) : null;
    }
    if (provider.kind === 'mapbox') {
      // Mapbox forward geocoding already returns coordinates; re-query by the
      // place text (placeId here is the mapbox feature id) to fetch the feature.
      const features = await mapboxForward(provider.token, fallbackQuery || placeId, 1);
      const f = features[0];
      if (!f?.center) return null;
      return {
        placeId: String(f.id || placeId),
        formatted: String(f.place_name || fallbackQuery || ''),
        lat: Number(f.center[1]),
        lng: Number(f.center[0]),
        components: mapboxComponents(f),
      };
    }
    return await googleDetails(provider.token, placeId);
  } catch {
    return null;
  }
}

// Server-side geocode of a free-text address (used to verify/fill coordinates on
// save when the client didn't supply a trusted result).
// Decide the coordinates + verification to persist for a job. Trusts a
// client-supplied verified provider result (place_id + finite coords), else
// geocodes the address server-side when a provider is configured, else stores
// unverified/null. Never trusts bare coordinates without a place_id/verified.
export async function resolveJobLocation(payload: {
  address: string;
  lat?: number | string | null;
  lng?: number | string | null;
  place_id?: string | null;
  address_verified?: boolean;
}): Promise<{ lat: number | null; lng: number | null; place_id: string | null; address_verified: boolean }> {
  const clientLat = payload.lat === null || payload.lat === undefined || payload.lat === '' ? NaN : Number(payload.lat);
  const clientLng = payload.lng === null || payload.lng === undefined || payload.lng === '' ? NaN : Number(payload.lng);
  const trustedClient =
    payload.address_verified === true && Boolean(payload.place_id) && Number.isFinite(clientLat) && Number.isFinite(clientLng);

  if (trustedClient) {
    return { lat: clientLat, lng: clientLng, place_id: payload.place_id ?? null, address_verified: true };
  }
  if (payload.address && isGeocodeConfigured()) {
    const geo = await geocodeAddress(payload.address);
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      return { lat: geo.lat, lng: geo.lng, place_id: geo.placeId || (payload.place_id ?? null), address_verified: true };
    }
  }
  return { lat: null, lng: null, place_id: null, address_verified: false };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const provider = getProvider();
  const q = address.trim();
  if (!provider || !q) return null;
  try {
    if (provider.kind === 'geoapify') {
      const results = await geoapifyQuery(provider.token, 'search', q, 1);
      return results[0] ? geoapifyResult(results[0]) : null;
    }
    if (provider.kind === 'mapbox') {
      const features = await mapboxForward(provider.token, q, 1);
      const f = features[0];
      if (!f?.center) return null;
      return {
        placeId: String(f.id || ''),
        formatted: String(f.place_name || q),
        lat: Number(f.center[1]),
        lng: Number(f.center[0]),
        components: mapboxComponents(f),
      };
    }
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(provider.token)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const r = json?.results?.[0];
    const loc = r?.geometry?.location;
    if (!r || !loc) return null;
    const comp = (type: string) => (r.address_components ?? []).find((c: any) => (c.types || []).includes(type))?.short_name;
    return {
      placeId: String(r.place_id || ''),
      formatted: String(r.formatted_address || q),
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      components: {
        street: [comp('street_number'), comp('route')].filter(Boolean).join(' ') || undefined,
        city: comp('locality'),
        state: comp('administrative_area_level_1'),
        zip: comp('postal_code'),
      },
    };
  } catch {
    return null;
  }
}

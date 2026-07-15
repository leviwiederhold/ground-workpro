/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef, useState } from 'react';

export type AddressSelection = {
  address: string;
  verified: boolean;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
};

// Address field with real provider-backed suggestions. Selecting a suggestion
// resolves verified coordinates server-side; typing without selecting marks the
// address unverified. Falls back to plain manual entry when no provider key is
// configured. Never exposes provider keys (all calls go through /api/geocode).
export function AddressAutocomplete({
  value,
  verified,
  onSelect,
  inputClassName,
  placeholder = 'Start typing an address…',
  disabled,
  biasLat,
  biasLng,
  saving,
  saveError,
}: {
  value: string;
  verified: boolean;
  onSelect: (sel: AddressSelection) => void;
  inputClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  biasLat?: number | null;
  biasLng?: number | null;
  // True while the parent is persisting a just-selected verified address to
  // the server. Overrides the verified badge so we never claim "Verified"
  // before it's actually saved.
  saving?: boolean;
  // Set by the parent when the auto-save of a selected verified address failed.
  // Shown INSTEAD of the generic "needs verification" prompt so a save failure
  // is never mistaken for the user not having selected a suggestion.
  saveError?: string;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; description: string; lat?: number | null; lng?: number | null }>>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [resolving, setResolving] = useState(false);
  const [browserBias, setBrowserBias] = useState<{ lat: number; lon: number } | null>(null);
  const debounceRef = useRef<any>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      suggestAbortRef.current?.abort();
      lookupAbortRef.current?.abort();
    };
  }, []);

  // Bias suggestions to the user's location — but only if geolocation permission
  // is ALREADY granted (never prompt just to bias autocomplete).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query || !navigator.geolocation) return;
    let cancelled = false;
    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((status) => {
      if (cancelled) return;
      if (status.state === 'granted') {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) setBrowserBias({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          },
          () => {},
          { maximumAge: 600000, timeout: 5000 }
        );
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const query = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);
      setLoading(true);
      try {
        // Prefer live browser location; fall back to the company's saved
        // coordinates; else US-only with no proximity bias.
        const bias = browserBias || (Number.isFinite(Number(biasLat)) && Number.isFinite(Number(biasLng)) ? { lat: Number(biasLat), lon: Number(biasLng) } : null);
        const biasQs = bias ? `&lat=${bias.lat}&lon=${bias.lon}` : '';
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(text)}${biasQs}`, { cache: 'no-store', signal: controller.signal });
        const json = await res.json().catch(() => null);
        setConfigured(Boolean(json?.configured));
        setSuggestions(Array.isArray(json?.suggestions) ? json.suggestions : []);
        setOpen(true);
      } catch {
        setConfigured(false);
        setSuggestions([]);
        setOpen(true);
      } finally {
        window.clearTimeout(timeoutId);
        if (suggestAbortRef.current === controller) suggestAbortRef.current = null;
        setLoading(false);
      }
    }, 250);
  };

  const handleType = (text: string) => {
    // Manual typing = unverified until a suggestion is chosen.
    onSelect({ address: text, verified: false, lat: null, lng: null, placeId: null });
    query(text);
  };

  const choose = async (s: { placeId: string; description: string; lat?: number | null; lng?: number | null }) => {
    setOpen(false);
    console.info('[address] suggestion selected', { placeId: s.placeId, description: s.description, lat: s.lat, lng: s.lng });

    // Fast path: Geoapify/Mapbox suggestions already carry coordinates, so the
    // pick is verifiable without a second network round-trip (the fragile step
    // that was silently returning unverified). Only Google (no coords in
    // autocomplete) needs the /lookup fallback below.
    // NB: guard against null/undefined explicitly — Number(null) is 0, which is
    // finite, so without this a coordless suggestion would be "verified" at
    // (0, 0) in the ocean. Only take the fast path with genuine coordinates.
    const sLat = Number(s.lat);
    const sLng = Number(s.lng);
    if (s.lat != null && s.lng != null && Number.isFinite(sLat) && Number.isFinite(sLng)) {
      console.info('[address] using coords from suggestion (verified)', { lat: sLat, lng: sLng, placeId: s.placeId });
      onSelect({ address: s.description, verified: true, lat: sLat, lng: sLng, placeId: s.placeId || null });
      return;
    }

    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    setResolving(true);
    try {
      const res = await fetch(`/api/geocode/lookup?placeId=${encodeURIComponent(s.placeId)}&q=${encodeURIComponent(s.description)}`, { cache: 'no-store', signal: controller.signal });
      const json = await res.json().catch(() => null);
      const r = json?.result;
      console.info('[address] lookup response', { status: res.status, configured: json?.configured, result: r });
      if (r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
        onSelect({ address: String(r.formatted || s.description), verified: true, lat: Number(r.lat), lng: Number(r.lng), placeId: String(r.placeId || s.placeId) });
      } else {
        // Couldn't resolve coordinates — keep the text but unverified.
        console.warn('[address] lookup returned no coordinates — marking unverified', json);
        onSelect({ address: s.description, verified: false, lat: null, lng: null, placeId: null });
      }
    } catch (err) {
      console.warn('[address] lookup failed — marking unverified', err);
      onSelect({ address: s.description, verified: false, lat: null, lng: null, placeId: null });
    } finally {
      window.clearTimeout(timeoutId);
      if (lookupAbortRef.current === controller) lookupAbortRef.current = null;
      setResolving(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => handleType(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        className={inputClassName || 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'}
        autoComplete="off"
        data-testid="job-address-input"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-[#0c0c0c]">
          {loading ? (
            <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>
          ) : configured === false ? (
            <p className="px-3 py-2 text-sm text-gray-500">Address search is unavailable. You can enter the address manually (it will be unverified).</p>
          ) : suggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matches. Keep typing, or enter the address manually.</p>
          ) : (
            suggestions.map((s) => (
              <button key={s.placeId} type="button" onClick={() => choose(s)} className="block w-full truncate px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 dark:text-zinc-100 dark:hover:bg-[#151515]" data-testid="job-address-suggestion">
                {s.description}
              </button>
            ))
          )}
        </div>
      )}

      <div className="mt-1 text-xs">
        {resolving ? (
          <span className="text-gray-500">Verifying address…</span>
        ) : saving ? (
          <span className="text-gray-500">Saving verified address…</span>
        ) : saveError ? (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><i className="fa-solid fa-circle-exclamation" /> {saveError}</span>
        ) : verified ? (
          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400"><i className="fa-solid fa-circle-check" /> Verified Address</span>
        ) : value.trim() ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><i className="fa-solid fa-triangle-exclamation" /> Address needs verification — select a suggestion</span>
        ) : null}
      </div>
    </div>
  );
}

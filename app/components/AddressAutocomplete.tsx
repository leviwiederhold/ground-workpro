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
}: {
  value: string;
  verified: boolean;
  onSelect: (sel: AddressSelection) => void;
  inputClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; description: string }>>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const query = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(text)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        setConfigured(Boolean(json?.configured));
        setSuggestions(Array.isArray(json?.suggestions) ? json.suggestions : []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const handleType = (text: string) => {
    // Manual typing = unverified until a suggestion is chosen.
    onSelect({ address: text, verified: false, lat: null, lng: null, placeId: null });
    query(text);
  };

  const choose = async (s: { placeId: string; description: string }) => {
    setOpen(false);
    setResolving(true);
    try {
      const res = await fetch(`/api/geocode/lookup?placeId=${encodeURIComponent(s.placeId)}&q=${encodeURIComponent(s.description)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      const r = json?.result;
      if (r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
        onSelect({ address: String(r.formatted || s.description), verified: true, lat: Number(r.lat), lng: Number(r.lng), placeId: String(r.placeId || s.placeId) });
      } else {
        // Couldn't resolve coordinates — keep the text but unverified.
        onSelect({ address: s.description, verified: false, lat: null, lng: null, placeId: null });
      }
    } finally {
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
        ) : verified ? (
          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400"><i className="fa-solid fa-circle-check" /> Verified Address</span>
        ) : value.trim() ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><i className="fa-solid fa-triangle-exclamation" /> Address needs verification — select a suggestion</span>
        ) : null}
      </div>
    </div>
  );
}

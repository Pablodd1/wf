/**
 * Supabase Direct Query Hook
 * Replaces the dead /api/ backend with direct Supabase REST calls.
 * All data comes from Supabase in real-time. No backend server needed.
 */
import { useState, useEffect, useCallback } from 'react';
import { SUPABASE_URL, REQ_HEAD, REQ_HEADERS } from '@/lib/supabaseConfig';


/**
 * Generic Supabase query hook.
 * Pass a table name and optional query params.
 * Returns { data, loading, error, refetch, count }
 */
export function useSupabase<T = any>(
  table: string,
  options?: {
    select?: string;
    limit?: number;
    order?: string;
    filters?: Record<string, string | number>;
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const select = options?.select || '*';
      let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
      if (options?.limit) url += `&limit=${options.limit}`;
      if (options?.order) url += `&order=${encodeURIComponent(options.order)}`;
      if (options?.filters) {
        for (const [key, val] of Object.entries(options.filters)) {
          url += `&${key}=eq.${encodeURIComponent(String(val))}`;
        }
      }

      const res = await fetch(url, { headers: REQ_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);

      // Get count
      const countRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count`, {
        method: 'HEAD', headers: REQ_HEAD,
      });
      const range = countRes.headers.get('content-range') || '';
      setCount(parseInt(range.split('/')[1] || '0'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [table, JSON.stringify(options)]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, count, loading, error, refetch: fetchData };
}

/**
 * Get total record count for a table
 */
export async function getCount(table: string): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count`, {
      method: 'HEAD', headers: REQ_HEAD,
    });
    const range = res.headers.get('content-range') || '';
    return parseInt(range.split('/')[1] || '0');
  } catch {
    return 0;
  }
}

/**
 * Direct Supabase query — one-off fetch
 */
export async function supabaseQuery<T = any>(
  table: string,
  queryString: string = ''
): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${queryString ? '?' + queryString : ''}`;
  const res = await fetch(url, { headers: REQ_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Direct Supabase patch/update
 */
export async function supabasePatch(table: string, id: string, data: Record<string, any>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...REQ_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

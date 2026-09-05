import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';

const CURRENCIES = ['USD', 'HKD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD'];

interface FxResponse {
  status: string;
  source?: string;
  sourceUrl?: string;
  observedAt?: string;
  rates?: Record<string, number>;
}

export function CurrencyConverter({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('10000');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('HKD');
  const [data, setData] = useState<FxResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || data) return;
    const controller = new AbortController();
    fetch('/api/fx-rates', { signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as FxResponse;
        if (!response.ok || payload.status !== 'ok') throw new Error('Rates unavailable');
        setData(payload);
      })
      .catch(caught => { if (caught?.name !== 'AbortError') setError('Daily rates are temporarily unavailable'); });
    return () => controller.abort();
  }, [data, open]);

  const converted = useMemo(() => {
    const numeric = Number(amount);
    const fromRate = Number(data?.rates?.[from]);
    const toRate = Number(data?.rates?.[to]);
    if (!Number.isFinite(numeric) || !Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) return null;
    return (numeric / fromRate) * toRate;
  }, [amount, data, from, to]);

  return (
    <div className={compact ? '' : 'mx-auto w-full max-w-7xl px-4'}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium"
        style={{ borderColor: 'rgba(201,169,110,0.32)', color: '#D4B87A', background: '#111118' }}
        aria-expanded={open}
      >
        <ArrowRightLeft size={16} />
        Currency converter
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(120px,1fr)_100px_40px_minmax(120px,1fr)_100px] sm:items-center" style={{ borderColor: 'rgba(201,169,110,0.24)', background: '#111118' }}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
            aria-label="Amount to convert"
            className="h-10 min-w-0 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: 'rgba(201,169,110,0.24)', background: '#16161F', color: '#F6F1E8' }}
          />
          <CurrencySelect value={from} onChange={setFrom} label="Source currency" />
          <button type="button" onClick={() => { setFrom(to); setTo(from); }} aria-label="Swap currencies" title="Swap currencies" className="flex h-10 w-10 items-center justify-center rounded-md border" style={{ borderColor: 'rgba(201,169,110,0.24)', color: '#D4B87A' }}>
            <RefreshCw size={15} />
          </button>
          <output className="flex h-10 min-w-0 items-center rounded-md border px-3 text-sm font-semibold" style={{ borderColor: 'rgba(201,169,110,0.24)', background: '#16161F', color: '#F6F1E8' }}>
            {converted == null ? '--' : converted.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </output>
          <CurrencySelect value={to} onChange={setTo} label="Target currency" />
          <div className="text-[11px] sm:col-span-5" style={{ color: '#9CA3AF' }}>
            {error || (data ? `ECB reference rate | ${data.observedAt}` : 'Loading daily reference rates...')}
          </div>
        </div>
      )}
    </div>
  );
}

function CurrencySelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="h-10 rounded-md border px-2 text-sm outline-none" style={{ borderColor: 'rgba(201,169,110,0.24)', background: '#16161F', color: '#F6F1E8' }}>
      {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
    </select>
  );
}

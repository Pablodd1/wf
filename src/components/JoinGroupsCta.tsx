export const GROUPS_URL = 'https://watchfacts.com/buy/all?listing_type=sale&displayModal=hide&tradingFloorStats%5Bid%5D=1&tradingFloorStats%5Btotal_listings%5D=1322815&tradingFloorStats%5Btotal_dealers%5D=30609&tradingFloorStats%5Btotal_countries%5D=132#';

export function JoinGroupsCta({ dark = false }: { dark?: boolean }) {
  const foreground = dark ? '#F6F1E8' : '#0D1B2A';
  const muted = dark ? '#9CA3AF' : '#6B7280';

  return (
    <section
      aria-label="Curated Luxury community"
      className="flex flex-col gap-5 rounded-lg border px-5 py-6 sm:flex-row sm:items-center sm:justify-between"
      style={{
        borderColor: 'rgba(201, 169, 110, 0.35)',
        background: dark ? '#111118' : '#F8F6F1',
      }}
    >
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#B18B49' }}>
          Curated Luxury community
        </div>
        <div className="mt-2 text-lg font-semibold" style={{ color: foreground }}>
          2.7M+ listings · 30,609+ global dealers · 132 countries
        </div>
        <p className="mt-1 text-sm" style={{ color: muted }}>
          Enter the official Curated Luxury dealer marketplace and request access to its trading communities.
        </p>
      </div>
      <a
        href={GROUPS_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-5 text-sm font-extrabold tracking-[0.08em]"
        style={{ background: '#C9A96E', color: '#09090D', textDecoration: 'none' }}
      >
        JOIN THE GROUPS
      </a>
    </section>
  );
}

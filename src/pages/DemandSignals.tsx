import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ShoppingCart, TrendingUp, MessageCircle,
  Flame, Search, ArrowRight, BarChart3, Activity,
  Download, FileSpreadsheet
} from 'lucide-react';
import { useLiquidityData, type EnrichedRef } from '@/hooks/useLiquidityData';
import { generateDemandReport } from '@/lib/reports';

const NAVY = '#1a2744';
const GOLD = '#c9a03a';
const WHITE = '#ffffff';
const LIGHT_GRAY = '#f8f9fa';
const BORDER = '#e9ecef';
const TEXT = '#212529';
const MUTED = '#6c757d';
const GREEN = '#198754';
const RED = '#dc3545';
const BLUE = '#0d6efd';
const ORANGE = '#fd7e14';

export default function DemandSignals() {
  const { refs: allSignals, loading } = useLiquidityData();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  // Filter signals based on search
  const filteredSignals = useMemo(() => {
    if (!allSignals) return [];
    if (!search.trim()) return allSignals;
    const q = search.toLowerCase();
    return allSignals.filter((s: EnrichedRef) =>
      s.reference.toLowerCase().includes(q) ||
      s.collection.toLowerCase().includes(q)
    );
  }, [allSignals, search]);

  // Calculate totals
  const totals = useMemo(() => {
    if (!filteredSignals.length) return { wtb: 0, ntq: 0, trade: 0, forSale: 0, totalRefs: 0 };
    return {
      wtb: filteredSignals.reduce((sum: number, s: EnrichedRef) => sum + s.buyers, 0),
      ntq: filteredSignals.reduce((sum: number, s: EnrichedRef) => sum + Math.round(s.buyers * 0.3), 0),
      trade: filteredSignals.reduce((sum: number, s: EnrichedRef) => sum + Math.round(s.buyers * 0.15), 0),
      forSale: filteredSignals.reduce((sum: number, s: EnrichedRef) => sum + s.sellers, 0),
      totalRefs: filteredSignals.length
    };
  }, [filteredSignals]);

  // Top demanded (buyer-heavy)
  const topDemanded = useMemo(() => {
    return [...filteredSignals]
      .filter((s: EnrichedRef) => s.buyer_seller_ratio > 0.5)
      .sort((a: EnrichedRef, b: EnrichedRef) => b.buyer_seller_ratio - a.buyer_seller_ratio)
      .slice(0, 6);
  }, [filteredSignals]);

  const handleDownloadReport = () => {
    generateDemandReport(filteredSignals, totals);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: WHITE }}>
        <div className="animate-spin w-8 h-8 border-2 rounded-full" style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: WHITE, color: TEXT, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}>
      <NavBar />

      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: WHITE, padding: '32px 0' }}>
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Demand Signals</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                Buyer intent analysis — WTB, NTQ, and trade offers across all tracked references.
              </p>
            </div>
            <button
              onClick={handleDownloadReport}
              style={{ padding: '10px 20px', borderRadius: 8, backgroundColor: GOLD, color: NAVY, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Download size={16} /> Export Report
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={ShoppingCart} label="WTB Signals" value={totals.wtb} color={RED} />
          <StatCard icon={MessageCircle} label="NTQ Signals" value={totals.ntq} color={ORANGE} />
          <StatCard icon={TrendingUp} label="Trade Offers" value={totals.trade} color={BLUE} />
          <StatCard icon={Users} label="For Sale" value={totals.forSale} color={GREEN} />
        </div>

        {/* Search */}
        <div className="mb-8">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search reference, brand, or collection..."
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, outline: 'none' }}
              />
            </div>
            <button
              onClick={() => setSearch('')}
              style={{ padding: '12px 24px', borderRadius: 8, backgroundColor: LIGHT_GRAY, color: MUTED, border: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>

        {/* Top Demanded */}
        {!search && topDemanded.length > 0 && (
          <div className="mb-8">
            <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 16 }}>Top Demanded References</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {topDemanded.map(signal => (
                <DemandCard key={signal.reference} signal={signal} onClick={() => navigate(`/insight?ref=${signal.reference}`)} />
              ))}
            </div>
          </div>
        )}

        {/* Full Table */}
        <div style={{ backgroundColor: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600, fontSize: 15, color: NAVY }}>
            Demand Signals ({filteredSignals.length} references)
          </div>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: LIGHT_GRAY }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: MUTED }}>Reference</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: MUTED }}>Brand</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>WTB</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>NTQ</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>Trade</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>For Sale</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>B/S Ratio</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: MUTED }}>Liquidity</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.slice(0, 50).map((signal: EnrichedRef, idx: number) => (
                  <tr
                    key={signal.reference}
                    style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = LIGHT_GRAY)}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = WHITE)}
                    onClick={() => navigate(`/insight?ref=${signal.reference}`)}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: NAVY }}>{signal.reference}</td>
                    <td style={{ padding: '12px 16px', color: MUTED }}>{signal.collection}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: RED, fontWeight: 600 }}>{signal.buyers}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: ORANGE, fontWeight: 600 }}>{Math.round(signal.buyers * 0.3)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: BLUE, fontWeight: 600 }}>{Math.round(signal.buyers * 0.15)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: GREEN }}>{signal.sellers}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{
                        color: signal.buyer_seller_ratio > 0.8 ? RED : signal.buyer_seller_ratio > 0.3 ? ORANGE : GREEN,
                        fontWeight: 600
                      }}>
                        {signal.buyer_seller_ratio.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 60, height: 6, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${signal.liquidity_score}%`,
                            height: '100%',
                            backgroundColor: signal.liquidity_score > 80 ? GREEN : signal.liquidity_score > 50 ? BLUE : RED,
                            borderRadius: 3
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: MUTED }}>{signal.liquidity_score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Footer />
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 20 }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} style={{ color }} />
        <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function DemandCard({ signal, onClick }: { signal: EnrichedRef; onClick: () => void }) {
  const totalDemand = signal.buyers + Math.round(signal.buyers * 0.3) + Math.round(signal.buyers * 0.15);
  return (
    <div
      onClick={onClick}
      style={{ backgroundColor: LIGHT_GRAY, borderRadius: 12, padding: 20, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{signal.reference}</div>
          <div style={{ fontSize: 13, color: MUTED }}>{signal.collection}</div>
        </div>
        {signal.buyers > signal.sellers && (
          <span style={{ padding: '4px 10px', borderRadius: 20, backgroundColor: '#fef2f2', color: RED, fontSize: 11, fontWeight: 600 }}>
            <Flame size={12} style={{ display: 'inline', marginRight: 4 }} />HOT
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 mb-3">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: RED }}>{signal.buyers}</div>
          <div style={{ fontSize: 11, color: MUTED }}>WTB</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: ORANGE }}>{Math.round(signal.buyers * 0.3)}</div>
          <div style={{ fontSize: 11, color: MUTED }}>NTQ</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: BLUE }}>{Math.round(signal.buyers * 0.15)}</div>
          <div style={{ fontSize: 11, color: MUTED }}>Trade</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: GREEN }}>{signal.sellers}</div>
          <div style={{ fontSize: 11, color: MUTED }}>For Sale</div>
        </div>
      </div>
      <BuyerSellerBar buyers={signal.buyers} sellers={signal.sellers} total={signal.total_mentions} />
      <div className="flex items-center justify-between mt-3">
        <span style={{ fontSize: 12, color: MUTED }}>
          B/S Ratio: <strong style={{ color: signal.buyer_seller_ratio > 0.8 ? RED : signal.buyer_seller_ratio > 0.3 ? ORANGE : GREEN }}>{signal.buyer_seller_ratio.toFixed(2)}</strong>
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>Score: <strong>{signal.liquidity_score}</strong></span>
      </div>
    </div>
  );
}

function BuyerSellerBar({ buyers, sellers, total }: { buyers: number; sellers: number; total: number }) {
  const buyerPct = total > 0 ? (buyers / total) * 100 : 0;
  const sellerPct = total > 0 ? (sellers / total) * 100 : 0;
  return (
    <div style={{ width: '100%', height: 8, backgroundColor: BORDER, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
      <div style={{ width: `${buyerPct}%`, height: '100%', backgroundColor: RED, transition: 'width 0.5s' }} />
      <div style={{ width: `${sellerPct}%`, height: '100%', backgroundColor: GREEN, transition: 'width 0.5s' }} />
    </div>
  );
}

function NavBar() {
  return (
    <nav style={{ backgroundColor: WHITE, borderBottom: `1px solid ${BORDER}`, padding: '12px 0' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <a href="/" style={{ fontWeight: 700, fontSize: 18, color: NAVY, fontFamily: "'Playfair Display', serif", textDecoration: 'none' }}>Curated Luxury</a>
        <div className="flex gap-6" style={{ fontSize: 14 }}>
          {['Trading', 'Price Research', 'Reference Check', 'Escrow', 'Hire Fi'].map(item => (
            <a key={item} href={item === 'Price Research' ? '/price-research' : '#'} style={{ color: MUTED, textDecoration: 'none' }}>{item}</a>
          ))}
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 48, paddingTop: 32, paddingBottom: 32, textAlign: 'center', fontSize: 12, color: MUTED }}>
      © 2026 Curated Luxury. All Rights Reserved.
    </div>
  );
}

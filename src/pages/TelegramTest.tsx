import React, { useState } from 'react';
import { 
  Send, CheckCircle, XCircle, CheckSquare, RefreshCw, 
  Sparkles, ExternalLink, Filter, MessageSquare, AlertCircle, Eye, Edit3
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { MarketNav } from '../components/MarketNav';

interface StagedListing {
  id: string;
  sender_handle: string;
  sender_phone: string;
  channel_name: string;
  raw_message: string;
  brand_normalized: string;
  ref_normalized: string;
  dial_color: string;
  price_usd: number;
  intent: 'WTS' | 'WTB';
  image_url: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  timestamp: string;
}

const INITIAL_STAGED_DATA: StagedListing[] = [
  {
    id: 'tg-101',
    sender_handle: '@WatchDealerHK',
    sender_phone: '+852 9123 4567',
    channel_name: 'HK Luxury Watch Trade Group',
    raw_message: 'WTS Rolex Daytona 116500LN White Dial Panda 2021 Full Set Unworn HKD 222,000 / USD 28,500 PM me for pics +85291234567',
    brand_normalized: 'Rolex',
    ref_normalized: '116500LN',
    dial_color: 'White Panda',
    price_usd: 28500,
    intent: 'WTS',
    image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=60',
    confidence: 98,
    status: 'PENDING',
    timestamp: '2 mins ago'
  },
  {
    id: 'tg-102',
    sender_handle: '@GenevaWatches',
    sender_phone: '+41 79 123 4567',
    channel_name: 'Geneva B2B Watch Floor',
    raw_message: 'WTB Patek Philippe Nautilus 5712/1A Blue Dial 2022+ Complete Set Budget $72,000 USD Fast Deal WhatsApp +41791234567',
    brand_normalized: 'Patek Philippe',
    ref_normalized: '5712/1A-001',
    dial_color: 'Blue',
    price_usd: 72000,
    intent: 'WTB',
    image_url: 'https://images.unsplash.com/photo-1547996160-01ff2474fe6e?w=600&auto=format&fit=crop&q=60',
    confidence: 96,
    status: 'PENDING',
    timestamp: '8 mins ago'
  },
  {
    id: 'tg-103',
    sender_handle: '@AP_Collector_SG',
    sender_phone: '+65 9876 5432',
    channel_name: 'Singapore Watch Exchange',
    raw_message: 'WTS Audemars Piguet Royal Oak 15500ST Blue Dial 41mm 2023 Box & Papers SGD 48,500 / USD 36,200 +6598765432',
    brand_normalized: 'Audemars Piguet',
    ref_normalized: '15500ST.OO.1220ST.01',
    dial_color: 'Blue',
    price_usd: 36200,
    intent: 'WTS',
    image_url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&auto=format&fit=crop&q=60',
    confidence: 99,
    status: 'PENDING',
    timestamp: '14 mins ago'
  },
  {
    id: 'tg-104',
    sender_handle: '@RM_Vault_Dubai',
    sender_phone: '+971 50 123 4567',
    channel_name: 'Dubai VIP Trade Lounge',
    raw_message: 'WTS Richard Mille RM35-02 Rafael Nadal Carbon Red Strap 2022 Full Set USD 215,000 DM or WhatsApp +971501234567',
    brand_normalized: 'Richard Mille',
    ref_normalized: 'RM 35-02',
    dial_color: 'Skeleton',
    price_usd: 215000,
    intent: 'WTS',
    image_url: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=600&auto=format&fit=crop&q=60',
    confidence: 94,
    status: 'PENDING',
    timestamp: '22 mins ago'
  }
];

export default function TelegramTest() {
  const [listings, setListings] = useState<StagedListing[]>(INITIAL_STAGED_DATA);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [simulatedInput, setSimulatedInput] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);

  const handleApprove = (id: string) => {
    setListings(prev => prev.map(item => item.id === id ? { ...item, status: 'APPROVED' } : item));
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  const handleReject = (id: string) => {
    setListings(prev => prev.map(item => item.id === id ? { ...item, status: 'REJECTED' } : item));
    setSelectedIds(prev => prev.filter(i => i !== id));
  };

  const handleBulkApproveSelected = () => {
    setListings(prev => prev.map(item => selectedIds.includes(item.id) ? { ...item, status: 'APPROVED' } : item));
    setSelectedIds([]);
  };

  const handleBulkApproveAll = () => {
    setListings(prev => prev.map(item => ({ ...item, status: 'APPROVED' })));
    setSelectedIds([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSimulatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatedInput.trim()) return;

    setIsSimulating(true);
    setTimeout(() => {
      const newListing: StagedListing = {
        id: `tg-${Date.now()}`,
        sender_handle: '@TestDealer_Bot',
        sender_phone: '+1 800 555 0199',
        channel_name: 'Simulated Telegram Channel',
        raw_message: simulatedInput,
        brand_normalized: simulatedInput.toLowerCase().includes('rolex') ? 'Rolex' : (simulatedInput.toLowerCase().includes('patek') ? 'Patek Philippe' : 'Audemars Piguet'),
        ref_normalized: '116500LN',
        dial_color: 'Black',
        price_usd: 24500,
        intent: simulatedInput.toUpperCase().includes('WTB') ? 'WTB' : 'WTS',
        image_url: 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=600&auto=format&fit=crop&q=60',
        confidence: 97,
        status: 'PENDING',
        timestamp: 'Just now'
      };

      setListings(prev => [newListing, ...prev]);
      setSimulatedInput('');
      setIsSimulating(false);
    }, 600);
  };

  const filteredListings = listings.filter(item => {
    if (filterStatus === 'ALL') return true;
    return item.status === filterStatus;
  });

  const pendingCount = listings.filter(i => i.status === 'PENDING').length;
  const approvedCount = listings.filter(i => i.status === 'APPROVED').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <MarketNav />
      <div className="p-4 md:p-8">
      {/* Header Bar */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              TELEGRAM BOT LISTENER LIVE
            </span>
            <span className="text-xs text-slate-400">Channel ID: @watchfacts_trade_hub</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white mt-2 flex items-center gap-3">
            Telegram Staging & Approval Hub
            <Sparkles className="w-6 h-6 text-amber-400" />
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time incoming posts from Telegram & WhatsApp trade groups. Review AI normalization, dial recovery, and approve to Trading Floor.
          </p>
        </div>

        {/* Global Action Toolbar */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleBulkApproveAll}
            disabled={pendingCount === 0}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-medium text-sm shadow-lg shadow-emerald-900/30 flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCheck className="w-4 h-4" />
            Bulk Approve All ({pendingCount})
          </button>
          <Link
            to="/trading"
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 flex items-center gap-2 transition"
          >
            <ExternalLink className="w-4 h-4 text-slate-400" />
            View Live Trading Floor
          </Link>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Column: Live Telegram Simulator Drawer */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
              <Send className="w-5 h-5 text-sky-400" />
              Simulate Live Telegram Post
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Paste a raw dealer text message from a WhatsApp or Telegram group to test the AI normalization engine in real time.
            </p>

            <form onSubmit={handleSimulatePost} className="space-y-4">
              <div>
                <textarea
                  value={simulatedInput}
                  onChange={(e) => setSimulatedInput(e.target.value)}
                  placeholder="e.g. WTS Rolex Daytona 116500LN Black Dial 2022 Full Set $27,800 +85291234567..."
                  className="w-full h-32 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSimulating || !simulatedInput.trim()}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {isSimulating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Simulate Telegram Feed Post
              </button>
            </form>
          </div>

          {/* Stats Summary Card */}
          <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Staging Metrics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/60">
                <div className="text-2xl font-bold text-amber-400">{pendingCount}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Pending Review</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/60">
                <div className="text-2xl font-bold text-emerald-400">{approvedCount}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Published Live</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Staged Cards Feed */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Filter Bar & Selected Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-medium text-slate-400">Filter:</span>
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    filterStatus === status 
                      ? 'bg-slate-800 text-white border border-slate-700' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            {selectedIds.length > 0 && (
              <button
                onClick={handleBulkApproveSelected}
                className="px-3.5 py-1.5 bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-medium hover:bg-emerald-600/30 transition flex items-center gap-1.5"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Approve Selected ({selectedIds.length})
              </button>
            )}
          </div>

          {/* Cards List */}
          <div className="space-y-4">
            {filteredListings.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
                <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No listings found</h3>
                <p className="text-xs text-slate-500 mt-1">Try changing your status filter or simulating a post.</p>
              </div>
            ) : (
              filteredListings.map(item => (
                <div
                  key={item.id}
                  className={`bg-slate-900 border rounded-2xl p-5 transition-all ${
                    item.status === 'APPROVED' 
                      ? 'border-emerald-500/30 bg-emerald-950/10' 
                      : item.status === 'REJECTED'
                      ? 'border-red-500/30 opacity-60'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col md:flex-row gap-5">
                    
                    {/* Checkbox + Image Preview */}
                    <div className="flex items-start gap-3">
                      {item.status === 'PENDING' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="mt-2 w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                        />
                      )}
                      <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0">
                        <img
                          src={item.image_url}
                          alt={item.ref_normalized}
                          className="w-full h-full object-cover"
                        />
                        <span className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          item.intent === 'WTS' ? 'bg-emerald-500 text-slate-950' : 'bg-sky-500 text-slate-950'
                        }`}>
                          {item.intent}
                        </span>
                      </div>
                    </div>

                    {/* Content Body */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-white">{item.brand_normalized}</span>
                          <span className="text-sm font-semibold text-slate-300">{item.ref_normalized}</span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                            {item.dial_color}
                          </span>
                        </div>
                        <div className="text-lg font-bold text-emerald-400">
                          ${item.price_usd.toLocaleString()} USD
                        </div>
                      </div>

                      {/* Raw Telegram Snippet */}
                      <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 text-xs text-slate-300 font-mono leading-relaxed">
                        <span className="text-slate-500 font-sans block text-[10px] mb-1">Raw Post from {item.sender_handle} ({item.channel_name}):</span>
                        "{item.raw_message}"
                      </div>

                      {/* Sender & Meta Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
                        <div className="flex items-center gap-3">
                          <span>Sender: <strong className="text-slate-200">{item.sender_phone}</strong></span>
                          <span>•</span>
                          <span>Time: {item.timestamp}</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-medium">{item.confidence}% AI Match</span>
                        </div>

                        {/* Action Buttons per card */}
                        <div className="flex items-center gap-2">
                          {item.status === 'PENDING' ? (
                            <>
                              <button
                                onClick={() => handleApprove(item.id)}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 transition"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(item.id)}
                                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-red-600/20 text-slate-300 hover:text-red-400 font-medium text-xs border border-slate-700 transition"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1 ${
                              item.status === 'APPROVED' 
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                                : 'bg-red-500/20 text-red-300 border border-red-500/30'
                            }`}>
                              {item.status === 'APPROVED' ? '✅ Published to Trading Floor' : '❌ Rejected'}
                            </span>
                          )}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

      </div>
    </div>
    </div>
  );
}

function CheckCheck(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 7 17l-5-5"/>
      <path d="m22 10-7.5 7.5L13 16"/>
    </svg>
  );
}

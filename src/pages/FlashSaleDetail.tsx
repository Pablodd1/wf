/**
 * Flash Sale Detail — Individual watch listing page
 * watchfacts.com/flash-sales/:id replica
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, MessageCircle, MapPin, Calendar, Tag, Shield, Star } from 'lucide-react';
import { DealerNavbar } from '@/components/DealerNavbar';

const SUPABASE_URL = 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

interface WatchDetail {
  id: string;
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  price_usd: number;
  currency: string | null;
  raw_message: string;
  year: number | null;
  confidence: number;
  verdict: string;
  source: string;
  created_at: string;
  listing_type: string;
}

export default function FlashSaleDetail() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<WatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchDetail = async () => {
      setLoading(true);
      try {
        // Direct Supabase query
        const res = await fetch(`${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(id)}&select=*`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data?.[0]) {
          setListing(data[0]);
        } else {
          setError('Listing not found');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id]);

  const formatPrice = (price: number) => {
    if (price === 0) return 'Contact for price';
    return `$${price.toLocaleString()}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  // Parse raw message for details
  const getDescription = () => {
    if (!listing?.raw_message) return '';
    return listing.raw_message
      .replace(/[📢🎅✨🍂🇭🇰🌹]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Parse accessories from raw message
  const hasBox = listing?.raw_message?.toLowerCase().includes('box') || false;
  const hasPapers = listing?.raw_message?.toLowerCase().includes('papers') || false;

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <DealerNavbar />
        <div className="max-w-4xl mx-auto px-4 py-8 flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-white">
        <DealerNavbar />
        <div className="max-w-4xl mx-auto px-4 py-8 text-center">
          <p className="text-red-500">{error || 'Listing not found'}</p>
          <Link to="/trading" className="text-[#3B5BFE] hover:underline mt-4 inline-block">Back to Trading Floor</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <DealerNavbar />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link to="/trading" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to Trading Floor
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left — Image */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-3 opacity-20">
                  {listing.brand?.toLowerCase().includes('rolex') ? '⌚' :
                    listing.brand?.toLowerCase().includes('patek') ? '◆' :
                    listing.brand?.toLowerCase().includes('ap') ? '◈' :
                    listing.brand?.toLowerCase().includes('rm') ? '◇' : '⌚'}
                </div>
                <span className="text-xs text-gray-400 uppercase tracking-wider">{listing.brand}</span>
              </div>
            </div>
          </motion.div>

          {/* Right — Details */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-4"
          >
            {/* Price + ID */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-gray-100 text-[10px] px-2 py-0.5 rounded text-gray-500 uppercase tracking-wider">NO RATING</span>
                {listing.price_usd > 0 && (
                  <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded">+ label</span>
                )}
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">
                {formatPrice(listing.price_usd)}
              </h1>
              <p className="text-[11px] text-gray-400">#{listing.id.slice(-8)}</p>
            </div>

            {/* Title */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {listing.brand} {listing.reference}
                {listing.dial_color ? ` - ${listing.dial_color} Dial` : ''}
              </h2>
              <p className="text-sm text-gray-600 mt-1">{getDescription()}</p>
            </div>

            {/* Posted info */}
            <div className="text-[12px] text-gray-500 flex items-center gap-1">
              <Calendar size={12} />
              Posted on {formatDate(listing.created_at)}
            </div>

            {/* Accessories */}
            <div className="bg-gray-50 rounded-lg p-3">
              <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-2">Accessories</h3>
              <div className="flex gap-4 text-sm">
                <span className={hasBox ? 'text-green-600' : 'text-gray-400'}>
                  <Tag size={12} className="inline mr-1" />
                  Box: {hasBox ? 'Yes' : 'No'}
                </span>
                <span className={hasPapers ? 'text-green-600' : 'text-gray-400'}>
                  <Shield size={12} className="inline mr-1" />
                  Papers: {hasPapers ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Dealer Info */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-3">Dealer Information</h3>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium text-gray-500">
                  {(listing.source || 'D')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{listing.source || 'Unknown Dealer'}</p>
                  <p className="text-[12px] text-gray-500 flex items-center gap-1 mt-0.5">
                    <MapPin size={12} /> North America
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <Star size={10} className="text-gray-300" />
                    <span className="text-[11px] text-gray-400">(0) - Reviews</span>
                  </div>
                  <div className="flex gap-3 mt-2 text-[11px] text-gray-500">
                    <span>24 WTS</span>
                    <span>2 WTB</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button className="flex-1 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white font-medium rounded-lg transition-colors text-sm">
                Check Availability
              </button>
              <button className="flex-1 py-3 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center justify-center gap-2">
                <Mail size={14} /> Message
              </button>
            </div>
            <button className="w-full py-2 text-[#3B5BFE] text-sm font-medium hover:underline">
              See User Profile
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/**
 * AI Suggestion Panel — Auto-fill gaps during HUMAN review
 * Shows AI-recommended values for missing fields
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Wand2, CheckCircle, AlertTriangle } from 'lucide-react';

interface Suggestion {
  field: string;
  current: string | null;
  suggested: string;
  confidence: number;
  source: 'catalog_match' | 'price_inference' | 'pattern_match' | 'brand_model';
}

interface Props {
  record: any;
  onApply: (field: string, value: string) => void;
}

export function AISuggestionPanel({ record, onApply }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!record) return;
    setLoading(true);

    // Simulate AI analysis — in production this calls GPT-4o
    const raw = record.raw_message || '';
    const lower = raw.toLowerCase();
    const results: Suggestion[] = [];

    // Detect brand from raw message
    if (!record.brand) {
      const brands: Record<string, string> = {
        'rolex': 'Rolex', 'patek': 'Patek Philippe', 'pp': 'Patek Philippe',
        'ap': 'Audemars Piguet', 'audemars': 'Audemars Piguet',
        'rm': 'Richard Mille', 'richard': 'Richard Mille',
        'cartier': 'Cartier', 'omega': 'Omega', 'vc': 'Vacheron Constantin',
      };
      for (const [key, brand] of Object.entries(brands)) {
        if (lower.includes(key)) {
          results.push({ field: 'brand', current: record.brand, suggested: brand, confidence: 85, source: 'pattern_match' });
          break;
        }
      }
    }

    // Detect dial color
    if (!record.dial_color) {
      const colors: Record<string, string> = {
        'blue': 'Blue', 'black': 'Black', 'white': 'White', 'green': 'Green',
        'silver': 'Silver', 'champagne': 'Champagne', 'brown': 'Brown',
        'red': 'Red', 'gray': 'Gray', 'grey': 'Gray', 'tiffany': 'Tiffany Blue',
        'lapis': 'Lapis', 'green hulk': 'Green', 'batman': 'Black/Blue',
      };
      for (const [key, color] of Object.entries(colors)) {
        if (lower.includes(key)) {
          results.push({ field: 'dial_color', current: record.dial_color, suggested: color, confidence: 78, source: 'pattern_match' });
          break;
        }
      }
    }

    // Detect condition from price
    if (!record.condition && record.price_usd > 0) {
      let cond = 'N5';
      if (record.price_usd > 500000) cond = 'N1';
      else if (record.price_usd > 100000) cond = 'N3';
      else if (record.price_usd < 5000) cond = 'N7';
      results.push({ field: 'condition', current: record.condition, suggested: cond, confidence: 65, source: 'price_inference' });
    }

    // Detect year
    if (!record.year) {
      const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        const yr = parseInt(yearMatch[1]);
        if (yr >= 1980 && yr <= 2026) {
          results.push({ field: 'year', current: String(record.year), suggested: String(yr), confidence: 90, source: 'pattern_match' });
        }
      }
    }

    // Detect box/papers from text
    if (lower.includes('full set') || lower.includes('box and papers')) {
      results.push({ field: 'accessories', current: null, suggested: 'Box + Papers', confidence: 95, source: 'pattern_match' });
    } else if (lower.includes('watch only') || lower.includes('head only')) {
      results.push({ field: 'accessories', current: null, suggested: 'Watch Only', confidence: 92, source: 'pattern_match' });
    }

    setSuggestions(results);
    setLoading(false);
  }, [record?.id, record?.raw_message]);

  if (loading) {
    return (
      <div className="p-4 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg">
        <div className="flex items-center gap-2 text-[#D4AF37]">
          <Sparkles size={14} className="animate-pulse" />
          <span className="text-xs">AI analyzing raw message...</span>
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="p-4 bg-[#1A1A24] border border-[#2A2A3E] rounded-lg">
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle size={14} />
          <span className="text-xs">All fields detected — no AI suggestions needed</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gradient-to-r from-[#1A1A24] to-[#1A1A24] border border-[#D4AF37]/20 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <Wand2 size={14} className="text-[#D4AF37]" />
        <span className="text-xs font-semibold text-[#D4AF37] uppercase tracking-wider">AI Suggestions</span>
        <span className="text-xs text-gray-500 ml-auto">{suggestions.length} found</span>
      </div>

      <div className="space-y-2">
        {suggestions.map((s) => (
          <motion.div
            key={s.field}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center justify-between p-2 bg-[#16161F] rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase">{s.field}</span>
                <span className="text-xs px-1 bg-[#D4AF37]/10 text-[#D4AF37] rounded">{s.source.replace('_', ' ')}</span>
                <span className="text-xs text-gray-500">{s.confidence}%</span>
              </div>
              <div className="text-xs mt-0.5">
                <span className="text-gray-500 line-through mr-2">{s.current || 'empty'}</span>
                <span className="text-green-400 font-medium">→ {s.suggested}</span>
              </div>
            </div>
            <button
              onClick={() => onApply(s.field, s.suggested)}
              className="ml-2 px-3 py-1 bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-[#D4AF37] text-xs font-medium rounded transition-colors flex items-center gap-1"
            >
              <Sparkles size={10} /> Apply
            </button>
          </motion.div>
        ))}
      </div>

      <button
        onClick={() => suggestions.forEach(s => onApply(s.field, s.suggested))}
        className="w-full mt-3 py-2 bg-[#D4AF37] hover:bg-[#E5C158] text-black text-xs font-semibold rounded transition-colors flex items-center justify-center gap-1"
      >
        <Wand2 size={12} /> Apply All AI Suggestions
      </button>
    </div>
  );
}

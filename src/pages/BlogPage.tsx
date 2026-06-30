import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, ArrowRight, BookOpen, TrendingUp, Shield, Gem, Eye, BarChart3, Globe, Cpu, Award } from 'lucide-react';
import { Link } from 'react-router-dom';

const blogPosts = [
  {
    id: 1, title: "Why the Patek Philippe Nautilus 5711 is the Ultimate Investment Piece",
    excerpt: "An in-depth analysis of price appreciation, market scarcity, and why collectors are paying 10x retail for this iconic reference.", category: "Investment", readTime: 8, icon: TrendingUp, date: "June 28, 2026",
  },
  {
    id: 2, title: "AI-Powered Watch Authentication: How Machine Learning Detects Fakes",
    excerpt: "Exploring how computer vision and NLP algorithms analyze dial fonts, case finishing, and movement patterns to spot counterfeits with 99.7% accuracy.", category: "Technology", readTime: 6, icon: Cpu, date: "June 25, 2026",
  },
  {
    id: 3, title: "The Complete Guide to Rolex Dial Variations: From Gilt to Gloss",
    excerpt: "Every serious collector needs to understand dial manufacturing evolution. We break down 60 years of Rolex dial changes reference by reference.", category: "Reference", readTime: 12, icon: BookOpen, date: "June 22, 2026",
  },
  {
    id: 4, title: "Blockchain Provenance: Why Digital Passports Are the Future of Luxury",
    excerpt: "How blockchain-certified digital passports protect your investment, prove authenticity, and create an immutable ownership chain.", category: "Blockchain", readTime: 5, icon: Shield, date: "June 18, 2026",
  },
  {
    id: 5, title: "Market Report: Top 10 Watches That Gained Value in H1 2026",
    excerpt: "Our data team analyzed 2.39M listings to identify the timepieces with the strongest price appreciation in the first half of 2026.", category: "Market Data", readTime: 7, icon: BarChart3, date: "June 15, 2026",
  },
  {
    id: 6, title: "Understanding Watch Condition Grades: NOS vs. Unworn vs. Mint",
    excerpt: "The difference between condition grades can mean $50,000 in value. Learn how professionals assess and grade watch condition.", category: "Education", readTime: 6, icon: Eye, date: "June 12, 2026",
  },
  {
    id: 7, title: "Richard Mille: Engineering Marvel or Overpriced Hype?",
    excerpt: "Breaking down the technology, materials science, and exclusivity that justify six-figure price tags on these avant-garde timepieces.", category: "Analysis", readTime: 9, icon: Gem, date: "June 8, 2026",
  },
  {
    id: 8, title: "The Rise of Independent Watchmakers: F.P. Journe, De Bethune, and Beyond",
    excerpt: "Why collectors are shifting from mass-produced luxury to hand-crafted independents, and which brands are poised for exponential growth.", category: "Collecting", readTime: 10, icon: Award, date: "June 4, 2026",
  },
  {
    id: 9, title: "Global Watch Market: How Currency Fluctuations Affect Pricing",
    excerpt: "A data-driven look at how CHF, EUR, and USD exchange rates impact watch prices across Hong Kong, Geneva, Dubai, and New York markets.", category: "Market Data", readTime: 7, icon: Globe, date: "May 30, 2026",
  },
  {
    id: 10, title: "Vintage vs. Modern: Which Audemars Piguet Royal Oak Holds Better Value?",
    excerpt: "Comparing 5402ST vintage models against current 15510ST production. Our analysis of 50,000+ transactions reveals surprising conclusions.", category: "Investment", readTime: 8, icon: TrendingUp, date: "May 26, 2026",
  },
];

const categories = ["All", ...Array.from(new Set(blogPosts.map(p => p.category)))];

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const filtered = activeCategory === "All" ? blogPosts : blogPosts.filter(p => p.category === activeCategory);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white pb-20 md:pb-0">
      {/* Hero */}
      <div className="border-b border-[#1E1E2E] bg-[#111118]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <span className="text-[11px] text-[#D4AF37] font-medium uppercase tracking-wider">Knowledge Center</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3">WatchFacts Blog</h1>
          <p className="text-sm text-gray-400 max-w-2xl">
            Expert insights on luxury watch collecting, market analysis, authentication technology,
            and blockchain-backed provenance. Powered by 2.39M+ normalized listings.
          </p>
        </div>
      </div>

      {/* Category Filter */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === cat
                  ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                  : 'bg-[#111118] text-gray-400 border border-[#1E1E2E] hover:text-white hover:border-[#2A2A3E]'
              }`}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Blog Grid */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((post, i) => {
            const Icon = post.icon;
            return (
              <motion.article key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="group bg-[#111118] border border-[#1E1E2E] rounded-xl p-5 hover:border-[#D4AF37]/30 hover:bg-[#1A1A24] transition-all cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#D4AF37]/20 transition-colors">
                    <Icon className="w-5 h-5 text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2 py-0.5 rounded bg-[#3B5BFE]/20 text-[#3B5BFE] text-[10px] font-semibold uppercase tracking-wider">
                        {post.category}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-gray-600">
                        <Clock size={10} /> {post.readTime} min read
                      </span>
                    </div>
                    <h2 className="text-sm font-semibold text-white group-hover:text-[#D4AF37] transition-colors leading-snug mb-2">
                      {post.title}
                    </h2>
                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">
                      {post.excerpt}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-600">{post.date}</span>
                      <span className="flex items-center gap-1 text-[11px] text-[#D4AF37] opacity-0 group-hover:opacity-100 transition-opacity">
                        Read <ArrowRight size={12} />
                      </span>
                    </div>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-700" />
            <p className="text-sm">No articles in this category yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

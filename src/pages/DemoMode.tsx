import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import {
  Play, Pause, SkipForward, SkipBack, Monitor, Eye,
  CheckCircle2, AlertTriangle, XCircle, ArrowRight,
  BarChart3, Shield, Zap, Target
} from 'lucide-react';

interface DemoStep {
  id: number;
  title: string;
  description: string;
  screen: 'home' | 'price-research' | 'confidence' | 'review' | 'analytics';
  highlights: string[];
}

const DEMO_STEPS: DemoStep[] = [
  {
    id: 1,
    title: 'Homepage Overview',
    description: 'Curated Luxury aggregates luxury watch listings from multiple sources, normalizes data, and provides accurate pricing insights.',
    screen: 'home',
    highlights: ['6,769 catalog references', '8 luxury brands', 'Real-time FX rates'],
  },
  {
    id: 2,
    title: 'Price Research',
    description: 'Enter any reference number to get instant market analysis with confidence scoring.',
    screen: 'price-research',
    highlights: ['Live market data', 'IQR filtering', 'Duplicate detection'],
  },
  {
    id: 3,
    title: 'Confidence Scoring',
    description: 'Every listing gets a confidence score based on catalog match vs AI-extracted fields.',
    screen: 'confidence',
    highlights: ['100% = All catalog fields', '90% = 1 AI field', '80% = 2 AI fields', '<80% = Flagged for review'],
  },
  {
    id: 4,
    title: 'Human Review Queue',
    description: 'Flagged listings (<80% confidence) go to human review for accuracy verification.',
    screen: 'review',
    highlights: ['Admin approval workflow', 'Edit and correct', 'Audit trail'],
  },
  {
    id: 5,
    title: 'Analytics Dashboard',
    description: 'Real-time metrics on data quality, accuracy trends, and processing performance.',
    screen: 'analytics',
    highlights: ['Confidence trends', 'Accuracy metrics', 'Brand distribution'],
  },
];

export default function DemoMode() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const step = DEMO_STEPS[currentStep];

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setCurrentStep(prev => (prev + 1) % DEMO_STEPS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const getScreenContent = (screen: string) => {
    switch (screen) {
      case 'home':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Catalog References', value: '6,769', color: 'text-gold-primary' },
                { label: 'Brands', value: '8', color: 'text-blue-400' },
                { label: 'Live FX Rates', value: 'Active', color: 'text-emerald-400' },
                { label: 'Confidence Scoring', value: 'Enabled', color: 'text-purple-400' },
              ].map(stat => (
                <div key={stat.label} className="rounded-lg border border-border-default bg-bg-card p-3 text-center">
                  <div className={`text-xl font-extrabold ${stat.color}`}>{stat.value}</div>
                  <div className="text-[10px] text-text-muted mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border-default bg-bg-card p-4">
              <h4 className="text-xs font-bold text-text-primary mb-2">Supported Brands</h4>
              <div className="flex flex-wrap gap-2">
                {['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Breitling', 'Cartier', 'Breguet', 'IWC', 'Bvlgari', 'Grand Seiko'].map(brand => (
                  <span key={brand} className="px-2 py-1 rounded bg-bg-elevated text-xs text-text-secondary">{brand}</span>
                ))}
              </div>
            </div>
          </div>
        );
      case 'price-research':
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-gold-primary/30 bg-gold-primary/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target size={14} className="text-gold-primary" />
                <span className="text-xs font-bold text-text-primary">Reference 52506 — Rolex 1908</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-extrabold text-emerald-400">$42,500</div>
                  <div className="text-[10px] text-text-muted">Min</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-extrabold text-gold-primary">$49,000</div>
                  <div className="text-[10px] text-text-muted">Avg</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-extrabold text-blue-400">$58,000</div>
                  <div className="text-[10px] text-text-muted">Max</div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border-default bg-bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Listings Analyzed</span>
                <span className="text-xs font-mono text-text-primary">38</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Duplicates Removed</span>
                <span className="text-xs font-mono text-red-400">6</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">IQR Filtered</span>
                <span className="text-xs font-mono text-emerald-400">36</span>
              </div>
            </div>
          </div>
        );
      case 'confidence':
        return (
          <div className="space-y-3">
            {[
              { score: 100, label: 'Verified', fields: 'All catalog fields matched', color: 'bg-emerald-500', textColor: 'text-emerald-400', count: 14 },
              { score: 90, label: 'Review', fields: '1 AI field: price', color: 'bg-blue-500', textColor: 'text-blue-400', count: 12 },
              { score: 80, label: 'Check', fields: '2 AI fields: price, condition', color: 'bg-amber-500', textColor: 'text-amber-400', count: 8 },
              { score: 60, label: 'Flagged', fields: '4 AI fields: price, currency, year, condition', color: 'bg-red-500', textColor: 'text-red-400', count: 4 },
            ].map(item => (
              <div key={item.score} className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-card p-3">
                <div className={`w-12 h-12 rounded-lg ${item.color} bg-opacity-10 flex flex-col items-center justify-center`}>
                  <span className={`text-sm font-extrabold ${item.textColor}`}>{item.score}%</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text-primary">{item.label}</span>
                    <span className="text-[10px] text-text-muted">({item.count} listings)</span>
                  </div>
                  <div className="text-[10px] text-text-secondary">{item.fields}</div>
                </div>
                {item.score < 80 && <AlertTriangle size={14} className="text-red-400" />}
                {item.score >= 100 && <CheckCircle2 size={14} className="text-emerald-400" />}
              </div>
            ))}
          </div>
        );
      case 'review':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={14} className="text-gold-primary" />
              <span className="text-xs font-bold text-text-primary">Human Review Queue (3 pending)</span>
            </div>
            {[
              { ref: '52506', brand: 'Rolex', confidence: 60, issue: 'Price mismatch with catalog' },
              { ref: '126500LN', brand: 'Rolex', confidence: 70, issue: 'Condition unclear' },
              { ref: '5711/1A', brand: 'Patek Philippe', confidence: 50, issue: 'Multiple AI fields uncertain' },
            ].map(item => (
              <div key={item.ref} className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-card p-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <span className="text-xs font-extrabold text-red-400">{item.confidence}%</span>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-text-primary">{item.brand} {item.ref}</div>
                  <div className="text-[10px] text-red-400">{item.issue}</div>
                </div>
                <div className="flex gap-1">
                  <button className="p-1.5 rounded bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 size={12} />
                  </button>
                  <button className="p-1.5 rounded bg-red-500/10 text-red-400">
                    <XCircle size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      case 'analytics':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border-default bg-bg-card p-3 text-center">
                <div className="text-lg font-extrabold text-emerald-400">94.2%</div>
                <div className="text-[10px] text-text-muted">AI Parse Success</div>
              </div>
              <div className="rounded-lg border border-border-default bg-bg-card p-3 text-center">
                <div className="text-lg font-extrabold text-blue-400">87.5%</div>
                <div className="text-[10px] text-text-muted">Catalog Match</div>
              </div>
              <div className="rounded-lg border border-border-default bg-bg-card p-3 text-center">
                <div className="text-lg font-extrabold text-amber-400">12.3%</div>
                <div className="text-[10px] text-text-muted">Human Review</div>
              </div>
            </div>
            <div className="rounded-lg border border-border-default bg-bg-card p-4">
              <h4 className="text-xs font-bold text-text-primary mb-2">Confidence Trend (30 days)</h4>
              <div className="flex items-end gap-1 h-20">
                {[65, 68, 72, 70, 75, 78, 80, 82, 85, 83, 87, 89].map((h, i) => (
                  <div key={i} className="flex-1 bg-gold-primary/30 rounded-t" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-text-muted">Day 1</span>
                <span className="text-[9px] text-text-muted">Day 30</span>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Layout>
      <TabNav />
      <div className="max-w-4xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center justify-center gap-2">
            <Monitor size={22} className="text-gold-primary" />
            Curated Luxury Demo
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Interactive presentation mode for shows and investor demos.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {DEMO_STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { setCurrentStep(i); setIsPlaying(false); }}
              className={`flex-1 h-2 rounded-full transition-all ${
                i <= currentStep ? 'bg-gold-primary' : 'bg-bg-elevated'
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            disabled={currentStep === 0}
            className="p-2 rounded-lg border border-border-default hover:border-gold-primary/50 disabled:opacity-30"
          >
            <SkipBack size={16} className="text-text-muted" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-3 rounded-lg bg-gold-primary text-black hover:bg-gold-hover transition-colors"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            onClick={() => setCurrentStep(prev => Math.min(DEMO_STEPS.length - 1, prev + 1))}
            disabled={currentStep === DEMO_STEPS.length - 1}
            className="p-2 rounded-lg border border-border-default hover:border-gold-primary/50 disabled:opacity-30"
          >
            <SkipForward size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Step Info */}
        <div className="text-center mb-6">
          <div className="text-xs text-gold-primary font-bold uppercase tracking-wider mb-1">
            Step {currentStep + 1} of {DEMO_STEPS.length}
          </div>
          <h2 className="text-xl font-extrabold text-text-primary">{step.title}</h2>
          <p className="text-sm text-text-secondary mt-1 max-w-lg mx-auto">{step.description}</p>
        </div>

        {/* Screen Simulation */}
        <div className="rounded-xl border border-border-default bg-bg-elevated/30 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Eye size={14} className="text-gold-primary" />
            <span className="text-xs font-bold text-text-primary">Live Preview</span>
          </div>
          {getScreenContent(step.screen)}
        </div>

        {/* Highlights */}
        <div className="grid grid-cols-2 gap-3">
          {step.highlights.map((highlight, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-card p-3">
              <Zap size={14} className="text-gold-primary flex-shrink-0" />
              <span className="text-xs text-text-secondary">{highlight}</span>
            </div>
          ))}
        </div>

        {/* Navigation hint */}
        <div className="text-center mt-6">
          <button
            onClick={() => setCurrentStep(prev => Math.min(DEMO_STEPS.length - 1, prev + 1))}
            disabled={currentStep === DEMO_STEPS.length - 1}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gold-primary text-black font-bold hover:bg-gold-hover transition-colors disabled:opacity-30"
          >
            {currentStep === DEMO_STEPS.length - 1 ? 'Demo Complete' : 'Next Step'}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Layout>
  );
}

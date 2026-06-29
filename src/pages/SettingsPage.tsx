/**
 * Settings Page — Admin configuration dashboard
 * ================================================
 * Sections:
 * 1. Parser Thresholds (auto-approve, human review)
 * 2. API Configuration (LLM provider, confidence floor)
 * 3. Export Defaults (format, row limit, toggles)
 * 4. Data Pipeline (read-only stats + actions)
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Sliders, Globe, Download,
  Database, AlertTriangle, RotateCcw,
  CheckCircle, Trash2,
} from 'lucide-react';

/* ── Constants ─────────────────────────────────────────── */
const STORAGE_KEYS = {
  APPROVE_THRESHOLD: 'wf_approve_threshold',
  HUMAN_THRESHOLD: 'wf_human_threshold',
  LLM_PROVIDER: 'wf_llm_provider',
  LLM_TRIGGER_THRESHOLD: 'wf_llm_trigger_threshold',
  EXPORT_FORMAT: 'wf_export_format',
  EXPORT_ROW_LIMIT: 'wf_export_row_limit',
  EXPORT_INCLUDE_RAW: 'wf_export_include_raw',
  EXPORT_INCLUDE_CONFIDENCE: 'wf_export_include_confidence',
};

const DEFAULTS = {
  APPROVE_THRESHOLD: 90,
  HUMAN_THRESHOLD: 80,
  LLM_PROVIDER: 'GPT-4o-mini',
  LLM_TRIGGER_THRESHOLD: 70,
  EXPORT_FORMAT: 'Excel (.xlsx)',
  EXPORT_ROW_LIMIT: 10000,
  EXPORT_INCLUDE_RAW: true,
  EXPORT_INCLUDE_CONFIDENCE: true,
};

const LLM_OPTIONS = ['GPT-4o-mini', 'Claude 3.5 Sonnet', 'DeepSeek V3', 'OpenRouter Free'];
const FORMAT_OPTIONS = ['Excel (.xlsx)', 'CSV', 'JSON'];

/* ── Helpers ───────────────────────────────────────────── */
function loadInt(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) : fallback;
  } catch {
    return fallback;
  }
}
function loadStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v === 'true' : fallback;
  } catch {
    return fallback;
  }
}
function saveVal(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* noop */ }
}

const sectionVariant = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.35, ease: 'easeOut' },
  }),
};

/* ── Component ──────────────────────────────────────────── */
export default function SettingsPage() {
  /* ── State ─────────────────────────────────────────── */
  const [approveThreshold, setApproveThreshold] = useState(() =>
    loadInt(STORAGE_KEYS.APPROVE_THRESHOLD, DEFAULTS.APPROVE_THRESHOLD)
  );
  const [humanThreshold, setHumanThreshold] = useState(() =>
    loadInt(STORAGE_KEYS.HUMAN_THRESHOLD, DEFAULTS.HUMAN_THRESHOLD)
  );

  const [llmProvider, setLlmProvider] = useState(() =>
    loadStr(STORAGE_KEYS.LLM_PROVIDER, DEFAULTS.LLM_PROVIDER)
  );
  const [llmTrigger, setLlmTrigger] = useState(() =>
    loadInt(STORAGE_KEYS.LLM_TRIGGER_THRESHOLD, DEFAULTS.LLM_TRIGGER_THRESHOLD)
  );

  const [exportFormat, setExportFormat] = useState(() =>
    loadStr(STORAGE_KEYS.EXPORT_FORMAT, DEFAULTS.EXPORT_FORMAT)
  );
  const [exportRowLimit, setExportRowLimit] = useState(() =>
    loadInt(STORAGE_KEYS.EXPORT_ROW_LIMIT, DEFAULTS.EXPORT_ROW_LIMIT)
  );
  const [includeRaw, setIncludeRaw] = useState(() =>
    loadBool(STORAGE_KEYS.EXPORT_INCLUDE_RAW, DEFAULTS.EXPORT_INCLUDE_RAW)
  );
  const [includeConfidence, setIncludeConfidence] = useState(() =>
    loadBool(STORAGE_KEYS.EXPORT_INCLUDE_CONFIDENCE, DEFAULTS.EXPORT_INCLUDE_CONFIDENCE)
  );

  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [showConfirmReprocess, setShowConfirmReprocess] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  /* ── Persist helpers ───────────────────────────────── */
  const markSaved = (id: string) => {
    setSavedSection(id);
    setTimeout(() => setSavedSection(null), 2000);
  };

  const saveThresholds = () => {
    saveVal(STORAGE_KEYS.APPROVE_THRESHOLD, String(approveThreshold));
    saveVal(STORAGE_KEYS.HUMAN_THRESHOLD, String(humanThreshold));
    markSaved('thresholds');
  };

  const saveApiConfig = () => {
    saveVal(STORAGE_KEYS.LLM_PROVIDER, llmProvider);
    saveVal(STORAGE_KEYS.LLM_TRIGGER_THRESHOLD, String(llmTrigger));
    markSaved('api');
  };

  const saveExportDefaults = () => {
    saveVal(STORAGE_KEYS.EXPORT_FORMAT, exportFormat);
    saveVal(STORAGE_KEYS.EXPORT_ROW_LIMIT, String(exportRowLimit));
    saveVal(STORAGE_KEYS.EXPORT_INCLUDE_RAW, String(includeRaw));
    saveVal(STORAGE_KEYS.EXPORT_INCLUDE_CONFIDENCE, String(includeConfidence));
    markSaved('export');
  };

  const handleReprocess = () => {
    setShowConfirmReprocess(false);
    markSaved('reprocess');
  };

  const handleClearCache = () => {
    if (showConfirmClear) {
      Object.values(STORAGE_KEYS).forEach((k) => {
        try { localStorage.removeItem(k); } catch { /* noop */ }
      });
      setApproveThreshold(DEFAULTS.APPROVE_THRESHOLD);
      setHumanThreshold(DEFAULTS.HUMAN_THRESHOLD);
      setLlmProvider(DEFAULTS.LLM_PROVIDER);
      setLlmTrigger(DEFAULTS.LLM_TRIGGER_THRESHOLD);
      setExportFormat(DEFAULTS.EXPORT_FORMAT);
      setExportRowLimit(DEFAULTS.EXPORT_ROW_LIMIT);
      setIncludeRaw(DEFAULTS.EXPORT_INCLUDE_RAW);
      setIncludeConfidence(DEFAULTS.EXPORT_INCLUDE_CONFIDENCE);
      setShowConfirmClear(false);
      markSaved('clear');
    } else {
      setShowConfirmClear(true);
    }
  };

  /* ── Styles ────────────────────────────────────────── */
  const sliderClass =
    'w-full h-2 bg-[#1E1E2E] rounded-full appearance-none cursor-pointer accent-[#D4AF37]';

  const selectClass =
    'w-full bg-[#1A1A24] border border-[#1E1E2E] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20 transition-all cursor-pointer';

  const inputClass =
    'w-full bg-[#1A1A24] border border-[#1E1E2E] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20 transition-all';

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="p-5 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings size={22} className="text-[#D4AF37]" /> Settings
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Configure parser thresholds, API settings, and export defaults
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ═══ Section 1: Parser Thresholds ═══════════════════════════ */}
        <motion.div
          custom={0}
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Sliders size={16} className="text-[#D4AF37]" />
            <h2 className="text-sm font-semibold text-white">Parser Thresholds</h2>
          </div>

          <p className="text-[11px] text-gray-500 mb-5 leading-relaxed">
            Records scoring above the auto-approve threshold are posted automatically.
            Records below the human review threshold require manual review.
          </p>

          {/* Auto-Approve Threshold */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium">Auto-Approve Threshold</label>
              <span className="text-xs font-mono text-[#D4AF37] font-bold">{approveThreshold}%</span>
            </div>
            <input
              type="range"
              min={70}
              max={100}
              value={approveThreshold}
              onChange={(e) => setApproveThreshold(parseInt(e.target.value))}
              className={sliderClass}
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>70%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Human Review Threshold */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium">Human Review Threshold</label>
              <span className="text-xs font-mono text-[#D4AF37] font-bold">{humanThreshold}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={90}
              value={humanThreshold}
              onChange={(e) => setHumanThreshold(parseInt(e.target.value))}
              className={sliderClass}
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>50%</span>
              <span>90%</span>
            </div>
          </div>

          {/* Save */}
          <button
            onClick={saveThresholds}
            className="px-4 py-2 bg-[#D4AF37] hover:bg-[#C4A030] text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {savedSection === 'thresholds' ? <><CheckCircle size={13} /> Saved</> : 'Save Thresholds'}
          </button>
        </motion.div>

        {/* ═══ Section 2: API Configuration ═══════════════════════════ */}
        <motion.div
          custom={1}
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-[#D4AF37]" />
            <h2 className="text-sm font-semibold text-white">API Configuration</h2>
          </div>

          <p className="text-[11px] text-gray-500 mb-5 leading-relaxed">
            When parser confidence falls below the LLM trigger threshold, the LLM enrichment pipeline is triggered.
          </p>

          {/* Online Search Provider */}
          <div className="mb-5">
            <label className="block text-xs text-gray-400 font-medium mb-2">Online Search Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              className={selectClass}
            >
              {LLM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* LLM Trigger Threshold */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 font-medium">LLM Trigger Threshold</label>
              <span className="text-xs font-mono text-[#D4AF37] font-bold">{llmTrigger}%</span>
            </div>
            <input
              type="range"
              min={40}
              max={80}
              value={llmTrigger}
              onChange={(e) => setLlmTrigger(parseInt(e.target.value))}
              className={sliderClass}
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>40%</span>
              <span>80%</span>
            </div>
          </div>

          {/* Save */}
          <button
            onClick={saveApiConfig}
            className="px-4 py-2 bg-[#D4AF37] hover:bg-[#C4A030] text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {savedSection === 'api' ? <><CheckCircle size={13} /> Saved</> : 'Save API Config'}
          </button>
        </motion.div>

        {/* ═══ Section 3: Export Defaults ═════════════════════════════ */}
        <motion.div
          custom={2}
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Download size={16} className="text-[#D4AF37]" />
            <h2 className="text-sm font-semibold text-white">Export Defaults</h2>
          </div>

          {/* Default Format */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 font-medium mb-2">Default Format</label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className={selectClass}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Default Row Limit */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 font-medium mb-2">Default Row Limit</label>
            <input
              type="number"
              min={100}
              max={50000}
              step={100}
              value={exportRowLimit}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 100;
                setExportRowLimit(Math.max(100, Math.min(50000, v)));
              }}
              className={inputClass}
            />
            <div className="text-[10px] text-gray-600 mt-1">Min: 100 · Max: 50,000</div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 mb-5">
            {/* Include Raw Message */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${includeRaw ? 'bg-[#D4AF37]' : 'bg-[#1E1E2E]'}`}
                onClick={() => setIncludeRaw(!includeRaw)}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: includeRaw ? 'translateX(14px)' : 'translateX(0)', left: '2px' }}
                />
              </div>
              <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">Include Raw Message</span>
            </label>

            {/* Include Parser Confidence */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${includeConfidence ? 'bg-[#D4AF37]' : 'bg-[#1E1E2E]'}`}
                onClick={() => setIncludeConfidence(!includeConfidence)}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: includeConfidence ? 'translateX(14px)' : 'translateX(0)', left: '2px' }}
                />
              </div>
              <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">Include Parser Confidence</span>
            </label>
          </div>

          {/* Save */}
          <button
            onClick={saveExportDefaults}
            className="px-4 py-2 bg-[#D4AF37] hover:bg-[#C4A030] text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {savedSection === 'export' ? <><CheckCircle size={13} /> Saved</> : 'Save Export Defaults'}
          </button>
        </motion.div>

        {/* ═══ Section 4: Data Pipeline ═══════════════════════════════ */}
        <motion.div
          custom={3}
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          className="bg-[#111118] border border-[#1E1E2E] rounded-lg p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Database size={16} className="text-[#D4AF37]" />
            <h2 className="text-sm font-semibold text-white">Data Pipeline</h2>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-[#1A1A24] rounded-lg p-3 border border-[#1E1E2E]">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Records</div>
              <div className="text-lg font-bold text-white font-mono">2,390,143</div>
            </div>
            <div className="bg-[#1A1A24] rounded-lg p-3 border border-green-500/20">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Auto-Approved</div>
              <div className="text-lg font-bold text-green-400 font-mono">805,872</div>
              <div className="text-[10px] text-gray-600">33.7%</div>
            </div>
            <div className="bg-[#1A1A24] rounded-lg p-3 border border-blue-500/20">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">In Review</div>
              <div className="text-lg font-bold text-blue-400 font-mono">311,890</div>
              <div className="text-[10px] text-gray-600">13.1%</div>
            </div>
            <div className="bg-[#1A1A24] rounded-lg p-3 border border-amber-500/20">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Human Review</div>
              <div className="text-lg font-bold text-amber-400 font-mono">201,811</div>
              <div className="text-[10px] text-gray-600">8.4%</div>
            </div>
            <div className="bg-[#1A1A24] rounded-lg p-3 border border-red-500/20 col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Recycled</div>
                  <div className="text-lg font-bold text-red-400 font-mono">1,070,570</div>
                </div>
                <div className="text-[10px] text-gray-600">44.8%</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            {/* Reprocess */}
            {!showConfirmReprocess ? (
              <button
                onClick={() => setShowConfirmReprocess(true)}
                className="w-full px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw size={13} /> Reprocess All Records
              </button>
            ) : (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={14} className="text-red-400" />
                  <span className="text-xs font-semibold text-red-400">Confirm Action</span>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">
                  This will queue all 2.39M records for reprocessing. This action cannot be undone and may take several hours.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleReprocess}
                    className="flex-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Yes, Reprocess All
                  </button>
                  <button
                    onClick={() => setShowConfirmReprocess(false)}
                    className="flex-1 px-3 py-1.5 bg-[#1A1A24] hover:bg-[#2A2A34] text-gray-300 text-xs font-semibold rounded-lg transition-colors border border-[#1E1E2E]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Clear Cache */}
            {!showConfirmClear ? (
              <button
                onClick={handleClearCache}
                className="w-full px-4 py-2.5 bg-[#1A1A24] hover:bg-[#2A2A34] border border-[#1E1E2E] text-gray-400 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={13} /> Clear Cache
              </button>
            ) : (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold text-amber-400">Confirm Action</span>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">
                  This will reset all settings to their default values. Are you sure?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleClearCache}
                    className="flex-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold rounded-lg transition-colors"
                  >
                    Yes, Reset All
                  </button>
                  <button
                    onClick={() => setShowConfirmClear(false)}
                    className="flex-1 px-3 py-1.5 bg-[#1A1A24] hover:bg-[#2A2A34] text-gray-300 text-xs font-semibold rounded-lg transition-colors border border-[#1E1E2E]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Saved feedback */}
          {savedSection === 'clear' && (
            <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
              <CheckCircle size={13} /> Settings reset to defaults
            </div>
          )}
          {savedSection === 'reprocess' && (
            <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
              <CheckCircle size={13} /> Reprocess queued
            </div>
          )}
        </motion.div>
      </div>

      {/* Footer */}
      <motion.div
        custom={4}
        variants={sectionVariant}
        initial="hidden"
        animate="visible"
        className="mt-6 text-center text-[10px] text-gray-600 pb-6"
      >
        WatchFacts Settings · All changes are saved to localStorage
      </motion.div>
    </div>
  );
}

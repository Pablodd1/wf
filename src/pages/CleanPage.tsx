import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileJson, FileSpreadsheet, Download, Play, Trash2,
  CheckCircle2, AlertCircle, Loader2, ArrowRight, Table, Settings,
  RefreshCw, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';

interface PreviewRow {
  [key: string]: string | number | null;
}

interface ColumnMapping {
  source: string;
  target: string;
  confidence: number;
}

const TARGET_FIELDS = [
  'reference', 'brand', 'family', 'price', 'condition', 'year',
  'dialColor', 'currency', 'box', 'papers', 'description', 'ignore',
];

export default function CleanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [normalized, setNormalized] = useState<PreviewRow[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const parseFile = useCallback(async (f: File) => {
    setLoading(true);
    const text = await f.text();
    let data: PreviewRow[] = [];

    if (f.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        data = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        alert('Invalid JSON');
        setLoading(false);
        return;
      }
    } else {
      // CSV
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { setLoading(false); return; }
      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const row: PreviewRow = {};
        headers.forEach((h, i) => { row[h] = values[i] || null; });
        return row;
      });
    }

    if (data.length > 0) {
      const cols = Object.keys(data[0]);
      setColumns(cols);
      setPreviewData(data.slice(0, 100));
      // Auto-map columns
      const autoMappings: ColumnMapping[] = cols.map(col => {
        const lower = col.toLowerCase();
        let target = 'ignore';
        if (/ref/i.test(lower)) target = 'reference';
        else if (/brand|make|manufacturer/i.test(lower)) target = 'brand';
        else if (/family|model|collection/i.test(lower)) target = 'family';
        else if (/price|cost|value/i.test(lower)) target = 'price';
        else if (/condition|state/i.test(lower)) target = 'condition';
        else if (/year|date/i.test(lower)) target = 'year';
        else if (/dial|color/i.test(lower)) target = 'dialColor';
        else if (/currency|cur/i.test(lower)) target = 'currency';
        else if (/box/i.test(lower)) target = 'box';
        else if (/paper/i.test(lower)) target = 'papers';
        else if (/desc|message|note/i.test(lower)) target = 'description';
        return { source: col, target, confidence: target !== 'ignore' ? 85 : 0 };
      });
      setMappings(autoMappings);
    }
    setLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); parseFile(f); }
  }, [parseFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); parseFile(f); }
  }, [parseFile]);

  const handleNormalize = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      const normalized = previewData.map(row => {
        const out: PreviewRow = {};
        mappings.forEach(m => {
          if (m.target !== 'ignore') {
            let val = row[m.source];
            // Simple normalization
            if (m.target === 'price' && val) {
              val = String(val).replace(/[^\d.]/g, '');
            }
            if (m.target === 'brand' && val) {
              const s = String(val);
              if (/patek|pp/i.test(s)) val = 'Patek Philippe';
              else if (/rolex/i.test(s)) val = 'Rolex';
              else if (/audemars|ap/i.test(s)) val = 'Audemars Piguet';
              else if (/richard|rm/i.test(s)) val = 'Richard Mille';
              else if (/vacheron|vc/i.test(s)) val = 'Vacheron Constantin';
            }
            if (m.target === 'condition' && val) {
              const s = String(val).toLowerCase();
              if (/new|bnib/i.test(s)) val = 'New';
              else if (/like|excellent|lnib/i.test(s)) val = 'Like New';
              else if (/naked|head/i.test(s)) val = 'Naked';
              else val = 'Used';
            }
            out[m.target] = val;
          }
        });
        return out;
      });
      setNormalized(normalized);
      setLoading(false);
    }, 1500);
  }, [previewData, mappings]);

  const exportCleaned = useCallback(() => {
    if (!normalized) return;
    const headers = Object.keys(normalized[0]);
    const csv = [
      headers.join(','),
      ...normalized.map(row => headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaned-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [normalized]);

  const clearAll = useCallback(() => {
    setFile(null);
    setPreviewData([]);
    setColumns([]);
    setMappings([]);
    setNormalized(null);
  }, []);

  return (<>
      <div className="p-5 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Settings size={22} className="text-amber-400" /> Data Cleaning
            </h1>
            <p className="text-sm text-gray-400 mt-1">Upload, preview, normalize, and export watch data</p>
          </div>
          <div className="flex gap-2">
            {normalized && (
              <button onClick={exportCleaned} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors flex items-center gap-2 text-sm">
                <Download size={16} /> Export Cleaned
              </button>
            )}
            <button onClick={clearAll} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700 flex items-center gap-2 text-sm">
              <Trash2 size={16} /> Clear
            </button>
          </div>
        </div>

        {/* Upload Area */}
        {!file && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              dragOver ? 'border-amber-400 bg-amber-400/5' : 'border-gray-700 bg-gray-900'
            }`}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-gray-600" />
            <p className="text-lg text-white font-medium mb-2">Drop CSV or JSON file here</p>
            <p className="text-sm text-gray-500 mb-4">or click to browse</p>
            <label className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-medium transition-colors cursor-pointer inline-flex items-center gap-2">
              <Table size={16} /> Select File
              <input type="file" accept=".csv,.json" onChange={handleFileSelect} className="hidden" />
            </label>
          </motion.div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            <span className="ml-3 text-gray-400">Processing...</span>
          </div>
        )}

        {/* Column Mapping */}
        {file && !loading && columns.length > 0 && !normalized && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <Table size={14} /> Column Mapping
                </h3>
                <span className="text-xs text-gray-500">{previewData.length} rows previewed</span>
              </div>
              <div className="space-y-2">
                {mappings.map((m, i) => (
                  <div key={m.source} className="flex items-center gap-3 bg-gray-950 rounded-lg p-3 border border-gray-800">
                    <div className="flex-1">
                      <div className="text-[10px] text-gray-500 uppercase">Source Column</div>
                      <div className="text-sm font-mono text-white">{m.source}</div>
                    </div>
                    <ArrowRight size={16} className="text-gray-600" />
                    <div className="flex-1">
                      <div className="text-[10px] text-gray-500 uppercase">Target Field</div>
                      <select
                        value={m.target}
                        onChange={(e) => {
                          const newMappings = [...mappings];
                          newMappings[i] = { ...m, target: e.target.value };
                          setMappings(newMappings);
                        }}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-400/50"
                      >
                        {TARGET_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="w-16 text-right">
                      <div className="text-[10px] text-gray-500 uppercase">Match</div>
                      <div className={`text-sm font-mono ${m.confidence >= 85 ? 'text-green-400' : m.confidence > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {m.confidence}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleNormalize}
                className="mt-4 w-full px-4 py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Play size={18} /> Normalize Data
              </button>
            </div>

            {/* Data Preview */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <button onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                <Eye size={14} /> Data Preview
                {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <AnimatePresence>
                {showPreview && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                            {columns.map(col => <th key={col} className="text-left py-2 px-2">{col}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.slice(0, 10).map((row, i) => (
                            <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                              {columns.map(col => (
                                <td key={col} className="py-2 px-2 text-gray-300 font-mono text-xs truncate max-w-[200px]">
                                  {row[col] ?? '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {previewData.length > 10 && <p className="text-xs text-gray-500 mt-2">...and {previewData.length - 10} more rows</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* Normalized Result */}
        {normalized && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={20} className="text-green-400" />
              <span className="text-green-400 font-medium">Normalization complete!</span>
              <span className="text-gray-500 text-sm">{normalized.length} rows processed</span>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Cleaned Data Preview</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                      {Object.keys(normalized[0]).map(col => <th key={col} className="text-left py-2 px-2">{col}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {normalized.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50">
                        {Object.keys(normalized[0]).map(col => (
                          <td key={col} className="py-2 px-2 text-gray-300 font-mono text-xs truncate max-w-[200px]">
                            {row[col] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {normalized.length > 20 && <p className="text-xs text-gray-500 mt-2">...and {normalized.length - 20} more rows</p>}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </>);
}

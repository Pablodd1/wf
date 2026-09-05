import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Star } from 'lucide-react';
import type { WatchRecord } from '@/types';
import { DialColorSwatch } from './ui/DialColorSwatch';

interface EditModalProps {
  record: WatchRecord | null;
  open: boolean;
  onClose: () => void;
  onSave: (record: WatchRecord) => void;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3, ease: [0, 0, 0.2, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
};

const fieldVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.03, duration: 0.3, ease: [0, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

const brandOptions = ['PATEK PHILIPPE', 'ROLEX', 'AUDEMARS PIGUET', 'VACHERON CONSTANTIN', 'CARTIER', 'OMEGA', 'OTHER'];
const familyOptions = ['Nautilus', 'Aquanaut', 'Calatrava', 'Grand Complications', 'Complications', 'Gondolo', 'Twenty-4', 'Other'];
const conditionOptions = ['New', 'Used', 'Like New', 'Naked'];
const currencyOptions = ['USD', 'HKD', 'EUR', 'GBP'];
const boxPapersOptions = ['Full Set', 'Box Only', 'Papers Only', 'None', 'Unknown'];

export function EditModal({ record, open, onClose, onSave }: EditModalProps) {
  const [form, setForm] = useState<Partial<WatchRecord>>({});
  const [sellerRating, setSellerRating] = useState(3);

  useEffect(() => {
    if (record) {
      setForm({ ...record });
      setSellerRating(record.sellerRating);
    }
  }, [record]);

  // Lock body scroll
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const updateField = useCallback(<K extends keyof WatchRecord>(field: K, value: WatchRecord[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(() => {
    if (!record) return;
    const updated: WatchRecord = {
      ...record,
      ...form,
      sellerRating,
    } as WatchRecord;
    onSave(updated);
  }, [record, form, sellerRating, onSave]);

  if (!record) return null;

  const inputClass =
    'w-full h-9 px-2.5 bg-bg-input border border-border-default rounded text-sm text-text-primary font-sans placeholder:text-text-muted focus:outline-none focus:border-gold-primary focus:ring-1 focus:ring-gold-primary/20 transition-colors';
  const labelClass = 'block text-[10px] text-text-secondary uppercase tracking-[0.04em] mb-1';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 bg-black/70"
            onClick={onClose}
          />

          {/* Modal Container */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="relative z-[110] w-full max-w-[600px] max-h-[90vh] bg-bg-card border border-border-active rounded-lg shadow-elevated shadow-gold overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gold-primary">EDIT RECORD</h2>
                <p className="text-sm text-text-muted mt-0.5">
                  {record.reference || 'Unknown Reference'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-gold-primary hover:bg-bg-elevated transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Form Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-4">
                {/* Field 1: Reference */}
                <motion.div custom={0} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Reference Number</label>
                  <input
                    type="text"
                    value={form.reference ?? ''}
                    onChange={(e) => updateField('reference', e.target.value)}
                    className={`${inputClass} font-mono`}
                    placeholder="e.g. 5711/1A-010"
                  />
                </motion.div>

                {/* Field 2: Brand */}
                <motion.div custom={1} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Brand</label>
                  <select
                    value={form.brand ?? ''}
                    onChange={(e) => updateField('brand', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select brand...</option>
                    {brandOptions.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </motion.div>

                {/* Field 3: Family */}
                <motion.div custom={2} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Family</label>
                  <select
                    value={form.family ?? ''}
                    onChange={(e) => updateField('family', e.target.value as WatchRecord['family'])}
                    className={inputClass}
                  >
                    <option value="">Select family...</option>
                    {familyOptions.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </motion.div>

                {/* Field 4: Dial Color */}
                <motion.div custom={3} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Dial Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form.dialColor ?? ''}
                      onChange={(e) => updateField('dialColor', e.target.value)}
                      className={`${inputClass} flex-1`}
                      placeholder="e.g. Blue"
                    />
                    {form.dialColor && <DialColorSwatch color={form.dialColor} size={20} showTooltip={false} />}
                  </div>
                </motion.div>

                {/* Field 5: Price */}
                <motion.div custom={4} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Price (USD)</label>
                  <input
                    type="number"
                    value={form.price ?? ''}
                    onChange={(e) => updateField('price', Number(e.target.value))}
                    className={`${inputClass} font-mono`}
                    placeholder="0"
                    min={0}
                  />
                </motion.div>

                {/* Field 6: Currency */}
                <motion.div custom={5} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Original Currency</label>
                  <select
                    value={form.originalCurrency ?? ''}
                    onChange={(e) => updateField('originalCurrency', e.target.value as WatchRecord['originalCurrency'])}
                    className={inputClass}
                  >
                    <option value="">Select currency...</option>
                    {currencyOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </motion.div>

                {/* Field 7: Year */}
                <motion.div custom={6} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Year</label>
                  <input
                    type="number"
                    value={form.year ?? ''}
                    onChange={(e) => updateField('year', e.target.value ? Number(e.target.value) : null)}
                    className={`${inputClass} font-mono`}
                    placeholder="e.g. 2021"
                    min={1900}
                    max={2099}
                  />
                </motion.div>

                {/* Field 8: Condition */}
                <motion.div custom={7} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Condition</label>
                  <select
                    value={form.condition ?? ''}
                    onChange={(e) => updateField('condition', e.target.value as WatchRecord['condition'])}
                    className={inputClass}
                  >
                    <option value="">Select condition...</option>
                    {conditionOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </motion.div>

                {/* Field 9: Box/Papers */}
                <motion.div custom={8} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Box/Papers</label>
                  <select
                    value={
                      form.hasBox && form.hasPapers ? 'Full Set' :
                      form.hasBox ? 'Box Only' :
                      form.hasPapers ? 'Papers Only' :
                      form.hasBox === false && form.hasPapers === false ? 'None' : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      updateField('hasBox', val === 'Full Set' || val === 'Box Only');
                      updateField('hasPapers', val === 'Full Set' || val === 'Papers Only');
                    }}
                    className={inputClass}
                  >
                    <option value="">Select...</option>
                    {boxPapersOptions.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </motion.div>

                {/* Field 10: Seller Rating */}
                <motion.div custom={9} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Seller Rating</label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setSellerRating(star)}
                          className="p-0.5 cursor-pointer transition-transform hover:scale-110"
                        >
                          <Star
                            size={18}
                            className={star <= sellerRating ? 'text-gold-primary fill-gold-primary' : 'text-bg-elevated'}
                          />
                        </button>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-text-secondary ml-2">{sellerRating}/5</span>
                  </div>
                </motion.div>

                {/* Field 11: Source Line */}
                <motion.div custom={10} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Source Message</label>
                  <textarea
                    value={form.rawMessage ?? ''}
                    onChange={(e) => updateField('rawMessage', e.target.value)}
                    className={`${inputClass} h-20 py-2 resize-none font-mono text-xs`}
                    placeholder="Raw WhatsApp message..."
                    rows={3}
                  />
                </motion.div>

                {/* Field 12: Notes */}
                <motion.div custom={11} variants={fieldVariants} initial="hidden" animate="visible">
                  <label className={labelClass}>Notes</label>
                  <textarea
                    value={(form as Record<string, unknown>).notes as string ?? ''}
                    onChange={(e) => updateField('rawMessage' as keyof WatchRecord, e.target.value as WatchRecord[keyof WatchRecord])}
                    className={`${inputClass} h-16 py-2 resize-none`}
                    placeholder="Optional notes..."
                    rows={2}
                  />
                </motion.div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-default flex-shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded text-sm font-medium bg-bg-elevated text-text-secondary border border-border-default hover:bg-bg-card hover:text-text-primary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold bg-gold-primary text-bg-primary hover:bg-gold-bright transition-colors cursor-pointer"
              >
                <Play size={14} />
                Save & Re-run Pipeline
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Activity, FileSpreadsheet } from 'lucide-react';
import type { RawStreamMessage } from '@/hooks/usePipelineSimulation';

interface RawStreamColumnProps {
  messages: RawStreamMessage[];
}

const sourceConfig = {
  whatsapp: {
    color: '#22C55E',
    bg: 'rgba(34, 197, 94, 0.05)',
    borderLeft: '3px solid #22C55E',
    Icon: MessageSquare,
    label: 'WHATSAPP',
  },
  websocket: {
    color: '#8B5CF6',
    bg: 'rgba(139, 92, 246, 0.05)',
    borderLeft: '3px solid #8B5CF6',
    Icon: Activity,
    label: 'WEBSOCKET',
  },
  csv: {
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.05)',
    borderLeft: '3px solid #3B82F6',
    Icon: FileSpreadsheet,
    label: 'CSV',
  },
};

const messageVariants = {
  initial: { x: 40, opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.4, ease: [0, 0, 0.2, 1] as [number, number, number, number] } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export const RawStreamColumn = memo(function RawStreamColumn({ messages }: RawStreamColumnProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden" style={{ minHeight: 520 }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
            RAW STREAM
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-success font-semibold">LIVE</span>
          </span>
        </div>
        <span className="text-[10px] text-muted">{messages.length} messages</span>
      </div>

      {/* Messages feed */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2" style={{ scrollbarWidth: 'thin' }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {messages.map((msg) => {
            const config = sourceConfig[msg.source] || sourceConfig.whatsapp;
            const Icon = config.Icon;
            return (
              <motion.div
                key={msg.id}
                variants={messageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                layout
                className="rounded-md p-2.5"
                style={{
                  backgroundColor: config.bg,
                  borderLeft: config.borderLeft,
                }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={10} style={{ color: config.color }} />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: config.color }}
                  >
                    {config.label}
                  </span>
                  <span className="text-[10px] text-muted font-mono ml-auto">
                    {msg.timestamp}
                  </span>
                </div>
                <p className="text-xs text-text-primary line-clamp-2 leading-relaxed">
                  {msg.text}
                </p>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            Waiting for stream data...
          </div>
        )}
      </div>
    </div>
  );
});

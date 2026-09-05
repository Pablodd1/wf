import { Layout } from '@/components/Layout';
import { AnalyticsTab } from '@/sections/AnalyticsTab';
import { TabNav } from '@/components/TabNav';
import { useWatchData } from '@/hooks/useWatchData';
import { Footer } from '@/components/Footer';
import { motion } from 'framer-motion';

export default function AnalyticsPage() {
  const { records, stats, loading } = useWatchData();

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      <TabNav totalProcessed={stats.totalProcessed} />
      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-6">
          <div className="w-64 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gold-primary rounded-full"
              initial={{ width: '5%' }}
              animate={{ width: '85%' }}
              transition={{
                duration: 8,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatType: 'reverse',
              }}
            />
          </div>
          <div className="h-10 w-10 rounded-full border-2 border-gold-primary/30 border-t-gold-primary animate-spin" />
          <p className="text-sm text-text-muted tracking-wide">Loading analytics data…</p>
          <p className="text-xs text-text-muted/50">Cache warming — first load takes ~8s</p>
        </div>
      ) : (
        <AnalyticsTab records={records} />
      )}
      <Footer />
    </Layout>
  );
}

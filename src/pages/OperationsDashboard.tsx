import { Footer } from '@/components/Footer';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { HomeCommandCenter } from '@/sections/HomeCommandCenter';

/**
 * Default operations landing page. It deliberately avoids useWatchData so an
 * operator does not download the historical browser snapshot just to monitor
 * the live normalization and review workflow.
 */
export default function OperationsDashboard() {
  return (
    <Layout>
      <TabNav />
      <HomeCommandCenter />
      <Footer />
    </Layout>
  );
}

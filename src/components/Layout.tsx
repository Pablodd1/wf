import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

interface LayoutProps {
  children: ReactNode;
  totalProcessed?: number;
  normalizedCount?: number;
  residueCount?: number;
  throughputRate?: number;
  avgLatency?: number;
}

export function Layout({
  children,
  totalProcessed,
  normalizedCount,
  residueCount,
  throughputRate,
  avgLatency,
}: LayoutProps) {
  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: '#0A0A0F' }}>
      <Navbar
        totalProcessed={totalProcessed}
        normalizedCount={normalizedCount}
        residueCount={residueCount}
        throughputRate={throughputRate}
        avgLatency={avgLatency}
      />
      <main className="relative z-[1]">{children}</main>
    </div>
  );
}

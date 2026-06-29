import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] text-white">
      <Navbar />
      {/* pb-20 on mobile accounts for the fixed bottom navigation bar + safe area */}
      <main className="relative pb-20 md:pb-0">{children}</main>
    </div>
  );
}

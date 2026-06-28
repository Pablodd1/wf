import type { ReactNode } from 'react';
import { Navbar } from './Navbar';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] text-white">
      <Navbar />
      <main className="relative">{children}</main>
    </div>
  );
}

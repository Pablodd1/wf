import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Eye, Sparkles, DollarSign, Users, Shield, Search } from 'lucide-react';

interface TabNavProps {
  totalProcessed?: number;
}

export function TabNav({ totalProcessed }: TabNavProps) {
  const tabs = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/review', label: 'Review', icon: Eye },
    { to: '/clean', label: 'Clean', icon: Sparkles },
    { to: '/price-research', label: 'Prices', icon: DollarSign },
    { to: '/demand', label: 'Demand', icon: Users },
    { to: '/admin', label: 'Admin', icon: Shield },
  ];

  return (
    <div className="sticky top-14 z-40 bg-bg-card/95 backdrop-blur border-b border-border-default px-5 overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-1 min-w-max">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            target="_blank"
            rel="noopener noreferrer"
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                isActive
                  ? 'text-gold-primary border-gold-primary'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`
            }
          >
            <Icon size={14} />
            {label}
            {to === '/' && totalProcessed !== undefined && (
              <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
                {totalProcessed}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

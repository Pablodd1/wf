import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Eye, Sparkles, DollarSign, Users, Shield, Search } from 'lucide-react';

interface TabNavProps {
  totalProcessed?: number;
}

export function TabNav({ totalProcessed }: TabNavProps) {
  return (
    <div className="sticky top-14 z-40 bg-bg-card/95 backdrop-blur border-b border-border-default px-5 overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-1 min-w-max">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <LayoutDashboard size={14} />
          Dashboard
          {totalProcessed !== undefined && (
            <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
              {totalProcessed}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/search"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Search size={14} />
          Search
        </NavLink>

        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <BarChart3 size={14} />
          Analytics
        </NavLink>

        <NavLink
          to="/review"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Eye size={14} />
          Review
        </NavLink>

        <NavLink
          to="/clean"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Sparkles size={14} />
          Clean
        </NavLink>

        <NavLink
          to="/price-research"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <DollarSign size={14} />
          Prices
        </NavLink>

        <NavLink
          to="/demand"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Users size={14} />
          Demand
        </NavLink>

        <NavLink
          to="/admin"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Shield size={14} />
          Admin
        </NavLink>
      </div>
    </div>
  );
}

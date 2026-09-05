import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Eye, Shield, DollarSign, Users, ShoppingBag, Layers3 } from 'lucide-react';

interface TabNavProps {
  totalProcessed?: number;
}

export function TabNav({ totalProcessed }: TabNavProps) {
  return (
    <div className="sticky top-14 z-40 bg-bg-card/95 backdrop-blur border-b border-border-default px-5 overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-1 min-w-max">
        <NavLink
          to="/dashboard"
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
          {typeof totalProcessed === 'number' && <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">{totalProcessed.toLocaleString()}</span>}
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Full Report
          </span>
        </NavLink>

        <NavLink
          to="/review-queue"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Eye size={14} />
          Review Queue
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Human-in-Loop
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Research
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            WTB/NTQ
          </span>
        </NavLink>

        <NavLink
          to="/trading"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <ShoppingBag size={14} />
          Trading
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Floor
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Owner
          </span>
        </NavLink>

        <NavLink
          to="/multi-listings"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Layers3 size={14} />
          Multi Listings
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">Split Review</span>
        </NavLink>
      </div>
    </div>
  );
}

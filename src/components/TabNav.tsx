import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Eye, Sparkles, BookOpen, Cpu, RefreshCw, Shield, DollarSign, Users, Search } from 'lucide-react';

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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            {totalProcessed}
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Find
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Human-in-Loop
          </span>
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
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Manual Analysis
          </span>
        </NavLink>

        <NavLink
          to="/reprocess"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <RefreshCw size={14} />
          Reprocess
          <span className="text-[9px] bg-purple-900/40 text-purple-300 border border-purple-700 px-1.5 py-0.5 rounded ml-1">
            78k records
          </span>
        </NavLink>

        <NavLink
          to="/study"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <BookOpen size={14} />
          Study
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Step-by-Step
          </span>
        </NavLink>

        <NavLink
          to="/demo"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Cpu size={14} />
          Parsing
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Engine Demo
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
          to="/insight"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-gold-primary border-gold-primary'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Search size={14} />
          Insight
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Details
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
      </div>
    </div>
  );
}

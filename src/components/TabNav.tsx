import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Microscope } from 'lucide-react';

interface TabNavProps {
  totalProcessed: number;
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
          to="/clean"
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? 'text-emerald-400 border-emerald-400'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`
          }
        >
          <Microscope size={14} />
          Clean Analysis
          <span className="text-[9px] bg-bg-elevated text-text-muted px-1.5 py-0.5 rounded ml-1">
            Manual
          </span>
        </NavLink>
      </div>
    </div>
  );
}

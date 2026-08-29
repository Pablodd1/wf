import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  backTo?: string;
  backLabel?: string;
  className?: string;
  dark?: boolean;
}

export function Breadcrumb({
  items = [],
  backTo,
  backLabel,
  className = '',
  dark = false,
}: BreadcrumbProps) {
  const navigate = useNavigate();

  const effectiveBackTo = backTo || (items.length > 1 && items[items.length - 2]?.to) || '/trading';
  const effectiveBackLabel = backLabel || (items.length > 1 && items[items.length - 2]?.label ? `Back to ${items[items.length - 2].label}` : 'Back');

  const textColor = dark ? 'text-white/60' : 'text-slate-500';
  const textHover = dark ? 'hover:text-white' : 'hover:text-slate-900';
  const activeColor = dark ? 'text-white font-medium' : 'text-slate-900 font-medium';
  const backBg = dark 
    ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white/80 hover:text-white' 
    : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700 hover:text-slate-900';

  return (
    <nav aria-label="Breadcrumb navigation" className={`flex flex-wrap items-center justify-between gap-3 text-xs ${className}`}>
      {/* Back Button */}
      <button
        type="button"
        onClick={() => {
          if (effectiveBackTo) {
            navigate(effectiveBackTo);
          } else {
            navigate(-1);
          }
        }}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${backBg}`}
      >
        <ArrowLeft size={14} />
        <span>{effectiveBackLabel}</span>
      </button>

      {/* Path Hierarchy */}
      {items.length > 0 && (
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={index} className="flex items-center gap-1.5">
                {index > 0 && (
                  <ChevronRight size={12} className={dark ? 'text-white/30' : 'text-slate-400'} aria-hidden="true" />
                )}
                {isLast || !item.to ? (
                  <span className={activeColor} aria-current={isLast ? 'page' : undefined}>
                    {item.label}
                  </span>
                ) : (
                  <Link to={item.to} className={`transition-colors ${textColor} ${textHover}`}>
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}

export default Breadcrumb;

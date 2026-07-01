import { Activity, Shield, Zap, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface StatsBarProps {
  totalProcessed: number;
  autoApproveRate: number;
  mlAvgTime: number;
  residueRate: number;
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.08,
      duration: 0.4,
      ease: [0, 0, 0.2, 1] as [number, number, number, number],
    },
  }),
};

export function StatsBar({ totalProcessed, autoApproveRate, mlAvgTime, residueRate }: StatsBarProps) {
  const stats = [
    {
      icon: Activity,
      iconColor: 'text-gold-primary',
      label: 'RECORDS PROCESSED',
      value: totalProcessed.toLocaleString(),
      valueColor: 'text-text-primary',
    },
    {
      icon: Shield,
      iconColor: 'text-info',
      label: 'AUTO-APPROVE RATE',
      value: `${autoApproveRate}%`,
      subtitle: 'Passed confidence threshold (not ground-truth accuracy)',
      valueColor: 'text-info',
    },
    {
      icon: Zap,
      iconColor: 'text-purple',
      label: 'ML INFERENCE AVG',
      value: `${mlAvgTime}ms`,
      valueColor: 'text-purple',
    },
    {
      icon: AlertTriangle,
      iconColor: 'text-warning',
      label: 'RESIDUE RATE',
      value: `${residueRate}%`,
      valueColor: 'text-warning',
    },
  ];

  return (
    <div className="sticky top-14 z-40 h-[88px] bg-bg-primary border-b border-border-default px-5 py-3">
      <div className="flex gap-3 h-full">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={itemVariants}
              className="flex-1 bg-bg-card border border-border-default rounded-md p-3 flex flex-col justify-between"
            >
              <div className="flex items-center gap-2">
                <Icon size={18} className={stat.iconColor} />
                <span className="text-xs text-muted uppercase tracking-[0.06em]">
                  {stat.label}
                </span>
              </div>
              <span className={`text-lg font-bold ${stat.valueColor} leading-none mt-1`}>
                {stat.value}
              </span>
              {stat.subtitle && (
                <span className="text-xs text-muted mt-0.5 leading-tight" title={stat.subtitle}>
                  {stat.subtitle}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

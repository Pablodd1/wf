import { useEffect, useState } from 'react';

interface ConfidenceRingProps {
  percentage: number;
  size?: number;
}

export function ConfidenceRing({ percentage, size = 36 }: ConfidenceRingProps) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedPct / 100) * circumference;

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPct(Math.round(percentage)), 50);
    return () => clearTimeout(timer);
  }, [percentage]);

  const color = animatedPct >= 80 ? '#22C55E' : animatedPct >= 50 ? '#F59E0B' : '#EF4444';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#1E1E2E"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
        fontWeight={600}
      >
        {animatedPct}%
      </text>
    </svg>
  );
}

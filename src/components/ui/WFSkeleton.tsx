/**
 * WatchFacts Skeleton / Loading State Components
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function WFSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[#1E1E2E]',
        className
      )}
    />
  );
}

export function WFSkeletonCard() {
  return (
    <div className="bg-[#16161F] border border-[#1E1E2E] rounded-[14px] overflow-hidden">
      <div className="aspect-square bg-[#1E1E2E] animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <WFSkeleton className="h-3 w-16" />
          <WFSkeleton className="h-3 w-12" />
        </div>
        <WFSkeleton className="h-4 w-3/4" />
        <WFSkeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-1">
          <WFSkeleton className="h-5 w-20" />
          <WFSkeleton className="h-3 w-14" />
        </div>
        <WFSkeleton className="h-9 w-full rounded-full" />
      </div>
    </div>
  );
}

export function WFSkeletonStat() {
  return (
    <div className="bg-[#16161F] border border-[#1E1E2E] rounded-[14px] p-5">
      <WFSkeleton className="h-3 w-20 mb-2" />
      <WFSkeleton className="h-8 w-28" />
    </div>
  );
}

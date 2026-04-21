import type { GoalPriority } from '@/types/models';

export interface PriorityConfig {
  icon: string;
  bgClass: string;
  textClass: string;
}

/** Ordered list of priorities, highest-to-lowest. */
export const PRIORITY_ORDER: GoalPriority[] = ['critical', 'high', 'medium', 'low'];

/** Sort rank for priority-based ordering (lower = higher priority). */
export const PRIORITY_RANK: Record<GoalPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CONFIGS: Record<GoalPriority, PriorityConfig> = {
  critical: {
    icon: '🔥',
    bgClass: 'bg-[var(--tint-orange-15)]',
    textClass: 'text-primary-500',
  },
  high: {
    icon: '⬆️',
    bgClass: 'bg-[rgba(230,126,34,0.1)]',
    textClass: 'text-terracotta-500',
  },
  medium: {
    icon: '➡️',
    bgClass: 'bg-[var(--tint-silk-20)]',
    textClass: 'text-[#5B9BD5]',
  },
  low: {
    icon: '⬇️',
    bgClass: 'bg-[var(--tint-slate-5)]',
    textClass: 'text-secondary-400',
  },
};

/**
 * Visual styling + icon for a goal's priority chip/pill. Safe against
 * malformed data — unknown priority values return the low-priority config
 * and log a warning so the data-health signal surfaces to developers.
 */
export function getPriorityConfig(priority: string): PriorityConfig {
  if (priority in CONFIGS) {
    return CONFIGS[priority as GoalPriority];
  }
  console.warn('[goalDisplay] unknown priority, defaulting to low:', priority);
  return CONFIGS.low;
}

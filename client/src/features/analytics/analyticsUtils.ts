import { format, subDays } from "date-fns";
import type { AnalyticsSummary, Platform } from "@socmedia/shared";
import { PLATFORM_SPECS } from "@socmedia/shared";

/** Pure helpers for the Analytics page — kept dependency-free so they're trivial to unit test. */

export type RangePreset = "7d" | "30d" | "90d";

export const RANGE_PRESETS: { id: RangePreset; label: string; days: number }[] = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
];

/** Inclusive [from, to] window of `days` days ending today, formatted YYYY-MM-DD. */
export function rangeFor(preset: RangePreset, now: Date = new Date()): { from: string; to: string } {
  const days = RANGE_PRESETS.find((p) => p.id === preset)?.days ?? 30;
  return {
    from: format(subDays(now, days - 1), "yyyy-MM-dd"),
    to: format(now, "yyyy-MM-dd"),
  };
}

export type SummarySeriesPoint = AnalyticsSummary["series"][number];
export type SeriesMetricKey = "impressions" | "engagement" | "followers";

/** brand colour to use for a platform series/legend — TikTok's near-black swapped for readability. */
export function platformColor(platform: Platform): string {
  return platform === "tiktok" ? "#f0eef3" : PLATFORM_SPECS[platform].color;
}

function sortedDates(series: { date: string }[]): string[] {
  return [...new Set(series.map((s) => s.date))].sort();
}

/** Sums `key` across platforms for every date present in the series, in date order. */
export function sumByDate(series: SummarySeriesPoint[], key: SeriesMetricKey): { date: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const row of series) totals.set(row.date, (totals.get(row.date) ?? 0) + row[key]);
  return sortedDates(series).map((date) => ({ date, value: totals.get(date) ?? 0 }));
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const avg = (values: number[]) => (values.length ? sum(values) / values.length : 0);

/**
 * Splits a value series into an earlier ("previous") and later ("current") half and computes
 * the percentage change between them. Flow metrics (impressions, engagement) are summed within
 * each half; the followers stock metric is averaged instead of summed.
 */
export function kpiDelta(series: SummarySeriesPoint[], key: SeriesMetricKey): { current: number; previous: number; deltaPct: number } {
  const points = sumByDate(series, key);
  if (points.length === 0) return { current: 0, previous: 0, deltaPct: 0 };
  const reduce = key === "followers" ? avg : sum;
  const mid = Math.ceil(points.length / 2);
  const firstHalf = points.slice(0, mid).map((p) => p.value);
  const secondHalf = points.slice(mid).map((p) => p.value);
  const previous = reduce(firstHalf);
  const current = secondHalf.length ? reduce(secondHalf) : previous;
  const deltaPct = previous === 0 ? (current === 0 ? 0 : 1) : (current - previous) / previous;
  return { current, previous, deltaPct };
}

/** Generic delta helper for series computed outside of AnalyticsSummary (e.g. raw MetricSnapshot sums). */
export function deltaFromValues(values: number[], reduce: (values: number[]) => number = sum): { current: number; previous: number; deltaPct: number } {
  if (values.length === 0) return { current: 0, previous: 0, deltaPct: 0 };
  const mid = Math.ceil(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const previous = reduce(firstHalf);
  const current = secondHalf.length ? reduce(secondHalf) : previous;
  const deltaPct = previous === 0 ? (current === 0 ? 0 : 1) : (current - previous) / previous;
  return { current, previous, deltaPct };
}

export type PivotRow = { date: string } & Partial<Record<Platform, number>>;

/** Pivots the flat per-platform series into one row per date with a column per platform, e.g. for stacked charts. */
export function seriesByDate(series: SummarySeriesPoint[], metric: SeriesMetricKey = "impressions"): PivotRow[] {
  const map = new Map<string, PivotRow>();
  for (const row of series) {
    const entry = map.get(row.date) ?? { date: row.date };
    entry[row.platform] = (entry[row.platform] ?? 0) + row[metric];
    map.set(row.date, entry);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Total engagement (likes + comments + shares + saves) for a totals-shaped object. */
export function engagementOf(t: { likes: number; comments: number; shares: number; saves: number }): number {
  return t.likes + t.comments + t.shares + t.saves;
}

/** Per-date engagement rate (engagement / impressions) derived purely from the series. */
export function engagementRateByDate(series: SummarySeriesPoint[]): { date: string; value: number }[] {
  const impressions = sumByDate(series, "impressions");
  const engagement = sumByDate(series, "engagement");
  return impressions.map((row, i) => ({ date: row.date, value: row.value > 0 ? (engagement[i]?.value ?? 0) / row.value : 0 }));
}

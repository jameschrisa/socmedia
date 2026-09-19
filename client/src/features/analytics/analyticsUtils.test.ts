import { describe, expect, it } from "vitest";
import type { AnalyticsSummary } from "@socmedia/shared";
import { engagementOf, kpiDelta, rangeFor, seriesByDate, sumByDate, type SummarySeriesPoint } from "./analyticsUtils";

type Series = AnalyticsSummary["series"];

function point(date: string, platform: SummarySeriesPoint["platform"], overrides: Partial<SummarySeriesPoint> = {}): SummarySeriesPoint {
  return { date, platform, impressions: 0, engagement: 0, followers: 0, ...overrides };
}

describe("rangeFor", () => {
  it("returns a 7-day inclusive window", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const { from, to } = rangeFor("7d", now);
    expect(to).toBe("2026-09-17");
    expect(from).toBe("2026-09-11");
  });

  it("returns a 30-day inclusive window", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const { from, to } = rangeFor("30d", now);
    expect(to).toBe("2026-09-17");
    expect(from).toBe("2026-08-19");
  });

  it("returns a 90-day inclusive window", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const { from, to } = rangeFor("90d", now);
    expect(to).toBe("2026-09-17");
    expect(from).toBe("2026-06-20");
  });
});

describe("kpiDelta", () => {
  it("sums flow metrics across the two halves of the range", () => {
    const series: Series = [
      point("2026-09-01", "tiktok", { impressions: 100 }),
      point("2026-09-02", "tiktok", { impressions: 100 }),
      point("2026-09-03", "tiktok", { impressions: 200 }),
      point("2026-09-04", "tiktok", { impressions: 200 }),
    ];
    const { previous, current, deltaPct } = kpiDelta(series, "impressions");
    expect(previous).toBe(200);
    expect(current).toBe(400);
    expect(deltaPct).toBeCloseTo(1);
  });

  it("averages the followers stock metric instead of summing", () => {
    const series: Series = [
      point("2026-09-01", "tiktok", { followers: 100 }),
      point("2026-09-02", "tiktok", { followers: 110 }),
      point("2026-09-03", "tiktok", { followers: 120 }),
      point("2026-09-04", "tiktok", { followers: 130 }),
    ];
    const { previous, current } = kpiDelta(series, "followers");
    expect(previous).toBe(105);
    expect(current).toBe(125);
  });

  it("handles a zero previous value without dividing by zero", () => {
    const series: Series = [
      point("2026-09-01", "tiktok", { impressions: 0 }),
      point("2026-09-02", "tiktok", { impressions: 50 }),
    ];
    const { previous, deltaPct } = kpiDelta(series, "impressions");
    expect(previous).toBe(0);
    expect(deltaPct).toBe(1);
  });

  it("reports zero delta when both halves are zero", () => {
    const series: Series = [point("2026-09-01", "tiktok", { impressions: 0 }), point("2026-09-02", "tiktok", { impressions: 0 })];
    expect(kpiDelta(series, "impressions").deltaPct).toBe(0);
  });

  it("returns zeroes for an empty series", () => {
    expect(kpiDelta([], "impressions")).toEqual({ current: 0, previous: 0, deltaPct: 0 });
  });
});

describe("sumByDate", () => {
  it("sums a metric across platforms per date, sorted ascending", () => {
    const series: Series = [
      point("2026-09-02", "tiktok", { impressions: 10 }),
      point("2026-09-01", "tiktok", { impressions: 5 }),
      point("2026-09-01", "youtube", { impressions: 7 }),
    ];
    expect(sumByDate(series, "impressions")).toEqual([
      { date: "2026-09-01", value: 12 },
      { date: "2026-09-02", value: 10 },
    ]);
  });
});

describe("seriesByDate", () => {
  it("pivots the flat per-platform series into one row per date with a column per platform", () => {
    const series: Series = [
      point("2026-09-01", "tiktok", { impressions: 10 }),
      point("2026-09-01", "youtube", { impressions: 20 }),
      point("2026-09-02", "tiktok", { impressions: 15 }),
    ];
    const pivot = seriesByDate(series);
    expect(pivot).toEqual([
      { date: "2026-09-01", tiktok: 10, youtube: 20 },
      { date: "2026-09-02", tiktok: 15 },
    ]);
  });

  it("pivots a different metric when requested", () => {
    const series: Series = [point("2026-09-01", "tiktok", { impressions: 10, followers: 500 })];
    expect(seriesByDate(series, "followers")).toEqual([{ date: "2026-09-01", tiktok: 500 }]);
  });
});

describe("engagementOf", () => {
  it("sums likes, comments, shares and saves", () => {
    expect(engagementOf({ likes: 10, comments: 2, shares: 3, saves: 1 })).toBe(16);
  });
});

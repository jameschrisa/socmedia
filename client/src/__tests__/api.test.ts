import { describe, it, expect, beforeEach } from "vitest";
import { api, ApiError } from "@/lib/api";
import { mockFetch } from "@/test-utils";
import { useAppStore } from "@/store/appStore";

describe("api client", () => {
  beforeEach(() => useAppStore.setState({ currentOrgId: "org-xyz" }));

  it("sends the org header on org-scoped requests only", async () => {
    const { fn } = mockFetch({ "GET /api/connections": () => [], "GET /api/orgs": () => [] });
    await api.connections.list();
    await api.orgs.list();
    const [connCall, orgCall] = fn.mock.calls;
    expect((connCall![1] as RequestInit).headers).toMatchObject({ "X-Org-Id": "org-xyz" });
    expect((orgCall![1] as RequestInit).headers).not.toHaveProperty("X-Org-Id");
  });

  it("serialises JSON bodies and query params", async () => {
    const { calls } = mockFetch({ "POST /api/posts": () => ({ id: "p1" }), "GET /api/posts": () => [] });
    await api.posts.create({ title: "t", caption: "c", hashtags: [], mediaIds: [], targets: [], timezone: "UTC", publishMode: "all", queueSpacingMinutes: 10, labels: [], notes: "" });
    await api.posts.list({ from: "2026-09-01", to: "2026-09-30", status: ["draft", "scheduled"] });
    expect((calls[0]!.body as any).title).toBe("t");
    expect(calls[1]!.url).toContain("from=2026-09-01");
    expect(calls[1]!.url).toContain("status=draft%2Cscheduled");
  });

  it("throws ApiError with server message and details", async () => {
    mockFetch({ "POST /api/posts/:id/schedule": () => new Response(JSON.stringify({ error: "Post has validation errors", issues: [{ level: "error", message: "x" }] }), { status: 400 }) });
    await expect(api.posts.schedule("p1", "2026-01-01T00:00:00Z")).rejects.toMatchObject({ status: 400, message: "Post has validation errors" });
    try { await api.posts.schedule("p1", "2026-01-01T00:00:00Z"); } catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).details).toHaveLength(1); }
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch({ "DELETE /api/posts/:id": () => undefined });
    await expect(api.posts.remove("p1")).resolves.toBeUndefined();
  });
});

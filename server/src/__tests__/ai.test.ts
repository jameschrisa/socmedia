import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_SPECS } from "@socmedia/shared";
import { cleanupTestContext, createTestContext, type TestContext } from "./testApp";

describe("ai (mock mode)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it("captions: returns per-platform variants within each platform's length limits", async () => {
    const platforms = ["tiktok", "youtube", "linkedin", "instagram"];
    const res = await request(ctx.app)
      .post("/api/ai/captions")
      .set("X-Org-Id", ctx.orgId)
      .send({ brief: "Announcing our new tax-planning webinar for small business owners", platforms, tone: "professional", variants: 1 });

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.variants).toHaveLength(platforms.length);

    for (const variant of res.body.variants) {
      const spec = PLATFORM_SPECS[variant.platform as keyof typeof PLATFORM_SPECS];
      expect(variant.caption.length).toBeLessThanOrEqual(spec.captionMaxLength);
      expect(variant.hashtags.length).toBeLessThanOrEqual(spec.hashtagLimit);
      expect(variant.charCount).toBe(variant.caption.length);
      if (variant.platform === "youtube") {
        expect(variant.title).toBeTruthy();
        expect(variant.title.length).toBeLessThanOrEqual(spec.titleMaxLength ?? 100);
      }
    }
  });

  it("ideas: returns the requested number of ideas with a full outline", async () => {
    const res = await request(ctx.app)
      .post("/api/ai/ideas")
      .set("X-Org-Id", ctx.orgId)
      .send({ topic: "Roth IRA conversions", platforms: ["tiktok", "linkedin"], count: 4 });

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.ideas).toHaveLength(4);
    for (const idea of res.body.ideas) {
      expect(idea.title).toBeTruthy();
      expect(idea.hook).toBeTruthy();
      expect(Array.isArray(idea.outline)).toBe(true);
      expect(idea.outline.length).toBeGreaterThan(0);
      expect(["tiktok", "linkedin"]).toContain(idea.platform);
    }
  });

  it("improve: returns an improved caption and hashtags", async () => {
    const res = await request(ctx.app)
      .post("/api/ai/improve")
      .set("X-Org-Id", ctx.orgId)
      .send({ caption: "we do taxes", platform: "linkedin", instruction: "Make it more engaging with a call to action" });

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(typeof res.body.caption).toBe("string");
    expect(res.body.caption.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.hashtags)).toBe(true);
  });

  it("hashtags: suggests hashtags scoped to the platform's limit", async () => {
    const res = await request(ctx.app)
      .post("/api/ai/hashtags")
      .set("X-Org-Id", ctx.orgId)
      .send({ caption: "Year end tax planning tips for business owners", platform: "linkedin", count: 5 });

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.hashtags.length).toBeLessThanOrEqual(5);
    expect(res.body.hashtags.length).toBeLessThanOrEqual(PLATFORM_SPECS.linkedin.hashtagLimit);
  });

  it("rejects invalid caption requests with 400", async () => {
    const res = await request(ctx.app).post("/api/ai/captions").set("X-Org-Id", ctx.orgId).send({ brief: "", platforms: [] });
    expect(res.status).toBe(400);
  });
});

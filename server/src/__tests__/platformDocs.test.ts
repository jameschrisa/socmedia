import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { platformDocsStatus, reloadPlatformDocs, searchPlatformDocs, setPlatformDocsRoot } from "../services/platformDocs";

const YOUTUBE_OAUTH_MD = `---
platform: youtube
topic: oauth
sources:
  - https://example.com/youtube-oauth
fetched: 2026-09-19
---

# YouTube OAuth (fixture)

Intro paragraph about YouTube OAuth for suprstar tests.

## OAuth token errors

When the refresh token is invalid, YouTube returns invalid_grant with error_description "Token expired or invalidated". Reconnect the account to fix the invalid_grant error.

## Scopes

suprstar requests youtube.readonly and youtube.upload scopes.
`;

const TIKTOK_PUBLISHING_MD = `---
platform: tiktok
topic: publishing
sources:
  - https://example.com/tiktok-publishing
fetched: 2026-09-19
---

# TikTok publishing (fixture)

## Upload limits

Videos must be under 10 minutes. TikTok does not use invalid_grant; that is unrelated here.

## Direct post

Uses the direct post endpoint for approved apps.
`;

describe("platform docs indexer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-docs-test-"));
    fs.mkdirSync(path.join(tmpDir, "youtube"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tiktok"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "youtube", "oauth.md"), YOUTUBE_OAUTH_MD);
    fs.writeFileSync(path.join(tmpDir, "tiktok", "publishing.md"), TIKTOK_PUBLISHING_MD);
    setPlatformDocsRoot(tmpDir);
    reloadPlatformDocs();
  });

  afterEach(() => {
    setPlatformDocsRoot(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses front matter and splits sections on ## / ### headings", () => {
    const status = platformDocsStatus();
    expect(status.files).toBe(2);
    expect(status.platforms).toEqual(["tiktok", "youtube"]);
    // youtube/oauth.md: an "Overview" preamble (intro paragraph) + "OAuth token errors" + "Scopes" = 3
    // tiktok/publishing.md: "Upload limits" + "Direct post" = 2
    expect(status.sections).toBe(5);
  });

  it("attaches the front matter's sources and topic to hits", () => {
    const hits = searchPlatformDocs({ query: "invalid_grant" });
    expect(hits[0].topic).toBe("oauth");
    expect(hits[0].sources).toEqual(["https://example.com/youtube-oauth"]);
    expect(hits[0].file).toMatch(/youtube[/\\]oauth\.md$/);
  });

  it('ranks the section that actually discusses "invalid_grant" first', () => {
    const hits = searchPlatformDocs({ query: "invalid_grant" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].heading).toBe("OAuth token errors");
    expect(hits[0].platform).toBe("youtube");
    expect(hits[0].excerpt).toContain("invalid_grant");
  });

  it("boosts hits whose platform matches the requested platform", () => {
    const unfiltered = searchPlatformDocs({ query: "invalid_grant" });
    expect(unfiltered[0].platform).toBe("youtube");

    const tiktokFiltered = searchPlatformDocs({ query: "invalid_grant", platform: "tiktok" });
    expect(tiktokFiltered[0].platform).toBe("tiktok");
    expect(tiktokFiltered[0].heading).toBe("Upload limits");
  });

  it("returns nothing for a query that matches no tokens", () => {
    const hits = searchPlatformDocs({ query: "zzz_no_such_token_zzz" });
    expect(hits).toEqual([]);
  });

  it("tolerates an empty docs folder", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-docs-empty-"));
    setPlatformDocsRoot(emptyDir);
    reloadPlatformDocs();
    expect(platformDocsStatus()).toEqual({ files: 0, sections: 0, platforms: [] });
    expect(searchPlatformDocs({ query: "invalid_grant" })).toEqual([]);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("tolerates a missing docs folder", () => {
    setPlatformDocsRoot(path.join(tmpDir, "does-not-exist"));
    reloadPlatformDocs();
    expect(platformDocsStatus()).toEqual({ files: 0, sections: 0, platforms: [] });
    expect(searchPlatformDocs({ query: "invalid_grant" })).toEqual([]);
  });
});

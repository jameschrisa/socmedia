import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Platform, PlatformDocHit } from "@socmedia/shared";

/** Error codes / short tokens worth indexing even though they would otherwise fall under the 3-char minimum. */
const KNOWN_SHORT_TOKENS = new Set(["429", "400", "401", "403", "404", "409", "429", "500", "502", "503"]);

interface ParsedFrontMatter {
  data: Record<string, unknown>;
  body: string;
}

/** Tiny YAML-subset parser: `key: value` and `key:\n  - item` lists only — everything our docs front matter uses. */
function parseFrontMatter(raw: string): ParsedFrontMatter {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const closingIdx = raw.indexOf("\n---", 3);
  if (closingIdx === -1) return { data: {}, body: raw };
  const fmBlock = raw.slice(3, closingIdx).trim();
  const body = raw.slice(closingIdx + 4).replace(/^\r?\n/, "");

  const data: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  for (const rawLine of fmBlock.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      const arr = data[currentListKey];
      if (Array.isArray(arr)) arr.push(stripQuotes(listItem[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === "") {
      data[key] = [];
      currentListKey = key;
    } else {
      data[key] = stripQuotes(rest.trim());
      currentListKey = null;
    }
  }
  return { data, body };
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

interface RawSection {
  heading: string;
  level: number;
  text: string;
}

/** Splits a doc body into sections on `##`/`###` headings; content before the first heading (if any, past the H1) becomes an "Overview" section. */
function splitSections(body: string): RawSection[] {
  const lines = body.split(/\r?\n/);
  const sections: RawSection[] = [];
  let current: { heading: string; level: number; text: string[] } | null = null;
  let preamble: string[] = [];
  let h1: string | null = null;

  for (const line of lines) {
    const heading = line.match(/^(##|###)\s+(.*)$/);
    const h1Match = line.match(/^#\s+(.*)$/);
    if (heading) {
      if (current) sections.push({ heading: current.heading, level: current.level, text: current.text.join("\n").trim() });
      current = { heading: heading[2].trim(), level: heading[1].length, text: [] };
    } else if (h1Match && !current) {
      h1 = h1Match[1].trim();
    } else if (current) {
      current.text.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, level: current.level, text: current.text.join("\n").trim() });

  const preambleText = preamble.join("\n").trim();
  if (preambleText) {
    sections.unshift({ heading: h1 ?? "Overview", level: 1, text: preambleText });
  }
  return sections;
}

/** Lowercase, punctuation-stripped tokens ≥3 chars (plus a few short but meaningful codes like "429"). */
function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return matches.filter((t) => t.length >= 3 || KNOWN_SHORT_TOKENS.has(t));
}

interface IndexedSection {
  platform: string;
  topic: string;
  file: string;
  heading: string;
  text: string;
  sources: string[];
  termFreq: Map<string, number>;
  length: number;
}

interface DocIndex {
  sections: IndexedSection[];
  docFreq: Map<string, number>;
  avgLength: number;
  fileCount: number;
  platforms: Set<string>;
}

let overrideRoot: string | null = null;
let cachedIndex: DocIndex | null = null;

/** Test hook: point the indexer at a fixture folder instead of the repo's docs/platforms. Pass null to restore auto-detection. */
export function setPlatformDocsRoot(root: string | null): void {
  overrideRoot = root;
  cachedIndex = null;
}

function resolveDocsRoot(): string {
  if (overrideRoot) return overrideRoot;
  const here = path.dirname(fileURLToPath(import.meta.url)); // server/src/services
  const candidates = [
    path.resolve(here, "../../../docs/platforms"), // repo root/docs/platforms (normal dev/build layout)
    path.resolve(here, "../../docs/platforms"),
    path.resolve(process.cwd(), "docs/platforms"),
    path.resolve(process.cwd(), "../docs/platforms"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

function listMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Best-effort repo-relative display path (`docs/platforms/tiktok/oauth.md`), falling back to root-relative for fixture roots in tests. */
function toDisplayPath(root: string, file: string): string {
  const repoRootGuess = path.dirname(path.dirname(root));
  const guess = path.relative(repoRootGuess, file);
  if (!guess.startsWith("..")) return guess.split(path.sep).join("/");
  return path.relative(root, file).split(path.sep).join("/");
}

function buildIndex(): DocIndex {
  const root = resolveDocsRoot();
  const files = listMarkdownFiles(root);
  const sections: IndexedSection[] = [];
  const platforms = new Set<string>();

  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontMatter(raw);
    const platform = typeof data.platform === "string" && data.platform ? data.platform : "general";
    const topic = typeof data.topic === "string" ? data.topic : "";
    const sources = Array.isArray(data.sources) ? (data.sources as string[]).filter((s) => typeof s === "string") : [];
    if (platform !== "all" && platform !== "general") platforms.add(platform);
    const displayFile = toDisplayPath(root, file);

    for (const raw_ of splitSections(body)) {
      const tokens = tokenize(`${raw_.heading}\n${raw_.text}`);
      const termFreq = new Map<string, number>();
      for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      sections.push({
        platform,
        topic,
        file: displayFile,
        heading: raw_.heading,
        text: raw_.text,
        sources,
        termFreq,
        length: tokens.length,
      });
    }
  }

  const docFreq = new Map<string, number>();
  for (const sec of sections) {
    for (const t of sec.termFreq.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const avgLength = sections.length ? sections.reduce((sum, s) => sum + s.length, 0) / sections.length : 0;

  return { sections, docFreq, avgLength, fileCount: files.length, platforms };
}

function getIndex(): DocIndex {
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

/** Forces a fresh scan of the docs folder (tests, or after docs are edited without restarting the server). */
export function reloadPlatformDocs(): void {
  cachedIndex = null;
  getIndex();
}

export function platformDocsStatus(): { files: number; sections: number; platforms: string[] } {
  const idx = getIndex();
  return { files: idx.fileCount, sections: idx.sections.length, platforms: [...idx.platforms].sort() };
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const EXCERPT_MAX_CHARS = 900;

/** Trims `text` to ~900 chars, centred on whichever line best matches the query tokens. */
function buildExcerpt(text: string, queryTokens: string[]): string {
  const trimmedFull = text.trim();
  if (trimmedFull.length <= EXCERPT_MAX_CHARS) return trimmedFull;

  const tokenSet = new Set(queryTokens);
  const lines = trimmedFull.split(/\r?\n/);
  let bestIdx = 0;
  let bestHits = -1;
  let offset = 0;
  let bestOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const hits = tokenize(lines[i]).filter((t) => tokenSet.has(t)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestIdx = i;
      bestOffset = offset;
    }
    offset += lines[i].length + 1;
  }
  void bestIdx;

  const start = Math.max(0, bestOffset - Math.floor(EXCERPT_MAX_CHARS / 3));
  const end = Math.min(trimmedFull.length, start + EXCERPT_MAX_CHARS);
  let excerpt = trimmedFull.slice(start, end).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < trimmedFull.length) excerpt = `${excerpt}…`;
  return excerpt;
}

export interface SearchPlatformDocsOptions {
  platform?: string;
  query: string;
  limit?: number;
}

/**
 * Keyword search across every indexed doc section: BM25-ish tf-idf scoring, boosted when the
 * section's platform matches `platform` and when a query token appears in the section's heading.
 */
export function searchPlatformDocs(opts: SearchPlatformDocsOptions): PlatformDocHit[] {
  const idx = getIndex();
  const queryTokens = [...new Set(tokenize(opts.query))];
  if (queryTokens.length === 0 || idx.sections.length === 0) return [];
  const limit = opts.limit ?? 5;
  const n = idx.sections.length;

  const scored: { sec: IndexedSection; score: number }[] = [];
  for (const sec of idx.sections) {
    let score = 0;
    const headingTokens = new Set(tokenize(sec.heading));
    for (const qt of queryTokens) {
      const tf = sec.termFreq.get(qt) ?? 0;
      if (tf === 0) continue;
      const df = idx.docFreq.get(qt) ?? 1;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * sec.length) / (idx.avgLength || 1));
      let termScore = idf * ((tf * (BM25_K1 + 1)) / denom);
      if (headingTokens.has(qt)) termScore *= 1.5;
      score += termScore;
    }
    if (score <= 0) continue;
    if (opts.platform && sec.platform === opts.platform) score *= 1.6;
    scored.push({ sec, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ sec, score }) => ({
    platform: (sec.platform === "all" ? "general" : sec.platform) as Platform | "general",
    file: sec.file,
    topic: sec.topic,
    heading: sec.heading,
    excerpt: buildExcerpt(sec.text, queryTokens),
    score: Math.round(score * 1000) / 1000,
    sources: sec.sources,
  }));
}

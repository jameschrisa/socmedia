import { PLATFORM_SPECS } from "@socmedia/shared";
import type {
  AiTone,
  CaptionRequestInput,
  CaptionResponse,
  CaptionVariant,
  ContentIdea,
  IdeaRequestInput,
  IdeaResponse,
  ImproveRequestInput,
  Platform,
} from "@socmedia/shared";
import { pick, seededRandom } from "../utils/random";

const MOCK_MODEL = "pulse-mock-v1";

const OPENERS: Record<AiTone, string[]> = {
  professional: ["Here's what you need to know:", "A quick update for our clients:", "Let's break this down clearly:"],
  casual: ["Real talk:", "Quick one for you:", "Let's chat about this:"],
  playful: ["Guess what?", "Plot twist:", "Fun fact incoming:"],
  inspirational: ["Your future self will thank you.", "Small steps, big impact.", "Here's to building something that lasts."],
  educational: ["Today's lesson:", "Let's unpack this:", "Here's a concept worth understanding:"],
  bold: ["Let's be direct:", "No fluff, just facts:", "Here's the truth:"],
};

const CTAS: Record<Platform, string> = {
  tiktok: "Follow for more tips like this.",
  youtube: "Subscribe so you never miss an episode.",
  linkedin: "Connect with us to learn more.",
  instagram: "Save this post and follow for more.",
  x: "Follow along for more like this.",
};

const HASHTAG_POOL: Record<Platform, string[]> = {
  tiktok: ["fyp", "behindthescenes", "howto", "smallbusiness", "newdrop"],
  youtube: ["tutorial", "explained", "behindthescenes", "weeklyupdate", "community"],
  linkedin: ["leadership", "growth", "teamculture", "industryinsights", "b2b"],
  instagram: ["newarrivals", "behindthescenes", "community", "smallbusiness", "inspiration"],
  x: ["news", "thread", "hottake", "update", "community"],
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "your", "you", "are", "our", "from", "into", "about",
  "have", "has", "will", "can", "how", "why", "what", "when", "who", "a", "an", "of", "to", "in", "on",
  "is", "it", "be", "as", "at", "by", "or", "we", "us",
]);

function keywordsFrom(text: string, max = 4): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, max);
}

function buildHashtags(seedText: string, platform: Platform, count: number, rand: () => number): string[] {
  const keywordTags = keywordsFrom(seedText, 4).map((w) => w.replace(/\s+/g, ""));
  const pool = [...HASHTAG_POOL[platform]];
  const combined = [...new Set([...keywordTags, ...pool])];
  const limit = Math.min(count, PLATFORM_SPECS[platform].hashtagLimit, combined.length);
  // deterministic shuffle-ish selection using rand()
  const scored = combined.map((tag) => ({ tag, score: rand() }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, Math.max(1, limit)).map((s) => s.tag);
}

function trimToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function titleCaseFromBrief(brief: string, limit: number): string {
  const firstSentence = brief.split(/[.!?\n]/)[0].trim() || brief.trim();
  const title = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  return trimToLimit(title, limit);
}

export function generateCaptionsMock(input: CaptionRequestInput): CaptionResponse {
  const variants: CaptionVariant[] = [];
  const variantCount = input.variants ?? 2;

  for (const platform of input.platforms) {
    const spec = PLATFORM_SPECS[platform];
    for (let i = 0; i < variantCount; i++) {
      const seed = `${input.brief}|${platform}|${i}`;
      const rand = seededRandom(seed);
      const opener = pick(rand, OPENERS[input.tone]);
      const hook = trimToLimit(`${opener} ${input.brief.trim().split(/[.!?]/)[0]}`.trim(), 140);

      const lines = [hook, "", input.brief.trim()];
      if (input.brandVoice) lines.push("", input.brandVoice.trim());
      if (input.includeCta) lines.push("", CTAS[platform]);
      const caption = trimToLimit(lines.filter((l) => l !== undefined).join("\n").trim(), spec.captionMaxLength);

      const hashtags = input.includeHashtags ? buildHashtags(input.brief, platform, spec.hashtagLimit, rand) : [];

      const variant: CaptionVariant = {
        platform,
        caption,
        hashtags,
        hook,
        charCount: caption.length,
      };
      if (platform === "youtube") {
        variant.title = titleCaseFromBrief(input.brief, spec.titleMaxLength ?? 100);
      }
      variants.push(variant);
    }
  }

  return { variants, model: MOCK_MODEL, mock: true };
}

interface IdeaAngle {
  name: string;
  title: (topic: string) => string;
  hook: (topic: string) => string;
  outline: (topic: string) => string[];
  why: string;
}

const IDEA_ANGLES: IdeaAngle[] = [
  {
    name: "myth-busting",
    title: (t) => `3 myths about ${t}, debunked`,
    hook: (t) => `Everything you think you know about ${t} might be wrong.`,
    outline: (t) => [`Myth 1 about ${t}`, `Myth 2 about ${t}`, `Myth 3 about ${t}`, "What to do instead"],
    why: "Myth-busting content earns high saves and shares because it corrects a belief viewers already hold.",
  },
  {
    name: "checklist",
    title: (t) => `The ${t} checklist nobody gave you`,
    hook: (t) => `Save this before you tackle ${t} again.`,
    outline: (t) => [`Step 1 of ${t}`, "Step 2", "Step 3", "Common mistake to avoid"],
    why: "Checklists are highly saveable and position the brand as a practical, trustworthy resource.",
  },
  {
    name: "case-study",
    title: (t) => `How one client approached ${t}`,
    hook: (t) => `Here's a real (anonymized) example of ${t} done right.`,
    outline: (t) => [`The situation`, `The ${t} strategy`, "The outcome", "The lesson for viewers"],
    why: "Concrete stories build trust faster than abstract advice and invite comments/questions.",
  },
  {
    name: "quick-tip",
    title: (t) => `A 60-second tip on ${t}`,
    hook: (t) => `One small change to how you think about ${t}.`,
    outline: (t) => [`Set up the problem with ${t}`, "Deliver the tip", "Show the payoff"],
    why: "Short, high-value tips perform well for reach and are easy to batch-produce.",
  },
  {
    name: "behind-the-scenes",
    title: (t) => `What we actually do about ${t}`,
    hook: (t) => `Curious what happens behind the scenes with ${t}?`,
    outline: (t) => ["Set the scene", `Walk through ${t} step by step`, "Wrap with a takeaway"],
    why: "Behind-the-scenes content humanizes the brand and builds familiarity/trust over time.",
  },
  {
    name: "q-and-a",
    title: (t) => `Your top questions about ${t}, answered`,
    hook: (t) => `You asked, we're answering: ${t}.`,
    outline: (t) => [`Question 1 about ${t}`, "Question 2", "Question 3", "Where to learn more"],
    why: "Direct answers to real questions drive comments and show responsiveness to the audience.",
  },
];

export function generateIdeasMock(input: IdeaRequestInput): IdeaResponse {
  const count = input.count ?? 6;
  const ideas: ContentIdea[] = [];
  for (let i = 0; i < count; i++) {
    const platform = input.platforms[i % input.platforms.length];
    const spec = PLATFORM_SPECS[platform];
    const seed = `${input.topic}|${platform}|${i}`;
    const rand = seededRandom(seed);
    const angle = pick(rand, IDEA_ANGLES);
    ideas.push({
      title: angle.title(input.topic),
      hook: angle.hook(input.topic),
      format: spec.defaultFormat,
      platform,
      outline: angle.outline(input.topic),
      whyItWorks: angle.why,
    });
  }
  return { ideas, model: MOCK_MODEL, mock: true };
}

export function improveMock(input: ImproveRequestInput): { caption: string; hashtags: string[]; model: string; mock: boolean } {
  const spec = PLATFORM_SPECS[input.platform];
  const rand = seededRandom(`${input.caption}|${input.instruction}`);
  let caption = input.caption.trim();

  const instruction = input.instruction.toLowerCase();
  if (instruction.includes("short")) {
    const sentences = caption.split(/(?<=[.!?])\s+/);
    caption = sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).join(" ");
  }
  if (input.tone) {
    const opener = pick(rand, OPENERS[input.tone]);
    if (!caption.startsWith(opener)) caption = `${opener} ${caption}`;
  }
  if (instruction.includes("cta") || instruction.includes("call to action") || instruction.includes("engaging")) {
    if (!caption.includes(CTAS[input.platform])) caption = `${caption}\n\n${CTAS[input.platform]}`;
  }
  caption = trimToLimit(caption, spec.captionMaxLength);

  const hashtags = buildHashtags(input.caption, input.platform, spec.hashtagLimit, rand);
  return { caption, hashtags, model: MOCK_MODEL, mock: true };
}

export function hashtagsMock(caption: string, platform: Platform, count = 8): { hashtags: string[]; model: string; mock: boolean } {
  const rand = seededRandom(caption);
  return { hashtags: buildHashtags(caption, platform, count, rand), model: MOCK_MODEL, mock: true };
}

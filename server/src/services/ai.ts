// NB: the installed SDK's zodOutputFormat() calls zod v4's `z.toJSONSchema()` on whatever schema
// it is given. Our shared request schemas (shared/src/schemas.ts) are built with classic zod v3
// (`import { z } from "zod"`), which is not understood by that v4 helper. We therefore define the
// *response* schemas used for structured output here with zod's v4 entry point instead. This is a
// deliberate, narrow deviation from "use zod 3 everywhere" and only affects these internal
// output-validation schemas, not the request/shared contract.
import { z } from "zod/v4";
import { PLATFORMS, PLATFORM_SPECS, POST_FORMATS } from "@socmedia/shared";
import type {
  CaptionRequestInput,
  CaptionResponse,
  IdeaRequestInput,
  IdeaResponse,
  ImproveRequestInput,
  Platform,
} from "@socmedia/shared";
import type { Db } from "../db/database";
import { structured } from "./aiProviders";
import { activeProvider } from "./aiSettings";
import * as mock from "./aiMock";

const captionVariantOutputSchema = z.object({
  platform: z.enum(PLATFORMS),
  caption: z.string(),
  hashtags: z.array(z.string()),
  title: z.string().optional(),
  hook: z.string(),
});
const captionOutputSchema = z.object({ variants: z.array(captionVariantOutputSchema) });

const ideaOutputSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      hook: z.string(),
      format: z.enum(POST_FORMATS),
      platform: z.enum(PLATFORMS),
      outline: z.array(z.string()),
      whyItWorks: z.string(),
    })
  ),
});

const improveOutputSchema = z.object({ caption: z.string(), hashtags: z.array(z.string()) });
const hashtagOutputSchema = z.object({ hashtags: z.array(z.string()) });

function systemPrompt(): string {
  const rules = Object.values(PLATFORM_SPECS)
    .map((spec) => {
      const title = spec.titleMaxLength ? ` Titles up to ${spec.titleMaxLength} characters.` : "";
      return `- ${spec.name}: captions up to ${spec.captionMaxLength} characters, up to ${spec.hashtagLimit} hashtags.${title}`;
    })
    .join("\n");
  return [
    "You are Pulse's social media copywriting assistant for a financial and tax-planning marketing team.",
    "Write clear, on-brand, platform-appropriate copy. Never invent specific performance guarantees,",
    "regulatory claims, or financial/legal advice. Keep a trustworthy, professional undertone even when",
    "the requested tone is casual or playful.",
    "",
    "Platform rules:",
    rules,
  ].join("\n");
}

function useMock(db: Db): boolean {
  return activeProvider(db).provider === "mock";
}

export async function generateCaptions(db: Db, input: CaptionRequestInput): Promise<CaptionResponse> {
  if (useMock(db)) return mock.generateCaptionsMock(input);
  const result = await structured(db, {
    schema: captionOutputSchema,
    schemaName: "captions",
    system: systemPrompt(),
    maxTokens: 4000,
    user: [
      `Write ${input.variants ?? 2} caption variant(s) for each of these platforms: ${input.platforms.join(", ")}.`,
      `Brief: ${input.brief}`,
      `Tone: ${input.tone}`,
      input.brandVoice ? `Brand voice notes: ${input.brandVoice}` : "",
      `Language: ${input.language ?? "English"}`,
      input.includeHashtags ? "Include relevant hashtags for each platform." : "Do not include hashtags.",
      input.includeCta ? "Include a short call to action." : "Do not include a call to action.",
      "For any YouTube variant, also produce a short title.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return {
    variants: result.data.variants.map((v) => ({ ...v, charCount: v.caption.length })),
    model: result.model,
    mock: false,
  };
}

export async function generateIdeas(db: Db, input: IdeaRequestInput): Promise<IdeaResponse> {
  if (useMock(db)) return mock.generateIdeasMock(input);
  const result = await structured(db, {
    schema: ideaOutputSchema,
    schemaName: "ideas",
    system: systemPrompt(),
    maxTokens: 4000,
    user: [
      `Generate ${input.count ?? 6} content ideas about: ${input.topic}`,
      `Target platforms: ${input.platforms.join(", ")}`,
      input.audience ? `Audience: ${input.audience}` : "",
      input.brandVoice ? `Brand voice notes: ${input.brandVoice}` : "",
      "For each idea include a title, hook, a recommended post format, target platform, a short outline (3-5 bullets), and why it works.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return { ideas: result.data.ideas, model: result.model, mock: false };
}

export async function improveCaption(db: Db, input: ImproveRequestInput): Promise<{ caption: string; hashtags: string[]; model: string; mock: boolean }> {
  if (useMock(db)) return mock.improveMock(input);
  const result = await structured(db, {
    schema: improveOutputSchema,
    schemaName: "improve",
    system: systemPrompt(),
    maxTokens: 2000,
    user: [
      `Improve this ${input.platform} caption: "${input.caption}"`,
      `Instruction: ${input.instruction}`,
      input.tone ? `Tone: ${input.tone}` : "",
      "Return the improved caption plus a set of relevant hashtags.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return { ...result.data, model: result.model, mock: false };
}

export async function suggestHashtags(db: Db, caption: string, platform: Platform, count = 8): Promise<{ hashtags: string[]; model: string; mock: boolean }> {
  if (useMock(db)) return mock.hashtagsMock(caption, platform, count);
  const result = await structured(db, {
    schema: hashtagOutputSchema,
    schemaName: "hashtags",
    system: systemPrompt(),
    maxTokens: 500,
    user: `Suggest up to ${count} relevant hashtags for this ${platform} caption: "${caption}"`,
  });
  return { ...result.data, model: result.model, mock: false };
}

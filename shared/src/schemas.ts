import { z } from "zod";
import { PLATFORMS, POST_FORMATS } from "./platforms";

export const platformSchema = z.enum(PLATFORMS);
export const postFormatSchema = z.enum(POST_FORMATS);
export const toneSchema = z.enum(["professional", "casual", "playful", "inspirational", "educational", "bold"]);

export const organizationInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6C5CE7"),
  timezone: z.string().min(1).default("UTC"),
  logoUrl: z.string().min(1).max(500).nullable().optional(),
});

export const credentialsInputSchema = z.object({
  clientId: z.string().default(""),
  clientSecret: z.string().default(""),
  redirectUri: z.string().default(""),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  tokenExpiresAt: z.string().nullable().optional(),
  scopes: z.array(z.string()).default([]),
  extra: z.record(z.string()).default({}),
}).partial();

export const settingsInputSchema = z.object({
  defaultFormat: postFormatSchema,
  privacy: z.enum(["public", "private", "unlisted", "friends"]),
  autoHashtags: z.boolean(),
  firstCommentHashtags: z.boolean(),
  allowComments: z.boolean(),
  allowDuet: z.boolean(),
  allowStitch: z.boolean(),
  madeForKids: z.boolean(),
  category: z.string(),
  postAsOrganization: z.boolean(),
  shareToFeed: z.boolean(),
}).partial();

export const connectionUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["sandbox", "live"]).optional(),
  displayName: z.string().max(120).optional(),
  handle: z.string().max(120).optional(),
  avatarUrl: z.string().nullable().optional(),
  credentials: credentialsInputSchema.optional(),
  settings: settingsInputSchema.optional(),
});

export const postTargetSchema = z.object({
  platform: platformSchema,
  connectionId: z.string().min(1),
  format: postFormatSchema,
  mediaIds: z.array(z.string()).default([]),
  caption: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  hashtags: z.array(z.string()).nullable().optional(),
});

export const postInputSchema = z.object({
  title: z.string().max(200).default(""),
  caption: z.string().max(10000).default(""),
  hashtags: z.array(z.string().max(100)).max(60).default([]),
  mediaIds: z.array(z.string()).default([]),
  targets: z.array(postTargetSchema).default([]),
  status: z.enum(["draft", "needs_approval", "approved", "scheduled"]).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().default("UTC"),
  labels: z.array(z.string()).default([]),
  notes: z.string().max(5000).default(""),
});

export const postUpdateSchema = postInputSchema.partial();

export const captionRequestSchema = z.object({
  brief: z.string().min(1).max(4000),
  platforms: z.array(platformSchema).min(1),
  tone: toneSchema.default("professional"),
  brandVoice: z.string().max(2000).optional(),
  includeHashtags: z.boolean().default(true),
  includeCta: z.boolean().default(true),
  language: z.string().default("English"),
  variants: z.number().int().min(1).max(5).default(2),
});

export const ideaRequestSchema = z.object({
  topic: z.string().min(1).max(2000),
  platforms: z.array(platformSchema).min(1),
  audience: z.string().max(1000).optional(),
  count: z.number().int().min(1).max(12).default(6),
  brandVoice: z.string().max(2000).optional(),
});

export const improveRequestSchema = z.object({
  caption: z.string().min(1).max(10000),
  platform: platformSchema,
  instruction: z.string().max(1000).default("Make it more engaging"),
  tone: toneSchema.optional(),
});

export type OrganizationInput = z.infer<typeof organizationInputSchema>;
export type ConnectionUpdateInput = z.infer<typeof connectionUpdateSchema>;
export type PostInput = z.infer<typeof postInputSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
export type CaptionRequestInput = z.infer<typeof captionRequestSchema>;
export type IdeaRequestInput = z.infer<typeof ideaRequestSchema>;
export type ImproveRequestInput = z.infer<typeof improveRequestSchema>;

export const aiProviderSchema = z.enum(["anthropic", "moonshot", "mock"]);
export const aiProviderConfigInputSchema = z.object({
  apiKey: z.string().max(500).optional(),
  model: z.string().max(120).optional(),
  baseUrl: z.string().max(300).optional(),
});
export const aiSettingsUpdateSchema = z.object({
  provider: aiProviderSchema.optional(),
  anthropic: aiProviderConfigInputSchema.optional(),
  moonshot: aiProviderConfigInputSchema.optional(),
});
export type AiSettingsUpdateInput = z.infer<typeof aiSettingsUpdateSchema>;

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

export const connectionCreateSchema = z.object({
  platform: platformSchema,
  label: z.string().max(60).default(""),
  mode: z.enum(["sandbox", "live"]).default("sandbox"),
  /** Copy app credentials (client id/secret, redirect URI, scopes) from another connection on the same platform. */
  copyCredentialsFrom: z.string().optional(),
});

export const connectionUpdateSchema = z.object({
  label: z.string().max(60).optional(),
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
  publishMode: z.enum(["all", "queue"]).default("all"),
  queueSpacingMinutes: z.number().int().min(1).max(1440).default(10),
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

export const publishingSettingsSchema = z.object({
  defaultPublishMode: z.enum(["all", "queue"]).optional(),
  queueSpacingMinutes: z.number().int().min(1).max(1440).optional(),
  warnOnDuplicateCaptions: z.boolean().optional(),
});
export type ConnectionCreateInput = z.infer<typeof connectionCreateSchema>;
export type PublishingSettingsInput = z.infer<typeof publishingSettingsSchema>;

/* ---------- Auth & users ---------- */
export const userRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
export const setupSchema = z.object({ email: z.string().email(), name: z.string().min(1).max(80), password: z.string().min(8).max(200) });
export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  role: userRoleSchema.default("editor"),
  orgIds: z.union([z.literal("*"), z.array(z.string())]).default([]),
  /** Temporary password; the user is asked to change it on first login. */
  password: z.string().min(8).max(200),
});
export const userUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: userRoleSchema.optional(),
  orgIds: z.union([z.literal("*"), z.array(z.string())]).optional(),
  active: z.boolean().optional(),
  /** Admin-set temporary password. */
  password: z.string().min(8).max(200).optional(),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });
export type LoginInput = z.infer<typeof loginSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ---------- Video clips ---------- */
export const clipRequestSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().positive(),
    format: postFormatSchema.nullable().optional(),
    mode: z.enum(["new", "replace"]).default("new"),
    muted: z.boolean().default(false),
  })
  .refine((c) => c.end > c.start, { message: "end must be after start" })
  .refine((c) => c.end - c.start <= 300, { message: "Clips must be 5 minutes or shorter" })
  .refine((c) => c.end - c.start >= 0.5, { message: "Clips must be at least half a second" });
export type ClipRequestInput = z.infer<typeof clipRequestSchema>;

/**
 * Platform specifications: formats, limits, brand colours.
 * Single source of truth shared by the API and the UI.
 */
export const PLATFORMS = ["tiktok", "youtube", "linkedin", "instagram", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_FORMATS = [
  "square",        // 1:1
  "portrait_4_5",  // 4:5
  "portrait_9_16", // 9:16 vertical video / stories / reels / shorts
  "landscape_16_9",// 16:9
  "landscape_1_91",// 1.91:1 link preview
] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export interface FormatSpec {
  id: PostFormat;
  label: string;
  ratio: number; // width / height
  width: number; // recommended export size
  height: number;
  description: string;
}

export const FORMAT_SPECS: Record<PostFormat, FormatSpec> = {
  square: { id: "square", label: "Square 1:1", ratio: 1, width: 1080, height: 1080, description: "Feed post" },
  portrait_4_5: { id: "portrait_4_5", label: "Portrait 4:5", ratio: 4 / 5, width: 1080, height: 1350, description: "Tall feed post" },
  portrait_9_16: { id: "portrait_9_16", label: "Vertical 9:16", ratio: 9 / 16, width: 1080, height: 1920, description: "Reels, Shorts, TikTok, Stories" },
  landscape_16_9: { id: "landscape_16_9", label: "Landscape 16:9", ratio: 16 / 9, width: 1920, height: 1080, description: "YouTube video, LinkedIn video" },
  landscape_1_91: { id: "landscape_1_91", label: "Link 1.91:1", ratio: 1.91, width: 1200, height: 628, description: "Link preview / LinkedIn image" },
};

export type MediaKind = "image" | "video";

export interface PlatformSpec {
  id: Platform;
  name: string;
  color: string;        // brand colour
  accent: string;       // light tint for backgrounds
  formats: PostFormat[];        // allowed formats, first is default
  defaultFormat: PostFormat;
  captionMaxLength: number;
  titleMaxLength?: number;      // youtube titles
  hashtagLimit: number;
  mediaKinds: MediaKind[];
  requiresMedia: boolean;
  maxMediaCount: number;
  maxVideoSeconds: number;
  oauth: {
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    docsUrl: string;
  };
  description: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    color: "#010101",
    accent: "#FE2C55",
    formats: ["portrait_9_16", "square"],
    defaultFormat: "portrait_9_16",
    captionMaxLength: 2200,
    hashtagLimit: 30,
    mediaKinds: ["video", "image"],
    requiresMedia: true,
    maxMediaCount: 35,
    maxVideoSeconds: 600,
    oauth: {
      authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
      tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
      scopes: ["user.info.basic", "user.info.stats", "video.publish", "video.upload", "video.list"],
      docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    },
    description: "Publish short-form video and photo carousels via the Content Posting API.",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    color: "#FF0000",
    accent: "#FF0000",
    formats: ["landscape_16_9", "portrait_9_16"],
    defaultFormat: "landscape_16_9",
    captionMaxLength: 5000,
    titleMaxLength: 100,
    hashtagLimit: 15,
    mediaKinds: ["video"],
    requiresMedia: true,
    maxMediaCount: 1,
    maxVideoSeconds: 43200,
    oauth: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
      ],
      docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
    },
    description: "Upload long-form videos and Shorts through the YouTube Data API v3.",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    color: "#0A66C2",
    accent: "#0A66C2",
    formats: ["square", "landscape_1_91", "portrait_4_5", "landscape_16_9"],
    defaultFormat: "square",
    captionMaxLength: 3000,
    hashtagLimit: 5,
    mediaKinds: ["image", "video"],
    requiresMedia: false,
    maxMediaCount: 9,
    maxVideoSeconds: 900,
    oauth: {
      authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      scopes: ["openid", "profile", "w_member_social", "r_organization_social", "w_organization_social"],
      docsUrl: "https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api",
    },
    description: "Share text, image and video posts to personal profiles and company pages.",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    color: "#E1306C",
    accent: "#E1306C",
    formats: ["square", "portrait_4_5", "portrait_9_16", "landscape_1_91"],
    defaultFormat: "square",
    captionMaxLength: 2200,
    hashtagLimit: 30,
    mediaKinds: ["image", "video"],
    requiresMedia: true,
    maxMediaCount: 10,
    maxVideoSeconds: 900,
    oauth: {
      authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
      scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"],
      docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    },
    description: "Publish feed posts, carousels, Reels and Stories via the Instagram Graph API.",
  },
  x: {
    id: "x",
    name: "X",
    color: "#000000",
    accent: "#1D9BF0",
    formats: ["square", "landscape_16_9", "portrait_4_5"],
    defaultFormat: "square",
    captionMaxLength: 280,
    hashtagLimit: 3,
    mediaKinds: ["image", "video"],
    requiresMedia: false,
    maxMediaCount: 4,
    maxVideoSeconds: 140,
    oauth: {
      authorizeUrl: "https://x.com/i/oauth2/authorize",
      tokenUrl: "https://api.x.com/2/oauth2/token",
      scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
      docsUrl: "https://docs.x.com/x-api/posts/creation-of-a-post",
    },
    description: "Post text, images and short videos through the X API v2.",
  },
};

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isPostFormat(value: unknown): value is PostFormat {
  return typeof value === "string" && (POST_FORMATS as readonly string[]).includes(value);
}

/** Formats every selected platform can accept; falls back to the union when empty. */
export function commonFormats(platforms: Platform[]): PostFormat[] {
  if (platforms.length === 0) return [...POST_FORMATS];
  const sets = platforms.map((p) => new Set(PLATFORM_SPECS[p].formats));
  const common = POST_FORMATS.filter((f) => sets.every((s) => s.has(f)));
  return common.length > 0 ? common : [...new Set(platforms.flatMap((p) => PLATFORM_SPECS[p].formats))];
}

/** Given a source image size, compute the largest centred crop for a format. */
export function cropForFormat(width: number, height: number, format: PostFormat) {
  const ratio = FORMAT_SPECS[format].ratio;
  let cropW = width;
  let cropH = width / ratio;
  if (cropH > height) {
    cropH = height;
    cropW = height * ratio;
  }
  return {
    x: Math.round((width - cropW) / 2),
    y: Math.round((height - cropH) / 2),
    width: Math.round(cropW),
    height: Math.round(cropH),
  };
}

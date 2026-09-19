import path from "node:path";

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

const dataDirRaw = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

export const config = {
  port: num("PORT", 4000),
  dataDir: path.resolve(dataDirRaw),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  schedulerIntervalMs: num("SCHEDULER_INTERVAL_MS", 30000),
  secretKey: process.env.SECRET_KEY || "dev-insecure-secret-key-change-me",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  nodeEnv: process.env.NODE_ENV || "development",
  isTest: process.env.NODE_ENV === "test" || !!process.env.VITEST,
};

export type Config = typeof config;

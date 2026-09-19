import { Router } from "express";
import { z } from "zod";
import { captionRequestSchema, ideaRequestSchema, improveRequestSchema, platformSchema } from "@socmedia/shared";
import type { Db } from "../db/database";
import { BadRequestError } from "../middleware/errors";
import { bestTimes } from "../services/analytics";
import { generateCaptions, generateIdeas, improveCaption, suggestHashtags } from "../services/ai";
import { asyncHandler } from "../utils/asyncHandler";

const hashtagsRequestSchema = z.object({
  caption: z.string().min(1),
  platform: platformSchema,
  count: z.number().int().min(1).max(30).optional(),
});

const bestTimesRequestSchema = z.object({ platform: platformSchema });

export function aiRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/captions",
    asyncHandler(async (req, res) => {
      const input = captionRequestSchema.parse(req.body);
      const result = await generateCaptions(db, input);
      res.json(result);
    })
  );

  router.post(
    "/ideas",
    asyncHandler(async (req, res) => {
      const input = ideaRequestSchema.parse(req.body);
      const result = await generateIdeas(db, input);
      res.json(result);
    })
  );

  router.post(
    "/improve",
    asyncHandler(async (req, res) => {
      const input = improveRequestSchema.parse(req.body);
      const result = await improveCaption(db, input);
      res.json(result);
    })
  );

  router.post(
    "/hashtags",
    asyncHandler(async (req, res) => {
      const input = hashtagsRequestSchema.parse(req.body);
      const result = await suggestHashtags(db, input.caption, input.platform, input.count);
      res.json(result);
    })
  );

  router.post(
    "/best-times",
    asyncHandler(async (req, res) => {
      const input = bestTimesRequestSchema.parse(req.body);
      if (!req.org) throw new BadRequestError("Missing organization context");
      const slots = bestTimes(db, req.org.id, input.platform, req.org.timezone);
      res.json({ slots });
    })
  );

  return router;
}

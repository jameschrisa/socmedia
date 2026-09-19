import type { NextFunction, Request, Response } from "express";
import type { Organization } from "@socmedia/shared";
import type { Db } from "../db/database";
import { OrganizationsRepo } from "../db/repositories/organizations";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      org?: Organization;
    }
  }
}

/** Resolves the org from the X-Org-Id header or ?orgId query param and attaches it to req.org. */
export function orgMiddleware(db: Db) {
  const repo = new OrganizationsRepo(db);
  return (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req.header("X-Org-Id") || (req.query.orgId as string | undefined)) ?? undefined;
    if (!orgId) {
      res.status(400).json({ error: "Missing X-Org-Id header or orgId query parameter" });
      return;
    }
    const org = repo.get(orgId);
    if (!org) {
      res.status(400).json({ error: `Unknown organization: ${orgId}` });
      return;
    }
    if (req.user && req.user.orgIds !== "*" && !req.user.orgIds.includes(org.id)) {
      res.status(403).json({ error: "You do not have access to this organization" });
      return;
    }
    req.org = org;
    next();
  };
}

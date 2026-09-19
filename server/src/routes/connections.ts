import type { Request } from "express";
import { Router } from "express";
import { connectionUpdateSchema } from "@socmedia/shared";
import type { PlatformConnection } from "@socmedia/shared";
import { config } from "../config";
import type { Db } from "../db/database";
import { ConnectionsRepo } from "../db/repositories/connections";
import { isMasked, mask } from "../crypto";
import { NotFoundError } from "../middleware/errors";
import { getAdapter } from "../platforms";
import { asyncHandler } from "../utils/asyncHandler";

function maskConnection(conn: PlatformConnection): PlatformConnection {
  return {
    ...conn,
    credentials: {
      ...conn.credentials,
      clientSecret: mask(conn.credentials.clientSecret),
      accessToken: conn.credentials.accessToken ? mask(conn.credentials.accessToken) : "",
      refreshToken: conn.credentials.refreshToken ? mask(conn.credentials.refreshToken) : "",
    },
  };
}

function getOwned(req: Request, repo: ConnectionsRepo): PlatformConnection {
  const conn = repo.get(req.params.id);
  if (!conn || conn.orgId !== req.org!.id) throw new NotFoundError(`Connection ${req.params.id} not found`);
  return conn;
}

function encodeState(connectionId: string): string {
  return Buffer.from(JSON.stringify({ connectionId }), "utf8").toString("base64url");
}

function decodeState(state: string): { connectionId: string } {
  return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
}

export function connectionsRouter(db: Db): Router {
  const router = Router();
  const repo = new ConnectionsRepo(db);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const list = repo.listByOrg(req.org!.id).map(maskConnection);
      res.json(list);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const conn = getOwned(req, repo);
      res.json(maskConnection(conn));
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const existing = getOwned(req, repo);
      const input = connectionUpdateSchema.parse(req.body);

      const mergedCredentials = { ...existing.credentials };
      if (input.credentials) {
        for (const [key, value] of Object.entries(input.credentials)) {
          if (value === undefined) continue;
          if (isMasked(value)) continue; // masked round-trip placeholder: keep existing secret
          (mergedCredentials as Record<string, unknown>)[key] = value;
        }
      }
      const mergedSettings = { ...existing.settings, ...(input.settings ?? {}) };

      const updated: PlatformConnection = {
        ...existing,
        enabled: input.enabled ?? existing.enabled,
        mode: input.mode ?? existing.mode,
        displayName: input.displayName ?? existing.displayName,
        handle: input.handle ?? existing.handle,
        avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : existing.avatarUrl,
        credentials: mergedCredentials,
        settings: mergedSettings,
        updatedAt: new Date().toISOString(),
      };
      const saved = repo.save(updated);
      res.json(maskConnection(saved));
    })
  );

  router.post(
    "/:id/test",
    asyncHandler(async (req, res) => {
      const existing = getOwned(req, repo);
      const adapter = getAdapter(existing.platform);
      const result = await adapter.testConnection(existing);
      const nextStatus = result.ok ? "connected" : existing.status === "connected" ? "error" : existing.status;
      repo.save({ ...existing, lastTest: result, status: nextStatus, updatedAt: new Date().toISOString() });
      res.json(result);
    })
  );

  router.post(
    "/:id/connect",
    asyncHandler(async (req, res) => {
      const existing = getOwned(req, repo);
      const adapter = getAdapter(existing.platform);
      const state = encodeState(existing.id);
      const authorizeUrl = adapter.buildAuthorizeUrl(existing, state);

      if (existing.mode === "sandbox") {
        const tokenData = await adapter.exchangeCode(existing, "sandbox-authorization-code");
        const withToken: PlatformConnection = { ...existing, credentials: { ...existing.credentials, ...tokenData } };
        const profile = await adapter.fetchProfile(withToken);
        const now = new Date().toISOString();
        const updated = repo.save({
          ...withToken,
          status: "connected",
          displayName: profile.displayName,
          handle: profile.handle,
          avatarUrl: profile.avatarUrl ?? withToken.avatarUrl,
          followers: profile.followers,
          credentials: { ...withToken.credentials, extra: { ...withToken.credentials.extra, ...(profile.extra ?? {}) } },
          connectedAt: now,
          updatedAt: now,
        });
        res.json({ authorizeUrl, state, sandbox: true, connection: maskConnection(updated) });
        return;
      }

      res.json({ authorizeUrl, state });
    })
  );

  router.post(
    "/:id/disconnect",
    asyncHandler(async (req, res) => {
      const existing = getOwned(req, repo);
      const updated = repo.save({
        ...existing,
        status: "disconnected",
        connectedAt: null,
        credentials: { ...existing.credentials, accessToken: null, refreshToken: null, tokenExpiresAt: null },
        updatedAt: new Date().toISOString(),
      });
      res.json(maskConnection(updated));
    })
  );

  router.post(
    "/:id/refresh",
    asyncHandler(async (req, res) => {
      const existing = getOwned(req, repo);
      const adapter = getAdapter(existing.platform);
      const tokenData = await adapter.refreshToken(existing);
      const updated = repo.save({
        ...existing,
        credentials: { ...existing.credentials, ...tokenData },
        updatedAt: new Date().toISOString(),
      });
      res.json(maskConnection(updated));
    })
  );

  return router;
}

/** Not org-scoped: the OAuth provider redirects here directly; `state` encodes the connectionId. */
export function connectionsOAuthCallback(db: Db) {
  const repo = new ConnectionsRepo(db);
  return asyncHandler(async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    try {
      if (!code || !state) throw new Error("Missing code or state parameter");
      const { connectionId } = decodeState(state);
      const existing = repo.get(connectionId);
      if (!existing) throw new Error("Unknown connection");

      const adapter = getAdapter(existing.platform);
      const tokenData = await adapter.exchangeCode(existing, code);
      const withToken: PlatformConnection = { ...existing, credentials: { ...existing.credentials, ...tokenData } };
      const profile = await adapter.fetchProfile(withToken);
      const now = new Date().toISOString();
      repo.save({
        ...withToken,
        status: "connected",
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl ?? withToken.avatarUrl,
        followers: profile.followers,
        credentials: { ...withToken.credentials, extra: { ...withToken.credentials.extra, ...(profile.extra ?? {}) } },
        connectedAt: now,
        updatedAt: now,
      });
      res.redirect(`${config.clientUrl}/connections?connected=${existing.platform}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "OAuth callback failed";
      res.redirect(`${config.clientUrl}/connections?error=${encodeURIComponent(message)}`);
    }
  });
}

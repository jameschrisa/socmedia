import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { log } from "../services/logger";

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export class BadRequestError extends Error {
  details?: unknown;
  constructor(message = "Bad request", details?: unknown) {
    super(message);
    this.name = "BadRequestError";
    this.details = details;
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Generic HTTP error carrying an explicit status code (used e.g. for 502s from the AI service). */
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  log.error("http", `Unhandled error: ${message}`, {
    userId: req.user?.id ?? null,
    orgId: req.org?.id ?? null,
    data: { path: req.path, method: req.method, stack: err instanceof Error ? err.stack : undefined },
  });
  res.status(500).json({ error: message });
}

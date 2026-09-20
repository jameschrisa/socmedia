import type { InboundChannel, InboundMessage, InboundMessageStatus, InboundTimelineEntry, QuickPostLink } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToMessage(row: Row): InboundMessage {
  return {
    id: row.id,
    channel: row.channel as InboundChannel,
    providerMessageId: row.providerMessageId,
    senderId: row.senderId,
    bindingId: row.bindingId ?? null,
    orgId: row.orgId ?? null,
    userId: row.userId ?? null,
    text: row.text ?? "",
    mediaCount: Number(row.mediaCount ?? 0),
    hasAudio: !!row.hasAudio,
    status: row.status as InboundMessageStatus,
    postId: row.postId ?? null,
    mediaIds: JSON.parse(row.mediaIds ?? "[]"),
    links: JSON.parse(row.links ?? "[]") as QuickPostLink[],
    reply: row.reply ?? null,
    repliedBy: row.repliedBy ?? null,
    error: row.error ?? null,
    timeline: JSON.parse(row.timeline ?? "[]") as InboundTimelineEntry[],
    receivedAt: row.receivedAt,
    completedAt: row.completedAt ?? null,
  };
}

export interface CreateInboundMessageInput {
  id: string;
  channel: InboundChannel;
  providerMessageId: string;
  senderId: string;
  bindingId?: string | null;
  orgId?: string | null;
  userId?: string | null;
  text: string;
  mediaCount: number;
  hasAudio: boolean;
  status: InboundMessageStatus;
  timeline: InboundTimelineEntry[];
  receivedAt: string;
}

export interface UpdateInboundMessagePatch {
  bindingId?: string | null;
  orgId?: string | null;
  userId?: string | null;
  /** Overwrites the stored message text; used to record a resolved (e.g. transcribed) caption so a later "yes" can find it. */
  text?: string;
  status?: InboundMessageStatus;
  postId?: string | null;
  mediaIds?: string[];
  links?: QuickPostLink[];
  reply?: string | null;
  repliedBy?: "system" | "agent" | null;
  error?: string | null;
  timeline?: InboundTimelineEntry[];
  completedAt?: string | null;
}

export interface InboundMessageFilters {
  limit?: number;
  status?: InboundMessageStatus;
  channel?: InboundChannel;
}

export class InboundMessagesRepo {
  constructor(private db: Db) {}

  get(id: string): InboundMessage | undefined {
    const row = this.db.prepare("SELECT * FROM inbound_messages WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  getByProviderMessageId(channel: InboundChannel, providerMessageId: string): InboundMessage | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbound_messages WHERE channel = ? AND providerMessageId = ?")
      .get(channel, providerMessageId) as Row | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  /** Most recent awaiting_confirmation message for this channel + sender, used by the "yes"/"no" reply flow. */
  getLatestAwaitingConfirmation(channel: InboundChannel, senderId: string): InboundMessage | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM inbound_messages WHERE channel = ? AND senderId = ? AND status = 'awaiting_confirmation' ORDER BY receivedAt DESC LIMIT 1"
      )
      .get(channel, senderId) as Row | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  listAll(filters: InboundMessageFilters = {}): InboundMessage[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.channel) {
      clauses.push("channel = ?");
      params.push(filters.channel);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;
    const rows = this.db
      .prepare(`SELECT * FROM inbound_messages ${where} ORDER BY receivedAt DESC LIMIT ?`)
      .all(...params, limit) as Row[];
    return rows.map(rowToMessage);
  }

  listByOrg(orgId: string, filters: InboundMessageFilters = {}): InboundMessage[] {
    const clauses: string[] = ["orgId = ?"];
    const params: (string | number)[] = [orgId];
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.channel) {
      clauses.push("channel = ?");
      params.push(filters.channel);
    }
    const limit = filters.limit ?? 100;
    const rows = this.db
      .prepare(`SELECT * FROM inbound_messages WHERE ${clauses.join(" AND ")} ORDER BY receivedAt DESC LIMIT ?`)
      .all(...params, limit) as Row[];
    return rows.map(rowToMessage);
  }

  /** Counts for the status endpoint: messages received today (UTC calendar day) plus lifetime published/failed/pending. */
  countsForChannel(channel: InboundChannel): { today: number; published: number; failed: number; pending: number } {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const today = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM inbound_messages WHERE channel = ? AND receivedAt LIKE ?")
        .get(channel, `${todayPrefix}%`) as Row
    ).c;
    const published = (
      this.db.prepare("SELECT COUNT(*) as c FROM inbound_messages WHERE channel = ? AND status = 'published'").get(channel) as Row
    ).c;
    const failed = (
      this.db.prepare("SELECT COUNT(*) as c FROM inbound_messages WHERE channel = ? AND status = 'failed'").get(channel) as Row
    ).c;
    const pending = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM inbound_messages WHERE channel = ? AND status IN ('received','processing','awaiting_confirmation')")
        .get(channel) as Row
    ).c;
    return { today: Number(today), published: Number(published), failed: Number(failed), pending: Number(pending) };
  }

  create(input: CreateInboundMessageInput): InboundMessage {
    this.db
      .prepare(
        `INSERT INTO inbound_messages
          (id, channel, providerMessageId, senderId, bindingId, orgId, userId, text, mediaCount, hasAudio, status, postId, mediaIds, links, reply, repliedBy, error, timeline, receivedAt, completedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', '[]', NULL, NULL, NULL, ?, ?, NULL)`
      )
      .run(
        input.id,
        input.channel,
        input.providerMessageId,
        input.senderId,
        input.bindingId ?? null,
        input.orgId ?? null,
        input.userId ?? null,
        input.text,
        input.mediaCount,
        input.hasAudio ? 1 : 0,
        input.status,
        JSON.stringify(input.timeline),
        input.receivedAt
      );
    return this.get(input.id)!;
  }

  update(id: string, patch: UpdateInboundMessagePatch): InboundMessage | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = {
      bindingId: patch.bindingId !== undefined ? patch.bindingId : existing.bindingId,
      orgId: patch.orgId !== undefined ? patch.orgId : existing.orgId,
      userId: patch.userId !== undefined ? patch.userId : existing.userId,
      text: patch.text !== undefined ? patch.text : existing.text,
      status: patch.status ?? existing.status,
      postId: patch.postId !== undefined ? patch.postId : existing.postId,
      mediaIds: patch.mediaIds ?? existing.mediaIds,
      links: patch.links ?? existing.links,
      reply: patch.reply !== undefined ? patch.reply : existing.reply,
      repliedBy: patch.repliedBy !== undefined ? patch.repliedBy : existing.repliedBy,
      error: patch.error !== undefined ? patch.error : existing.error,
      timeline: patch.timeline ?? existing.timeline,
      completedAt: patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
    };
    this.db
      .prepare(
        `UPDATE inbound_messages SET bindingId=?, orgId=?, userId=?, text=?, status=?, postId=?, mediaIds=?, links=?, reply=?, repliedBy=?, error=?, timeline=?, completedAt=? WHERE id=?`
      )
      .run(
        next.bindingId ?? null,
        next.orgId ?? null,
        next.userId ?? null,
        next.text,
        next.status,
        next.postId ?? null,
        JSON.stringify(next.mediaIds),
        JSON.stringify(next.links),
        next.reply ?? null,
        next.repliedBy ?? null,
        next.error ?? null,
        JSON.stringify(next.timeline),
        next.completedAt ?? null,
        id
      );
    return this.get(id);
  }
}

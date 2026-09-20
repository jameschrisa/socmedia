import type { InboundBinding, InboundBindingStatus, InboundChannel, PublishMode } from "@socmedia/shared";
import type { Db, Row } from "../database";

function rowToBinding(row: Row): InboundBinding {
  return {
    id: row.id,
    channel: row.channel as InboundChannel,
    senderId: row.senderId,
    senderLabel: row.senderLabel ?? null,
    userId: row.userId,
    orgId: row.orgId,
    connectionIds: JSON.parse(row.connectionIds ?? "[]"),
    publishMode: row.publishMode === "queue" ? "queue" : "all",
    confirmBeforePosting: !!row.confirmBeforePosting,
    status: row.status as InboundBindingStatus,
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt ?? null,
    lastMessageAt: row.lastMessageAt ?? null,
  };
}

export interface CreateInboundBindingInput {
  id: string;
  channel: InboundChannel;
  senderId: string;
  senderLabel?: string | null;
  userId: string;
  orgId: string;
  connectionIds: string[];
  publishMode: PublishMode;
  confirmBeforePosting: boolean;
  status: InboundBindingStatus;
  verificationCode: string | null;
  createdAt: string;
  verifiedAt?: string | null;
}

export interface UpdateInboundBindingPatch {
  senderId?: string;
  senderLabel?: string | null;
  connectionIds?: string[];
  publishMode?: PublishMode;
  confirmBeforePosting?: boolean;
  status?: InboundBindingStatus;
  verifiedAt?: string | null;
  lastMessageAt?: string | null;
}

/** Internal row shape including the verification code, which is only ever exposed once at create time. */
export interface InboundBindingRecord extends InboundBinding {
  verificationCode?: string;
}

function rowToRecord(row: Row): InboundBindingRecord {
  return { ...rowToBinding(row), verificationCode: row.verificationCode ?? undefined };
}

export class InboundBindingsRepo {
  constructor(private db: Db) {}

  listAll(): InboundBindingRecord[] {
    const rows = this.db.prepare("SELECT * FROM inbound_bindings ORDER BY createdAt DESC").all() as Row[];
    return rows.map(rowToRecord);
  }

  listByOrg(orgId: string): InboundBindingRecord[] {
    const rows = this.db.prepare("SELECT * FROM inbound_bindings WHERE orgId = ? ORDER BY createdAt DESC").all(orgId) as Row[];
    return rows.map(rowToRecord);
  }

  get(id: string): InboundBindingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM inbound_bindings WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Any binding (any status) for this exact channel + sender, oldest first. */
  getByChannelAndSender(channel: InboundChannel, senderId: string): InboundBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbound_bindings WHERE channel = ? AND senderId = ? ORDER BY createdAt ASC LIMIT 1")
      .get(channel, senderId) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  getVerifiedByChannelAndSender(channel: InboundChannel, senderId: string): InboundBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbound_bindings WHERE channel = ? AND senderId = ? AND status = 'verified' ORDER BY createdAt ASC LIMIT 1")
      .get(channel, senderId) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Pending binding for this exact channel + sender whose code matches (the normal verification path). */
  getPendingByChannelSenderAndCode(channel: InboundChannel, senderId: string, code: string): InboundBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbound_bindings WHERE channel = ? AND senderId = ? AND status = 'pending' AND verificationCode = ? LIMIT 1")
      .get(channel, senderId, code) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Any pending binding on this channel whose code matches, regardless of the senderId it was created with
   *  (covers an admin creating the binding before knowing the exact phone/chat id format). */
  getPendingByChannelAndCode(channel: InboundChannel, code: string): InboundBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbound_bindings WHERE channel = ? AND status = 'pending' AND verificationCode = ? ORDER BY createdAt ASC LIMIT 1")
      .get(channel, code) as Row | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM inbound_bindings").get() as Row;
    return Number(row.c);
  }

  create(input: CreateInboundBindingInput): InboundBindingRecord {
    this.db
      .prepare(
        `INSERT INTO inbound_bindings
          (id, channel, senderId, senderLabel, userId, orgId, connectionIds, publishMode, confirmBeforePosting, status, verificationCode, createdAt, verifiedAt, lastMessageAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        input.id,
        input.channel,
        input.senderId,
        input.senderLabel ?? null,
        input.userId,
        input.orgId,
        JSON.stringify(input.connectionIds),
        input.publishMode,
        input.confirmBeforePosting ? 1 : 0,
        input.status,
        input.verificationCode,
        input.createdAt,
        input.verifiedAt ?? null
      );
    return this.get(input.id)!;
  }

  update(id: string, patch: UpdateInboundBindingPatch): InboundBindingRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const next = {
      senderId: patch.senderId ?? existing.senderId,
      senderLabel: patch.senderLabel !== undefined ? patch.senderLabel : existing.senderLabel,
      connectionIds: patch.connectionIds ?? existing.connectionIds,
      publishMode: patch.publishMode ?? existing.publishMode,
      confirmBeforePosting: patch.confirmBeforePosting ?? existing.confirmBeforePosting,
      status: patch.status ?? existing.status,
      verifiedAt: patch.verifiedAt !== undefined ? patch.verifiedAt : existing.verifiedAt,
      lastMessageAt: patch.lastMessageAt !== undefined ? patch.lastMessageAt : existing.lastMessageAt,
    };
    this.db
      .prepare(
        `UPDATE inbound_bindings SET senderId=?, senderLabel=?, connectionIds=?, publishMode=?, confirmBeforePosting=?, status=?, verifiedAt=?, lastMessageAt=? WHERE id=?`
      )
      .run(
        next.senderId,
        next.senderLabel ?? null,
        JSON.stringify(next.connectionIds),
        next.publishMode,
        next.confirmBeforePosting ? 1 : 0,
        next.status,
        next.verifiedAt ?? null,
        next.lastMessageAt ?? null,
        id
      );
    return this.get(id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare("DELETE FROM inbound_bindings WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }
}

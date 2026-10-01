import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { StructuralPatch } from "@igle/html-engine";
import type { Actor } from "@igle/shared";

export interface CollabParticipant {
  connectionId: string;
  actorId: string;
  name: string;
  color: string;
  selectedNodeId?: number | undefined;
  patches: StructuralPatch[];
}

export interface CollabSnapshot {
  participants: CollabParticipant[];
}

interface CollabRoom {
  participants: Map<string, CollabParticipant>;
}

const PALETTE = ["#e8590c", "#2f7d3f", "#1971c2", "#9c36b5", "#c92a2a", "#0c8599", "#e8862c", "#5f3dc4"];

function roomKey(siteId: string, pageId: string): string {
  return `${siteId}:${pageId}`;
}

/**
 * Real-time co-editing for the visual editor — see /api/sites/[siteId]/pages/[pageId]/visual/collab
 * (SSE) and .../collab/sync (POST). A "room" is every browser tab currently editing one page,
 * tracked purely in memory: each participant's own *current, not-yet-saved* patch list, broadcast
 * to everyone else in the room on every change so nobody's unsaved work is ever invisible to — or
 * silently discarded by — anyone else's Save. Rooms are ephemeral and never written to state.json:
 * same "single Node process" assumption site-lock.ts already documents and accepts; a restart just
 * means everyone's live session starts fresh (their own browser-side patches are untouched, since
 * those live client-side until Save).
 */
export class CollabService {
  private readonly rooms = new Map<string, CollabRoom>();
  private readonly events = new EventEmitter();

  join(siteId: string, pageId: string, actor: Actor): { connectionId: string; color: string } {
    const key = roomKey(siteId, pageId);
    let room = this.rooms.get(key);
    if (!room) {
      room = { participants: new Map() };
      this.rooms.set(key, room);
    }
    const connectionId = randomUUID();
    const color = PALETTE[room.participants.size % PALETTE.length]!;
    room.participants.set(connectionId, { connectionId, actorId: actor.id, name: actor.email, color, patches: [] });
    this.emitSnapshot(siteId, pageId);
    return { connectionId, color };
  }

  leave(siteId: string, pageId: string, connectionId: string): void {
    const key = roomKey(siteId, pageId);
    const room = this.rooms.get(key);
    if (!room) return;
    room.participants.delete(connectionId);
    if (room.participants.size === 0) {
      this.rooms.delete(key);
      return;
    }
    this.emitSnapshot(siteId, pageId);
  }

  sync(siteId: string, pageId: string, connectionId: string, patches: StructuralPatch[], selectedNodeId: number | undefined): void {
    const room = this.rooms.get(roomKey(siteId, pageId));
    const participant = room?.participants.get(connectionId);
    if (!participant) return;
    participant.patches = patches;
    participant.selectedNodeId = selectedNodeId;
    this.emitSnapshot(siteId, pageId);
  }

  /** Called once a save actually commits — clears every participant's pending patches (the just-saved
   * content is now the shared baseline) and tells everyone so their own view resets to it, not just
   * whoever clicked Save. */
  resetRoom(siteId: string, pageId: string): void {
    const room = this.rooms.get(roomKey(siteId, pageId));
    if (!room) return;
    for (const participant of room.participants.values()) {
      participant.patches = [];
      participant.selectedNodeId = undefined;
    }
    this.emitSnapshot(siteId, pageId);
  }

  snapshot(siteId: string, pageId: string): CollabSnapshot {
    const room = this.rooms.get(roomKey(siteId, pageId));
    return { participants: room ? [...room.participants.values()] : [] };
  }

  subscribe(siteId: string, pageId: string, listener: (snapshot: CollabSnapshot) => void): () => void {
    const key = roomKey(siteId, pageId);
    this.events.on(key, listener);
    return () => this.events.off(key, listener);
  }

  private emitSnapshot(siteId: string, pageId: string): void {
    this.events.emit(roomKey(siteId, pageId), this.snapshot(siteId, pageId));
  }
}

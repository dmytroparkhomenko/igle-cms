import { IgleError, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { TicketComment, TicketPriority, TicketRecord, TicketSpecialistType, TicketStatus } from "./types.js";

export interface CreateTicketInput {
  siteId?: string | undefined;
  title: string;
  description: string;
  specialistType: TicketSpecialistType;
  priority: TicketPriority;
  deadline?: string | undefined;
  assigneeId?: string | undefined;
}

export interface UpdateTicketInput {
  status?: TicketStatus | undefined;
  priority?: TicketPriority | undefined;
  specialistType?: TicketSpecialistType | undefined;
  deadline?: string | null | undefined;
  assigneeId?: string | null | undefined;
}

export class TicketService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async create(input: CreateTicketInput): Promise<TicketRecord> {
    if (input.title.trim().length === 0) throw new IgleError("INVALID_TICKET", "Title is required.", 400);
    const state = await this.stateStore.read();
    if (input.assigneeId && !state.users.some((user) => user.id === input.assigneeId)) {
      throw new IgleError("ASSIGNEE_NOT_FOUND", "That team member was not found.", 400);
    }

    const now = new Date().toISOString();
    const ticket: TicketRecord = {
      id: id("ticket"),
      siteId: input.siteId,
      title: input.title.trim(),
      description: input.description.trim(),
      specialistType: input.specialistType,
      priority: input.priority,
      status: "open",
      deadline: input.deadline,
      assigneeId: input.assigneeId,
      comments: [],
      createdAt: now,
      updatedAt: now
    };
    await this.stateStore.update((next) => {
      next.tickets.push(ticket);
    });
    return ticket;
  }

  async list(): Promise<TicketRecord[]> {
    const state = await this.stateStore.read();
    return state.tickets;
  }

  async get(ticketId: string): Promise<TicketRecord | undefined> {
    const state = await this.stateStore.read();
    return state.tickets.find((ticket) => ticket.id === ticketId);
  }

  async update(ticketId: string, input: UpdateTicketInput): Promise<TicketRecord> {
    return this.stateStore.update((state) => {
      const ticket = state.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new IgleError("TICKET_NOT_FOUND", "Ticket was not found.", 404);
      if (input.status) ticket.status = input.status;
      if (input.priority) ticket.priority = input.priority;
      if (input.specialistType) ticket.specialistType = input.specialistType;
      if (input.deadline !== undefined) ticket.deadline = input.deadline ?? undefined;
      if (input.assigneeId !== undefined) {
        if (input.assigneeId && !state.users.some((user) => user.id === input.assigneeId)) {
          throw new IgleError("ASSIGNEE_NOT_FOUND", "That team member was not found.", 400);
        }
        ticket.assigneeId = input.assigneeId ?? undefined;
      }
      ticket.updatedAt = new Date().toISOString();
      return ticket;
    });
  }

  /** Comments are always attributed to whoever's actually signed in — author is a snapshot of their current name/email at write time, so the comment still reads fine if the account is later renamed or removed. */
  async addComment(ticketId: string, actor: Actor, body: string): Promise<TicketRecord> {
    if (body.trim().length === 0) throw new IgleError("INVALID_COMMENT", "Comment cannot be empty.", 400);
    return this.stateStore.update((state) => {
      const ticket = state.tickets.find((item) => item.id === ticketId);
      if (!ticket) throw new IgleError("TICKET_NOT_FOUND", "Ticket was not found.", 404);
      const user = state.users.find((item) => item.id === actor.id);
      const comment: TicketComment = {
        id: id("comment"),
        author: user?.name || actor.email,
        authorId: actor.id,
        body: body.trim(),
        createdAt: new Date().toISOString()
      };
      ticket.comments.push(comment);
      ticket.updatedAt = comment.createdAt;
      return ticket;
    });
  }
}

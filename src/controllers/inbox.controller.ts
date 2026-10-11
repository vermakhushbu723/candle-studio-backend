import type { Request, Response } from 'express';
import type { Model } from 'mongoose';
import { Inquiry, Ticket } from '../models/Engagement.js';
import { ApiError, escapeRegex, paginate } from '../utils/http.js';

/**
 * Admin CRUD for an "inbox" collection (contact enquiries, chat tickets):
 * paginated list with status filter + text search, detail, status/note update, delete.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeInbox(M: Model<any>, searchFields: string[]) {
  return {
    async list(req: Request, res: Response) {
      const { page, limit, skip } = paginate(req.query);
      const filter: Record<string, unknown> = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
        filter.$or = searchFields.map((f) => ({ [f]: rx }));
      }
      const [items, total] = await Promise.all([M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), M.countDocuments(filter)]);
      res.json({ success: true, items, total, page, limit });
    },
    async get(req: Request, res: Response) {
      const item = await M.findById(req.params.id);
      if (!item) throw new ApiError(404, 'Not found.');
      res.json({ success: true, item });
    },
    async update(req: Request, res: Response) {
      const item = await M.findById(req.params.id);
      if (!item) throw new ApiError(404, 'Not found.');
      const { note, status } = req.body;
      if (status) item.status = status;
      if (note) item.notes.push({ by: req.user?.name ?? 'Admin', text: note });
      await item.save();
      res.json({ success: true, item });
    },
    async remove(req: Request, res: Response) {
      if (!(await M.findByIdAndDelete(req.params.id))) throw new ApiError(404, 'Not found.');
      res.json({ success: true, message: 'Deleted.' });
    },
  };
}

export const inquiryAdmin = makeInbox(Inquiry, ['name', 'email', 'phone', 'topic', 'message']);
export const ticketAdmin = makeInbox(Ticket, ['ticketId', 'name', 'phone', 'topic', 'message']);

// ——— Public form submissions
export async function createInquiry(req: Request, res: Response) {
  const item = await Inquiry.create(req.body);
  res.status(201).json({ success: true, item, message: 'Thanks! We’ll get back to you within 24 hours.' });
}

export async function createTicket(req: Request, res: Response) {
  let ticketId = '';
  do ticketId = `CD-${Math.floor(100000 + Math.random() * 900000)}`;
  while (await Ticket.exists({ ticketId }));
  const item = await Ticket.create({ ...req.body, ticketId });
  res.status(201).json({ success: true, item, ticketId });
}

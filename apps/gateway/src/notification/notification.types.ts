/**
 * Actor embed exposed over HTTP/WS next to the bare `actorId` (OVERFETCH-01).
 * Deliberately the SAME shape as the `reviewer` (orders) and `reporter`
 * (social) embeds — `id` non-null opaque public id, `username` non-null,
 * `avatar` nullable — so the FE can type one `UserSummary` for all three.
 * Never carries `email`.
 */
export interface NotificationActor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface NotificationItem {
  id: string;
  userId: string | null;
  type: string;
  orderId: string | null;
  postId: string | null;
  actorId: string | null;
  actor: NotificationActor | null;
  preview: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface PaginatedNotifications {
  data: NotificationItem[];
  total: number;
  page: number;
  limit: number;
}

export interface NotificationPayload {
  id: string;
  userId: string | null;
  type: string;
  orderId: string | null;
  postId: string | null;
  actorId: string | null;
  preview: string | null;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

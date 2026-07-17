export interface NotificationItem {
  id: string;
  userId: string | null;
  type: string;
  orderId: string | null;
  postId: string | null;
  actorId: string | null;
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

export interface NotificationItem {
  id: number;
  userId: number;
  type: string;
  orderId: number | null;
  postId: number | null;
  actorId: number | null;
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
  id: number;
  userId: number;
  type: string;
  orderId: number | null;
  postId: number | null;
  actorId: number | null;
  preview: string | null;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

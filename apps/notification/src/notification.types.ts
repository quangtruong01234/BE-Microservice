export interface NotificationMetadata {
  postId?: number | null;
  actorId?: number | null;
  preview?: string | null;
}

export interface UserEmailInfo {
  id: number;
  email?: string | null;
}

export interface OrderInfo {
  id: number;
  publicId: string | null;
  userId: number;
  sellerId: number;
  total: number;
}

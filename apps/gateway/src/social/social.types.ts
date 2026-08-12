/** Author shape as received over TCP from the user service (internal ids). */
export interface UserInfoTcp {
  id: number;
  publicId?: string | null;
  username: string;
  avatar: string | null;
}

/** Author embed exposed over HTTP — `id` is the opaque public id (PUBID-02). */
export interface UserInfo {
  id: string;
  username: string;
  avatar: string | null;
}

/**
 * A comment or reply as the social service returns it. `children` is present
 * only on the nested-tree shape (`GET /comments/:id/replies`) and `parent` only
 * on a freshly created reply, so the author decoration has to recurse through
 * both (SOCIAL-AUTHOR-01).
 */
export interface CommentNode {
  userId: number;
  children?: CommentNode[];
  parent?: CommentNode;
  [key: string]: unknown;
}

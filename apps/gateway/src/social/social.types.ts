/** Author shape as received over TCP from the user service (internal ids). */
export interface UserInfoTcp {
  id: number;
  publicId?: string | null;
  username: string;
  name?: string | null;
  avatar: string | null;
}

/**
 * Author embed exposed over HTTP — `id` is the opaque public id (PUBID-02).
 *
 * AUTHOR-NAME-01: `name` is the OPTIONAL display name and is nullable for real
 * (most accounts never set one) — `username` stays the label that cannot come
 * back blank. Do not read `name` alone. Note the key means something different
 * in the product embed, where `product.user.name` deliberately carries the
 * USERNAME (see ENRICH-BATCH-01); here the two are separate fields.
 */
export interface UserInfo {
  id: string;
  username: string;
  name: string | null;
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

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

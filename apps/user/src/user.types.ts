import { User } from "./entity/user.entity";

export type SafeUser = Omit<User, "password">;
export type PublicUserProfile = Pick<
  User,
  "id" | "publicId" | "username" | "name" | "avatar" | "isActive"
>;
export type UserProfile = PublicUserProfile & Partial<Pick<User, "email">>;
export type UserProvince = { id: number; name: string };
export type UserProfileWithProvince = UserProfile & {
  province?: UserProvince | null;
};

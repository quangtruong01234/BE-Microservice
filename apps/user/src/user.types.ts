import { User } from "./entity/user.entity";

export type SafeUser = Omit<User, "password">;
export type PublicUserProfile = Pick<
  User,
  "id" | "username" | "name" | "avatar" | "isActive"
>;
export type UserProfile = PublicUserProfile & Partial<Pick<User, "email">>;

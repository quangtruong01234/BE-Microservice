import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entity/user.entity";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { UserAddress } from "./entity/user-address.entity";
import {
  DataSource,
  FindOptionsSelect,
  FindOptionsWhere,
  In,
  QueryFailedError,
  Repository,
} from "typeorm";
import { RegisterUserDto } from "./dto/register-user.dto";
import { LoginUserDto } from "./dto/login-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import {
  CloudinaryService,
  MailerService,
  PaginatedResponse,
  generatePublicId,
  isPublicId,
  renderPasswordResetEmail,
} from "@app/common";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { CachedService } from "@app/cached";
import * as bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { USER_MESSAGE } from "libs/constant/response-message.constant";
import {
  SafeUser,
  UserProfile,
  UserProfileWithProvince,
  UserProvince,
} from "./user.types";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserAddress)
    private readonly addressRepository: Repository<UserAddress>,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly mailerService: MailerService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // Must stay >= the resend cooldown below. If the code died before a resend
  // were allowed, the user would be stuck holding neither a usable code nor the
  // right to ask for a new one. Equal is the tightest safe value: the code
  // expires at the exact moment the resend unlocks. The duration quoted in the
  // email is derived from this constant, never hardcoded.
  private static readonly PASSWORD_RESET_CODE_TTL_SECONDS = 60;
  private static readonly PASSWORD_RESET_MAX_ATTEMPTS = 5;
  private static readonly PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;

  async getUsersPaginated(
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<SafeUser>> {
    this.logger.log(`Fetching users page=${page} limit=${limit}`);
    const [users, total] = await this.userRepository.findAndCount({
      select: {
        id: true,
        publicId: true,
        username: true,
        email: true,
        name: true,
        avatar: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(
      users.map((user) => this.toSafeUser(user)),
      total,
      page,
      limit,
    );
  }

  /**
   * `username` and `email` are UNIQUE columns. Without this pre-check a taken
   * value surfaces as a raw QueryFailedError → HTTP 500, so the client cannot
   * tell the user WHICH field is taken. Not race-proof on its own — the write
   * paths also map ER_DUP_ENTRY via `duplicateCredentialConflict()`.
   */
  private async assertCredentialsAvailable(
    credentials: { username?: string; email?: string },
    excludeUserId?: number,
  ): Promise<void> {
    const where: FindOptionsWhere<User>[] = [];
    if (credentials.username) {
      where.push({ username: credentials.username });
    }
    if (credentials.email) {
      where.push({ email: credentials.email });
    }
    if (where.length === 0) {
      return;
    }
    const conflicts = await this.userRepository.find({
      where,
      select: { id: true, username: true, email: true },
      // Existence probe only — no need to join the eager `role` relation.
      loadEagerRelations: false,
    });
    for (const conflict of conflicts) {
      if (conflict.id === excludeUserId) {
        continue;
      }
      throw new ConflictException(
        conflict.username === credentials.username
          ? USER_MESSAGE.USERNAME_TAKEN
          : USER_MESSAGE.EMAIL_TAKEN,
      );
    }
  }

  /**
   * Maps a MySQL duplicate-key failure on the users table to a 409, but only
   * when the duplicated value is the username/email we just tried to write —
   * `public_id` is unique too and must keep its own error.
   */
  private duplicateCredentialConflict(
    error: unknown,
    credentials: { username?: string; email?: string },
  ): ConflictException | null {
    if (!(error instanceof QueryFailedError)) {
      return null;
    }
    const driverError = error.driverError as
      | { code?: string; sqlMessage?: string }
      | undefined;
    if (driverError?.code !== "ER_DUP_ENTRY") {
      return null;
    }
    const duplicatedValue = /Duplicate entry '(.*)' for key/.exec(
      driverError.sqlMessage ?? error.message,
    )?.[1];
    if (!duplicatedValue) {
      return null;
    }
    if (duplicatedValue === credentials.username) {
      return new ConflictException(USER_MESSAGE.USERNAME_TAKEN);
    }
    if (duplicatedValue === credentials.email) {
      return new ConflictException(USER_MESSAGE.EMAIL_TAKEN);
    }
    return null;
  }

  async register(dto: RegisterUserDto): Promise<SafeUser> {
    this.logger.log(`Register user: ${dto.username}`);
    const defaultRole = await this.roleRepository.findOne({
      where: { rol_name: RoleName.USER, rol_status: RoleStatus.ACTIVE },
    });
    if (!defaultRole) {
      throw new InternalServerErrorException(
        USER_MESSAGE.DEFAULT_ROLE_NOT_FOUND,
      );
    }
    await this.assertCredentialsAvailable({
      username: dto.username,
      email: dto.email,
    });
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.USER),
      username: dto.username,
      email: dto.email,
      password: hashedPassword,
      role: defaultRole,
    });
    try {
      const saved = await this.userRepository.save(user);
      return this.toSafeUser(saved);
    } catch (error: unknown) {
      const conflict = this.duplicateCredentialConflict(error, {
        username: dto.username,
        email: dto.email,
      });
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }

  async login(dto: LoginUserDto): Promise<SafeUser> {
    this.logger.log(`Login user: ${dto.username}`);
    const user = await this.userRepository.findOne({
      where: { username: dto.username },
    });
    if (!user) {
      throw new UnauthorizedException(USER_MESSAGE.INVALID_CREDENTIALS);
    }
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException(USER_MESSAGE.INVALID_CREDENTIALS);
    }
    return this.toSafeUser(user);
  }

  /**
   * Starts the forgot-password flow: generates a 6-digit code, stores it in
   * Redis (1 min TTL) and emails it to the registered address. Always
   * returns the same generic message so callers cannot probe which emails
   * are registered. A 60s per-user cooldown throttles resends.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const genericResponse = {
      message:
        "If this email is registered, a verification code has been sent to it",
    };
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      this.logger.warn(`forgotPassword: no account for email ${email}`);
      return genericResponse;
    }
    const cooldownClaimed = await this.cachedService.setNx(
      `user:pwreset:cooldown:${user.id}`,
      "1",
      UserService.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
    );
    if (!cooldownClaimed) {
      this.logger.warn(
        `forgotPassword: resend cooldown active for user ${user.id}`,
      );
      return genericResponse;
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.cachedService.set(
      `user:pwreset:code:${user.id}`,
      code,
      UserService.PASSWORD_RESET_CODE_TTL_SECONDS,
    );
    await this.cachedService.del(`user:pwreset:attempts:${user.id}`);
    // A fresh code re-opens the flow: drop the "attempts used up" marker, or
    // `resetPassword` would keep reporting RESET_CODE_EXHAUSTED against a code
    // that is perfectly valid. Only reached once the cooldown was claimed, so
    // a throttled resend correctly leaves the marker in place.
    await this.cachedService.del(`user:pwreset:exhausted:${user.id}`);
    try {
      const email = renderPasswordResetEmail(
        code,
        Math.round(UserService.PASSWORD_RESET_CODE_TTL_SECONDS / 60),
      );
      await this.mailerService.sendMail(
        user.email,
        email.subject,
        email.text,
        email.html,
      );
    } catch (error) {
      // Code stays valid in Redis; the user can retry the request after the
      // cooldown. Never reveal the transport failure to the caller.
      this.logger.error(
        `forgotPassword: failed to send email to user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return genericResponse;
  }

  /**
   * Completes the forgot-password flow: verifies the emailed code (max 5
   * attempts, then the code is invalidated) and sets the new password.
   *
   * Every rejection keeps the same 400 and the same wording, on purpose. The
   * one case that also carries `RESET_CODE_EXHAUSTED` is the code being burned
   * by the attempt limit, because that is the only one where retrying is
   * pointless — see MAIL-UI-01 and `ERROR_CODE.RESET_CODE_EXHAUSTED`.
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const invalidCodeError = new BadRequestException(
      USER_MESSAGE.INVALID_OR_EXPIRED_VERIFICATION_CODE,
    );
    // Object response so the code reaches the client through the RPC filter →
    // gateway chain, exactly like CHG-PW-02 does for the 401.
    const exhaustedCodeError = new BadRequestException({
      message: USER_MESSAGE.INVALID_OR_EXPIRED_VERIFICATION_CODE,
      errorCode: ERROR_CODE.RESET_CODE_EXHAUSTED,
    });
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw invalidCodeError;
    }
    const codeKey = `user:pwreset:code:${user.id}`;
    const attemptsKey = `user:pwreset:attempts:${user.id}`;
    const exhaustedKey = `user:pwreset:exhausted:${user.id}`;
    // Checked BEFORE the code lookup: the burned code is already gone from
    // Redis, so without this marker every attempt after the one that tripped
    // the limit would fall into the generic branch below and the client would
    // lose the signal the moment the user reloads or switches tab.
    if (await this.cachedService.get(exhaustedKey)) {
      throw exhaustedCodeError;
    }
    const storedCode = await this.cachedService.get(codeKey);
    if (!storedCode) {
      throw invalidCodeError;
    }
    const attempts = await this.cachedService.incr(attemptsKey);
    if (attempts === 1) {
      await this.cachedService.expire(
        attemptsKey,
        UserService.PASSWORD_RESET_CODE_TTL_SECONDS,
      );
    }
    if (attempts > UserService.PASSWORD_RESET_MAX_ATTEMPTS) {
      await this.cachedService.del(codeKey);
      await this.cachedService.del(attemptsKey);
      await this.cachedService.set(
        exhaustedKey,
        "1",
        UserService.PASSWORD_RESET_CODE_TTL_SECONDS,
      );
      this.logger.warn(
        `resetPassword: attempt limit exceeded for user ${user.id} — code invalidated`,
      );
      throw exhaustedCodeError;
    }
    if (storedCode !== code) {
      throw invalidCodeError;
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);
    await this.cachedService.del(codeKey);
    await this.cachedService.del(attemptsKey);
    await this.cachedService.del(`user:pwreset:cooldown:${user.id}`);
    this.logger.log(`resetPassword: password updated for user ${user.id}`);
    return { success: true };
  }

  /**
   * CHG-PW-01: password change for a session that already knows the old
   * password — no emailed code, no `PATCH /user/:id` (that path whitelists
   * profile fields and would store the value unhashed).
   *
   * A wrong `currentPassword` is a 401 like `login()`, NOT an expired session;
   * the gateway's cookie is left alone, so the caller stays logged in whether
   * the change succeeds or fails.
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(USER_MESSAGE.NOT_FOUND);
    }
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      this.logger.warn(
        `changePassword: wrong current password for user ${userId}`,
      );
      // Object response so the code survives the gateway's production 401
      // sanitizer, which flattens `message` to "Unauthorized" (CHG-PW-02).
      throw new UnauthorizedException({
        message: USER_MESSAGE.CURRENT_PASSWORD_INCORRECT,
        errorCode: ERROR_CODE.INVALID_CURRENT_PASSWORD,
      });
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(USER_MESSAGE.NEW_PASSWORD_SAME_AS_CURRENT);
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);
    // Any pending forgot-password code is now meaningless — drop it so an old
    // emailed code cannot be replayed against the new password.
    await this.cachedService.del(`user:pwreset:code:${user.id}`);
    await this.cachedService.del(`user:pwreset:attempts:${user.id}`);
    await this.cachedService.del(`user:pwreset:exhausted:${user.id}`);
    this.logger.log(`changePassword: password updated for user ${userId}`);
    return { success: true };
  }

  async getInfo(
    userId: number,
    includeEmail = false,
  ): Promise<UserProfile | null> {
    this.logger.log(`Get info for userId: ${userId}`);
    const select: FindOptionsSelect<User> = {
      id: true,
      publicId: true,
      username: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    if (includeEmail) {
      select.email = true;
    }
    // `role` is an EAGER relation: a column `select` does not stop TypeORM from
    // joining it, so without this the whole role entity (incl. `rol_grants`)
    // rides along into every user embed built from this pattern.
    return await this.userRepository.findOne({
      where: { id: userId },
      select,
      loadEagerRelations: false,
    });
  }

  async getUsersByIds(
    userIds: number[],
    includeEmail = false,
    includeProvince = false,
  ): Promise<UserProfileWithProvince[]> {
    if (userIds.length === 0) return [];
    const select: FindOptionsSelect<User> = {
      id: true,
      publicId: true,
      username: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    if (includeEmail) {
      select.email = true;
    }
    // See getInfo(): the eager `role` relation must be opted out explicitly.
    const users = await this.userRepository.find({
      where: { id: In(userIds) },
      select,
      loadEagerRelations: false,
    });
    if (!includeProvince) return users;
    // The default address defines where the seller ships from — that province
    // is what the storefront shows/filters on product rows.
    const defaultAddresses = await this.addressRepository.find({
      where: { userId: In(userIds), isDefault: true },
      select: { userId: true, provinceId: true, provinceName: true },
    });
    const provinceByUserId = new Map<number, UserProvince>(
      defaultAddresses.map((address) => [
        address.userId,
        { id: address.provinceId, name: address.provinceName },
      ]),
    );
    return users.map((user) => ({
      ...user,
      province: provinceByUserId.get(user.id) ?? null,
    }));
  }

  async getUserIdsByProvince(provinceIds: number[]): Promise<number[]> {
    if (provinceIds.length === 0) return [];
    const rows = await this.addressRepository
      .createQueryBuilder("address")
      .select("DISTINCT address.user_id", "userId")
      .where("address.province_id IN (:...provinceIds)", { provinceIds })
      .andWhere("address.is_default = :isDefault", { isDefault: true })
      .getRawMany<{ userId: number | string }>();
    return rows.map((row) => Number(row.userId));
  }

  async getFeaturedSellers(
    limit: number,
  ): Promise<Pick<User, "id" | "publicId" | "username" | "name" | "avatar">[]> {
    // Query builder skips the eager `role` relation, so the join below is the
    // only one (a partial `select` via find() double-joins eager relations on
    // MySQL — see getMe). "Featured" = newest active shop accounts. `limit()`
    // not `take()`: the role join is many-to-one (no row multiplication), and
    // take() wraps a DISTINCT id subquery whose ORDER BY column would have to
    // be in the SELECT on MySQL.
    return this.userRepository
      .createQueryBuilder("user")
      .innerJoin("user.role", "role", "role.rol_name = :roleName", {
        roleName: RoleName.SHOP,
      })
      .where("user.isActive = :isActive", { isActive: true })
      .orderBy("user.createdAt", "DESC")
      .limit(limit)
      .select([
        "user.id",
        "user.publicId",
        "user.username",
        "user.name",
        "user.avatar",
      ])
      .getMany();
  }

  /**
   * PUBID-02: maps an external opaque id (`usr_...`) to the internal numeric
   * PK. Numeric ids pass through untouched so internal TCP callers (orders
   * invoice, notification email) keep working with the number they store.
   */
  async resolveUserId(userId: number | string): Promise<number> {
    if (typeof userId === "number") {
      return userId;
    }
    if (!isPublicId(PUBLIC_ID_PREFIXES.USER, userId)) {
      throw new NotFoundException(USER_MESSAGE.NOT_FOUND);
    }
    const user = await this.userRepository.findOne({
      where: { publicId: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(USER_MESSAGE.NOT_FOUND);
    }
    return user.id;
  }

  async getMe(userId: number): Promise<SafeUser> {
    this.logger.log(`getMe called with userId: ${userId}`);
    // No partial `select` here: the `role` relation is `eager: true`, so a plain
    // findOne auto-joins it (same query shape as `login`). A partial `select`
    // that also lists relation columns double-joins the eager relation on MySQL
    // and fails. Strip the password instead of column-selecting.
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(USER_MESSAGE.NOT_FOUND);
    }
    return this.toSafeUser(user);
  }

  async updateUser(userId: number, dto: UpdateUserDto): Promise<User> {
    this.logger.log(`updateUser called with userId: ${userId}`);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(USER_MESSAGE.NOT_FOUND);
    }
    // `email` is UNIQUE — same 409-not-500 contract as register.
    if (dto.email && dto.email !== user.email) {
      await this.assertCredentialsAvailable({ email: dto.email }, userId);
    }
    // Capture before Object.assign overwrites avatar on the same instance.
    const previousAvatar = user.avatar;
    Object.assign(user, dto);
    let saved: User;
    try {
      saved = await this.userRepository.save(user);
    } catch (error: unknown) {
      const conflict = this.duplicateCredentialConflict(error, {
        email: dto.email,
      });
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
    // SEC-M7: a replaced avatar is orphaned on Cloudinary once the update
    // commits. Fire-and-forget — destroyAssets never throws.
    if (previousAvatar && previousAvatar !== saved.avatar) {
      void this.cloudinaryService.destroyAssets([previousAvatar]);
    }
    delete (saved as Partial<User>).password;
    return saved;
  }

  async listAddresses(userId: number): Promise<UserAddress[]> {
    this.logger.log(`listAddresses for userId: ${userId}`);
    return this.addressRepository.find({
      where: { userId },
      order: { isDefault: "DESC", createdAt: "DESC" },
    });
  }

  async createAddress(
    userId: number,
    dto: CreateUserAddressDto,
  ): Promise<UserAddress> {
    this.logger.log(`createAddress for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const existingCount = await manager.count(UserAddress, {
        where: { userId },
      });
      // First address is always the default; otherwise honour the requested flag.
      const shouldBeDefault = existingCount === 0 || dto.isDefault === true;
      if (shouldBeDefault) {
        await manager.update(UserAddress, { userId }, { isDefault: false });
      }
      const address = manager.create(UserAddress, {
        ...dto,
        userId,
        publicId: generatePublicId(PUBLIC_ID_PREFIXES.ADDRESS),
        isDefault: shouldBeDefault,
      });
      return manager.save(address);
    });
  }

  async updateAddress(
    userId: number,
    addressId: number | string,
    dto: UpdateUserAddressDto,
  ): Promise<UserAddress> {
    this.logger.log(`updateAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where:
          typeof addressId === "number"
            ? { id: addressId, userId }
            : { publicId: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException(USER_MESSAGE.ADDRESS_NOT_FOUND);
      }
      // Promoting this address to default demotes every other one.
      if (dto.isDefault === true && !address.isDefault) {
        await manager.update(UserAddress, { userId }, { isDefault: false });
      }
      Object.assign(address, dto);
      return manager.save(address);
    });
  }

  async deleteAddress(
    userId: number,
    addressId: number | string,
  ): Promise<{ success: true }> {
    this.logger.log(`deleteAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where:
          typeof addressId === "number"
            ? { id: addressId, userId }
            : { publicId: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException(USER_MESSAGE.ADDRESS_NOT_FOUND);
      }
      const wasDefault = address.isDefault;
      await manager.remove(address);
      // Keep exactly one default: promote the most recent remaining address.
      if (wasDefault) {
        const nextDefault = await manager.findOne(UserAddress, {
          where: { userId },
          order: { createdAt: "DESC" },
        });
        if (nextDefault) {
          nextDefault.isDefault = true;
          await manager.save(nextDefault);
        }
      }
      return { success: true as const };
    });
  }

  async setDefaultAddress(
    userId: number,
    addressId: number | string,
  ): Promise<UserAddress> {
    this.logger.log(`setDefaultAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where:
          typeof addressId === "number"
            ? { id: addressId, userId }
            : { publicId: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException(USER_MESSAGE.ADDRESS_NOT_FOUND);
      }
      await manager.update(UserAddress, { userId }, { isDefault: false });
      address.isDefault = true;
      return manager.save(address);
    });
  }

  getServiceInfo(): string {
    this.logger.log("getServiceInfo called");
    return "User Service is up and running";
  }

  private toSafeUser(user: User): SafeUser {
    const safeUser: Partial<User> = { ...user };
    delete safeUser.password;
    return safeUser as SafeUser;
  }
}

import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  RegisterUserDto,
  LoginUserDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  UpdateUserGatewayDto,
} from "./dto/user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { retryOnTransportError } from "../common/exception/transport-error";
import { assertCloudinaryUrlsOwnedBy } from "../common/media/cloudinary-ownership";
import { JwtService } from "@nestjs/jwt";
import { TopSellingSeller, UserData, UserRole } from "./user.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";
import { CachedService } from "@app/cached";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  // AUD-0925-04: the featured-sellers rail is a 30-day aggregate, exactly like
  // the trending rail, so it gets the same 60s cache. The response depends on
  // `limit` only (no req.user), so one entry per limit serves every caller.
  private static readonly FEATURED_SELLERS_CACHE_PREFIX =
    "gw:user:featured-sellers:";
  private static readonly FEATURED_SELLERS_CACHE_TTL_SECONDS = 60;

  constructor(
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly jwtService: JwtService,
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    private readonly cached: CachedService,
  ) {}

  /**
   * The user service returns the eager-loaded `role` entity as-is (`rol_id`,
   * `rol_slug`, `rol_grants`, `rol_created_by`, …). Those snake_case columns —
   * and the whole permission matrix — must never reach the HTTP response, so
   * the boundary reshapes them to a camelCase summary. Only the exposed object
   * is trimmed: `generateJwtToken` still reads `rol_name`/`rol_grants` off the
   * raw TCP payload.
   */
  private exposeRole(role: unknown): unknown {
    if (!role || typeof role !== "object") {
      return role;
    }
    const raw = role as {
      rol_id?: unknown;
      rol_name?: unknown;
    };
    if (raw.rol_name === undefined && raw.rol_id === undefined) {
      return role;
    }
    // OVERFETCH-01 (5): `name` is the stable key — it is the `RoleName` enum
    // that JWT generation and every `CheckPermission` grant key off. `slug` was
    // a second spelling of the same value with no reader anywhere.
    return {
      id: raw.rol_id ?? null,
      name: raw.rol_name ?? null,
    };
  }

  /**
   * PUBID-02: the HTTP boundary exposes ONLY the opaque public id (`usr_...`).
   * Replaces the numeric `id` with `publicId` (stringified PK fallback for
   * rows predating the backfill) and drops the internal `publicId` copy.
   */
  private exposeUser(user: unknown): unknown {
    if (!user || typeof user !== "object") {
      return user;
    }
    const raw = user as {
      id?: unknown;
      publicId?: string | null;
      role?: unknown;
    };
    const exposed: Record<string, unknown> = {
      ...(user as Record<string, unknown>),
      id: raw.publicId ?? String(raw.id),
    };
    delete exposed.publicId;
    if ("role" in exposed) {
      exposed.role = this.exposeRole(raw.role);
    }
    return exposed;
  }

  private exposeAddress(
    address: unknown,
    userPublicId: string | null,
  ): unknown {
    if (!address || typeof address !== "object") {
      return address;
    }
    const raw = address as { id?: unknown; publicId?: string | null };
    const exposed: Record<string, unknown> = {
      ...(address as Record<string, unknown>),
      id: raw.publicId ?? String(raw.id),
      userId: userPublicId,
    };
    delete exposed.publicId;
    return exposed;
  }

  private async getUserPublicId(userId: number): Promise<string | null> {
    const user = (await firstValueFrom(
      this.userClient
        .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
    )) as { publicId?: string | null };
    return user.publicId ?? null;
  }

  async register(dto: RegisterUserDto): Promise<unknown> {
    try {
      this.logger.log(`Registering user: ${dto.email}`);
      return this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER }, dto)
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "register user",
        "User Service",
      );
    }
  }

  async login(dto: LoginUserDto): Promise<{ user: UserData; token: string }> {
    try {
      const loginPayload = { username: dto.username, password: dto.password };
      const userFound = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER }, loginPayload)
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as UserData;
      // JWT stays keyed on the internal numeric id; only the exposed user
      // object carries the opaque public id.
      const token = this.generateJwtToken(userFound, dto.rememberMe === true);
      return { user: this.exposeUser(userFound) as UserData, token };
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, "login user", "User Service");
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.FORGOT_PASSWORD }, dto)
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "forgot password",
        "User Service",
      );
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.RESET_PASSWORD }, dto)
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "reset password",
        "User Service",
      );
    }
  }

  /**
   * CHG-PW-01: the logged-in password change. The account is identified by the
   * JWT alone — no email/id in the body — and the issued cookie is deliberately
   * left untouched: the JWT is stateless, so rotating it here would refresh
   * this session without revoking any other one.
   */
  async changePassword(
    userId: number,
    dto: ChangePasswordDto,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.CHANGE_PASSWORD },
            {
              userId,
              currentPassword: dto.currentPassword,
              newPassword: dto.newPassword,
            },
          )
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "change password",
        "User Service",
      );
    }
  }

  generateJwtToken(user: UserData, isRememberMe = false): string {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role?.rol_name ?? "user",
      grants: user.role?.rol_grants ?? [],
    };
    // Remember-me sessions get an explicit 7d token so the JWT never expires
    // before the 7d cookie, regardless of JWT_EXPIRES_IN.
    return isRememberMe
      ? this.jwtService.sign(payload, { expiresIn: "7d" })
      : this.jwtService.sign(payload);
  }

  async getUserInfo(userId: string): Promise<unknown> {
    try {
      return this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
            .pipe(
              timeout(TCP_TIMEOUT_MS.READ),
              retryOnTransportError(),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `get user info for ID: ${userId}`,
        "User Service",
      );
    }
  }

  async getUsersPaginated(page: number, limit: number): Promise<unknown> {
    try {
      const paginated = (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_USERS_PAGINATED },
            { page, limit },
          )
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { data?: unknown[] };
      if (Array.isArray(paginated?.data)) {
        paginated.data = paginated.data.map((user) => this.exposeUser(user));
      }
      return paginated;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get users paginated",
        "User Service",
      );
    }
  }

  /**
   * RAIL-RANK-01: best-effort units-sold ranking from the orders service. A
   * failure degrades to `[]`, which makes the user service answer with the
   * newest shops — the rail is decoration, not worth a 502.
   */
  private async fetchTopSellingSellers(): Promise<TopSellingSeller[]> {
    try {
      const ranking: unknown = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.TOP_SELLING_SELLERS, {})
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      );
      return Array.isArray(ranking) ? (ranking as TopSellingSeller[]) : [];
    } catch (error: unknown) {
      this.logger.warn(
        `Top-selling seller ranking unavailable, falling back to newest shops: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * AUD-0925-04: the cache is best-effort both ways — a Redis failure reads as
   * a miss and a failed write is only logged, so Redis can never fail the rail.
   */
  private async readFeaturedSellersCache(
    cacheKey: string,
  ): Promise<unknown[] | null> {
    try {
      const cachedPayload = await this.cached.get(cacheKey);
      if (cachedPayload === null) {
        return null;
      }
      const cachedSellers: unknown = JSON.parse(cachedPayload);
      return Array.isArray(cachedSellers) ? cachedSellers : null;
    } catch (error: unknown) {
      this.logger.warn(
        `Featured sellers cache get failed for ${cacheKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async writeFeaturedSellersCache(
    cacheKey: string,
    featuredSellers: unknown[],
  ): Promise<void> {
    try {
      await this.cached.set(
        cacheKey,
        JSON.stringify(featuredSellers),
        UserService.FEATURED_SELLERS_CACHE_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Featured sellers cache set failed for ${cacheKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getFeaturedSellers(limit: number): Promise<unknown> {
    const cacheKey = `${UserService.FEATURED_SELLERS_CACHE_PREFIX}${limit}`;
    const cachedSellers = await this.readFeaturedSellersCache(cacheKey);
    if (cachedSellers !== null) {
      return cachedSellers;
    }

    try {
      const ranking = await this.fetchTopSellingSellers();
      const soldCountBySellerId = new Map(
        ranking.map((row) => [Number(row.sellerId), Number(row.soldCount)]),
      );
      const sellers = (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_FEATURED_SELLERS },
            {
              limit,
              rankedSellerIds: ranking.map((row) => Number(row.sellerId)),
            },
          )
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
      if (!Array.isArray(sellers)) {
        return sellers;
      }
      // soldCount is additive (RAIL-RANK-01); a backfilled shop sold 0 units
      // inside the ranking window, or the ranking leg failed.
      const featuredSellers = sellers.map((seller: { id?: unknown }) => ({
        ...(this.exposeUser(seller) as Record<string, unknown>),
        soldCount: soldCountBySellerId.get(Number(seller.id)) ?? 0,
      }));
      // A degraded answer (ranking leg down → pure backfill) is cached too, as
      // on the trending rail: otherwise every call would re-wait a failing
      // orders service. A user-service failure throws before this line, so an
      // error is never cached.
      await this.writeFeaturedSellersCache(cacheKey, featuredSellers);
      return featuredSellers;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get featured sellers",
        "User Service",
      );
    }
  }

  async searchUsers(q: string, limit: number): Promise<unknown[]> {
    try {
      const users = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.SEARCH_USERS }, { q, limit })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
      // SHAPE-01 rule 1: the contract declares a collection — never `null`.
      return Array.isArray(users)
        ? users.map((user) => this.exposeUser(user))
        : [];
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "search users",
        "User Service",
      );
    }
  }

  /**
   * ROLE-ADMIN-01: `role` here is read from the DB, so it goes stale the moment
   * an admin changes it — while every guard keeps enforcing the role baked into
   * the still-live JWT. A client that gates its UI on the DB role therefore lets
   * a freshly promoted `shop` into the seller pages and only fails at submit
   * time with a 403. The session's own role is not observable to the client
   * (httpOnly cookie), so the boundary reports it: `tokenRole` is what the
   * guards enforce, `isRoleStale` says the two have drifted apart and the user
   * must log out and back in.
   */
  async getMe(userId: number, tokenRole: string): Promise<unknown> {
    try {
      const exposed = this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.GET_ME }, { userId })
            .pipe(
              timeout(TCP_TIMEOUT_MS.READ),
              retryOnTransportError(),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      ) as Record<string, unknown>;
      const role = exposed.role as { name?: unknown } | null | undefined;
      const databaseRole = typeof role?.name === "string" ? role.name : null;
      return {
        ...exposed,
        tokenRole,
        // An unreadable DB role is not evidence of drift — say "not stale"
        // rather than logging the user out over a shape we did not expect.
        isRoleStale: databaseRole !== null && databaseRole !== tokenRole,
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, "get me", "User Service");
    }
  }

  async updateUser(
    requesterId: number,
    targetId: string,
    dto: UpdateUserGatewayDto,
  ): Promise<unknown> {
    // PUBID-02: the route param is the opaque `usr_...` id while the JWT holds
    // the numeric requester id — the user service resolves the target and
    // enforces ownership (403 on mismatch).
    if (dto.avatar) {
      assertCloudinaryUrlsOwnedBy([dto.avatar], requesterId);
    }
    try {
      return this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send(
              { cmd: USER_MESSAGE_PATTERN.UPDATE_USER },
              { userId: requesterId, targetId, dto },
            )
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update user ${targetId}`,
        "User Service",
      );
    }
  }

  /**
   * ROLE-ADMIN-01: admin-only role change (e.g. promoting a buyer to `shop`).
   * The target is the route's opaque `usr_...` id; `requesterId` is the admin's
   * numeric JWT id, sent so the user service can refuse a self-change.
   */
  async updateUserRole(
    requesterId: number,
    targetId: string,
    role: UserRole["rol_name"],
  ): Promise<unknown> {
    try {
      return this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send(
              { cmd: USER_MESSAGE_PATTERN.UPDATE_USER_ROLE },
              { requesterId, targetId, role },
            )
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update role for user ${targetId}`,
        "User Service",
      );
    }
  }

  async listAddresses(userId: number): Promise<unknown> {
    try {
      const addresses = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.ADDRESS_LIST }, { userId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
      const userPublicId = await this.getUserPublicId(userId);
      return Array.isArray(addresses)
        ? addresses.map((address) => this.exposeAddress(address, userPublicId))
        : addresses;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list addresses",
        "User Service",
      );
    }
  }

  async createAddress(
    userId: number,
    dto: CreateUserAddressDto,
  ): Promise<unknown> {
    try {
      const userPublicId = await this.getUserPublicId(userId);
      return this.exposeAddress(
        await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.ADDRESS_CREATE }, { userId, dto })
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
        userPublicId,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create address",
        "User Service",
      );
    }
  }

  async updateAddress(
    userId: number,
    addressId: string,
    dto: UpdateUserAddressDto,
  ): Promise<unknown> {
    try {
      const userPublicId = await this.getUserPublicId(userId);
      return this.exposeAddress(
        await firstValueFrom(
          this.userClient
            .send(
              { cmd: USER_MESSAGE_PATTERN.ADDRESS_UPDATE },
              { userId, addressId, dto },
            )
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
        userPublicId,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update address ${addressId}`,
        "User Service",
      );
    }
  }

  async deleteAddress(userId: number, addressId: string): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.ADDRESS_DELETE },
            { userId, addressId },
          )
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `delete address ${addressId}`,
        "User Service",
      );
    }
  }

  async setDefaultAddress(userId: number, addressId: string): Promise<unknown> {
    try {
      const userPublicId = await this.getUserPublicId(userId);
      return this.exposeAddress(
        await firstValueFrom(
          this.userClient
            .send(
              { cmd: USER_MESSAGE_PATTERN.ADDRESS_SET_DEFAULT },
              { userId, addressId },
            )
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
        userPublicId,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `set default address ${addressId}`,
        "User Service",
      );
    }
  }
}

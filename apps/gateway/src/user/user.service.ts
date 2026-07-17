import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  RegisterUserDto,
  LoginUserDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateUserGatewayDto,
} from "./dto/user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { assertCloudinaryUrlsOwnedBy } from "../common/media/cloudinary-ownership";
import { JwtService } from "@nestjs/jwt";
import { UserData } from "./user.types";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * PUBID-02: the HTTP boundary exposes ONLY the opaque public id (`usr_...`).
   * Replaces the numeric `id` with `publicId` (stringified PK fallback for
   * rows predating the backfill) and drops the internal `publicId` copy.
   */
  private exposeUser(user: unknown): unknown {
    if (!user || typeof user !== "object") {
      return user;
    }
    const raw = user as { id?: unknown; publicId?: string | null };
    const exposed: Record<string, unknown> = {
      ...(user as Record<string, unknown>),
      id: raw.publicId ?? String(raw.id),
    };
    delete exposed.publicId;
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
        .pipe(timeout(10000)),
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
              timeout(10000),
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
            timeout(10000),
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
            timeout(10000),
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
            timeout(10000),
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
              timeout(10000),
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
            timeout(10000),
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

  async getFeaturedSellers(limit: number): Promise<unknown> {
    try {
      const sellers = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_FEATURED_SELLERS }, { limit })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
      return Array.isArray(sellers)
        ? sellers.map((seller) => this.exposeUser(seller))
        : sellers;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get featured sellers",
        "User Service",
      );
    }
  }

  async getMe(userId: number): Promise<unknown> {
    try {
      return this.exposeUser(
        await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.GET_ME }, { userId })
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
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
              timeout(10000),
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

  async listAddresses(userId: number): Promise<unknown> {
    try {
      const addresses = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.ADDRESS_LIST }, { userId })
          .pipe(
            timeout(10000),
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
              timeout(10000),
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
              timeout(10000),
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
            timeout(10000),
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
              timeout(10000),
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

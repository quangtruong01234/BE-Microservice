import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
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
import { USER_MESSAGE } from "libs/constant/response-message.constant";
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

  async register(dto: RegisterUserDto): Promise<unknown> {
    try {
      this.logger.log(`Registering user: ${dto.email}`);
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER }, dto)
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
      const token = this.generateJwtToken(userFound, dto.rememberMe === true);
      return { user: userFound, token };
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

  async getUserInfo(userId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, userId)
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
        `get user info for ID: ${userId}`,
        "User Service",
      );
    }
  }

  async getUsersPaginated(page: number, limit: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
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
      )) as unknown;
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
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_FEATURED_SELLERS }, { limit })
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
        "get featured sellers",
        "User Service",
      );
    }
  }

  async getMe(userId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_ME }, { userId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, "get me", "User Service");
    }
  }

  async updateUser(
    requesterId: number,
    targetId: number,
    dto: UpdateUserGatewayDto,
  ): Promise<unknown> {
    if (requesterId !== targetId) {
      throw new ForbiddenException(USER_MESSAGE.CANNOT_UPDATE_ANOTHER_USER);
    }
    if (dto.avatar) {
      assertCloudinaryUrlsOwnedBy([dto.avatar], requesterId);
    }
    try {
      return (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.UPDATE_USER },
            { userId: targetId, dto },
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
        `update user ${targetId}`,
        "User Service",
      );
    }
  }

  async listAddresses(userId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.ADDRESS_LIST }, { userId })
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
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.ADDRESS_CREATE }, { userId, dto })
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
        "create address",
        "User Service",
      );
    }
  }

  async updateAddress(
    userId: number,
    addressId: number,
    dto: UpdateUserAddressDto,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
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
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update address ${addressId}`,
        "User Service",
      );
    }
  }

  async deleteAddress(userId: number, addressId: number): Promise<unknown> {
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

  async setDefaultAddress(userId: number, addressId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
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
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `set default address ${addressId}`,
        "User Service",
      );
    }
  }
}

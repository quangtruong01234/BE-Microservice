import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { RegisterUserDto, LoginUserDto } from "./dto/user.dto";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { JwtService } from "@nestjs/jwt";

type RoleGrant = {
  resourceId: number;
  actions: string[];
  attributes: string;
  conditions: string;
};

type UserRole = {
  rol_name: "admin" | "shop" | "user";
  rol_grants: RoleGrant[];
};

type UserData = {
  id?: string | number;
  username?: string;
  email?: string;
  role?: UserRole | null;
  [key: string]: unknown;
};

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
      const userFound = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER }, dto)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as UserData;
      const token = this.generateJwtToken(userFound);
      return { user: userFound, token };
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, "login user", "User Service");
    }
  }

  generateJwtToken(user: UserData): string {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role?.rol_name ?? "user",
      grants: user.role?.rol_grants ?? [],
    };
    return this.jwtService.sign(payload);
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

  async getAllUsers(): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_ALL_USERS }, {})
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
        "get all users",
        "User Service",
      );
    }
  }
}

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { RegisterUserDto, LoginUserDto } from './dto/user.dto';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { throwError } from 'rxjs';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { USER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.USER_SERVICE) private readonly userClient: ClientProxy,
  ) {}

  async register(dto: RegisterUserDto) {
    try {
      this.logger.log(`Registering user: ${dto.email}`);
      return await firstValueFrom(
        this.userClient.send({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER }, dto).pipe(
          timeout(10000),
          catchError((error) => throwError(() => error))
        )
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'register user', 'User Service');
    }
  }

  async login(dto: LoginUserDto) {
    try {
      // this.logger.log(`User login attempt: ${dto.email}`);
      return await firstValueFrom(
        this.userClient.send({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER }, dto).pipe(
          timeout(10000),
          catchError((error) => throwError(() => error))
        )
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'login user', 'User Service');
    }
  }

  async getUserInfo(userId: number) {
    try {
      return await firstValueFrom(
        this.userClient.send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, userId).pipe(
          timeout(10000),
          catchError((error) => throwError(() => error))
        )
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, `get user info for ID: ${userId}`, 'User Service');
    }
  }

  async getAllUsers() {
    try {
      return await firstValueFrom(
        this.userClient.send({ cmd: USER_MESSAGE_PATTERN.GET_ALL_USERS }, {}).pipe(
          timeout(10000),
          catchError((error) => throwError(() => error))
        )
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get all users', 'User Service');
    }
  }
}

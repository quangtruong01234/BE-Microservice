import { Controller, Get, Logger } from '@nestjs/common';
import { UserService } from './user.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { USER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(private readonly userService: UserService) {}

  // Get information about the user service
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO })
  getUserInfo(@Payload() userId: number) {
    this.logger.log(`getUserInfo called with userId: ${userId}`);
    return this.userService.getInfo(userId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER })
  async register(@Payload() payload: RegisterUserDto) {
    return await this.userService.register(payload);
  }

  //GET_ALL_USERS
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_ALL_USERS })
  async getAllUsers() {
    return await this.userService.getAllUsers();
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER })
  async login(@Payload() payload: LoginUserDto) {
    this.logger.log(`[USER-TCP] Login user`);
    this.logger.log(`[USER-TCP] Payload received:`, payload);
    return await this.userService.login(payload);
  }
}

import { Controller, Logger } from "@nestjs/common";
import { UserService } from "./user.service";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { RegisterUserDto } from "./dto/register-user.dto";
import { LoginUserDto } from "./dto/login-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(private readonly userService: UserService) {}

  // Get information about the user service
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO })
  getUserInfo(
    @Payload() payload: number | { userId: number; includeEmail?: boolean },
  ) {
    const userId = typeof payload === "number" ? payload : payload.userId;
    const includeEmail =
      typeof payload === "number" ? false : payload.includeEmail === true;
    this.logger.log(`getUserInfo called with userId: ${userId}`);
    return this.userService.getInfo(userId, includeEmail);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER })
  async register(@Payload() payload: RegisterUserDto) {
    return await this.userService.register(payload);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USERS_PAGINATED })
  async getUsersPaginated(
    @Payload() data: { page: number; limit: number },
  ): Promise<unknown> {
    return this.userService.getUsersPaginated(data.page, data.limit);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS })
  async getUsersByIds(
    @Payload()
    payload: number[] | { userIds: number[]; includeEmail?: boolean },
  ): Promise<unknown> {
    const userIds = Array.isArray(payload) ? payload : payload.userIds;
    const includeEmail = Array.isArray(payload)
      ? false
      : payload.includeEmail === true;
    return this.userService.getUsersByIds(userIds, includeEmail);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_FEATURED_SELLERS })
  async getFeaturedSellers(
    @Payload() data: { limit: number },
  ): Promise<unknown> {
    return this.userService.getFeaturedSellers(data.limit);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER })
  async login(@Payload() payload: LoginUserDto) {
    this.logger.log(`[USER-TCP] Login user`);
    this.logger.log(`[USER-TCP] Payload received:`, payload);
    return await this.userService.login(payload);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_ME })
  async getMe(@Payload() data: { userId: number }) {
    return this.userService.getMe(data.userId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.UPDATE_USER })
  async updateUser(@Payload() data: { userId: number; dto: UpdateUserDto }) {
    return this.userService.updateUser(data.userId, data.dto);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_LIST })
  async listAddresses(@Payload() data: { userId: number }) {
    return this.userService.listAddresses(data.userId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_CREATE })
  async createAddress(
    @Payload() data: { userId: number; dto: CreateUserAddressDto },
  ) {
    return this.userService.createAddress(data.userId, data.dto);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_UPDATE })
  async updateAddress(
    @Payload()
    data: {
      userId: number;
      addressId: number;
      dto: UpdateUserAddressDto;
    },
  ) {
    return this.userService.updateAddress(
      data.userId,
      data.addressId,
      data.dto,
    );
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_DELETE })
  async deleteAddress(@Payload() data: { userId: number; addressId: number }) {
    return this.userService.deleteAddress(data.userId, data.addressId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_SET_DEFAULT })
  async setDefaultAddress(
    @Payload() data: { userId: number; addressId: number },
  ) {
    return this.userService.setDefaultAddress(data.userId, data.addressId);
  }
}

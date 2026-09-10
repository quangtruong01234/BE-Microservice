import { Controller, ForbiddenException, Logger } from "@nestjs/common";
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
import { USER_MESSAGE } from "libs/constant/response-message.constant";
import { UserAddress } from "./entity/user-address.entity";
import { User } from "./entity/user.entity";
import { SafeUser } from "./user.types";

@Controller()
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(private readonly userService: UserService) {}

  // Get information about the user service
  // PUBID-02: userId may be the internal number (orders invoice, notification
  // email) or the opaque `usr_...` public id (gateway HTTP profile route).
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO })
  async getUserInfo(
    @Payload()
    payload: number | { userId: number | string; includeEmail?: boolean },
  ): Promise<unknown> {
    const userId = typeof payload === "number" ? payload : payload.userId;
    const includeEmail =
      typeof payload === "number" ? false : payload.includeEmail === true;
    this.logger.log(`getUserInfo called with userId: ${userId}`);
    const internalId = await this.userService.resolveUserId(userId);
    return this.userService.getInfo(internalId, includeEmail);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER })
  async register(@Payload() payload: RegisterUserDto): Promise<SafeUser> {
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
    payload:
      | number[]
      | {
          userIds: number[];
          includeEmail?: boolean;
          includeProvince?: boolean;
        },
  ): Promise<unknown> {
    const userIds = Array.isArray(payload) ? payload : payload.userIds;
    const includeEmail = Array.isArray(payload)
      ? false
      : payload.includeEmail === true;
    const includeProvince = Array.isArray(payload)
      ? false
      : payload.includeProvince === true;
    return this.userService.getUsersByIds(
      userIds,
      includeEmail,
      includeProvince,
    );
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_USER_IDS_BY_PROVINCE })
  async getUserIdsByProvince(
    @Payload() payload: { provinceIds: number[] },
  ): Promise<number[]> {
    const provinceIds = Array.isArray(payload.provinceIds)
      ? payload.provinceIds.map(Number).filter((id) => !isNaN(id))
      : [];
    return this.userService.getUserIdsByProvince(provinceIds);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_FEATURED_SELLERS })
  async getFeaturedSellers(
    @Payload() data: { limit: number },
  ): Promise<unknown> {
    return this.userService.getFeaturedSellers(data.limit);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER })
  async login(@Payload() payload: LoginUserDto): Promise<unknown> {
    this.logger.log(`[USER-TCP] Login user: ${payload.username}`);
    return await this.userService.login(payload);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.FORGOT_PASSWORD })
  async forgotPassword(
    @Payload() payload: { email: string },
  ): Promise<{ message: string }> {
    return await this.userService.forgotPassword(payload.email);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.RESET_PASSWORD })
  async resetPassword(
    @Payload() payload: { email: string; code: string; newPassword: string },
  ): Promise<{ success: true }> {
    return await this.userService.resetPassword(
      payload.email,
      payload.code,
      payload.newPassword,
    );
  }

  // CHG-PW-01: `userId` is the numeric JWT id the gateway already trusts — the
  // caller can only ever change its own password.
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.CHANGE_PASSWORD })
  async changePassword(
    @Payload()
    payload: {
      userId: number;
      currentPassword: string;
      newPassword: string;
    },
  ): Promise<{ success: true }> {
    return await this.userService.changePassword(
      payload.userId,
      payload.currentPassword,
      payload.newPassword,
    );
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.GET_ME })
  async getMe(@Payload() data: { userId: number }): Promise<SafeUser> {
    return this.userService.getMe(data.userId);
  }

  // PUBID-02: the gateway sends the route's `usr_...` target separately from
  // the requester's numeric JWT id; ownership is checked here where the
  // public id can be resolved. Omitted targetId = self-update (getMe-style).
  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.UPDATE_USER })
  async updateUser(
    @Payload()
    data: {
      userId: number;
      targetId?: number | string;
      dto: UpdateUserDto;
    },
  ): Promise<User> {
    if (data.targetId !== undefined) {
      const resolvedTargetId = await this.userService.resolveUserId(
        data.targetId,
      );
      if (resolvedTargetId !== data.userId) {
        throw new ForbiddenException(USER_MESSAGE.CANNOT_UPDATE_ANOTHER_USER);
      }
    }
    return this.userService.updateUser(data.userId, data.dto);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_LIST })
  async listAddresses(
    @Payload() data: { userId: number },
  ): Promise<UserAddress[]> {
    return this.userService.listAddresses(data.userId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_CREATE })
  async createAddress(
    @Payload() data: { userId: number; dto: CreateUserAddressDto },
  ): Promise<UserAddress> {
    return this.userService.createAddress(data.userId, data.dto);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_UPDATE })
  async updateAddress(
    @Payload()
    data: {
      userId: number;
      addressId: number | string;
      dto: UpdateUserAddressDto;
    },
  ): Promise<UserAddress> {
    return this.userService.updateAddress(
      data.userId,
      data.addressId,
      data.dto,
    );
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_DELETE })
  async deleteAddress(
    @Payload() data: { userId: number; addressId: number | string },
  ): Promise<{ success: true }> {
    return this.userService.deleteAddress(data.userId, data.addressId);
  }

  @MessagePattern({ cmd: USER_MESSAGE_PATTERN.ADDRESS_SET_DEFAULT })
  async setDefaultAddress(
    @Payload() data: { userId: number; addressId: number | string },
  ): Promise<UserAddress> {
    return this.userService.setDefaultAddress(data.userId, data.addressId);
  }
}

import {
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
import { DataSource, FindOptionsSelect, In, Repository } from "typeorm";
import { RegisterUserDto } from "./dto/register-user.dto";
import { LoginUserDto } from "./dto/login-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  CreateUserAddressDto,
  UpdateUserAddressDto,
} from "./dto/user-address.dto";
import { PaginatedResponse } from "@app/common";
import * as bcrypt from "bcryptjs";

type SafeUser = Omit<User, "password">;
type PublicUserProfile = Pick<
  User,
  "id" | "username" | "name" | "avatar" | "isActive"
>;
type UserProfile = PublicUserProfile & Partial<Pick<User, "email">>;

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
  ) {}

  async getUsersPaginated(
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<SafeUser>> {
    this.logger.log(`Fetching users page=${page} limit=${limit}`);
    const [users, total] = await this.userRepository.findAndCount({
      select: {
        id: true,
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

  async register(dto: RegisterUserDto): Promise<SafeUser> {
    this.logger.log(`Register user: ${dto.username}`);
    const defaultRole = await this.roleRepository.findOne({
      where: { rol_name: RoleName.USER, rol_status: RoleStatus.ACTIVE },
    });
    if (!defaultRole) {
      throw new InternalServerErrorException(
        "Default role not found, please run seed",
      );
    }
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      password: hashedPassword,
      role: defaultRole,
    });
    const saved = await this.userRepository.save(user);
    return this.toSafeUser(saved);
  }

  async login(dto: LoginUserDto): Promise<User> {
    this.logger.log(`Login user: ${dto.username}`);
    const user = await this.userRepository.findOne({
      where: { username: dto.username },
    });
    if (!user) {
      throw new UnauthorizedException("Invalid username or password");
    }
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException("Invalid username or password");
    }
    return user;
  }

  async getInfo(
    userId: number,
    includeEmail = false,
  ): Promise<UserProfile | null> {
    this.logger.log(`Get info for userId: ${userId}`);
    const select: FindOptionsSelect<User> = {
      id: true,
      username: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    if (includeEmail) {
      select.email = true;
    }
    return await this.userRepository.findOne({ where: { id: userId }, select });
  }

  async getUsersByIds(
    userIds: number[],
    includeEmail = false,
  ): Promise<UserProfile[]> {
    if (userIds.length === 0) return [];
    const select: FindOptionsSelect<User> = {
      id: true,
      username: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    if (includeEmail) {
      select.email = true;
    }
    return this.userRepository.find({ where: { id: In(userIds) }, select });
  }

  async getFeaturedSellers(
    limit: number,
  ): Promise<Pick<User, "id" | "username" | "name" | "avatar">[]> {
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
      .select(["user.id", "user.username", "user.name", "user.avatar"])
      .getMany();
  }

  async getMe(userId: number): Promise<SafeUser> {
    this.logger.log(`getMe called with userId: ${userId}`);
    // No partial `select` here: the `role` relation is `eager: true`, so a plain
    // findOne auto-joins it (same query shape as `login`). A partial `select`
    // that also lists relation columns double-joins the eager relation on MySQL
    // and fails. Strip the password instead of column-selecting.
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return this.toSafeUser(user);
  }

  async updateUser(userId: number, dto: UpdateUserDto): Promise<User> {
    this.logger.log(`updateUser called with userId: ${userId}`);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    Object.assign(user, dto);
    const saved = await this.userRepository.save(user);
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
        isDefault: shouldBeDefault,
      });
      return manager.save(address);
    });
  }

  async updateAddress(
    userId: number,
    addressId: number,
    dto: UpdateUserAddressDto,
  ): Promise<UserAddress> {
    this.logger.log(`updateAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where: { id: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException("Address not found");
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
    addressId: number,
  ): Promise<{ success: true }> {
    this.logger.log(`deleteAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where: { id: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException("Address not found");
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
    addressId: number,
  ): Promise<UserAddress> {
    this.logger.log(`setDefaultAddress ${addressId} for userId: ${userId}`);
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOne(UserAddress, {
        where: { id: addressId, userId },
      });
      if (!address) {
        throw new NotFoundException("Address not found");
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

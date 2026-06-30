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
import { In, Repository } from "typeorm";
import { RegisterUserDto } from "./dto/register-user.dto";
import { LoginUserDto } from "./dto/login-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { PaginatedResponse } from "@app/common";
import * as bcrypt from "bcryptjs";

type SafeUser = Omit<User, "password">;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async getAllUsers(): Promise<SafeUser[]> {
    this.logger.log("Fetching all users");
    const users = await this.userRepository.find({
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
    });
    return users.map((user) => this.toSafeUser(user));
  }

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

  async getInfo(userId: number): Promise<User | null> {
    this.logger.log(`Get info for userId: ${userId}`);
    const select = {
      id: true,
      username: true,
      email: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    return await this.userRepository.findOne({ where: { id: userId }, select });
  }

  async getUsersByIds(
    userIds: number[],
  ): Promise<
    Pick<User, "id" | "username" | "email" | "name" | "avatar" | "isActive">[]
  > {
    if (userIds.length === 0) return [];
    const select = {
      id: true,
      username: true,
      email: true,
      name: true,
      avatar: true,
      isActive: true,
    };
    return this.userRepository.find({ where: { id: In(userIds) }, select });
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

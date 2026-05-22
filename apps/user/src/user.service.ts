import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entity/user.entity";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { Repository } from "typeorm";
import { RegisterUserDto } from "./dto/register-user.dto";
import { LoginUserDto } from "./dto/login-user.dto";
import * as bcrypt from "bcryptjs";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async getAllUsers(): Promise<User[]> {
    this.logger.log("Fetching all users");
    return await this.userRepository.find();
  }
  async register(dto: RegisterUserDto): Promise<User> {
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
    return await this.userRepository.save(user);
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

  getServiceInfo(): string {
    this.logger.log("getServiceInfo called");
    return "User Service is up and running";
  }
}

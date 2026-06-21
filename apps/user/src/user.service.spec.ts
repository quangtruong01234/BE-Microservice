import { getRepositoryToken } from "@nestjs/typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { User } from "./entity/user.entity";
import { UserService } from "./user.service";

describe("UserService", () => {
  let service: UserService;
  const role = {
    id: 1,
    rol_name: RoleName.USER,
    rol_status: RoleStatus.ACTIVE,
  } as unknown as Role;
  const persistedUser = {
    id: 1,
    username: "test-user",
    password: "hashed-password",
    email: "test@example.com",
    name: null,
    avatar: null,
    isActive: true,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
  const userRepository = {
    create: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const roleRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: roleRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it("does not return password hashes when listing users", async () => {
    userRepository.find.mockResolvedValue([persistedUser]);

    const users = await service.getAllUsers();

    expect(users[0]).not.toHaveProperty("password");
    expect(userRepository.find).toHaveBeenCalledWith({
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
  });

  it("does not return the password hash after registration", async () => {
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.create.mockReturnValue(persistedUser);
    userRepository.save.mockResolvedValue(persistedUser);

    const user = await service.register({
      username: "test-user",
      password: "password123",
      email: "test@example.com",
    });

    expect(user).not.toHaveProperty("password");
  });
});

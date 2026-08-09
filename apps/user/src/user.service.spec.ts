import { getRepositoryToken } from "@nestjs/typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import { CachedService } from "@app/cached";
import { CloudinaryService, MailerService } from "@app/common";
import { ConflictException } from "@nestjs/common";
import { DataSource, QueryFailedError } from "typeorm";
import * as bcrypt from "bcryptjs";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { UserAddress } from "./entity/user-address.entity";
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
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const roleRepository = {
    findOne: jest.fn(),
  };
  const addressRepository = {
    find: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(),
  };
  const cachedService = {};
  const mailerService = {};
  const cloudinaryService = {};

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
        {
          provide: getRepositoryToken(UserAddress),
          useValue: addressRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: CachedService,
          useValue: cachedService,
        },
        {
          provide: MailerService,
          useValue: mailerService,
        },
        {
          provide: CloudinaryService,
          useValue: cloudinaryService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it("does not return password hashes when listing users", async () => {
    userRepository.findAndCount.mockResolvedValue([[persistedUser], 1]);

    const usersPage = await service.getUsersPaginated(1, 20);

    expect(usersPage.data[0]).not.toHaveProperty("password");
    expect(userRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          publicId: true,
          username: true,
          email: true,
          name: true,
          avatar: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
  });

  it("does not return the password hash after registration", async () => {
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.find.mockResolvedValue([]);
    userRepository.create.mockReturnValue(persistedUser);
    userRepository.save.mockResolvedValue(persistedUser);

    const user = await service.register({
      username: "test-user",
      password: "password123",
      email: "test@example.com",
    });

    expect(user).not.toHaveProperty("password");
  });

  it("rejects a duplicate username with 409 instead of a raw DB error", async () => {
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.find.mockResolvedValue([
      { id: 9, username: "test-user", email: "other@example.com" },
    ]);

    await expect(
      service.register({
        username: "test-user",
        password: "password123",
        email: "new@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email with 409 instead of a raw DB error", async () => {
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.find.mockResolvedValue([
      { id: 9, username: "someone-else", email: "test@example.com" },
    ]);

    await expect(
      service.register({
        username: "brand-new-user",
        password: "password123",
        email: "test@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it("maps a racing ER_DUP_ENTRY on save to 409", async () => {
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.find.mockResolvedValue([]);
    userRepository.create.mockReturnValue(persistedUser);
    const driverError = Object.assign(new Error("ER_DUP_ENTRY"), {
      code: "ER_DUP_ENTRY",
      sqlMessage:
        "Duplicate entry 'test@example.com' for key 'users.IDX_email'",
    });
    userRepository.save.mockRejectedValue(
      new QueryFailedError("INSERT", [], driverError),
    );

    await expect(
      service.register({
        username: "test-user",
        password: "password123",
        email: "test@example.com",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not return the password hash after login", async () => {
    const passwordHash = await bcrypt.hash("password123", 4);
    userRepository.findOne.mockResolvedValue({
      ...persistedUser,
      password: passwordHash,
    });

    const user = await service.login({
      username: "test-user",
      password: "password123",
    });

    expect(user).not.toHaveProperty("password");
    expect(user).toMatchObject({
      id: persistedUser.id,
      username: persistedUser.username,
      email: persistedUser.email,
      role,
    });
  });

  it("does not select email for public user info", async () => {
    userRepository.findOne.mockResolvedValue({
      id: persistedUser.id,
      username: persistedUser.username,
      name: persistedUser.name,
      avatar: persistedUser.avatar,
      isActive: persistedUser.isActive,
    });

    const user = await service.getInfo(1);

    expect(user).not.toHaveProperty("email");
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        publicId: true,
        username: true,
        name: true,
        avatar: true,
        isActive: true,
      },
      // The eager `role` relation must never ride along into public embeds.
      loadEagerRelations: false,
    });
  });

  it("does not select email for batched public user info", async () => {
    userRepository.find.mockResolvedValue([
      {
        id: persistedUser.id,
        username: persistedUser.username,
        name: persistedUser.name,
        avatar: persistedUser.avatar,
        isActive: persistedUser.isActive,
      },
    ]);

    const users = await service.getUsersByIds([1]);

    expect(users[0]).not.toHaveProperty("email");
    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        loadEagerRelations: false,
        select: {
          id: true,
          publicId: true,
          username: true,
          name: true,
          avatar: true,
          isActive: true,
        },
      }),
    );
  });

  it("selects email only when public user info explicitly asks for it", async () => {
    userRepository.findOne.mockResolvedValue(persistedUser);

    await service.getInfo(1, true);

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        publicId: true,
        username: true,
        name: true,
        avatar: true,
        isActive: true,
        email: true,
      },
      loadEagerRelations: false,
    });
  });

  it("selects email only when batched user info explicitly asks for it", async () => {
    userRepository.find.mockResolvedValue([persistedUser]);

    await service.getUsersByIds([1], true);

    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          publicId: true,
          username: true,
          name: true,
          avatar: true,
          isActive: true,
          email: true,
        },
      }),
    );
  });
});

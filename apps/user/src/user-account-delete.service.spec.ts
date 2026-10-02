import { getRepositoryToken } from "@nestjs/typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { CachedService } from "@app/cached";
import { CloudinaryService, MailerService } from "@app/common";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import { SESSION_VALID_AFTER_KEY_PREFIX } from "libs/constant/session.constant";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { UserAddress } from "./entity/user-address.entity";
import { User } from "./entity/user.entity";
import { UserService } from "./user.service";

describe("UserService account deletion (ACCOUNT-DELETE-01)", () => {
  let service: UserService;
  const passwordHash = bcrypt.hashSync("right-password", 4);
  const userRepository = { findOne: jest.fn() };
  const manager = { update: jest.fn(), delete: jest.fn() };
  const dataSource = {
    transaction: jest.fn(
      (work: (entityManager: typeof manager) => Promise<void>) => work(manager),
    ),
  };
  const cachedService = { set: jest.fn(), del: jest.fn() };
  const cloudinaryService = { destroyAssets: jest.fn() };

  function buildUser(roleName: RoleName = RoleName.USER): User {
    return {
      id: 9,
      publicId: "usr_abc123",
      username: "buyer9",
      email: "buyer@example.com",
      name: "Buyer Nine",
      avatar: "https://res.cloudinary.com/demo/avatar.png",
      password: passwordHash,
      isActive: true,
      role: {
        rol_id: 1,
        rol_name: roleName,
        rol_status: RoleStatus.ACTIVE,
      } as unknown as Role,
    } as unknown as User;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(buildUser());
    cachedService.set.mockResolvedValue("OK");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Role), useValue: {} },
        { provide: getRepositoryToken(UserAddress), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: CachedService, useValue: cachedService },
        { provide: MailerService, useValue: {} },
        { provide: CloudinaryService, useValue: cloudinaryService },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  // TC-1
  it("rejects a wrong password with 401 INVALID_CURRENT_PASSWORD and writes nothing", async () => {
    const rejection = service.deleteAccount(9, "wrong-password");
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verifyAccountDeletion(9, "wrong-password"),
    ).rejects.toMatchObject({
      response: { errorCode: "INVALID_CURRENT_PASSWORD" },
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(cachedService.set).not.toHaveBeenCalled();
  });

  it("forbids an admin from deleting itself", async () => {
    userRepository.findOne.mockResolvedValue(buildUser(RoleName.ADMIN));
    await expect(
      service.verifyAccountDeletion(9, "right-password"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteAccount(9, "right-password"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("rejects an already-deleted account with 400", async () => {
    userRepository.findOne.mockResolvedValue({
      ...buildUser(),
      isActive: false,
    });
    await expect(
      service.verifyAccountDeletion(9, "right-password"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("verify passes for the right password without writing", async () => {
    await expect(
      service.verifyAccountDeletion(9, "right-password"),
    ).resolves.toEqual({ success: true });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  // TC-2
  it("scrubs the profile, deletes addresses and revokes every session", async () => {
    await expect(service.deleteAccount(9, "right-password")).resolves.toEqual({
      success: true,
    });

    expect(manager.update).toHaveBeenCalledTimes(1);
    const [entity, userId, scrub] = manager.update.mock.calls[0] as [
      unknown,
      number,
      Partial<User>,
    ];
    expect(entity).toBe(User);
    expect(userId).toBe(9);
    expect(scrub).toMatchObject({
      username: "deleted_usr_abc123",
      email: "deleted+usr_abc123@deleted.invalid",
      name: null,
      avatar: null,
      isActive: false,
    });
    expect(scrub.password).not.toBe(passwordHash);
    expect(bcrypt.compareSync("right-password", scrub.password ?? "")).toBe(
      false,
    );
    expect(manager.delete).toHaveBeenCalledWith(UserAddress, { userId: 9 });
    expect(cachedService.set).toHaveBeenCalledWith(
      `${SESSION_VALID_AFTER_KEY_PREFIX}9`,
      expect.any(String),
      expect.any(Number),
    );
    expect(cachedService.del).toHaveBeenCalledWith("user:pwreset:code:9");
    expect(cloudinaryService.destroyAssets).toHaveBeenCalledWith([
      "https://res.cloudinary.com/demo/avatar.png",
    ]);
  });
});

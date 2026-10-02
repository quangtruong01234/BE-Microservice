import { getRepositoryToken } from "@nestjs/typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import { CachedService } from "@app/cached";
import { CloudinaryService, MailerService } from "@app/common";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import {
  SESSION_VALID_AFTER_KEY_PREFIX,
  SESSION_VALID_AFTER_TTL_SECONDS,
} from "libs/constant/session.constant";
import { Role, RoleName, RoleStatus } from "./entity/role.entity";
import { UserAddress } from "./entity/user-address.entity";
import { User } from "./entity/user.entity";
import { UserService } from "./user.service";

describe("UserService session revocation (SESSION-REVOKE-01)", () => {
  let service: UserService;
  const NOW_MS = Date.parse("2026-10-01T00:00:00.400Z");
  const userRole = {
    rol_id: 1,
    rol_name: RoleName.USER,
    rol_status: RoleStatus.ACTIVE,
  } as unknown as Role;
  const shopRole = {
    rol_id: 2,
    rol_name: RoleName.SHOP,
    rol_status: RoleStatus.ACTIVE,
  } as unknown as Role;
  const passwordHash = bcrypt.hashSync("old-password", 4);
  const userRepository = { findOne: jest.fn(), save: jest.fn() };
  const roleRepository = { findOne: jest.fn() };
  const cachedService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  };

  function buildUser(): User {
    return {
      id: 9,
      email: "buyer@example.com",
      password: passwordHash,
      role: userRole,
    } as unknown as User;
  }

  function expectSessionsRevoked(): void {
    expect(cachedService.set).toHaveBeenCalledWith(
      `${SESSION_VALID_AFTER_KEY_PREFIX}9`,
      String(Math.floor(NOW_MS / 1000)),
      SESSION_VALID_AFTER_TTL_SECONDS,
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(NOW_MS);
    userRepository.findOne.mockResolvedValue(buildUser());
    userRepository.save.mockImplementation((user: User) =>
      Promise.resolve(user),
    );
    cachedService.set.mockResolvedValue("OK");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Role), useValue: roleRepository },
        { provide: getRepositoryToken(UserAddress), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: CachedService, useValue: cachedService },
        { provide: MailerService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  afterEach(() => jest.useRealTimers());

  it("changePassword revokes every session of the user", async () => {
    await service.changePassword(9, "old-password", "new-password");

    expectSessionsRevoked();
  });

  it("changePassword still succeeds when the revocation write fails", async () => {
    cachedService.set.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      service.changePassword(9, "old-password", "new-password"),
    ).resolves.toEqual({ success: true });
  });

  it("changePassword with a wrong current password revokes nothing", async () => {
    await expect(
      service.changePassword(9, "wrong-password", "new-password"),
    ).rejects.toThrow();

    expect(cachedService.set).not.toHaveBeenCalled();
  });

  it("resetPassword revokes every session of the user", async () => {
    cachedService.get.mockImplementation((key: string) =>
      Promise.resolve(key === "user:pwreset:code:9" ? "123456" : null),
    );
    cachedService.incr.mockResolvedValue(1);

    await service.resetPassword("buyer@example.com", "123456", "new-password");

    expectSessionsRevoked();
  });

  it("updateUserRole revokes when the role actually changes", async () => {
    roleRepository.findOne.mockResolvedValue(shopRole);

    await service.updateUserRole(9, RoleName.SHOP);

    expectSessionsRevoked();
  });

  it("updateUserRole re-setting the same role revokes nothing", async () => {
    roleRepository.findOne.mockResolvedValue(userRole);

    await service.updateUserRole(9, RoleName.USER);

    expect(cachedService.set).not.toHaveBeenCalled();
  });
});

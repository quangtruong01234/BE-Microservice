import { firstValueFrom } from "rxjs";
import { RmqService } from "@app/common";
import {
  createConfigMock,
  createRepositoryMock,
  createRmqContextMock,
  createTcpClientMock,
} from "@app/testing";

// Imported through the alias on purpose: this suite is what proves the
// `@app/testing` path resolves under both tsc and jest.
describe("test/utils factories", () => {
  describe("createTcpClientMock", () => {
    it("answers a routed pattern and null for an unrouted one", async () => {
      const tcp = createTcpClientMock();
      tcp.replyTo("find_order", { id: 1 });

      await expect(
        firstValueFrom(tcp.client.send("find_order", {})),
      ).resolves.toEqual({ id: 1 });
      await expect(
        firstValueFrom(tcp.client.send("other", {})),
      ).resolves.toBeNull();
    });

    it("does not match a { cmd } pattern against a bare-string route", async () => {
      const tcp = createTcpClientMock();
      tcp.replyTo("get_user", { id: 2 });

      await expect(
        firstValueFrom(tcp.client.send({ cmd: "get_user" }, {})),
      ).resolves.toBeNull();
    });

    it("errors on a failOn pattern", async () => {
      const tcp = createTcpClientMock();
      tcp.failOn("find_order", new Error("down"));

      await expect(
        firstValueFrom(tcp.client.send("find_order", {})),
      ).rejects.toThrow("down");
    });
  });

  describe("createRmqContextMock", () => {
    it("records an ack made through RmqService on the same message", () => {
      const { context, channel, message } = createRmqContextMock();
      const rmqService = new RmqService(createConfigMock().configService);

      rmqService.ack(context);

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
    });
  });

  describe("createRepositoryMock", () => {
    it("defaults to empty answers and echoes writes", async () => {
      const repo = createRepositoryMock<{ id: number }>().asRepository();

      await expect(repo.findOne({ where: { id: 1 } })).resolves.toBeNull();
      await expect(repo.findAndCount()).resolves.toEqual([[], 0]);
      await expect(repo.save({ id: 3 })).resolves.toEqual({ id: 3 });
      await expect(
        repo.createQueryBuilder("row").where("row.id = 1").getMany(),
      ).resolves.toEqual([]);
    });
  });

  describe("createConfigMock", () => {
    it("returns values, falls back to the default, and throws on getOrThrow", () => {
      const config = createConfigMock({ GHN_TOKEN: "t" });

      expect(config.configService.get("GHN_TOKEN")).toBe("t");
      expect(config.configService.get("MISSING", "fallback")).toBe("fallback");
      expect(() => {
        config.configService.getOrThrow<string>("MISSING");
      }).toThrow("MISSING");
    });
  });
});

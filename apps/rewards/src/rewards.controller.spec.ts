import { Test, TestingModule } from "@nestjs/testing";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { RmqService } from "@app/common";
import { RmqContext } from "@nestjs/microservices";
import { PATTERN_METADATA } from "@nestjs/microservices/constants";
import { EVENT } from "@app/common/constants/event";

describe("RewardsController", () => {
  let rewardsController: RewardsController;
  let addRewards: jest.Mock;
  let ack: jest.Mock;

  beforeEach(async () => {
    addRewards = jest.fn();
    ack = jest.fn();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RewardsController],
      providers: [
        { provide: RewardsService, useValue: { addRewards } },
        { provide: RmqService, useValue: { ack } },
      ],
    }).compile();

    rewardsController = app.get<RewardsController>(RewardsController);
  });

  describe("root", () => {
    it("should be defined", () => {
      expect(rewardsController).toBeDefined();
    });
  });

  it("subscribes to order_created only", () => {
    // The queue binds only order.fanout; a handler for any other event never
    // fires and, if the binding ever widens, would leave messages unacked.
    const prototype = RewardsController.prototype as unknown as Record<
      string,
      unknown
    >;
    const patterns = Object.getOwnPropertyNames(prototype)
      .map((methodName) => prototype[methodName])
      .filter((method) => typeof method === "function")
      .flatMap(
        (method) =>
          (Reflect.getMetadata(PATTERN_METADATA, method) as
            | unknown[]
            | undefined) ?? [],
      );

    expect(patterns).toEqual([EVENT.ORDER_CREATED_EVENT]);
  });

  it("acks after rewards are added", async () => {
    const context = {} as RmqContext;

    await rewardsController.handleOrderCreated(
      { id: 201, userId: 10, total: 100 },
      context,
    );

    expect(addRewards).toHaveBeenCalledWith({
      id: 201,
      userId: 10,
      total: 100,
    });
    expect(ack).toHaveBeenCalledWith(context);
  });

  it("nacks and requeues when adding rewards fails", async () => {
    const message = {};
    const nack = jest.fn();
    addRewards.mockRejectedValue(new Error("database unavailable"));
    const context = {
      getChannelRef: () => ({ nack }),
      getMessage: () => message,
    } as unknown as RmqContext;

    await rewardsController.handleOrderCreated(
      { id: 202, userId: 10, total: 100 },
      context,
    );

    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledWith(message, false, true);
  });
});

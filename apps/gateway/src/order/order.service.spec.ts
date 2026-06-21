import { ForbiddenException } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { of } from "rxjs";
import { OrderService } from "./order.service";

describe("OrderService access control", () => {
  const ordersClient = { send: jest.fn() };
  const paymentsClient = { send: jest.fn() };
  const userClient = { send: jest.fn() };
  const productClient = { send: jest.fn() };
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService(
      ordersClient as unknown as ClientProxy,
      paymentsClient as unknown as ClientProxy,
      userClient as unknown as ClientProxy,
      productClient as unknown as ClientProxy,
    );
  });

  it("rejects listing another user's orders", async () => {
    await expect(
      service.getOrderByUser("17", 1, 10, 18, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ordersClient.send).not.toHaveBeenCalled();
  });

  it("allows an admin to list another user's orders", async () => {
    ordersClient.send.mockReturnValue(
      of({ data: [], total: 0, page: 1, limit: 10 }),
    );

    await expect(
      service.getOrderByUser("17", 1, 10, 21, "admin"),
    ).resolves.toEqual({ data: [], total: 0, page: 1, limit: 10 });
  });

  it("rejects payment URL access for another user's order", async () => {
    ordersClient.send.mockReturnValue(
      of({
        id: 97,
        userId: 17,
        status: "pending",
        total: 100,
        items: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );

    await expect(service.getPaymentUrl(97, 18, "user")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(paymentsClient.send).not.toHaveBeenCalled();
  });

  it("returns the payment URL for the order owner", async () => {
    ordersClient.send.mockReturnValue(
      of({
        id: 97,
        userId: 17,
        status: "pending",
        total: 100,
        items: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );
    paymentsClient.send.mockReturnValue(
      of({ orderUrl: "https://payment.example/97", status: "pending" }),
    );

    await expect(service.getPaymentUrl(97, 17, "user")).resolves.toEqual({
      orderUrl: "https://payment.example/97",
      status: "pending",
    });
  });
});

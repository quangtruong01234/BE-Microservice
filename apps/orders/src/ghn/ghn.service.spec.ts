import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { GhnService } from "./ghn.service";
import { GhnResolvedAddress, GhnShippingItem } from "./ghn.types";

/**
 * Covers the failure mapping added with RESIL-01. The happy path is exercised
 * against the real GHN sandbox by the self-test; what cannot be forced there is
 * a GHN outage, so the transport is mocked here instead.
 */
describe("GhnService — GHN failure mapping", () => {
  const address = "Nguyen Van A|0987654321|123 Test|Phuong|Quan|Ho Chi Minh";
  const resolvedIds: GhnResolvedAddress = {
    districtId: 1442,
    wardCode: "20110",
  };
  const items: GhnShippingItem[] = [
    { productName: "test", quantity: 1, price: 100000, weight: 500 },
  ];

  let httpService: { post: jest.Mock };
  let service: GhnService;

  const preview = (): Promise<unknown> =>
    service.previewShippingFee(address, 0, items, resolvedIds);

  // Shapes an axios rejection the way axios itself does: a network failure has
  // no `response` at all, an HTTP error carries status + GHN's body.
  const networkError = (): Error => new Error("connect ECONNREFUSED");
  const httpError = (status: number, message: string): unknown => ({
    message: `Request failed with status code ${status}`,
    response: { status, data: { message } },
  });

  beforeEach(() => {
    httpService = { post: jest.fn() };
    service = new GhnService(httpService as unknown as HttpService);
    process.env.GHN_API_URL = "http://ghn.test/shiip/public-api";
    process.env.GHN_API_TOKEN = "test-token";
    process.env.GHN_SHOP_ID = "1";
  });

  it("maps a GHN 4xx onto 400 carrying GHN's own message", async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        httpError(400, "phường/xã người nhận không tồn tại trong hệ thống"),
      ),
    );

    await expect(preview()).rejects.toBeInstanceOf(BadRequestException);
    await expect(preview()).rejects.toThrow(
      "phường/xã người nhận không tồn tại trong hệ thống",
    );
  });

  it("maps a GHN 5xx onto 503", async () => {
    httpService.post.mockReturnValue(
      throwError(() => httpError(500, "internal error")),
    );

    await expect(preview()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "too many requests"],
  ])(
    "treats a GHN %i as an operational fault (503), not the seller's bad input",
    async (status: number, message: string) => {
      httpService.post.mockReturnValue(
        throwError(() => httpError(status, message)),
      );

      await expect(preview()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it("maps an unreachable GHN onto 503", async () => {
    httpService.post.mockReturnValue(throwError(() => networkError()));

    await expect(preview()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(preview()).rejects.toThrow("connect ECONNREFUSED");
  });

  it("opens the circuit after 5 outages and then fails fast without calling GHN", async () => {
    httpService.post.mockReturnValue(throwError(() => networkError()));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(preview()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
    expect(httpService.post).toHaveBeenCalledTimes(5);

    await expect(preview()).rejects.toThrow(/GHN is temporarily unavailable/);
    expect(httpService.post).toHaveBeenCalledTimes(5);
  });

  it("never opens the circuit on 4xx rejections — one bad address must not block every seller", async () => {
    httpService.post.mockReturnValue(
      throwError(() => httpError(400, "địa chỉ không hợp lệ")),
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(preview()).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(httpService.post).toHaveBeenCalledTimes(10);
  });

  it("keeps serving after GHN recovers", async () => {
    httpService.post.mockReturnValueOnce(throwError(() => networkError()));
    await expect(preview()).rejects.toBeInstanceOf(ServiceUnavailableException);

    httpService.post.mockReturnValue(
      of({
        data: { data: { total_fee: 22000, expected_delivery_time: null } },
      }),
    );
    await expect(preview()).resolves.toEqual({
      shippingFee: 22000,
      expectedDeliveryTime: null,
    });
  });
});

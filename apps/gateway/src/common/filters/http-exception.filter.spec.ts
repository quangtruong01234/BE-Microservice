import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { ArgumentsHost } from "@nestjs/common";
import { Request, Response } from "express";
import { HttpExceptionFilter } from "./http-exception.filter";

interface CapturedResponse {
  statusCode: number | null;
  body: Record<string, unknown> | null;
}

function createHost(captured: CapturedResponse): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      captured.body = payload as Record<string, unknown>;
      return response;
    },
  } as unknown as Response;

  const request = {
    url: "/api/user/change-password",
    method: "POST",
  } as unknown as Request;

  return {
    switchToHttp: () => ({
      getResponse: <T>() => response as T,
      getRequest: <T>() => request as T,
    }),
  } as unknown as ArgumentsHost;
}

function runFilter(exception: unknown): CapturedResponse {
  const captured: CapturedResponse = { statusCode: null, body: null };
  new HttpExceptionFilter().catch(exception, createHost(captured));
  return captured;
}

describe("HttpExceptionFilter — errorCode (CHG-PW-02)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("in production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("keeps errorCode on a 401 whose message is flattened", () => {
      const { statusCode, body } = runFilter(
        new UnauthorizedException({
          message: "Current password is incorrect",
          errorCode: "INVALID_CURRENT_PASSWORD",
        }),
      );

      expect(statusCode).toBe(401);
      // The sanitizer still erases the human message...
      expect(body?.message).toBe("Unauthorized");
      expect(body?.error).toBe("Unauthorized");
      // ...but the machine signal is what tells the two 401s apart.
      expect(body?.errorCode).toBe("INVALID_CURRENT_PASSWORD");
    });

    it("distinguishes a dead session from a wrong password", () => {
      const wrongPassword = runFilter(
        new UnauthorizedException({
          message: "Current password is incorrect",
          errorCode: "INVALID_CURRENT_PASSWORD",
        }),
      );
      const deadSession = runFilter(
        new UnauthorizedException({
          message: "Access token is required",
          errorCode: "UNAUTHENTICATED",
        }),
      );

      expect(wrongPassword.body).not.toEqual(deadSession.body);
      expect(deadSession.body?.errorCode).toBe("UNAUTHENTICATED");
    });

    it("omits the key entirely on a 401 that declared no code", () => {
      const { body } = runFilter(new UnauthorizedException("Unauthorized"));

      expect(body).not.toHaveProperty("errorCode");
    });

    it("drops the code on a sanitized 5xx", () => {
      const { body } = runFilter(
        new HttpException(
          { message: "boom", errorCode: "INVALID_CURRENT_PASSWORD" },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );

      expect(body?.message).toBe("Internal server error");
      expect(body).not.toHaveProperty("errorCode");
    });
  });

  describe("outside production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("reports the real message alongside the code", () => {
      const { body } = runFilter(
        new UnauthorizedException({
          message: "Current password is incorrect",
          errorCode: "INVALID_CURRENT_PASSWORD",
        }),
      );

      expect(body?.message).toBe("Current password is incorrect");
      expect(body?.errorCode).toBe("INVALID_CURRENT_PASSWORD");
    });

    it("picks the code up from a bare microservice error object", () => {
      const { statusCode, body } = runFilter({
        statusCode: 401,
        message: "Current password is incorrect",
        error: "Unauthorized",
        errorCode: "INVALID_CURRENT_PASSWORD",
      });

      expect(statusCode).toBe(401);
      expect(body?.errorCode).toBe("INVALID_CURRENT_PASSWORD");
    });

    it("ignores a non-string errorCode rather than echoing it", () => {
      const { body } = runFilter(
        new HttpException({ message: "nope", errorCode: 42 }, 400),
      );

      expect(body).not.toHaveProperty("errorCode");
    });
  });
});

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { isProduction } from "../security";

@Catch() // Catch all exceptions, not just HttpException
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * The HTTP reason phrase for a status, derived from the `HttpStatus` enum
   * key (`404` → `NOT_FOUND` → `Not Found`). Keeps `error` uniform whatever
   * threw: gateway-local exceptions, errors propagated from a microservice,
   * and bare JS errors all report the same label for the same status.
   */
  private static reasonPhrase(status: number): string {
    const key: unknown = (HttpStatus as unknown as Record<number, string>)[
      status
    ];
    if (typeof key !== "string") {
      return "Error";
    }
    return key
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Accept an upstream `error` label only when it is already a reason phrase.
   * A class name (`NotFoundException`) is an internal detail and gets dropped
   * so the status-derived phrase is used instead.
   */
  private normalizeErrorLabel(label: unknown): string | null {
    if (typeof label !== "string" || label.length === 0) {
      return null;
    }
    return label.endsWith("Exception") || label.endsWith("Error")
      ? null
      : label;
  }

  /**
   * Accept an `errorCode` only when it is a non-empty string. Anything else a
   * thrower happened to put under that key is dropped rather than echoed —
   * the field is a contract, not a passthrough.
   */
  private static normalizeErrorCode(code: unknown): string | null {
    return typeof code === "string" && code.trim() !== "" ? code : null;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    // `null` = "nothing better than the status itself" — resolved to the HTTP
    // reason phrase once the status is final. Never fall back to the exception
    // class name: an error propagated from a microservice is rebuilt as a bare
    // `HttpException`, so the envelope reported `"error":"HttpException"` where
    // a gateway-local one reported `"Not Found"` (PRODTEST-0806 #5) — and a raw
    // `TypeError` name is an internal detail the client should never see.
    let error: string | null = null;
    // Optional machine-readable code (`libs/constant/error-code.constant.ts`).
    // Emitted only when the thrower set one, so every other response keeps its
    // exact key set (CHG-PW-02).
    let errorCode: string | null = null;

    if (exception instanceof HttpException) {
      // Handle NestJS HTTP exceptions
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === "object" &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as {
          message?: string | string[];
          error?: string;
          errorCode?: unknown;
        };
        message = body.message ?? exception.message;
        error = this.normalizeErrorLabel(body.error);
        errorCode = HttpExceptionFilter.normalizeErrorCode(body.errorCode);
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // Handle generic JavaScript errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message || "Internal server error";
    } else if (typeof exception === "object" && exception !== null) {
      // Handle microservice error objects
      const errorObj = exception as {
        statusCode?: unknown;
        status?: unknown;
        message?: string | string[];
        error?: string;
        errorCode?: unknown;
      };

      if (typeof errorObj.statusCode === "number") {
        status = errorObj.statusCode;
      } else if (typeof errorObj.status === "number") {
        status = errorObj.status;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
      }

      message = errorObj.message ?? errorObj.error ?? "Internal server error";
      error = this.normalizeErrorLabel(errorObj.error);
      errorCode = HttpExceptionFilter.normalizeErrorCode(errorObj.errorCode);

      this.logger.error(
        `Microservice error: Status=${status}`,
        undefined,
        `${request.method} ${request.url}`,
      );
    } else {
      // Handle completely unknown exceptions
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = "Internal server error";
    }

    // Log raw exception — warn for 4xx (expected), error for 5xx (unexpected)
    if (status >= 500) {
      const exceptionType =
        exception instanceof Error
          ? exception.constructor.name
          : typeof exception;
      this.logger.error(
        `Unexpected exception caught: ${exceptionType}`,
        isProduction()
          ? undefined
          : exception instanceof Error
            ? exception.stack
            : undefined,
        `${request.method} ${request.url}`,
      );
    }

    // Ensure status is a valid HTTP status code
    if (typeof status !== "number" || status < 100 || status > 599) {
      this.logger.error(
        `Invalid status code detected: ${status}, using 500 instead`,
      );
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    if (isProduction() && status >= 500) {
      message = "Internal server error";
      // Sanitize the message, but keep the label the status-derived phrase so
      // prod and dev report the same `error` for the same status
      // (PRODTEST-0806 #5).
      error = HttpExceptionFilter.reasonPhrase(status);
      // Nothing about an unexpected server failure is a stable contract.
      errorCode = null;
    } else if (isProduction() && status === 401) {
      // Every 401 message is flattened so an authentication failure cannot be
      // used as an account-existence oracle. `errorCode` deliberately SURVIVES
      // this: it is a closed set we chose, so it discloses nothing, and without
      // it two unrelated 401s came back byte-identical — which is what made the
      // FE probe `GET /user/me` to tell "wrong current password" from "dead
      // session" (CHG-PW-02).
      message = "Unauthorized";
      error = "Unauthorized";
    }

    // Format and send the error response
    const errorResponse = {
      statusCode: status,
      status: "error",
      error: error ?? HttpExceptionFilter.reasonPhrase(status),
      ...(errorCode === null ? {} : { errorCode }),
      message: Array.isArray(message) ? message.join(", ") : message,
      data: null,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    // Log the error response
    if (status >= 500) {
      this.logger.error(
        `HTTP ${status} Error Response: ${JSON.stringify(errorResponse)}`,
        undefined,
        `${request.method} ${request.url}`,
      );
    } else {
      this.logger.warn(
        `HTTP ${status} Error Response: ${JSON.stringify(errorResponse)}`,
        `${request.method} ${request.url}`,
      );
    }

    try {
      response.status(status).json(errorResponse);
    } catch (responseError: unknown) {
      const responseErrorMessage =
        responseError instanceof Error
          ? responseError.message
          : "Unknown response error";
      this.logger.error(
        `Failed to send error response: ${responseErrorMessage}`,
        undefined,
        `${request.method} ${request.url}`,
      );
      // Fallback response
      response.status(500).json({
        statusCode: 500,
        status: "error",
        error: "ResponseError",
        message: "Failed to process error response",
        data: null,
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      });
    }
  }
}

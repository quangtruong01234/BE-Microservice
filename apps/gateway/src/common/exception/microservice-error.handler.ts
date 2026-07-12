import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { COMMON_MESSAGE } from "libs/constant/response-message.constant";
import { ErrorLike } from "./microservice-error.types";

export class MicroserviceErrorHandler {
  private static readonly logger = new Logger(MicroserviceErrorHandler.name);

  static handleError(
    error: unknown,
    operation: string,
    serviceName: string = "Microservice",
  ): never {
    if (error == null) {
      this.logger.error(
        `${serviceName} ${operation} failed: TCP call completed without emitting a value (undefined error)`,
      );
      throw new HttpException(
        COMMON_MESSAGE.SERVICE_UNAVAILABLE,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const errorSummary =
      error instanceof Error ? error.constructor.name : typeof error;
    this.logger.error(`${serviceName} ${operation} failed: ${errorSummary}`);

    const err = error as ErrorLike;
    // Unwrap NestJS RpcException shape: { error: <inner>, message: '...' }
    // where <inner> contains { statusCode, message }
    const rpcError =
      (err?.response != null && typeof err.response === "object"
        ? (err.response as ErrorLike)
        : null) ??
      (err?.error != null && typeof err.error === "object"
        ? err.error
        : null) ??
      err;

    const statusCode = this.extractStatusCode(rpcError);
    const message = this.extractErrorMessage(rpcError);

    this.logger.debug(`Throwing HttpException with status: ${statusCode}`);
    throw new HttpException(message, statusCode);
  }

  private static extractStatusCode(error: ErrorLike): number {
    if (typeof error.statusCode === "number") {
      return error.statusCode;
    }

    if (typeof error.status === "number") {
      return error.status;
    }

    const errorTypeName =
      (typeof error.name === "string" ? error.name : null) ??
      (typeof error.error === "string" ? error.error : null);

    if (errorTypeName) {
      switch (errorTypeName) {
        case "ConflictException":
        case "RpcException.ConflictException":
        case "Conflict":
          return HttpStatus.CONFLICT;
        case "NotFoundException":
        case "RpcException.NotFoundException":
        case "Not Found":
          return HttpStatus.NOT_FOUND;
        case "BadRequestException":
        case "RpcException.BadRequestException":
        case "Bad Request":
          return HttpStatus.BAD_REQUEST;
        case "UnauthorizedException":
        case "RpcException.UnauthorizedException":
        case "Unauthorized":
          return HttpStatus.UNAUTHORIZED;
        case "ForbiddenException":
        case "RpcException.ForbiddenException":
        case "Forbidden":
          return HttpStatus.FORBIDDEN;
        case "UnprocessableEntityException":
        case "RpcException.UnprocessableEntityException":
        case "Unprocessable Entity":
          return HttpStatus.UNPROCESSABLE_ENTITY;
      }
    }

    const errorMessage =
      typeof error.message === "string" ? error.message.toLowerCase() : "";

    if (
      errorMessage.includes("already exists") ||
      errorMessage.includes("duplicate") ||
      errorMessage.includes("unique constraint") ||
      errorMessage.includes("UQ_")
    ) {
      return HttpStatus.CONFLICT;
    }

    if (
      errorMessage.includes("not found") ||
      errorMessage.includes("does not exist")
    ) {
      return HttpStatus.NOT_FOUND;
    }

    if (
      errorMessage.includes("validation") ||
      errorMessage.includes("invalid") ||
      errorMessage.includes("required") ||
      errorMessage.includes("must be") ||
      errorMessage.includes("should not be empty")
    ) {
      return HttpStatus.BAD_REQUEST;
    }

    if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("connection") ||
      errorMessage.includes("ETIMEDOUT")
    ) {
      return HttpStatus.REQUEST_TIMEOUT;
    }

    if (
      errorMessage.includes("unauthorized") ||
      errorMessage.includes("access denied")
    ) {
      return HttpStatus.UNAUTHORIZED;
    }

    if (errorMessage.includes("forbidden")) {
      return HttpStatus.FORBIDDEN;
    }

    if (
      errorMessage.includes("insufficient") ||
      errorMessage.includes("not enough")
    ) {
      return HttpStatus.UNPROCESSABLE_ENTITY;
    }

    return HttpStatus.BAD_GATEWAY;
  }

  private static extractErrorMessage(error: ErrorLike): string {
    if (typeof error.message === "string" && error.message.trim() !== "") {
      return this.cleanupErrorMessage(error.message);
    }

    if (Array.isArray(error.message) && error.message.length > 0) {
      return (error.message as string[]).join(", ");
    }

    const response = error.response as ErrorLike | undefined;
    if (response?.message) {
      if (Array.isArray(response.message)) {
        return (response.message as string[]).join(", ");
      }
      if (
        typeof response.message === "string" &&
        response.message.trim() !== ""
      ) {
        return this.cleanupErrorMessage(response.message);
      }
    }

    if (typeof error.error === "string" && error.error.trim() !== "") {
      return error.error;
    }

    return COMMON_MESSAGE.SERVICE_UNAVAILABLE;
  }

  private static cleanupErrorMessage(message: string): string {
    if (message.includes("unique constraint")) {
      if (
        message.includes("sku") ||
        message.includes("UQ_5ec10f972b1fa4f1e60d66d28bc")
      ) {
        return "Record with this SKU already exists";
      }
      if (message.includes("email")) {
        return "User with this email already exists";
      }
      if (message.includes("username")) {
        return "User with this username already exists";
      }
      if (message.includes("name")) {
        return "Record with this name already exists";
      }
      if (message.includes("phone")) {
        return "User with this phone number already exists";
      }
      if (message.includes("order_number")) {
        return "Order with this number already exists";
      }
      if (message.includes("transaction_id")) {
        return "Transaction with this ID already exists";
      }
      return "Duplicate entry found";
    }

    if (message.includes("QueryFailedError")) {
      return "Database operation failed";
    }

    if (message.includes("duplicate key value violates")) {
      return "Duplicate entry found";
    }

    if (message.includes("should not be empty")) {
      return message.replace(/\b\w+\b should not be empty/g, (match) => {
        const field = match.split(" ")[0];
        return `${field} is required`;
      });
    }

    if (message.includes("insufficient stock")) {
      return "Insufficient stock available";
    }

    if (message.includes("insufficient points")) {
      return "Insufficient points available";
    }

    if (message.includes("not enough stock")) {
      return "Not enough stock available";
    }

    if (message.includes("not enough points")) {
      return "Not enough points available";
    }

    message = message.replace(
      /^(Error: |QueryFailedError: |ValidationError: )/i,
      "",
    );

    return message;
  }

  static async handleAsyncCall<T>(
    operation: () => Promise<T>,
    operationName: string,
    serviceName: string = "Microservice",
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, operationName, serviceName);
    }
  }
}

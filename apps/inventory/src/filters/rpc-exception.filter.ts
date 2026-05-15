import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { BaseRpcExceptionFilter, RpcException } from "@nestjs/microservices";

type ErrorLike = {
  constructor?: { name?: string };
  code?: string;
  message?: string | string[];
};

@Catch()
export class AllRpcExceptionFilter extends BaseRpcExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const exc = exception as ErrorLike;
    this.logger.debug(
      `Handling exception: ${exc?.constructor?.name}`,
      exc?.message as string | undefined,
    );

    if (exception instanceof RpcException) {
      this.logger.debug("Already RpcException, passing through");
      return super.catch(exception, host);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      const rpcException = new RpcException({
        statusCode: status,
        message:
          typeof response === "string"
            ? response
            : ((response as { message?: string | string[] }).message ??
              exception.message),
        error: this.getErrorName(status),
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(
        `Converted HttpException to RpcException: ${status} - ${exception.message}`,
      );
      return super.catch(rpcException, host);
    }

    if (this.isDatabaseError(exc)) {
      const rpcException = this.handleDatabaseError(exc);
      this.logger.debug(
        `Converted Database error to RpcException: ${JSON.stringify(rpcException.getError())}`,
      );
      return super.catch(rpcException, host);
    }

    if (this.isValidationError(exc)) {
      const rpcException = this.handleValidationError(exc);
      this.logger.debug(
        `Converted Validation error to RpcException: ${JSON.stringify(rpcException.getError())}`,
      );
      return super.catch(rpcException, host);
    }

    const rpcException = new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        typeof exc?.message === "string"
          ? exc.message
          : "Internal server error",
      error: "Internal Server Error",
      timestamp: new Date().toISOString(),
    });

    this.logger.error(
      `Unhandled exception converted to RpcException:`,
      exception,
    );
    return super.catch(rpcException, host);
  }

  private isDatabaseError(exception: ErrorLike): boolean {
    const msg = typeof exception?.message === "string" ? exception.message : "";
    return (
      exception?.constructor?.name === "QueryFailedError" ||
      exception?.code === "23505" ||
      exception?.code === "23502" ||
      exception?.code === "23503" ||
      msg.includes("duplicate key value violates") ||
      msg.includes("unique constraint") ||
      msg.includes("foreign key constraint")
    );
  }

  private isValidationError(exception: ErrorLike): boolean {
    const msg = typeof exception?.message === "string" ? exception.message : "";
    return (
      exception?.constructor?.name === "ValidationError" ||
      Array.isArray(exception?.message) ||
      msg.includes("should not be empty") ||
      msg.includes("must be") ||
      msg.includes("is not valid")
    );
  }

  private handleDatabaseError(exception: ErrorLike): RpcException {
    const message =
      typeof exception.message === "string" ? exception.message : "";

    if (
      message.includes("duplicate key value violates") ||
      exception.code === "23505"
    ) {
      let userMessage = "Duplicate entry found";

      if (
        message.includes("UQ_5ec10f972b1fa4f1e60d66d28bc") ||
        message.includes("sku")
      ) {
        userMessage = "Inventory with this SKU already exists";
      } else if (message.includes("product_id")) {
        userMessage = "Inventory for this product already exists";
      }

      return new RpcException({
        statusCode: HttpStatus.CONFLICT,
        message: userMessage,
        error: "Conflict",
        timestamp: new Date().toISOString(),
        details: {
          constraint: this.extractConstraintName(message),
          originalError: message,
        },
      });
    }

    if (
      message.includes("null value in column") ||
      exception.code === "23502"
    ) {
      return new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "Required field is missing",
        error: "Bad Request",
        timestamp: new Date().toISOString(),
      });
    }

    if (
      message.includes("foreign key constraint") ||
      exception.code === "23503"
    ) {
      return new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "Referenced record does not exist",
        error: "Bad Request",
        timestamp: new Date().toISOString(),
      });
    }

    if (
      message.includes("insufficient stock") ||
      message.includes("not enough stock")
    ) {
      return new RpcException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: "Insufficient stock available",
        error: "Unprocessable Entity",
        timestamp: new Date().toISOString(),
      });
    }

    return new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Database operation failed",
      error: "Internal Server Error",
      timestamp: new Date().toISOString(),
    });
  }

  private handleValidationError(exception: ErrorLike): RpcException {
    let message = "Validation failed";

    if (Array.isArray(exception.message)) {
      message = exception.message.join(", ");
    } else if (exception.message) {
      message = exception.message;
    }

    return new RpcException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: message,
      error: "Bad Request",
      timestamp: new Date().toISOString(),
    });
  }

  private extractConstraintName(message: string): string | null {
    const match = message.match(/"([^"]+)"/);
    return match ? match[1] : null;
  }

  private getErrorName(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return "Bad Request";
      case HttpStatus.UNAUTHORIZED:
        return "Unauthorized";
      case HttpStatus.FORBIDDEN:
        return "Forbidden";
      case HttpStatus.NOT_FOUND:
        return "Not Found";
      case HttpStatus.CONFLICT:
        return "Conflict";
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "Unprocessable Entity";
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return "Internal Server Error";
      default:
        return "Error";
    }
  }
}

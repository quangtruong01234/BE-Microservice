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

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    let error: string = "UnknownError";

    if (exception instanceof HttpException) {
      // Handle NestJS HTTP exceptions
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
        error = exception.constructor.name;
      } else if (
        typeof exceptionResponse === "object" &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as {
          message?: string | string[];
          error?: string;
        };
        message = body.message ?? exception.message;
        error = body.error ?? exception.constructor.name;
      } else {
        message = exception.message;
        error = exception.constructor.name;
      }
    } else if (exception instanceof Error) {
      // Handle generic JavaScript errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message || "Internal server error";
      error = exception.constructor.name;
    } else if (typeof exception === "object" && exception !== null) {
      // Handle microservice error objects
      const errorObj = exception as {
        statusCode?: unknown;
        status?: unknown;
        message?: string | string[];
        error?: string;
      };

      if (typeof errorObj.statusCode === "number") {
        status = errorObj.statusCode;
      } else if (typeof errorObj.status === "number") {
        status = errorObj.status;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
      }

      message = errorObj.message ?? errorObj.error ?? "Internal server error";
      error = errorObj.error ?? "MicroserviceError";

      this.logger.error(
        `Microservice error: Status=${status}`,
        undefined,
        `${request.method} ${request.url}`,
      );
    } else {
      // Handle completely unknown exceptions
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = "Internal server error";
      error = "UnknownError";
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
      error = "InternalServerError";
    } else if (isProduction() && status === 401) {
      message = "Unauthorized";
      error = "Unauthorized";
    }

    // Format and send the error response
    const errorResponse = {
      statusCode: status,
      status: "error",
      error: error,
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

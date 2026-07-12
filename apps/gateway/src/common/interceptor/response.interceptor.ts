import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Response } from "express";
import { COMMON_MESSAGE } from "libs/constant/response-message.constant";
import { map, Observable } from "rxjs";
import { SKIP_RESPONSE_WRAP_KEY } from "../decorators/skip-response-wrap.decorator";
import { StandardResponse } from "./response-interceptor.types";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    const shouldSkipWrap =
      Reflect.getMetadata(SKIP_RESPONSE_WRAP_KEY, context.getHandler()) ===
        true ||
      Reflect.getMetadata(SKIP_RESPONSE_WRAP_KEY, context.getClass()) === true;
    if (shouldSkipWrap) {
      return next.handle() as Observable<StandardResponse<T>>;
    }

    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data: T) => ({
        statusCode: statusCode,
        status: "success" as const,
        message: COMMON_MESSAGE.REQUEST_SUCCESS,
        timestamp: new Date().toISOString(),
        data,
      })),
    );
  }
}

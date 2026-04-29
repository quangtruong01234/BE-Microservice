import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';

export interface StandardResponse<T> {
  statusCode: number,
  message: string,
  data: T,
  status: 'success'
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {

    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const statusCode = response.statusCode;

    return next.handle()
      .pipe(
        map(data => (
          {
            statusCode: statusCode,
            status: 'success',
            message: "Request Success",
            timestamp: new Date().toISOString(),
            data: data,
            
          }
        ))
      )
  }
}

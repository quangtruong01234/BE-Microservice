import { Catch, HttpException, RpcExceptionFilter } from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { RpcException } from "@nestjs/microservices";

@Catch(HttpException)
export class HttpToRpcExceptionFilter implements RpcExceptionFilter<HttpException> {
  catch(exception: HttpException): Observable<never> {
    return throwError(
      () =>
        new RpcException({
          statusCode: exception.getStatus(),
          message: exception.message,
        }),
    );
  }
}

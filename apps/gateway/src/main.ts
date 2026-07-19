import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { GatewayModule } from "./gateway.module";
import * as dotenv from "dotenv";
import * as cookieParser from "cookie-parser";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptor/response.interceptor";
import {
  BadRequestException,
  Logger,
  RequestMethod,
  ValidationPipe,
} from "@nestjs/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { QUEUES } from "@app/common/constants/queues";
import { gatewayCorsOptions } from "./common/cors";
import { ValidationError } from "class-validator";
import { json, urlencoded } from "express";
import {
  isSwaggerEnabled,
  resolveBodyLimit,
  securityHeadersMiddleware,
} from "./common/security";
import { RedisIoAdapter } from "./common/redis-io.adapter";
import {
  backpressureMiddleware,
  isBackpressureEnabled,
} from "./common/backpressure";

function collectValidationMessages(errors: ValidationError[]): string[] {
  const messages = errors.flatMap((error) => {
    const constraintMessages = Object.values(error.constraints ?? {});
    const childMessages = error.children?.length
      ? collectValidationMessages(error.children)
      : [];
    return [...constraintMessages, ...childMessages];
  });

  return messages.length > 0 ? messages : ["Validation failed"];
}

async function bootstrap() {
  const logger = new Logger("GatewayBootstrap");
  dotenv.config({ path: "./local/nodeA/.env" });
  // Fail fast: the gateway is the only JWT-signing/verifying service, so an
  // undefined JWT_SECRET must abort startup rather than silently boot and only
  // surface later as broken authentication.
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is not set — refusing to start the gateway with an undefined JWT secret.",
    );
  }
  const app = await NestFactory.create(GatewayModule, { bodyParser: false });
  app.enableShutdownHooks();
  // SCALE-01a: route Socket.IO rooms/emits (/chat + /notifications) through
  // Redis pub/sub so a future multi-instance gateway keeps WS delivery intact.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  const expressApp = app
    .getHttpAdapter()
    .getInstance() as import("express").Application;
  expressApp.set("trust proxy", 1);
  app.use(securityHeadersMiddleware());
  // SCALE-05c: shed load with a cheap 503 before body parsing/routing when the
  // event loop is saturated, instead of letting every request time out at once.
  if (isBackpressureEnabled()) {
    app.use(backpressureMiddleware());
  }
  app.use(json({ limit: resolveBodyLimit("JSON_BODY_LIMIT", "1mb") }));
  app.use(
    urlencoded({
      extended: true,
      limit: resolveBodyLimit("URLENCODED_BODY_LIMIT", "1mb"),
    }),
  );
  app.use(
    (cookieParser as unknown as () => import("express").RequestHandler)(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: collectValidationMessages(errors),
          error: "Bad Request",
        }),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors(gatewayCorsOptions);
  app.setGlobalPrefix("api", {
    // The GHN webhook is served at both the legacy un-prefixed `/ghn/webhook`
    // and the prefix-consistent `/api/ghn/webhook`; exclude both so neither gets
    // the `api` prefix prepended (the second path already carries it literally).
    exclude: [
      { path: "ghn/webhook", method: RequestMethod.POST },
      { path: "api/ghn/webhook", method: RequestMethod.POST },
      { path: "zalopay/callback", method: RequestMethod.POST },
      { path: "vnpay/callback", method: RequestMethod.POST },
      { path: "vnpay/callback", method: RequestMethod.GET },
      { path: "live", method: RequestMethod.GET },
      { path: "ready", method: RequestMethod.GET },
      { path: "health", method: RequestMethod.GET },
    ],
  });
  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle("Ecommerce API")
      .setDescription("API docs")
      .setVersion("1.0")
      .addBearerAuth({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("doc", app, document);
  } else {
    logger.log("Swagger UI is disabled for this environment.");
  }

  // RabbitMQ consumer: receive notification push events from notification service
  if (process.env.RABBITMQ_HOST) {
    const vhost = encodeURIComponent(process.env.RABBITMQ_VHOST ?? "/");
    const rmqUrl = `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASS}@${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}/${vhost}`;
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [rmqUrl],
        queue: QUEUES.NOTIFICATION_GATEWAY_PUSH_QUEUE,
        noAck: false,
        persistent: true,
        queueOptions: { durable: true },
        exchange: EXCHANGE.NOTIFICATION_PUSH_EXCHANGE,
        exchangeType: "fanout",
      },
    });
    await app.startAllMicroservices();
  }

  const port = process.env.GATEWAY_PORT || 3000;
  const host = process.env.GATEWAY_HOST || "0.0.0.0";
  await app.listen(port, host);
  logger.log(`Gateway listening on http://localhost:${port}`);
}
void bootstrap();

import { NestFactory } from "@nestjs/core";
import { GatewayModule } from "./gateway.module";
import * as dotenv from "dotenv";
import * as cookieParser from "cookie-parser";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptor/response.interceptor";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });
  const app = await NestFactory.create(GatewayModule);
  const expressApp = app
    .getHttpAdapter()
    .getInstance() as import("express").Application;
  expressApp.set("trust proxy", 1);
  app.use(
    (cookieParser as unknown as () => import("express").RequestHandler)(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors({
    origin: (process.env.FRONTEND_URL || "http://localhost:5173").split(","),
    credentials: true,
  });
  app.setGlobalPrefix("api", {
    exclude: [{ path: "ghn/webhook", method: RequestMethod.POST }],
  });
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

  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);
  console.log(`Gateway listening on http://localhost:${port}`);
}
void bootstrap();

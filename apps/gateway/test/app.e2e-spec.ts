import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { App } from "supertest/types";
import { GatewayModule } from "./../src/gateway.module";

describe("GatewayController (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it("/ (GET)", () => {
    // Nest types getHttpServer() as `any`; supertest wants a real server.
    return request(app.getHttpServer() as App)
      .get("/")
      .expect(200)
      .expect("Hello World!");
  });
});

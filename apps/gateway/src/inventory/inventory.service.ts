import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { throwError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

// DTOs are now in separate files for better Swagger documentation

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
  ) {}

  async create(data: unknown): Promise<unknown> {
    try {
      this.logger.log(`Creating inventory: ${JSON.stringify(data)}`);
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE, data)
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create inventory",
        "Inventory Service",
      );
    }
  }

  async findAll(): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_ALL, {})
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "find all inventory",
        "Inventory Service",
      );
    }
  }

  async findOne(id: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_ONE, id)
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `find inventory by ID: ${id}`,
        "Inventory Service",
      );
    }
  }

  async findByProductId(productId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID,
            productId,
          )
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `find inventory by product ID: ${productId}`,
        "Inventory Service",
      );
    }
  }

  async findBySku(sku: string): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_SKU, sku)
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `find inventory by SKU: ${sku}`,
        "Inventory Service",
      );
    }
  }

  async update(id: number, update: unknown): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE, { id, update })
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update inventory ID: ${id}`,
        "Inventory Service",
      );
    }
  }

  async remove(id: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_REMOVE, id)
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `remove inventory ID: ${id}`,
        "Inventory Service",
      );
    }
  }

  async checkStock(productId: number, quantity: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId,
            quantity,
          })
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `check stock for product ${productId}`,
        "Inventory Service",
      );
    }
  }

  async reserveStock(productId: number, quantity: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK, {
            productId,
            quantity,
          })
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `reserve stock for product ${productId}`,
        "Inventory Service",
      );
    }
  }

  async releaseStock(productId: number, quantity: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK, {
            productId,
            quantity,
          })
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `release stock for product ${productId}`,
        "Inventory Service",
      );
    }
  }

  async getLowStock(): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_LOW_STOCK, {})
          .pipe(
            timeout(10000),
            catchError((error) => throwError(() => error)),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get low stock items",
        "Inventory Service",
      );
    }
  }
}

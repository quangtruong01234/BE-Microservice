import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { CreateInventoryDto } from "./dto/create-inventory.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";

type InventoryOwnershipData = {
  id: number;
  productId: number;
};

type ProductOwnershipData = {
  id: number;
  userId?: number;
};

type SkuOwnershipData = {
  id: number;
  productId: number;
};

// DTOs are now in separate files for better Swagger documentation

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
  ) {}

  async create(
    data: CreateInventoryDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(
      data.productId,
      callerId,
      callerRole,
    );
    if (data.productSkuId !== undefined) {
      await this.assertSkuBelongsToProduct(data.productSkuId, data.productId);
    }
    try {
      this.logger.log(`Creating inventory: ${JSON.stringify(data)}`);
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE, data)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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
            catchError((err: unknown) => {
              throw err;
            }),
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
            catchError((err: unknown) => {
              throw err;
            }),
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
            catchError((err: unknown) => {
              throw err;
            }),
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
            catchError((err: unknown) => {
              throw err;
            }),
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

  async update(
    id: number,
    update: UpdateInventoryDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertInventoryMutationAccess(id, callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE, { id, update })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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

  async remove(
    id: number,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertInventoryMutationAccess(id, callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_REMOVE, id)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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

  async checkStock(
    productId: number,
    quantity: number,
    skuId?: number,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId,
            quantity,
            skuId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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

  async reserveStock(
    productId: number,
    quantity: number,
    skuId?: number,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK, {
            productId,
            quantity,
            skuId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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

  async releaseStock(
    productId: number,
    quantity: number,
    skuId?: number,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK, {
            productId,
            quantity,
            skuId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
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
            catchError((err: unknown) => {
              throw err;
            }),
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

  private async assertInventoryMutationAccess(
    inventoryId: number,
    callerId: number,
    callerRole: string,
  ): Promise<void> {
    if (callerRole === "admin") {
      return;
    }
    const inventory = await this.fetchInventoryForAccess(inventoryId);
    await this.assertProductMutationAccess(
      Number(inventory.productId),
      callerId,
      callerRole,
    );
  }

  private async assertProductMutationAccess(
    productId: number,
    callerId: number,
    callerRole: string,
  ): Promise<void> {
    if (callerRole === "admin") {
      return;
    }
    const product = await this.fetchProductForAccess(productId);
    if (Number(product.userId) !== callerId) {
      throw new ForbiddenException(
        "You cannot modify another user's inventory",
      );
    }
  }

  private async assertSkuBelongsToProduct(
    skuId: number,
    productId: number,
  ): Promise<void> {
    try {
      const sku = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID, skuId)
          .pipe(timeout(10000)),
      )) as SkuOwnershipData;
      if (Number(sku.productId) !== productId) {
        throw new ForbiddenException("SKU does not belong to this product");
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      MicroserviceErrorHandler.handleError(
        error,
        `verify SKU ID: ${skuId}`,
        "Product Service",
      );
    }
  }

  private async fetchInventoryForAccess(
    inventoryId: number,
  ): Promise<InventoryOwnershipData> {
    try {
      return (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_ONE, inventoryId)
          .pipe(timeout(10000)),
      )) as InventoryOwnershipData;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `verify inventory ID: ${inventoryId}`,
        "Inventory Service",
      );
    }
  }

  private async fetchProductForAccess(
    productId: number,
  ): Promise<ProductOwnershipData> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, productId)
          .pipe(timeout(10000)),
      )) as ProductOwnershipData;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `verify product ID: ${productId}`,
        "Product Service",
      );
    }
  }
}

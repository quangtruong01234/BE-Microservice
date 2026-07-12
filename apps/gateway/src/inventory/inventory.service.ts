import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { INVENTORY_MESSAGE } from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { CreateInventoryDto } from "./dto/create-inventory.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import {
  InventoryOwnershipData,
  LowStockInventoryRow,
  ProductNameData,
  ProductOwnershipData,
  SkuOwnershipData,
} from "./inventory.types";

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

  async getLowStock(callerId: number, callerRole: string): Promise<unknown> {
    try {
      // Admin sees the whole catalog; a shop is scoped to its own products.
      let lowStockPayload: { productIds?: number[] } = {};
      if (callerRole !== "admin") {
        const productIds = (await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.GET_PRODUCT_IDS_BY_SELLER, callerId)
            .pipe(timeout(10000)),
        )) as number[];
        if (!Array.isArray(productIds) || productIds.length === 0) {
          return [];
        }
        lowStockPayload = { productIds };
      }
      const lowStockRows = (await firstValueFrom(
        this.inventoryClient
          .send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_LOW_STOCK,
            lowStockPayload,
          )
          .pipe(timeout(10000)),
      )) as LowStockInventoryRow[];
      if (!Array.isArray(lowStockRows) || lowStockRows.length === 0) {
        return [];
      }
      return await this.attachProductNames(lowStockRows);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get low stock inventory",
        "Inventory Service",
      );
    }
  }

  // Best-effort enrichment: a product-service failure must not break the
  // low-stock read, so rows fall back to productName null.
  private async attachProductNames(
    rows: LowStockInventoryRow[],
  ): Promise<LowStockInventoryRow[]> {
    const productIds = [
      ...new Set(
        rows
          .map((row) => Number(row.productId))
          .filter((id) => Number.isFinite(id)),
      ),
    ];
    let productNameById = new Map<number, string>();
    if (productIds.length > 0) {
      try {
        const products = (await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, productIds)
            .pipe(timeout(10000)),
        )) as ProductNameData[];
        productNameById = new Map(
          (Array.isArray(products) ? products : [])
            .filter((product) => typeof product.name === "string")
            .map((product) => [Number(product.id), product.name as string]),
        );
      } catch {
        this.logger.warn(
          "Product name lookup failed — returning low-stock rows without productName",
        );
      }
    }
    return rows.map((row) => ({
      ...row,
      productName: productNameById.get(Number(row.productId)) ?? null,
    }));
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
        INVENTORY_MESSAGE.CANNOT_MODIFY_ANOTHER_USER,
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
        throw new ForbiddenException(INVENTORY_MESSAGE.SKU_NOT_OF_PRODUCT);
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

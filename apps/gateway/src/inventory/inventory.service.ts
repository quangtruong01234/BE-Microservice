import {
  ForbiddenException,
  HttpException,
  Injectable,
  Inject,
  Logger,
} from "@nestjs/common";
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
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
  ) {}

  private async resolveProductId(productId: number | string): Promise<number> {
    if (typeof productId === "number") return productId;
    const product = await firstValueFrom(
      this.productClient
        .send<ProductOwnershipData>(
          PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
          productId,
        )
        .pipe(timeout(TCP_TIMEOUT_MS.READ)),
    );
    return Number(product.id);
  }

  private async exposeProductReferences(value: unknown): Promise<unknown> {
    const productIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (
          key === "productId" &&
          nestedValue !== null &&
          Number.isFinite(Number(nestedValue))
        ) {
          productIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (productIds.size === 0) return value;
    const products = await firstValueFrom(
      this.productClient
        .send<
          ProductNameData[]
        >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [...productIds])
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
    );
    const publicIdById = new Map(
      products.map((product) => [Number(product.id), product.publicId ?? null]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            key === "productId" && nestedValue !== null
              ? (publicIdById.get(Number(nestedValue)) ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return expose(value);
  }

  /**
   * The inventory service builds its product-scoped messages from the numeric
   * product id — the one id the public contract never exposes. Re-render those
   * two messages with the id the caller actually sent. Matching on the exact
   * rendered string (not a regex over digits) keeps every other message, and
   * any other number inside it, untouched.
   */
  private hideInternalProductId(
    error: unknown,
    internalProductId: number,
    publicProductId: number | string,
  ): unknown {
    if (!(error instanceof HttpException)) return error;
    const rewrites = new Map<string, string>([
      [
        INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(internalProductId),
        INVENTORY_MESSAGE.ALREADY_EXISTS_FOR_PRODUCT(publicProductId),
      ],
      [
        INVENTORY_MESSAGE.NOT_FOUND_BY_PRODUCT(internalProductId),
        INVENTORY_MESSAGE.NOT_FOUND_BY_PRODUCT(publicProductId),
      ],
    ]);
    const rewritten = rewrites.get(error.message);
    return rewritten === undefined
      ? error
      : new HttpException(rewritten, error.getStatus());
  }

  async create(
    data: Omit<CreateInventoryDto, "productId"> & {
      productId: number | string;
    },
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    const internalProductId = await this.resolveProductId(data.productId);
    await this.assertProductMutationAccess(
      internalProductId,
      callerId,
      callerRole,
    );
    if (data.productSkuId !== undefined) {
      await this.assertSkuBelongsToProduct(
        data.productSkuId,
        internalProductId,
      );
    }
    try {
      this.logger.log(`Creating inventory: ${JSON.stringify(data)}`);
      return this.exposeProductReferences(
        await firstValueFrom(
          this.inventoryClient
            .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE, {
              ...data,
              productId: internalProductId,
            })
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      try {
        MicroserviceErrorHandler.handleError(
          error,
          "create inventory",
          "Inventory Service",
        );
      } catch (mapped: unknown) {
        throw this.hideInternalProductId(
          mapped,
          internalProductId,
          data.productId,
        );
      }
    }
  }

  async findByProductId(productId: string): Promise<unknown> {
    let internalProductId: number | null = null;
    try {
      internalProductId = await this.resolveProductId(productId);
      return this.exposeProductReferences(
        await firstValueFrom(
          this.inventoryClient
            .send(
              INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID,
              internalProductId,
            )
            .pipe(
              timeout(TCP_TIMEOUT_MS.READ),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
    } catch (error) {
      try {
        MicroserviceErrorHandler.handleError(
          error,
          `find inventory by product ID: ${productId}`,
          "Inventory Service",
        );
      } catch (mapped: unknown) {
        throw internalProductId === null
          ? mapped
          : this.hideInternalProductId(mapped, internalProductId, productId);
      }
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
            .pipe(timeout(TCP_TIMEOUT_MS.READ)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ)),
      )) as LowStockInventoryRow[];
      if (!Array.isArray(lowStockRows) || lowStockRows.length === 0) {
        return [];
      }
      return this.exposeProductReferences(
        await this.attachProductNames(lowStockRows),
      );
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
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
      return this.exposeProductReferences(
        await firstValueFrom(
          this.inventoryClient
            .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE, { id, update })
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ)),
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

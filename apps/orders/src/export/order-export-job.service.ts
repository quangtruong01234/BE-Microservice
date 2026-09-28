import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { In, LessThan, Not, Repository } from "typeorm";
import { generatePublicId } from "@app/common";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { ORDER_MESSAGE } from "libs/constant/response-message.constant";
import { ExportJob } from "../entity/export-job.entity";
import { OrdersService } from "../orders.service";
import {
  CreateExportJobPayload,
  ExportJobDownload,
  ExportJobLookupPayload,
  ExportJobView,
  OrderExportScope,
} from "../orders.types";
import {
  EXPORT_JOB_MAX_ROWS,
  EXPORT_JOB_MAX_WINDOW_DAYS,
} from "./seller-orders.export";

/** Pending + running jobs one user may hold at once. */
export const EXPORT_JOB_MAX_ACTIVE_PER_USER = 3;
/** How long a finished file stays downloadable. */
export const EXPORT_JOB_FILE_TTL_MS = 24 * 60 * 60 * 1000;
/** A job still `running` after this is treated as a dead worker's. */
export const EXPORT_JOB_STALE_RUNNING_MS = 15 * 60 * 1000;
/** Job rows (and their audit trail) are deleted after this. */
export const EXPORT_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** MEDIUMBLOB ceiling (2^24 - 1 bytes). */
export const EXPORT_JOB_MAX_FILE_BYTES = 16_777_215;
/** The "my jobs" list is the latest N, not paginated. */
export const EXPORT_JOB_LIST_LIMIT = 20;
/** Jobs one worker pass renders before yielding to the next tick. */
const EXPORT_JOB_BATCH_SIZE = 5;

/**
 * EXPORT-CSV-01 T5 — async order exports.
 *
 * `create` validates the window and row count SYNCHRONOUSLY (a bad request is
 * still an immediate 400, not a job that fails a minute later), stores a
 * `pending` row and nudges the worker. The worker claims a row with a
 * conditional UPDATE, so two orders-service instances never render the same
 * job, then renders through the SAME `renderOrderExportCsv` the sync routes
 * use — the two paths cannot drift into two different files.
 */
@Injectable()
export class OrderExportJobService {
  private readonly logger = new Logger(OrderExportJobService.name);
  private isWorkerBusy = false;

  constructor(
    @InjectRepository(ExportJob)
    private readonly exportJobRepository: Repository<ExportJob>,
    private readonly ordersService: OrdersService,
  ) {}

  async createJob(payload: CreateExportJobPayload): Promise<ExportJobView> {
    const scope = this.toScope(payload);
    await this.ordersService.assertOrderExportWithinCaps(scope, {
      maxWindowDays: EXPORT_JOB_MAX_WINDOW_DAYS,
      maxRows: EXPORT_JOB_MAX_ROWS,
    });

    const activeCount = await this.exportJobRepository.count({
      where: {
        requestedBy: payload.requestedBy,
        state: In(["pending", "running"]),
      },
    });
    if (activeCount >= EXPORT_JOB_MAX_ACTIVE_PER_USER) {
      throw new HttpException(
        ORDER_MESSAGE.EXPORT_JOB_TOO_MANY_ACTIVE(
          EXPORT_JOB_MAX_ACTIVE_PER_USER,
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const job = await this.exportJobRepository.save(
      this.exportJobRepository.create({
        publicId: generatePublicId(PUBLIC_ID_PREFIXES.EXPORT_JOB),
        requestedBy: payload.requestedBy,
        scope: payload.scope,
        sellerId: payload.sellerId,
        rangeFrom: payload.from,
        rangeTo: payload.to,
        statusFilter: payload.status ?? null,
        state: "pending",
      }),
    );
    this.kickWorker();
    return this.toView(job);
  }

  async listJobs(requestedBy: number): Promise<ExportJobView[]> {
    const jobs = await this.exportJobRepository.find({
      where: { requestedBy },
      order: { id: "DESC" },
      take: EXPORT_JOB_LIST_LIMIT,
    });
    return jobs.map((job) => this.toView(job));
  }

  async getJob(payload: ExportJobLookupPayload): Promise<ExportJobView> {
    return this.toView(await this.findOwnedJob(payload));
  }

  async downloadJob(
    payload: ExportJobLookupPayload,
  ): Promise<ExportJobDownload> {
    const job = await this.findOwnedJob(payload);
    if (job.state === "pending" || job.state === "running") {
      throw new ConflictException(
        ORDER_MESSAGE.EXPORT_JOB_NOT_READY(job.state),
      );
    }
    if (job.state === "failed") {
      throw new ConflictException(
        ORDER_MESSAGE.EXPORT_JOB_FAILED(
          job.errorMessage ?? ORDER_MESSAGE.EXPORT_JOB_UNEXPECTED_FAILURE,
        ),
      );
    }
    if (job.state === "expired") {
      throw new GoneException(ORDER_MESSAGE.EXPORT_JOB_EXPIRED);
    }

    // `file` is `select: false`; only this path ever loads it.
    const withFile = await this.exportJobRepository.findOne({
      where: { id: job.id },
      select: { id: true, fileName: true, file: true },
    });
    // The expiry cron can NULL the file between the two reads.
    if (!withFile?.file) {
      throw new GoneException(ORDER_MESSAGE.EXPORT_JOB_EXPIRED);
    }
    return {
      fileName: withFile.fileName ?? this.buildFileName(job),
      contentBase64: Buffer.from(withFile.file).toString("base64"),
    };
  }

  /**
   * Fire-and-forget nudge after a create, so a small job finishes in seconds
   * instead of waiting up to 30s for the next cron tick. Public for the spec.
   */
  kickWorker(): void {
    setImmediate(() => {
      void this.runPendingJobs();
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async runPendingJobs(): Promise<void> {
    if (this.isWorkerBusy) return;
    this.isWorkerBusy = true;
    try {
      await this.failStaleRunningJobs();
      const pendingJobs = await this.exportJobRepository.find({
        where: { state: "pending" },
        order: { id: "ASC" },
        take: EXPORT_JOB_BATCH_SIZE,
      });
      for (const job of pendingJobs) {
        await this.processJob(job);
      }
    } catch (err: unknown) {
      this.logger.error(
        `[EXPORT-JOB] worker pass failed: ${this.describeError(err)}`,
      );
    } finally {
      this.isWorkerBusy = false;
    }
  }

  /** Drop expired files, then delete rows past the retention window. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredJobs(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.exportJobRepository.update(
        { state: "done", expiresAt: LessThan(now) },
        { state: "expired", file: null },
      );
      const deleted = await this.exportJobRepository.delete({
        state: Not("running"),
        createdAt: LessThan(new Date(now.getTime() - EXPORT_JOB_RETENTION_MS)),
      });
      if ((expired.affected ?? 0) > 0 || (deleted.affected ?? 0) > 0) {
        this.logger.log(
          `[EXPORT-JOB] expired ${expired.affected ?? 0} file(s), deleted ${deleted.affected ?? 0} row(s)`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `[EXPORT-JOB] purge failed: ${this.describeError(err)}`,
      );
    }
  }

  private async processJob(job: ExportJob): Promise<void> {
    // Claim: only the instance whose UPDATE flips pending → running renders.
    const claim = await this.exportJobRepository.update(
      { id: job.id, state: "pending" },
      { state: "running", startedAt: new Date() },
    );
    if (claim.affected !== 1) return;

    try {
      const scope = this.toScope({
        requestedBy: job.requestedBy,
        scope: job.scope,
        sellerId: job.sellerId,
        from: job.rangeFrom,
        to: job.rangeTo,
        status: job.statusFilter ?? undefined,
      });
      // Re-checked at run time: rows can have landed since the create.
      const { fromDate, toDate, rowCount } =
        await this.ordersService.assertOrderExportWithinCaps(scope, {
          maxWindowDays: EXPORT_JOB_MAX_WINDOW_DAYS,
          maxRows: EXPORT_JOB_MAX_ROWS,
        });
      const csvBuffer = await this.ordersService.renderOrderExportCsv(
        scope,
        fromDate,
        toDate,
        job.scope === "admin",
      );
      if (csvBuffer.length > EXPORT_JOB_MAX_FILE_BYTES) {
        throw new ConflictException(
          ORDER_MESSAGE.EXPORT_JOB_FILE_TOO_LARGE(
            csvBuffer.length,
            EXPORT_JOB_MAX_FILE_BYTES,
          ),
        );
      }

      const finishedAt = new Date();
      await this.exportJobRepository.update(
        { id: job.id },
        {
          state: "done",
          rowCount,
          file: csvBuffer,
          fileSize: csvBuffer.length,
          fileName: this.buildFileName(job),
          finishedAt,
          expiresAt: new Date(finishedAt.getTime() + EXPORT_JOB_FILE_TTL_MS),
        },
      );
    } catch (err: unknown) {
      // A 4xx is the caller's (window/rows/size) and its message is safe to
      // show; anything else is logged and replaced with a generic message so
      // no driver error reaches the job row the FE displays.
      const clientMessage =
        err instanceof HttpException && err.getStatus() < 500
          ? err.message
          : null;
      if (clientMessage === null) {
        this.logger.error(
          `[EXPORT-JOB] job ${job.publicId} failed: ${this.describeError(err)}`,
        );
      }
      await this.exportJobRepository.update(
        { id: job.id },
        {
          state: "failed",
          errorMessage:
            clientMessage?.slice(0, 500) ??
            ORDER_MESSAGE.EXPORT_JOB_UNEXPECTED_FAILURE,
          finishedAt: new Date(),
        },
      );
    }
  }

  /** A worker that died mid-render leaves its job `running` forever. */
  private async failStaleRunningJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - EXPORT_JOB_STALE_RUNNING_MS);
    await this.exportJobRepository.update(
      { state: "running", startedAt: LessThan(staleBefore) },
      {
        state: "failed",
        errorMessage: ORDER_MESSAGE.EXPORT_JOB_INTERRUPTED,
        finishedAt: new Date(),
      },
    );
  }

  /** Another user's job is a 404, never a 403 — its existence is not leaked. */
  private async findOwnedJob(
    payload: ExportJobLookupPayload,
  ): Promise<ExportJob> {
    const job = await this.exportJobRepository.findOne({
      where: { publicId: payload.jobId, requestedBy: payload.requestedBy },
    });
    if (!job) {
      throw new NotFoundException(ORDER_MESSAGE.EXPORT_JOB_NOT_FOUND);
    }
    return job;
  }

  private toScope(payload: CreateExportJobPayload): OrderExportScope {
    return {
      sellerId: payload.sellerId,
      from: payload.from,
      to: payload.to,
      status: payload.status,
    };
  }

  /** Same names as the sync routes, so a job file and a sync file sort together. */
  private buildFileName(job: ExportJob): string {
    const fromDay = job.rangeFrom.slice(0, 10);
    const toDay = job.rangeTo.slice(0, 10);
    return job.scope === "admin"
      ? `trybuy-orders-all-${fromDay}-${toDay}.csv`
      : `trybuy-orders-${fromDay}-${toDay}.csv`;
  }

  private toView(job: ExportJob): ExportJobView {
    return {
      id: job.publicId,
      scope: job.scope,
      from: job.rangeFrom,
      to: job.rangeTo,
      statusFilter: job.statusFilter ?? null,
      state: job.state,
      rowCount: job.rowCount ?? null,
      fileName: job.fileName ?? null,
      fileSizeBytes: job.fileSize ?? null,
      errorMessage: job.errorMessage ?? null,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      expiresAt: job.expiresAt ?? null,
    };
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

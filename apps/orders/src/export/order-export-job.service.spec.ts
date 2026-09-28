import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { createRepositoryMock, RepositoryMock } from "@app/testing";
import { ExportJob } from "../entity/export-job.entity";
import { OrdersService } from "../orders.service";
import {
  EXPORT_JOB_FILE_TTL_MS,
  EXPORT_JOB_MAX_ACTIVE_PER_USER,
  OrderExportJobService,
} from "./order-export-job.service";
import {
  EXPORT_JOB_MAX_ROWS,
  EXPORT_JOB_MAX_WINDOW_DAYS,
} from "./seller-orders.export";

const FROM_DATE = new Date("2026-01-01T00:00:00+07:00");
const TO_DATE = new Date("2026-12-31T23:59:59+07:00");

function buildJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 11,
    publicId: "exp_abc",
    requestedBy: 5,
    scope: "seller",
    sellerId: 5,
    rangeFrom: "2026-01-01",
    rangeTo: "2026-12-31",
    statusFilter: null,
    state: "pending",
    rowCount: null,
    fileName: null,
    fileSize: null,
    file: null,
    errorMessage: null,
    createdAt: new Date("2026-09-28T01:00:00Z"),
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("OrderExportJobService (EXPORT-CSV-01 T5)", () => {
  let jobRepository: RepositoryMock<ExportJob>;
  let assertOrderExportWithinCaps: jest.Mock;
  let renderOrderExportCsv: jest.Mock;
  let service: OrderExportJobService;
  let kickWorker: jest.SpyInstance;

  beforeEach(() => {
    jobRepository = createRepositoryMock<ExportJob>();
    assertOrderExportWithinCaps = jest.fn().mockResolvedValue({
      fromDate: FROM_DATE,
      toDate: TO_DATE,
      rowCount: 3,
    });
    renderOrderExportCsv = jest
      .fn()
      .mockResolvedValue(Buffer.from("﻿orderId\r\nord_1\r\n"));
    const ordersService = {
      assertOrderExportWithinCaps,
      renderOrderExportCsv,
    } as unknown as OrdersService;
    service = new OrderExportJobService(
      jobRepository.asRepository(),
      ordersService,
    );
    // Never let a create's fire-and-forget nudge run inside a spec.
    kickWorker = jest
      .spyOn(service, "kickWorker")
      .mockImplementation(() => undefined);
  });

  describe("createJob", () => {
    const payload = {
      requestedBy: 5,
      scope: "seller" as const,
      sellerId: 5,
      from: "2026-01-01",
      to: "2026-12-31",
    };

    it("validates against the JOB caps, stores a pending row and nudges the worker", async () => {
      const view = await service.createJob(payload);

      expect(assertOrderExportWithinCaps).toHaveBeenCalledWith(
        {
          sellerId: 5,
          from: "2026-01-01",
          to: "2026-12-31",
          status: undefined,
        },
        {
          maxWindowDays: EXPORT_JOB_MAX_WINDOW_DAYS,
          maxRows: EXPORT_JOB_MAX_ROWS,
        },
      );
      expect(jobRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedBy: 5,
          scope: "seller",
          sellerId: 5,
          state: "pending",
          statusFilter: null,
        }),
      );
      expect(view.id).toMatch(/^exp_/);
      expect(view.state).toBe("pending");
      // No numeric id leaves the service.
      expect(view).not.toHaveProperty("requestedBy");
      expect(view).not.toHaveProperty("sellerId");
      expect(kickWorker).toHaveBeenCalledTimes(1);
    });

    it("rejects an over-cap window synchronously, before any row is written", async () => {
      assertOrderExportWithinCaps.mockRejectedValue(
        new BadRequestException("Export window is 400 days"),
      );

      await expect(service.createJob(payload)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(jobRepository.save).not.toHaveBeenCalled();
      expect(kickWorker).not.toHaveBeenCalled();
    });

    it("is a 429 once the user already holds the maximum active jobs", async () => {
      jobRepository.count.mockResolvedValue(EXPORT_JOB_MAX_ACTIVE_PER_USER);

      const rejection = service.createJob(payload);

      await expect(rejection).rejects.toBeInstanceOf(HttpException);
      await expect(rejection).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(jobRepository.save).not.toHaveBeenCalled();
    });
  });

  describe("runPendingJobs", () => {
    it("claims, renders with the job's layout and stores the file for 24h", async () => {
      jobRepository.find.mockResolvedValue([
        buildJob({ scope: "admin", sellerId: null }),
      ]);
      jobRepository.update.mockResolvedValue({ affected: 1 });

      await service.runPendingJobs();

      expect(jobRepository.update).toHaveBeenCalledWith(
        { id: 11, state: "pending" },
        expect.objectContaining({ state: "running" }),
      );
      expect(renderOrderExportCsv).toHaveBeenCalledWith(
        {
          sellerId: null,
          from: "2026-01-01",
          to: "2026-12-31",
          status: undefined,
        },
        FROM_DATE,
        TO_DATE,
        true,
      );
      const doneCall = (
        jobRepository.update.mock.calls as Array<[unknown, Partial<ExportJob>]>
      ).find(([, changes]) => changes.state === "done");
      expect(doneCall).toBeDefined();
      const doneChanges = (doneCall as [unknown, Partial<ExportJob>])[1];
      expect(doneChanges.rowCount).toBe(3);
      expect(doneChanges.fileName).toBe(
        "trybuy-orders-all-2026-01-01-2026-12-31.csv",
      );
      expect(doneChanges.fileSize).toBe((doneChanges.file as Buffer).length);
      expect(
        (doneChanges.expiresAt as Date).getTime() -
          (doneChanges.finishedAt as Date).getTime(),
      ).toBe(EXPORT_JOB_FILE_TTL_MS);
    });

    it("skips a job another instance already claimed", async () => {
      jobRepository.find.mockResolvedValue([buildJob()]);
      jobRepository.update.mockResolvedValue({ affected: 0 });

      await service.runPendingJobs();

      expect(renderOrderExportCsv).not.toHaveBeenCalled();
    });

    it("stores a 4xx reason verbatim but hides an unexpected error", async () => {
      jobRepository.find.mockResolvedValue([
        buildJob({ id: 1 }),
        buildJob({ id: 2 }),
      ]);
      jobRepository.update.mockResolvedValue({ affected: 1 });
      assertOrderExportWithinCaps
        .mockRejectedValueOnce(
          new BadRequestException("Export matches 60000 item rows"),
        )
        .mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT at mysql2"));

      await service.runPendingJobs();

      // Per-job updates only (keyed by id) — not the stale-running sweep.
      const failedMessages = jobRepository.update.mock.calls
        .filter(([criteria]) => "id" in (criteria as object))
        .map(([, changes]) => changes as Partial<ExportJob>)
        .filter((changes) => changes.state === "failed")
        .map((changes) => changes.errorMessage);
      expect(failedMessages).toEqual([
        "Export matches 60000 item rows",
        "Export failed unexpectedly. Request a new export.",
      ]);
    });

    it("does not start a second pass while one is running", async () => {
      let releaseFind: (jobs: ExportJob[]) => void = () => undefined;
      jobRepository.find.mockReturnValue(
        new Promise<ExportJob[]>((resolve) => {
          releaseFind = resolve;
        }),
      );

      const firstPass = service.runPendingJobs();
      await service.runPendingJobs();
      releaseFind([]);
      await firstPass;

      expect(jobRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe("getJob / downloadJob", () => {
    const lookup = { requestedBy: 5, jobId: "exp_abc" };

    it("scopes every lookup to the caller, so another user's job is a 404", async () => {
      await expect(service.getJob(lookup)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(jobRepository.findOne).toHaveBeenCalledWith({
        where: { publicId: "exp_abc", requestedBy: 5 },
      });
    });

    it.each(["pending", "running", "failed"] as const)(
      "answers 409 for a %s job",
      async (state) => {
        jobRepository.findOne.mockResolvedValue(
          buildJob({ state, errorMessage: "too wide" }),
        );

        await expect(service.downloadJob(lookup)).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );

    it("answers 410 for an expired job, and when the file vanished mid-read", async () => {
      jobRepository.findOne.mockResolvedValueOnce(
        buildJob({ state: "expired" }),
      );
      await expect(service.downloadJob(lookup)).rejects.toBeInstanceOf(
        GoneException,
      );

      jobRepository.findOne
        .mockResolvedValueOnce(buildJob({ state: "done" }))
        .mockResolvedValueOnce({ id: 11, fileName: "x.csv", file: null });
      await expect(service.downloadJob(lookup)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it("returns a done job's file as base64 with its stored name", async () => {
      const csvBuffer = Buffer.from("﻿orderId\r\n");
      jobRepository.findOne
        .mockResolvedValueOnce(buildJob({ state: "done" }))
        .mockResolvedValueOnce({
          id: 11,
          fileName: "trybuy-orders-2026-01-01-2026-12-31.csv",
          file: csvBuffer,
        });

      const download = await service.downloadJob(lookup);

      expect(download.fileName).toBe("trybuy-orders-2026-01-01-2026-12-31.csv");
      expect(Buffer.from(download.contentBase64, "base64")).toEqual(csvBuffer);
    });
  });

  it("expires finished files and never deletes a running job", async () => {
    jobRepository.update.mockResolvedValue({ affected: 2 });

    await service.purgeExpiredJobs();

    expect(jobRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "done" }),
      { state: "expired", file: null },
    );
    const [[deleteCriteria]] = jobRepository.delete.mock.calls as Array<
      [{ state: { _type: string; _value: unknown } }]
    >;
    expect(deleteCriteria.state._type).toBe("not");
    expect(deleteCriteria.state._value).toBe("running");
  });
});

import { Prisma, TarefaAssincrona } from '@prisma/client';
import {
  AnalyticalReportCategory,
  AsyncJobStatus,
  ReportExportFormat,
} from '../domain/enums';
import { NotFoundError, ValidationError } from '../errors/app-error';
import {
  AsyncJobFilters,
  AsyncJobRepository,
} from '../repositories/async-job.repository';
import { assertPermission } from '../security/rbac';
import { AnalyticsService } from './analytics.service';
import { ActorContext } from './audit-event.service';

export interface EnqueueReportJobInput {
  category?: string;
  format?: string;
  organizationId?: string | null;
  requestedBy: string;
  maxAttempts?: number;
  webhookUrl?: string | null;
  simulateFailuresCount?: number;
}

export class AsyncJobQueueService {
  private static schedulerTimer: NodeJS.Timeout | null = null;
  private readonly pendingSimulatedFailures = new Map<string, number>();

  constructor(
    private readonly jobRepo: AsyncJobRepository = new AsyncJobRepository(),
    private readonly analyticsService: AnalyticsService = new AnalyticsService()
  ) {}

  async enqueueReportJob(input: EnqueueReportJobInput): Promise<TarefaAssincrona> {
    const category = (
      input.category || AnalyticalReportCategory.CONSOLIDADO_COMPLETO
    ).toUpperCase() as AnalyticalReportCategory;
    if (!Object.values(AnalyticalReportCategory).includes(category)) {
      throw new ValidationError(
        `Categoria de relatório inválida para fila: '${input.category}'.`
      );
    }

    const format = (
      input.format || ReportExportFormat.JSON
    ).toUpperCase() as ReportExportFormat;
    if (!Object.values(ReportExportFormat).includes(format)) {
      throw new ValidationError(
        `Formato de exportação inválido: '${input.format}'. Valores aceitos: JSON, CSV.`
      );
    }

    const maxAttempts = Number(input.maxAttempts ?? 3);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new ValidationError('maxAttempts deve ser um inteiro entre 1 e 10.');
    }

    const job = await this.jobRepo.create({
      type: category,
      format,
      status: AsyncJobStatus.PENDING,
      organizationId: input.organizationId || null,
      requestedBy: input.requestedBy,
      maxAttempts,
      webhookUrl: input.webhookUrl || null,
      payload: {
        category,
        format,
        organizationId: input.organizationId || null,
        simulateFailuresCount: input.simulateFailuresCount ?? 0,
      } as Prisma.InputJsonValue,
    });

    if (input.simulateFailuresCount && input.simulateFailuresCount > 0) {
      this.pendingSimulatedFailures.set(job.id, input.simulateFailuresCount);
    }

    // Dispara worker assíncrono em background sem bloquear a resposta HTTP (202 Accepted)
    setImmediate(() => {
      void this.processJobWithRetry(job.id);
    });

    return job;
  }

  async processJobWithRetry(jobId: string, baseBackoffMs = 25): Promise<TarefaAssincrona> {
    const initial = await this.jobRepo.findById(jobId);
    if (!initial) {
      throw new NotFoundError('Tarefa assíncrona não encontrada.');
    }
    if (initial.status === AsyncJobStatus.COMPLETED) {
      return initial;
    }

    let currentAttempt = initial.attempts;
    const maxAttempts = initial.maxAttempts;

    while (currentAttempt < maxAttempts) {
      currentAttempt += 1;

      await this.jobRepo.updateState(jobId, {
        status: AsyncJobStatus.PROCESSING,
        attempts: currentAttempt,
        startedAt: initial.startedAt ?? new Date(),
      });

      try {
        const remainingSimulatedFailures =
          this.pendingSimulatedFailures.get(jobId) ?? 0;
        if (remainingSimulatedFailures > 0) {
          this.pendingSimulatedFailures.set(jobId, remainingSimulatedFailures - 1);
          throw new Error(
            `Falha transitória simulada no worker analítico (tentativa ${currentAttempt}/${maxAttempts}).`
          );
        }

        const report = await this.analyticsService.generateAndPersistReport({
          category: initial.type as AnalyticalReportCategory,
          organizationId: initial.organizationId,
          generatedBy: `ASYNC_WORKER:${initial.requestedBy}`,
        });

        const formattedResult =
          initial.format === ReportExportFormat.CSV
            ? AnalyticsService.formatReportAsCsv(report)
            : JSON.stringify(report, null, 2);

        const completed = await this.jobRepo.updateState(jobId, {
          status: AsyncJobStatus.COMPLETED,
          reportId: report.id,
          resultData: formattedResult,
          lastError: null,
          completedAt: new Date(),
        });

        return completed;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Erro desconhecido no processamento do job.';

        if (currentAttempt >= maxAttempts) {
          return this.jobRepo.updateState(jobId, {
            status: AsyncJobStatus.FAILED,
            lastError: errorMessage,
            completedAt: new Date(),
          });
        }

        await this.jobRepo.updateState(jobId, {
          status: AsyncJobStatus.PENDING,
          lastError: errorMessage,
        });

        // Exponential backoff entre tentativas
        const delayMs = baseBackoffMs * Math.pow(2, currentAttempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const finalState = await this.jobRepo.findById(jobId);
    return finalState!;
  }

  async getJobStatus(
    id: string,
    organizationScopeId?: string
  ): Promise<Omit<TarefaAssincrona, 'resultData'> & { downloadReady: boolean }> {
    const job = await this.jobRepo.findById(id);
    if (!job) {
      throw new NotFoundError('Tarefa assíncrona não encontrada.');
    }
    if (organizationScopeId && job.organizationId !== organizationScopeId) {
      throw new NotFoundError('Tarefa assíncrona não pertence a esta organização.');
    }

    const { resultData, ...meta } = job;
    return {
      ...meta,
      downloadReady:
        job.status === AsyncJobStatus.COMPLETED && Boolean(resultData),
    };
  }

  async getJobDownload(
    id: string,
    organizationScopeId?: string
  ): Promise<{ contentType: string; filename: string; content: string; job: TarefaAssincrona }> {
    const job = await this.jobRepo.findById(id);
    if (!job) {
      throw new NotFoundError('Tarefa assíncrona não encontrada.');
    }
    if (organizationScopeId && job.organizationId !== organizationScopeId) {
      throw new NotFoundError('Tarefa assíncrona não pertence a esta organização.');
    }

    if (job.status !== AsyncJobStatus.COMPLETED || !job.resultData) {
      throw new ValidationError(
        `O relatório da tarefa '${job.id}' ainda não está pronto para download (status atual: ${job.status}).`
      );
    }

    const isCsv = job.format === ReportExportFormat.CSV;
    return {
      contentType: isCsv
        ? 'text/csv; charset=utf-8'
        : 'application/json; charset=utf-8',
      filename: `greencode-report-${job.id}.${isCsv ? 'csv' : 'json'}`,
      content: job.resultData,
      job,
    };
  }

  async listJobs(
    actor: ActorContext,
    filters: AsyncJobFilters = {}
  ): Promise<Array<Omit<TarefaAssincrona, 'resultData'>>> {
    assertPermission(actor.role, 'job', 'read');
    const jobs = await this.jobRepo.findAll(filters);
    return jobs.map(({ resultData: _ignored, ...rest }) => rest);
  }

  /**
   * Tarefa recorrente agendada (Background Cron Worker) para consolidação analítica periódica
   */
  startRecurringAnalyticsCron(intervalMs = 15 * 60 * 1000): void {
    if (AsyncJobQueueService.schedulerTimer) return;
    AsyncJobQueueService.schedulerTimer = setInterval(() => {
      void this.analyticsService
        .generateAndPersistReport({
          category: AnalyticalReportCategory.CONSOLIDADO_COMPLETO,
          generatedBy: 'SCHEDULED_CRON_WORKER',
        })
        .catch(() => {
          // Silencia erro de background em shutdown
        });
    }, intervalMs);
    AsyncJobQueueService.schedulerTimer.unref();
  }

  stopRecurringAnalyticsCron(): void {
    if (AsyncJobQueueService.schedulerTimer) {
      clearInterval(AsyncJobQueueService.schedulerTimer);
      AsyncJobQueueService.schedulerTimer = null;
    }
  }
}

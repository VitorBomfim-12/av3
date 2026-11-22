import { FastifyReply, FastifyRequest } from 'fastify';
import { AnalyticalReportCategory } from '../domain/enums';
import { assertPermission } from '../security/rbac';
import { AnalyticsService } from '../services/analytics.service';
import { AsyncJobQueueService } from '../services/async-job.service';

interface IdParams {
  id: string;
}

interface OrgFilterQuery {
  organizationId?: string;
  persist?: string;
}

interface ReportListQuery {
  category?: string;
  organizationId?: string;
}

interface GenerateReportBody {
  category: string;
  organizationId?: string | null;
}

interface EnqueueJobBody {
  category?: string;
  format?: string;
  organizationId?: string | null;
  maxAttempts?: number;
  webhookUrl?: string | null;
  simulateFailuresCount?: number;
}

interface JobListQuery {
  status?: string;
  organizationId?: string;
  type?: string;
}

export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService = new AnalyticsService(),
    private readonly jobQueueService: AsyncJobQueueService = new AsyncJobQueueService()
  ) {}

  operationalEfficiency = async (
    request: FastifyRequest<{ Querystring: OrgFilterQuery }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'analytics', 'read');
    const { organizationId, persist } = request.query;

    if (persist === 'true') {
      const report = await this.analyticsService.generateAndPersistReport({
        category: AnalyticalReportCategory.EFICIENCIA_OPERACIONAL,
        organizationId,
        generatedBy: `USER:${request.actor.username}`,
        actorId: request.actor.id,
      });
      return reply.status(200).send(report);
    }

    const metrics = await this.analyticsService.computeOperationalEfficiency(
      organizationId
    );
    return reply.status(200).send(metrics);
  };

  equipmentProfitability = async (
    request: FastifyRequest<{ Querystring: OrgFilterQuery }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'analytics', 'read');
    const { organizationId, persist } = request.query;

    if (persist === 'true') {
      const report = await this.analyticsService.generateAndPersistReport({
        category: AnalyticalReportCategory.RENTABILIDADE_EQUIPAMENTO,
        organizationId,
        generatedBy: `USER:${request.actor.username}`,
        actorId: request.actor.id,
      });
      return reply.status(200).send(report);
    }

    const metrics = await this.analyticsService.computeEquipmentProfitability(
      organizationId
    );
    return reply.status(200).send(metrics);
  };

  remainingUsefulLife = async (
    request: FastifyRequest<{ Querystring: OrgFilterQuery }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'analytics', 'read');
    const { organizationId, persist } = request.query;

    if (persist !== 'false') {
      const report = await this.analyticsService.generateAndPersistReport({
        category: AnalyticalReportCategory.VIDA_UTIL_PREDITIVA,
        organizationId,
        generatedBy: `USER:${request.actor.username}`,
        actorId: request.actor.id,
      });
      return reply.status(200).send(report);
    }

    const rul = await this.analyticsService.computePredictiveRemainingUsefulLife(
      organizationId
    );
    return reply.status(200).send(rul);
  };

  generateAndSaveReport = async (
    request: FastifyRequest<{ Body: GenerateReportBody }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'analytics', 'write');
    const report = await this.analyticsService.generateAndPersistReport({
      category: request.body.category,
      organizationId: request.body.organizationId,
      generatedBy: `USER:${request.actor.username}`,
      actorId: request.actor.id,
    });
    return reply.status(201).send(report);
  };

  listReports = async (
    request: FastifyRequest<{ Querystring: ReportListQuery }>,
    reply: FastifyReply
  ) => {
    const reports = await this.analyticsService.listReports(
      request.actor,
      request.query
    );
    return reply.status(200).send(reports);
  };

  getReportById = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    const report = await this.analyticsService.getReportById(
      request.actor,
      request.params.id
    );
    return reply.status(200).send(report);
  };

  enqueueJob = async (
    request: FastifyRequest<{ Body: EnqueueJobBody }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'job', 'write');
    const job = await this.jobQueueService.enqueueReportJob({
      category: request.body.category,
      format: request.body.format,
      organizationId: request.body.organizationId,
      requestedBy: `USER:${request.actor.username}`,
      maxAttempts: request.body.maxAttempts,
      webhookUrl: request.body.webhookUrl,
      simulateFailuresCount: request.body.simulateFailuresCount,
    });

    return reply.status(202).send({
      jobId: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      statusUrl: `/api/v1/internal/jobs/${job.id}`,
      downloadUrl: `/api/v1/internal/jobs/${job.id}/download`,
    });
  };

  listJobs = async (
    request: FastifyRequest<{ Querystring: JobListQuery }>,
    reply: FastifyReply
  ) => {
    const jobs = await this.jobQueueService.listJobs(
      request.actor,
      request.query
    );
    return reply.status(200).send(jobs);
  };

  getJobStatus = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'job', 'read');
    const status = await this.jobQueueService.getJobStatus(request.params.id);
    return reply.status(200).send(status);
  };

  downloadJobResult = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    assertPermission(request.actor.role, 'job', 'read');
    const result = await this.jobQueueService.getJobDownload(request.params.id);
    reply.header('Content-Type', result.contentType);
    reply.header(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    return reply.status(200).send(result.content);
  };
}

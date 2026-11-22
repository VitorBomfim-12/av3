import { FastifyReply, FastifyRequest } from 'fastify';
import { AnalyticalReportCategory, Role } from '../domain/enums';
import { NotFoundError } from '../errors/app-error';
import { EquipmentRepository } from '../repositories/equipment.repository';
import { LotRepository } from '../repositories/lot.repository';
import { MovementRepository } from '../repositories/movement.repository';
import { AnalyticsService } from '../services/analytics.service';
import { AsyncJobQueueService } from '../services/async-job.service';
import { InlineLotEquipmentInput, LotService } from '../services/lot.service';

interface IdParams {
  id: string;
}

interface BarcodeParams {
  barcode: string;
}

interface PartnerCreateLotBody {
  code: string;
  invoiceNumber?: string | null;
  carrier?: string | null;
  origin: string;
  destination: string;
  entryDate?: string;
  notes?: string;
  newEquipments?: InlineLotEquipmentInput[];
}

interface PartnerReportQuery {
  category?: string;
}

interface PartnerEnqueueReportBody {
  category?: string;
  format?: string;
  maxAttempts?: number;
  webhookUrl?: string | null;
  simulateFailuresCount?: number;
}

export class PublicApiController {
  constructor(
    private readonly equipRepo: EquipmentRepository = new EquipmentRepository(),
    private readonly lotRepo: LotRepository = new LotRepository(),
    private readonly movementRepo: MovementRepository = new MovementRepository(),
    private readonly lotService: LotService = new LotService(),
    private readonly analyticsService: AnalyticsService = new AnalyticsService(),
    private readonly jobQueueService: AsyncJobQueueService = new AsyncJobQueueService()
  ) {}

  getTrackingByBarcode = async (
    request: FastifyRequest<{ Params: BarcodeParams }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const eq = await this.equipRepo.findByBarcode(request.params.barcode);
    if (!eq || eq.organizationId !== partner.organizationId) {
      throw new NotFoundError(
        `Equipamento com código de barras '${request.params.barcode}' não encontrado para a organização parceira.`
      );
    }

    const movements = await this.movementRepo.findByEquipmentId(eq.id);
    return reply.status(200).send({
      apiVersion: '1.0.0',
      organization: {
        id: partner.organizationId,
        name: partner.organizationName,
        cnpj: partner.cnpj,
      },
      equipment: eq,
      traceabilityHistory: movements,
    });
  };

  listPartnerEquipments = async (
    request: FastifyRequest<{ Querystring: { status?: string; condition?: string; lotId?: string } }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const equipments = await this.equipRepo.findAll({
      organizationId: partner.organizationId,
      status: request.query.status,
      condition: request.query.condition,
      lotId: request.query.lotId,
    });
    return reply.status(200).send(equipments);
  };

  listPartnerLots = async (
    request: FastifyRequest<{ Querystring: { status?: string } }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const lots = await this.lotRepo.findAll({
      organizationId: partner.organizationId,
      status: request.query.status,
    });
    return reply.status(200).send(lots);
  };

  submitPartnerLot = async (
    request: FastifyRequest<{ Body: PartnerCreateLotBody }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    // Busca um usuário gestor/admin ativo para constar como operador responsável pela integração B2B
    const systemActorUser = await this.lotRepo.findFirstSystemActor();

    const createdLot = await this.lotService.create(
      {
        id: systemActorUser,
        username: `PARTNER_API:${partner.keyName}`,
        role: Role.ALMOXARIFE,
      },
      {
        code: request.body.code,
        organizationId: partner.organizationId,
        invoiceNumber: request.body.invoiceNumber,
        carrier: request.body.carrier,
        origin: request.body.origin,
        destination: request.body.destination,
        entryDate: request.body.entryDate,
        notes: request.body.notes ?? `Submetido via API Pública (Chave: ${partner.keyName})`,
        newEquipments: request.body.newEquipments,
      }
    );

    return reply.status(201).send(createdLot);
  };

  getPartnerAnalyticsSummary = async (
    request: FastifyRequest<{ Querystring: PartnerReportQuery }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const category = (
      request.query.category || AnalyticalReportCategory.CONSOLIDADO_COMPLETO
    ).toUpperCase();

    const report = await this.analyticsService.generateAndPersistReport({
      category,
      organizationId: partner.organizationId,
      generatedBy: `PARTNER_API_KEY:${partner.keyName}`,
    });

    return reply.status(200).send(report);
  };

  enqueuePartnerReportJob = async (
    request: FastifyRequest<{ Body: PartnerEnqueueReportBody }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const job = await this.jobQueueService.enqueueReportJob({
      category:
        request.body.category || AnalyticalReportCategory.VIDA_UTIL_PREDITIVA,
      format: request.body.format || 'JSON',
      organizationId: partner.organizationId,
      requestedBy: `PARTNER_API_KEY:${partner.keyName}`,
      maxAttempts: request.body.maxAttempts,
      webhookUrl: request.body.webhookUrl,
      simulateFailuresCount: request.body.simulateFailuresCount,
    });

    return reply.status(202).send({
      apiVersion: '1.0.0',
      jobId: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      pollingStatusUrl: `/api/v1/public/jobs/${job.id}`,
      downloadUrl: `/api/v1/public/jobs/${job.id}/download`,
    });
  };

  getPartnerJobStatus = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const status = await this.jobQueueService.getJobStatus(
      request.params.id,
      partner.organizationId
    );
    return reply.status(200).send(status);
  };

  downloadPartnerJobResult = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    const partner = request.partner!;
    const result = await this.jobQueueService.getJobDownload(
      request.params.id,
      partner.organizationId
    );
    reply.header('Content-Type', result.contentType);
    reply.header(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`
    );
    return reply.status(200).send(result.content);
  };
}

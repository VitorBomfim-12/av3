import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { DbClient, prisma } from '../lib/prisma';

export interface AuditEventFilters {
  entityName?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
}

export const AUDIT_DETAIL_INCLUDE = {
  actor: {
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
    },
  },
} satisfies Prisma.EventoAuditoriaInclude;

export type AuditEventWithActor = Prisma.EventoAuditoriaGetPayload<{
  include: typeof AUDIT_DETAIL_INCLUDE;
}>;

export class AuditEventRepository {
  async findLatest(tx: DbClient = prisma): Promise<AuditEventWithActor | null> {
    return tx.eventoAuditoria.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: AUDIT_DETAIL_INCLUDE,
    });
  }

  async create(
    data: Prisma.EventoAuditoriaUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<AuditEventWithActor> {
    return tx.eventoAuditoria.create({
      data,
      include: AUDIT_DETAIL_INCLUDE,
    });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<AuditEventWithActor | null> {
    return tx.eventoAuditoria.findUnique({
      where: { id },
      include: AUDIT_DETAIL_INCLUDE,
    });
  }

  async findAll(
    filters: AuditEventFilters = {},
    tx: DbClient = prisma
  ): Promise<AuditEventWithActor[]> {
    const where: Prisma.EventoAuditoriaWhereInput = {};
    if (filters.entityName) where.entityName = filters.entityName;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;

    return tx.eventoAuditoria.findMany({
      where,
      include: AUDIT_DETAIL_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    id: string,
    data: Prisma.EventoAuditoriaUncheckedUpdateManyInput,
    expectedVersion?: number,
    tx: DbClient = prisma
  ): Promise<AuditEventWithActor> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError(
        'O campo version (inteiro >= 1) é obrigatório para controle de concorrência otimista.'
      );
    }

    const existing = await tx.eventoAuditoria.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Evento de auditoria não encontrado.');
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `Conflito de versão otimista no evento de auditoria: esperado v${expectedVersion}, atual v${existing.version}.`
      );
    }
    const res = await tx.eventoAuditoria.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictError(
        'Conflito de concorrência detectado ao atualizar evento de auditoria.'
      );
    }
    const updated = await this.findById(id, tx);
    return updated!;
  }

  async delete(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.eventoAuditoria.delete({ where: { id } });
  }
}

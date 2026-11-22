import { Contrato, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { DbClient, prisma } from '../lib/prisma';

export interface ContractFilters {
  organizationId?: string;
  status?: string;
  search?: string;
}

export const CONTRACT_INCLUDE = {
  organization: {
    select: {
      id: true,
      name: true,
      cnpj: true,
      type: true,
      active: true,
    },
  },
} satisfies Prisma.ContratoInclude;

export type ContractWithOrganization = Prisma.ContratoGetPayload<{
  include: typeof CONTRACT_INCLUDE;
}>;

export class ContractRepository {
  async create(
    data: Prisma.ContratoUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<ContractWithOrganization> {
    return tx.contrato.create({
      data,
      include: CONTRACT_INCLUDE,
    });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<ContractWithOrganization | null> {
    return tx.contrato.findUnique({
      where: { id },
      include: CONTRACT_INCLUDE,
    });
  }

  async findByOrganizationId(
    organizationId: string,
    tx: DbClient = prisma
  ): Promise<Contrato | null> {
    return tx.contrato.findUnique({
      where: { organizationId },
    });
  }

  async findByContractNumber(
    contractNumber: string,
    tx: DbClient = prisma
  ): Promise<Contrato | null> {
    return tx.contrato.findUnique({
      where: { contractNumber },
    });
  }

  async findAll(
    filters: ContractFilters = {},
    tx: DbClient = prisma
  ): Promise<ContractWithOrganization[]> {
    const where: Prisma.ContratoWhereInput = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.status) where.status = filters.status.toUpperCase();
    if (filters.search) {
      where.OR = [
        { contractNumber: { contains: filters.search } },
        { notes: { contains: filters.search } },
      ];
    }

    return tx.contrato.findMany({
      where,
      include: CONTRACT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: Prisma.ContratoUncheckedUpdateManyInput,
    expectedVersion?: number,
    tx: DbClient = prisma
  ): Promise<ContractWithOrganization> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError(
        'O campo version (inteiro >= 1) é obrigatório para controle de concorrência otimista.'
      );
    }

    const existing = await tx.contrato.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Contrato não encontrado.');
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `Conflito de versão otimista no contrato: esperado v${expectedVersion}, atual v${existing.version}.`
      );
    }
    const res = await tx.contrato.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictError('Conflito de concorrência detectado ao atualizar contrato.');
    }
    const updated = await this.findById(id, tx);
    return updated!;
  }

  async delete(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.contrato.delete({ where: { id } });
  }
}

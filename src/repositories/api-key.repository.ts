import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { DbClient, prisma } from '../lib/prisma';

export interface ApiKeyFilters {
  organizationId?: string;
  active?: boolean;
}

export const API_KEY_INCLUDE = {
  organization: {
    select: {
      id: true,
      name: true,
      cnpj: true,
      active: true,
    },
  },
} satisfies Prisma.ChaveApiInclude;

export type ApiKeyWithOrganization = Prisma.ChaveApiGetPayload<{
  include: typeof API_KEY_INCLUDE;
}>;

export type SafeApiKey = Omit<ApiKeyWithOrganization, 'keyHash'>;

export class ApiKeyRepository {
  static toSafe(apiKey: ApiKeyWithOrganization): SafeApiKey {
    const { keyHash: _ignored, ...safe } = apiKey;
    return safe;
  }

  async create(
    data: Prisma.ChaveApiUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<ApiKeyWithOrganization> {
    return tx.chaveApi.create({
      data,
      include: API_KEY_INCLUDE,
    });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<ApiKeyWithOrganization | null> {
    return tx.chaveApi.findUnique({
      where: { id },
      include: API_KEY_INCLUDE,
    });
  }

  async findByKeyHash(
    keyHash: string,
    tx: DbClient = prisma
  ): Promise<ApiKeyWithOrganization | null> {
    return tx.chaveApi.findUnique({
      where: { keyHash },
      include: API_KEY_INCLUDE,
    });
  }

  async findAll(
    filters: ApiKeyFilters = {},
    tx: DbClient = prisma
  ): Promise<ApiKeyWithOrganization[]> {
    const where: Prisma.ChaveApiWhereInput = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.active !== undefined) where.active = filters.active;

    return tx.chaveApi.findMany({
      where,
      include: API_KEY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: Prisma.ChaveApiUncheckedUpdateManyInput,
    expectedVersion?: number,
    tx: DbClient = prisma
  ): Promise<ApiKeyWithOrganization> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError(
        'O campo version (inteiro >= 1) é obrigatório para controle de concorrência otimista.'
      );
    }

    const existing = await tx.chaveApi.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Chave de API não encontrada.');
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `Conflito de versão otimista na chave de API: esperado v${expectedVersion}, atual v${existing.version}.`
      );
    }

    const res = await tx.chaveApi.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictError('Conflito de concorrência detectado ao atualizar chave de API.');
    }

    const updated = await this.findById(id, tx);
    return updated!;
  }

  async touchLastUsed(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.chaveApi.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async delete(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.chaveApi.delete({ where: { id } });
  }
}

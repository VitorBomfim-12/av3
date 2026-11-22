import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { DbClient, prisma } from '../lib/prisma';

export interface MovementFilters {
  equipmentId?: string;
  lotId?: string;
  actorId?: string;
  type?: string;
}

export const MOVEMENT_DETAIL_INCLUDE = {
  equipment: {
    select: {
      id: true,
      codigoBarrasInterno: true,
      serial: true,
      category: true,
      brand: true,
      model: true,
      status: true,
      condition: true,
    },
  },
  lot: {
    select: {
      id: true,
      code: true,
      status: true,
    },
  },
  actor: {
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
    },
  },
} satisfies Prisma.MovimentacaoInclude;

export type MovementWithDetails = Prisma.MovimentacaoGetPayload<{
  include: typeof MOVEMENT_DETAIL_INCLUDE;
}>;

export class MovementRepository {
  async create(
    data: Prisma.MovimentacaoUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<MovementWithDetails> {
    let createdAt = data.createdAt ? new Date(data.createdAt as string | Date) : new Date();
    if (data.equipmentId) {
      const latest = await tx.movimentacao.findFirst({
        where: { equipmentId: data.equipmentId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      if (latest && createdAt.getTime() <= latest.createdAt.getTime()) {
        createdAt = new Date(latest.createdAt.getTime() + 1);
      }
    }

    return tx.movimentacao.create({
      data: {
        ...data,
        createdAt,
      },
      include: MOVEMENT_DETAIL_INCLUDE,
    });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<MovementWithDetails | null> {
    return tx.movimentacao.findUnique({
      where: { id },
      include: MOVEMENT_DETAIL_INCLUDE,
    });
  }

  async findByEquipmentId(
    equipmentId: string,
    tx: DbClient = prisma
  ): Promise<MovementWithDetails[]> {
    return tx.movimentacao.findMany({
      where: { equipmentId },
      include: MOVEMENT_DETAIL_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(
    filters: MovementFilters = {},
    tx: DbClient = prisma
  ): Promise<MovementWithDetails[]> {
    const where: Prisma.MovimentacaoWhereInput = {};
    if (filters.equipmentId) where.equipmentId = filters.equipmentId;
    if (filters.lotId) where.lotId = filters.lotId;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.type) where.type = filters.type.toUpperCase();

    return tx.movimentacao.findMany({
      where,
      include: MOVEMENT_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: Prisma.MovimentacaoUncheckedUpdateManyInput,
    expectedVersion?: number,
    tx: DbClient = prisma
  ): Promise<MovementWithDetails> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError(
        'O campo version (inteiro >= 1) é obrigatório para controle de concorrência otimista.'
      );
    }

    const existing = await tx.movimentacao.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Movimentação não encontrada.');
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `Conflito de versão otimista na movimentação: esperado v${expectedVersion}, atual v${existing.version}.`
      );
    }
    const res = await tx.movimentacao.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictError('Conflito de concorrência detectado ao atualizar movimentação.');
    }
    const updated = await this.findById(id, tx);
    return updated!;
  }

  async delete(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.movimentacao.delete({ where: { id } });
  }
}

import { Prisma, TarefaAssincrona } from '@prisma/client';
import { DbClient, prisma } from '../lib/prisma';

export interface AsyncJobFilters {
  status?: string;
  organizationId?: string;
  type?: string;
}

export class AsyncJobRepository {
  async create(
    data: Prisma.TarefaAssincronaUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<TarefaAssincrona> {
    return tx.tarefaAssincrona.create({ data });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<TarefaAssincrona | null> {
    return tx.tarefaAssincrona.findUnique({ where: { id } });
  }

  async findAll(
    filters: AsyncJobFilters = {},
    tx: DbClient = prisma
  ): Promise<TarefaAssincrona[]> {
    const where: Prisma.TarefaAssincronaWhereInput = {};
    if (filters.status) where.status = filters.status.toUpperCase();
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.type) where.type = filters.type.toUpperCase();

    return tx.tarefaAssincrona.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateState(
    id: string,
    data: Prisma.TarefaAssincronaUncheckedUpdateInput,
    tx: DbClient = prisma
  ): Promise<TarefaAssincrona> {
    return tx.tarefaAssincrona.update({
      where: { id },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }
}

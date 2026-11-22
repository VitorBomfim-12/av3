import { Prisma } from '@prisma/client';
import { DbClient, prisma } from '../lib/prisma';

export interface AnalyticalReportFilters {
  category?: string;
  organizationId?: string;
}

export const ANALYTICAL_REPORT_INCLUDE = {
  organization: {
    select: {
      id: true,
      name: true,
      cnpj: true,
    },
  },
} satisfies Prisma.RelatorioAnaliticoInclude;

export type AnalyticalReportWithOrganization = Prisma.RelatorioAnaliticoGetPayload<{
  include: typeof ANALYTICAL_REPORT_INCLUDE;
}>;

export class AnalyticalReportRepository {
  async create(
    data: Prisma.RelatorioAnaliticoUncheckedCreateInput,
    tx: DbClient = prisma
  ): Promise<AnalyticalReportWithOrganization> {
    return tx.relatorioAnalitico.create({
      data,
      include: ANALYTICAL_REPORT_INCLUDE,
    });
  }

  async findById(
    id: string,
    tx: DbClient = prisma
  ): Promise<AnalyticalReportWithOrganization | null> {
    return tx.relatorioAnalitico.findUnique({
      where: { id },
      include: ANALYTICAL_REPORT_INCLUDE,
    });
  }

  async findAll(
    filters: AnalyticalReportFilters = {},
    tx: DbClient = prisma
  ): Promise<AnalyticalReportWithOrganization[]> {
    const where: Prisma.RelatorioAnaliticoWhereInput = {};
    if (filters.category) where.category = filters.category.toUpperCase();
    if (filters.organizationId) where.organizationId = filters.organizationId;

    return tx.relatorioAnalitico.findMany({
      where,
      include: ANALYTICAL_REPORT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }
}

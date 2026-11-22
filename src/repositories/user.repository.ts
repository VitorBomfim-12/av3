import { Prisma, Usuario } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { DbClient, prisma } from '../lib/prisma';

export type SafeUser = Omit<Usuario, 'passwordHash'>;

export const SAFE_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UsuarioSelect;

export interface UserFilters {
  role?: string;
  active?: boolean;
  search?: string;
}

export class UserRepository {
  static toSafeUser(user: Usuario): SafeUser {
    const { passwordHash: _ignored, ...safe } = user;
    return safe;
  }

  async count(tx: DbClient = prisma): Promise<number> {
    return tx.usuario.count();
  }

  async create(data: Prisma.UsuarioUncheckedCreateInput, tx: DbClient = prisma): Promise<SafeUser> {
    return tx.usuario.create({
      data,
      select: SAFE_USER_SELECT,
    });
  }

  async findById(id: string, tx: DbClient = prisma): Promise<SafeUser | null> {
    return tx.usuario.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });
  }

  async findFullById(id: string, tx: DbClient = prisma): Promise<Usuario | null> {
    return tx.usuario.findUnique({ where: { id } });
  }

  async findByUsername(username: string, tx: DbClient = prisma): Promise<Usuario | null> {
    return tx.usuario.findUnique({ where: { username } });
  }

  async findByEmail(email: string, tx: DbClient = prisma): Promise<Usuario | null> {
    return tx.usuario.findUnique({ where: { email } });
  }

  async findAll(filters: UserFilters = {}, tx: DbClient = prisma): Promise<SafeUser[]> {
    const where: Prisma.UsuarioWhereInput = {};
    if (filters.role) where.role = filters.role.toUpperCase();
    if (filters.active !== undefined) where.active = filters.active;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { username: { contains: filters.search } },
        { email: { contains: filters.search } },
      ];
    }

    return tx.usuario.findMany({
      where,
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: Prisma.UsuarioUncheckedUpdateManyInput,
    expectedVersion?: number,
    tx: DbClient = prisma
  ): Promise<SafeUser> {
    if (expectedVersion === undefined || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ValidationError(
        'O campo version (inteiro >= 1) é obrigatório para controle de concorrência otimista.'
      );
    }

    const existing = await tx.usuario.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Usuário não encontrado.');
    }

    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `Conflito de versão otimista no usuário: esperado v${expectedVersion}, atual v${existing.version}.`
      );
    }
    const res = await tx.usuario.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      throw new ConflictError('Conflito de concorrência detectado ao atualizar usuário.');
    }
    const updated = await this.findById(id, tx);
    return updated!;
  }

  async delete(id: string, tx: DbClient = prisma): Promise<void> {
    await tx.usuario.delete({ where: { id } });
  }
}

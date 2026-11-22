import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { ApiKeyScope } from '../domain/enums';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors/app-error';
import { prisma } from '../lib/prisma';
import {
  ApiKeyFilters,
  ApiKeyRepository,
  SafeApiKey,
} from '../repositories/api-key.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { assertPermission } from '../security/rbac';
import { ActorContext, AuditEventService } from './audit-event.service';

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  scopes?: string[];
  rateLimitPerMinute?: number;
  expiresAt?: string | null;
}

export interface UpdateApiKeyInput {
  name?: string;
  scopes?: string[];
  rateLimitPerMinute?: number;
  active?: boolean;
  expiresAt?: string | null;
  version?: number;
}

export interface CreatedApiKeyResult {
  apiKey: string;
  record: SafeApiKey;
}

export interface PartnerPrincipal {
  keyId: string;
  keyName: string;
  organizationId: string;
  organizationName: string;
  cnpj: string;
  scopes: ApiKeyScope[];
  rateLimitPerMinute: number;
}

export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepository = new ApiKeyRepository(),
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository(),
    private readonly auditService: AuditEventService = new AuditEventService()
  ) {}

  static hashRawKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  }

  static generateRawKey(): { rawKey: string; prefix: string; keyHash: string } {
    const randomHex = crypto.randomBytes(20).toString('hex');
    const rawKey = `gc_live_${randomHex}`;
    const prefix = rawKey.slice(0, 14);
    const keyHash = this.hashRawKey(rawKey);
    return { rawKey, prefix, keyHash };
  }

  static validateAndNormalizeScopes(scopes?: string[]): ApiKeyScope[] {
    if (!scopes || scopes.length === 0) {
      return [ApiKeyScope.TRACKING_READ, ApiKeyScope.ANALYTICS_READ];
    }

    const validValues = Object.values(ApiKeyScope) as string[];
    const normalized: ApiKeyScope[] = [];
    for (const s of scopes) {
      const clean = (s || '').trim().toLowerCase();
      if (!validValues.includes(clean)) {
        throw new ValidationError(
          `Escopo de chave de API inválido: '${s}'. Escopos permitidos: ${validValues.join(', ')}.`
        );
      }
      if (!normalized.includes(clean as ApiKeyScope)) {
        normalized.push(clean as ApiKeyScope);
      }
    }
    return normalized;
  }

  async create(
    actor: ActorContext,
    input: CreateApiKeyInput
  ): Promise<CreatedApiKeyResult> {
    assertPermission(actor.role, 'apikey', 'write');

    if (!input.organizationId?.trim() || !input.name?.trim()) {
      throw new ValidationError(
        'Campos obrigatórios para criar chave de API: organizationId, name.'
      );
    }

    const scopes = ApiKeyService.validateAndNormalizeScopes(input.scopes);
    const rateLimit = Number(input.rateLimitPerMinute ?? 60);
    if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10000) {
      throw new ValidationError(
        'rateLimitPerMinute deve ser um inteiro entre 1 e 10000.'
      );
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new ValidationError('expiresAt inválido.');
    }

    const { rawKey, prefix, keyHash } = ApiKeyService.generateRawKey();

    return prisma.$transaction(async (tx) => {
      const org = await this.orgRepo.findById(input.organizationId, tx);
      if (!org) {
        throw new NotFoundError('Organização não encontrada para vincular chave de API.');
      }
      if (!org.active) {
        throw new ValidationError(
          'Não é possível emitir chave de API para uma organização inativa.'
        );
      }

      const created = await this.apiKeyRepo.create(
        {
          organizationId: input.organizationId,
          name: input.name.trim(),
          keyPrefix: prefix,
          keyHash,
          scopes: scopes.join(','),
          rateLimitPerMinute: rateLimit,
          active: true,
          expiresAt,
        },
        tx
      );

      await this.auditService.record(
        actor.id,
        'CREATE_API_KEY',
        'ChaveApi',
        created.id,
        {
          organizationId: created.organizationId,
          name: created.name,
          keyPrefix: created.keyPrefix,
          scopes,
          rateLimitPerMinute: rateLimit,
        },
        tx
      );

      return {
        apiKey: rawKey,
        record: ApiKeyRepository.toSafe(created),
      };
    });
  }

  async list(
    actor: ActorContext,
    filters: ApiKeyFilters = {}
  ): Promise<SafeApiKey[]> {
    assertPermission(actor.role, 'apikey', 'read');
    const keys = await this.apiKeyRepo.findAll(filters);
    return keys.map(ApiKeyRepository.toSafe);
  }

  async getById(actor: ActorContext, id: string): Promise<SafeApiKey> {
    assertPermission(actor.role, 'apikey', 'read');
    const key = await this.apiKeyRepo.findById(id);
    if (!key) {
      throw new NotFoundError('Chave de API não encontrada.');
    }
    return ApiKeyRepository.toSafe(key);
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateApiKeyInput
  ): Promise<SafeApiKey> {
    assertPermission(actor.role, 'apikey', 'write');

    return prisma.$transaction(async (tx) => {
      const existing = await this.apiKeyRepo.findById(id, tx);
      if (!existing) {
        throw new NotFoundError('Chave de API não encontrada.');
      }

      const updateData: Prisma.ChaveApiUncheckedUpdateManyInput = {};

      if (input.name !== undefined) {
        if (!input.name.trim()) {
          throw new ValidationError('O nome da chave de API não pode ser vazio.');
        }
        updateData.name = input.name.trim();
      }

      if (input.scopes !== undefined) {
        const scopes = ApiKeyService.validateAndNormalizeScopes(input.scopes);
        updateData.scopes = scopes.join(',');
      }

      if (input.rateLimitPerMinute !== undefined) {
        const rateLimit = Number(input.rateLimitPerMinute);
        if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10000) {
          throw new ValidationError(
            'rateLimitPerMinute deve ser um inteiro entre 1 e 10000.'
          );
        }
        updateData.rateLimitPerMinute = rateLimit;
      }

      if (input.active !== undefined) {
        updateData.active = input.active;
      }

      if (input.expiresAt !== undefined) {
        if (input.expiresAt === null) {
          updateData.expiresAt = null;
        } else {
          const dt = new Date(input.expiresAt);
          if (Number.isNaN(dt.getTime())) {
            throw new ValidationError('expiresAt inválido.');
          }
          updateData.expiresAt = dt;
        }
      }

      const updated = await this.apiKeyRepo.update(id, updateData, input.version, tx);

      await this.auditService.record(
        actor.id,
        'UPDATE_API_KEY',
        'ChaveApi',
        id,
        { updatedFields: Object.keys(updateData), version: updated.version },
        tx
      );

      return ApiKeyRepository.toSafe(updated);
    });
  }

  async revoke(actor: ActorContext, id: string): Promise<void> {
    assertPermission(actor.role, 'apikey', 'delete');

    await prisma.$transaction(async (tx) => {
      const existing = await this.apiKeyRepo.findById(id, tx);
      if (!existing) {
        throw new NotFoundError('Chave de API não encontrada.');
      }

      await this.apiKeyRepo.delete(id, tx);

      await this.auditService.record(
        actor.id,
        'REVOKE_API_KEY',
        'ChaveApi',
        id,
        {
          organizationId: existing.organizationId,
          keyPrefix: existing.keyPrefix,
          name: existing.name,
        },
        tx
      );
    });
  }

  async authenticatePartnerKey(
    rawKey: string,
    requiredScope?: ApiKeyScope
  ): Promise<PartnerPrincipal> {
    if (!rawKey?.trim()) {
      throw new UnauthorizedError(
        'Chave de API ausente. Forneça o cabeçalho X-API-Key.'
      );
    }

    const keyHash = ApiKeyService.hashRawKey(rawKey);
    const record = await this.apiKeyRepo.findByKeyHash(keyHash);
    if (!record) {
      throw new UnauthorizedError('Chave de API inválida ou não reconhecida.');
    }

    if (!record.active) {
      throw new ForbiddenError('Chave de API revogada ou desativada.');
    }

    if (!record.organization.active) {
      throw new ForbiddenError('A organização titular desta chave de API está inativa.');
    }

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenError('Chave de API expirada.');
    }

    const scopes = record.scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as ApiKeyScope[];

    if (requiredScope && !scopes.includes(requiredScope)) {
      throw new ForbiddenError(
        `A chave de API não possui o escopo necessário ('${requiredScope}') para esta operação.`
      );
    }

    await this.apiKeyRepo.touchLastUsed(record.id);

    return {
      keyId: record.id,
      keyName: record.name,
      organizationId: record.organizationId,
      organizationName: record.organization.name,
      cnpj: record.organization.cnpj,
      scopes,
      rateLimitPerMinute: record.rateLimitPerMinute,
    };
  }
}

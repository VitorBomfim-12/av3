import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiKeyScope } from '../../domain/enums';
import { TooManyRequestsError, ValidationError } from '../../errors/app-error';
import { ApiKeyService, PartnerPrincipal } from '../../services/api-key.service';

declare module 'fastify' {
  interface FastifyRequest {
    partner?: PartnerPrincipal;
  }
}

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();
const apiKeyService = new ApiKeyService();
const SUPPORTED_API_VERSION = '1.0.0';

export function resetRateLimitBuckets(): void {
  rateLimitStore.clear();
}

export function checkAndConsumeRateLimit(
  clientKey: string,
  limitPerMinute: number,
  windowMs = 60_000
): {
  limit: number;
  remaining: number;
  resetSeconds: number;
} {
  const now = Date.now();
  let bucket = rateLimitStore.get(clientKey);
  if (!bucket || now >= bucket.resetAtMs) {
    bucket = {
      count: 0,
      resetAtMs: now + windowMs,
    };
  }

  bucket.count += 1;
  rateLimitStore.set(clientKey, bucket);

  const resetSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));
  const remaining = Math.max(0, limitPerMinute - bucket.count);

  if (bucket.count > limitPerMinute) {
    throw new TooManyRequestsError(
      `Limite de taxa de requisições excedido (${limitPerMinute} req/min para esta chave de API). Aguarde ${resetSeconds}s.`,
      {
        limit: limitPerMinute,
        remaining: 0,
        retryAfterSeconds: resetSeconds,
      }
    );
  }

  return {
    limit: limitPerMinute,
    remaining,
    resetSeconds,
  };
}

export function createPartnerApiKeyHook(requiredScope?: ApiKeyScope) {
  return async function partnerApiKeyHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Validação explícita de versionamento semântico via cabeçalho X-API-Version (se enviado)
    const requestedVersion = request.headers['x-api-version'];
    if (requestedVersion && typeof requestedVersion === 'string') {
      const cleanVer = requestedVersion.trim();
      if (!/^1(\.\d+\.\d+)?$/.test(cleanVer) && cleanVer !== 'v1') {
        throw new ValidationError(
          `Versão de API não suportada no cabeçalho X-API-Version: '${cleanVer}'. Versão atual suportada: ${SUPPORTED_API_VERSION} (v1).`
        );
      }
    }

    reply.header('X-API-Version', SUPPORTED_API_VERSION);

    const rawApiKeyHeader = request.headers['x-api-key'];
    const rawApiKey = Array.isArray(rawApiKeyHeader)
      ? rawApiKeyHeader[0]
      : rawApiKeyHeader || '';

    const partner = await apiKeyService.authenticatePartnerKey(
      rawApiKey,
      requiredScope
    );
    request.partner = partner;

    const rateInfo = checkAndConsumeRateLimit(
      partner.keyId,
      partner.rateLimitPerMinute
    );

    reply.header('X-RateLimit-Limit', String(rateInfo.limit));
    reply.header('X-RateLimit-Remaining', String(rateInfo.remaining));
    reply.header('X-RateLimit-Reset', String(rateInfo.resetSeconds));
  };
}

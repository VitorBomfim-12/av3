import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ApiKeyService,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from '../services/api-key.service';

interface IdParams {
  id: string;
}

interface ApiKeyListQuery {
  organizationId?: string;
  active?: string;
}

export class ApiKeyController {
  constructor(
    private readonly apiKeyService: ApiKeyService = new ApiKeyService()
  ) {}

  create = async (
    request: FastifyRequest<{ Body: CreateApiKeyInput }>,
    reply: FastifyReply
  ) => {
    const created = await this.apiKeyService.create(
      request.actor,
      request.body
    );
    return reply.status(201).send(created);
  };

  list = async (
    request: FastifyRequest<{ Querystring: ApiKeyListQuery }>,
    reply: FastifyReply
  ) => {
    const { organizationId, active } = request.query;
    const parsedActive =
      active === 'true' ? true : active === 'false' ? false : undefined;

    const list = await this.apiKeyService.list(request.actor, {
      organizationId,
      active: parsedActive,
    });
    return reply.status(200).send(list);
  };

  getById = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    const record = await this.apiKeyService.getById(
      request.actor,
      request.params.id
    );
    return reply.status(200).send(record);
  };

  update = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateApiKeyInput }>,
    reply: FastifyReply
  ) => {
    const updated = await this.apiKeyService.update(
      request.actor,
      request.params.id,
      request.body
    );
    return reply.status(200).send(updated);
  };

  revoke = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply
  ) => {
    await this.apiKeyService.revoke(request.actor, request.params.id);
    return reply.status(204).send();
  };
}

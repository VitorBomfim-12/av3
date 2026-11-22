import { FastifyInstance } from 'fastify';
import { AnalyticsController } from '../../controllers/analytics.controller';
import { ApiKeyController } from '../../controllers/api-key.controller';
import { AuditEventController } from '../../controllers/audit-event.controller';
import { AuthController } from '../../controllers/auth.controller';
import { ContractController } from '../../controllers/contract.controller';
import { EquipmentController } from '../../controllers/equipment.controller';
import { LotController } from '../../controllers/lot.controller';
import { MovementController } from '../../controllers/movement.controller';
import { OrganizationController } from '../../controllers/organization.controller';
import { PublicApiController } from '../../controllers/public-api.controller';
import { UserController } from '../../controllers/user.controller';
import { ApiKeyScope } from '../../domain/enums';
import { prisma } from '../../lib/prisma';
import { createPartnerApiKeyHook } from '../middlewares/api-key.hook';
import { authenticateHook } from '../middlewares/auth.hook';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

const bearerSecurity = [{ bearerAuth: [] }] as const;
const apiKeySecurity = [{ apiKeyAuth: [] }] as const;

export async function appRoutes(app: FastifyInstance): Promise<void> {
  const authController = new AuthController();
  const userController = new UserController();
  const orgController = new OrganizationController();
  const contractController = new ContractController();
  const lotController = new LotController();
  const equipmentController = new EquipmentController();
  const movementController = new MovementController();
  const auditController = new AuditEventController();
  const apiKeyController = new ApiKeyController();
  const analyticsController = new AnalyticsController();
  const publicApiController = new PublicApiController();

  // Health Check
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Verifica saúde do servidor HTTP e conectividade com o banco relacional',
      },
    },
    async (_request, reply) => {
      await prisma.$queryRawUnsafe('SELECT 1;');
      return reply.status(200).send({
        status: 'ok',
        service: 'greencode-api',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }
  );

  // ==========================================
  // AUTH ROUTES (Públicas + Perfil Autenticado)
  // ==========================================
  app.post(
    '/api/auth/bootstrap',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Provisionamento inicial do primeiro ADMINISTRADOR (caso o banco esteja vazio)',
        body: {
          type: 'object',
          required: ['name', 'username', 'password'],
          properties: {
            name: { type: 'string', minLength: 2 },
            username: { type: 'string', minLength: 2 },
            email: { type: 'string' },
            password: { type: 'string', minLength: 4 },
          },
        },
      },
    },
    authController.bootstrap
  );

  app.post(
    '/api/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Autentica usuário e emite token JWT stateless',
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    authController.login
  );

  app.get(
    '/api/auth/me',
    {
      preHandler: [authenticateHook],
      schema: {
        tags: ['Auth'],
        summary: 'Retorna perfil do usuário autenticado pelo token JWT',
        security: bearerSecurity,
      },
    },
    authController.me
  );

  // ==========================================
  // 1. USUARIOS CRUD
  // ==========================================
  app.register(
    async (protectedApp) => {
      protectedApp.addHook('preHandler', authenticateHook);

      protectedApp.post(
        '/api/users',
        {
          schema: {
            tags: ['Usuarios'],
            summary: 'Cria novo usuário do sistema (ADMINISTRADOR)',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['name', 'username', 'password', 'role'],
              properties: {
                name: { type: 'string', minLength: 2 },
                username: { type: 'string', minLength: 2 },
                email: { type: ['string', 'null'] },
                password: { type: 'string', minLength: 4 },
                role: { type: 'string' },
                active: { type: 'boolean' },
              },
            },
          },
        },
        userController.create
      );

      protectedApp.get(
        '/api/users',
        {
          schema: {
            tags: ['Usuarios'],
            summary: 'Lista usuários cadastrados',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                active: { type: 'string' },
                search: { type: 'string' },
              },
            },
          },
        },
        userController.list
      );

      protectedApp.get(
        '/api/users/:id',
        {
          schema: {
            tags: ['Usuarios'],
            summary: 'Busca usuário por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        userController.getById
      );

      protectedApp.put(
        '/api/users/:id',
        {
          schema: {
            tags: ['Usuarios'],
            summary: 'Atualiza usuário com suporte a versionamento otimista (ADMINISTRADOR)',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                name: { type: 'string', minLength: 1 },
                username: { type: 'string', minLength: 1 },
                email: { type: ['string', 'null'] },
                password: { type: 'string', minLength: 4 },
                role: { type: 'string' },
                active: { type: 'boolean' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        userController.update
      );

      protectedApp.delete(
        '/api/users/:id',
        {
          schema: {
            tags: ['Usuarios'],
            summary: 'Remove usuário sem vínculos históricos (ADMINISTRADOR)',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        userController.delete
      );

      // ==========================================
      // 2. ORGANIZACOES CRUD
      // ==========================================
      protectedApp.post(
        '/api/organizations',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Cadastra nova organização geradora validando CNPJ',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['name', 'cnpj', 'type', 'phone', 'email', 'address'],
              properties: {
                name: { type: 'string', minLength: 2 },
                cnpj: { type: 'string', minLength: 14 },
                type: { type: 'string', minLength: 2 },
                phone: { type: 'string', minLength: 3 },
                email: { type: 'string', minLength: 3 },
                address: { type: 'string', minLength: 3 },
                active: { type: 'boolean' },
              },
            },
          },
        },
        orgController.create
      );

      protectedApp.get(
        '/api/organizations',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Lista organizações com contrato opcional e contagem de lotes/equipamentos',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                active: { type: 'string' },
                type: { type: 'string' },
                search: { type: 'string' },
              },
            },
          },
        },
        orgController.list
      );

      protectedApp.get(
        '/api/organizations/:id',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Obtém detalhes de uma organização por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        orgController.getById
      );

      protectedApp.get(
        '/api/organizations/:id/financial-summary',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Calcula consolidação financeira dos equipamentos e contrato da organização',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        orgController.getFinancialSummary
      );

      protectedApp.put(
        '/api/organizations/:id',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Atualiza organização com controle de versão otimista',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                name: { type: 'string', minLength: 1 },
                cnpj: { type: 'string', minLength: 14 },
                type: { type: 'string', minLength: 1 },
                phone: { type: 'string', minLength: 1 },
                email: { type: 'string', minLength: 3 },
                address: { type: 'string', minLength: 1 },
                active: { type: 'boolean' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        orgController.update
      );

      protectedApp.delete(
        '/api/organizations/:id',
        {
          schema: {
            tags: ['Organizacoes'],
            summary: 'Exclui organização sem vínculos ativos',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        orgController.delete
      );

      // ==========================================
      // 3. CONTRATOS CRUD
      // ==========================================
      protectedApp.post(
        '/api/contracts',
        {
          schema: {
            tags: ['Contratos'],
            summary: 'Cria contrato de coleta vinculado a uma organização (1:1)',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['organizationId', 'contractNumber', 'startDate'],
              properties: {
                organizationId: { type: 'string', minLength: 1 },
                contractNumber: { type: 'string', minLength: 1 },
                startDate: { type: 'string', minLength: 1 },
                endDate: { type: ['string', 'null'] },
                status: { type: 'string' },
                collectionFrequency: { type: 'string' },
                taxRate: { type: 'number', minimum: 0, maximum: 100 },
                depreciationRate: { type: 'number', minimum: 0, maximum: 100 },
                estimatedMonthlyValue: { type: 'number', minimum: 0 },
                clauses: { type: ['object', 'null'], additionalProperties: true },
                notes: { type: 'string' },
              },
            },
          },
        },
        contractController.create
      );

      protectedApp.get(
        '/api/contracts',
        {
          schema: {
            tags: ['Contratos'],
            summary: 'Lista contratos cadastrados',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                status: { type: 'string' },
                search: { type: 'string' },
              },
            },
          },
        },
        contractController.list
      );

      protectedApp.get(
        '/api/contracts/:id',
        {
          schema: {
            tags: ['Contratos'],
            summary: 'Obtém detalhes do contrato por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        contractController.getById
      );

      protectedApp.put(
        '/api/contracts/:id',
        {
          schema: {
            tags: ['Contratos'],
            summary: 'Atualiza contrato e recalcula valoração financeira dos equipamentos atomicamente',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                contractNumber: { type: 'string', minLength: 1 },
                startDate: { type: 'string' },
                endDate: { type: ['string', 'null'] },
                status: { type: 'string' },
                collectionFrequency: { type: 'string' },
                taxRate: { type: 'number', minimum: 0, maximum: 100 },
                depreciationRate: { type: 'number', minimum: 0, maximum: 100 },
                estimatedMonthlyValue: { type: 'number', minimum: 0 },
                clauses: { type: ['object', 'null'], additionalProperties: true },
                notes: { type: 'string' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        contractController.update
      );

      protectedApp.delete(
        '/api/contracts/:id',
        {
          schema: {
            tags: ['Contratos'],
            summary: 'Remove contrato de uma organização',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        contractController.delete
      );

      // ==========================================
      // 4. LOTES CRUD
      // ==========================================
      protectedApp.post(
        '/api/lots',
        {
          schema: {
            tags: ['Lotes'],
            summary: 'Cria lote com validação temporal e adição atômica opcional de equipamentos ($transaction)',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['code', 'organizationId', 'origin', 'destination'],
              properties: {
                code: { type: 'string', minLength: 1 },
                organizationId: { type: 'string', minLength: 1 },
                invoiceNumber: { type: ['string', 'null'] },
                carrier: { type: ['string', 'null'] },
                origin: { type: 'string', minLength: 1 },
                destination: { type: 'string', minLength: 1 },
                status: { type: 'string' },
                entryDate: { type: 'string' },
                notes: { type: 'string' },
                equipmentIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                newEquipments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['serial', 'category', 'brand', 'model', 'condition', 'location'],
                    properties: {
                      codigoBarrasInterno: { type: 'string' },
                      serial: { type: 'string', minLength: 1 },
                      category: { type: 'string', minLength: 1 },
                      brand: { type: 'string', minLength: 1 },
                      model: { type: 'string', minLength: 1 },
                      condition: { type: 'string', minLength: 1 },
                      location: { type: 'string', minLength: 1 },
                      estimatedValue: { type: 'number', minimum: 0 },
                      notes: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        lotController.create
      );

      protectedApp.get(
        '/api/lots',
        {
          schema: {
            tags: ['Lotes'],
            summary: 'Lista lotes com equipamentos e organização associada',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                status: { type: 'string' },
                search: { type: 'string' },
              },
            },
          },
        },
        lotController.list
      );

      protectedApp.get(
        '/api/lots/:id',
        {
          schema: {
            tags: ['Lotes'],
            summary: 'Obtém detalhes completos do lote por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        lotController.getById
      );

      protectedApp.put(
        '/api/lots/:id',
        {
          schema: {
            tags: ['Lotes'],
            summary: 'Atualiza lote com controle de versão otimista',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                code: { type: 'string', minLength: 1 },
                invoiceNumber: { type: ['string', 'null'] },
                carrier: { type: ['string', 'null'] },
                origin: { type: 'string', minLength: 1 },
                destination: { type: 'string', minLength: 1 },
                status: { type: 'string' },
                entryDate: { type: 'string' },
                notes: { type: 'string' },
                equipmentIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        lotController.update
      );

      protectedApp.delete(
        '/api/lots/:id',
        {
          schema: {
            tags: ['Lotes'],
            summary: 'Remove lote desassociando equipamentos vinculados',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        lotController.delete
      );

      // ==========================================
      // 5. EQUIPAMENTOS CRUD + OPERACOES DE DOMINIO
      // ==========================================
      protectedApp.post(
        '/api/equipments',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Cadastra equipamento com codigoBarrasInterno único, valoração financeira e movimentação inicial',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: [
                'organizationId',
                'lotId',
                'serial',
                'category',
                'brand',
                'model',
                'condition',
                'location',
              ],
              properties: {
                organizationId: { type: 'string', minLength: 1 },
                lotId: { type: 'string', minLength: 1 },
                codigoBarrasInterno: { type: 'string' },
                serial: { type: 'string', minLength: 1 },
                category: { type: 'string', minLength: 1 },
                brand: { type: 'string', minLength: 1 },
                model: { type: 'string', minLength: 1 },
                condition: { type: 'string', minLength: 1 },
                location: { type: 'string', minLength: 1 },
                estimatedValue: { type: 'number', minimum: 0 },
                notes: { type: 'string' },
              },
            },
          },
        },
        equipmentController.create
      );

      protectedApp.get(
        '/api/equipments',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Lista equipamentos com filtros operacionais',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                organizationId: { type: 'string' },
                lotId: { type: 'string' },
                status: { type: 'string' },
                condition: { type: 'string' },
                category: { type: 'string' },
                search: { type: 'string' },
              },
            },
          },
        },
        equipmentController.list
      );

      protectedApp.get(
        '/api/equipments/:id',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Obtém detalhes completos do equipamento e suas movimentações',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        equipmentController.getById
      );

      protectedApp.get(
        '/api/equipments/:id/valuation',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Retorna memória de cálculo financeiro (depreciação, condição e alíquota do contrato)',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        equipmentController.getValuation
      );

      protectedApp.get(
        '/api/equipments/:id/history',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Retorna trilha de rastreabilidade (movimentações) do equipamento',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        equipmentController.getHistory
      );

      protectedApp.put(
        '/api/equipments/:id',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Atualiza equipamento aplicando regras de transição, depreciação e versionamento otimista',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                lotId: { type: 'string', minLength: 1 },
                codigoBarrasInterno: { type: 'string', minLength: 1 },
                serial: { type: 'string', minLength: 1 },
                category: { type: 'string', minLength: 1 },
                brand: { type: 'string', minLength: 1 },
                model: { type: 'string', minLength: 1 },
                condition: { type: 'string' },
                status: { type: 'string' },
                location: { type: 'string', minLength: 1 },
                estimatedValue: { type: 'number', minimum: 0 },
                notes: { type: 'string' },
                justification: { type: 'string' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        equipmentController.update
      );

      protectedApp.patch(
        '/api/equipments/:id/status',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Altera status logístico do equipamento gerando movimentação em transação atômica',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['status', 'version'],
              properties: {
                status: { type: 'string', minLength: 1 },
                note: { type: 'string' },
                toLocation: { type: 'string' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        equipmentController.changeStatus
      );

      protectedApp.patch(
        '/api/equipments/:id/condition',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Altera condição física exigindo justificativa para queda >= 2 categorias e recalculando valor',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['condition', 'version'],
              properties: {
                condition: { type: 'string', minLength: 1 },
                note: { type: 'string' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        equipmentController.updateCondition
      );

      protectedApp.delete(
        '/api/equipments/:id',
        {
          schema: {
            tags: ['Equipamentos'],
            summary: 'Exclui equipamento do cadastro',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        equipmentController.delete
      );

      // ==========================================
      // 6. MOVIMENTACOES CRUD
      // ==========================================
      protectedApp.post(
        '/api/movements',
        {
          schema: {
            tags: ['Movimentacoes'],
            summary: 'Registra nova movimentação e sincroniza estado do equipamento atomicamente',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['equipmentId', 'type', 'note'],
              properties: {
                equipmentId: { type: 'string', minLength: 1 },
                lotId: { type: ['string', 'null'] },
                type: { type: 'string', minLength: 1 },
                quantity: { type: 'integer', minimum: 1 },
                note: { type: 'string', minLength: 1 },
                toStatus: { type: 'string' },
                toCondition: { type: 'string' },
                toLocation: { type: 'string' },
                financialValue: { type: ['number', 'null'] },
              },
            },
          },
        },
        movementController.create
      );

      protectedApp.get(
        '/api/movements',
        {
          schema: {
            tags: ['Movimentacoes'],
            summary: 'Lista movimentações registradas',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                equipmentId: { type: 'string' },
                lotId: { type: 'string' },
                actorId: { type: 'string' },
                type: { type: 'string' },
              },
            },
          },
        },
        movementController.list
      );

      protectedApp.get(
        '/api/movements/:id',
        {
          schema: {
            tags: ['Movimentacoes'],
            summary: 'Obtém movimentação por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        movementController.getById
      );

      protectedApp.put(
        '/api/movements/:id',
        {
          schema: {
            tags: ['Movimentacoes'],
            summary: 'Atualiza movimentação com controle de versão otimista',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                type: { type: 'string' },
                quantity: { type: 'integer', minimum: 1 },
                note: { type: 'string', minLength: 1 },
                fromLocation: { type: ['string', 'null'] },
                toLocation: { type: ['string', 'null'] },
                financialValue: { type: ['number', 'null'] },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        movementController.update
      );

      protectedApp.delete(
        '/api/movements/:id',
        {
          schema: {
            tags: ['Movimentacoes'],
            summary: 'Remove registro de movimentação (ADMINISTRADOR)',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        movementController.delete
      );

      // ==========================================
      // 7. EVENTOS DE AUDITORIA CRUD + VERIFICACAO
      // ==========================================
      protectedApp.post(
        '/api/audit-events',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Registra evento manual na trilha de auditoria encadeada por hash SHA-256 (ADMINISTRADOR)',
            security: bearerSecurity,
            body: {
              type: 'object',
              required: ['action', 'entityName', 'entityId'],
              properties: {
                action: { type: 'string', minLength: 1 },
                entityName: { type: 'string', minLength: 1 },
                entityId: { type: 'string', minLength: 1 },
                details: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        auditController.create
      );

      protectedApp.get(
        '/api/audit-events',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Consulta trilha de auditoria (ADMINISTRADOR e AUDITOR)',
            security: bearerSecurity,
            querystring: {
              type: 'object',
              properties: {
                entityName: { type: 'string' },
                entityId: { type: 'string' },
                actorId: { type: 'string' },
                action: { type: 'string' },
              },
            },
          },
        },
        auditController.list
      );

      protectedApp.get(
        '/api/audit-events/verify',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Verifica integridade criptográfica da cadeia de hashes de auditoria',
            security: bearerSecurity,
          },
        },
        auditController.verify
      );

      protectedApp.get(
        '/api/audit-events/:id',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Obtém evento de auditoria por ID',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        auditController.getById
      );

      protectedApp.put(
        '/api/audit-events/:id',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Atualiza evento de auditoria com recomputação da cadeia (ADMINISTRADOR)',
            security: bearerSecurity,
            params: idParamsSchema,
            body: {
              type: 'object',
              required: ['version'],
              properties: {
                action: { type: 'string', minLength: 1 },
                entityName: { type: 'string', minLength: 1 },
                entityId: { type: 'string', minLength: 1 },
                details: { type: 'object', additionalProperties: true },
                version: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
        auditController.update
      );

      protectedApp.delete(
        '/api/audit-events/:id',
        {
          schema: {
            tags: ['Auditoria'],
            summary: 'Remove evento de auditoria recomputando cadeia (ADMINISTRADOR)',
            security: bearerSecurity,
            params: idParamsSchema,
          },
        },
        auditController.delete
      );

      // ==========================================
      // 8. GESTÃO ADMINISTRATIVA DE CHAVES DE API (AV3 - /api/v1/admin/api-keys)
      // ==========================================
      for (const prefix of ['/api/v1/admin', '/api/v1/internal', '/api']) {
        protectedApp.post(
          `${prefix}/api-keys`,
          {
            schema: {
              tags: ['Admin - Chaves de API (AV3)'],
              summary: 'Gera uma nova chave de API (X-API-Key) para parceiro externo com escopos e rate limit',
              security: bearerSecurity,
              body: {
                type: 'object',
                required: ['organizationId', 'name'],
                properties: {
                  organizationId: { type: 'string', minLength: 1 },
                  name: { type: 'string', minLength: 2 },
                  scopes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  rateLimitPerMinute: { type: 'integer', minimum: 1, maximum: 10000 },
                  expiresAt: { type: ['string', 'null'] },
                },
              },
            },
          },
          apiKeyController.create
        );

        protectedApp.get(
          `${prefix}/api-keys`,
          {
            schema: {
              tags: ['Admin - Chaves de API (AV3)'],
              summary: 'Lista chaves de API emitidas para parceiros externos',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  organizationId: { type: 'string' },
                  active: { type: 'string' },
                },
              },
            },
          },
          apiKeyController.list
        );

        protectedApp.get(
          `${prefix}/api-keys/:id`,
          {
            schema: {
              tags: ['Admin - Chaves de API (AV3)'],
              summary: 'Obtém detalhes de uma chave de API por ID',
              security: bearerSecurity,
              params: idParamsSchema,
            },
          },
          apiKeyController.getById
        );

        protectedApp.put(
          `${prefix}/api-keys/:id`,
          {
            schema: {
              tags: ['Admin - Chaves de API (AV3)'],
              summary: 'Atualiza escopos, limite de taxa ou status de uma chave de API com versionamento otimista',
              security: bearerSecurity,
              params: idParamsSchema,
              body: {
                type: 'object',
                required: ['version'],
                properties: {
                  name: { type: 'string', minLength: 2 },
                  scopes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  rateLimitPerMinute: { type: 'integer', minimum: 1, maximum: 10000 },
                  active: { type: 'boolean' },
                  expiresAt: { type: ['string', 'null'] },
                  version: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
          apiKeyController.update
        );

        protectedApp.delete(
          `${prefix}/api-keys/:id`,
          {
            schema: {
              tags: ['Admin - Chaves de API (AV3)'],
              summary: 'Revoga e exclui uma chave de API de parceiro externo',
              security: bearerSecurity,
              params: idParamsSchema,
            },
          },
          apiKeyController.revoke
        );
      }

      // ==========================================
      // 9. CAMADA ANALÍTICA, RELATÓRIOS PREDITIVOS E FILA DE JOBS (AV3 - /api/v1/internal)
      // ==========================================
      for (const prefix of ['/api/v1/internal', '/api']) {
        protectedApp.get(
          `${prefix}/analytics/operational-efficiency`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: '1ª Categoria de Insight: Análise de eficiência operacional e gargalos de triagem de lotes',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  organizationId: { type: 'string' },
                  persist: { type: 'string' },
                },
              },
            },
          },
          analyticsController.operationalEfficiency
        );

        protectedApp.get(
          `${prefix}/analytics/equipment-profitability`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: '2ª Categoria de Insight: Análise de rentabilidade e recuperação financeira por tipo, marca, modelo e condição',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  organizationId: { type: 'string' },
                  persist: { type: 'string' },
                },
              },
            },
          },
          analyticsController.equipmentProfitability
        );

        protectedApp.get(
          `${prefix}/analytics/remaining-useful-life`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: '3ª Categoria de Insight: Análise preditiva de vida útil remanescente (Mínimos Quadrados Ordinários OLS e Suavização Exponencial)',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  organizationId: { type: 'string' },
                  persist: { type: 'string' },
                },
              },
            },
          },
          analyticsController.remainingUsefulLife
        );

        protectedApp.post(
          `${prefix}/analytics/reports`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: 'Executa modelo analítico/preditivo e persiste o resultado no banco de dados para histórico',
              security: bearerSecurity,
              body: {
                type: 'object',
                required: ['category'],
                properties: {
                  category: { type: 'string', minLength: 1 },
                  organizationId: { type: ['string', 'null'] },
                },
              },
            },
          },
          analyticsController.generateAndSaveReport
        );

        protectedApp.get(
          `${prefix}/analytics/reports`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: 'Lista relatórios analíticos e preditivos persistidos para consulta histórica',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  organizationId: { type: 'string' },
                },
              },
            },
          },
          analyticsController.listReports
        );

        protectedApp.get(
          `${prefix}/analytics/reports/:id`,
          {
            schema: {
              tags: ['Camada Analítica & BI (AV3)'],
              summary: 'Consulta relatório analítico histórico por ID',
              security: bearerSecurity,
              params: idParamsSchema,
            },
          },
          analyticsController.getReportById
        );

        protectedApp.post(
          `${prefix}/jobs/reports`,
          {
            schema: {
              tags: ['Filas & Jobs Assíncronos (AV3)'],
              summary: 'Enfileira geração assíncrona de relatório analítico/preditivo (JSON ou CSV) com política de retry',
              security: bearerSecurity,
              body: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  format: { type: 'string' },
                  organizationId: { type: ['string', 'null'] },
                  maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
                  webhookUrl: { type: ['string', 'null'] },
                  simulateFailuresCount: { type: 'integer', minimum: 0, maximum: 10 },
                },
              },
            },
          },
          analyticsController.enqueueJob
        );

        protectedApp.get(
          `${prefix}/jobs`,
          {
            schema: {
              tags: ['Filas & Jobs Assíncronos (AV3)'],
              summary: 'Lista tarefas assíncronas da fila de relatórios',
              security: bearerSecurity,
              querystring: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  organizationId: { type: 'string' },
                  type: { type: 'string' },
                },
              },
            },
          },
          analyticsController.listJobs
        );

        protectedApp.get(
          `${prefix}/jobs/:id`,
          {
            schema: {
              tags: ['Filas & Jobs Assíncronos (AV3)'],
              summary: 'Consulta status de processamento da tarefa assíncrona (Polling)',
              security: bearerSecurity,
              params: idParamsSchema,
            },
          },
          analyticsController.getJobStatus
        );

        protectedApp.get(
          `${prefix}/jobs/:id/download`,
          {
            schema: {
              tags: ['Filas & Jobs Assíncronos (AV3)'],
              summary: 'Realiza download do relatório gerado pela tarefa assíncrona (CSV ou JSON)',
              security: bearerSecurity,
              params: idParamsSchema,
            },
          },
          analyticsController.downloadJobResult
        );
      }
    }
  );

  // ==========================================
  // 10. API PÚBLICA PARA PARCEIROS EXTERNOS (AV3 - /api/v1/public/*)
  // ==========================================
  app.register(
    async (publicTrackReadApp) => {
      publicTrackReadApp.addHook(
        'preHandler',
        createPartnerApiKeyHook(ApiKeyScope.TRACKING_READ)
      );

      publicTrackReadApp.get(
        '/api/v1/public/tracking/:barcode',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Consulta status e histórico de rastreabilidade de um equipamento pelo codigoBarrasInterno',
            security: apiKeySecurity,
            params: {
              type: 'object',
              required: ['barcode'],
              properties: {
                barcode: { type: 'string', minLength: 1 },
              },
            },
          },
        },
        publicApiController.getTrackingByBarcode
      );

      publicTrackReadApp.get(
        '/api/v1/public/equipments',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Lista inventário de equipamentos vinculados à organização do parceiro',
            security: apiKeySecurity,
            querystring: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                condition: { type: 'string' },
                lotId: { type: 'string' },
              },
            },
          },
        },
        publicApiController.listPartnerEquipments
      );

      publicTrackReadApp.get(
        '/api/v1/public/lots',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Lista lotes da organização parceira',
            security: apiKeySecurity,
            querystring: {
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
            },
          },
        },
        publicApiController.listPartnerLots
      );
    }
  );

  app.register(
    async (publicLotsWriteApp) => {
      publicLotsWriteApp.addHook(
        'preHandler',
        createPartnerApiKeyHook(ApiKeyScope.LOTS_WRITE)
      );

      publicLotsWriteApp.post(
        '/api/v1/public/lots',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Submete novo lote de coleta e seus equipamentos diretamente pelo ERP do parceiro (escopo lots:write)',
            security: apiKeySecurity,
            body: {
              type: 'object',
              required: ['code', 'origin', 'destination'],
              properties: {
                code: { type: 'string', minLength: 1 },
                invoiceNumber: { type: ['string', 'null'] },
                carrier: { type: ['string', 'null'] },
                origin: { type: 'string', minLength: 1 },
                destination: { type: 'string', minLength: 1 },
                entryDate: { type: 'string' },
                notes: { type: 'string' },
                newEquipments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['serial', 'category', 'brand', 'model', 'condition', 'location'],
                    properties: {
                      codigoBarrasInterno: { type: 'string' },
                      serial: { type: 'string', minLength: 1 },
                      category: { type: 'string', minLength: 1 },
                      brand: { type: 'string', minLength: 1 },
                      model: { type: 'string', minLength: 1 },
                      condition: { type: 'string', minLength: 1 },
                      location: { type: 'string', minLength: 1 },
                      estimatedValue: { type: 'number', minimum: 0 },
                      notes: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        publicApiController.submitPartnerLot
      );
    }
  );

  app.register(
    async (publicAnalyticsReadApp) => {
      publicAnalyticsReadApp.addHook(
        'preHandler',
        createPartnerApiKeyHook(ApiKeyScope.ANALYTICS_READ)
      );

      publicAnalyticsReadApp.get(
        '/api/v1/public/analytics/summary',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Gera e retorna insights analíticos e preditivos exclusivos da organização parceira (escopo analytics:read)',
            security: apiKeySecurity,
            querystring: {
              type: 'object',
              properties: {
                category: { type: 'string' },
              },
            },
          },
        },
        publicApiController.getPartnerAnalyticsSummary
      );

      publicAnalyticsReadApp.get(
        '/api/v1/public/jobs/:id',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Consulta status de tarefa assíncrona de relatório solicitada pelo parceiro (Polling)',
            security: apiKeySecurity,
            params: idParamsSchema,
          },
        },
        publicApiController.getPartnerJobStatus
      );

      publicAnalyticsReadApp.get(
        '/api/v1/public/jobs/:id/download',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Faz o download do arquivo CSV ou JSON gerado pela tarefa assíncrona quando COMPLETED',
            security: apiKeySecurity,
            params: idParamsSchema,
          },
        },
        publicApiController.downloadPartnerJobResult
      );
    }
  );

  app.register(
    async (publicReportsWriteApp) => {
      publicReportsWriteApp.addHook(
        'preHandler',
        createPartnerApiKeyHook(ApiKeyScope.REPORTS_WRITE)
      );

      publicReportsWriteApp.post(
        '/api/v1/public/reports/jobs',
        {
          schema: {
            tags: ['API Pública - Parceiros (AV3)'],
            summary: 'Solicita geração assíncrona em fila de relatório preditivo completo (CSV ou JSON) retornando jobId imediatamente',
            security: apiKeySecurity,
            body: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                format: { type: 'string' },
                maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
                webhookUrl: { type: ['string', 'null'] },
                simulateFailuresCount: { type: 'integer', minimum: 0, maximum: 10 },
              },
            },
          },
        },
        publicApiController.enqueuePartnerReportJob
      );
    }
  );
}

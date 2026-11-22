import { Prisma } from '@prisma/client';
import { ContractStatus, LotStatus } from '../domain/enums';
import { FinancialCalculator } from '../domain/financial';
import {
  ensureValidTransactionType,
  EquipmentDomainValidator,
} from '../domain/validators';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { prisma } from '../lib/prisma';
import { ContractRepository } from '../repositories/contract.repository';
import { EquipmentRepository } from '../repositories/equipment.repository';
import { LotRepository } from '../repositories/lot.repository';
import {
  MovementFilters,
  MovementRepository,
  MovementWithDetails,
} from '../repositories/movement.repository';
import { assertPermission } from '../security/rbac';
import { ActorContext, AuditEventService } from './audit-event.service';

export interface CreateMovementInput {
  equipmentId: string;
  lotId?: string | null;
  type: string;
  quantity?: number;
  note: string;
  toStatus?: string;
  toCondition?: string;
  toLocation?: string;
  financialValue?: number | null;
}

export interface UpdateMovementInput {
  type?: string;
  quantity?: number;
  note?: string;
  fromLocation?: string | null;
  toLocation?: string | null;
  financialValue?: number | null;
  version?: number;
}

export class MovementService {
  constructor(
    private readonly movementRepo: MovementRepository = new MovementRepository(),
    private readonly equipRepo: EquipmentRepository = new EquipmentRepository(),
    private readonly lotRepo: LotRepository = new LotRepository(),
    private readonly contractRepo: ContractRepository = new ContractRepository(),
    private readonly auditService: AuditEventService = new AuditEventService()
  ) {}

  async create(
    actor: ActorContext,
    input: CreateMovementInput
  ): Promise<MovementWithDetails> {
    assertPermission(actor.role, 'movement', 'write');

    if (!input.equipmentId?.trim() || !input.type?.trim() || !input.note?.trim()) {
      throw new ValidationError('Campos obrigatórios da movimentação: equipmentId, type, note.');
    }

    const type = ensureValidTransactionType(input.type);
    const quantity = Number(input.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('A quantidade (quantity) deve ser um número inteiro maior que zero.');
    }

    return prisma.$transaction(async (tx) => {
      const eq = await this.equipRepo.findById(input.equipmentId, tx);
      if (!eq) {
        throw new NotFoundError('Equipamento não encontrado para registrar movimentação.');
      }

      if (input.lotId) {
        const lot = await this.lotRepo.findById(input.lotId, tx);
        if (!lot) throw new NotFoundError('Lote informado não encontrado.');
        if (lot.organizationId !== eq.organizationId) {
          throw new ValidationError('O lote informado pertence a outra organização.');
        }
        if (input.lotId !== eq.lotId && (lot.status === LotStatus.FECHADO || lot.status === LotStatus.CANCELADO)) {
          throw new ValidationError(`Não é possível movimentar equipamento para um lote com status '${lot.status}'.`);
        }
      }

      const eqUpdates: Prisma.EquipamentoUncheckedUpdateManyInput = {};
      let targetStatus = eq.status;
      let targetCondition = eq.condition;
      let targetLocation = eq.location;
      let targetCurrentValue = eq.currentValue;

      if (input.toStatus) {
        targetStatus = EquipmentDomainValidator.validateStatusTransition(
          eq.status,
          input.toStatus
        );
        eqUpdates.status = targetStatus;
      }

      if (input.toCondition) {
        targetCondition = EquipmentDomainValidator.validateConditionTransition(
          eq.condition,
          input.toCondition,
          input.note
        );
        eqUpdates.condition = targetCondition;

        const contract = await this.contractRepo.findByOrganizationId(eq.organizationId, tx);
        const active = contract && contract.status === ContractStatus.ATIVO ? contract : null;
        const valuation = FinancialCalculator.calculateValuation({
          estimatedValue: eq.estimatedValue,
          condition: targetCondition,
          depreciationRate: active?.depreciationRate ?? 10,
          taxRate: active?.taxRate ?? 0,
        });
        targetCurrentValue = valuation.currentValue;
        eqUpdates.currentValue = targetCurrentValue;
      }

      if (input.toLocation?.trim()) {
        targetLocation = input.toLocation.trim();
        eqUpdates.location = targetLocation;
      }

      if (input.lotId !== undefined && input.lotId !== null && input.lotId.trim() !== '') {
        eqUpdates.lotId = input.lotId.trim();
      }

      if (Object.keys(eqUpdates).length > 0) {
        await this.equipRepo.update(eq.id, eqUpdates, eq.version, tx);
      }

      const movement = await this.movementRepo.create(
        {
          equipmentId: eq.id,
          lotId: input.lotId ? input.lotId.trim() : eq.lotId,
          actorId: actor.id,
          type,
          quantity,
          note: input.note.trim(),
          fromStatus: eq.status,
          toStatus: targetStatus,
          fromCondition: eq.condition,
          toCondition: targetCondition,
          fromLocation: eq.location,
          toLocation: targetLocation,
          financialValue:
            input.financialValue !== undefined ? input.financialValue : targetCurrentValue,
        },
        tx
      );

      await this.auditService.record(
        actor.id,
        'CREATE_MOVEMENT',
        'Movimentacao',
        movement.id,
        {
          equipmentId: eq.id,
          type,
          fromStatus: eq.status,
          toStatus: targetStatus,
        },
        tx
      );

      return movement;
    });
  }

  async list(
    actor: ActorContext,
    filters: MovementFilters = {}
  ): Promise<MovementWithDetails[]> {
    assertPermission(actor.role, 'movement', 'read');
    return this.movementRepo.findAll(filters);
  }

  async getById(actor: ActorContext, id: string): Promise<MovementWithDetails> {
    assertPermission(actor.role, 'movement', 'read');
    const movement = await this.movementRepo.findById(id);
    if (!movement) {
      throw new NotFoundError('Movimentação não encontrada.');
    }
    return movement;
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateMovementInput
  ): Promise<MovementWithDetails> {
    assertPermission(actor.role, 'movement', 'write');

    return prisma.$transaction(async (tx) => {
      const existing = await this.movementRepo.findById(id, tx);
      if (!existing) {
        throw new NotFoundError('Movimentação não encontrada.');
      }

      const updateData: Prisma.MovimentacaoUncheckedUpdateManyInput = {};

      if (input.type !== undefined) {
        updateData.type = ensureValidTransactionType(input.type);
      }
      if (input.quantity !== undefined) {
        const qty = Number(input.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          throw new ValidationError('A quantidade deve ser um inteiro positivo.');
        }
        updateData.quantity = qty;
      }
      if (input.note !== undefined) {
        if (!input.note.trim()) throw new ValidationError('A nota não pode ser vazia.');
        updateData.note = input.note.trim();
      }
      if (input.fromLocation !== undefined) {
        updateData.fromLocation = input.fromLocation ? input.fromLocation.trim() : null;
      }
      if (input.toLocation !== undefined) {
        updateData.toLocation = input.toLocation ? input.toLocation.trim() : null;
      }
      if (input.financialValue !== undefined) {
        updateData.financialValue = input.financialValue;
      }

      const updated = await this.movementRepo.update(id, updateData, input.version, tx);

      // Se a movimentação editada for a movimentação mais recente do equipamento, sincroniza o estado do equipamento
      const allMovements = await this.movementRepo.findByEquipmentId(existing.equipmentId, tx);
      const latestMovement = allMovements[allMovements.length - 1];

      if (latestMovement && latestMovement.id === id) {
        const eq = await this.equipRepo.findById(existing.equipmentId, tx);
        if (eq) {
          const eqSyncData: Prisma.EquipamentoUncheckedUpdateManyInput = {};
          if (input.toLocation !== undefined && input.toLocation?.trim()) {
            eqSyncData.location = input.toLocation.trim();
          }
          if (input.financialValue !== undefined && input.financialValue !== null) {
            eqSyncData.currentValue = input.financialValue;
          }
          if (Object.keys(eqSyncData).length > 0) {
            await this.equipRepo.update(eq.id, eqSyncData, eq.version, tx);
          }
        }
      }

      await this.auditService.record(
        actor.id,
        'UPDATE_MOVEMENT',
        'Movimentacao',
        id,
        { updatedFields: Object.keys(updateData), version: updated.version },
        tx
      );

      return updated;
    });
  }

  async delete(actor: ActorContext, id: string): Promise<void> {
    assertPermission(actor.role, 'movement', 'delete');

    await prisma.$transaction(async (tx) => {
      const existing = await this.movementRepo.findById(id, tx);
      if (!existing) {
        throw new NotFoundError('Movimentação não encontrada.');
      }

      const allMovements = await this.movementRepo.findByEquipmentId(existing.equipmentId, tx);
      if (allMovements.length <= 1) {
        throw new ConflictError(
          'Não é possível excluir a movimentação inicial/única de recebimento do equipamento.'
        );
      }

      const latestMovement = allMovements[allMovements.length - 1];
      if (!latestMovement || latestMovement.id !== id) {
        throw new ConflictError(
          'Apenas a movimentação mais recente de um equipamento pode ser estornada/excluída para preservar a integridade do histórico.'
        );
      }

      const eq = await this.equipRepo.findById(existing.equipmentId, tx);
      if (eq && existing.fromStatus === 'AGUARDANDO_COMPONENTES' && eq.status !== 'EM_TRIAGEM' && eq.status !== 'AGUARDANDO_COMPONENTES') {
        throw new ConflictError(
          'Não é possível estornar esta movimentação pois o equipamento precisaria retornar para AGUARDANDO_COMPONENTES sem passar por EM_TRIAGEM.'
        );
      }

      if (eq) {
        const revertData: Prisma.EquipamentoUncheckedUpdateManyInput = {};
        if (existing.fromStatus && existing.fromStatus !== eq.status) {
          revertData.status = existing.fromStatus;
        }
        if (existing.fromCondition && existing.fromCondition !== eq.condition) {
          revertData.condition = existing.fromCondition;
          const contract = await this.contractRepo.findByOrganizationId(eq.organizationId, tx);
          const active = contract && contract.status === ContractStatus.ATIVO ? contract : null;
          const valuation = FinancialCalculator.calculateValuation({
            estimatedValue: eq.estimatedValue,
            condition: existing.fromCondition,
            depreciationRate: active?.depreciationRate ?? 10,
            taxRate: active?.taxRate ?? 0,
          });
          revertData.currentValue = valuation.currentValue;
        }
        if (existing.fromLocation && existing.fromLocation !== eq.location) {
          revertData.location = existing.fromLocation;
        }

        if (Object.keys(revertData).length > 0) {
          await this.equipRepo.update(eq.id, revertData, eq.version, tx);
        }
      }

      await this.movementRepo.delete(id, tx);
      await this.auditService.record(
        actor.id,
        'DELETE_MOVEMENT',
        'Movimentacao',
        id,
        { equipmentId: existing.equipmentId, type: existing.type },
        tx
      );
    });
  }
}

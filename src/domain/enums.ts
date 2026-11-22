export enum Role {
  ADMINISTRADOR = 'ADMINISTRADOR',
  OPERADOR_CADASTRO = 'OPERADOR_CADASTRO',
  ALMOXARIFE = 'ALMOXARIFE',
  AUDITOR = 'AUDITOR',
}

export enum EquipmentCondition {
  NOVO = 'NOVO',
  OTIMO = 'OTIMO',
  BOM = 'BOM',
  REGULAR = 'REGULAR',
  RUIM = 'RUIM',
  PESSIMO = 'PESSIMO',
  SUCATA = 'SUCATA',
}

export const CONDITION_RANK: readonly EquipmentCondition[] = [
  EquipmentCondition.NOVO,
  EquipmentCondition.OTIMO,
  EquipmentCondition.BOM,
  EquipmentCondition.REGULAR,
  EquipmentCondition.RUIM,
  EquipmentCondition.PESSIMO,
  EquipmentCondition.SUCATA,
];

export enum EquipmentStatus {
  RECEBIDO = 'RECEBIDO',
  EM_TRIAGEM = 'EM_TRIAGEM',
  AGUARDANDO_COMPONENTES = 'AGUARDANDO_COMPONENTES',
  EM_REPARO = 'EM_REPARO',
  RECONDICIONADO = 'RECONDICIONADO',
  DESCARTADO = 'DESCARTADO',
  DOADO = 'DOADO',
  VENDIDO = 'VENDIDO',
}

export enum TransactionType {
  RECEBIMENTO = 'RECEBIMENTO',
  TRIAGEM = 'TRIAGEM',
  TRANSFERENCIA = 'TRANSFERENCIA',
  REPARO = 'REPARO',
  RECONDICIONAMENTO = 'RECONDICIONAMENTO',
  DESCARTE = 'DESCARTE',
  DOACAO = 'DOACAO',
  VENDA = 'VENDA',
  AJUSTE_ESTOQUE = 'AJUSTE_ESTOQUE',
}

export enum LotStatus {
  ABERTO = 'ABERTO',
  EM_PROCESSAMENTO = 'EM_PROCESSAMENTO',
  FECHADO = 'FECHADO',
  CANCELADO = 'CANCELADO',
}

export enum ContractStatus {
  RASCUNHO = 'RASCUNHO',
  ATIVO = 'ATIVO',
  SUSPENSO = 'SUSPENSO',
  ENCERRADO = 'ENCERRADO',
}

export enum CollectionFrequency {
  SEMANAL = 'SEMANAL',
  QUINZENAL = 'QUINZENAL',
  MENSAL = 'MENSAL',
  TRIMESTRAL = 'TRIMESTRAL',
  SOB_DEMANDA = 'SOB_DEMANDA',
}

export enum AnalyticalReportCategory {
  EFICIENCIA_OPERACIONAL = 'EFICIENCIA_OPERACIONAL',
  RENTABILIDADE_EQUIPAMENTO = 'RENTABILIDADE_EQUIPAMENTO',
  VIDA_UTIL_PREDITIVA = 'VIDA_UTIL_PREDITIVA',
  CONSOLIDADO_COMPLETO = 'CONSOLIDADO_COMPLETO',
}

export enum ApiKeyScope {
  TRACKING_READ = 'tracking:read',
  LOTS_WRITE = 'lots:write',
  ANALYTICS_READ = 'analytics:read',
  REPORTS_WRITE = 'reports:write',
}

export enum AsyncJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ReportExportFormat {
  JSON = 'JSON',
  CSV = 'CSV',
}

# Resumo Executivo e Técnico — Atividade de Avaliação Individual 3 (AV3)

**Disciplina:** Técnicas de Programação — Prof. Eng. Dr. Gerson Penha  
**Sistema:** GreenCode (Plataforma de Logística Reversa de Resíduos Eletroeletrônicos)

---

## 1. Contextualização Estratégica e Conceitual

A **AV3** representa a transição do **GreenCode** de um sistema meramente transacional (focado em CRUD e persistência relacional construídos na AV1 e AV2) para uma **plataforma analítica inteligente e aberta à integração externa via APIs Públicas**.

O documento fundamenta essa evolução em dois marcos históricos da computação:
1. **Evolução do Business Intelligence (BI) e Análise Preditiva:** Desde os relatórios descritivos estáticos da década de 1960 (e o caso pioneiro do computador LEO na rede de padarias J. Lyons & Co. na década de 1950 para previsão de demanda em cadeias de suprimentos), passando por DSS e OLAP, até o BI moderno com modelos estatísticos e preditivos capazes de transformar dados brutos de estoque e triagem em conhecimento acionável.
2. **Economia de APIs:** A evolução das interfaces programáveis (Salesforce, eBay, Amazon AWS S3/EC2, redes sociais, Open Banking) como produtos estratégicos que permitem a clientes e parceiros integrar seus ERPs, submeter lotes, consultar rastreabilidade e consumir relatórios analíticos de maneira automatizada e segura.

---

## 2. Os Três Pilares Técnicos Exigidos na AV3

### Pilar 1: Camada Analítica e Relatórios Preditivos
Construção de um módulo de inteligência analítica utilizando **Node.js, TypeScript e Prisma ORM** (com apoio estatístico de algoritmos como Mínimos Quadrados Ordinários / Regressão Linear, Suavização Exponencial, média, mediana e desvio padrão), estruturado em serviços independentes acessíveis via **endpoints da API** e via **tarefas agendadas em segundo plano** (cron/worker).

O sistema deve gerar e **persistir em novas tabelas no banco de dados** (para consulta histórica e comparação entre previsões e realizações) pelo menos **três categorias de relatórios de insight**:
1. **Análise de Eficiência Operacional:**
   - Calcula o tempo médio (e estatísticas como mediana e desvio padrão) de processamento de lotes e equipamentos desde a entrada (`entryDate` / `RECEBIDO`) até a conclusão da triagem (`EM_TRIAGEM` e estágios subsequentes).
   - Identifica gargalos operacionais e variações de produtividade entre diferentes operadores (`actorId`) ou períodos do ano.
2. **Análise de Rentabilidade por Tipo de Equipamento:**
   - Estima o valor médio de recuperação financeira (`currentValue`, `estimatedValue`, taxa de retenção de valor e retorno em movimentações) agrupado por categoria (`category`), condição física (`condition`), marca (`brand`) e modelo (`model`).
   - Permite que clientes e gestores priorizem quais tipos de ativos oferecem maior retorno financeiro na logística reversa.
3. **Análise Preditiva de Vida Útil Remanescente (RUL — *Remaining Useful Life*):**
   - Utiliza **Regressão Linear Simples pelo Método dos Mínimos Quadrados Ordinários (OLS)** e **Suavização Exponencial** sobre o histórico de depreciação, quedas de condição física e falhas para projetar em quanto tempo (dias/meses) cada equipamento ou categoria atingirá o estado inservível (`SUCATA` / limiar crítico de valor residual).
   - Os resultados analíticos e preditivos devem ser **persistidos no banco de dados** para histórico e auditoria de modelos.

---

### Pilar 2: API Pública Documentada, Chaves de API (`API Keys`), Escopos e Rate Limiting
Exposição de uma camada de integração para parceiros externos com governança e segurança dedicadas:
1. **Gestão de Chaves de API (`ApiKey`) no Serviço de Autenticação:**
   - Cada parceiro externo (vinculado a uma `Organizacao`) recebe uma chave de API única gerada e gerenciada por um novo módulo de autenticação.
   - Suporte a **permissões granulares (escopos)** por chave de acordo com o contrato comercial:
     - `tracking:read` (leitura de rastreabilidade de equipamentos e lotes da organização);
     - `lots:write` (submissão/abertura de novos lotes e equipamentos pelo parceiro);
     - `analytics:read` / `reports:write` (consulta de relatórios analíticos e solicitação de jobs assíncronos).
2. **Controle de Taxa de Requisições (`Rate Limiting`):**
   - Limitação de requisições por janela de tempo e por cliente/chave de API (proteção contra abuso e garantia de QoS por plano comercial).
3. **Segregação de Preocupações e Versionamento Semântico Explícito:**
   - Separação clara entre rotas públicas de parceiros (`/api/v1/public/...`) e rotas internas/administrativas (`/api/v1/internal/...` e `/api/v1/admin/...`, mantendo retrocompatibilidade com `/api/...` da AV2).
   - Suporte explícito à versão da API na URL (`/api/v1/...`) e/ou via cabeçalho HTTP (`X-API-Version: 1.0.0`).
4. **Documentação OpenAPI / Swagger Completa:**
   - Documentação interativa em `/docs` via `@fastify/swagger` contendo esquemas de segurança (`bearerAuth` para JWT interno e `apiKeyAuth` via `X-API-Key` para parceiros), exemplos de requisição/resposta, descrições de parâmetros e códigos de erro.

---

### Pilar 3: Orquestração Assíncrona com Filas, Polling, Exportação (JSON/CSV) e Retry
Conexão entre a API Pública e a Camada Analítica para operações pesadas (ex.: geração de relatório preditivo completo de todos os equipamentos ativos):
1. **Fila de Processamento Assíncrono (Worker + Agendador Recorrente):**
   - Ao receber uma solicitação de relatório pesado, a API enfileira um job em segundo plano e retorna imediatamente (`202 Accepted`) um identificador único da tarefa (`jobId`).
   - Suporte a **tarefas recorrentes agendadas** (cron job integrado ao worker) para consolidação automática periódica dos indicadores analíticos.
   - **Política de Retry com Backoff Exponencial:** Tarefas que falharem temporariamente são reprocessadas automaticamente até o limite configurado (`maxAttempts`), registrando falhas e tentativas.
2. **Padrão de Polling, Download (CSV ou JSON) e Webhook Opcional:**
   - Endpoint de consulta de status do job (`GET /api/v1/public/jobs/:id` e `/api/v1/internal/jobs/:id`) informando `PENDING`, `PROCESSING`, `COMPLETED` ou `FAILED`, progresso e metadados.
   - Endpoint de download do arquivo gerado (`GET /api/v1/public/jobs/:id/download` e `/api/v1/internal/jobs/:id/download`) entregando o relatório consolidado em formato **`CSV`** ou **`JSON`**.

---

## 3. Requisitos Não-Funcionais e Documentação Arquitetural

- **Relatório Técnico Arquitetural (`ARCHITECTURE.md`):**
  - Justificativa das escolhas matemáticas/estatísticas (implementação determinística de Mínimos Quadrados Ordinários, Suavização Exponencial e estatística descritiva em TypeScript puro sem dependências nativas C++);
  - Modelagem das novas tabelas relacionais (`ChaveApi`, `RelatorioAnalitico`, `TarefaAssincrona`);
  - Política de *retry* com *backoff* exponencial e *dead-letter*;
  - Plano de evolução para escalabilidade horizontal (centenas ou milhares de parceiros com Redis/BullMQ distribuído, réplicas de leitura PostgreSQL e API Gateway).
- **Portabilidade Multiplataforma:**
  - Compatibilidade integral com **Windows 10 ou superior**, **Linux Ubuntu 24.04.03 LTS ou superior** e distribuições derivadas do Ubuntu, mantendo execução limpa sem exigir daemons externos obrigatórios para avaliação local.

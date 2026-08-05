# WIMM — Where Is My Money

<!-- atlas:início -->
<!-- gerado a partir de storm-atlas/projects/wimm.md — não editar à mão -->

> Finanças pessoais por importação de extratos: CSV e OFX entram, regras categorizam, relatórios explicam para onde foi o dinheiro.

## O que é

Uma plataforma de finanças pessoais cuja pergunta é literalmente o nome: para onde foi o dinheiro.
Importa extratos em CSV e OFX, aplica regras de categorização, materializa transações recorrentes e
devolve relatórios e gráficos. Tem três clientes sobre a mesma API: uma app de desktop em Electron,
uma app móvel em React Native com Expo, e o backend em NestJS que é dono de toda a lógica.

**Não é uma plataforma bancária** — não sincroniza saldos com instituições em tempo real. Tudo é
derivado do que foi importado ou criado à mão, e isso é uma decisão de escopo, não uma limitação.

## Por que existe

Perceber padrões de consumo exige olhar para meses de histórico junto, e nenhuma app de banco mostra
isso — mostram o mês corrente e o extrato cru. O trabalho chato é sempre o mesmo: transformar
ficheiros de bancos diferentes numa base comparável e categorizada. O WIMM automatiza exatamente esse
trabalho e deixa a análise como consequência.

## O que faz

- **Importação de CSV e OFX** em três tempos: pré-visualização, deduplicação e commit — nada entra
  na base sem ser visto primeiro
- **Regras de categorização** (padrão → categoria) aplicadas no momento da importação, com regras de
  sistema e regras do utilizador
- **Categorização por IA** com Anthropic Haiku 4.5, em modelo **BYOK** (o utilizador traz a sua chave),
  e a sugestão pode ser guardada como regra permanente
- **Lançamentos manuais** e **planos de prestações** (`InstallmentPlan`)
- **Transações recorrentes**, materializadas até uma data
- **Relatórios** — resumo e por categoria — e gráficos no dashboard: donut em SVG próprio, barras e
  tendência mensal, todos com animação de crescimento
- **Filtros por data e categoria** nas transações, na API e na lista
- **Seletor de intervalo de datas** com seleção de calendário em dois toques
- **Onboarding**, alternador de modo de data dos gráficos e scaffolding de subscrição
- **Auto-updater no desktop** com pipeline de release por GitHub Actions

## Como funciona

- Monorepo pnpm com Turborepo: `apps/api`, `apps/desktop`, `apps/mobile` e `packages/shared`
- **O backend é a fonte única de verdade** para persistência, validação, processamento de
  importação, regras de categorização, geração de recorrências e relatórios. Os clientes são finos
  por regra explícita da arquitetura — foi assim que a app móvel entrou depois sem reescrever domínio
- Módulos NestJS por domínio: `imports`, `transactions`, `categorization-rules`, `recurrences`,
  `reports`, `categories`, `sources`, `users`, `auth` e `ai`
- Autenticação com refresh tokens persistidos (`RefreshToken`)
- PostgreSQL por Prisma, com `docker-compose.yml` para o Postgres local
- O donut dos relatórios é **SVG escrito à mão** em vez de biblioteca de gráficos, e as animações de
  crescimento usam transform nativo para não repintar
- Expo passou do SDK 52 para o 54 durante o desenvolvimento; as pastas nativas do prebuild ficam fora
  do controlo de versões

## Estado atual

Pausado desde 2026-05-04, com o MVP funcional: importação, categorização (incluindo por IA),
recorrências, relatórios e os três clientes de pé. A API corre na VPS storm-vps como `wimm-api`.
O desktop tem ícones, auto-updater e pipeline de release.

O último trabalho acrescentou a categorização por IA e o scaffolding de subscrição — ou seja, o
projeto estava a virar-se para produto pago quando parou. A subscrição é *scaffolding*: os enums
(`SubscriptionStatus`, `SubscriptionPlan`) existem, a cobrança não.

<!-- atlas:fim -->

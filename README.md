# ZapSign API

API de integração com a ZapSign para envio e gerenciamento de contratos com assinatura digital.

## Funcionalidades

- ✅ Upload de PDF de contrato
- ✅ Extração automática de dados do PDF (nome, email, telefone, código do cliente)
- ✅ Detecção automática do tipo de contrato (boleto/crédito)
- ✅ Envio para ZapSign com assinaturas posicionadas
- ✅ Consulta de status
- ✅ Cancelamento de contrato
- ✅ Registro local em arquivo (TXT)

## Tecnologias

- Node.js 18+
- Express 5
- Axios (HTTP client)
- Multer (upload de arquivos)
- pdf-parse-fork (extração de PDF)

## Como rodar

### Pré-requisitos
- Node.js 18 ou superior
- Conta na ZapSign com token de API

### Instalação

```bash
# 1. Clonar o repositório
git clone [URL_DESSE_REPOSITORIO]
cd zapsign-api

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env e adicione seu token da ZapSign

# 4. Rodar em desenvolvimento
npm run dev

# Ou em produção
npm start
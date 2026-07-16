/**
 * SERVICE DE INTEGRAÇÃO COM A ZAPSIGN
 * 
 * Toda comunicação com a API da ZapSign passa por aqui.
 * Funções disponíveis:
 * - criarDocumento: envia PDF + configura signatário + posiciona assinaturas
 * - consultarDocumento: consulta status de um documento
 * - cancelarDocumento: cancela (recusa) um documento via POST /refuse/
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// ============================================
// VALIDAÇÃO E CONFIGURAÇÃO
// ============================================

if (!process.env.ZAPSIGN_API_URL) {
    throw new Error('❌ ZAPSIGN_API_URL não configurada no .env');
}
if (!process.env.ZAPSIGN_API_TOKEN) {
    throw new Error('❌ ZAPSIGN_API_TOKEN não configurado no .env');
}

const zapsignApi = axios.create({
    baseURL: process.env.ZAPSIGN_API_URL,
    headers: {
        'Authorization': `Bearer ${process.env.ZAPSIGN_API_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

// ============================================
// FUNÇÕES PRINCIPAIS
// ============================================

/**
 * Cria um documento na ZapSign a partir de um PDF.
 * 
 * 1. Monta payload com signatário e configurações
 * 2. Envia pra ZapSign
 * 3. Adiciona campos de assinatura (rubricas) nas posições configuradas
 */
async function criarDocumento({ caminhoArquivo, nomeArquivo, nomeDocumento, signatario, configuracao }) {
    try {
        console.log('📤 Preparando upload para ZapSign...');

        const arquivoBuffer = fs.readFileSync(caminhoArquivo);
        const arquivoBase64 = arquivoBuffer.toString('base64');

        const payload = {
            name: nomeDocumento,
            base64_pdf: arquivoBase64,
            lang: "pt-br",
            disable_signer_emails: true,                        // Não envia email automático pro cliente
            signature_order_active: false,                      // Sem ordem de assinatura
            allow_refuse_signature: true,                       // Permite recusar
            refuse_reason_required: false,                      // Motivo da recusa não é obrigatório
            disable_signer_refusal: false,                      // Não desabilita recusa
            min_refuse_reason_length: 0,                        // Tamanho mínimo do motivo
             date_limit_to_sign: gerarDataLimite(1),            // ⏰ Produção: 1 dia
            //date_limit_to_sign: gerarDataLimiteMinutos(15),   // 🧪 Teste: 15 minutos
            signers: [montarSignatario(signatario, configuracao)]
        };

        console.log('📡 Enviando para ZapSign...');
        console.log(`   Documento: ${nomeDocumento}`);
        console.log(`   Signatário: ${signatario.nome} (${mascarar(signatario.email || signatario.telefone)})`);
        console.log(`   Data limite: ${payload.date_limit_to_sign}`);

        const response = await zapsignApi.post('/docs/', payload);
        const documento = response.data;

        console.log(`✅ Documento criado! Token: ${documento.token}`);

        // Adiciona campos de assinatura nas posições configuradas em contratos.js
        if (configuracao.campos_assinatura?.length > 0) {
            console.log(`📝 Adicionando ${configuracao.campos_assinatura.length} campos de assinatura...`);
            await adicionarCamposAssinatura(
                documento.token,
                documento.signers[0].token,
                configuracao.campos_assinatura
            );
            console.log('✅ Campos de assinatura adicionados!');
        }

        return documento;

    } catch (error) {
        console.error('❌ Erro na ZapSign:');
        console.error('   Status:', error.response?.status);
        console.error('   Mensagem:', error.response?.data?.message || error.message);
        throw error;
    }
}

/**
 * Consulta um documento na ZapSign pelo token.
 */
async function consultarDocumento(token) {
    try {
        const response = await zapsignApi.get(`/docs/${token}/`);
        return response.data;
    } catch (error) {
        if (error.response?.status !== 404) {
            console.error('❌ Erro ao consultar:', error.response?.data || error.message);
        }
        throw error;
    }
}

/**
 * Cancela (recusa) um documento na ZapSign.
 * Endpoint: POST /refuse/
 * O documento fica com status "recusado" e marca d'água no PDF.
 */
async function cancelarDocumento(token, motivo, notificarSignatarios = false) {
    try {
        console.log(`🚫 Cancelando documento ${token}...`);

        const response = await zapsignApi.post('/refuse/', {
            doc_token: token,
            rejected_reason: motivo,
            notify_signer: notificarSignatarios
        });

        console.log(`✅ Documento cancelado!`);
        return response.data;

    } catch (error) {
        console.error('❌ Erro ao cancelar:');
        console.error('   Status:', error.response?.status);
        console.error('   Mensagem:', error.response?.data?.message || error.message);
        throw error;
    }
}

// ============================================
// FUNÇÕES AUXILIARES (uso interno)
// ============================================

/**
 * Monta o objeto do signatário baseado nos dados disponíveis.
 * Trava campos preenchidos (nome, email, telefone) pra não editar.
 * Esconde campos vazios pra não confundir o cliente.
 */
function montarSignatario(signatario, configuracao) {
    const temEmail = !!signatario.email;
    const temTelefone = !!signatario.telefone;

    const obj = {
        name: signatario.nome,
        lock_name: true,
        auth_mode: "assinaturaTela",
        require_selfie_photo: configuracao.autenticacao.require_selfie_photo,
        require_document_photo: configuracao.autenticacao.require_document_photo,
        selfie_validation_type: configuracao.autenticacao.selfie_validation_type,
        allow_refuse: true,
        send_automatic_email: false,
        send_automatic_whatsapp: false
    };

    // Email: mostra e trava se tem, esconde se não tem
    if (temEmail) {
        obj.email = signatario.email;
        obj.lock_email = true;
        obj.hide_email = false;
    } else {
        obj.email = "";
        obj.hide_email = true;
        obj.blank_email = true;
    }

    // Telefone: mostra e trava se tem, esconde se não tem
    if (temTelefone) {
        obj.phone_country = "55";
        obj.phone_number = signatario.telefone;
        obj.lock_phone = true;
        obj.hide_phone = false;
    } else {
        obj.phone_country = "55";
        obj.phone_number = "";
        obj.hide_phone = true;
        obj.blank_phone = true;
    }

    // Canal de envio (email tem prioridade)
    if (temEmail) obj.send_via = "email";
    else if (temTelefone) obj.send_via = "whatsapp";

    return obj;
}

/**
 * Adiciona campos de assinatura (rubricas) por coordenadas.
 * As posições vêm do contratos.js.
 */
async function adicionarCamposAssinatura(tokenDocumento, tokenSignatario, campos) {
    const rubricas = campos.map(campo => ({
        page: campo.page,
        relative_position_bottom: campo.relative_position_y,
        relative_position_left: campo.relative_position_x,
        relative_size_x: campo.relative_size_x,
        relative_size_y: campo.relative_size_y,
        type: campo.type,
        signer_token: tokenSignatario
    }));

    try {
        const response = await zapsignApi.post(
            `/docs/${tokenDocumento}/place-signatures/`,
            { rubricas }
        );
        return response.data;
    } catch (error) {
        console.error('❌ Erro ao adicionar rubricas:');
        console.error('   Status:', error.response?.status);
        console.error('   Mensagem:', error.response?.data?.message || error.message);
        throw error;
    }
}

/**
 * Mascara dados sensíveis nos logs.
 * joao@email.com → jo***@email.com
 * 14996872275 → 1499***2275
 */
function mascarar(valor) {
    if (!valor) return 'N/A';
    if (valor.length < 4) return '***';

    if (valor.includes('@')) {
        const [user, domain] = valor.split('@');
        return `${user.substring(0, 2)}***@${domain}`;
    }

    return `${valor.substring(0, 4)}***${valor.substring(valor.length - 4)}`;
}

/**
 * Gera data limite pra assinar em X dias.
 * Usado em produção.
 */
function gerarDataLimite(dias) {
    const data = new Date();
    data.setDate(data.getDate() + dias);
    return data.toISOString();
}

/**
 * Gera data limite pra assinar em X minutos.
 * Usado em testes.
 */
function gerarDataLimiteMinutos(minutos) {
    const data = new Date();
    data.setMinutes(data.getMinutes() + minutos);
    return data.toISOString();
}

// ============================================
// EXPORTAÇÕES
// ============================================

module.exports = {
    criarDocumento,
    consultarDocumento,
    cancelarDocumento
};
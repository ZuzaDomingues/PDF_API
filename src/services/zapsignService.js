/**
 * Importações
 */
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// === VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ===
if (!process.env.ZAPSIGN_API_URL) {
    throw new Error('❌ Variável de ambiente ZAPSIGN_API_URL não configurada. Verifique seu .env');
}
if (!process.env.ZAPSIGN_API_TOKEN) {
    throw new Error('❌ Variável de ambiente ZAPSIGN_API_TOKEN não configurada. Verifique seu .env');
}

// Cliente HTTP configurado
const zapsignApi = axios.create({
    baseURL: process.env.ZAPSIGN_API_URL,
    headers: {
        'Authorization': `Bearer ${process.env.ZAPSIGN_API_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Cria um documento na ZapSign a partir de um PDF
 */
async function criarDocumento({
    caminhoArquivo,
    nomeArquivo,
    nomeDocumento,
    signatario,
    configuracao
}) {
    try {
        console.log('📤 Preparando upload para ZapSign...');

        const arquivoBuffer = fs.readFileSync(caminhoArquivo);
        const arquivoBase64 = arquivoBuffer.toString('base64');

        const payload = {
            name: nomeDocumento,
            base64_pdf: arquivoBase64,
            lang: "pt-br",
            disable_signer_emails: false,
            signature_order_active: false,

            // Configurações de recusa pelo signatário
            allow_refuse_signature: true,
            refuse_reason_required: false,
            disable_signer_refusal: false,
            min_refuse_reason_length: 0,

            signers: [montarSignatario(signatario, configuracao)]
        };

        console.log('📡 Enviando para ZapSign...');
        console.log(`   Documento: ${nomeDocumento}`);
        console.log(`   Signatário: ${signatario.nome} (${mascarar(signatario.email || signatario.telefone)})`);
        console.log(`   Selfie: ${configuracao.autenticacao.require_selfie_photo ? 'SIM' : 'NÃO'}`);
        console.log(`   Documento (RG): ${configuracao.autenticacao.require_document_photo ? 'SIM' : 'NÃO'}`);

        const response = await zapsignApi.post('/docs/', payload);
        const documento = response.data;

        console.log(`✅ Documento criado! Token: ${documento.token}`);

        if (configuracao.campos_assinatura && configuracao.campos_assinatura.length > 0) {
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
 * Monta o objeto do signatário
 * Decide os canais baseado nos dados disponíveis
 */
function montarSignatario(signatario, configuracao) {
    const temEmail = !!signatario.email;
    const temTelefone = !!signatario.telefone;

    const signatarioObj = {
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

    if (temEmail) {
        signatarioObj.email = signatario.email;
        signatarioObj.lock_email = true;
        signatarioObj.hide_email = false;
    } else {
        signatarioObj.email = "";
        signatarioObj.hide_email = true;
        signatarioObj.blank_email = true;
    }

    if (temTelefone) {
        signatarioObj.phone_country = "55";
        signatarioObj.phone_number = signatario.telefone;
        signatarioObj.lock_phone = true;
        signatarioObj.hide_phone = false;
    } else {
        signatarioObj.phone_country = "55";
        signatarioObj.phone_number = "";
        signatarioObj.hide_phone = true;
        signatarioObj.blank_phone = true;
    }

    if (temEmail) {
        signatarioObj.send_via = "email";
    } else if (temTelefone) {
        signatarioObj.send_via = "whatsapp";
    }

    return signatarioObj;
}

/**
 * Adiciona campos de assinatura (rubricas) por coordenadas
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

    const payload = { rubricas };

    try {
        const response = await zapsignApi.post(
            `/docs/${tokenDocumento}/place-signatures/`,
            payload
        );
        console.log(`✅ ${rubricas.length} rubricas adicionadas com sucesso!`);
        return response.data;
    } catch (error) {
        console.error(`❌ Erro ao adicionar rubricas:`);
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Mensagem: ${error.response?.data?.message || error.message}`);
        throw error;
    }
}

/**
 * Consulta um documento
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
 * 🚫 Cancela um documento na ZapSign
 * Endpoint: POST /refuse/
 * O documento fica com status "recusado" e não pode mais ser assinado
 * Adiciona marca d'água "Documento recusado" no PDF
 * 
 * @param {string} token - Token do documento
 * @param {string} motivo - Motivo do cancelamento (obrigatório)
 * @param {boolean} notificarSignatarios - Se true, notifica os signatários por email
 * @returns {Promise<Object>} - Resposta da ZapSign
 */
async function cancelarDocumento(token, motivo, notificarSignatarios = false) {
    try {
        console.log(`\n🚫 Cancelando documento ${token}...`);
        console.log(`   Motivo: ${motivo}`);
        console.log(`   Notificar signatários: ${notificarSignatarios ? 'SIM' : 'NÃO'}`);

        const payload = {
            doc_token: token,
            rejected_reason: motivo,
            notify_signer: notificarSignatarios
        };

        const response = await zapsignApi.post('/refuse/', payload);

        console.log(`✅ Documento cancelado com sucesso!`);
        console.log(`   Status HTTP: ${response.status}`);
        console.log(`   Resposta:`, JSON.stringify(response.data, null, 2));

        return response.data;

    } catch (error) {
        console.error('❌ Erro ao cancelar documento:');
        console.error('   Status:', error.response?.status);
        console.error('   Mensagem:', error.response?.data?.message || error.message);
        console.error('   Detalhes:', JSON.stringify(error.response?.data, null, 2));
        throw error;
    }
}

/**
 * 🗑️ Deleta um documento na ZapSign (DELETE /docs/{token}/)
 * ATENÇÃO: Remove o documento PERMANENTEMENTE!
 * Use cancelarDocumento se quiser apenas cancelar sem remover.
 */
async function deletarDocumento(token) {
    try {
        console.log(`🗑️  Deletando documento ${token}...`);

        const response = await zapsignApi.delete(`/docs/${token}/`);

        console.log(`✅ Documento deletado com sucesso!`);
        return response.data || { sucesso: true };

    } catch (error) {
        console.error('❌ Erro ao deletar documento:');
        console.error('   Status:', error.response?.status);
        console.error('   Mensagem:', error.response?.data?.message || error.message);
        throw error;
    }
}

/**
 * Mascara dados sensíveis para logs (LGPD)
 */
function mascarar(valor) {
    if (!valor) return 'N/A';
    if (valor.length < 4) return '***';

    if (valor.includes('@')) {
        const [user, domain] = valor.split('@');
        const inicio = user.substring(0, 2);
        return `${inicio}***@${domain}`;
    }

    const inicio = valor.substring(0, 4);
    const fim = valor.substring(valor.length - 4);
    return `${inicio}***${fim}`;
}

module.exports = {
    criarDocumento,
    consultarDocumento,
    cancelarDocumento,   // 🆕 POST /cancel/ - cancela mantendo no sistema
    deletarDocumento     // 🆕 DELETE - remove permanentemente
};
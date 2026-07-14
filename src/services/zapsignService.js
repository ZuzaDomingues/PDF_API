/**
 * SERVICE DE INTEGRAÇÃO COM A ZAPSIGN
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Validação de variáveis de ambiente
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
async function criarDocumento({ caminhoArquivo, nomeArquivo, nomeDocumento, signatario, configuracao }) {
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
            allow_refuse_signature: true,
            refuse_reason_required: false,
            disable_signer_refusal: false,
            min_refuse_reason_length: 0,
            signers: [montarSignatario(signatario, configuracao)]
        };

        console.log('📡 Enviando para ZapSign...');
        console.log(`   Documento: ${nomeDocumento}`);
        console.log(`   Signatário: ${signatario.nome} (${mascarar(signatario.email || signatario.telefone)})`);

        const response = await zapsignApi.post('/docs/', payload);
        const documento = response.data;

        console.log(`✅ Documento criado! Token: ${documento.token}`);

        // Adiciona campos de assinatura
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
 * Monta o objeto do signatário baseado nos dados disponíveis
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

    // Email
    if (temEmail) {
        signatarioObj.email = signatario.email;
        signatarioObj.lock_email = true;
        signatarioObj.hide_email = false;
    } else {
        signatarioObj.email = "";
        signatarioObj.hide_email = true;
        signatarioObj.blank_email = true;
    }

    // Telefone
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

    // Canal de envio
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

    try {
        const response = await zapsignApi.post(
            `/docs/${tokenDocumento}/place-signatures/`,
            { rubricas }
        );
        return response.data;
    } catch (error) {
        console.error(`❌ Erro ao adicionar rubricas:`);
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Mensagem: ${error.response?.data?.message || error.message}`);
        throw error;
    }
}

/**
 * Consulta um documento na ZapSign
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
 * Cancela um documento na ZapSign
 * Endpoint: POST /refuse/
 */
async function cancelarDocumento(token, motivo, notificarSignatarios = false) {
    try {
        console.log(`\n🚫 Cancelando documento ${token}...`);

        const payload = {
            doc_token: token,
            rejected_reason: motivo,
            notify_signer: notificarSignatarios
        };

        const response = await zapsignApi.post('/refuse/', payload);

        console.log(`✅ Documento cancelado com sucesso!`);
        return response.data;

    } catch (error) {
        console.error('❌ Erro ao cancelar documento:');
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
        return `${user.substring(0, 2)}***@${domain}`;
    }

    const inicio = valor.substring(0, 4);
    const fim = valor.substring(valor.length - 4);
    return `${inicio}***${fim}`;
}

module.exports = {
    criarDocumento,
    consultarDocumento,
    cancelarDocumento
};
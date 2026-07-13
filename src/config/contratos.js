/**
 * PADRONIZAÇÃO DOS CONTRATOS
 * 
 * TODAS as regras de cada tipo de contrato.
 * Se houver a necessidade de alterar algo (posições/autenticação), deve ser alterado
 * nesse documento.
 */

const CONFIGURACOES_CONTRATOS = {
    boleto: {
        nome_prefixo: "Contrato Boleto",
        
        autenticacao: {
            require_selfie_photo: false,
            require_document_photo: false,
            selfie_validation_type: "none" // "none", "liveness" ou "liveness-document-match"
        },
        
        campos_assinatura: [
            // === PÁGINA 1 ===
            { page: 0, relative_position_x: 70, relative_position_y: 63, relative_size_x: 18, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 57, relative_position_y: 56, relative_size_x: 15, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 73, relative_position_y: 48, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 63, relative_position_y: 24, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            // === PÁGINA 2 ===
            { page: 1, relative_position_x: 63, relative_position_y: 85, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 1, relative_position_x: 53, relative_position_y: 41, relative_size_x: 20, relative_size_y: 5, type: "signature" }
        ]
    },
    
    credito: {
        nome_prefixo: "Contrato Crédito",
        
        autenticacao: {
            require_selfie_photo: false,
            require_document_photo: false,
            selfie_validation_type: "none"
        },
        
        campos_assinatura: [
            // === PÁGINA 1 ===
            { page: 0, relative_position_x: 70, relative_position_y: 63, relative_size_x: 18, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 57, relative_position_y: 57, relative_size_x: 15, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 74, relative_position_y: 49, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 78, relative_position_y: 36, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 0, relative_position_x: 58, relative_position_y: 22, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            // === PÁGINA 2 ===
            { page: 1, relative_position_x: 64, relative_position_y: 85, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 1, relative_position_x: 54, relative_position_y: 80, relative_size_x: 20, relative_size_y: 5, type: "signature" },
            { page: 1, relative_position_x: 55, relative_position_y: 36, relative_size_x: 20, relative_size_y: 5, type: "signature" }
        ]
    }
};

function obterConfiguracao(tipo) {
    if (!tipo || typeof tipo !== 'string') {
        throw new Error('Tipo de contrato não informado.');
    }
    
    const config = CONFIGURACOES_CONTRATOS[tipo.toLowerCase()];
    
    if (!config) {
        const tiposDisponiveis = Object.keys(CONFIGURACOES_CONTRATOS).join(', ');
        throw new Error(`Tipo de contrato inválido: "${tipo}". Tipos disponíveis: ${tiposDisponiveis}.`);
    }
    
    return config;
}

function listarTipos() {
    return Object.keys(CONFIGURACOES_CONTRATOS);
}

module.exports = {
    CONFIGURACOES_CONTRATOS,
    obterConfiguracao,
    listarTipos
};
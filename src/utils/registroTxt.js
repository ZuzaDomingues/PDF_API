/**
 * REGISTRO EM ARQUIVOS TXT
 * 
 * Grava dados dos contratos em arquivos TXT (simulando um banco de dados).
 * Formato: JSON por linha (JSONL - JSON Lines)
 * 
 * Estrutura:
 * - contratos.txt   → dados principais dos contratos
 * - historico.txt   → eventos (criado, cancelado, assinado, etc)
 */

const fs = require('fs');
const path = require('path');

// Pasta onde os arquivos serão salvos
const PASTA_DADOS = path.join(__dirname, '..', '..', 'dados');
const ARQUIVO_CONTRATOS = path.join(PASTA_DADOS, 'contratos.txt');
const ARQUIVO_HISTORICO = path.join(PASTA_DADOS, 'historico.txt');

// Garante que a pasta existe
if (!fs.existsSync(PASTA_DADOS)) {
    fs.mkdirSync(PASTA_DADOS, { recursive: true });
    console.log(`📁 Pasta "dados/" criada automaticamente.`);
}

/**
 * Gera um ID auto-incrementado baseado no arquivo
 */
function gerarProximoId(caminhoArquivo) {
    if (!fs.existsSync(caminhoArquivo)) {
        return 1;
    }
    
    try {
        const conteudo = fs.readFileSync(caminhoArquivo, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        
        if (linhas.length === 0) return 1;
        
        // Pega o último ID e adiciona 1
        const ultimaLinha = JSON.parse(linhas[linhas.length - 1]);
        return (ultimaLinha.id || 0) + 1;
        
    } catch (error) {
        console.error('⚠️ Erro ao ler ID:', error.message);
        return 1;
    }
}

// ============================================================
// TABELA: CONTRATOS
// ============================================================

/**
 * Grava um novo contrato no arquivo contratos.txt
 * @param {Object} dados - Dados do contrato
 * @returns {Object} - Contrato gravado (com ID)
 */
function gravarContrato(dados) {
    try {
        const agora = new Date().toISOString();
        
        const contrato = {
            id: gerarProximoId(ARQUIVO_CONTRATOS),
            codigo_cliente: dados.codigo_cliente || null,
            nome_cliente: dados.nome_cliente || null,
            email_cliente: dados.email_cliente || null,
            telefone_cliente: dados.telefone_cliente || null,
            tipo_contrato: dados.tipo_contrato || null,
            nome_documento: dados.nome_documento || null,
            token_zapsign: dados.token_zapsign || null,
            link_assinatura: dados.link_assinatura || null,
            nome_veio_do_body: dados.nome_veio_do_body || false,
            email_veio_do_body: dados.email_veio_do_body || false,
            telefone_veio_do_body: dados.telefone_veio_do_body || false,
            tipo_veio_do_body: dados.tipo_veio_do_body || false,
            status_atual: dados.status_atual || 'pending',
            criado_em: agora,
            atualizado_em: agora
        };
        
        // Grava como JSON em uma linha (JSONL)
        const linha = JSON.stringify(contrato) + '\n';
        fs.appendFileSync(ARQUIVO_CONTRATOS, linha, 'utf-8');
        
        console.log(`💾 Contrato #${contrato.id} gravado em contratos.txt`);
        return contrato;
        
    } catch (error) {
        console.error('❌ Erro ao gravar contrato:', error.message);
        throw error;
    }
}

/**
 * Busca um contrato pelo token da ZapSign
 * @param {string} token - Token do documento
 * @returns {Object|null} - Contrato encontrado ou null
 */
function buscarContratoPorToken(token) {
    if (!fs.existsSync(ARQUIVO_CONTRATOS)) {
        return null;
    }
    
    try {
        const conteudo = fs.readFileSync(ARQUIVO_CONTRATOS, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        
        for (const linha of linhas) {
            const contrato = JSON.parse(linha);
            if (contrato.token_zapsign === token) {
                return contrato;
            }
        }
        
        return null;
    } catch (error) {
        console.error('❌ Erro ao buscar contrato:', error.message);
        return null;
    }
}

/**
 * Atualiza o status de um contrato
 * @param {string} token - Token do documento
 * @param {string} novoStatus - Novo status
 * @returns {boolean} - true se atualizou, false se não achou
 */
function atualizarStatusContrato(token, novoStatus) {
    if (!fs.existsSync(ARQUIVO_CONTRATOS)) {
        return false;
    }
    
    try {
        const conteudo = fs.readFileSync(ARQUIVO_CONTRATOS, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        let atualizou = false;
        
        const linhasAtualizadas = linhas.map(linha => {
            const contrato = JSON.parse(linha);
            if (contrato.token_zapsign === token) {
                contrato.status_atual = novoStatus;
                contrato.atualizado_em = new Date().toISOString();
                atualizou = true;
                console.log(`💾 Contrato #${contrato.id} atualizado: status = ${novoStatus}`);
            }
            return JSON.stringify(contrato);
        });
        
        if (atualizou) {
            fs.writeFileSync(ARQUIVO_CONTRATOS, linhasAtualizadas.join('\n') + '\n', 'utf-8');
        }
        
        return atualizou;
    } catch (error) {
        console.error('❌ Erro ao atualizar contrato:', error.message);
        return false;
    }
}

/**
 * Lista todos os contratos
 */
function listarContratos() {
    if (!fs.existsSync(ARQUIVO_CONTRATOS)) {
        return [];
    }
    
    try {
        const conteudo = fs.readFileSync(ARQUIVO_CONTRATOS, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        return linhas.map(linha => JSON.parse(linha));
    } catch (error) {
        console.error('❌ Erro ao listar contratos:', error.message);
        return [];
    }
}

// ============================================================
// TABELA: HISTORICO
// ============================================================

/**
 * Grava um evento no arquivo historico.txt
 * @param {Object} dados - Dados do evento
 * @returns {Object} - Evento gravado (com ID)
 */
function gravarHistorico(dados) {
    try {
        const evento = {
            id: gerarProximoId(ARQUIVO_HISTORICO),
            contrato_id: dados.contrato_id || null,
            token_zapsign: dados.token_zapsign || null,
            tipo_evento: dados.tipo_evento || null,
            dados_evento: dados.dados_evento || null,
            motivo: dados.motivo || null,
            data_evento: new Date().toISOString()
        };
        
        const linha = JSON.stringify(evento) + '\n';
        fs.appendFileSync(ARQUIVO_HISTORICO, linha, 'utf-8');
        
        console.log(`💾 Evento #${evento.id} (${evento.tipo_evento}) gravado em historico.txt`);
        return evento;
        
    } catch (error) {
        console.error('❌ Erro ao gravar histórico:', error.message);
        throw error;
    }
}

/**
 * Busca todo o histórico de um contrato pelo token
 */
function buscarHistoricoPorToken(token) {
    if (!fs.existsSync(ARQUIVO_HISTORICO)) {
        return [];
    }
    
    try {
        const conteudo = fs.readFileSync(ARQUIVO_HISTORICO, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        
        return linhas
            .map(linha => JSON.parse(linha))
            .filter(evento => evento.token_zapsign === token);
    } catch (error) {
        console.error('❌ Erro ao buscar histórico:', error.message);
        return [];
    }
}

/**
 * Lista todos os eventos
 */
function listarHistorico() {
    if (!fs.existsSync(ARQUIVO_HISTORICO)) {
        return [];
    }
    
    try {
        const conteudo = fs.readFileSync(ARQUIVO_HISTORICO, 'utf-8');
        const linhas = conteudo.split('\n').filter(l => l.trim() !== '');
        return linhas.map(linha => JSON.parse(linha));
    } catch (error) {
        console.error('❌ Erro ao listar histórico:', error.message);
        return [];
    }
}

module.exports = {
    // Contratos
    gravarContrato,
    buscarContratoPorToken,
    atualizarStatusContrato,
    listarContratos,
    // Histórico
    gravarHistorico,
    buscarHistoricoPorToken,
    listarHistorico
};
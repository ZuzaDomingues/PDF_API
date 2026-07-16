const { pool } = require('./conexao');

// ============================================
// TABELA: Contratos
// ============================================

async function inserirContrato(dados) {
    try {
        const sql = `
            INSERT INTO Geogrid.ZapSign_Contratos (
                codigo_cliente, nome_cliente, email_cliente, telefone_cliente,
                tipo_contrato, token_zapsign, link_assinatura, documento_assinado,
                nome_digitado, email_digitado, telefone_digitado, tipo_digitado,
                status_atual, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        
        const valores = [
            dados.codigo_cliente || null,
            dados.nome_cliente,
            dados.email_cliente || null,
            dados.telefone_cliente || null,
            dados.tipo_contrato,
            dados.token_zapsign,
            dados.link_assinatura || null,      
            dados.documento_assinado || null,   
            dados.nome_digitado || false,
            dados.email_digitado || false,
            dados.telefone_digitado || false,
            dados.tipo_digitado || false,
            dados.status_atual || 'pending'
        ];
        
        const [resultado] = await pool.execute(sql, valores);
        console.log(`💾 Contrato #${resultado.insertId} inserido no banco`);
        
        return { id: resultado.insertId, ...dados };
    } catch (error) {
        console.error('❌ Erro ao inserir contrato:', error.message);
        throw error;
    }
}

/**
 * Atualiza a URL do documento assinado
 */

async function atualizarDocumentoAssinado(token, urlPdfAssinado) {
    try {
        const sql = 'UPDATE Geogrid.ZapSign_Contratos SET documento_assinado = ?, atualizado_em = NOW() WHERE token_zapsign = ?';
        const [resultado] = await pool.execute(sql, [urlPdfAssinado, token]);
        
        if (resultado.affectedRows > 0) {
            console.log(`💾 Documento assinado salvo`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Erro ao atualizar documento assinado:', error.message);
        throw error;
    }
}

async function buscarContratoPorToken(token) {
    try {
        const sql = 'SELECT * FROM Geogrid.ZapSign_Contratos WHERE token_zapsign = ? LIMIT 1';
        const [linhas] = await pool.execute(sql, [token]);
        return linhas.length > 0 ? linhas[0] : null;
    } catch (error) {
        console.error('❌ Erro ao buscar contrato:', error.message);
        throw error;
    }
}

async function atualizarStatusContrato(token, novoStatus) {
    try {
        const sql = 'UPDATE Geogrid.ZapSign_Contratos SET status_atual = ?, atualizado_em = NOW() WHERE token_zapsign = ?';
        const [resultado] = await pool.execute(sql, [novoStatus, token]);
        
        if (resultado.affectedRows > 0) {
            console.log(`💾 Contrato atualizado: status = ${novoStatus}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Erro ao atualizar contrato:', error.message);
        throw error;
    }
}

// ============================================
// TABELA: Historico
// ============================================

async function inserirHistorico(dados) {
    try {
        const sql = `
            INSERT INTO Geogrid.ZapSign_Historico (
                key_contratos, key_webhook, motivo, data_evento
            ) VALUES (?, ?, ?, ?)
        `;
        
        const valores = [
            dados.contrato_id || null,
            dados.webhook_id || null,
            dados.motivo || null,
            dados.data_evento || new Date()
        ];
        
        const [resultado] = await pool.execute(sql, valores);
        console.log(`💾 Evento #${resultado.insertId} inserido no histórico (key_webhook: ${dados.webhook_id || 'null'})`);
        
        return { id: resultado.insertId, ...dados };
    } catch (error) {
        console.error('❌ Erro ao inserir histórico:', error.message);
        throw error;
    }
}

/**
 * Busca todos os webhooks de um contrato
 */
async function buscarWebhooksPorToken(token) {
    try {
        const sql = `
            SELECT id, Tipo, Json, DataCadastro
            FROM ERP.TabWebhook_Zapsign 
            WHERE JSON_EXTRACT(Json, "$.token") = ?
            ORDER BY id ASC
        `;
        const [linhas] = await pool.execute(sql, [token]);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar webhooks:', error.message);
        throw error;
    }
}

/**
 * Verifica se um webhook já foi vinculado ao histórico
 */
async function webhookJaNoHistorico(webhookId) {
    try {
        const sql = 'SELECT id FROM Geogrid.ZapSign_Historico WHERE key_webhook = ? LIMIT 1';
        const [linhas] = await pool.execute(sql, [webhookId]);
        return linhas.length > 0;
    } catch (error) {
        console.error('❌ Erro ao verificar webhook no histórico:', error.message);
        return false;
    }
}

/**
 * Busca histórico completo com os dados dos webhooks
 */
async function buscarHistoricoCompletoPorToken(token) {
    try {
        const sql = `
            SELECT 
                h.id,
                h.key_contratos,
                h.key_webhook,
                h.motivo,
                h.data_evento,
                w.Tipo as tipo_evento,
                w.Json as dados_evento
            FROM Geogrid.ZapSign_Historico h
            LEFT JOIN Geogrid.ZapSign_Contratos c ON h.key_contratos = c.id
            LEFT JOIN ERP.TabWebhook_Zapsign w ON h.key_webhook = w.id
            WHERE c.token_zapsign = ?
            ORDER BY h.data_evento ASC
        `;
        const [linhas] = await pool.execute(sql, [token]);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar histórico completo:', error.message);
        throw error;
    }
}

/**
 * Busca contratos por termo (nome, email, telefone ou código)
 */
async function buscarContratos(termo, limite = 50) {
    try {
        const termoLike = `%${termo}%`;
        
        const sql = `
            SELECT * FROM Geogrid.ZapSign_Contratos 
            WHERE nome_cliente LIKE ? 
               OR email_cliente LIKE ? 
               OR telefone_cliente LIKE ?
               OR codigo_cliente LIKE ?
            ORDER BY criado_em DESC
            LIMIT ?
        `;
        
        const [linhas] = await pool.execute(sql, [
            termoLike, termoLike, termoLike, termoLike, limite
        ]);
        
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar contratos:', error.message);
        throw error;
    }
}

/**
 * Busca histórico de varios contratos de uma vez
 */
async function buscarHistoricoMultiplos(contratosIds) {
    if (!contratosIds || contratosIds.length === 0) return [];
    
    try {
        const placeholders = contratosIds.map(() => '?').join(',');
        
        const sql = `
            SELECT 
                h.id,
                h.key_contratos,
                h.key_webhook,
                h.motivo,
                h.data_evento,
                w.Tipo as tipo_evento
            FROM Geogrid.ZapSign_Historico h
            LEFT JOIN ERP.TabWebhook_Zapsign w ON h.key_webhook = w.id
            WHERE h.key_contratos IN (${placeholders})
            ORDER BY h.key_contratos, h.data_evento ASC
        `;
        
        const [linhas] = await pool.execute(sql, contratosIds);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar histórico múltiplo:', error.message);
        throw error;
    }
}

async function buscarContratosPorNome(nome) {
    try {
        const nomeLike = `%${nome}%`;
        const sql = `
            SELECT * FROM Geogrid.ZapSign_Contratos 
            WHERE nome_cliente LIKE ?
            ORDER BY criado_em DESC
        `;
        const [linhas] = await pool.execute(sql, [nomeLike]);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar contratos por nome:', error.message);
        throw error;
    }
}

/**
 * Retorna clientes
 * Com status do contrato mais recente
 */
async function listarClientesResumo() {
    try {
        const sql = `
            SELECT 
                nome_cliente,
                codigo_cliente,
                email_cliente,
                telefone_cliente,
                COUNT(*) as total_contratos,
                MAX(criado_em) as ultimo_contrato_em
            FROM Geogrid.ZapSign_Contratos 
            GROUP BY nome_cliente, codigo_cliente, email_cliente, telefone_cliente
            ORDER BY ultimo_contrato_em DESC
            LIMIT 200
        `;
        const [linhas] = await pool.execute(sql);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao listar clientes:', error.message);
        throw error;
    }
}

/**
 * Lista TODOS os contratos
 */
async function listarTodosContratos(limite = 200) {
    try {
        const limiteSeguro = parseInt(limite) || 200;
        const sql = `
            SELECT * FROM Geogrid.ZapSign_Contratos 
            ORDER BY criado_em DESC 
            LIMIT ${limiteSeguro}
        `;
        const [linhas] = await pool.execute(sql);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao listar contratos:', error.message);
        throw error;
    }
}

/**
 * Busca contratos por períodos
 * Data inicial e Data final
 */
async function buscarContratosPorPeriodo(dataInicio, dataFim) {
    try {
        const sql = `
            SELECT * FROM Geogrid.ZapSign_Contratos 
            WHERE criado_em >= ? 
              AND criado_em <= ?
            ORDER BY criado_em DESC
        `;
        const [linhas] = await pool.execute(sql, [dataInicio, dataFim]);
        return linhas;
    } catch (error) {
        console.error('❌ Erro ao buscar contratos por período:', error.message);
        throw error;
    }
}

module.exports = {
    inserirContrato,
    buscarContratoPorToken,
    atualizarStatusContrato,
    atualizarDocumentoAssinado,
    inserirHistorico,
    buscarWebhooksPorToken,
    webhookJaNoHistorico,
    buscarHistoricoCompletoPorToken,
    buscarContratos,
    buscarHistoricoMultiplos,
    buscarContratosPorNome, 
    listarClientesResumo,
     listarTodosContratos,
    buscarContratosPorPeriodo
};
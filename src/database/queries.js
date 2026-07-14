/**
 * QUERIES DO BANCO DE DADOS
 */

const { pool } = require('./conexao');

// ============================================
// TABELA: Contratos
// ============================================

async function inserirContrato(dados) {
    try {
        const sql = `
            INSERT INTO Geogrid.ZapSign_Contratos (
                codigo_cliente, nome_cliente, email_cliente, telefone_cliente,
                tipo_contrato, token_zapsign,
                nome_body, email_body, telefone_body, tipo_body,
                status_atual, criado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        
        const valores = [
            dados.codigo_cliente || null,
            dados.nome_cliente,
            dados.email_cliente || null,
            dados.telefone_cliente || null,
            dados.tipo_contrato,
            dados.token_zapsign,
            dados.nome_body || false,
            dados.email_body || false,
            dados.telefone_body || false,
            dados.tipo_body || false,
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
                contratos_id, webhook_id, motivo, data_evento
            ) VALUES (?, ?, ?, ?)
        `;
        
        const valores = [
            dados.contrato_id || null,
            dados.webhook_id || null,
            dados.motivo || null,
            dados.data_evento || new Date()
        ];
        
        const [resultado] = await pool.execute(sql, valores);
        console.log(`💾 Evento #${resultado.insertId} inserido no histórico (webhook_id: ${dados.webhook_id || 'null'})`);
        
        return { id: resultado.insertId, ...dados };
    } catch (error) {
        console.error('❌ Erro ao inserir histórico:', error.message);
        throw error;
    }
}

/**
 * Busca todos os webhooks de um contrato (via token do JSON)
 */
async function buscarWebhooksPorToken(token) {
    try {
        // ⚠️ Ajuste o nome da coluna de data se for diferente!
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
        const sql = 'SELECT id FROM Geogrid.ZapSign_Historico WHERE webhook_id = ? LIMIT 1';
        const [linhas] = await pool.execute(sql, [webhookId]);
        return linhas.length > 0;
    } catch (error) {
        console.error('❌ Erro ao verificar webhook no histórico:', error.message);
        return false;
    }
}

/**
 * Busca histórico completo COM os dados dos webhooks (via JOIN)
 */
async function buscarHistoricoCompletoPorToken(token) {
    try {
        const sql = `
            SELECT 
                h.id,
                h.contratos_id,
                h.webhook_id,
                h.motivo,
                h.data_evento,
                w.Tipo as tipo_evento,
                w.Json as dados_evento
            FROM Geogrid.ZapSign_Historico h
            LEFT JOIN Geogrid.ZapSign_Contratos c ON h.contratos_id = c.id
            LEFT JOIN ERP.TabWebhook_Zapsign w ON h.webhook_id = w.id
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

module.exports = {
    inserirContrato,
    buscarContratoPorToken,
    atualizarStatusContrato,
    inserirHistorico,
    buscarWebhooksPorToken,
    webhookJaNoHistorico,
    buscarHistoricoCompletoPorToken
};
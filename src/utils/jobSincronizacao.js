/**
 * JOB DE SINCRONIZAÇÃO AUTOMÁTICA
 * 
 * Roda em background verificando contratos "pending" e sincronizando
 * novos webhooks automaticamente (assinatura, visualização, etc.)
 */

const db = require('../database/queries');
const { pool } = require('../database/conexao');

// Configurações do job
const INTERVALO_MS = 60 * 1000;  // 1 minuto (60000ms)
const STATUS_FINALIZADOS = ['signed', 'refused', 'canceled', 'deleted', 'expired'];

let jobRodando = false;

/**
 * Descreve o evento baseado no Tipo do webhook
 */
function descreverEvento(tipo) {
    const descricoes = {
        'doc_created': 'Documento criado',
        'doc_viewed': 'Documento visualizado pelo cliente',
        'doc_signed': 'Documento assinado pelo cliente',
        'doc_refused': 'Documento recusado/cancelado',
        'doc_deleted': 'Documento deletado',
        'doc_expired': 'Documento expirado',
        'signature_notification_sent': 'Notificação de assinatura enviada',
        'email_bounced': 'Email não pôde ser entregue',
        'email_read': 'Email lido pelo cliente',
        'criados': 'Documento criado',
        'visualizados': 'Documento visualizado pelo cliente',
        'assinados': 'Documento assinado pelo cliente',
        'recusados': 'Documento recusado/cancelado',
        'deletados': 'Documento deletado',
        'notificacao': 'Notificação enviada',
        'bounce': 'Email não pôde ser entregue',
        'todos': 'Evento genérico'
    };
    return descricoes[tipo] || `Evento: ${tipo}`;
}

/**
 * Determina o novo status do contrato baseado no tipo do webhook
 */
function novoStatusPorEvento(tipo) {
    const tipoLower = (tipo || '').toLowerCase();
    
    if (tipoLower.includes('signed') || tipoLower === 'assinados') return 'signed';
    if (tipoLower.includes('refused') || tipoLower === 'recusados') return 'refused';
    if (tipoLower.includes('deleted') || tipoLower === 'deletados') return 'deleted';
    if (tipoLower.includes('expired') || tipoLower === 'expirados') return 'expired';
    if (tipoLower.includes('viewed') || tipoLower === 'visualizados') return 'link-opened';
    
    return null;
}

/**
 * Sincroniza webhooks de um contrato
 */
async function sincronizarContrato(contrato) {
    try {
        const webhooks = await db.buscarWebhooksPorToken(contrato.token_zapsign);
        
        let novosProcessados = 0;
        let novoStatus = null;

        for (const webhook of webhooks) {
            const jaExiste = await db.webhookJaNoHistorico(webhook.id);
            if (jaExiste) continue;

            const motivo = descreverEvento(webhook.Tipo);

            await db.inserirHistorico({
                contrato_id: contrato.id,
                webhook_id: webhook.id,
                motivo: motivo,
                data_evento: webhook.DataCriacao || new Date()
            });

            // Se este evento indica mudança de status, guarda
            const status = novoStatusPorEvento(webhook.Tipo);
            if (status) novoStatus = status;

            novosProcessados++;
        }

        // Atualiza status do contrato se mudou
        if (novoStatus && novoStatus !== contrato.status_atual) {
            await db.atualizarStatusContrato(contrato.token_zapsign, novoStatus);
            console.log(`   ↳ Status atualizado: ${contrato.status_atual} → ${novoStatus}`);
        }

        return novosProcessados;
        
    } catch (error) {
        console.error(`❌ Erro ao sincronizar contrato ${contrato.id}:`, error.message);
        return 0;
    }
}

/**
 * Executa uma rodada do job
 */
async function executarJob() {
    // Evita rodar 2 vezes ao mesmo tempo
    if (jobRodando) {
        console.log('⏳ Job anterior ainda rodando, pulando esta rodada');
        return;
    }

    jobRodando = true;

    try {
        // Busca só contratos que ainda podem receber webhooks (não finalizados)
        const [contratos] = await pool.execute(
            `SELECT id, token_zapsign, status_atual 
             FROM Geogrid.ZapSign_Contratos 
             WHERE status_atual NOT IN (?, ?, ?, ?, ?)
             ORDER BY criado_em DESC
             LIMIT 100`,
            STATUS_FINALIZADOS
        );

        if (contratos.length === 0) {
            // Nenhum contrato pra verificar, não polui log
            jobRodando = false;
            return;
        }

        console.log(`\n🔄 [JOB] Verificando ${contratos.length} contratos pendentes...`);
        
        let totalSincronizado = 0;
        let contratosAtualizados = 0;

        for (const contrato of contratos) {
            const novos = await sincronizarContrato(contrato);
            if (novos > 0) {
                totalSincronizado += novos;
                contratosAtualizados++;
                console.log(`   ✅ Contrato #${contrato.id}: ${novos} novo(s) evento(s)`);
            }
        }

        if (totalSincronizado > 0) {
            console.log(`✅ [JOB] Concluído: ${contratosAtualizados} contrato(s), ${totalSincronizado} evento(s) sincronizado(s)`);
        }

    } catch (error) {
        console.error('❌ [JOB] Erro:', error.message);
    } finally {
        jobRodando = false;
    }
}

/**
 * Inicia o job (chamado no server.js)
 */
function iniciarJob() {
    console.log(`⏰ Job de sincronização iniciado (a cada ${INTERVALO_MS / 1000}s)`);
    
    // Executa imediatamente uma vez ao iniciar
    executarJob();
    
    // Depois, roda no intervalo configurado
    setInterval(executarJob, INTERVALO_MS);
}

module.exports = {
    iniciarJob,
    executarJob
};
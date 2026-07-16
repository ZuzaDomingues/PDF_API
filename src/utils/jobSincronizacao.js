/**
 * JOB DE SINCRONIZAÇÃO AUTOMÁTICA
 * 
 * Roda em background a cada X segundos verificando:
 * 1. Webhooks novos na tabela webhook_zapsign (assinatura, deleção, etc.)
 * 2. Contratos que expiraram por tempo (verificação local)
 * 
 *   - Busca contratos não-deletados do banco
 *   - Para cada um, sincroniza webhooks novos
 *   - Verifica se expirou localmente
 *   - Atualiza status e salva PDF assinado quando necessário
 */

const db = require('../database/queries');
const { pool } = require('../database/conexao');
const zapsignService = require('../services/zapsignService');

// ============================================
// CONFIGURAÇÕES
// ============================================

const INTERVALO_MS = 60 * 1000;           // Intervalo entre verificações (1 minuto)
// const MINUTOS_ATE_EXPIRAR = 15;        // Teste: 15 minutos
const MINUTOS_ATE_EXPIRAR = 24 * 60;      // Produção: 1 dia (1440 min)

let jobRodando = false; // Evita execuções simultâneas

// ============================================
// FUNÇÕES PRINCIPAIS
// ============================================

/**
 * Executa uma rodada completa da sincronização.
 * Busca todos os contratos não-deletados e processa cada um.
 */
async function executarJob() {
    if (jobRodando) {
        console.log('⏳ Job anterior ainda rodando, pulando esta rodada');
        return;
    }

    jobRodando = true;

    try {
        // Busca contratos que podem ter novidades
        const [contratos] = await pool.execute(
            `SELECT id, token_zapsign, status_atual, criado_em 
             FROM Geogrid.ZapSign_Contratos 
             WHERE status_atual NOT IN ('deleted')
             ORDER BY criado_em DESC
             LIMIT 100`
        );

        if (contratos.length === 0) {
            jobRodando = false;
            return;
        }

        console.log(`\n🔄 [JOB] Verificando ${contratos.length} contratos...`);
        
        let totalSincronizado = 0;
        let contratosAtualizados = 0;

        for (const contrato of contratos) {
            // 1. Sincroniza webhooks novos (assinatura, deleção, visualização, etc.)
            const novos = await sincronizarContrato(contrato);
            if (novos > 0) {
                totalSincronizado += novos;
                contratosAtualizados++;
                console.log(`   ✅ Contrato #${contrato.id}: ${novos} novo(s) evento(s)`);
            }
            
            // 2. Verifica expiração local (só se ainda estiver pending/link-opened)
            await verificarExpiracaoLocal(contrato);
        }

        if (totalSincronizado > 0) {
            console.log(`✅ [JOB] ${contratosAtualizados} contrato(s), ${totalSincronizado} evento(s) sincronizado(s)`);
        }

    } catch (error) {
        console.error('❌ [JOB] Erro:', error.message);
    } finally {
        jobRodando = false;
    }
}

/**
 * Sincroniza webhooks de um contrato específico.
 * Busca na tabela webhook_zapsign, insere no Historico e atualiza status.
 */
async function sincronizarContrato(contrato) {
    try {
        const webhooks = await db.buscarWebhooksPorToken(contrato.token_zapsign);
        
        let novosProcessados = 0;
        let novoStatus = null;
        let deveBaixarPdfAssinado = false;

        for (const webhook of webhooks) {
            // Pula se já foi processado
            const jaExiste = await db.webhookJaNoHistorico(webhook.id);
            if (jaExiste) continue;

            // Descreve o evento de forma inteligente
            const motivo = descreverEventoInteligente(webhook.Tipo, contrato.status_atual);

            // Insere no Historico
            await db.inserirHistorico({
                contrato_id: contrato.id,
                webhook_id: webhook.id,
                motivo: motivo,
                data_evento: webhook.DataCriacao || new Date()
            });

            // Detecta mudança de status
            const status = novoStatusPorEvento(webhook.Tipo);
            if (status) {
                novoStatus = status;
                if (status === 'signed') deveBaixarPdfAssinado = true;
            }

            novosProcessados++;
        }

        // Atualiza status se mudou
        if (novoStatus) {
            const podeAtualizar = novoStatus !== contrato.status_atual && 
                                   contrato.status_atual !== 'deleted' &&
                                   (contrato.status_atual !== 'canceled' || novoStatus === 'deleted');

            if (podeAtualizar) {
                await db.atualizarStatusContrato(contrato.token_zapsign, novoStatus);
                console.log(`   ↳ Status: ${contrato.status_atual} → ${novoStatus}`);
            }
        }

        // Baixa PDF assinado se foi assinado de verdade (não cancelamento)
        if (deveBaixarPdfAssinado && contrato.status_atual !== 'canceled') {
            try {
                const doc = await zapsignService.consultarDocumento(contrato.token_zapsign);
                if (doc?.signed_file) {
                    await db.atualizarDocumentoAssinado(contrato.token_zapsign, doc.signed_file);
                    console.log(`   📄 PDF assinado salvo!`);
                }
            } catch (err) {
                console.error(`   ⚠️ Erro ao baixar PDF:`, err.message);
            }
        }

        return novosProcessados;
        
    } catch (error) {
        console.error(`❌ Erro no contrato #${contrato.id}:`, error.message);
        return 0;
    }
}

/**
 * Verifica se um contrato expirou baseado no tempo de criação.
 */
async function verificarExpiracaoLocal(contrato) {
    if (!contrato.criado_em) return false;
    if (!['pending', 'link-opened'].includes(contrato.status_atual)) return false;
    
    const agora = new Date();
    const criadoEm = new Date(contrato.criado_em);
    const minutosPassados = (agora - criadoEm) / (1000 * 60);
    
    // Ainda não passou o tempo limite
    if (minutosPassados < MINUTOS_ATE_EXPIRAR) return false;
    
    // Recarrega do banco pra confirmar status atual
    const contratoAtualizado = await db.buscarContratoPorToken(contrato.token_zapsign);
    if (!contratoAtualizado) return false;
    if (!['pending', 'link-opened'].includes(contratoAtualizado.status_atual)) return false;
    
    console.log(`   ⏰ Contrato #${contrato.id} EXPIROU (criado há ${Math.round(minutosPassados)} min, limite: ${MINUTOS_ATE_EXPIRAR} min)`);
    
    try {
        await db.atualizarStatusContrato(contrato.token_zapsign, 'expired');
        console.log(`   ↳ Status: ${contratoAtualizado.status_atual} → expired`);
        
        await db.inserirHistorico({
            contrato_id: contrato.id,
            webhook_id: null,
            motivo: 'Documento expirado (detectado por tempo de criação)',
            data_evento: new Date()
        });
        
        return true;
    } catch (error) {
        console.error(`   ⚠️ Erro ao expirar:`, error.message);
        return false;
    }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

/**
 * Mapeia tipo de webhook pro status correspondente do contrato.
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
 * Descreve o evento.
 * Se contrato está cancelado e chega webhook "signed", identifica como cancelamento.
 */
function descreverEventoInteligente(tipoWebhook, statusAtualContrato) {
    const tipoLower = (tipoWebhook || '').toLowerCase();
    
    if (statusAtualContrato === 'canceled') {
        if (tipoLower.includes('signed') || tipoLower === 'assinados') {
            return 'Documento cancelado via API';
        }
        if (tipoLower === 'todos') {
            return 'Evento genérico (cancelamento)';
        }
    }
    
    return descreverEvento(tipoWebhook);
}

/**
 * Converte tipo de webhook em descrição legível.
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
 * Inicia o job de sincronização (chamado no server.js).
 */
function iniciarJob() {
    console.log(`⏰ Job de sincronização iniciado (a cada ${INTERVALO_MS / 1000}s)`);
    executarJob();
    setInterval(executarJob, INTERVALO_MS);
}

// ============================================
// EXPORTAÇÕES
// ============================================

module.exports = {
    iniciarJob,
    executarJob
};
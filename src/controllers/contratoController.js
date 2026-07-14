/**
 * CONTROLLER DE CONTRATOS
 * Gerencia envio, cancelamento e consulta de contratos na ZapSign
 */

const zapsignService = require('../services/zapsignService');
const { obterConfiguracao } = require('../config/contratos');
const { extrairDadosPDF } = require('../utils/extrairDadosPDF');
const db = require('../database/queries');
const fs = require('fs');

/**
 * Envia o contrato para a ZapSign
 * Extrai automaticamente nome, email e telefone do PDF
 */
async function enviarContrato(req, res) {
    const arquivo = req.file;

    try {
        if (!arquivo) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nenhum arquivo PDF enviado. Use o campo "arquivo".'
            });
        }

        let { tipo } = req.body;
        let tipoDetectadoAutomaticamente = false;

        // Extrai dados do PDF
        console.log('\n🔍 Iniciando extração de dados do PDF...');
        const dadosExtraidos = await extrairDadosPDF(arquivo.path);

        // Detecta tipo automaticamente se não veio no body
        if (!tipo) {
            tipo = dadosExtraidos.tipo_pagamento_detectado;
            tipoDetectadoAutomaticamente = true;
            console.log(`🔍 Tipo detectado automaticamente: ${tipo.toUpperCase()}`);
        }

        // Obtém configuração do tipo
        let configuracao;
        try {
            configuracao = obterConfiguracao(tipo);
        } catch (error) {
            return res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }

        // Mescla dados (body tem prioridade sobre extração)
        const nome = req.body.nome || dadosExtraidos.nome;
        const email = req.body.email || dadosExtraidos.email;
        const telefone = req.body.telefone || dadosExtraidos.telefone;

        // Validações
        if (!nome) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nome do cliente não informado e não foi possível extrair do PDF.'
            });
        }

        if (!email && !telefone) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nenhum contato (email/telefone) informado ou encontrado no PDF.',
                dados_extraidos: dadosExtraidos
            });
        }

        // Monta nome do documento
        const codigoCliente = dadosExtraidos.codigo_cliente || 'SEMCODIGO';
        const nomeDocumento = `${codigoCliente} ${nome}`;

        console.log(`📝 Nome do documento: ${nomeDocumento}`);
        console.log(`💳 Tipo de contrato: ${tipo.toUpperCase()}`);

        const signatario = { nome, email, telefone };

        // Envia para ZapSign
        const documento = await zapsignService.criarDocumento({
            caminhoArquivo: arquivo.path,
            nomeArquivo: arquivo.originalname,
            nomeDocumento,
            signatario,
            configuracao
        });

        // Grava contrato no banco de dados
        try {
            await db.inserirContrato({
                codigo_cliente: codigoCliente !== 'SEMCODIGO' ? codigoCliente : null,
                nome_cliente: signatario.nome,
                email_cliente: signatario.email || null,
                telefone_cliente: signatario.telefone || null,
                tipo_contrato: tipo,
                token_zapsign: documento.token,
                nome_body: !!req.body.nome,
                email_body: !!req.body.email,
                telefone_body: !!req.body.telefone,
                tipo_body: !tipoDetectadoAutomaticamente,
                status_atual: documento.status || 'pending'
            });
            
            // Múltiplas tentativas de sincronização (300ms, 2s, 5s)
            [300, 2000, 5000].forEach((delay) => {
                setTimeout(async () => {
                    try {
                        const contratoDB = await db.buscarContratoPorToken(documento.token);
                        if (contratoDB) {
                            const novos = await sincronizarWebhooksDoContrato(documento.token, contratoDB.id);
                            if (novos > 0) {
                                console.log(`✅ Sincronização (${delay}ms): ${novos} webhook(s) novos`);
                            }
                        }
                    } catch (err) {
                        console.error(`⚠️ Sincronização (${delay}ms) falhou:`, err.message);
                    }
                }, delay);
            });
            
        } catch (dbError) {
            console.error('⚠️  Aviso: falha ao gravar no banco:', dbError.message);
        }

        // Resposta
        return res.status(201).json({
            sucesso: true,
            mensagem: 'Contrato enviado para ZapSign com sucesso!',
            dados: {
                documento_id: documento.token,
                nome_documento: documento.name,
                codigo_cliente: codigoCliente,
                tipo_contrato: tipo,
                tipo_detectado_automaticamente: tipoDetectadoAutomaticamente,
                status: documento.status,
                link_assinatura: documento.signers[0]?.sign_url,
                cliente: {
                    nome: signatario.nome,
                    email: signatario.email || null,
                    telefone: signatario.telefone || null
                },
                origem_dados: {
                    tipo: tipoDetectadoAutomaticamente ? 'pdf' : 'body',
                    nome: req.body.nome ? 'body' : 'pdf',
                    email: req.body.email ? 'body' : (dadosExtraidos.email ? 'pdf' : 'não informado'),
                    telefone: req.body.telefone ? 'body' : (dadosExtraidos.telefone ? 'pdf' : 'não informado'),
                    codigo_cliente: dadosExtraidos.codigo_cliente ? 'pdf' : 'não encontrado'
                }
            }
        });

    } catch (error) {
        console.error('❌ Erro geral:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao enviar contrato',
            erro: error.response?.data || error.message
        });
    } finally {
        if (arquivo?.path) {
            deletarArquivo(arquivo.path);
        }
    }
}

/**
 * Consulta o status de um contrato na ZapSign
 */
async function consultarContrato(req, res) {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Token do contrato não informado.'
            });
        }

        const documento = await zapsignService.consultarDocumento(token);

        return res.json({
            sucesso: true,
            dados: {
                nome: documento.name,
                status: documento.status,
                criado_em: documento.created_at,
                pdf_original: documento.original_file,
                pdf_assinado: documento.signed_file,
                signatario: documento.signers.map(s => ({
                    nome: s.name,
                    email: s.email,
                    status: s.status,
                    link_assinatura: s.sign_url,
                    assinado_em: s.signed_at
                }))
            }
        });
    } catch (error) {
        if (error.response?.status === 404) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado.'
            });
        }

        console.error('❌ Erro ao consultar:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao consultar contrato',
            erro: error.response?.data || error.message
        });
    }
}

/**
 * Testa extração de dados de um PDF (sem enviar pra ZapSign)
 */
async function testarExtracao(req, res) {
    const arquivo = req.file;

    try {
        if (!arquivo) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nenhum arquivo PDF enviado. Use o campo "arquivo".'
            });
        }

        const dados = await extrairDadosPDF(arquivo.path);

        return res.json({
            sucesso: true,
            mensagem: 'Dados extraídos com sucesso!',
            dados_extraidos: dados
        });

    } catch (error) {
        console.error('❌ Erro ao extrair:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao extrair dados',
            erro: error.message
        });
    } finally {
        if (arquivo?.path) {
            deletarArquivo(arquivo.path);
        }
    }
}

/**
 * Cancela um contrato na ZapSign
 * O documento fica com status "recusado" e não pode mais ser assinado
 */
async function cancelarContrato(req, res) {
    try {
        const { token } = req.params;
        const { motivo, notificar_signatarios } = req.body || {};

        if (!token) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Token do contrato não informado.'
            });
        }

        const motivoFinal = motivo?.trim() || 'Documento cancelado pela empresa';
        const notificar = notificar_signatarios === true || notificar_signatarios === 'true';

        console.log(`\n🚫 Solicitação de cancelamento recebida:`);
        console.log(`   Token: ${token}`);
        console.log(`   Motivo: ${motivoFinal}`);
        console.log(`   Notificar signatários: ${notificar ? 'SIM' : 'NÃO'}`);

        // Envia cancelamento pra ZapSign
        const resultado = await zapsignService.cancelarDocumento(token, motivoFinal, notificar);

        // Atualiza status no banco de dados
        try {
            const contratoDB = await db.buscarContratoPorToken(token);

            if (contratoDB) {
                await db.atualizarStatusContrato(token, 'canceled');
                
                // Múltiplas tentativas de sincronização (500ms, 2s, 5s)
                [500, 2000, 5000].forEach((delay) => {
                    setTimeout(async () => {
                        try {
                            const novos = await sincronizarWebhooksDoContrato(token, contratoDB.id);
                            if (novos > 0) {
                                console.log(`✅ Sincronização cancelamento (${delay}ms): ${novos} webhook(s) novos`);
                            }
                        } catch (err) {
                            console.error(`⚠️ Sincronização (${delay}ms) falhou:`, err.message);
                        }
                    }, delay);
                });
                
            } else {
                console.log(`⚠️ Contrato ${token} não encontrado no banco local`);
            }
        } catch (dbError) {
            console.error('⚠️  Aviso: falha ao atualizar status:', dbError.message);
        }

        return res.json({
            sucesso: true,
            mensagem: 'Contrato cancelado com sucesso!',
            token: token,
            motivo: motivoFinal,
            notificacao_enviada: notificar,
            dados: resultado
        });

    } catch (error) {
        const status = error.response?.status;
        const dadosErro = error.response?.data;
        const codigoErro = dadosErro?.code;

        if (status === 404 || codigoErro === 'document_not_found') {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado.',
                codigo: 'document_not_found'
            });
        }

        if (codigoErro === 'document_already_signed') {
            return res.status(403).json({
                sucesso: false,
                mensagem: 'Não é possível cancelar. O documento já foi assinado.',
                codigo: 'document_already_signed'
            });
        }

        if (codigoErro === 'document_already_refused') {
            return res.status(403).json({
                sucesso: false,
                mensagem: 'Este documento já foi cancelado/recusado anteriormente.',
                codigo: 'document_already_refused'
            });
        }

        if (codigoErro === 'refuse_not_allowed') {
            return res.status(403).json({
                sucesso: false,
                mensagem: 'A reprovação deste documento não é permitida.',
                codigo: 'refuse_not_allowed'
            });
        }

        console.error('❌ Erro ao cancelar contrato:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao cancelar contrato',
            erro: dadosErro || error.message
        });
    }
}

/**
 * Consulta um contrato específico e seu histórico completo
 * Antes de retornar, sincroniza webhooks novos da tabela webhook_zapsign
 */
async function consultarContratoCompleto(req, res) {
    try {
        const { token } = req.params;

        const contrato = await db.buscarContratoPorToken(token);

        if (!contrato) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado no banco de dados'
            });
        }

        // Sincroniza webhooks novos desse contrato
        const novosProcessados = await sincronizarWebhooksDoContrato(token, contrato.id);

        // Busca o histórico completo (com JOIN pra trazer dados do webhook)
        const historico = await db.buscarHistoricoCompletoPorToken(token);

        return res.json({
            sucesso: true,
            contrato: contrato,
            historico: historico,
            total_eventos: historico.length,
            webhooks_sincronizados: novosProcessados
        });

    } catch (error) {
        console.error('❌ Erro ao consultar:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao consultar contrato',
            erro: error.message
        });
    }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

/**
 * Sincroniza webhooks de um contrato específico
 * Pega da tabela webhook_zapsign e cria registros no Historico referenciando pelo webhook_id
 */
async function sincronizarWebhooksDoContrato(token, contratoId) {
    try {
        const webhooks = await db.buscarWebhooksPorToken(token);
        
        let novosProcessados = 0;

        for (const webhook of webhooks) {
            const jaExiste = await db.webhookJaNoHistorico(webhook.id);
            if (jaExiste) continue;

            const motivo = descreverEvento(webhook.Tipo);

            await db.inserirHistorico({
                contrato_id: contratoId,
                webhook_id: webhook.id,
                motivo: motivo,
                data_evento: webhook.DataCriacao || new Date()
            });

            novosProcessados++;
        }

        if (novosProcessados > 0) {
            console.log(`✅ ${novosProcessados} webhooks sincronizados para ${token}`);
        }

        return novosProcessados;

    } catch (error) {
        console.error('⚠️ Erro ao sincronizar webhooks:', error.message);
        return 0;
    }
}

/**
 * Converte o tipo do webhook em um motivo descritivo
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
 * Deleta arquivo temporário
 */
function deletarArquivo(caminho) {
    fs.unlink(caminho, (err) => {
        if (err && err.code !== 'ENOENT') {
            console.error('⚠️ Erro ao deletar arquivo:', err.message);
        } else if (!err) {
            console.log('🗑️ Arquivo temporário deletado');
        }
    });
}

module.exports = {
    enviarContrato,
    consultarContrato,
    testarExtracao,
    cancelarContrato,
    consultarContratoCompleto
};
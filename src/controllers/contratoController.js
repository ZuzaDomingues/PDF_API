/**
 * CONTROLLER DE CONTRATOS
 * 
 * Gerencia todas as operações de contratos:
 * - Envio de PDF para ZapSign
 * - Cancelamento de contratos
 * - Consulta de status (ZapSign e banco local)
 * - Busca por nome, período e listagem geral
 * - Consulta de cliente com histórico completo de webhooks
 * - Sincronização automática de webhooks
 */

const zapsignService = require('../services/zapsignService');
const { obterConfiguracao } = require('../config/contratos');
const { extrairDadosPDF } = require('../utils/extrairDadosPDF');
const db = require('../database/queries');
const fs = require('fs');

// ============================================
// ROTAS PRINCIPAIS
// ============================================

/**
 * POST /api/contratos/enviar
 * 
 * Envia um contrato PDF para a ZapSign.
 * Extrai automaticamente nome, email e telefone do PDF.
 * Detecta o tipo de contrato (boleto/crédito) automaticamente.
 * 
 * Body (form-data):
 *   - arquivo: PDF (obrigatório)
 *   - tipo: "boleto" ou "credito" (opcional, detecta do PDF)
 *   - nome: nome do cliente (opcional, extrai do PDF)
 *   - email: email do cliente (opcional, extrai do PDF)
 *   - telefone: telefone do cliente (opcional, extrai do PDF)
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

        // Detecta tipo automaticamente se não foi digitado
        if (!tipo) {
            tipo = dadosExtraidos.tipo_pagamento_detectado;
            tipoDetectadoAutomaticamente = true;
            console.log(`🔍 Tipo detectado automaticamente: ${tipo.toUpperCase()}`);
        }

        // Obtém configuração do tipo (posições de assinatura, autenticação)
        let configuracao;
        try {
            configuracao = obterConfiguracao(tipo);
        } catch (error) {
            return res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }

        // Mesclagem de dados os dados digitados tem prioridade sobre extração do PDF
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

        // Monta nome do documento: "CODIGO NOME" ou só "NOME"
        const codigoCliente = dadosExtraidos.codigo_cliente || 'SEMCODIGO';
        const nomeDocumento = dadosExtraidos.codigo_cliente 
            ? `${dadosExtraidos.codigo_cliente} ${nome}` 
            : nome;

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
                link_assinatura: documento.signers[0]?.sign_url || null,
                documento_assinado: null,
                nome_digitado: !!req.body.nome,
                email_digitado: !!req.body.email,
                telefone_digitado: !!req.body.telefone,
                tipo_digitado: !tipoDetectadoAutomaticamente,
                status_atual: documento.status || 'pending'
            });
            
            // Sincroniza webhooks em background (300ms, 2s, 5s)
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
            console.error('⚠️ Falha ao gravar no banco:', dbError.message);
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
 * POST /api/contratos/:token/cancelar
 * 
 * Cancela um contrato na ZapSign.
 * O documento fica com status "recusado" e não pode mais ser assinado.
 * Adiciona marca d'água "Documento recusado" no PDF.
 * 
 * Body (JSON, opcional):
 *   - motivo: texto (padrão: "Documento cancelado pela empresa")
 *   - notificar_signatarios: true/false (padrão: false)
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

        console.log(`\n🚫 Cancelamento: ${token} | Motivo: ${motivoFinal}`);

        // Envia cancelamento pra ZapSign
        const resultado = await zapsignService.cancelarDocumento(token, motivoFinal, notificar);

        // Atualiza status no banco + sincroniza webhooks
        try {
            const contratoDB = await db.buscarContratoPorToken(token);

            if (contratoDB) {
                await db.atualizarStatusContrato(token, 'canceled');
                
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
            console.error('⚠️ Falha ao atualizar status:', dbError.message);
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
        const dadosErro = error.response?.data;
        const codigoErro = dadosErro?.code;

        const errosMapeados = {
            'document_not_found': { status: 404, mensagem: 'Contrato não encontrado.' },
            'document_already_signed': { status: 403, mensagem: 'Não é possível cancelar. O documento já foi assinado.' },
            'document_already_refused': { status: 403, mensagem: 'Este documento já foi cancelado/recusado anteriormente.' },
            'refuse_not_allowed': { status: 403, mensagem: 'A reprovação deste documento não é permitida.' }
        };

        if (errosMapeados[codigoErro]) {
            return res.status(errosMapeados[codigoErro].status).json({
                sucesso: false,
                mensagem: errosMapeados[codigoErro].mensagem,
                codigo: codigoErro
            });
        }

        if (error.response?.status === 404) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado.',
                codigo: 'document_not_found'
            });
        }

        console.error('❌ Erro ao cancelar:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao cancelar contrato',
            erro: dadosErro || error.message
        });
    }
}

// ============================================
// ROTAS DE CONSULTA
// ============================================

/**
 * GET /api/contratos/:token
 * 
 * Consulta status de um contrato na ZapSign + banco local.
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

        // Busca na ZapSign
        let dadosZapsign = null;
        try {
            dadosZapsign = await zapsignService.consultarDocumento(token);
        } catch (err) {
            console.log(`⚠️ Não foi possível consultar ZapSign: ${err.message}`);
        }

        // Busca no banco local
        const contratoBanco = await db.buscarContratoPorToken(token);

        if (!dadosZapsign && !contratoBanco) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado.'
            });
        }

        const statusReal = contratoBanco?.status_atual || dadosZapsign?.status || 'desconhecido';

        return res.json({
            sucesso: true,
            dados: {
                nome: dadosZapsign?.name || contratoBanco?.nome_cliente,
                status_zapsign: dadosZapsign?.status || null,
                status_banco: contratoBanco?.status_atual || null,
                status: statusReal,
                criado_em: dadosZapsign?.created_at || contratoBanco?.criado_em,
                pdf_original: dadosZapsign?.original_file || null,
                pdf_assinado: dadosZapsign?.signed_file || contratoBanco?.documento_assinado || null,
                link_assinatura: contratoBanco?.link_assinatura || null,
                signatario: dadosZapsign?.signers?.map(s => ({
                    nome: s.name,
                    email: s.email,
                    status: s.status,
                    link_assinatura: s.sign_url,
                    assinado_em: s.signed_at
                })) || []
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
 * GET /api/contratos/registro/:token
 * 
 * Consulta um contrato com histórico completo.
 * Sincroniza webhooks novos antes de retornar.
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

        // Sincroniza webhooks novos
        const novosProcessados = await sincronizarWebhooksDoContrato(token, contrato.id);

        // Busca o histórico completo
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

/**
 * GET /api/contratos/cliente/:nome
 * 
 * Consulta um cliente por nome e retorna TODOS os contratos com eventos completos.
 */
async function consultarCliente(req, res) {
    try {
        const { nome } = req.params;
        
        if (!nome || nome.trim().length < 2) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nome deve ter pelo menos 2 caracteres.'
            });
        }

        console.log(`\n🔍 Consultando cliente: "${nome}"`);

        const contratos = await db.buscarContratosPorNome(nome.trim());

        if (contratos.length === 0) {
            return res.status(404).json({
                sucesso: false,
                mensagem: `Nenhum contrato encontrado para o cliente: ${nome}`
            });
        }

        console.log(`   Encontrados ${contratos.length} contrato(s)`);

        const contratosComEventos = [];

        for (const contrato of contratos) {
            // Busca Webhooks
            const webhooks = await db.buscarWebhooksPorToken(contrato.token_zapsign);
            
            // Monta eventos
            let eventos = webhooks.map(webhook => {
                let dados = webhook.Json;
                if (typeof dados === 'string') {
                    try { dados = JSON.parse(dados); } catch (e) { dados = { raw: webhook.Json }; }
                }
                return {
                    status: webhook.Tipo,
                    data: webhook.DataCadastro || webhook.DataCriacao,
                    json: dados
                };
            });

            // Adiciona evento virtual de expiração (se expirou sem webhook)
            if (contrato.status_atual === 'expired') {
                const temExpired = eventos.some(e => 
                    e.status === 'expirados' || e.status === 'doc_expired' ||
                    (e.json && e.json.event_type === 'doc_expired')
                );
                if (!temExpired) {
                    eventos.push({
                        status: 'expirados',
                        data: contrato.atualizado_em,
                        json: {
                            event_type: 'doc_expired',
                            token: contrato.token_zapsign,
                            status: 'expired',
                            origem: 'verificacao_local',
                            mensagem: 'Documento expirado (detectado por tempo de criação)'
                        }
                    });
                }
            }

            // Adiciona evento virtual de cancelamento (se cancelou sem webhook claro)
            if (contrato.status_atual === 'canceled') {
                const temCancelado = eventos.some(e => 
                    e.status === 'recusados' || e.status === 'doc_refused' ||
                    (e.json && e.json.rejected_reason)
                );
                if (!temCancelado) {
                    eventos.push({
                        status: 'cancelado',
                        data: contrato.atualizado_em,
                        json: {
                            event_type: 'doc_refused',
                            token: contrato.token_zapsign,
                            status: 'canceled',
                            origem: 'api_cancelamento',
                            mensagem: 'Documento cancelado via API'
                        }
                    });
                }
            }

            // Ordena: por data, deletados SEMPRE por último
            eventos.sort((a, b) => {
                const aDeleted = (a.status === 'deletados' || a.status === 'doc_deleted' || 
                                (a.json && a.json.event_type === 'doc_deleted'));
                const bDeleted = (b.status === 'deletados' || b.status === 'doc_deleted' || 
                                (b.json && b.json.event_type === 'doc_deleted'));
                
                if (aDeleted && !bDeleted) return 1;
                if (!aDeleted && bDeleted) return -1;
                return new Date(a.data || 0) - new Date(b.data || 0);
            });

            contratosComEventos.push({
                id: contrato.id,
                codigo_cliente: contrato.codigo_cliente,
                nome_cliente: contrato.nome_cliente,
                email_cliente: contrato.email_cliente,
                telefone_cliente: contrato.telefone_cliente,
                tipo_contrato: contrato.tipo_contrato,
                token_zapsign: contrato.token_zapsign,
                link_assinatura: contrato.link_assinatura,
                documento_assinado: contrato.documento_assinado,
                status_atual: contrato.status_atual,
                criado_em: contrato.criado_em,
                atualizado_em: contrato.atualizado_em,
                total_eventos: eventos.length,
                eventos: eventos
            });
        }

        return res.json({
            sucesso: true,
            nome_buscado: nome,
            total_contratos: contratosComEventos.length,
            contratos: contratosComEventos
        });

    } catch (error) {
        console.error('❌ Erro ao consultar cliente:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao consultar cliente',
            erro: error.message
        });
    }
}

/**
 * GET /api/contratos/clientes/listar
 * 
 * Lista todos os clientes
 */
async function listarClientes(req, res) {
    try {
        const clientes = await db.listarClientesResumo();
        return res.json({
            sucesso: true,
            total: clientes.length,
            clientes: clientes
        });
    } catch (error) {
        console.error('❌ Erro ao listar clientes:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao listar clientes',
            erro: error.message
        });
    }
}

/**
 * GET /api/contratos/todos
 * 
 * Lista TODOS os contratos com resumo por status.
 */
async function listarTodos(req, res) {
    try {
        const { limite } = req.query;
        const contratos = await db.listarTodosContratos(parseInt(limite) || 200);
        
        const resumo = {
            total: contratos.length,
            pending: contratos.filter(c => c.status_atual === 'pending').length,
            signed: contratos.filter(c => c.status_atual === 'signed').length,
            canceled: contratos.filter(c => c.status_atual === 'canceled').length,
            expired: contratos.filter(c => c.status_atual === 'expired').length,
            deleted: contratos.filter(c => c.status_atual === 'deleted').length,
            refused: contratos.filter(c => c.status_atual === 'refused').length
        };

        return res.json({
            sucesso: true,
            resumo: resumo,
            contratos: contratos
        });

    } catch (error) {
        console.error('❌ Erro ao listar contratos:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao listar contratos',
            erro: error.message
        });
    }
}

/**
 * GET /api/contratos/periodo
 * 
 * Busca contratos por período.
 * Query params: ?inicio=2026-07-10&fim=2026-07-16
 * Aceita formatos: YYYY-MM-DD ou DD/MM/YYYY
 */
async function buscarPorPeriodo(req, res) {
    try {
        const { inicio, fim } = req.query;

        if (!inicio || !fim) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Informe "inicio" e "fim" do período.',
                exemplos: [
                    'GET /periodo?inicio=2026-07-10&fim=2026-07-16',
                    'GET /periodo?inicio=10/07/2026&fim=16/07/2026'
                ]
            });
        }

        const dataInicio = converterData(inicio);
        const dataFim = converterDataFim(fim);

        if (!dataInicio || !dataFim) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Formato de data inválido. Use YYYY-MM-DD ou DD/MM/YYYY.'
            });
        }

        const contratos = await db.buscarContratosPorPeriodo(dataInicio, dataFim);

        const resumo = {
            total: contratos.length,
            periodo: { inicio, fim },
            pending: contratos.filter(c => c.status_atual === 'pending').length,
            signed: contratos.filter(c => c.status_atual === 'signed').length,
            canceled: contratos.filter(c => c.status_atual === 'canceled').length,
            expired: contratos.filter(c => c.status_atual === 'expired').length,
            deleted: contratos.filter(c => c.status_atual === 'deleted').length,
            refused: contratos.filter(c => c.status_atual === 'refused').length
        };

        return res.json({
            sucesso: true,
            resumo: resumo,
            contratos: contratos
        });

    } catch (error) {
        console.error('❌ Erro ao buscar por período:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao buscar contratos por período',
            erro: error.message
        });
    }
}

/**
 * POST /api/contratos/testar-extracao
 * 
 * Testa extração de dados de um PDF sem enviar pra ZapSign.
 * Para validar se os dados são caso não sejam extraídos corretamente.
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
 * GET /api/contratos/buscar
 * 
 * Busca contratos por termo (nome, email, telefone ou código).
 * Query params: ?q=termo&limite=50&com_historico=true
 */
async function buscarContratos(req, res) {
    try {
        const { q, limite, com_historico } = req.query;

        if (!q || q.trim().length < 2) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Termo de busca deve ter pelo menos 2 caracteres.',
                exemplo: 'GET /api/contratos/buscar?q=João'
            });
        }

        const contratos = await db.buscarContratos(q.trim(), parseInt(limite) || 50);
        const incluirHistorico = com_historico !== 'false';

        if (incluirHistorico && contratos.length > 0) {
            const contratosIds = contratos.map(c => c.id);
            const todosEventos = await db.buscarHistoricoMultiplos(contratosIds);

            const contratosComHistorico = contratos.map(contrato => {
                const historico = todosEventos.filter(e => e.contratos_id === contrato.id);
                return {
                    ...contrato,
                    total_eventos: historico.length,
                    historico: historico
                };
            });

            return res.json({
                sucesso: true,
                termo_busca: q,
                total: contratosComHistorico.length,
                contratos: contratosComHistorico
            });
        }

        return res.json({
            sucesso: true,
            termo_busca: q,
            total: contratos.length,
            contratos: contratos
        });

    } catch (error) {
        console.error('❌ Erro ao buscar contratos:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao buscar contratos',
            erro: error.message
        });
    }
}

// ============================================
// FUNÇÕES AUXILIARES (uso interno)
// ============================================

/**
 * Sincroniza webhooks de um contrato específico.
 * Busca webhooks novos na tabela webhook_zapsign e insere no Historico.
 * Também atualiza o status do contrato se necessário.
 */
async function sincronizarWebhooksDoContrato(token, contratoId) {
    try {
        const contrato = await db.buscarContratoPorToken(token);
        const statusAtual = contrato?.status_atual;
        const webhooks = await db.buscarWebhooksPorToken(token);
        
        let novosProcessados = 0;
        let novoStatus = null;

        for (const webhook of webhooks) {
            const jaExiste = await db.webhookJaNoHistorico(webhook.id);
            if (jaExiste) continue;

            const motivo = descreverEventoInteligente(webhook.Tipo, statusAtual);

            await db.inserirHistorico({
                contrato_id: contratoId,
                webhook_id: webhook.id,
                motivo: motivo,
                data_evento: webhook.DataCriacao || new Date()
            });

            // Detecta mudança de status pelo tipo do webhook
            const tipoLower = (webhook.Tipo || '').toLowerCase();
            if (tipoLower.includes('deleted') || tipoLower === 'deletados') {
                novoStatus = 'deleted';
            } else if ((tipoLower.includes('signed') || tipoLower === 'assinados') && statusAtual !== 'canceled') {
                novoStatus = 'signed';
            } else if (tipoLower.includes('refused') || tipoLower === 'recusados') {
                novoStatus = 'refused';
            } else if (tipoLower.includes('expired') || tipoLower === 'expirados') {
                novoStatus = 'expired';
            }

            novosProcessados++;
        }

        // Atualiza status se mudou
        // Regras: deleted SEMPRE aceito
        if (novoStatus) {
            if (novoStatus === 'deleted' && statusAtual !== 'deleted') {
                await db.atualizarStatusContrato(token, 'deleted');
                console.log(`   ↳ Status atualizado: ${statusAtual} → deleted`);
            } else if (novoStatus !== statusAtual && statusAtual !== 'canceled' && statusAtual !== 'deleted') {
                await db.atualizarStatusContrato(token, novoStatus);
                console.log(`   ↳ Status atualizado: ${statusAtual} → ${novoStatus}`);
            }
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
 * Descreve o evento de forma inteligente.
 * Se contrato está cancelado e chega webhook "signed", identifica como cancelamento via API.
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
 * Converte data de DD/MM/YYYY pra YYYY-MM-DD 00:00:00
 */
function converterData(dataStr) {
    if (!dataStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) return `${dataStr} 00:00:00`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataStr)) {
        const [dia, mes, ano] = dataStr.split('/');
        return `${ano}-${mes}-${dia} 00:00:00`;
    }
    return null;
}

/**
 * Converte data de DD/MM/YYYY pra YYYY-MM-DD 23:59:59 (final do dia)
 */
function converterDataFim(dataStr) {
    if (!dataStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) return `${dataStr} 23:59:59`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataStr)) {
        const [dia, mes, ano] = dataStr.split('/');
        return `${ano}-${mes}-${dia} 23:59:59`;
    }
    return null;
}

/**
 * Deleta arquivo temporário do disco.
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

// ============================================
// EXPORTAÇÕES
// ============================================

module.exports = {
    enviarContrato,
    cancelarContrato,
    consultarContrato,
    consultarContratoCompleto,
    consultarCliente,
    listarClientes,
    listarTodos,
    buscarPorPeriodo,
    buscarContratos,
    testarExtracao
};
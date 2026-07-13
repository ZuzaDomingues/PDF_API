/**
 * Importações
 */
const zapsignService = require('../services/zapsignService');
const { obterConfiguracao } = require('../config/contratos');
const { extrairDadosPDF } = require('../utils/extrairDadosPDF');
const registro = require('../utils/registroTxt');
const fs = require('fs');

/**
 * Envia o contrato para a ZapSign
 * Extrai automaticamente nome, email e telefone do PDF
 * (permite sobrescrever via body se necessário)
 */
async function enviarContrato(req, res) {
    const arquivo = req.file;

    try {
        // === VALIDAÇÃO INICIAL ===
        if (!arquivo) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nenhum arquivo PDF enviado. Use o campo "arquivo".'
            });
        }

        // Tipo pode vir do body OU ser detectado automaticamente
        let { tipo } = req.body;
        let tipoDetectadoAutomaticamente = false;

        // === EXTRAIR DADOS DO PDF ===
        console.log('\n🔍 Iniciando extração de dados do PDF...');
        const dadosExtraidos = await extrairDadosPDF(arquivo.path);

        // === DETECTAR TIPO AUTOMATICAMENTE (se não veio no body) ===
        if (!tipo) {
            tipo = dadosExtraidos.tipo_pagamento_detectado;
            tipoDetectadoAutomaticamente = true;
            console.log(`🔍 Tipo detectado automaticamente: ${tipo.toUpperCase()}`);
        }

        // === OBTER CONFIGURAÇÃO ===
        let configuracao;
        try {
            configuracao = obterConfiguracao(tipo);
        } catch (error) {
            return res.status(400).json({
                sucesso: false,
                mensagem: error.message
            });
        }

        // === MESCLAR DADOS (body tem prioridade sobre extração) ===
        const nome = req.body.nome || dadosExtraidos.nome;
        const email = req.body.email || dadosExtraidos.email;
        const telefone = req.body.telefone || dadosExtraidos.telefone;

        // === VALIDAÇÃO FINAL ===
        if (!nome) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nome do cliente não informado e não foi possível extrair do PDF.',
                dica: 'Envie o campo "nome" no body ou verifique se o PDF contém o label "Nome Cliente".'
            });
        }

        if (!email && !telefone) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Nenhum contato (email/telefone) informado ou encontrado no PDF.',
                dica: 'Envie "email" ou "telefone" no body, ou verifique se o PDF contém esses dados.',
                dados_extraidos: dadosExtraidos
            });
        }

        // === MONTAR NOME DO DOCUMENTO ===
        const codigoCliente = dadosExtraidos.codigo_cliente || 'SEMCODIGO';

        // Formato: CODIGO NOME
        const nomeDocumento = `${codigoCliente} ${nome}`;

        console.log(`📝 Nome do documento: ${nomeDocumento}`);
        console.log(`💳 Tipo de contrato: ${tipo.toUpperCase()}`);

        const signatario = { nome, email, telefone };

        // === ENVIAR PARA ZAPSIGN ===
        const documento = await zapsignService.criarDocumento({
            caminhoArquivo: arquivo.path,
            nomeArquivo: arquivo.originalname,
            nomeDocumento,
            signatario,
            configuracao
        });

        const contratoGravado = registro.gravarContrato({
            codigo_cliente: codigoCliente !== 'SEMCODIGO' ? codigoCliente : null,
            nome_cliente: signatario.nome,
            email_cliente: signatario.email || null,
            telefone_cliente: signatario.telefone || null,
            tipo_contrato: tipo,
            nome_documento: nomeDocumento,
            token_zapsign: documento.token,
            link_assinatura: documento.signers[0]?.sign_url || null,
            nome_veio_do_body: !!req.body.nome,
            email_veio_do_body: !!req.body.email,
            telefone_veio_do_body: !!req.body.telefone,
            tipo_veio_do_body: !tipoDetectadoAutomaticamente,
            status_atual: documento.status || 'pending'
        });

        // Grava evento "criado" no histórico
        registro.gravarHistorico({
            contrato_id: contratoGravado.id,
            token_zapsign: documento.token,
            tipo_evento: 'criado',
            dados_evento: {
                nome_documento: nomeDocumento,
                tipo_contrato: tipo,
                codigo_cliente: codigoCliente
            },
            motivo: null
        });

        // === RESPOSTA ===
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
                    telefone: signatario.telefone || null,
                    canais_disponiveis: {
                        email: !!signatario.email,
                        whatsapp: !!signatario.telefone
                    }
                },
                origem_dados: {
                    tipo: tipoDetectadoAutomaticamente ? 'pdf' : 'body',
                    nome: req.body.nome ? 'body' : 'pdf',
                    email: req.body.email ? 'body' : (dadosExtraidos.email ? 'pdf' : 'não informado'),
                    telefone: req.body.telefone ? 'body' : (dadosExtraidos.telefone ? 'pdf' : 'não informado'),
                    codigo_cliente: dadosExtraidos.codigo_cliente ? 'pdf' : 'não encontrado'
                },
                configuracao_aplicada: {
                    tipo: tipo,
                    autenticacao: {
                        selfie: configuracao.autenticacao.require_selfie_photo,
                        documento_rg: configuracao.autenticacao.require_document_photo
                    },
                    total_assinaturas: configuracao.campos_assinatura.length
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
 * Consulta o status de um contrato
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
 * 🚫 Cancela um contrato na ZapSign
 * O documento fica com status "recusado" e não pode mais ser assinado
 * Adiciona marca d'água "Documento recusado" no PDF
 * 
 * Body (opcional):
 *   - motivo: texto explicando o motivo (padrão: "Documento cancelado pela empresa")
 *   - notificar_signatarios: true/false (padrão: false)
 */
async function cancelarContrato(req, res) {
    try {
        const { token } = req.params;
        const { motivo, notificar_signatarios } = req.body || {};

        // === VALIDAÇÃO ===
        if (!token) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Token do contrato não informado.'
            });
        }

        // === MOTIVO (opcional - usa padrão se não vier) ===
        const motivoFinal = motivo?.trim() || 'Documento cancelado pela empresa';

        // === NOTIFICAR SIGNATÁRIOS (opcional - padrão: false) ===
        const notificar = notificar_signatarios === false || notificar_signatarios === 'false';

        console.log(`\n🚫 Solicitação de cancelamento recebida:`);
        console.log(`   Token: ${token}`);
        console.log(`   Motivo: ${motivoFinal}`);
        console.log(`   Notificar signatários: ${notificar ? 'SIM' : 'NÃO'}`);

        // === ENVIAR PARA ZAPSIGN ===
        const resultado = await zapsignService.cancelarDocumento(
            token,
            motivoFinal,
            notificar
        );

        const contratoGravado = registro.buscarContratoPorToken(token);

        if (contratoGravado) {
            // Atualiza status no contrato principal
            registro.atualizarStatusContrato(token, 'canceled');
            
            // Grava evento no histórico
            registro.gravarHistorico({
                contrato_id: contratoGravado.id,
                token_zapsign: token,
                tipo_evento: 'cancelado',
                dados_evento: {
                    notificacao_enviada: notificar
                },
                motivo: motivoFinal
            });
        } else {
            // Contrato não estava registrado ainda (foi criado antes de implementar o registro)
            console.log(`⚠️ Contrato ${token} não encontrado no registro local`);
            
            registro.gravarHistorico({
                contrato_id: null,
                token_zapsign: token,
                tipo_evento: 'cancelado',
                dados_evento: { notificacao_enviada: notificar },
                motivo: motivoFinal
            });
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

        // === TRATAMENTO DOS CÓDIGOS DE ERRO DA ZAPSIGN ===

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

        if (codigoErro === 'missing_doc_token') {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Token do documento não foi enviado.',
                codigo: 'missing_doc_token'
            });
        }

        if (codigoErro === 'missing_rejected_reason') {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Motivo do cancelamento não foi enviado.',
                codigo: 'missing_rejected_reason'
            });
        }

        if (codigoErro === 'invalid_json') {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'JSON enviado está inválido.',
                codigo: 'invalid_json'
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
 * 🗑️ Deleta um contrato na ZapSign (PERMANENTE!)
 * ATENÇÃO: Remove completamente. Não tem como desfazer.
 * Prefira usar cancelarContrato quando possível.
 */
async function deletarContrato(req, res) {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Token do contrato não informado.'
            });
        }

        console.log(`\n🗑️  Solicitação de deleção recebida para token: ${token}`);

        await zapsignService.deletarDocumento(token);

        return res.json({
            sucesso: true,
            mensagem: 'Contrato deletado permanentemente!',
            token: token
        });

    } catch (error) {
        if (error.response?.status === 404) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado.'
            });
        }

        console.error('❌ Erro ao deletar contrato:', error.message);
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao deletar contrato',
            erro: error.response?.data || error.message
        });
    }
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

async function listarContratosRegistrados(req, res) {
    try {
        const contratos = registro.listarContratos();
        return res.json({
            sucesso: true,
            total: contratos.length,
            contratos: contratos
        });
    } catch (error) {
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao listar contratos',
            erro: error.message
        });
    }
}

/**
 * Consulta um contrato específico e seu histórico
 */
async function consultarContratoCompleto(req, res) {
    try {
        const { token } = req.params;
        
        const contrato = registro.buscarContratoPorToken(token);
        const historico = registro.buscarHistoricoPorToken(token);
        
        if (!contrato) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Contrato não encontrado no registro local'
            });
        }
        
        return res.json({
            sucesso: true,
            contrato: contrato,
            historico: historico,
            total_eventos: historico.length
        });
    } catch (error) {
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao consultar contrato',
            erro: error.message
        });
    }
}

/**
 * Lista todo o histórico de eventos
 */
async function listarTodoHistorico(req, res) {
    try {
        const historico = registro.listarHistorico();
        return res.json({
            sucesso: true,
            total: historico.length,
            eventos: historico
        });
    } catch (error) {
        return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao listar histórico',
            erro: error.message
        });
    }
}

module.exports = {
    enviarContrato,
    consultarContrato,
    testarExtracao,
    cancelarContrato,
    deletarContrato,
    listarContratosRegistrados,
    consultarContratoCompleto, 
    listarTodoHistorico 
};
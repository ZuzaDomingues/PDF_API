/**
 * EXTRATOR DE DADOS DE PDF - VERSÃO COMPLETA
 */

const pdfParse = require('pdf-parse-fork');
const fs = require('fs');

const LABELS_CONHECIDOS = [
    // Código do cliente
    'Código', 'Codigo', 'Código do Cliente', 'Codigo do Cliente',
    
    // Dados pessoais
    'Nome Cliente', 'Estado Civíl', 'Estado Civil',
    'CPF/CNPJ', 'CPF', 'CNPJ',
    'Data Nascimento', 'Data de Nascimento',
    'Sexo', 'R.G.', 'RG',
    'Casa Própria', 'Casa Propria',
    
    // Contato
    'E-mail', 'Email',
    'Telefone Residencial', 'Telefone Comercial', 'Telefone Celular',
    'WhatsApp', 'Whatsapp',
    
    // Endereço
    'Endereço de Instalaçao', 'Endereço de Instalação',
    'Endereco de Instalacao',
    'Número', 'Numero', 'Complemento',
    'Bairro', 'Cidade', 'Estado', 'CEP',
    'Endereço Cobrança', 'Endereço de Cobrança', 'Endereco Cobranca',
    
    // Contrato
    'Data da Contrataçao', 'Data da Contratação',
    'Nome do Vendedor', 'Data da Venda',
    'Vencimento', 'Valor Instalaçao', 'Valor da Instalaçao',
    'Valor da Mensalidade', 'Valor Mensalidade',
    'Valor Promocional', 'Período Promocional',
    'Prazo de Fidelidade', 'Fidelidade',
    'Conexão', 'Conexao',
    'Internet', 'Plano', 'Pacote'
];

async function extrairDadosPDF(caminhoArquivo) {
    try {
        console.log('📄 Extraindo dados do PDF...');
        
        const buffer = fs.readFileSync(caminhoArquivo);
        const data = await pdfParse(buffer);
        const texto = data.text;

        console.log(`   Total de páginas: ${data.numpages}`);
        console.log(`   Total de caracteres: ${texto.length}`);

        const dados = {
            tipo_pagamento_detectado: detectarTipoPagamento(texto),
            codigo_cliente: extrairCodigoCliente(texto),
            
            // 👤 Dados pessoais
            nome: extrairNome(texto),
            cpf_cnpj: extrairCPFouCNPJ(texto),
            rg: extrairPorLabel(texto, 'R.G.') || extrairPorLabel(texto, 'RG'),
            data_nascimento: extrairPorLabel(texto, 'Data Nascimento') || extrairPorLabel(texto, 'Data de Nascimento'),
            sexo: extrairPorLabel(texto, 'Sexo'),
            estado_civil: extrairPorLabel(texto, 'Estado Civíl') || extrairPorLabel(texto, 'Estado Civil'),
            casa_propria: extrairPorLabel(texto, 'Casa Própria') || extrairPorLabel(texto, 'Casa Propria'),
            
            // 📧 Contato
            email: extrairEmail(texto),
            telefone_residencial: extrairTelefonePorLabel(texto, 'Telefone Residencial'),
            telefone_comercial: extrairTelefonePorLabel(texto, 'Telefone Comercial'),
            telefone_celular: extrairTelefonePorLabel(texto, 'Telefone Celular'),
            whatsapp: extrairTelefonePorLabel(texto, 'WhatsApp'),
            telefone: extrairTelefone(texto),
            
            // 🏠 Endereço de instalação
            endereco_instalacao: {
                logradouro: extrairPorLabel(texto, 'Endereço de Instalaçao') || extrairPorLabel(texto, 'Endereço de Instalação'),
                numero: extrairNumeroEndereco(texto),
                complemento: extrairPorLabel(texto, 'Complemento'),
                bairro: extrairPorLabel(texto, 'Bairro'),
                cidade: extrairPorLabel(texto, 'Cidade'),
                estado: extrairPorLabel(texto, 'Estado'),
                cep: extrairPorLabel(texto, 'CEP')
            },
            
            // 💰 Endereço de cobrança
            endereco_cobranca: {
                logradouro: extrairPorLabel(texto, 'Endereço Cobrança') || extrairPorLabel(texto, 'Endereço de Cobrança')
            },
            
            // 📋 Dados do contrato
            contrato: {
                data_contratacao: extrairPorLabel(texto, 'Data da Contrataçao') || extrairPorLabel(texto, 'Data da Contratação'),
                nome_vendedor: extrairPorLabel(texto, 'Nome do Vendedor'),
                data_venda: extrairPorLabel(texto, 'Data da Venda'),
                vencimento: extrairPorLabel(texto, 'Vencimento'),
                valor_instalacao: extrairPorLabel(texto, 'Valor da Instalaçao') || extrairPorLabel(texto, 'Valor Instalaçao'),
                valor_mensalidade: extrairPorLabel(texto, 'Valor da Mensalidade') || extrairPorLabel(texto, 'Valor Mensalidade'),
                valor_promocional: extrairPorLabel(texto, 'Valor Promocional'),
                periodo_promocional: extrairPorLabel(texto, 'Período Promocional'),
                prazo_fidelidade: extrairPorLabel(texto, 'Prazo de Fidelidade'),
                conexao: extrairPorLabel(texto, 'Conexão') || extrairPorLabel(texto, 'Conexao')
            },
            
            _debug: {
                total_paginas: data.numpages,
                total_caracteres: texto.length
            }
        };

        console.log('✅ Extração concluída!');
        console.log(`   Tipo detectado:    ${dados.tipo_pagamento_detectado.toUpperCase()}`);
        console.log(`   Código Cliente:    ${dados.codigo_cliente ? '✓ ' + dados.codigo_cliente : '✗'}`);
        console.log(`   Nome:              ${dados.nome ? '✓' : '✗'}`);
        console.log(`   CPF/CNPJ:          ${dados.cpf_cnpj ? '✓' : '✗'}`);
        console.log(`   Email:             ${dados.email ? '✓' : '✗'}`);
        console.log(`   Telefone:          ${dados.telefone ? '✓' : '✗'}`);
        console.log(`   Endereço:          ${dados.endereco_instalacao.logradouro ? '✓' : '✗'}`);
        
        return dados;

    } catch (error) {
        console.error('❌ Erro ao extrair dados do PDF:', error.message);
        throw new Error(`Falha ao extrair dados do PDF: ${error.message}`);
    }
}

/**
 * Extrai o Código do Cliente
 * Aceita: "Código:", "Codigo:", "Código do Cliente:", etc.
 */
function extrairCodigoCliente(texto) {
    const variacoes = [
        'Código do Cliente',
        'Codigo do Cliente',
        'Código',
        'Codigo'
    ];
    
    for (const label of variacoes) {
        const labelEscapado = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
            `${labelEscapado}\\s*:?\\s*([A-Z0-9\\-\\.]+)`,
            'i'
        );
        
        const match = texto.match(regex);
        
        if (match && match[1]) {
            const valor = match[1].trim();
            if (valor && valor !== 'XXX' && valor.length >= 2) {
                return valor;
            }
        }
    }
    
    return null;
}

function extrairNome(texto) {
    const nomeContrato = extrairPorLabel(texto, 'Nome Cliente');
    if (nomeContrato) return nomeContrato;

    const regexNome = /Assinado\s*via ZapSign by Truora\s*\n?\s*([A-ZÀ-Úa-zà-ú\s]+?)\s*(?:Data|Token|\n)/i;
    const match = texto.match(regexNome);
    if (match && match[1]) {
        return match[1].trim();
    }

    return null;
}

function extrairCPFouCNPJ(texto) {
    const regexCNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;
    const matchCNPJ = texto.match(regexCNPJ);
    if (matchCNPJ) return matchCNPJ[0];

    const regexCPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
    const matchCPF = texto.match(regexCPF);
    if (matchCPF) return matchCPF[0];

    return null;
}

function extrairEmail(texto) {
    const regexLabel = /E-mail\s*:?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
    const matchLabel = texto.match(regexLabel);
    if (matchLabel && matchLabel[1]) {
        return matchLabel[1].toLowerCase();
    }

    const regexEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = texto.match(regexEmail);
    
    if (matches) {
        const emailCliente = matches.find(email => 
            !email.includes('zapsign') && 
            !email.includes('ib2c.net.br') &&
            !email.includes('ib2b.net.br')
        );
        if (emailCliente) return emailCliente.toLowerCase();
    }
    
    return null;
}

function extrairTelefone(texto) {
    const labels = ['WhatsApp', 'Telefone Celular', 'Telefone Residencial', 'Telefone Comercial'];

    for (const label of labels) {
        const telefone = extrairTelefonePorLabel(texto, label);
        if (telefone) return telefone;
    }

    return null;
}

function extrairPorLabel(texto, labelInicio) {
    const labelEscapado = labelInicio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const outrosLabels = LABELS_CONHECIDOS
        .filter(l => l !== labelInicio)
        .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    
    const regex = new RegExp(
        `${labelEscapado}\\s*:?\\s*([^\\n\\r]*?)(?=\\s*(?:${outrosLabels})\\s*:|\\n|\\r|$)`,
        'i'
    );
    
    const match = texto.match(regex);
    
    if (match && match[1]) {
        const valor = match[1].trim();
        if (valor && valor !== 'XXX' && valor !== '-----' && !valor.endsWith(':')) {
            return valor;
        }
    }
    
    return null;
}

function extrairTelefonePorLabel(texto, label) {
    const labelEscapado = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
        `${labelEscapado}\\s*:?\\s*(\\+?55\\s?)?(\\(?\\d{2}\\)?\\s*\\d{4,5}[-\\s]?\\d{4})`,
        'i'
    );
    const match = texto.match(regex);
    
    if (match && match[2]) {
        return match[2].replace(/\D/g, '');
    }
    
    return null;
}

function extrairNumeroEndereco(texto) {
    const regex = /N[úu]mero\s*:?\s*([^\n\r]*?)(?=\s*Complemento\s*:|\n|\r)/i;
    const match = texto.match(regex);
    
    if (match && match[1]) {
        const valor = match[1].trim();
        if (valor && valor !== 'XXX' && !valor.endsWith(':')) {
            return valor;
        }
    }
    
    return null;
}

/**
 * Detecta automaticamente o tipo de pagamento no PDF
 * Analisa a seção "FORMA DE PAGAMENTO"
 * 
 * @param {string} texto - Texto completo do PDF
 * @returns {string} - "credito" ou "boleto"
 */
function detectarTipoPagamento(texto) {
    // Normaliza o texto (remove acentos e deixa tudo minúsculo)
    const textoNormalizado = texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    // Palavras-chave que indicam CARTÃO/CRÉDITO
    const indicadoresCartao = [
        'exclusivo cartao',
        'exclusivo cartão',
        'debito automatico',
        'débito automático',
        'pagamento via cartao',
        'pagamento via cartão'
    ];

    // Verifica se tem algum indicador de cartão
    for (const indicador of indicadoresCartao) {
        if (textoNormalizado.includes(indicador)) {
            return 'credito';
        }
    }

    // Se não achou nada de cartão, assume boleto
    return 'boleto';
}

module.exports = {
    extrairDadosPDF
};
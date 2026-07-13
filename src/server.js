/**
 * Importações
 */
const express = require('express');
require('dotenv').config();

const contratoRoutes = require('./routes/contratoRoutes');

/**
 * Cria a aplicação
 */
const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Middlewares globais
 */
app.use(express.json({ limit: '25mb' })); // Limita JSON a 25MB

/**
 * Rota de boas-vindas / documentação
 */
app.get('/', (req, res) => {
    res.json({
        mensagem: '🚀 API de Integração ZapSign rodando!',
        versao: '1.1.0',
        endpoints: {
            'POST /api/contratos/enviar': 'Envia contrato para ZapSign (extrai dados do PDF automaticamente)',
            'POST /api/contratos/testar-extracao': 'Testa extração de dados do PDF (sem enviar)',
            'GET /api/contratos/:token': 'Consulta status de um contrato',
            'POST /api/contratos/:token/cancelar': 'Cancela um contrato (mantém no sistema)',
            'DELETE /api/contratos/:token': 'Deleta um contrato (remove permanentemente)'
        }
    });
});

/**
 * Rotas da API
 */
app.use('/api/contratos', contratoRoutes);

/**
 * Middleware 404 - Rota não encontrada
 */
app.use((req, res) => {
    res.status(404).json({
        sucesso: false,
        mensagem: `Rota não encontrada: ${req.method} ${req.originalUrl}`
    });
});

/**
 * Tratamento de erros global
 */
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Arquivo muito grande. Limite: 25MB.'
        });
    }
    if (err.message && err.message.includes('PDF')) {
        return res.status(400).json({
            sucesso: false,
            mensagem: err.message
        });
    }
    console.error('❌ Erro não tratado:', err.message);
    res.status(500).json({
        sucesso: false,
        mensagem: 'Erro interno do servidor',
        erro: err.message
    });
});

/**
 * Liga o servidor
 */
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`📚 Documentação: http://localhost:${PORT}/`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(50) + '\n');
});
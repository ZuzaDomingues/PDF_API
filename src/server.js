const express = require('express');
require('dotenv').config();

const contratoRoutes = require('./routes/contratoRoutes');
const { testarConexao } = require('./database/conexao');
const { iniciarJob } = require('./utils/jobSincronizacao');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '25mb' }));

app.get('/', (req, res) => {
    res.json({
        mensagem: '🚀 API de Integração ZapSign rodando!',
        versao: '1.3.0',
        endpoints: {
            'POST /api/contratos/enviar': 'Envia contrato para ZapSign',
            'POST /api/contratos/testar-extracao': 'Testa extração do PDF',
            'POST /api/contratos/:token/cancelar': 'Cancela um contrato',
            'GET /api/contratos/:token': 'Consulta status direto na ZapSign',
            'GET /api/contratos/registro/:token': 'Consulta contrato + histórico do banco'
        }
    });
});

app.use('/api/contratos', contratoRoutes);

app.use((req, res) => {
    res.status(404).json({
        sucesso: false,
        mensagem: `Rota não encontrada: ${req.method} ${req.originalUrl}`
    });
});

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
        mensagem: 'Erro interno',
        erro: err.message
    });
});

app.listen(PORT, async () => {
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`📚 Documentação: http://localhost:${PORT}/`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(50));
    
    console.log('\n📊 Testando conexão com o banco de dados...');
    await testarConexao();
    console.log('='.repeat(50));
    
    console.log('');
    iniciarJob();
    console.log('='.repeat(50) + '\n');
});
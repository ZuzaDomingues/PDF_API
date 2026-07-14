/**
 * CONEXÃO COM BANCO DE DADOS (MySQL)
 * 
 * Cria um pool de conexões pra reaproveitar (mais eficiente).
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// === VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ===
const variaveisObrigatorias = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const variavel of variaveisObrigatorias) {
    if (!process.env[variavel]) {
        throw new Error(`❌ Variável de ambiente ${variavel} não configurada. Verifique seu .env`);
    }
}

// === CRIA POOL DE CONEXÕES ===
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

/**
 * Testa a conexão com o banco
 */
async function testarConexao() {
    try {
        const conexao = await pool.getConnection();
        console.log('✅ Banco de dados conectado!');
        console.log(`   Host: ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`);
        console.log(`   Banco: ${process.env.DB_NAME}`);
        conexao.release();
        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar com o banco:');
        console.error(`   Mensagem: ${error.message}`);
        console.error(`   Código: ${error.code}`);
        return false;
    }
}

module.exports = {
    pool,
    testarConexao
};
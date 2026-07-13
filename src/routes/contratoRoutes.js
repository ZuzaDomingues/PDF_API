/**
 * Importações
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const router = express.Router();
const contratoController = require('../controllers/contratoController');

// === GARANTE QUE A PASTA UPLOADS EXISTE ===
const UPLOADS_DIR = 'uploads';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`📁 Pasta "${UPLOADS_DIR}/" criada automaticamente.`);
}

// === CONFIGURAÇÃO DO MULTER ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const nomeSemEspacos = file.originalname.replace(/\s+/g, '_');
        cb(null, `${timestamp}_${nomeSemEspacos}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos PDF são permitidos.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// === ROTAS ===

// POST /api/contratos/enviar - Envia contrato para ZapSign (extrai dados do PDF automaticamente)
router.post('/enviar', upload.single('arquivo'), contratoController.enviarContrato);

// POST /api/contratos/testar-extracao - Testa apenas a extração de dados do PDF
router.post('/testar-extracao', upload.single('arquivo'), contratoController.testarExtracao);

// GET /api/contratos/:token - Consulta status de um contrato
router.get('/:token', contratoController.consultarContrato);

// 🚫 POST /api/contratos/:token/cancelar - Cancela um contrato (mantém no sistema)
router.post('/:token/cancelar', contratoController.cancelarContrato);

// 🗑️ DELETE /api/contratos/:token - Deleta um contrato (remove permanentemente)
router.delete('/:token', contratoController.deletarContrato);

// GET /api/contratos/registro/listar - Lista todos os contratos gravados
router.get('/registro/listar', contratoController.listarContratosRegistrados);

// GET /api/contratos/registro/historico - Lista todo o histórico
router.get('/registro/historico', contratoController.listarTodoHistorico);

// GET /api/contratos/registro/:token - Consulta contrato + histórico
router.get('/registro/:token', contratoController.consultarContratoCompleto);

module.exports = router;
/**
 * ROTAS DE CONTRATOS
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const router = express.Router();
const contratoController = require('../controllers/contratoController');

// Garante que a pasta uploads existe
const UPLOADS_DIR = 'uploads';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`📁 Pasta "${UPLOADS_DIR}/" criada automaticamente.`);
}

// Configuração do Multer para upload de PDF
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
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

// POST /api/contratos/enviar - Envia contrato para ZapSign
router.post('/enviar', upload.single('arquivo'), contratoController.enviarContrato);

// POST /api/contratos/testar-extracao - Testa extração de dados do PDF
router.post('/testar-extracao', upload.single('arquivo'), contratoController.testarExtracao);

// POST /api/contratos/:token/cancelar - Cancela um contrato
router.post('/:token/cancelar', contratoController.cancelarContrato);

// GET /api/contratos/registro/:token - Consulta contrato + histórico (com sincronização automática)
router.get('/registro/:token', contratoController.consultarContratoCompleto);

// GET /api/contratos/:token - Consulta status direto na ZapSign
router.get('/:token', contratoController.consultarContrato);

module.exports = router;
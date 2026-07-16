const express = require('express');
const multer = require('multer');
const fs = require('fs');
const router = express.Router();
const contratoController = require('../controllers/contratoController');

// Garante que a pasta uploads existe
const UPLOADS_DIR = 'uploads';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configuração do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const nomeSemEspacos = file.originalname.replace(/\s+/g, '_');
        cb(null, `${Date.now()}_${nomeSemEspacos}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Apenas PDFs.'), false);
    },
    limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================================
// ROTAS
// ============================================

// POST - Ações
router.post('/enviar', upload.single('arquivo'), contratoController.enviarContrato);
router.post('/testar-extracao', upload.single('arquivo'), contratoController.testarExtracao);
router.post('/:token/cancelar', contratoController.cancelarContrato);

// GET - Consultas
router.get('/todos', contratoController.listarTodos);
router.get('/periodo', contratoController.buscarPorPeriodo);
router.get('/buscar', contratoController.buscarContratos);
router.get('/clientes/listar', contratoController.listarClientes);
router.get('/cliente/:nome', contratoController.consultarCliente);
router.get('/registro/:token', contratoController.consultarContratoCompleto);
router.get('/:token', contratoController.consultarContrato);

module.exports = router;
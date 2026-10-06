'use strict';

// Subida de comprobantes de pago desde la web (checkout menu.html).
// - POST /api/receipt (público): requiere X-Order-Token + rate-limit.
//   Guarda la imagen en uploads/receipts/ (volumen compartido con web)
//   y responde { url: 'img/uploaded/receipts/<archivo>' }.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireOrderToken, rateLimit } = require('../rateLimit');
const { wrap } = require('../http');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const receiptsDir = path.join(uploadsDir, 'receipts');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const storage = multer.diskStorage({
  destination: receiptsDir,
  filename: (req, file, cb) => {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Solo imágenes JPG, PNG o WebP.'));
    cb(null, true);
  },
});

router.post('/receipt',
  rateLimit({ windowMs: 60000, max: 6 }),
  requireOrderToken,
  upload.single('receipt'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Adjunta el comprobante (imagen).' });
    res.status(201).json({ url: 'img/uploaded/receipts/' + req.file.filename });
  })
);

module.exports = router;
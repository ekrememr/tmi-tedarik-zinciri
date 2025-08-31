const express = require('express');
const database = require('../config/database');
const { authenticateSession, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Genel request route'ları (hem admin hem de tedarikçi erişebilir)

// 📋 KATEGORİLER
router.get('/categories', async (req, res) => {
    try {
        const categories = await database.all(`
            SELECT * FROM categories 
            WHERE is_active = 1 
            ORDER BY name
        `);

        res.json({
            success: true,
            categories
        });
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Kategoriler alınırken hata oluştu'
        });
    }
});

module.exports = router;
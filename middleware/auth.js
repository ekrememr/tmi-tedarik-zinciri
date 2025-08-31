const jwt = require('jsonwebtoken');
const database = require('../config/database');

// JWT Token doğrulama (Tedarikçiler için)
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token gerekli' 
            });
        }

        // Token doğrula
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Kullanıcıyı veritabanından getir
        const user = await database.get(
            'SELECT u.*, s.company_name, s.is_approved FROM users u LEFT JOIN suppliers s ON u.id = s.user_id WHERE u.id = ? AND u.is_active = 1',
            [decoded.userId]
        );

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Geçersiz token' 
            });
        }

        // Kullanıcı bilgilerini request'e ekle
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token süresi dolmuş' 
            });
        }
        
        return res.status(403).json({ 
            success: false, 
            message: 'Token doğrulanamadı' 
        });
    }
};

// Session doğrulama (Admin için)
const authenticateSession = async (req, res, next) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Giriş yapmanız gerekli' 
            });
        }

        // Kullanıcıyı veritabanından getir
        const user = await database.get(
            'SELECT * FROM users WHERE id = ? AND is_active = 1',
            [req.session.userId]
        );

        if (!user) {
            req.session.destroy();
            return res.status(401).json({ 
                success: false, 
                message: 'Geçersiz oturum' 
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Session auth error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Oturum doğrulama hatası' 
        });
    }
};

// Admin yetkisi kontrolü
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Admin yetkisi gerekli' 
        });
    }
    next();
};

// Tedarikçi yetkisi kontrolü
const requireSupplier = (req, res, next) => {
    if (!req.user || req.user.role !== 'supplier') {
        return res.status(403).json({ 
            success: false, 
            message: 'Tedarikçi yetkisi gerekli' 
        });
    }
    next();
};

// Onaylanmış tedarikçi kontrolü
const requireApprovedSupplier = (req, res, next) => {
    if (!req.user || req.user.role !== 'supplier' || !req.user.is_approved) {
        return res.status(403).json({ 
            success: false, 
            message: 'Onaylanmış tedarikçi yetkisi gerekli' 
        });
    }
    next();
};

// Genel authentication wrapper
const authenticate = (type = 'session') => {
    if (type === 'token') {
        return authenticateToken;
    } else {
        return authenticateSession;
    }
};

// Çoklu rol kontrolü
const requireRole = (roles = []) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                message: 'Yetki yetersiz' 
            });
        }
        next();
    };
};

// Rate limiting helper
const createRateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
    const rateLimit = require('express-rate-limit');
    
    return rateLimit({
        windowMs,
        max,
        message: {
            success: false,
            message: 'Çok fazla istek gönderildi, lütfen bekleyin'
        },
        standardHeaders: true,
        legacyHeaders: false
    });
};

module.exports = {
    authenticateToken,
    authenticateSession,
    requireAdmin,
    requireSupplier,
    requireApprovedSupplier,
    authenticate,
    requireRole,
    createRateLimit
};
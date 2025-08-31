const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');
const { validateLogin, validateUserRegistration, validateEmail } = require('../middleware/validation');
const { authenticateSession, authenticateToken, createRateLimit } = require('../middleware/auth');

const router = express.Router();

// Giriş rate limiting (5 dakikada 10 deneme)
const loginLimiter = createRateLimit(5 * 60 * 1000, 10);

// 🔐 ADMIN LOGIN (Session-based)
router.post('/login', loginLimiter, validateLogin, async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body;

        // Kullanıcıyı bul
        const user = await database.get(
            'SELECT * FROM users WHERE username = ? AND is_active = 1', 
            [username]
        );

        if (!user) {
            // Audit log
            await database.run(
                'INSERT INTO audit_logs (action, ip_address, user_agent, created_at) VALUES (?, ?, ?, datetime("now"))',
                ['failed_login_attempt', req.ip, req.get('User-Agent')]
            );

            return res.status(401).json({
                success: false,
                message: 'Kullanıcı adı veya şifre hatalı'
            });
        }

        // Şifre kontrolü
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            // Audit log
            await database.run(
                'INSERT INTO audit_logs (user_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
                [user.id, 'failed_password_attempt', req.ip, req.get('User-Agent')]
            );

            return res.status(401).json({
                success: false,
                message: 'Kullanıcı adı veya şifre hatalı'
            });
        }

        // Session oluştur (Admin için)
        if (user.role === 'admin') {
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role;

            if (rememberMe) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 gün
            }
        }

        // Son giriş tarihini güncelle
        await database.run(
            'UPDATE users SET last_login = datetime("now") WHERE id = ?',
            [user.id]
        );

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [user.id, 'successful_login', req.ip, req.get('User-Agent')]
        );

        // Response
        const response = {
            success: true,
            message: 'Giriş başarılı',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        };

        // JWT token (Tedarikçiler için)
        if (user.role === 'supplier') {
            const token = jwt.sign(
                { userId: user.id, username: user.username, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            response.token = token;

            // Tedarikçi ek bilgileri
            const supplier = await database.get(
                'SELECT * FROM suppliers WHERE user_id = ?',
                [user.id]
            );

            if (supplier) {
                response.user.company_name = supplier.company_name;
                response.user.is_approved = supplier.is_approved;
            }
        }

        res.json(response);

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Giriş işlemi sırasında hata oluştu'
        });
    }
});

// 📝 TEDARİKÇİ KAYIT
router.post('/register', validateUserRegistration, async (req, res) => {
    try {
        const { 
            username, 
            email, 
            password, 
            company_name, 
            contact_person, 
            phone, 
            address, 
            city, 
            categories 
        } = req.body;

        // Kullanıcı adı ve email kontrolü
        const existingUser = await database.get(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Bu kullanıcı adı veya email zaten kullanılıyor'
            });
        }

        // Şifre hash
        const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || 12));

        // Transaction başlat
        await database.beginTransaction();

        try {
            // Kullanıcı oluştur
            const userResult = await database.run(
                'INSERT INTO users (username, email, password_hash, role, is_active, email_verified) VALUES (?, ?, ?, ?, ?, ?)',
                [username, email, hashedPassword, 'supplier', 1, 0]
            );

            // Tedarikçi profili oluştur
            await database.run(
                `INSERT INTO suppliers (
                    user_id, company_name, contact_person, phone, address, city, categories, is_approved
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userResult.id, company_name, contact_person, phone, address, city, categories, 0]
            );

            // Bildirim oluştur (Admin'e)
            const adminUsers = await database.all('SELECT id FROM users WHERE role = "admin"');
            for (const admin of adminUsers) {
                await database.run(
                    `INSERT INTO notifications (
                        user_id, type, title, message, data
                    ) VALUES (?, ?, ?, ?, ?)`,
                    [
                        admin.id,
                        'approval',
                        'Yeni Tedarikçi Kaydı',
                        `${company_name} şirketi sistem kaydı için onay bekliyor`,
                        JSON.stringify({ supplier_id: userResult.id, company_name })
                    ]
                );
            }

            // Transaction commit
            await database.commit();

            // Audit log
            await database.run(
                'INSERT INTO audit_logs (user_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
                [userResult.id, 'supplier_registration', req.ip, req.get('User-Agent')]
            );

            res.status(201).json({
                success: true,
                message: 'Kayıt başarılı! Onay için bekleyiniz.',
                user: {
                    id: userResult.id,
                    username,
                    email,
                    company_name,
                    is_approved: false
                }
            });

        } catch (error) {
            await database.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Kayıt işlemi sırasında hata oluştu'
        });
    }
});

// 🚪 ÇIKIŞ
router.post('/logout', (req, res) => {
    try {
        const userId = req.session?.userId;
        
        // Session'ı yoket
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Çıkış işlemi sırasında hata oluştu'
                });
            }

            // Audit log
            if (userId) {
                database.run(
                    'INSERT INTO audit_logs (user_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
                    [userId, 'logout', req.ip, req.get('User-Agent')]
                ).catch(console.error);
            }

            res.json({
                success: true,
                message: 'Başarıyla çıkış yapıldı'
            });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Çıkış işlemi sırasında hata oluştu'
        });
    }
});

// 👤 PROFIL BİLGİSİ
router.get('/profile', authenticateSession, async (req, res) => {
    try {
        const user = req.user;
        const response = {
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                last_login: user.last_login,
                created_at: user.created_at
            }
        };

        // Tedarikçi ek bilgileri
        if (user.role === 'supplier') {
            const supplier = await database.get(
                'SELECT * FROM suppliers WHERE user_id = ?',
                [user.id]
            );

            if (supplier) {
                response.user.supplier = {
                    company_name: supplier.company_name,
                    tax_number: supplier.tax_number,
                    contact_person: supplier.contact_person,
                    phone: supplier.phone,
                    address: supplier.address,
                    city: supplier.city,
                    categories: supplier.categories,
                    rating: supplier.rating,
                    is_approved: supplier.is_approved,
                    total_quotations: supplier.total_quotations,
                    successful_quotations: supplier.successful_quotations
                };
            }
        }

        res.json(response);
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Profil bilgisi alınırken hata oluştu'
        });
    }
});

// 🔄 TOKEN YENİLE (Tedarikçi)
router.post('/refresh-token', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        // Yeni token oluştur
        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            success: true,
            token,
            message: 'Token yenilendi'
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Token yenileme hatası'
        });
    }
});

// 📧 ŞİFRE SIFIRLAMA TALEBİ
router.post('/forgot-password', validateEmail, async (req, res) => {
    try {
        const { email } = req.body;

        const user = await database.get(
            'SELECT * FROM users WHERE email = ? AND is_active = 1',
            [email]
        );

        if (!user) {
            // Güvenlik için her zaman başarılı mesaj
            return res.json({
                success: true,
                message: 'Eğer bu email kayıtlı ise şifre sıfırlama linki gönderildi'
            });
        }

        // Reset token oluştur
        const resetToken = uuidv4();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 saat

        // Token'ı veritabanına kaydet (normalde ayrı tablo olur)
        await database.run(
            'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
            [resetToken, resetExpires.toISOString(), user.id]
        );

        // Email gönder (şimdilik log)
        console.log(`🔑 Password Reset Token for ${email}: ${resetToken}`);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [user.id, 'password_reset_request', req.ip, req.get('User-Agent')]
        );

        res.json({
            success: true,
            message: 'Eğer bu email kayıtlı ise şifre sıfırlama linki gönderildi'
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Şifre sıfırlama talebi işlenirken hata oluştu'
        });
    }
});

// ✅ TOKEN DOĞRULAMA
router.get('/verify', authenticateSession, (req, res) => {
    res.json({
        success: true,
        message: 'Token geçerli',
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// 📊 AUTH İSTATİSTİKLERİ (Admin)
router.get('/stats', authenticateSession, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin yetkisi gerekli'
            });
        }

        const stats = {
            total_users: await database.get('SELECT COUNT(*) as count FROM users'),
            active_users: await database.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1'),
            total_suppliers: await database.get('SELECT COUNT(*) as count FROM suppliers'),
            approved_suppliers: await database.get('SELECT COUNT(*) as count FROM suppliers WHERE is_approved = 1'),
            pending_approvals: await database.get('SELECT COUNT(*) as count FROM suppliers WHERE is_approved = 0'),
            recent_logins: await database.get('SELECT COUNT(*) as count FROM users WHERE last_login > datetime("now", "-1 day")'),
            failed_attempts: await database.get('SELECT COUNT(*) as count FROM audit_logs WHERE action LIKE "%failed%" AND created_at > datetime("now", "-1 day")')
        };

        res.json({
            success: true,
            stats: {
                total_users: stats.total_users.count,
                active_users: stats.active_users.count,
                total_suppliers: stats.total_suppliers.count,
                approved_suppliers: stats.approved_suppliers.count,
                pending_approvals: stats.pending_approvals.count,
                recent_logins: stats.recent_logins.count,
                failed_attempts: stats.failed_attempts.count
            }
        });
    } catch (error) {
        console.error('Auth stats error:', error);
        res.status(500).json({
            success: false,
            message: 'İstatistik bilgisi alınırken hata oluştu'
        });
    }
});

module.exports = router;
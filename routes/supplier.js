const express = require('express');
const database = require('../config/database');
const { authenticateToken, requireApprovedSupplier } = require('../middleware/auth');
const { validateId, validatePagination, validateQuotation, validateSupplierProfile } = require('../middleware/validation');

const router = express.Router();

// Tedarikçi authentication middleware
router.use(authenticateToken);

// 📊 TEDARİKÇİ DASHBOARD
router.get('/dashboard', async (req, res) => {
    try {
        const supplierId = req.user.supplier_id || await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        if (!supplierId) {
            return res.status(404).json({
                success: false,
                message: 'Tedarikçi profili bulunamadı'
            });
        }

        const dashboard = {
            // Temel istatistikler
            stats: {
                active_requests: await database.get(`
                    SELECT COUNT(*) as count FROM request_suppliers rs
                    JOIN requests r ON rs.request_id = r.id
                    WHERE rs.supplier_id = ? AND r.status = 'active' AND rs.status = 'invited'
                `, [supplierId]),

                submitted_quotations: await database.get(`
                    SELECT COUNT(*) as count FROM quotations
                    WHERE supplier_id = ? AND status = 'submitted'
                `, [supplierId]),

                won_quotations: await database.get(`
                    SELECT COUNT(*) as count FROM quotations
                    WHERE supplier_id = ? AND status = 'accepted'
                `, [supplierId]),

                total_value: await database.get(`
                    SELECT COALESCE(SUM(total_amount), 0) as total FROM quotations
                    WHERE supplier_id = ? AND status IN ('submitted', 'accepted')
                `, [supplierId])
            },

            // Yaklaşan deadlineler
            upcoming_deadlines: await database.all(`
                SELECT r.id, r.title, r.deadline, r.priority,
                       ROUND(julianday(r.deadline) - julianday('now')) as days_left
                FROM request_suppliers rs
                JOIN requests r ON rs.request_id = r.id
                WHERE rs.supplier_id = ? AND r.status = 'active' 
                  AND rs.status = 'invited' AND r.deadline IS NOT NULL
                  AND r.deadline > datetime('now')
                ORDER BY r.deadline ASC
                LIMIT 5
            `, [supplierId]),

            // Son aktiviteler
            recent_activity: await database.all(`
                SELECT 
                    'request' as type, r.id, r.title as title, rs.invitation_date as date,
                    'Yeni teklif talebi' as action
                FROM request_suppliers rs
                JOIN requests r ON rs.request_id = r.id
                WHERE rs.supplier_id = ? AND rs.invitation_date >= datetime('now', '-7 days')
                UNION ALL
                SELECT 
                    'quotation' as type, q.request_id as id, r.title, q.submission_date as date,
                    CASE 
                        WHEN q.status = 'submitted' THEN 'Teklif gönderildi'
                        WHEN q.status = 'accepted' THEN 'Teklif kabul edildi'
                        WHEN q.status = 'rejected' THEN 'Teklif reddedildi'
                    END as action
                FROM quotations q
                JOIN requests r ON q.request_id = r.id
                WHERE q.supplier_id = ? AND q.updated_at >= datetime('now', '-7 days')
                ORDER BY date DESC
                LIMIT 10
            `, [supplierId, supplierId]),

            // Performans metrikleri
            performance: {
                response_rate: await database.get(`
                    SELECT 
                        COUNT(*) as invited,
                        SUM(CASE WHEN rs.status != 'invited' THEN 1 ELSE 0 END) as responded,
                        ROUND(SUM(CASE WHEN rs.status != 'invited' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as rate
                    FROM request_suppliers rs
                    WHERE rs.supplier_id = ?
                `, [supplierId]),

                win_rate: await database.get(`
                    SELECT 
                        COUNT(*) as total_quotations,
                        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as won_quotations,
                        ROUND(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as rate
                    FROM quotations
                    WHERE supplier_id = ?
                `, [supplierId])
            }
        };

        res.json({
            success: true,
            dashboard
        });
    } catch (error) {
        console.error('Supplier dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Dashboard verileri alınırken hata oluştu'
        });
    }
});

// 📋 AKTİF TALEPLER
router.get('/requests', requireApprovedSupplier, validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, priority } = req.query;
        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        let whereConditions = ['rs.supplier_id = ?'];
        let params = [supplierId];

        if (status) {
            if (status === 'active') {
                whereConditions.push('r.status = "active"');
            } else if (status === 'quoted') {
                whereConditions.push('rs.status = "quoted"');
            } else if (status === 'unquoted') {
                whereConditions.push('rs.status = "invited"');
            }
        }

        if (priority) {
            whereConditions.push('r.priority = ?');
            params.push(priority);
        }

        const whereClause = 'WHERE ' + whereConditions.join(' AND ');

        const baseQuery = `
            SELECT 
                r.id, r.request_no, r.title, r.description, r.deadline, r.priority, r.status,
                r.created_at, rs.status as invitation_status, rs.invitation_date,
                COUNT(ri.id) as total_items,
                q.id as quotation_id, q.status as quotation_status, q.submission_date,
                ROUND(julianday(r.deadline) - julianday('now')) as days_left
            FROM request_suppliers rs
            JOIN requests r ON rs.request_id = r.id
            LEFT JOIN request_items ri ON r.id = ri.request_id
            LEFT JOIN quotations q ON r.id = q.request_id AND q.supplier_id = rs.supplier_id
            ${whereClause}
            GROUP BY r.id
            ORDER BY r.created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(DISTINCT r.id) as count
            FROM request_suppliers rs
            JOIN requests r ON rs.request_id = r.id
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Supplier requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Talep listesi alınırken hata oluştu'
        });
    }
});

// 📄 TALEP DETAYI
router.get('/requests/:id', requireApprovedSupplier, validateId, async (req, res) => {
    try {
        const requestId = req.params.id;
        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        // Tedarikçi bu talebe davet edilmiş mi kontrol et
        const invitation = await database.get(`
            SELECT * FROM request_suppliers 
            WHERE request_id = ? AND supplier_id = ?
        `, [requestId, supplierId]);

        if (!invitation) {
            return res.status(403).json({
                success: false,
                message: 'Bu talebe erişim yetkiniz yok'
            });
        }

        // Talep bilgileri
        const request = await database.get(`
            SELECT r.*, u.username as created_by_name
            FROM requests r
            LEFT JOIN users u ON r.created_by = u.id
            WHERE r.id = ?
        `, [requestId]);

        // Talep malzemeleri
        const items = await database.all(`
            SELECT * FROM request_items 
            WHERE request_id = ? 
            ORDER BY item_no
        `, [requestId]);

        // Mevcut teklif
        const quotation = await database.get(`
            SELECT * FROM quotations 
            WHERE request_id = ? AND supplier_id = ?
        `, [requestId, supplierId]);

        // Teklif malzemeleri (varsa)
        let quotationItems = [];
        if (quotation) {
            quotationItems = await database.all(`
                SELECT * FROM quotation_items 
                WHERE quotation_id = ?
                ORDER BY request_item_id
            `, [quotation.id]);
        }

        // Talebe bakıldığını işaretle
        if (invitation.status === 'invited') {
            await database.run(`
                UPDATE request_suppliers 
                SET status = 'viewed', response_date = datetime('now')
                WHERE request_id = ? AND supplier_id = ?
            `, [requestId, supplierId]);
        }

        res.json({
            success: true,
            request,
            items,
            invitation,
            quotation,
            quotation_items: quotationItems
        });
    } catch (error) {
        console.error('Supplier request detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Talep detayı alınırken hata oluştu'
        });
    }
});

// 💰 TEKLİF GÖNDER/GÜNCELLE
router.post('/requests/:id/quote', requireApprovedSupplier, validateId, validateQuotation, async (req, res) => {
    try {
        const requestId = req.params.id;
        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);
        
        const { 
            delivery_time, 
            delivery_location, 
            payment_terms, 
            validity_days = 30, 
            notes, 
            items 
        } = req.body;

        // Tedarikçi bu talebe davet edilmiş mi kontrol et
        const invitation = await database.get(`
            SELECT * FROM request_suppliers 
            WHERE request_id = ? AND supplier_id = ?
        `, [requestId, supplierId]);

        if (!invitation) {
            return res.status(403).json({
                success: false,
                message: 'Bu talebe teklif veremezsiniz'
            });
        }

        // Talep aktif mi kontrol et
        const request = await database.get('SELECT * FROM requests WHERE id = ? AND status = "active"', [requestId]);
        if (!request) {
            return res.status(400).json({
                success: false,
                message: 'Bu talep artık aktif değil'
            });
        }

        await database.beginTransaction();

        try {
            // Toplam tutarı hesapla
            const totalAmount = items.reduce((sum, item) => sum + item.total_price, 0);

            // Quotation number oluştur
            const quotationNo = `QUO${Date.now().toString().slice(-8)}${supplierId.toString().padStart(3, '0')}`;

            // Mevcut teklifi kontrol et
            const existingQuotation = await database.get(`
                SELECT id FROM quotations 
                WHERE request_id = ? AND supplier_id = ?
            `, [requestId, supplierId]);

            let quotationId;

            if (existingQuotation) {
                // Mevcut teklifi güncelle
                await database.run(`
                    UPDATE quotations 
                    SET total_amount = ?, delivery_time = ?, delivery_location = ?,
                        payment_terms = ?, validity_days = ?, notes = ?,
                        status = 'submitted', submission_date = datetime('now'),
                        updated_at = datetime('now')
                    WHERE id = ?
                `, [
                    totalAmount, delivery_time, delivery_location,
                    payment_terms, validity_days, notes, existingQuotation.id
                ]);

                quotationId = existingQuotation.id;

                // Eski malzeme tekliflerini sil
                await database.run('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId]);
            } else {
                // Yeni teklif oluştur
                const quotationResult = await database.run(`
                    INSERT INTO quotations (
                        quotation_no, request_id, supplier_id, total_amount, delivery_time,
                        delivery_location, payment_terms, validity_days, notes,
                        status, submission_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'))
                `, [
                    quotationNo, requestId, supplierId, totalAmount, delivery_time,
                    delivery_location, payment_terms, validity_days, notes
                ]);

                quotationId = quotationResult.id;
            }

            // Malzeme tekliflerini ekle
            for (const item of items) {
                await database.run(`
                    INSERT INTO quotation_items (
                        quotation_id, request_item_id, unit_price, total_price,
                        delivery_time, brand, model, origin_country, warranty_period, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    quotationId, item.request_item_id, item.unit_price, item.total_price,
                    item.delivery_time, item.brand, item.model, 
                    item.origin_country, item.warranty_period, item.notes
                ]);
            }

            // Request_suppliers durumunu güncelle
            await database.run(`
                UPDATE request_suppliers 
                SET status = 'quoted', response_date = datetime('now')
                WHERE request_id = ? AND supplier_id = ?
            `, [requestId, supplierId]);

            // Tedarikçi istatistiklerini güncelle
            if (!existingQuotation) {
                await database.run(`
                    UPDATE suppliers 
                    SET total_quotations = total_quotations + 1
                    WHERE id = ?
                `, [supplierId]);
            }

            // Admin'e bildirim gönder
            const adminUsers = await database.all('SELECT id FROM users WHERE role = "admin"');
            for (const admin of adminUsers) {
                await database.run(`
                    INSERT INTO notifications (user_id, type, title, message, data)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    admin.id,
                    'quotation',
                    'Yeni Teklif Alındı',
                    `${req.user.company_name} "${request.title}" talebi için teklif verdi`,
                    JSON.stringify({ quotation_id: quotationId, request_id: requestId })
                ]);
            }

            await database.commit();

            // Audit log
            await database.run(
                'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
                [req.user.id, existingQuotation ? 'quotation_updated' : 'quotation_created', 'quotations', quotationId, JSON.stringify({ total_amount: totalAmount, total_items: items.length })]
            );

            res.json({
                success: true,
                message: existingQuotation ? 'Teklif başarıyla güncellendi' : 'Teklif başarıyla gönderildi',
                quotation: {
                    id: quotationId,
                    quotation_no: quotationNo,
                    total_amount: totalAmount,
                    total_items: items.length
                }
            });

        } catch (error) {
            await database.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Submit quotation error:', error);
        res.status(500).json({
            success: false,
            message: 'Teklif gönderilirken hata oluştu'
        });
    }
});

// 📊 TEKLİF GEÇMİŞİ
router.get('/quotations', validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        let whereConditions = ['q.supplier_id = ?'];
        let params = [supplierId];

        if (status) {
            whereConditions.push('q.status = ?');
            params.push(status);
        }

        const whereClause = 'WHERE ' + whereConditions.join(' AND ');

        const baseQuery = `
            SELECT 
                q.*, r.title as request_title, r.request_no,
                COUNT(qi.id) as total_items
            FROM quotations q
            JOIN requests r ON q.request_id = r.id
            LEFT JOIN quotation_items qi ON q.id = qi.quotation_id
            ${whereClause}
            GROUP BY q.id
            ORDER BY q.created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(*) as count
            FROM quotations q
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Supplier quotations error:', error);
        res.status(500).json({
            success: false,
            message: 'Teklif geçmişi alınırken hata oluştu'
        });
    }
});

// 📄 TEKLİF DETAYI
router.get('/quotations/:id', validateId, async (req, res) => {
    try {
        const quotationId = req.params.id;
        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        const quotation = await database.get(`
            SELECT q.*, r.title as request_title, r.request_no, r.description
            FROM quotations q
            JOIN requests r ON q.request_id = r.id
            WHERE q.id = ? AND q.supplier_id = ?
        `, [quotationId, supplierId]);

        if (!quotation) {
            return res.status(404).json({
                success: false,
                message: 'Teklif bulunamadı'
            });
        }

        const items = await database.all(`
            SELECT qi.*, ri.material_name, ri.quantity, ri.unit, ri.specifications
            FROM quotation_items qi
            JOIN request_items ri ON qi.request_item_id = ri.id
            WHERE qi.quotation_id = ?
            ORDER BY ri.item_no
        `, [quotationId]);

        res.json({
            success: true,
            quotation,
            items
        });
    } catch (error) {
        console.error('Quotation detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Teklif detayı alınırken hata oluştu'
        });
    }
});

// 👤 PROFİL GÜNCELLEME
router.put('/profile', validateSupplierProfile, async (req, res) => {
    try {
        const {
            company_name,
            tax_number,
            contact_person,
            phone,
            address,
            city,
            categories
        } = req.body;

        const supplierId = await database.get('SELECT id FROM suppliers WHERE user_id = ?', [req.user.id]).then(r => r?.id);

        if (!supplierId) {
            return res.status(404).json({
                success: false,
                message: 'Tedarikçi profili bulunamadı'
            });
        }

        await database.run(`
            UPDATE suppliers 
            SET company_name = ?, tax_number = ?, contact_person = ?, phone = ?,
                address = ?, city = ?, categories = ?, updated_at = datetime('now')
            WHERE id = ?
        `, [company_name, tax_number, contact_person, phone, address, city, categories, supplierId]);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'profile_updated', 'suppliers', supplierId, JSON.stringify({ company_name, phone, city })]
        );

        res.json({
            success: true,
            message: 'Profil başarıyla güncellendi'
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Profil güncellenirken hata oluştu'
        });
    }
});

// 📢 BİLDİRİMLER
router.get('/notifications', validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 20, unread_only } = req.query;

        let whereConditions = ['user_id = ?'];
        let params = [req.user.id];

        if (unread_only === 'true') {
            whereConditions.push('is_read = 0');
        }

        const whereClause = 'WHERE ' + whereConditions.join(' AND ');

        const baseQuery = `
            SELECT * FROM notifications
            ${whereClause}
            ORDER BY created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(*) as count FROM notifications
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Bildirimler alınırken hata oluştu'
        });
    }
});

// ✅ BİLDİRİMİ OKUNDU OLARAK İŞARETLE
router.put('/notifications/:id/read', validateId, async (req, res) => {
    try {
        const notificationId = req.params.id;

        const result = await database.run(`
            UPDATE notifications 
            SET is_read = 1 
            WHERE id = ? AND user_id = ?
        `, [notificationId, req.user.id]);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bildirim bulunamadı'
            });
        }

        res.json({
            success: true,
            message: 'Bildirim okundu olarak işaretlendi'
        });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({
            success: false,
            message: 'Bildirim güncellenirken hata oluştu'
        });
    }
});

module.exports = router;
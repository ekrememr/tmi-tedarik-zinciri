const express = require('express');
const database = require('../config/database');
const { authenticateSession, requireAdmin } = require('../middleware/auth');
const { validateId, validatePagination, validateRequest } = require('../middleware/validation');
const moment = require('moment');

const router = express.Router();

// Admin authentication middleware
router.use(authenticateSession);
router.use(requireAdmin);

// 📊 DASHBOARD ANALİTİKS
router.get('/dashboard', async (req, res) => {
    try {
        const dashboard = {
            // Genel İstatistikler
            stats: {
                total_requests: await database.get('SELECT COUNT(*) as count FROM requests'),
                active_requests: await database.get('SELECT COUNT(*) as count FROM requests WHERE status = "active"'),
                total_quotations: await database.get('SELECT COUNT(*) as count FROM quotations'),
                pending_quotations: await database.get('SELECT COUNT(*) as count FROM quotations WHERE status = "draft"'),
                total_suppliers: await database.get('SELECT COUNT(*) as count FROM suppliers'),
                approved_suppliers: await database.get('SELECT COUNT(*) as count FROM suppliers WHERE is_approved = 1'),
                pending_approvals: await database.get('SELECT COUNT(*) as count FROM suppliers WHERE is_approved = 0'),
                total_value: await database.get('SELECT COALESCE(SUM(total_amount), 0) as total FROM quotations WHERE status = "submitted"')
            },

            // Son aktiviteler
            recent_activity: await database.all(`
                SELECT 
                    'request' as type,
                    r.title as title,
                    'Yeni talep oluşturuldu' as action,
                    r.created_at as date
                FROM requests r
                WHERE r.created_at >= datetime('now', '-7 days')
                UNION ALL
                SELECT 
                    'quotation' as type,
                    'Teklif #' || q.id as title,
                    'Yeni teklif alındı - ' || s.company_name as action,
                    q.created_at as date
                FROM quotations q
                JOIN suppliers s ON q.supplier_id = s.id
                WHERE q.created_at >= datetime('now', '-7 days')
                UNION ALL
                SELECT 
                    'supplier' as type,
                    s.company_name as title,
                    'Yeni tedarikçi kaydı' as action,
                    s.created_at as date
                FROM suppliers s
                WHERE s.created_at >= datetime('now', '-7 days')
                ORDER BY date DESC
                LIMIT 20
            `),

            // Top Tedarikçiler
            top_suppliers: await database.all(`
                SELECT 
                    s.company_name,
                    s.rating,
                    s.total_quotations,
                    s.successful_quotations,
                    ROUND((s.successful_quotations * 100.0) / NULLIF(s.total_quotations, 0), 1) as success_rate
                FROM suppliers s
                WHERE s.is_approved = 1 AND s.total_quotations > 0
                ORDER BY s.rating DESC, success_rate DESC
                LIMIT 5
            `),

            // Son Aktiviteler
            recent_requests: await database.all(`
                SELECT 
                    r.id, r.title, r.status, r.priority, r.created_at,
                    COUNT(rs.supplier_id) as invited_suppliers,
                    COUNT(q.id) as received_quotations
                FROM requests r
                LEFT JOIN request_suppliers rs ON r.id = rs.request_id
                LEFT JOIN quotations q ON r.id = q.request_id AND q.status = 'submitted'
                GROUP BY r.id
                ORDER BY r.created_at DESC
                LIMIT 10
            `),

            // Pending İşlemler
            pending_items: {
                supplier_approvals: await database.all(`
                    SELECT s.id, s.company_name, s.contact_person, s.created_at, u.email
                    FROM suppliers s
                    JOIN users u ON s.user_id = u.id
                    WHERE s.is_approved = 0
                    ORDER BY s.created_at ASC
                `),
                expiring_quotations: await database.all(`
                    SELECT q.id, q.quotation_no, r.title, s.company_name,
                           DATE(q.submission_date, '+' || q.validity_days || ' days') as expires_at
                    FROM quotations q
                    JOIN requests r ON q.request_id = r.id
                    JOIN suppliers s ON q.supplier_id = s.id
                    WHERE q.status = 'submitted' 
                      AND datetime(q.submission_date, '+' || q.validity_days || ' days') <= datetime('now', '+7 days')
                    ORDER BY expires_at ASC
                `)
            }
        };

        res.json({
            success: true,
            dashboard
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Dashboard verileri alınırken hata oluştu'
        });
    }
});

// 🏢 TEDARİKÇİ YÖNETİMİ

// Tüm tedarikçileri listele
router.get('/suppliers', validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search, category } = req.query;

        let whereConditions = [];
        let params = [];

        if (status) {
            whereConditions.push('s.is_approved = ?');
            params.push(status === 'approved' ? 1 : 0);
        }

        if (search) {
            whereConditions.push('(s.company_name LIKE ? OR s.contact_person LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (category) {
            whereConditions.push('s.categories LIKE ?');
            params.push(`%${category}%`);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const baseQuery = `
            SELECT 
                s.id, s.company_name, s.tax_number, s.contact_person, s.phone, s.city,
                s.categories, s.rating, s.total_quotations, s.successful_quotations,
                s.is_approved, s.created_at, u.email, u.username, u.last_login
            FROM suppliers s
            JOIN users u ON s.user_id = u.id
            ${whereClause}
            ORDER BY s.created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(*) as count
            FROM suppliers s
            JOIN users u ON s.user_id = u.id
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Suppliers list error:', error);
        res.status(500).json({
            success: false,
            message: 'Tedarikçi listesi alınırken hata oluştu'
        });
    }
});

// Tedarikçi detayı
router.get('/suppliers/:id', validateId, async (req, res) => {
    try {
        const supplierId = req.params.id;

        const supplier = await database.get(`
            SELECT 
                s.*, u.username, u.email, u.last_login, u.created_at as user_created_at
            FROM suppliers s
            JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        `, [supplierId]);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Tedarikçi bulunamadı'
            });
        }

        // Teklif geçmişi
        const quotations = await database.all(`
            SELECT 
                q.id, q.quotation_no, q.total_amount, q.currency, q.status,
                q.submission_date, r.title as request_title
            FROM quotations q
            JOIN requests r ON q.request_id = r.id
            WHERE q.supplier_id = ?
            ORDER BY q.submission_date DESC
            LIMIT 10
        `, [supplierId]);

        // Son aktiviteler
        const activities = await database.all(`
            SELECT action, created_at, old_values, new_values
            FROM audit_logs
            WHERE user_id = (SELECT user_id FROM suppliers WHERE id = ?)
            ORDER BY created_at DESC
            LIMIT 20
        `, [supplierId]);

        res.json({
            success: true,
            supplier,
            quotations,
            activities
        });
    } catch (error) {
        console.error('Supplier detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Tedarikçi detayı alınırken hata oluştu'
        });
    }
});

// Tedarikçi onaylama/reddetme
router.post('/suppliers/:id/approve', validateId, async (req, res) => {
    try {
        const supplierId = req.params.id;
        const { approved, notes } = req.body;

        const supplier = await database.get('SELECT * FROM suppliers WHERE id = ?', [supplierId]);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Tedarikçi bulunamadı'
            });
        }

        // Durumu güncelle
        await database.run(`
            UPDATE suppliers 
            SET is_approved = ?, approval_date = datetime('now'), notes = ?
            WHERE id = ?
        `, [approved ? 1 : 0, notes, supplierId]);

        // Bildirim oluştur
        await database.run(`
            INSERT INTO notifications (user_id, type, title, message)
            VALUES (?, ?, ?, ?)
        `, [
            supplier.user_id,
            'approval',
            approved ? 'Başvurunuz Onaylandı' : 'Başvurunuz Reddedildi',
            approved ? 
                'Tebrikler! Tedarikçi başvurunuz onaylandı. Artık tekliflere katılabilirsiniz.' :
                `Üzgünüz, tedarikçi başvurunuz reddedildi. Sebep: ${notes || 'Belirtilmemiş'}`
        ]);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.user.id, approved ? 'supplier_approved' : 'supplier_rejected', 'suppliers', supplierId, JSON.stringify({ approved, notes })]
        );

        res.json({
            success: true,
            message: approved ? 'Tedarikçi başarıyla onaylandı' : 'Tedarikçi reddedildi'
        });
    } catch (error) {
        console.error('Supplier approve error:', error);
        res.status(500).json({
            success: false,
            message: 'Onay işlemi sırasında hata oluştu'
        });
    }
});

// 📋 TALEP YÖNETİMİ

// Tüm talepleri listele
router.get('/requests', validatePagination, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, priority, search } = req.query;

        let whereConditions = [];
        let params = [];

        if (status) {
            whereConditions.push('r.status = ?');
            params.push(status);
        }

        if (priority) {
            whereConditions.push('r.priority = ?');
            params.push(priority);
        }

        if (search) {
            whereConditions.push('(r.title LIKE ? OR r.description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const baseQuery = `
            SELECT 
                r.*, u.username as created_by_name,
                COUNT(DISTINCT rs.supplier_id) as invited_suppliers,
                COUNT(DISTINCT q.id) as received_quotations,
                COUNT(DISTINCT ri.id) as total_items
            FROM requests r
            LEFT JOIN users u ON r.created_by = u.id
            LEFT JOIN request_suppliers rs ON r.id = rs.request_id
            LEFT JOIN quotations q ON r.id = q.request_id AND q.status = 'submitted'
            LEFT JOIN request_items ri ON r.id = ri.request_id
            ${whereClause}
            GROUP BY r.id
            ORDER BY r.created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(DISTINCT r.id) as count
            FROM requests r
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Requests list error:', error);
        res.status(500).json({
            success: false,
            message: 'Talep listesi alınırken hata oluştu'
        });
    }
});

// Yeni talep oluştur
router.post('/requests', validateRequest, async (req, res) => {
    try {
        const { title, description, deadline, priority, items, supplier_ids } = req.body;

        await database.beginTransaction();

        try {
            // Request number oluştur
            const requestNo = `REQ${Date.now().toString().slice(-8)}`;

            // Talebi oluştur
            const requestResult = await database.run(`
                INSERT INTO requests (
                    request_no, title, description, deadline, priority, created_by,
                    total_items, total_suppliers, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                requestNo, title, description, deadline, priority || 'normal',
                req.user.id, items.length, supplier_ids.length, 'active'
            ]);

            const requestId = requestResult.id;

            // Malzemeleri ekle
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await database.run(`
                    INSERT INTO request_items (
                        request_id, item_no, material_code, material_name, 
                        quantity, unit, specifications, category, priority
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    requestId, i + 1, item.material_code || null,
                    item.material_name, item.quantity, item.unit,
                    item.specifications || null, item.category || null,
                    item.priority || 'normal'
                ]);
            }

            // Tedarikçileri davet et
            for (const supplierId of supplier_ids) {
                await database.run(`
                    INSERT INTO request_suppliers (request_id, supplier_id, invitation_sent)
                    VALUES (?, ?, 1)
                `, [requestId, supplierId]);

                // Bildirim oluştur
                await database.run(`
                    INSERT INTO notifications (user_id, type, title, message, data)
                    SELECT u.id, 'request', 'Yeni Teklif Talebi', ?, ?
                    FROM users u
                    JOIN suppliers s ON u.id = s.user_id
                    WHERE s.id = ?
                `, [
                    `"${title}" için teklif vermeniz bekleniyor`,
                    JSON.stringify({ request_id: requestId, request_no: requestNo }),
                    supplierId
                ]);
            }

            await database.commit();

            // Audit log
            await database.run(
                'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
                [req.user.id, 'request_created', 'requests', requestId, JSON.stringify({ title, total_items: items.length, total_suppliers: supplier_ids.length })]
            );

            res.status(201).json({
                success: true,
                message: 'Talep başarıyla oluşturuldu',
                request: {
                    id: requestId,
                    request_no: requestNo,
                    title,
                    total_items: items.length,
                    total_suppliers: supplier_ids.length
                }
            });

        } catch (error) {
            await database.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Create request error:', error);
        res.status(500).json({
            success: false,
            message: 'Talep oluşturulurken hata oluştu'
        });
    }
});

// 💰 TEKLİF KARŞILAŞTIRMA
router.get('/quotations/compare/:requestId', validateId, async (req, res) => {
    try {
        const requestId = req.params.requestId;

        // Talep bilgisi
        const request = await database.get(`
            SELECT r.*, u.username as created_by_name
            FROM requests r
            LEFT JOIN users u ON r.created_by = u.id
            WHERE r.id = ?
        `, [requestId]);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Talep bulunamadı'
            });
        }

        // Malzemeler
        const items = await database.all(`
            SELECT * FROM request_items 
            WHERE request_id = ? 
            ORDER BY item_no
        `, [requestId]);

        // Teklifler
        const quotations = await database.all(`
            SELECT 
                q.*, s.company_name, s.rating,
                qi.request_item_id, qi.unit_price, qi.total_price,
                qi.delivery_time as item_delivery_time, qi.brand, qi.model
            FROM quotations q
            JOIN suppliers s ON q.supplier_id = s.id
            LEFT JOIN quotation_items qi ON q.id = qi.quotation_id
            WHERE q.request_id = ? AND q.status = 'submitted'
            ORDER BY q.total_amount ASC
        `, [requestId]);

        // Teklifleri organize et
        const organizedQuotations = {};
        quotations.forEach(row => {
            if (!organizedQuotations[row.id]) {
                organizedQuotations[row.id] = {
                    id: row.id,
                    quotation_no: row.quotation_no,
                    supplier_id: row.supplier_id,
                    company_name: row.company_name,
                    rating: row.rating,
                    total_amount: row.total_amount,
                    currency: row.currency,
                    delivery_time: row.delivery_time,
                    payment_terms: row.payment_terms,
                    submission_date: row.submission_date,
                    items: []
                };
            }

            if (row.request_item_id) {
                organizedQuotations[row.id].items.push({
                    request_item_id: row.request_item_id,
                    unit_price: row.unit_price,
                    total_price: row.total_price,
                    delivery_time: row.item_delivery_time,
                    brand: row.brand,
                    model: row.model
                });
            }
        });

        res.json({
            success: true,
            request,
            items,
            quotations: Object.values(organizedQuotations)
        });
    } catch (error) {
        console.error('Quotation compare error:', error);
        res.status(500).json({
            success: false,
            message: 'Teklif karşılaştırması alınırken hata oluştu'
        });
    }
});

// 🏆 KAZANAN TEDARİKÇİ SEÇİMİ
router.post('/quotations/:quotationId/select-winner', validateId, async (req, res) => {
    try {
        const quotationId = req.params.quotationId;
        const { notes } = req.body;

        const quotation = await database.get(`
            SELECT q.*, r.title as request_title, s.company_name
            FROM quotations q
            JOIN requests r ON q.request_id = r.id
            JOIN suppliers s ON q.supplier_id = s.id
            WHERE q.id = ?
        `, [quotationId]);

        if (!quotation) {
            return res.status(404).json({
                success: false,
                message: 'Teklif bulunamadı'
            });
        }

        await database.beginTransaction();

        try {
            // Teklifi kabul et
            await database.run(`
                UPDATE quotations 
                SET status = 'accepted', updated_at = datetime('now')
                WHERE id = ?
            `, [quotationId]);

            // Diğer teklifleri reddet
            await database.run(`
                UPDATE quotations 
                SET status = 'rejected', updated_at = datetime('now')
                WHERE request_id = ? AND id != ?
            `, [quotation.request_id, quotationId]);

            // Talebi kapat
            await database.run(`
                UPDATE requests 
                SET status = 'closed', winner_supplier_id = ?, notes = ?, updated_at = datetime('now')
                WHERE id = ?
            `, [quotation.supplier_id, notes, quotation.request_id]);

            // Tedarikçi istatistiklerini güncelle
            await database.run(`
                UPDATE suppliers 
                SET successful_quotations = successful_quotations + 1
                WHERE id = ?
            `, [quotation.supplier_id]);

            // Bildirimleri gönder
            const allSuppliers = await database.all(`
                SELECT DISTINCT s.id, u.id as user_id, s.company_name
                FROM quotations q
                JOIN suppliers s ON q.supplier_id = s.id
                JOIN users u ON s.user_id = u.id
                WHERE q.request_id = ?
            `, [quotation.request_id]);

            for (const supplier of allSuppliers) {
                const isWinner = supplier.id === quotation.supplier_id;
                await database.run(`
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES (?, ?, ?, ?)
                `, [
                    supplier.user_id,
                    'quotation',
                    isWinner ? 'Tebrikler! Teklifiniz Kabul Edildi' : 'Teklifiniz Hakkında',
                    isWinner ? 
                        `"${quotation.request_title}" talebi için verdiğiniz teklif kabul edildi.` :
                        `"${quotation.request_title}" talebi için başka bir teklif kabul edildi.`
                ]);
            }

            await database.commit();

            // Audit log
            await database.run(
                'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
                [req.user.id, 'quotation_selected', 'quotations', quotationId, JSON.stringify({ winner_company: quotation.company_name, notes })]
            );

            res.json({
                success: true,
                message: `${quotation.company_name} kazanan tedarikçi olarak seçildi`
            });

        } catch (error) {
            await database.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Select winner error:', error);
        res.status(500).json({
            success: false,
            message: 'Kazanan seçimi sırasında hata oluştu'
        });
    }
});

module.exports = router;
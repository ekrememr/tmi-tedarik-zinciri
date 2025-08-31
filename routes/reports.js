const express = require('express');
const PDFKit = require('pdfkit');
const database = require('../config/database');
const { authenticateSession, requireAdmin } = require('../middleware/auth');
const { validateId } = require('../middleware/validation');
const moment = require('moment');

const router = express.Router();

// 📊 RAPORLAMA VE ANALİTİK

// Genel sistem raporu (Admin)
router.get('/dashboard', authenticateSession, requireAdmin, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let dateCondition = '';
        let params = [];

        if (start_date && end_date) {
            dateCondition = 'AND created_at BETWEEN ? AND ?';
            params = [start_date, end_date];
        }

        const report = {
            summary: {
                total_requests: await database.get(`SELECT COUNT(*) as count FROM requests WHERE 1=1 ${dateCondition}`, params),
                total_quotations: await database.get(`SELECT COUNT(*) as count FROM quotations WHERE 1=1 ${dateCondition}`, params),
                total_suppliers: await database.get('SELECT COUNT(*) as count FROM suppliers WHERE is_approved = 1'),
                total_value: await database.get(`SELECT COALESCE(SUM(total_amount), 0) as total FROM quotations WHERE status = 'submitted' ${dateCondition}`, params)
            },

            // Aylık trend
            monthly_stats: await database.all(`
                SELECT 
                    strftime('%Y-%m', created_at) as month,
                    COUNT(*) as request_count,
                    (SELECT COUNT(*) FROM quotations q WHERE strftime('%Y-%m', q.submission_date) = strftime('%Y-%m', r.created_at)) as quotation_count
                FROM requests r
                WHERE created_at >= date('now', '-12 months') ${dateCondition}
                GROUP BY strftime('%Y-%m', created_at)
                ORDER BY month DESC
                LIMIT 12
            `, params),

            // Kategori bazlı analiz
            category_stats: await database.all(`
                SELECT 
                    ri.category,
                    COUNT(*) as item_count,
                    COUNT(DISTINCT ri.request_id) as request_count,
                    COALESCE(AVG(qi.unit_price), 0) as avg_price
                FROM request_items ri
                LEFT JOIN quotation_items qi ON ri.id = qi.request_item_id
                WHERE ri.category IS NOT NULL AND ri.category != ''
                GROUP BY ri.category
                ORDER BY item_count DESC
            `),

            // Top tedarikçiler
            top_suppliers: await database.all(`
                SELECT 
                    s.company_name,
                    s.rating,
                    s.total_quotations,
                    s.successful_quotations,
                    ROUND((s.successful_quotations * 100.0) / NULLIF(s.total_quotations, 0), 1) as win_rate,
                    COALESCE(SUM(q.total_amount), 0) as total_value
                FROM suppliers s
                LEFT JOIN quotations q ON s.id = q.supplier_id AND q.status IN ('submitted', 'accepted')
                WHERE s.is_approved = 1
                GROUP BY s.id
                ORDER BY s.rating DESC, win_rate DESC
                LIMIT 10
            `),

            // Süreç performansı
            process_metrics: {
                avg_response_time: await database.get(`
                    SELECT ROUND(AVG(julianday(q.submission_date) - julianday(rs.invitation_date)), 1) as avg_days
                    FROM quotations q
                    JOIN request_suppliers rs ON q.request_id = rs.request_id AND q.supplier_id = rs.supplier_id
                    WHERE q.submission_date IS NOT NULL AND rs.invitation_date IS NOT NULL
                `),
                
                completion_rate: await database.get(`
                    SELECT 
                        COUNT(*) as total_requests,
                        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as completed_requests,
                        ROUND(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as completion_rate
                    FROM requests
                    WHERE created_at >= date('now', '-3 months')
                `),

                supplier_participation: await database.get(`
                    SELECT 
                        COUNT(*) as total_invitations,
                        SUM(CASE WHEN status != 'invited' THEN 1 ELSE 0 END) as responses,
                        ROUND(SUM(CASE WHEN status != 'invited' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as participation_rate
                    FROM request_suppliers
                    WHERE invitation_date >= date('now', '-3 months')
                `)
            }
        };

        res.json({
            success: true,
            report,
            generated_at: new Date().toISOString(),
            period: start_date && end_date ? `${start_date} - ${end_date}` : 'Tüm zamanlar'
        });
    } catch (error) {
        console.error('Dashboard report error:', error);
        res.status(500).json({
            success: false,
            message: 'Rapor oluşturulurken hata oluştu'
        });
    }
});

// 💰 TEKLİF KARŞILAŞTIRMA RAPORU (PDF)
router.get('/quotation-comparison/:requestId', authenticateSession, requireAdmin, validateId, async (req, res) => {
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
                q.*, s.company_name, s.rating, s.contact_person, s.phone
            FROM quotations q
            JOIN suppliers s ON q.supplier_id = s.id
            WHERE q.request_id = ? AND q.status = 'submitted'
            ORDER BY q.total_amount ASC
        `, [requestId]);

        // PDF oluştur
        const doc = new PDFKit({ margin: 50, size: 'A4' });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="teklif_karsilastirma_${request.request_no}.pdf"`);
        
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('TEDARİK ZİNCİRİ TMI', { align: 'center' });
        doc.fontSize(16).text('Teklif Karşılaştırma Raporu', { align: 'center' });
        doc.moveDown();

        // Talep Bilgileri
        doc.fontSize(14).text('TALEP BİLGİLERİ', { underline: true });
        doc.fontSize(12);
        doc.text(`Talep No: ${request.request_no}`);
        doc.text(`Başlık: ${request.title}`);
        doc.text(`Açıklama: ${request.description || 'Belirtilmemiş'}`);
        doc.text(`Öncelik: ${request.priority.toUpperCase()}`);
        doc.text(`Son Tarih: ${request.deadline ? moment(request.deadline).format('DD.MM.YYYY') : 'Belirtilmemiş'}`);
        doc.text(`Oluşturan: ${request.created_by_name}`);
        doc.text(`Tarih: ${moment(request.created_at).format('DD.MM.YYYY HH:mm')}`);
        doc.moveDown();

        // Malzeme Listesi
        doc.fontSize(14).text('MALZEME LİSTESİ', { underline: true });
        doc.fontSize(10);

        let yPosition = doc.y;
        items.forEach((item, index) => {
            doc.text(`${index + 1}. ${item.material_name} - ${item.quantity} ${item.unit}`, 50, yPosition);
            if (item.specifications) {
                doc.text(`   Özellikler: ${item.specifications}`, 70, yPosition + 15);
                yPosition += 30;
            } else {
                yPosition += 20;
            }
        });

        doc.y = yPosition + 20;

        // Teklifler
        doc.fontSize(14).text('ALINAN TEKLİFLER', { underline: true });
        doc.moveDown();

        quotations.forEach((quotation, index) => {
            doc.fontSize(12).text(`${index + 1}. ${quotation.company_name}`, { underline: true });
            doc.fontSize(10);
            doc.text(`Teklif No: ${quotation.quotation_no}`);
            doc.text(`Toplam Tutar: ${quotation.total_amount.toLocaleString('tr-TR')} ${quotation.currency}`);
            doc.text(`Teslimat Süresi: ${quotation.delivery_time || 'Belirtilmemiş'} gün`);
            doc.text(`Ödeme Şartları: ${quotation.payment_terms || 'Belirtilmemiş'}`);
            doc.text(`Geçerlilik: ${quotation.validity_days} gün`);
            doc.text(`Puan: ${quotation.rating}/5.0`);
            doc.text(`Gönderim: ${moment(quotation.submission_date).format('DD.MM.YYYY HH:mm')}`);
            if (quotation.notes) {
                doc.text(`Notlar: ${quotation.notes}`);
            }
            doc.moveDown();
        });

        // Özet
        if (quotations.length > 0) {
            const minPrice = Math.min(...quotations.map(q => q.total_amount));
            const maxPrice = Math.max(...quotations.map(q => q.total_amount));
            const avgPrice = quotations.reduce((sum, q) => sum + q.total_amount, 0) / quotations.length;

            doc.fontSize(14).text('ÖZET İSTATİSTİKLER', { underline: true });
            doc.fontSize(10);
            doc.text(`En Düşük Teklif: ${minPrice.toLocaleString('tr-TR')} TRY`);
            doc.text(`En Yüksek Teklif: ${maxPrice.toLocaleString('tr-TR')} TRY`);
            doc.text(`Ortalama Teklif: ${avgPrice.toLocaleString('tr-TR')} TRY`);
            doc.text(`Fark Oranı: %${(((maxPrice - minPrice) / minPrice) * 100).toFixed(1)}`);
            doc.text(`Toplam Tedarikçi: ${quotations.length}`);
        }

        // Footer
        doc.fontSize(8).text(`Rapor Tarihi: ${moment().format('DD.MM.YYYY HH:mm')}`, 50, doc.page.height - 50);
        doc.text('TMI Teknoloji © 2025', { align: 'right' });

        doc.end();

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'comparison_report_generated', 'requests', requestId]
        );

    } catch (error) {
        console.error('Quotation comparison report error:', error);
        res.status(500).json({
            success: false,
            message: 'Karşılaştırma raporu oluşturulurken hata oluştu'
        });
    }
});

// 📈 TEDARİKÇİ PERFORMANS RAPORU (PDF)
router.get('/supplier-performance/:supplierId', authenticateSession, requireAdmin, validateId, async (req, res) => {
    try {
        const supplierId = req.params.supplierId;

        // Tedarikçi bilgisi
        const supplier = await database.get(`
            SELECT s.*, u.username, u.email
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

        // Performans metrikleri
        const performance = {
            quotations: await database.all(`
                SELECT q.*, r.title as request_title, r.request_no
                FROM quotations q
                JOIN requests r ON q.request_id = r.id
                WHERE q.supplier_id = ?
                ORDER BY q.submission_date DESC
                LIMIT 20
            `, [supplierId]),

            monthly_stats: await database.all(`
                SELECT 
                    strftime('%Y-%m', submission_date) as month,
                    COUNT(*) as quotation_count,
                    SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as won_count,
                    AVG(total_amount) as avg_amount
                FROM quotations
                WHERE supplier_id = ? AND submission_date >= date('now', '-12 months')
                GROUP BY strftime('%Y-%m', submission_date)
                ORDER BY month DESC
            `, [supplierId]),

            response_metrics: await database.get(`
                SELECT 
                    COUNT(*) as total_invitations,
                    SUM(CASE WHEN status != 'invited' THEN 1 ELSE 0 END) as responses,
                    ROUND(SUM(CASE WHEN status != 'invited' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as response_rate,
                    ROUND(AVG(julianday(COALESCE(response_date, datetime('now'))) - julianday(invitation_date)), 1) as avg_response_time
                FROM request_suppliers
                WHERE supplier_id = ?
            `, [supplierId])
        };

        // PDF oluştur
        const doc = new PDFKit({ margin: 50, size: 'A4' });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="tedarikci_performans_${supplier.company_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
        
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('TEDARİK ZİNCİRİ TMI', { align: 'center' });
        doc.fontSize(16).text('Tedarikçi Performans Raporu', { align: 'center' });
        doc.moveDown();

        // Tedarikçi Bilgileri
        doc.fontSize(14).text('TEDARİKÇİ BİLGİLERİ', { underline: true });
        doc.fontSize(12);
        doc.text(`Şirket: ${supplier.company_name}`);
        doc.text(`Vergi No: ${supplier.tax_number || 'Belirtilmemiş'}`);
        doc.text(`İletişim: ${supplier.contact_person || 'Belirtilmemiş'}`);
        doc.text(`Telefon: ${supplier.phone || 'Belirtilmemiş'}`);
        doc.text(`Email: ${supplier.email}`);
        doc.text(`Şehir: ${supplier.city || 'Belirtilmemiş'}`);
        doc.text(`Kategoriler: ${supplier.categories || 'Belirtilmemiş'}`);
        doc.text(`Puan: ${supplier.rating}/5.0`);
        doc.text(`Kayıt Tarihi: ${moment(supplier.created_at).format('DD.MM.YYYY')}`);
        doc.moveDown();

        // Performans Özeti
        doc.fontSize(14).text('PERFORMANS ÖZETİ', { underline: true });
        doc.fontSize(12);
        doc.text(`Toplam Teklif: ${supplier.total_quotations}`);
        doc.text(`Kazanılan: ${supplier.successful_quotations}`);
        doc.text(`Başarı Oranı: %${supplier.total_quotations > 0 ? ((supplier.successful_quotations / supplier.total_quotations) * 100).toFixed(1) : '0'}`);
        doc.text(`Yanıt Oranı: %${performance.response_metrics?.response_rate || '0'}`);
        doc.text(`Ortalama Yanıt Süresi: ${performance.response_metrics?.avg_response_time || '0'} gün`);
        doc.moveDown();

        // Son Teklifler
        doc.fontSize(14).text('SON TEKLİFLER', { underline: true });
        doc.fontSize(10);

        performance.quotations.slice(0, 10).forEach((quotation, index) => {
            const statusText = {
                'draft': 'Taslak',
                'submitted': 'Gönderildi',
                'accepted': 'Kabul Edildi',
                'rejected': 'Reddedildi',
                'expired': 'Süresi Doldu'
            };

            doc.text(`${index + 1}. ${quotation.request_no} - ${quotation.request_title}`);
            doc.text(`   Tutar: ${quotation.total_amount.toLocaleString('tr-TR')} ${quotation.currency} | Durum: ${statusText[quotation.status]} | Tarih: ${moment(quotation.submission_date).format('DD.MM.YYYY')}`);
            doc.moveDown(0.5);
        });

        // Aylık Trend
        if (performance.monthly_stats.length > 0) {
            doc.addPage();
            doc.fontSize(14).text('AYLIK PERFORMANS TREND', { underline: true });
            doc.fontSize(10);

            performance.monthly_stats.forEach(stat => {
                const winRate = stat.quotation_count > 0 ? ((stat.won_count / stat.quotation_count) * 100).toFixed(1) : '0';
                doc.text(`${stat.month}: ${stat.quotation_count} teklif, ${stat.won_count} kazanım (%${winRate}), Ortalama: ${(stat.avg_amount || 0).toLocaleString('tr-TR')} TRY`);
            });
        }

        // Footer
        doc.fontSize(8).text(`Rapor Tarihi: ${moment().format('DD.MM.YYYY HH:mm')}`, 50, doc.page.height - 50);
        doc.text('TMI Teknoloji © 2025', { align: 'right' });

        doc.end();

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, created_at) VALUES (?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'supplier_report_generated', 'suppliers', supplierId]
        );

    } catch (error) {
        console.error('Supplier performance report error:', error);
        res.status(500).json({
            success: false,
            message: 'Tedarikçi raporu oluşturulurken hata oluştu'
        });
    }
});

// 📊 EXCEL RAPOR EXPORT
router.get('/excel/:type', authenticateSession, requireAdmin, async (req, res) => {
    try {
        const { type } = req.params;
        const { start_date, end_date } = req.query;

        let data = [];
        let filename = 'rapor';
        let headers = [];

        switch (type) {
            case 'requests':
                data = await database.all(`
                    SELECT 
                        r.request_no, r.title, r.status, r.priority,
                        r.created_at, r.deadline,
                        u.username as created_by,
                        COUNT(DISTINCT rs.supplier_id) as invited_suppliers,
                        COUNT(DISTINCT q.id) as received_quotations
                    FROM requests r
                    LEFT JOIN users u ON r.created_by = u.id
                    LEFT JOIN request_suppliers rs ON r.id = rs.request_id
                    LEFT JOIN quotations q ON r.id = q.request_id AND q.status = 'submitted'
                    ${start_date && end_date ? 'WHERE r.created_at BETWEEN ? AND ?' : ''}
                    GROUP BY r.id
                    ORDER BY r.created_at DESC
                `, start_date && end_date ? [start_date, end_date] : []);

                headers = ['Talep No', 'Başlık', 'Durum', 'Öncelik', 'Oluşturulma', 'Son Tarih', 'Oluşturan', 'Davet Edilen', 'Alınan Teklif'];
                filename = 'talepler_raporu';
                break;

            case 'quotations':
                data = await database.all(`
                    SELECT 
                        q.quotation_no, r.request_no, r.title as request_title,
                        s.company_name, q.total_amount, q.currency,
                        q.status, q.submission_date, q.delivery_time
                    FROM quotations q
                    JOIN requests r ON q.request_id = r.id
                    JOIN suppliers s ON q.supplier_id = s.id
                    ${start_date && end_date ? 'WHERE q.submission_date BETWEEN ? AND ?' : ''}
                    ORDER BY q.submission_date DESC
                `, start_date && end_date ? [start_date, end_date] : []);

                headers = ['Teklif No', 'Talep No', 'Talep Başlığı', 'Tedarikçi', 'Tutar', 'Para Birimi', 'Durum', 'Gönderim Tarihi', 'Teslimat Süresi'];
                filename = 'teklifler_raporu';
                break;

            case 'suppliers':
                data = await database.all(`
                    SELECT 
                        s.company_name, s.contact_person, s.phone, s.city,
                        s.categories, s.rating, s.total_quotations,
                        s.successful_quotations, s.is_approved, s.created_at
                    FROM suppliers s
                    ORDER BY s.created_at DESC
                `);

                headers = ['Şirket Adı', 'İletişim Kişisi', 'Telefon', 'Şehir', 'Kategoriler', 'Puan', 'Toplam Teklif', 'Kazanılan', 'Onaylı', 'Kayıt Tarihi'];
                filename = 'tedarikçiler_raporu';
                break;

            default:
                return res.status(400).json({
                    success: false,
                    message: 'Geçersiz rapor türü'
                });
        }

        const xlsx = require('xlsx');
        
        // Data'yı Excel formatına çevir
        const worksheetData = [headers, ...data.map(row => Object.values(row))];
        
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.aoa_to_sheet(worksheetData);
        
        // Kolon genişliklerini ayarla
        const colWidths = headers.map(() => ({ wch: 20 }));
        ws['!cols'] = colWidths;

        xlsx.utils.book_append_sheet(wb, ws, 'Rapor');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}_${moment().format('YYYY-MM-DD')}.xlsx"`);
        
        res.send(buffer);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, created_at) VALUES (?, ?, datetime("now"))',
            [req.user.id, `excel_report_${type}_exported`]
        );

    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).json({
            success: false,
            message: 'Excel raporu oluşturulurken hata oluştu'
        });
    }
});

module.exports = router;
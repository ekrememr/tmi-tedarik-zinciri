const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');
const { authenticateSession, requireAdmin } = require('../middleware/auth');
const { validateFileUpload } = require('../middleware/validation');

const router = express.Router();

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = req.body.type === 'excel' ? 'uploads/excel' : 'uploads/files';
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || 10485760) // 10MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || ['xlsx', 'xls', 'pdf', 'doc', 'docx'];
        const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
        
        if (allowedTypes.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error(`İzin verilen dosya türleri: ${allowedTypes.join(', ')}`), false);
        }
    }
});

// 📊 EXCEL YÜKLEME VE PARSE ETME (Admin)
router.post('/excel', authenticateSession, requireAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Excel dosyası yüklenmedi'
            });
        }

        // Excel dosyasını oku
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // JSON'a çevir
        const jsonData = xlsx.utils.sheet_to_json(worksheet, {
            header: 1, // İlk satırı header olarak kullan
            defval: '' // Boş hücreler için default değer
        });

        if (jsonData.length < 2) {
            fs.unlinkSync(req.file.path); // Dosyayı sil
            return res.status(400).json({
                success: false,
                message: 'Excel dosyası boş veya sadece header içeriyor'
            });
        }

        // Header'ı al (ilk satır)
        const headers = jsonData[0];
        const dataRows = jsonData.slice(1);

        // Standart header mapping
        const headerMapping = {
            'MALZEME_KODU': 'material_code',
            'MALZEME_ADI': 'material_name', 
            'MIKTAR': 'quantity',
            'BIRIM': 'unit',
            'ACIKLAMA': 'specifications',
            'KATEGORI': 'category',
            'ONCELIK': 'priority',
            'TERMIN_TARIHI': 'deadline'
        };

        // Veriyi parse et
        const parsedData = dataRows
            .filter(row => row.some(cell => cell !== '')) // Boş satırları filtrele
            .map((row, index) => {
                const item = {};
                
                headers.forEach((header, colIndex) => {
                    const mappedField = headerMapping[header.toUpperCase()] || header.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    item[mappedField] = row[colIndex] || '';
                });

                // Zorunlu alanları kontrol et ve temizle
                return {
                    row_number: index + 2, // Excel'deki satır numarası
                    material_code: item.material_code || `AUTO_${Date.now()}_${index}`,
                    material_name: item.material_name?.toString().trim() || '',
                    quantity: parseFloat(item.quantity) || 0,
                    unit: item.unit?.toString().trim() || 'ADET',
                    specifications: item.specifications?.toString().trim() || '',
                    category: item.category?.toString().trim() || 'Genel',
                    priority: ['low', 'normal', 'high', 'urgent'].includes(item.priority?.toLowerCase()) ? item.priority.toLowerCase() : 'normal',
                    deadline: item.deadline || null
                };
            })
            .filter(item => item.material_name && item.quantity > 0); // Geçerli verileri filtrele

        if (parsedData.length === 0) {
            fs.unlinkSync(req.file.path); // Dosyayı sil
            return res.status(400).json({
                success: false,
                message: 'Excel dosyasında geçerli veri bulunamadı'
            });
        }

        // Dosya bilgisini veritabanına kaydet
        const fileRecord = await database.run(`
            INSERT INTO files (
                filename, original_name, file_path, file_size, mime_type,
                uploaded_by, related_type, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.file.filename,
            req.file.originalname,
            req.file.path,
            req.file.size,
            req.file.mimetype,
            req.user.id,
            'excel_import',
            `Excel import - ${parsedData.length} malzeme`
        ]);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'excel_imported', 'files', fileRecord.id, JSON.stringify({ 
                filename: req.file.originalname, 
                items_count: parsedData.length 
            })]
        );

        res.json({
            success: true,
            message: `${parsedData.length} malzeme başarıyla işlendi`,
            data: parsedData,
            file: {
                id: fileRecord.id,
                filename: req.file.filename,
                original_name: req.file.originalname,
                size: req.file.size
            },
            summary: {
                total_rows: dataRows.length,
                valid_items: parsedData.length,
                headers: headers
            }
        });

    } catch (error) {
        // Hata durumunda dosyayı sil
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('Excel upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Excel dosyası işlenirken hata oluştu',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 📄 GENEL DOSYA YÜKLEME
router.post('/file', authenticateSession, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Dosya yüklenmedi'
            });
        }

        const { related_type, related_id, description } = req.body;

        // Dosya bilgisini veritabanına kaydet
        const fileRecord = await database.run(`
            INSERT INTO files (
                filename, original_name, file_path, file_size, mime_type,
                uploaded_by, related_type, related_id, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.file.filename,
            req.file.originalname,
            req.file.path,
            req.file.size,
            req.file.mimetype,
            req.user.id,
            related_type || null,
            related_id || null,
            description || null
        ]);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'file_uploaded', 'files', fileRecord.id, JSON.stringify({ 
                filename: req.file.originalname,
                related_type,
                related_id
            })]
        );

        res.json({
            success: true,
            message: 'Dosya başarıyla yüklendi',
            file: {
                id: fileRecord.id,
                filename: req.file.filename,
                original_name: req.file.originalname,
                file_path: req.file.path,
                size: req.file.size,
                mime_type: req.file.mimetype
            }
        });

    } catch (error) {
        // Hata durumunda dosyayı sil
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        console.error('File upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Dosya yüklenirken hata oluştu'
        });
    }
});

// 📱 EXCEL ŞABLONU İNDİR
router.get('/excel-template', authenticateSession, requireAdmin, (req, res) => {
    try {
        // Yeni workbook oluştur
        const wb = xlsx.utils.book_new();
        
        // Şablon verileri
        const templateData = [
            // Header
            ['MALZEME_KODU', 'MALZEME_ADI', 'MIKTAR', 'BIRIM', 'ACIKLAMA', 'KATEGORI', 'ONCELIK'],
            // Örnek veriler
            ['MAL001', 'Çelik Levha 3mm', '100', 'KG', 'Galvanizli çelik levha', 'Metal', 'normal'],
            ['MAL002', 'Vida M8x50', '500', 'ADET', 'Paslanmaz çelik vida', 'Bağlantı', 'high'],
            ['MAL003', 'Kaynak Elektrodu', '50', 'PAKET', 'E7018 elektrod', 'Kaynak', 'normal'],
            ['MAL004', 'Boya Astarı', '25', 'LT', 'Anti-korozyon astar', 'Kimyasal', 'low'],
            ['MAL005', 'Makine Yağı', '200', 'LT', 'Hidraulik sistem yağı', 'Yağlayıcı', 'urgent']
        ];
        
        // Worksheet oluştur
        const ws = xlsx.utils.aoa_to_sheet(templateData);
        
        // Kolon genişliklerini ayarla
        ws['!cols'] = [
            { wch: 15 }, // MALZEME_KODU
            { wch: 30 }, // MALZEME_ADI
            { wch: 10 }, // MIKTAR
            { wch: 10 }, // BIRIM
            { wch: 25 }, // ACIKLAMA
            { wch: 15 }, // KATEGORI
            { wch: 12 }  // ONCELIK
        ];

        // Header stilini ayarla (kalın)
        const headerRange = xlsx.utils.decode_range(ws['!ref']);
        for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
            const cellAddress = xlsx.utils.encode_cell({ r: 0, c: col });
            if (!ws[cellAddress]) continue;
            ws[cellAddress].s = {
                font: { bold: true },
                fill: { fgColor: { rgb: "CCCCCC" } }
            };
        }

        // Worksheet'i workbook'a ekle
        xlsx.utils.book_append_sheet(wb, ws, 'Malzeme_Listesi');

        // Açıklamalar sayfası
        const instructionsData = [
            ['TEDARİK ZİNCİRİ EXCEL ŞABLONU - KULLANIM KILAVUZU'],
            [''],
            ['ZORUNLU ALANLAR:'],
            ['• MALZEME_ADI: Malzemenin tam adı'],
            ['• MIKTAR: Sayısal değer (0\'dan büyük)'],
            ['• BIRIM: KG, ADET, MT, LT, vb.'],
            [''],
            ['OPSİYONEL ALANLAR:'],
            ['• MALZEME_KODU: Boş bırakılırsa otomatik kod oluşturulur'],
            ['• ACIKLAMA: Teknik özellikler, notlar'],
            ['• KATEGORI: Metal, Kimyasal, Elektrik, vb.'],
            ['• ONCELIK: low, normal, high, urgent'],
            [''],
            ['NOTLAR:'],
            ['• İlk satır (header) değiştirilmemelidir'],
            ['• Boş satırlar otomatik filtrelenir'],
            ['• Geçersiz veriler göz ardı edilir'],
            ['• Maksimum dosya boyutu: 10MB'],
            [''],
            ['ÖRNEK VERİLER:'],
            ['Şablonda 5 adet örnek malzeme bulunmaktadır.'],
            ['Bu verileri silebilir, kendi malzemelerinizi ekleyebilirsiniz.'],
            [''],
            ['DESTEK:'],
            ['Sorun yaşadığınızda IT departmanıyla iletişime geçin.']
        ];

        const instructionsWs = xlsx.utils.aoa_to_sheet(instructionsData);
        instructionsWs['!cols'] = [{ wch: 60 }];
        xlsx.utils.book_append_sheet(wb, instructionsWs, 'Kullanim_Kilavuzu');

        // Buffer oluştur
        const buffer = xlsx.write(wb, { 
            type: 'buffer', 
            bookType: 'xlsx',
            compression: true
        });
        
        // Response headers
        const filename = `malzeme_template_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);

        // Audit log (async)
        database.run(
            'INSERT INTO audit_logs (user_id, action, created_at) VALUES (?, ?, datetime("now"))',
            [req.user.id, 'excel_template_downloaded']
        ).catch(console.error);

    } catch (error) {
        console.error('Excel template error:', error);
        res.status(500).json({
            success: false,
            message: 'Şablon oluşturulurken hata oluştu'
        });
    }
});

// 📋 YÜKLENEN DOSYALAR
router.get('/files', authenticateSession, async (req, res) => {
    try {
        const { page = 1, limit = 20, related_type, uploaded_by } = req.query;

        let whereConditions = [];
        let params = [];

        // Admin tüm dosyaları, diğerleri sadece kendilerinkini görebilir
        if (req.user.role !== 'admin') {
            whereConditions.push('uploaded_by = ?');
            params.push(req.user.id);
        }

        if (related_type) {
            whereConditions.push('related_type = ?');
            params.push(related_type);
        }

        if (uploaded_by && req.user.role === 'admin') {
            whereConditions.push('uploaded_by = ?');
            params.push(uploaded_by);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const baseQuery = `
            SELECT f.*, u.username as uploaded_by_name
            FROM files f
            LEFT JOIN users u ON f.uploaded_by = u.id
            ${whereClause}
            ORDER BY f.created_at DESC
        `;

        const countQuery = `
            SELECT COUNT(*) as count
            FROM files f
            ${whereClause}
        `;

        const result = await database.paginate(baseQuery, countQuery, params, page, limit);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Files list error:', error);
        res.status(500).json({
            success: false,
            message: 'Dosya listesi alınırken hata oluştu'
        });
    }
});

// 🗑️ DOSYA SİL
router.delete('/files/:id', authenticateSession, async (req, res) => {
    try {
        const fileId = req.params.id;

        const file = await database.get('SELECT * FROM files WHERE id = ?', [fileId]);

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'Dosya bulunamadı'
            });
        }

        // Yetki kontrolü
        if (req.user.role !== 'admin' && file.uploaded_by !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Bu dosyayı silme yetkiniz yok'
            });
        }

        // Fiziksel dosyayı sil
        if (fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        // Veritabanı kaydını sil
        await database.run('DELETE FROM files WHERE id = ?', [fileId]);

        // Audit log
        await database.run(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
            [req.user.id, 'file_deleted', 'files', fileId, JSON.stringify({ 
                filename: file.original_name,
                file_path: file.file_path
            })]
        );

        res.json({
            success: true,
            message: 'Dosya başarıyla silindi'
        });
    } catch (error) {
        console.error('File delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Dosya silinirken hata oluştu'
        });
    }
});

// Error handler for multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Dosya çok büyük (Maksimum 10MB)'
            });
        }
    }
    
    if (error.message.includes('İzin verilen dosya türleri')) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    next(error);
});

module.exports = router;
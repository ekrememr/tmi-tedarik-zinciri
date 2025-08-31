const { body, param, query, validationResult } = require('express-validator');

// Validation sonuçlarını kontrol et
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Veri doğrulama hatası',
            errors: errors.array()
        });
    }
    next();
};

// Kullanıcı kaydı validation
const validateUserRegistration = [
    body('username')
        .isLength({ min: 3, max: 50 })
        .withMessage('Kullanıcı adı 3-50 karakter olmalı')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Kullanıcı adı sadece harf, rakam ve _ içerebilir'),
    
    body('email')
        .isEmail()
        .withMessage('Geçerli bir email adresi girin')
        .normalizeEmail(),
    
    body('password')
        .isLength({ min: 6 })
        .withMessage('Şifre en az 6 karakter olmalı')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Şifre en az 1 küçük harf, 1 büyük harf ve 1 rakam içermeli'),
    
    body('company_name')
        .isLength({ min: 2, max: 200 })
        .withMessage('Şirket adı 2-200 karakter olmalı'),
    
    body('contact_person')
        .optional()
        .isLength({ max: 100 })
        .withMessage('İletişim kişisi maksimum 100 karakter'),
    
    body('phone')
        .optional()
        .matches(/^[\+]?[0-9\s\-\(\)]{10,20}$/)
        .withMessage('Geçerli bir telefon numarası girin'),
    
    handleValidationErrors
];

// Giriş validation
const validateLogin = [
    body('username')
        .notEmpty()
        .withMessage('Kullanıcı adı gerekli'),
    
    body('password')
        .notEmpty()
        .withMessage('Şifre gerekli'),
    
    handleValidationErrors
];

// Talep oluşturma validation
const validateRequest = [
    body('title')
        .isLength({ min: 5, max: 200 })
        .withMessage('Başlık 5-200 karakter olmalı'),
    
    body('description')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Açıklama maksimum 1000 karakter'),
    
    body('deadline')
        .optional()
        .isISO8601()
        .withMessage('Geçerli bir tarih girin'),
    
    body('priority')
        .optional()
        .isIn(['low', 'normal', 'high', 'urgent'])
        .withMessage('Geçerli bir öncelik seçin'),
    
    body('items')
        .isArray({ min: 1 })
        .withMessage('En az 1 malzeme eklemelisiniz'),
    
    body('items.*.material_name')
        .notEmpty()
        .withMessage('Malzeme adı gerekli'),
    
    body('items.*.quantity')
        .isFloat({ min: 0.01 })
        .withMessage('Miktar 0\'dan büyük olmalı'),
    
    body('items.*.unit')
        .notEmpty()
        .withMessage('Birim gerekli'),
    
    body('supplier_ids')
        .isArray({ min: 1 })
        .withMessage('En az 1 tedarikçi seçmelisiniz'),
    
    handleValidationErrors
];

// Teklif validation
const validateQuotation = [
    body('request_id')
        .isInt({ min: 1 })
        .withMessage('Geçerli bir talep ID gerekli'),
    
    body('delivery_time')
        .optional()
        .isInt({ min: 1, max: 365 })
        .withMessage('Teslim süresi 1-365 gün arası olmalı'),
    
    body('payment_terms')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Ödeme şartları maksimum 500 karakter'),
    
    body('items')
        .isArray({ min: 1 })
        .withMessage('En az 1 malzeme fiyatı girmelisiniz'),
    
    body('items.*.request_item_id')
        .isInt({ min: 1 })
        .withMessage('Geçerli malzeme ID gerekli'),
    
    body('items.*.unit_price')
        .isFloat({ min: 0.01 })
        .withMessage('Birim fiyat 0\'dan büyük olmalı'),
    
    handleValidationErrors
];

// Tedarikçi profil güncelleme validation
const validateSupplierProfile = [
    body('company_name')
        .isLength({ min: 2, max: 200 })
        .withMessage('Şirket adı 2-200 karakter olmalı'),
    
    body('tax_number')
        .optional()
        .matches(/^[0-9]{10,11}$/)
        .withMessage('Vergi numarası 10-11 haneli olmalı'),
    
    body('contact_person')
        .optional()
        .isLength({ max: 100 })
        .withMessage('İletişim kişisi maksimum 100 karakter'),
    
    body('phone')
        .optional()
        .matches(/^[\+]?[0-9\s\-\(\)]{10,20}$/)
        .withMessage('Geçerli bir telefon numarası girin'),
    
    body('address')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Adres maksimum 500 karakter'),
    
    body('city')
        .optional()
        .isLength({ max: 50 })
        .withMessage('Şehir maksimum 50 karakter'),
    
    body('categories')
        .optional()
        .isLength({ max: 300 })
        .withMessage('Kategoriler maksimum 300 karakter'),
    
    handleValidationErrors
];

// ID parametresi validation
const validateId = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('Geçerli bir ID gerekli'),
    
    handleValidationErrors
];

// Sayfalama validation
const validatePagination = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Sayfa numarası 1\'den büyük olmalı'),
    
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit 1-100 arası olmalı'),
    
    handleValidationErrors
];

// Dosya yükleme validation
const validateFileUpload = (allowedTypes = ['xlsx', 'xls', 'pdf', 'doc', 'docx']) => {
    return (req, res, next) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Dosya yüklenmedi'
            });
        }

        const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
        
        if (!allowedTypes.includes(fileExtension)) {
            return res.status(400).json({
                success: false,
                message: `İzin verilen dosya türleri: ${allowedTypes.join(', ')}`
            });
        }

        // Dosya boyutu kontrolü (10MB)
        if (req.file.size > parseInt(process.env.MAX_FILE_SIZE || 10485760)) {
            return res.status(400).json({
                success: false,
                message: 'Dosya çok büyük (Maksimum 10MB)'
            });
        }

        next();
    };
};

// Email format validation
const validateEmail = [
    body('email')
        .isEmail()
        .withMessage('Geçerli bir email adresi girin')
        .normalizeEmail(),
    
    handleValidationErrors
];

// Şifre değiştirme validation
const validatePasswordChange = [
    body('current_password')
        .notEmpty()
        .withMessage('Mevcut şifre gerekli'),
    
    body('new_password')
        .isLength({ min: 6 })
        .withMessage('Yeni şifre en az 6 karakter olmalı')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Yeni şifre en az 1 küçük harf, 1 büyük harf ve 1 rakam içermeli'),
    
    body('confirm_password')
        .custom((value, { req }) => {
            if (value !== req.body.new_password) {
                throw new Error('Şifre onayı eşleşmiyor');
            }
            return true;
        }),
    
    handleValidationErrors
];

module.exports = {
    validateUserRegistration,
    validateLogin,
    validateRequest,
    validateQuotation,
    validateSupplierProfile,
    validateId,
    validatePagination,
    validateFileUpload,
    validateEmail,
    validatePasswordChange,
    handleValidationErrors
};
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// Kendi modüllerimiz
const database = require('./config/database');
const { createRateLimit } = require('./middleware/auth');

// Route'lar
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const supplierRoutes = require('./routes/supplier');
const requestRoutes = require('./routes/requests');
const quotationRoutes = require('./routes/quotations');
const uploadRoutes = require('./routes/upload');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 8000;

console.log('🚀 TEDARİK ZİNCİRİ TMI SİSTEMİ BAŞLATILIYOR...\n');

// Rate limiting
const limiter = createRateLimit(15 * 60 * 1000, 100); // 15 dakikada 100 istek
app.use('/api/', limiter);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            connectSrc: ["'self'"]
        }
    }
}));

// CORS configuration
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // HTTP için false
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 saat
    }
}));

// Static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// OPTIONS handler for preflight
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);

// Ana sayfa route'ları
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Admin panel route'ları
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

app.get('/admin/requests', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'requests.html'));
});

app.get('/admin/suppliers', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'suppliers.html'));
});

app.get('/admin/quotations', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'quotations.html'));
});

app.get('/admin/reports', (req, res) => {
    const reportPath = path.join(__dirname, 'public', 'admin', 'reports.html');
    if (fs.existsSync(reportPath)) {
        res.sendFile(reportPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
    }
});

app.get('/admin/analytics', (req, res) => {
    const analyticsPath = path.join(__dirname, 'public', 'admin', 'analytics.html');
    if (fs.existsSync(analyticsPath)) {
        res.sendFile(analyticsPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
    }
});

app.get('/admin/settings', (req, res) => {
    const settingsPath = path.join(__dirname, 'public', 'admin', 'settings.html');
    if (fs.existsSync(settingsPath)) {
        res.sendFile(settingsPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
    }
});

// Tedarikçi portal route'ları
app.get('/supplier', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'supplier', 'dashboard.html'));
});

app.get('/supplier/*', (req, res) => {
    const fileName = req.params[0] || 'dashboard.html';
    const filePath = path.join(__dirname, 'public', 'supplier', fileName);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'supplier', 'dashboard.html'));
    }
});

// Sistem durumu endpoint'i
app.get('/api/health', async (req, res) => {
    try {
        const isDbConnected = await database.checkConnection();
        
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: isDbConnected ? 'connected' : 'disconnected',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: require('./package.json').version
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

// API bilgileri endpoint'i
app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: 'TMI Tedarik Zinciri API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/*',
            admin: '/api/admin/*',
            supplier: '/api/supplier/*',
            requests: '/api/requests/*',
            quotations: '/api/quotations/*',
            upload: '/api/upload/*',
            reports: '/api/reports/*'
        },
        docs: 'https://docs.tmitek.com/tedarik-api'
    });
});

// 404 handler
app.use((req, res) => {
    if (req.url.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            message: 'API endpoint bulunamadı',
            path: req.url
        });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('❌ Server Error:', error);
    
    if (req.url.startsWith('/api/')) {
        res.status(500).json({
            success: false,
            message: 'Sunucu hatası',
            ...(process.env.NODE_ENV === 'development' && { error: error.message })
        });
    } else {
        res.status(500).send('Sunucu hatası oluştu');
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Sunucu kapatılıyor...');
    try {
        await database.close();
        console.log('✅ Veritabanı bağlantısı kapatıldı');
        process.exit(0);
    } catch (error) {
        console.error('❌ Kapatma hatası:', error);
        process.exit(1);
    }
});

// Sunucuyu başlat
const startServer = async () => {
    try {
        // Veritabanına bağlan
        await database.connect();
        
        // Upload klasörlerini kontrol et
        const uploadDirs = ['uploads', 'uploads/excel', 'uploads/files', 'uploads/temp'];
        uploadDirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`✅ Klasör oluşturuldu: ${dir}`);
            }
        });
        
        // Sunucuyu başlat
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n🎉 TMI TEDARİK ZİNCİRİ SİSTEMİ HAZIR!\n');
            console.log('📍 SUNUCU BİLGİLERİ:');
            console.log(`   • Port: ${PORT}`);
            console.log(`   • Lokal: http://localhost:${PORT}`);
            console.log(`   • Network: http://[IP]:${PORT}`);
            console.log(`   • Ortam: ${process.env.NODE_ENV || 'development'}`);
            
            console.log('\n🌐 ERİŞİM LİNKLERİ:');
            console.log(`   • Ana Sayfa: http://localhost:${PORT}`);
            console.log(`   • Admin Panel: http://localhost:${PORT}/admin`);
            console.log(`   • Tedarikçi Portal: http://localhost:${PORT}/supplier`);
            console.log(`   • API Durumu: http://localhost:${PORT}/api/health`);
            
            console.log('\n👥 TEST KULLANICILARI:');
            console.log('   • admin / admin123 (Admin)');
            console.log('   • demirtas_metal / supplier123 (Tedarikçi)');
            console.log('   • yilmaz_muhendislik / supplier123 (Tedarikçi)');
            console.log('   • atlas_kimya / supplier123 (Tedarikçi)');
            
            console.log('\n📋 ÖZELLİKLER:');
            console.log('   ✅ Authentication & Authorization');
            console.log('   ✅ Excel Upload & Processing');
            console.log('   ✅ Talep Yönetimi');
            console.log('   ✅ Teklif Sistemi');
            console.log('   ✅ Email Bildirimleri');
            console.log('   ✅ Karşılaştırma Modülü');
            console.log('   ✅ Dashboard & Raporlama');
            console.log('   ✅ PDF Export');
            console.log('   ✅ File Upload');
            console.log('   ✅ Rate Limiting & Security');
            
            console.log('\n🛠️ API ENDPOINTS:');
            console.log('   • /api/auth/* - Authentication');
            console.log('   • /api/admin/* - Admin Operations');
            console.log('   • /api/supplier/* - Supplier Operations');
            console.log('   • /api/requests/* - Request Management');
            console.log('   • /api/quotations/* - Quotation Management');
            console.log('   • /api/upload/* - File Upload');
            console.log('   • /api/reports/* - Reports & Analytics');
            
            console.log('\n🚀 Sistem aktif ve hazır!\n');
        });
        
    } catch (error) {
        console.error('❌ Sunucu başlatma hatası:', error);
        process.exit(1);
    }
};

// Sunucuyu başlat
startServer();
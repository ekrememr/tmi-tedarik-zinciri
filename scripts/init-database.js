const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Database dosyası yolu - Production'da /tmp kullan
const dbPath = process.env.NODE_ENV === 'production' 
    ? '/tmp/tedarik.db' 
    : path.join(__dirname, '../database/tedarik.db');

console.log('🗄️  TEDARİK ZİNCİRİ VERİTABANI KURULUMU BAŞLIYOR...\n');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Veritabanı bağlantı hatası:', err.message);
        return;
    }
    console.log('✅ SQLite veritabanına bağlanıldı:', dbPath);
});

// Tabloları oluştur
db.serialize(() => {
    
    // 1. USERS Tablosu (Admin + Tedarikçiler)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'supplier')),
        is_active INTEGER DEFAULT 1,
        email_verified INTEGER DEFAULT 0,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('❌ users tablosu:', err.message);
        else console.log('✅ users tablosu oluşturuldu');
    });

    // 2. SUPPLIERS Tablosu (Tedarikçi Profilleri)
    db.run(`CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        company_name TEXT NOT NULL,
        tax_number TEXT,
        contact_person TEXT,
        phone TEXT,
        address TEXT,
        city TEXT,
        country TEXT DEFAULT 'Türkiye',
        categories TEXT, -- JSON array
        rating REAL DEFAULT 0.0,
        total_quotations INTEGER DEFAULT 0,
        successful_quotations INTEGER DEFAULT 0,
        is_approved INTEGER DEFAULT 0,
        approval_date DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error('❌ suppliers tablosu:', err.message);
        else console.log('✅ suppliers tablosu oluşturuldu');
    });

    // 3. REQUESTS Tablosu (Talep Listesi)
    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_no TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        deadline DATETIME,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'cancelled', 'draft')),
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
        created_by INTEGER NOT NULL,
        total_items INTEGER DEFAULT 0,
        total_suppliers INTEGER DEFAULT 0,
        received_quotations INTEGER DEFAULT 0,
        winner_supplier_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id),
        FOREIGN KEY (winner_supplier_id) REFERENCES suppliers (id)
    )`, (err) => {
        if (err) console.error('❌ requests tablosu:', err.message);
        else console.log('✅ requests tablosu oluşturuldu');
    });

    // 4. REQUEST_ITEMS Tablosu (Talep Malzemeleri)
    db.run(`CREATE TABLE IF NOT EXISTS request_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        item_no INTEGER NOT NULL,
        material_code TEXT,
        material_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        specifications TEXT,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error('❌ request_items tablosu:', err.message);
        else console.log('✅ request_items tablosu oluşturuldu');
    });

    // 5. REQUEST_SUPPLIERS Tablosu (Talebin gönderildiği tedarikçiler)
    db.run(`CREATE TABLE IF NOT EXISTS request_suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        supplier_id INTEGER NOT NULL,
        invitation_sent INTEGER DEFAULT 0,
        invitation_date DATETIME,
        response_received INTEGER DEFAULT 0,
        response_date DATETIME,
        status TEXT DEFAULT 'invited' CHECK(status IN ('invited', 'viewed', 'quoted', 'declined')),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
        UNIQUE(request_id, supplier_id)
    )`, (err) => {
        if (err) console.error('❌ request_suppliers tablosu:', err.message);
        else console.log('✅ request_suppliers tablosu oluşturuldu');
    });

    // 6. QUOTATIONS Tablosu (Teklifler)
    db.run(`CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_no TEXT UNIQUE NOT NULL,
        request_id INTEGER NOT NULL,
        supplier_id INTEGER NOT NULL,
        total_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'TRY',
        delivery_time INTEGER, -- gün
        delivery_location TEXT,
        validity_days INTEGER DEFAULT 30,
        payment_terms TEXT,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'accepted', 'rejected', 'expired')),
        submission_date DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES requests (id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
        UNIQUE(request_id, supplier_id)
    )`, (err) => {
        if (err) console.error('❌ quotations tablosu:', err.message);
        else console.log('✅ quotations tablosu oluşturuldu');
    });

    // 7. QUOTATION_ITEMS Tablosu (Teklif Malzemeleri)
    db.run(`CREATE TABLE IF NOT EXISTS quotation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL,
        request_item_id INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        delivery_time INTEGER, -- gün
        brand TEXT,
        model TEXT,
        origin_country TEXT,
        warranty_period TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE,
        FOREIGN KEY (request_item_id) REFERENCES request_items (id),
        UNIQUE(quotation_id, request_item_id)
    )`, (err) => {
        if (err) console.error('❌ quotation_items tablosu:', err.message);
        else console.log('✅ quotation_items tablosu oluşturuldu');
    });

    // 8. CATEGORIES Tablosu (Malzeme Kategorileri)
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        parent_id INTEGER,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES categories (id)
    )`, (err) => {
        if (err) console.error('❌ categories tablosu:', err.message);
        else console.log('✅ categories tablosu oluşturuldu');
    });

    // 9. NOTIFICATIONS Tablosu (Bildirimler)
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('request', 'quotation', 'deadline', 'approval', 'system')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT, -- JSON data
        is_read INTEGER DEFAULT 0,
        is_email_sent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error('❌ notifications tablosu:', err.message);
        else console.log('✅ notifications tablosu oluşturuldu');
    });

    // 10. FILES Tablosu (Dosya Yüklemeleri)
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_by INTEGER NOT NULL,
        related_type TEXT CHECK(related_type IN ('request', 'quotation', 'supplier')),
        related_id INTEGER,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploaded_by) REFERENCES users (id)
    )`, (err) => {
        if (err) console.error('❌ files tablosu:', err.message);
        else console.log('✅ files tablosu oluşturuldu');
    });

    // 11. SETTINGS Tablosu (Sistem Ayarları)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
        updated_by INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users (id)
    )`, (err) => {
        if (err) console.error('❌ settings tablosu:', err.message);
        else console.log('✅ settings tablosu oluşturuldu');
    });

    // 12. AUDIT_LOGS Tablosu (İşlem Geçmişi)
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        table_name TEXT,
        record_id INTEGER,
        old_values TEXT, -- JSON
        new_values TEXT, -- JSON
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`, (err) => {
        if (err) console.error('❌ audit_logs tablosu:', err.message);
        else console.log('✅ audit_logs tablosu oluşturuldu');
    });

    // BAŞLANGIÇ VERİLERİNİ EKLE
    setTimeout(() => {
        insertInitialData();
    }, 1000);
});

function insertInitialData() {
    console.log('\n📊 BAŞLANGIÇ VERİLERİ EKLENİYOR...\n');
    
    // Admin kullanıcı oluştur
    const adminPassword = bcrypt.hashSync('admin123', 12);
    
    db.run(`INSERT OR IGNORE INTO users (username, email, password_hash, role, is_active, email_verified) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
        ['admin', 'admin@tmitek.com', adminPassword, 'admin', 1, 1], 
        function(err) {
            if (err) console.error('❌ Admin kullanıcı:', err.message);
            else console.log('✅ Admin kullanıcı oluşturuldu (admin/admin123)');
        }
    );

    // Test tedarikçi kullanıcıları
    const supplierPassword = bcrypt.hashSync('supplier123', 12);
    
    const testSuppliers = [
        {username: 'demirtas_metal', email: 'info@demirtasmetal.com', company: 'Demirtaş Metal San. Tic. Ltd. Şti.', category: 'Metal,Çelik'},
        {username: 'yilmaz_muhendislik', email: 'satış@yilmaz.com', company: 'Yılmaz Mühendislik A.Ş.', category: 'Makine,Yedek Parça'},
        {username: 'atlas_kimya', email: 'teklif@atlaskimya.com', company: 'Atlas Kimya San. Tic. A.Ş.', category: 'Kimyasal,Boyar Madde'}
    ];

    testSuppliers.forEach((supplier, index) => {
        db.run(`INSERT OR IGNORE INTO users (username, email, password_hash, role, is_active, email_verified) 
                VALUES (?, ?, ?, ?, ?, ?)`, 
            [supplier.username, supplier.email, supplierPassword, 'supplier', 1, 1], 
            function(err) {
                if (err) console.error(`❌ ${supplier.username}:`, err.message);
                else {
                    console.log(`✅ ${supplier.username} tedarikçi kullanıcı oluşturuldu`);
                    
                    // Tedarikçi profili ekle
                    db.run(`INSERT OR IGNORE INTO suppliers (user_id, company_name, categories, is_approved, rating) 
                            VALUES (?, ?, ?, ?, ?)`, 
                        [this.lastID, supplier.company, supplier.category, 1, 4.5], 
                        function(err) {
                            if (err) console.error(`❌ ${supplier.company} profil:`, err.message);
                            else console.log(`✅ ${supplier.company} profil oluşturuldu`);
                        }
                    );
                }
            }
        );
    });

    // Kategoriler ekle
    const categories = [
        'Metal İşleri', 'Makine Parçaları', 'Kimyasal Maddeler', 'Elektrik Malzemeleri',
        'İnşaat Malzemeleri', 'Ofis Malzemeleri', 'Güvenlik Ekipmanları', 'Temizlik Malzemeleri'
    ];

    categories.forEach(category => {
        db.run(`INSERT OR IGNORE INTO categories (name) VALUES (?)`, [category], (err) => {
            if (err) console.error(`❌ Kategori ${category}:`, err.message);
            else console.log(`✅ Kategori eklendi: ${category}`);
        });
    });

    // Sistem ayarları
    const settings = [
        {key: 'company_name', value: 'TMI Teknoloji', description: 'Şirket Adı'},
        {key: 'company_email', value: 'info@tmitek.com', description: 'Şirket Email'},
        {key: 'default_quotation_validity', value: '30', type: 'number', description: 'Varsayılan Teklif Geçerlilik Süresi (Gün)'},
        {key: 'auto_approval_suppliers', value: 'false', type: 'boolean', description: 'Tedarikçi Otomatik Onay'},
        {key: 'email_notifications', value: 'true', type: 'boolean', description: 'Email Bildirimleri Aktif'},
        {key: 'system_currency', value: 'TRY', description: 'Sistem Para Birimi'}
    ];

    settings.forEach(setting => {
        db.run(`INSERT OR IGNORE INTO settings (key, value, description, type) VALUES (?, ?, ?, ?)`, 
            [setting.key, setting.value, setting.description, setting.type || 'string'], 
            (err) => {
                if (err) console.error(`❌ Ayar ${setting.key}:`, err.message);
                else console.log(`✅ Sistem ayarı: ${setting.key} = ${setting.value}`);
            }
        );
    });

    setTimeout(() => {
        console.log('\n✅ VERİTABANI KURULUMU TAMAMLANDI!');
        console.log('\n📋 OLUŞTURULAN TABLOLAR:');
        console.log('   • users (Kullanıcılar)');
        console.log('   • suppliers (Tedarikçiler)');  
        console.log('   • requests (Talepler)');
        console.log('   • request_items (Talep Malzemeleri)');
        console.log('   • request_suppliers (Talep-Tedarikçi İlişkisi)');
        console.log('   • quotations (Teklifler)');
        console.log('   • quotation_items (Teklif Malzemeleri)');
        console.log('   • categories (Kategoriler)');
        console.log('   • notifications (Bildirimler)');
        console.log('   • files (Dosyalar)');
        console.log('   • settings (Ayarlar)');
        console.log('   • audit_logs (İşlem Geçmişi)');
        
        console.log('\n👥 TEST KULLANICILARI:');
        console.log('   • admin / admin123 (Admin)');
        console.log('   • demirtas_metal / supplier123 (Tedarikçi)');
        console.log('   • yilmaz_muhendislik / supplier123 (Tedarikçi)');
        console.log('   • atlas_kimya / supplier123 (Tedarikçi)');
        
        console.log('\n🚀 Sunucuyu başlatmak için: npm start');
        
        db.close();
    }, 2000);
}
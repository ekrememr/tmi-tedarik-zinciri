const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database/tedarik.db');

console.log('📊 ÖRNEK TALEP VE TEKLİFLER EKLENİYOR...\n');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Veritabanı bağlantı hatası:', err.message);
        return;
    }
    console.log('✅ SQLite veritabanına bağlanıldı');
});

db.serialize(() => {
    // Örnek talepler ekle
    const sampleRequests = [
        {
            request_no: 'REQ-2024-001',
            title: 'Çelik Profil ve Sac Malzeme Talebi',
            description: 'Fabrika inşaat projesi için çelik profil ve sac malzeme talebi',
            deadline: '2024-12-31',
            priority: 'high',
            status: 'active'
        },
        {
            request_no: 'REQ-2024-002', 
            title: 'Elektrik Panosu Komponentleri',
            description: 'Ana elektrik dağıtım panosu için gerekli komponentler',
            deadline: '2024-11-15',
            priority: 'normal',
            status: 'active'
        },
        {
            request_no: 'REQ-2024-003',
            title: 'Kimyasal Temizlik Malzemeleri',
            description: 'Endüstriyel temizlik için kimyasal malzemeler',
            deadline: '2024-10-30',
            priority: 'normal', 
            status: 'active'
        }
    ];

    // Admin kullanıcı ID'sini al
    db.get("SELECT id FROM users WHERE username = 'admin'", (err, row) => {
        if (err) {
            console.error('❌ Admin kullanıcı bulunamadı:', err.message);
            return;
        }

        const adminId = row.id;

        sampleRequests.forEach((request, index) => {
            db.run(`INSERT OR IGNORE INTO requests (request_no, title, description, deadline, priority, status, created_by, total_items)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [request.request_no, request.title, request.description, request.deadline, request.priority, request.status, adminId, 3],
                function(err) {
                    if (err) {
                        console.error(`❌ Talep ${request.request_no}:`, err.message);
                        return;
                    }
                    
                    console.log(`✅ Talep oluşturuldu: ${request.title}`);
                    const requestId = this.lastID;

                    // Her talep için örnek malzemeler ekle
                    const sampleItems = getSampleItemsForRequest(index);
                    
                    sampleItems.forEach((item, itemIndex) => {
                        db.run(`INSERT INTO request_items (request_id, item_no, material_name, quantity, unit, specifications, category)
                                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [requestId, itemIndex + 1, item.name, item.quantity, item.unit, item.specs, item.category],
                            function(err) {
                                if (err) console.error(`❌ Malzeme ${item.name}:`, err.message);
                                else console.log(`   ✅ Malzeme eklendi: ${item.name}`);
                            }
                        );
                    });

                    // Tedarikçileri talebe ata
                    db.all("SELECT id FROM suppliers", (err, suppliers) => {
                        if (err) return;
                        
                        suppliers.forEach(supplier => {
                            db.run(`INSERT OR IGNORE INTO request_suppliers (request_id, supplier_id, invitation_sent, invitation_date, status)
                                    VALUES (?, ?, 1, datetime('now'), 'invited')`,
                                [requestId, supplier.id],
                                function(err) {
                                    if (err) return;
                                    
                                    // Her tedarikçi için örnek teklif oluştur
                                    const quotationNo = `QUO-${request.request_no.split('-')[2]}-${supplier.id.toString().padStart(3, '0')}`;
                                    
                                    db.run(`INSERT OR IGNORE INTO quotations (quotation_no, request_id, supplier_id, total_amount, currency, delivery_time, validity_days, status, submission_date)
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                                        [quotationNo, requestId, supplier.id, getRandomPrice(), 'TRY', getRandomDeliveryTime(), 30, 'submitted'],
                                        function(err) {
                                            if (err) return;
                                            
                                            const quotationId = this.lastID;
                                            console.log(`   ✅ Teklif oluşturuldu: ${quotationNo}`);

                                            // Teklif kalemleri ekle
                                            db.all("SELECT id FROM request_items WHERE request_id = ?", [requestId], (err, items) => {
                                                if (err) return;
                                                
                                                items.forEach(item => {
                                                    const unitPrice = getRandomPrice() / 10;
                                                    db.run(`INSERT INTO quotation_items (quotation_id, request_item_id, unit_price, total_price, delivery_time, brand)
                                                            VALUES (?, ?, ?, ?, ?, ?)`,
                                                        [quotationId, item.id, unitPrice, unitPrice * 10, getRandomDeliveryTime(), getRandomBrand()],
                                                        function(err) {
                                                            if (err) return;
                                                        }
                                                    );
                                                });
                                            });
                                        }
                                    );
                                }
                            );
                        });
                    });
                }
            );
        });
    });

    setTimeout(() => {
        console.log('\n🎉 ÖRNEK VERİLER BAŞARIYLA EKLENDİ!');
        console.log('\n📊 OLUŞTURULAN VERİLER:');
        console.log('   • 3 Örnek Talep');
        console.log('   • 9 Talep Malzemesi (her talep için 3 adet)');
        console.log('   • 9 Teklif (3 tedarikçi x 3 talep)');
        console.log('   • 27 Teklif Kalemi');
        console.log('\n✅ Sistem artık tam test verileri ile hazır!');
        db.close();
    }, 3000);
});

function getSampleItemsForRequest(requestIndex) {
    const itemSets = [
        // İnşaat malzemeleri
        [
            {name: 'IPE 160 Çelik Profil', quantity: 50, unit: 'Adet', specs: '6 metre uzunluk, S235JR kalite', category: 'Metal İşleri'},
            {name: 'DKP Sac 2mm', quantity: 100, unit: 'm²', specs: 'Galvanizli kaplama', category: 'Metal İşleri'},
            {name: 'Kaynak Elektrodu', quantity: 20, unit: 'Paket', specs: 'E7018 tipi, 3.2mm çap', category: 'Metal İşleri'}
        ],
        // Elektrik malzemeleri  
        [
            {name: 'Şalter 3 Faz 100A', quantity: 5, unit: 'Adet', specs: 'Schneider Electric veya eşdeğeri', category: 'Elektrik Malzemeleri'},
            {name: 'Kontaktör 40A', quantity: 10, unit: 'Adet', specs: '220V bobinli', category: 'Elektrik Malzemeleri'},
            {name: 'Kablo NYY 4x35', quantity: 500, unit: 'metre', specs: 'Toprak dahil 4 damarlı', category: 'Elektrik Malzemeleri'}
        ],
        // Kimyasal malzemeler
        [
            {name: 'Endüstriyel Deterjan', quantity: 100, unit: 'Litre', specs: 'Yağ çözücü özellikli', category: 'Kimyasal Maddeler'},
            {name: 'Pas Sökücü Sprey', quantity: 24, unit: 'Adet', specs: '400ml aerosol kutu', category: 'Kimyasal Maddeler'},
            {name: 'Koruyucu Boya', quantity: 50, unit: 'Litre', specs: 'Epoksi esaslı, gri renk', category: 'Kimyasal Maddeler'}
        ]
    ];
    
    return itemSets[requestIndex] || itemSets[0];
}

function getRandomPrice() {
    return Math.floor(Math.random() * 50000) + 5000;
}

function getRandomDeliveryTime() {
    return Math.floor(Math.random() * 30) + 7;
}

function getRandomBrand() {
    const brands = ['Bosch', 'Siemens', 'ABB', 'Schneider', 'Phoenix', 'Weidmuller', 'Türk Malı', 'İthal'];
    return brands[Math.floor(Math.random() * brands.length)];
}
# 🏭 TMI Tedarik Zinciri Yönetim Sistemi

Tam özellikli B2B tedarik zinciri yönetim platformu. Admin ve tedarikçi portalları ile eksiksiz talep-teklif süreç yönetimi.

![TMI Logo](https://img.shields.io/badge/TMI-Tedarik%20Zinciri-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![License](https://img.shields.io/badge/license-Private-red)

## 🚀 Canlı Demo

**Demo Linkleri:**
- 🌐 [Ana Sayfa](https://tmi-tedarik-zinciri.onrender.com)
- 👨‍💼 [Admin Panel](https://tmi-tedarik-zinciri.onrender.com/admin)  
- 🏭 [Tedarikçi Portal](https://tmi-tedarik-zinciri.onrender.com/supplier)

**Test Kullanıcıları:**
- **Admin:** `admin` / `admin123`
- **Tedarikçi:** `demirtas_metal` / `supplier123`

## ✨ Özellikler

### 👨‍💼 Admin Paneli
- 📊 Dashboard ve analytics
- 📋 Talep yönetimi (manuel + Excel upload)
- 🏢 Tedarikçi yönetimi ve onay sistemi
- 💰 Teklif karşılaştırma modülü
- 📈 Raporlar ve grafikler
- ⚙️ Sistem ayarları

### 🏭 Tedarikçi Portalı  
- 📨 Gelen talepleri görüntüleme
- 💸 Teklif hazırlama ve gönderme
- 📊 Kişisel dashboard
- 📋 Geçmiş işlemler

### 🔧 Teknik Özellikler
- 🛡️ JWT + Session Authentication
- 📁 Excel upload & parsing (XLSX)
- 📧 Email bildirim sistemi
- 📊 PDF export (PDFKit)
- 🔒 Rate limiting & güvenlik
- 📱 Responsive tasarım

## 🛠️ Teknoloji Stack

**Backend:**
- Node.js + Express.js
- SQLite veritabanı
- JWT Authentication
- Multer (file upload)
- Nodemailer (email)

**Frontend:**
- Vanilla JavaScript
- Bootstrap 5
- Chart.js (grafikler)
- FontAwesome icons

**Güvenlik:**
- Helmet.js
- CORS
- Rate limiting
- bcrypt password hashing

## 📦 Kurulum

```bash
# Repository'yi klonla
git clone https://github.com/ekrememr/tmi-tedarik-zinciri.git
cd tmi-tedarik-zinciri

# Bağımlılıkları yükle
npm install

# Veritabanını başlat
npm run init-db

# Sunucuyu başlat
npm start
```

## 🚀 Canlı Demo

Demo linki: **https://tmi-tedarik-zinciri.onrender.com**

**Test Kullanıcıları:**
- Admin: `admin` / `admin123`
- Tedarikçi: `demirtas_metal` / `supplier123`

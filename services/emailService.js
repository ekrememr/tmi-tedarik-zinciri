const nodemailer = require('nodemailer');
const database = require('../config/database');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initializeTransporter();
    }

    // Email transporter'ı başlat
    async initializeTransporter() {
        try {
            this.transporter = nodemailer.createTransporter({
                host: process.env.EMAIL_HOST || 'smtp.gmail.com',
                port: process.env.EMAIL_PORT || 587,
                secure: process.env.EMAIL_SECURE === 'true', // TLS
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS // Gmail için App Password
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            // Bağlantıyı test et
            if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                await this.transporter.verify();
                console.log('✅ Email servis bağlantısı başarılı');
            } else {
                console.log('⚠️  Email konfigürasyonu bulunamadı (.env dosyasını kontrol edin)');
            }
        } catch (error) {
            console.error('❌ Email servis hatası:', error.message);
            this.transporter = null;
        }
    }

    // Email gönder
    async sendEmail(to, subject, htmlContent, textContent = null) {
        try {
            if (!this.transporter) {
                console.log('Email gönderilemiyor: Transporter yapılandırılmamış');
                return false;
            }

            const mailOptions = {
                from: process.env.EMAIL_FROM || `"${process.env.APP_NAME}" <${process.env.EMAIL_USER}>`,
                to,
                subject,
                html: htmlContent,
                text: textContent || this.stripHtml(htmlContent)
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log(`✅ Email gönderildi: ${to} - ${subject}`);
            return result;
        } catch (error) {
            console.error(`❌ Email gönderme hatası (${to}):`, error.message);
            return false;
        }
    }

    // HTML'den text çıkar
    stripHtml(html) {
        return html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }

    // Email template'i oluştur
    createTemplate(title, content, actionUrl = null, actionText = null) {
        const companyName = process.env.COMPANY_NAME || 'TMI Teknoloji';
        const appUrl = process.env.APP_URL || 'http://localhost:8000';

        return `
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    line-height: 1.6; 
                    color: #333; 
                    background-color: #f4f4f4; 
                    margin: 0; 
                    padding: 0;
                }
                .email-container {
                    max-width: 600px;
                    margin: 20px auto;
                    background: white;
                    border-radius: 10px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    overflow: hidden;
                }
                .email-header {
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                    color: white;
                    padding: 30px;
                    text-align: center;
                }
                .email-header h1 {
                    margin: 0;
                    font-size: 24px;
                    font-weight: 600;
                }
                .email-body {
                    padding: 30px;
                }
                .email-body h2 {
                    color: #2c3e50;
                    margin-top: 0;
                    font-size: 20px;
                }
                .email-body p {
                    margin: 15px 0;
                    font-size: 16px;
                }
                .info-box {
                    background: #f8f9fa;
                    border-left: 4px solid #3b82f6;
                    padding: 15px;
                    margin: 20px 0;
                    border-radius: 4px;
                }
                .action-button {
                    display: inline-block;
                    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                    color: white;
                    padding: 12px 30px;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: 600;
                    margin: 20px 0;
                    transition: all 0.3s ease;
                }
                .action-button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
                }
                .email-footer {
                    background: #f8f9fa;
                    padding: 20px;
                    text-align: center;
                    font-size: 14px;
                    color: #6c757d;
                    border-top: 1px solid #dee2e6;
                }
                .social-links {
                    margin: 15px 0;
                }
                .social-links a {
                    color: #3b82f6;
                    text-decoration: none;
                    margin: 0 10px;
                }
                .divider {
                    height: 1px;
                    background: linear-gradient(90deg, transparent, #dee2e6, transparent);
                    margin: 30px 0;
                }
                @media only screen and (max-width: 600px) {
                    .email-container {
                        margin: 10px;
                        border-radius: 0;
                    }
                    .email-header, .email-body {
                        padding: 20px;
                    }
                    .email-header h1 {
                        font-size: 20px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <h1>${companyName}</h1>
                    <p>Tedarik Zinciri Yönetim Sistemi</p>
                </div>
                
                <div class="email-body">
                    <h2>${title}</h2>
                    ${content}
                    
                    ${actionUrl && actionText ? `
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${actionUrl}" class="action-button">${actionText}</a>
                        </div>
                    ` : ''}
                    
                    <div class="divider"></div>
                    
                    <p><strong>Not:</strong> Bu email otomatik olarak gönderilmiştir. Lütfen yanıtlamayın.</p>
                </div>
                
                <div class="email-footer">
                    <p><strong>${companyName}</strong></p>
                    <p>Bu email ${new Date().toLocaleDateString('tr-TR')} tarihinde gönderilmiştir.</p>
                    <div class="social-links">
                        <a href="${appUrl}">Sisteme Giriş</a> |
                        <a href="mailto:${process.env.COMPANY_EMAIL}">İletişim</a>
                    </div>
                    <p style="font-size: 12px; color: #9ca3af;">
                        © 2025 ${companyName}. Tüm hakları saklıdır.
                    </p>
                </div>
            </div>
        </body>
        </html>`;
    }

    // Yeni talep bildirimi (Tedarikçilere)
    async notifyNewRequest(supplierEmails, requestData) {
        const subject = `Yeni Teklif Talebi: ${requestData.title}`;
        
        const content = `
            <p>Merhaba,</p>
            <p>Sizin için yeni bir teklif talebi oluşturuldu. Detayları aşağıda bulabilirsiniz:</p>
            
            <div class="info-box">
                <p><strong>Talep No:</strong> ${requestData.request_no}</p>
                <p><strong>Başlık:</strong> ${requestData.title}</p>
                <p><strong>Açıklama:</strong> ${requestData.description || 'Belirtilmemiş'}</p>
                <p><strong>Öncelik:</strong> ${requestData.priority.toUpperCase()}</p>
                <p><strong>Son Tarih:</strong> ${requestData.deadline ? new Date(requestData.deadline).toLocaleDateString('tr-TR') : 'Belirtilmemiş'}</p>
                <p><strong>Malzeme Sayısı:</strong> ${requestData.total_items}</p>
            </div>
            
            <p>Teklif vermek için lütfen sisteme giriş yapın ve talep detaylarını inceleyin.</p>
            <p><strong>Önemli:</strong> Teklif verme süreniz sınırlıdır. Lütfen zamanında işlem yapın.</p>
        `;

        const actionUrl = `${process.env.APP_URL}/supplier/requests/${requestData.id}`;
        const template = this.createTemplate(subject, content, actionUrl, 'Teklif Ver');

        const results = [];
        for (const email of supplierEmails) {
            const result = await this.sendEmail(email, subject, template);
            results.push({ email, success: !!result });
            
            // Biraz bekle (rate limiting)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }

    // Teklif alındı bildirimi (Admin'e)
    async notifyQuotationReceived(adminEmails, quotationData) {
        const subject = `Yeni Teklif Alındı: ${quotationData.company_name}`;
        
        const content = `
            <p>Merhaba,</p>
            <p>Aşağıdaki talep için yeni bir teklif alındı:</p>
            
            <div class="info-box">
                <p><strong>Tedarikçi:</strong> ${quotationData.company_name}</p>
                <p><strong>Talep:</strong> ${quotationData.request_title}</p>
                <p><strong>Talep No:</strong> ${quotationData.request_no}</p>
                <p><strong>Teklif No:</strong> ${quotationData.quotation_no}</p>
                <p><strong>Toplam Tutar:</strong> ${quotationData.total_amount.toLocaleString('tr-TR')} ${quotationData.currency}</p>
                <p><strong>Teslimat Süresi:</strong> ${quotationData.delivery_time || 'Belirtilmemiş'} gün</p>
                <p><strong>Gönderim Tarihi:</strong> ${new Date(quotationData.submission_date).toLocaleString('tr-TR')}</p>
            </div>
            
            <p>Teklifi incelemek ve diğer tekliflerle karşılaştırmak için admin paneline giriş yapın.</p>
        `;

        const actionUrl = `${process.env.APP_URL}/admin/quotations/compare/${quotationData.request_id}`;
        const template = this.createTemplate(subject, content, actionUrl, 'Teklifleri Karşılaştır');

        const results = [];
        for (const email of adminEmails) {
            const result = await this.sendEmail(email, subject, template);
            results.push({ email, success: !!result });
        }

        return results;
    }

    // Tedarikçi onay bildirimi
    async notifySupplierApproval(email, supplierData, isApproved) {
        const subject = isApproved ? 'Başvurunuz Onaylandı!' : 'Başvurunuz Hakkında';
        
        let content;
        if (isApproved) {
            content = `
                <p>Sayın ${supplierData.contact_person || 'Değerli Tedarikçimiz'},</p>
                <p><strong>Tebrikler!</strong> ${supplierData.company_name} için yaptığınız tedarikçi başvurusu onaylandı.</p>
                
                <div class="info-box">
                    <p><strong>Şirket:</strong> ${supplierData.company_name}</p>
                    <p><strong>Onay Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
                    <p><strong>Durum:</strong> Aktif Tedarikçi</p>
                </div>
                
                <p>Artık sistem üzerinden teklif talepleri alabilir ve tekliflerinizi gönderebilirsiniz.</p>
                <p>Başarılı bir iş birliği dileriz!</p>
            `;
        } else {
            content = `
                <p>Sayın ${supplierData.contact_person || 'Değerli Başvuru Sahibi'},</p>
                <p>${supplierData.company_name} için yaptığınız tedarikçi başvurusu değerlendirme sürecinde olumsuz sonuçlanmıştır.</p>
                
                <div class="info-box">
                    <p><strong>Şirket:</strong> ${supplierData.company_name}</p>
                    <p><strong>Değerlendirme Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
                    <p><strong>Sebep:</strong> ${supplierData.rejection_reason || 'Mevcut kriterlere uygunluk'}</p>
                </div>
                
                <p>Gelecekte tekrar başvuru yapabilirsiniz. Herhangi bir sorunuz için bizimle iletişime geçebilirsiniz.</p>
            `;
        }

        const actionUrl = isApproved ? `${process.env.APP_URL}/supplier` : null;
        const actionText = isApproved ? 'Sisteme Giriş Yap' : null;
        const template = this.createTemplate(subject, content, actionUrl, actionText);

        return await this.sendEmail(email, subject, template);
    }

    // Kazanan tedarikçi bildirimi
    async notifyWinnerSelection(quotationData, isWinner) {
        const subject = isWinner ? 
            `Tebrikler! Teklifiniz Kabul Edildi` : 
            `Teklif Sonucu Hakkında`;
        
        let content;
        if (isWinner) {
            content = `
                <p>Sayın ${quotationData.contact_person || 'Değerli Tedarikçimiz'},</p>
                <p><strong>Tebrikler!</strong> "${quotationData.request_title}" talebi için verdiğiniz teklif kabul edildi.</p>
                
                <div class="info-box">
                    <p><strong>Talep:</strong> ${quotationData.request_title}</p>
                    <p><strong>Teklif No:</strong> ${quotationData.quotation_no}</p>
                    <p><strong>Tutar:</strong> ${quotationData.total_amount.toLocaleString('tr-TR')} ${quotationData.currency}</p>
                    <p><strong>Karar Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
                </div>
                
                <p>Kısa sürede sizinle iletişime geçeceğiz. Teslimat ve diğer detaylar için hazırlanın.</p>
                <p>İyi çalışmalar dileriz!</p>
            `;
        } else {
            content = `
                <p>Sayın ${quotationData.contact_person || 'Değerli Tedarikçimiz'},</p>
                <p>"${quotationData.request_title}" talebi için verdiğiniz teklif değerlendirildi.</p>
                
                <div class="info-box">
                    <p><strong>Talep:</strong> ${quotationData.request_title}</p>
                    <p><strong>Teklif No:</strong> ${quotationData.quotation_no}</p>
                    <p><strong>Sonuç:</strong> Bu sefer başka bir teklif tercih edildi</p>
                    <p><strong>Karar Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
                </div>
                
                <p>İlginiz için teşekkür ederiz. Gelecekteki fırsatlar için sistemi takip etmeye devam edin.</p>
            `;
        }

        const actionUrl = `${process.env.APP_URL}/supplier/quotations/${quotationData.quotation_id}`;
        const template = this.createTemplate(subject, content, actionUrl, 'Teklif Detayını Gör');

        return await this.sendEmail(quotationData.email, subject, template);
    }

    // Deadline uyarı bildirimi
    async notifyDeadlineWarning(supplierEmails, requestData, daysLeft) {
        const subject = `Son Tarih Yaklaşıyor: ${requestData.title}`;
        
        const urgencyLevel = daysLeft <= 1 ? 'ÇOK ACİL' : daysLeft <= 3 ? 'ACİL' : 'UYARI';
        
        const content = `
            <p>Merhaba,</p>
            <p><span style="color: #dc2626; font-weight: bold;">${urgencyLevel}:</span> Aşağıdaki talep için son tarih yaklaşıyor!</p>
            
            <div class="info-box" style="border-left-color: ${daysLeft <= 1 ? '#dc2626' : daysLeft <= 3 ? '#f59e0b' : '#3b82f6'};">
                <p><strong>Talep:</strong> ${requestData.title}</p>
                <p><strong>Talep No:</strong> ${requestData.request_no}</p>
                <p><strong>Kalan Süre:</strong> ${daysLeft} gün</p>
                <p><strong>Son Tarih:</strong> ${new Date(requestData.deadline).toLocaleDateString('tr-TR')}</p>
            </div>
            
            <p>Henüz teklif vermediyseniz, lütfen acilen sisteme giriş yaparak teklifinizi gönderin.</p>
            <p>Bu fırsatı kaçırmayın!</p>
        `;

        const actionUrl = `${process.env.APP_URL}/supplier/requests/${requestData.id}`;
        const template = this.createTemplate(subject, content, actionUrl, 'Hemen Teklif Ver');

        const results = [];
        for (const email of supplierEmails) {
            const result = await this.sendEmail(email, subject, template);
            results.push({ email, success: !!result });
        }

        return results;
    }

    // Hoş geldin email'i
    async sendWelcomeEmail(email, userData) {
        const subject = 'TMI Tedarik Zinciri Sistemine Hoş Geldiniz!';
        
        const content = `
            <p>Sayın ${userData.contact_person || 'Değerli Kullanıcı'},</p>
            <p><strong>TMI Tedarik Zinciri Yönetim Sistemi</strong>'ne hoş geldiniz!</p>
            
            <div class="info-box">
                <p><strong>Şirket:</strong> ${userData.company_name}</p>
                <p><strong>Kullanıcı Adı:</strong> ${userData.username}</p>
                <p><strong>Email:</strong> ${userData.email}</p>
                <p><strong>Kayıt Tarihi:</strong> ${new Date().toLocaleDateString('tr-TR')}</p>
            </div>
            
            <p>Başvurunuz değerlendirme sürecindedir. Onaylandıktan sonra teklif talepleri almaya başlayacaksınız.</p>
            <p>Bu süreçte sabrınız için teşekkür ederiz.</p>
            
            <h3>Sistem Özellikleri:</h3>
            <ul>
                <li>Anında teklif talepleri</li>
                <li>Online teklif gönderimi</li>
                <li>Performans takibi</li>
                <li>Doküman yönetimi</li>
                <li>Mobil uyumlu arayüz</li>
            </ul>
        `;

        const template = this.createTemplate(subject, content);
        return await this.sendEmail(email, subject, template);
    }

    // Toplu email gönder
    async sendBulkEmail(emails, subject, content, actionUrl = null, actionText = null) {
        const template = this.createTemplate(subject, content, actionUrl, actionText);
        
        const results = [];
        for (const email of emails) {
            const result = await this.sendEmail(email, subject, template);
            results.push({ email, success: !!result });
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return results;
    }

    // Email istatistikleri için log
    async logEmailSent(userId, emailType, recipient, success) {
        try {
            await database.run(`
                INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `, [
                userId || null,
                'email_sent',
                'notifications',
                null,
                JSON.stringify({
                    email_type: emailType,
                    recipient,
                    success,
                    timestamp: new Date().toISOString()
                })
            ]);
        } catch (error) {
            console.error('Email log error:', error);
        }
    }
}

// Singleton instance
const emailService = new EmailService();

module.exports = emailService;
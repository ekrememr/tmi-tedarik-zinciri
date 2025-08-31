const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../database/tedarik.db');
    }

    // Veritabanı bağlantısı
    connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Database connection error:', err.message);
                    reject(err);
                } else {
                    console.log('✅ SQLite database connected');
                    resolve(this.db);
                }
            });
        });
    }

    // Tek kayıt getir
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('❌ Database GET error:', err.message);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Çoklu kayıt getir
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('❌ Database ALL error:', err.message);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Veri ekleme/güncelleme/silme
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('❌ Database RUN error:', err.message);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // Transaction başlat
    beginTransaction() {
        return this.run('BEGIN TRANSACTION');
    }

    // Transaction commit
    commit() {
        return this.run('COMMIT');
    }

    // Transaction rollback
    rollback() {
        return this.run('ROLLBACK');
    }

    // Bağlantıyı kapat
    close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('❌ Database close error:', err.message);
                        reject(err);
                    } else {
                        console.log('✅ Database connection closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    // Veritabanı durumunu kontrol et
    async checkConnection() {
        try {
            const result = await this.get("SELECT datetime('now') as current_time");
            return !!result;
        } catch (error) {
            return false;
        }
    }

    // Pagination helper
    async paginate(baseQuery, countQuery, params = [], page = 1, limit = 10) {
        try {
            // Toplam kayıt sayısı
            const countResult = await this.get(countQuery, params);
            const total = countResult.count || 0;
            
            // Sayfalama hesaplamaları
            const offset = (page - 1) * limit;
            const totalPages = Math.ceil(total / limit);
            
            // Veri sorgusu
            const dataQuery = `${baseQuery} LIMIT ? OFFSET ?`;
            const data = await this.all(dataQuery, [...params, limit, offset]);
            
            return {
                data,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            };
        } catch (error) {
            throw error;
        }
    }
}

// Singleton instance
const database = new Database();

module.exports = database;
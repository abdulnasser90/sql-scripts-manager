const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const BASE_DIR = path.resolve(__dirname);
const DB_PATH = path.join(BASE_DIR, 'scripts.db');
const PUBLIC_DIR = path.join(BASE_DIR, 'public');

// Initialize SQLite
const db = new DatabaseSync(DB_PATH);

// Ensure schema exists
db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        content TEXT,
        is_duplicate INTEGER DEFAULT 0,
        is_favorite INTEGER DEFAULT 0,
        file_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Auto-seed database if empty (e.g. on fresh deploy or clone)
try {
    const currentCount = db.prepare(`SELECT COUNT(*) as c FROM scripts`).get().c;
    if (currentCount === 0) {
        const seedFiles = fs.readdirSync(BASE_DIR).filter(f => f.startsWith('seed') && f.endsWith('.json')).sort();
        const insertStmt = db.prepare(`
            INSERT INTO scripts (id, name, category, description, content, is_duplicate, is_favorite, file_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const sFile of seedFiles) {
            try {
                const seedData = JSON.parse(fs.readFileSync(path.join(BASE_DIR, sFile), 'utf8'));
                for (const item of seedData) {
                    insertStmt.run(
                        item.id,
                        item.name,
                        item.category,
                        item.description || '',
                        item.content || '',
                        item.is_duplicate || 0,
                        item.is_favorite || 0,
                        item.file_path || `${item.category}/${item.name}`,
                        item.created_at || new Date().toISOString(),
                        item.updated_at || new Date().toISOString()
                    );
                }
                console.log(`Seeded ${seedData.length} scripts from ${sFile}`);
            } catch (e) {
                console.warn(`Could not seed from ${sFile}:`, e.message);
            }
        }
    }
} catch (e) {
    console.warn('Auto-seed check notice:', e.message);
}

// Helper to send JSON responses
function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

// Helper to send errors
function sendError(res, message, status = 500) {
    sendJSON(res, { error: message }, status);
}

// Helper to read request body
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

// MIME types
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    try {
        // --- API ROUTES ---
        if (pathname.startsWith('/api/')) {

            // GET /api/categories
            if (req.method === 'GET' && pathname === '/api/categories') {
                const rows = db.prepare(`
                    SELECT category, COUNT(*) as count 
                    FROM scripts 
                    GROUP BY category 
                    ORDER BY category ASC
                `).all();

                const total = db.prepare(`SELECT COUNT(*) as total FROM scripts`).get();
                const favCount = db.prepare(`SELECT COUNT(*) as favs FROM scripts WHERE is_favorite = 1`).get();

                return sendJSON(res, {
                    categories: rows,
                    total: total.total,
                    favorites: favCount.favs
                });
            }

            // GET /api/scripts
            if (req.method === 'GET' && pathname === '/api/scripts') {
                const category = parsedUrl.searchParams.get('category');
                const favorites = parsedUrl.searchParams.get('favorites');
                const searchName = parsedUrl.searchParams.get('searchName') || '';
                const searchDesc = parsedUrl.searchParams.get('searchDesc') || '';
                const searchContent = parsedUrl.searchParams.get('searchContent') || '';
                const q = parsedUrl.searchParams.get('q') || '';

                let query = `
                    SELECT id, name, category, description, is_duplicate, is_favorite, 
                           file_path, updated_at, content
                    FROM scripts
                    WHERE 1=1
                `;
                const params = [];

                if (category && category !== 'ALL') {
                    query += ` AND category = ?`;
                    params.push(category);
                }

                if (favorites === 'true' || favorites === '1') {
                    query += ` AND is_favorite = 1`;
                }

                if (searchName) {
                    query += ` AND name LIKE ?`;
                    params.push(`%${searchName}%`);
                }

                if (searchDesc) {
                    query += ` AND description LIKE ?`;
                    params.push(`%${searchDesc}%`);
                }

                if (searchContent) {
                    query += ` AND content LIKE ?`;
                    params.push(`%${searchContent}%`);
                }

                if (q) {
                    query += ` AND (name LIKE ? OR description LIKE ? OR content LIKE ?)`;
                    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
                }

                query += ` ORDER BY is_favorite DESC, category ASC, name ASC`;

                const scripts = db.prepare(query).all(...params);
                return sendJSON(res, scripts);
            }

            // GET /api/scripts/:id
            const scriptIdMatch = pathname.match(/^\/api\/scripts\/(\d+)$/);
            if (req.method === 'GET' && scriptIdMatch) {
                const id = Number(scriptIdMatch[1]);
                const script = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
                if (!script) return sendError(res, 'Script not found', 404);
                return sendJSON(res, script);
            }

            // POST /api/scripts (Create new script)
            if (req.method === 'POST' && pathname === '/api/scripts') {
                const body = await parseRequestBody(req);
                let { name, category, description = '', content = '' } = body;

                if (!name || !name.trim()) return sendError(res, 'اسم السكريبت مطلوب', 400);
                name = name.trim();
                category = (category && category.trim()) ? category.trim() : 'Others';

                // Check extension
                if (!path.extname(name)) {
                    name += '.sql';
                }

                const isDuplicate = name.includes('.duplicate') ? 1 : 0;
                const relativePath = `${category}/${name}`;

                // Insert into SQLite
                const stmt = db.prepare(`
                    INSERT INTO scripts (name, category, description, content, is_duplicate, is_favorite, file_path, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP)
                `);
                stmt.run(name, category, description, content, isDuplicate, relativePath);

                const created = db.prepare(`SELECT * FROM scripts WHERE id = last_insert_rowid()`).get();
                return sendJSON(res, created, 201);
            }

            // PUT /api/scripts/:id (Update existing script)
            if (req.method === 'PUT' && scriptIdMatch) {
                const id = Number(scriptIdMatch[1]);
                const existing = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
                if (!existing) return sendError(res, 'Script not found', 404);

                const body = await parseRequestBody(req);
                const name = (body.name && body.name.trim()) ? body.name.trim() : existing.name;
                const category = (body.category && body.category.trim()) ? body.category.trim() : existing.category;
                const description = body.description !== undefined ? body.description : existing.description;
                const content = body.content !== undefined ? body.content : existing.content;
                const isDuplicate = name.includes('.duplicate') ? 1 : 0;
                const relativePath = `${category}/${name}`;

                // Update database
                db.prepare(`
                    UPDATE scripts 
                    SET name = ?, category = ?, description = ?, content = ?, is_duplicate = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(name, category, description, content, isDuplicate, relativePath, id);

                const updated = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
                return sendJSON(res, updated);
            }

            // DELETE /api/scripts/:id (Delete script)
            if (req.method === 'DELETE' && scriptIdMatch) {
                const id = Number(scriptIdMatch[1]);
                const existing = db.prepare(`SELECT * FROM scripts WHERE id = ?`).get(id);
                if (!existing) return sendError(res, 'Script not found', 404);

                // Delete from DB
                db.prepare(`DELETE FROM scripts WHERE id = ?`).run(id);

                return sendJSON(res, { success: true, message: 'Script deleted successfully', id });
            }

            // POST /api/scripts/:id/toggle-favorite
            const favMatch = pathname.match(/^\/api\/scripts\/(\d+)\/toggle-favorite$/);
            if (req.method === 'POST' && favMatch) {
                const id = Number(favMatch[1]);
                const script = db.prepare(`SELECT is_favorite FROM scripts WHERE id = ?`).get(id);
                if (!script) return sendError(res, 'Script not found', 404);

                const newFav = script.is_favorite === 1 ? 0 : 1;
                db.prepare(`UPDATE scripts SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newFav, id);
                return sendJSON(res, { id, is_favorite: newFav });
            }

            return sendError(res, 'API endpoint not found', 404);
        }

        // --- STATIC FILE SERVING ---
        let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

        // Security check
        if (!filePath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403);
            return res.end('Forbidden');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
        } else {
            // Fallback to index.html
            const indexPath = path.join(PUBLIC_DIR, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(indexPath).pipe(res);
            } else {
                res.writeHead(404);
                res.end('File not found');
            }
        }
    } catch (err) {
        console.error('Server error:', err);
        sendError(res, err.message, 500);
    }
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 SQL Scripts Manager v2.0 is running!`);
    console.log(`👉 Web Interface: http://localhost:${PORT}`);
    console.log(`💾 SQLite DB: ${DB_PATH}`);
    console.log(`====================================================`);
});

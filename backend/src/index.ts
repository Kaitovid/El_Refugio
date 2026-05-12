import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import http from 'http';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
const port = process.env.PORT || 5000;

// Prometheus metrics
collectDefaultMetrics();

// Custom metrics examples (optional)
const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Database Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) return console.error('Error acquiring client', err.stack);
  console.log('Connected to Neon PostgreSQL database');
  release();
});

io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => {
    socket.join(groupId);
  });
});

// --- Metrics Endpoint ---
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

// Middleware to track requests
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status_code: res.statusCode
    });
  });
  next();
});

// --- API Endpoints ---
app.post('/api/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password_hash, status, role, display_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [username, email, hash, 'active', 'user', username]
    );
    const generalGroup = await pool.query("SELECT id FROM groups WHERE name = 'General'");
    if (generalGroup.rows.length > 0) {
      await pool.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [generalGroup.rows[0].id, newUser.rows[0].id, 'member']
      );
    }
    res.json(newUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/profile', async (req: Request, res: Response) => {
  const { userId, display_name, bio } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const user = await pool.query(
      'UPDATE users SET display_name = $1, bio = $2 WHERE id = $3 RETURNING *',
      [display_name, bio, userId]
    );
    res.json(user.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/groups/:userId', async (req: Request, res: Response) => {
  try {
    const groups = await pool.query("SELECT * FROM groups WHERE deleted_at IS NULL");
    res.json(groups.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching groups' });
  }
});

app.get('/api/messages/:groupId', async (req: Request, res: Response) => {
  const { groupId } = req.params;
  try {
    const messages = await pool.query(
      `SELECT m.*, u.display_name, u.username as sender_username 
       FROM messages m 
       LEFT JOIN users u ON m.sender_id = u.id 
       WHERE group_id = $1 
       ORDER BY created_at ASC`,
      [groupId]
    );
    const msgs = messages.rows.map((m: any) => ({
      ...m,
      content: m.content_encrypted ? m.content_encrypted.toString('utf-8') : ''
    }));
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

app.post('/api/messages', upload.single('file'), async (req: Request, res: Response) => {
  const group_id = req.body.group_id;
  const sender_id = req.body.sender_id;
  let messageContent = req.body.content || '';
  let messageType = 'text';

  if (req.file) {
    messageType = 'file';
    messageContent = req.file.filename; 
  }

  try {
    const newMessage = await pool.query(
      `INSERT INTO messages (group_id, sender_id, content_encrypted, content_iv, content_hmac, message_type) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [group_id, sender_id, Buffer.from(messageContent), Buffer.from('iv'), Buffer.from('hmac'), messageType]
    );

    const m = newMessage.rows[0];
    const userResult = await pool.query('SELECT display_name, username FROM users WHERE id = $1', [sender_id]);
    const fullMsg = {
      ...m,
      content: messageContent,
      display_name: userResult.rows[0]?.display_name,
      sender_username: userResult.rows[0]?.username
    };

    io.to(group_id).emit('new_message', fullMsg);

    res.json(fullMsg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error sending message' });
  }
});

app.post('/api/seed', async (req: Request, res: Response) => {
  try {
    const adminExists = await pool.query("SELECT * FROM users WHERE username = 'sysadmin'");
    if (adminExists.rows.length === 0) {
      const adminHash = await bcrypt.hash('dummy', 10);
      await pool.query(
        "INSERT INTO users (username, email, password_hash, role, status, email_verified) VALUES ('sysadmin', 'admin@elrefugio.app', $1, 'admin', 'active', true)",
        [adminHash]
      );
    }
    const adminId = (await pool.query("SELECT id FROM users WHERE username = 'sysadmin'")).rows[0].id;
    const groupsToSeed = [
      { name: 'General', desc: 'Canal principal del equipo' },
      { name: 'Diseño & UX', desc: 'Feedback, wireframes y assets' },
      { name: 'Infraestructura', desc: 'Deploys, incidentes y monitoreo' },
      { name: 'Producto', desc: 'Roadmap, sprints y prioridades' }
    ];
    for (const g of groupsToSeed) {
      await pool.query(
        'INSERT INTO groups (name, description, owner_id) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
        [g.name, g.desc, adminId]
      );
    }
    res.json({ message: 'Database seeded successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Seeding failed' });
  }
});

app.post('/api/cleanup', async (req: Request, res: Response) => {
  res.json({ message: 'ok' });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

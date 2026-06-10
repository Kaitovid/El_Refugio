import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool } from '../../shared/db';

dotenv.config();

const app = express();
app.use(express.json());

const port = process.env.AUTH_PORT || 5001;

app.post('/api/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password_hash, status, role, display_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [username, email, hash, 'active', 'user', username]
    );
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
    console.error(err);
    res.status(500).json({ error: 'Database error' });
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
    res.json({ message: 'Auth and Groups seeded successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Seeding failed' });
  }
});

app.post('/api/cleanup', async (req: Request, res: Response) => {
  res.json({ message: 'ok' });
});

app.listen(port, () => console.log(`Auth service running on ${port}`));

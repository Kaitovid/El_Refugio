import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { pool } from '../../shared/db';

dotenv.config();

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const port = process.env.MESSAGE_PORT || 5002;

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => {
    socket.join(groupId);
  });
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
    console.error(err);
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

app.post('/api/messages', upload.single('file'), async (req: Request, res: Response) => {
  const group_id = req.body.group_id;
  const sender_id = req.body.sender_id;
  let messageContent = req.body.content || '';
  let messageType = req.body.message_type || 'text';

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

server.listen(port, () => console.log(`Messages service running on ${port}`));

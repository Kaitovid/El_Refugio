import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.GIF_PORT || 5003;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '0F7GPQyRtxvMtAm7kCxCZKnUYe30mjnL';
const GIPHY_API_URL = 'https://api.giphy.com/v1/gifs';

app.get('/api/gifs/search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const limit = req.query.limit || 10;
  const offset = req.query.offset || 0;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const response = await fetch(`${GIPHY_API_URL}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
    if (!response.ok) {
      throw new Error(`Giphy API error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching gifs:', error);
    res.status(500).json({ error: 'Failed to fetch GIFs' });
  }
});

app.get('/api/gifs/trending', async (req: Request, res: Response) => {
  const limit = req.query.limit || 10;
  const offset = req.query.offset || 0;

  try {
    const response = await fetch(`${GIPHY_API_URL}/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}`);
    if (!response.ok) {
      throw new Error(`Giphy API error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching trending gifs:', error);
    res.status(500).json({ error: 'Failed to fetch trending GIFs' });
  }
});

app.listen(port, () => console.log(`GIF service running on ${port}`));

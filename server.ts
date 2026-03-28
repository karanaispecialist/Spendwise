import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'spendwise-super-secret-key';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Custom Login API
  app.post('/api/login', (req, res) => {
    console.log('Login attempt for:', req.body.username);
    const { username, password } = req.body;

    if (username === 'karanverma005' && password === 'kashi2605') {
      console.log('Login successful');
      const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '24h' });
      res.cookie('auth_token', token, { 
        httpOnly: true, 
        secure: true, 
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000 
      });
      return res.json({ success: true, username });
    }

    console.log('Login failed: Invalid credentials');
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
  });

  app.get('/api/me', (req, res) => {
    const token = req.cookies.auth_token;
    if (!token) return res.status(401).json({ authenticated: false });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json({ authenticated: true, user: decoded });
    } catch (err) {
      res.status(401).json({ authenticated: false });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

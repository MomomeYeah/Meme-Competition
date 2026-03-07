import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import 'dotenv/config';

import authRoutes from './src/routes/auth.routes';
import competitionRoutes from './src/routes/competition.routes';
import { AppError } from './src/utils/errors';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors({ credentials: true, origin: 'http://localhost:3001' }));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/competitions', competitionRoutes);

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Server is running' });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: err.message });
  } else {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});


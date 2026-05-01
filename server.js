const express = require('express');
const cors = require('cors');
require('dotenv').config();
const prisma = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
// Prisma is initialized in db.js

// Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes.router);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/app', require('./routes/app'));
app.use('/api/documents', require('./routes/document'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/notifications', require('./routes/notification'));
app.use('/api/users', require('./routes/user'));
app.use('/auth', require('./routes/oauth'));

const appController = require('./controllers/appController');

// Mobile update endpoints
app.get('/version.json', appController.version);
app.get('/app-release.apk', appController.download);

// Basic route
app.get('/', (req, res) => {
  res.json({ success: true, message: 'StudyPark API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3055;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

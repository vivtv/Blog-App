const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Routes
const blogRoutes = require('./routes/blogs');
const authRoutes = require('./routes/auth');

// Middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json()); // Add JSON parsing middleware
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session setup
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'I_know_your_secret',
        resave: false,
        saveUninitialized: true,
    })
);

// Make user available in all templates
app.use((req, res, next) => {
    res.locals.user = req.session.userId
        ? { id: req.session.userId, email: req.session.userEmail }
        : null;
    next();
});

// Routes
app.use('/blogs', blogRoutes);
app.use('/', authRoutes);

// Home page
app.get('/', (req, res) => {
    const db = require('./db');
    
    // Fetch latest blog posts from database
    const query = `
        SELECT b.*, c.category_title, u.first_name, u.last_name
        FROM blog b
        LEFT JOIN category c ON b.idcategory = c.idcategory
        LEFT JOIN users u ON b.iduser = u.id
        ORDER BY b.blog_datetime DESC
        LIMIT 6
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching blogs:', err);
            return res.render('index', { blogs: [] });
        }
        
        res.render('index', { 
            blogs: results
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

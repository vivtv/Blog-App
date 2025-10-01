const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// Register page
router.get('/register', (req, res) => {
    res.render('register', { error: null, fullName: '', email: '' });
});

// Handle registration
router.post('/register', async (req, res) => {
    const { fullName, email, password, confirmPassword } = req.body;

    if (!fullName.includes(' ')) {
        return res.render('register', { error: 'Full name must include first and last name.', fullName, email });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        return res.render('register', { error: 'Invalid email format.', fullName, email });
    }

    if (password.length <= 6) {
        return res.render('register', { error: 'Password must be longer than 6 characters.', fullName, email });
    }

    if (password !== confirmPassword) {
        return res.render('register', { error: 'Passwords do not match.', fullName, email });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || '';

        const query = 'INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)';
        db.query(query, [firstName, lastName, email, hashedPassword], (err) => {
            if (err) {
                return res.render('register', { error: 'Email already exists or database error.', fullName, email });
            }
            res.redirect('/login');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal Server Error');
    }
});

// Login page
router.get('/login', (req, res) => {
    res.render('login', { error: null, email: '' });
});

// Handle login
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ? LIMIT 1';
    db.query(query, [email], async (err, results) => {
        if (err) return res.render('login', { error: 'Database error.', email });

        if (results.length === 0) return res.render('login', { error: 'Email not found.', email });

        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) return res.render('login', { error: 'Incorrect password.', email });

        // Save session
        req.session.userId = user.id;
        req.session.userEmail = user.email;

        res.redirect('/');
    });
});

// Post blog page (only for logged-in users)
router.get('/post_blog', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('post_blog');
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

module.exports = router;

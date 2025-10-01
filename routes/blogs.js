const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const multer = require('multer');

// Multer storage config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

function isLoggedIn(req, res, next) {
    if (req.session?.userId) {
        return next();
    }
    res.redirect('/login');
}

router.get('/blogs', isLoggedIn, (req, res) => {
    // Fetch latest blog posts from database with proper joins
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
            return res.render('index', { blogs: [], featuredBlog: null });
        }
        
        // Get featured blog (first one)
        const featuredBlog = results.length > 0 ? results[0] : null;
        const otherBlogs = results.slice(1);
        
        res.render('index', { 
            blogs: otherBlogs, 
            featuredBlog: featuredBlog 
        });
    });
});

router.get('/post', isLoggedIn, (req, res) => {
    // Get categories for the dropdown
    db.query('SELECT * FROM category', (err, categories) => {
        if (err) {
            console.error('Error fetching categories:', err);
            return res.render('post_blog', { user: req.session.user, categories: [] });
        }
        console.log('Categories found:', categories); // Debug log
        res.render('post_blog', { user: req.session.user, categories });
    });
});

router.post('/post', isLoggedIn, (req, res) => {
    const {
        title,
        content,
        category,
        blog_tag,
        blog_image
    } = req.body;

    const userId = req.session.userId;
    const author = req.session.userEmail || (res.locals.user && res.locals.user.email) || 'Unknown';

    // Basic validation
    if (!title || !content || !category) {
        return res.status(400).json({
            success: false,
            message: 'Invalid input. Ensure title, content, and a valid category are provided.'
        });
    }

    // Map string categories to database IDs
    const categoryMap = {
        'technology': 1,
        'design': 2,
        'startup': 3,
        'lifestyle': 4,
        'tools': 5,
        'mobile': 6,
        'tips': 7
    };

    const categoryId = categoryMap[category.toLowerCase()];
    if (!categoryId) {
        return res.status(400).json({ success: false, message: 'Invalid category selected.' });
    }

    // First, ensure the category exists in the database
    const categoryNames = {
        1: 'Technology',
        2: 'Design',
        3: 'Startup',
        4: 'Lifestyle',
        5: 'Tools',
        6: 'Mobile',
        7: 'Tips'
    };

    // Check if category exists, if not create it
    db.query('SELECT idcategory FROM category WHERE idcategory = ?', [categoryId], (checkErr, rows) => {
        if (checkErr) {
            console.error('Error checking category:', checkErr);
            return res.status(500).json({ success: false, message: 'Database error checking category' });
        }

        if (rows.length === 0) {
            // Category doesn't exist, create it
            db.query('INSERT INTO category (idcategory, category_title) VALUES (?, ?)', [categoryId, categoryNames[categoryId]], (insertErr) => {
                if (insertErr) {
                    console.error('Error creating category:', insertErr);
                    return res.status(500).json({ success: false, message: 'Error creating category' });
                }
                // Category created, now insert the blog
                insertBlog();
            });
        } else {
            // Category exists, insert the blog
            insertBlog();
        }
    });

    function insertBlog() {
        // Insert the blog post into the database
        const query = `
            INSERT INTO blog (
                blog_title,
                blog_detail,
                blog_image,
                blog_author,
                blog_datetime,
                idcategory,
                blog_tag,
                iduser
            ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
        `;

        db.query(query, [
            title,
            content,
            blog_image || null,
            author,
            categoryId,
            blog_tag || null,
            userId
        ], (err, result) => {
            if (err) {
                console.error('Error creating blog post:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Error creating blog post'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Blog post created successfully',
                blogId: result.insertId
            });
        });
    }
});

// Upload image endpoint
router.post('/upload-image', isLoggedIn, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const publicUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: publicUrl });
});

// Read a single blog post
router.get('/read/:id', (req, res) => {
    const blogId = req.params.id;
    const blogQuery = `
        SELECT b.*, c.category_title, u.first_name, u.last_name
        FROM blog b
        LEFT JOIN category c ON b.idcategory = c.idcategory
        LEFT JOIN users u ON b.iduser = u.id
        WHERE b.idblog = ?
        LIMIT 1
    `;
    
    const commentsQuery = `
        SELECT c.*, r.reply_name, r.reply_email, r.reply_msg, r.idreply
        FROM comment c
        LEFT JOIN reply r ON c.idcomment = r.idcomment
        WHERE c.idblog = ?
        ORDER BY c.idcomment DESC, r.idreply ASC
    `;
    
    db.query(blogQuery, [blogId], (err, blogResults) => {
        if (err) {
            console.error('Error fetching blog post:', err);
            return res.status(500).send('Internal Server Error');
        }
        if (blogResults.length === 0) {
            return res.status(404).send('Blog not found');
        }
        
        const blog = blogResults[0];
        
        // Fetch comments and replies
        db.query(commentsQuery, [blogId], (err, commentResults) => {
            if (err) {
                console.error('Error fetching comments:', err);
                return res.render('read_blog', { blog, comments: [] });
            }
            
            // Organize comments and replies
            const commentsMap = new Map();
            commentResults.forEach(row => {
                if (!commentsMap.has(row.idcomment)) {
                    commentsMap.set(row.idcomment, {
                        idcomment: row.idcomment,
                        comment_name: row.comment_name,
                        comment_email: row.comment_email,
                        comment_website: row.comment_website,
                        comment_msg: row.comment_msg,
                        replies: []
                    });
                }
                
                if (row.idreply && row.reply_name) {
                    commentsMap.get(row.idcomment).replies.push({
                        idreply: row.idreply,
                        reply_name: row.reply_name,
                        reply_email: row.reply_email,
                        reply_msg: row.reply_msg
                    });
                }
            });
            
            const comments = Array.from(commentsMap.values());
            res.render('read_blog', { blog, comments });
        });
    });
});

// Add comment
router.post('/comment', (req, res) => {
    const { idblog, comment_name, comment_email, comment_website, comment_msg } = req.body;
    
    if (!idblog || !comment_name || !comment_email || !comment_msg) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled' });
    }
    
    const query = `
        INSERT INTO comment (idblog, comment_name, comment_email, comment_website, comment_msg) 
        VALUES (?, ?, ?, ?, ?)
    `;
    
    db.query(query, [idblog, comment_name, comment_email, comment_website || null, comment_msg], (err, result) => {
        if (err) {
            console.error('Error adding comment:', err);
            return res.status(500).json({ success: false, message: 'Error adding comment' });
        }
        
        res.json({ success: true, message: 'Comment added successfully', commentId: result.insertId });
    });
});

// Add reply to comment
router.post('/reply', (req, res) => {
    const { idcomment, reply_name, reply_email, reply_msg } = req.body;
    
    if (!idcomment || !reply_name || !reply_email || !reply_msg) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled' });
    }
    
    const query = `
        INSERT INTO reply (idcomment, reply_name, reply_email, reply_msg) 
        VALUES (?, ?, ?, ?)
    `;
    
    db.query(query, [idcomment, reply_name, reply_email, reply_msg], (err, result) => {
        if (err) {
            console.error('Error adding reply:', err);
            return res.status(500).json({ success: false, message: 'Error adding reply' });
        }
        
        res.json({ success: true, message: 'Reply added successfully', replyId: result.insertId });
    });
});

module.exports = router;

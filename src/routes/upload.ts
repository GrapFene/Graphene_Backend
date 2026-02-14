import express from 'express';
import multer from 'multer';
import { getSupabase } from '../services/supabase.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
});

// POST /upload
router.post('/', authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const file = req.file;
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
        const filePath = `uploads/${fileName}`;

        const supabase = getSupabase();

        // Upload to Supabase Storage 'posts-media' bucket
        // Ensure bucket name matches exactly what you created in Supabase Dashboard
        const BUCKET_NAME = 'posts-media'; 

        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false
            });

        if (error) {
            console.error('Supabase upload error:', error);
            throw new Error(`Upload failed: ${error.message}`);
        }

        // Get public URL (Recommended for social media posts so links don't expire)
        // You must make the 'posts-media' bucket PUBLIC in Supabase Dashboard.
        const { data: publicUrlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(filePath);

        res.json({ 
            url: publicUrlData.publicUrl,
            path: filePath
        });

    } catch (error: any) {
        console.error('Upload route error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;

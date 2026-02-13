const express = require('express');
const path = require('path');
const VideoPresetManager = require('./presets.cjs');
const { createVideoWithPreset, processAllTikTokVideos } = require('./editvideo-enhanced.cjs');
const fs = require('fs');
const WebSocket = require('ws');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = 3000;

// 1. Create HTTP server
const server = app.listen(PORT, () => {
    console.log(`Video Editor UI running at http://localhost:${PORT}`);
});

// 2. Set up WebSocket server
const wss = new WebSocket.Server({ server });

// Track active connections
const clients = new Set();

// Express middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tiktokimages', express.static(path.join(__dirname, 'tiktokimages')));

const multer = require('multer');
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'tiktokimages');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + file.originalname);
        }
    })
});

// Image Management Routes
app.get('/api/images', (req, res) => {
    const dir = path.join(__dirname, 'tiktokimages');
    if (!fs.existsSync(dir)) return res.json([]);
    fs.readdir(dir, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        res.json(images);
    });
});

app.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, filename: req.file.filename });
});

app.delete('/api/images/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'tiktokimages', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    clients.add(ws);
    ws.on('close', () => {
        console.log('WebSocket disconnected');
        clients.delete(ws);
    });
});

// Broadcast progress to all clients
function broadcastProgress(progress) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'progress', data: progress }));
        }
    });
}

app.use('/tiktokvideos', express.static(path.join(__dirname, 'tiktokvideos')));

let activeScrapers = new Map();

app.post('/api/scrape-tiktok', async (req, res) => {
    const scraperId = Date.now().toString();
    activeScrapers.set(scraperId, { stop: false });

    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username is required' });

        const outputDir = path.join(__dirname, 'tiktokvideos');

        const files = await scrapeTikTokUser(username, outputDir, (progress) => {
            if (progress.status === 'check_stop') {
                return activeScrapers.get(scraperId)?.stop === true;
            }
            broadcastProgress({
                type: 'scraper',
                ...progress
            });
        });

        activeScrapers.delete(scraperId);
        res.json({
            success: true,
            message: `Downloaded ${files.length} videos`,
            files: files
        });
    } catch (error) {
        activeScrapers.delete(scraperId);
        console.error('Error in TikTok scraping:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/stop-scrape', (req, res) => {
    // Stop all active scrapers for simplicity or track by ID
    for (let scraper of activeScrapers.values()) {
        scraper.stop = true;
    }
    res.json({ success: true, message: 'Stopping all active downloads...' });
});

app.get('/api/list-videos/:username', (req, res) => {
    const userDir = path.join(__dirname, 'tiktokvideos', req.params.username);
    if (!fs.existsSync(userDir)) return res.json([]);
    fs.readdir(userDir, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const videos = files.filter(f => /\.mp4$/i.test(f));
        res.json(videos);
    });
});

app.get('/api/thumbnail/:username/:filename', (req, res) => {
    const { username, filename } = req.params;
    const videoPath = path.join(__dirname, 'tiktokvideos', username, filename);
    const thumbDir = path.join(__dirname, 'tiktokvideos', username, 'thumbnails');
    const thumbPath = path.join(thumbDir, filename.replace(/\.(mp4|mov)$/i, '.jpg'));

    if (!fs.existsSync(videoPath)) return res.status(404).send('Video not found');

    if (fs.existsSync(thumbPath)) {
        return res.sendFile(thumbPath);
    }

    if (!fs.existsSync(thumbDir)) {
        fs.mkdirSync(thumbDir, { recursive: true });
    }

    ffmpeg(videoPath)
        .on('end', () => {
            res.sendFile(thumbPath);
        })
        .on('error', (err) => {
            console.error('Thumbnail error:', err);
            res.status(500).send('Thumbnail failed');
        })
        .screenshots({
            timestamps: ['1'],
            filename: path.basename(thumbPath),
            folder: thumbDir,
            size: '320x180'
        });
});




const presetManager = new VideoPresetManager();

// Initialize default preset if none exists
if (Object.keys(presetManager.getAllPresets()).length === 0) {
    presetManager.createDefaultPreset();
}

// API Routes
app.get('/api/presets', (req, res) => {
    try {
        const presets = presetManager.getAllPresets();
        res.json(presets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/presets/:name', (req, res) => {
    try {
        const preset = presetManager.getPreset(req.params.name);
        if (preset) {
            res.json(preset);
        } else {
            res.status(404).json({ error: 'Preset not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/presets', (req, res) => {
    try {
        const { name, config } = req.body;
        if (!name || !config) {
            return res.status(400).json({ error: 'Name and config are required' });
        }

        const preset = presetManager.savePreset(name, config);
        res.json(preset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Example: Save the new preset
const newPreset = {
    name: "tiktok_iphone13_europe",
    config: {
        source: {
            video: "tiktokvideos",  // Directory for video clips
            images: "tiktokimages"  // Directory for overlay images
        },
        edits: [
            {
                type: "image_overlay",
                startTime: 1.2,     // Overlay start time (seconds)
                endTime: 1.3,       // Overlay end time (seconds)
                opacity: 0.5,       // Opacity of the overlay (0-1)
                randomImage: true   // Whether to pick a random image
            },
            // Add more edits as needed
        ],
        metadata: {
            device: "iPhone 13",
            region: "Europe",
            platform: "none"
        },
        output: {
            resolution: "1080x1920", // Vertical resolution for TikTok
            fps: 30,                 // Frames per second
            codec: "libx264",        // Video codec
            videoBitrate: "12M",     // Video bitrate (12 Mbps)
            audioCodec: "aac",       // Audio codec
            audioBitrate: "192k"     // Audio bitrate
        }
    }
};

// Save with force: true to ensure it overwrites any existing
presetManager.savePreset(newPreset.name, newPreset.config, true);

app.delete('/api/presets/:name', (req, res) => {
    try {
        const deleted = presetManager.deletePreset(req.params.name);
        if (deleted) {
            res.json({ message: 'Preset deleted successfully' });
        } else {
            res.status(404).json({ error: 'Preset not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/list-tiktok-users', (req, res) => {
    const tiktokDir = path.join(__dirname, 'tiktokvideos');
    if (!fs.existsSync(tiktokDir)) {
        return res.json([]);
    }
    fs.readdir(tiktokDir, { withFileTypes: true }, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const users = files
            .filter(f => f.isDirectory())
            .map(f => f.name);
        res.json(users);
    });
});

// Modify the create video endpoint
app.post('/create-video', async (req, res) => {
    try {
        const { presetName, tiktokUser, selectedFiles } = req.body;
        const VideoPresetManager = require('./presets.cjs');
        const presetManager = new VideoPresetManager();
        let preset = presetManager.getPreset(presetName);

        if (!preset) {
            return res.status(400).json({ error: 'Preset not found' });
        }

        // Clone preset and update video source if a user is selected
        if (tiktokUser) {
            preset = JSON.parse(JSON.stringify(preset));
            const config = preset.config || preset;
            if (config.source) {
                config.source.video = `tiktokvideos/${tiktokUser}`;
            }
        }

        const { processAllTikTokVideos } = require('./editvideo-enhanced.cjs');
        const processedFiles = await processAllTikTokVideos(preset, broadcastProgress, selectedFiles);



        res.json({
            success: true,
            message: `Processed ${processedFiles.length} videos`,
            files: processedFiles
        });
    } catch (error) {
        console.error('Error in video creation:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/list-folders', (req, res) => {
    const baseDir = path.join(__dirname); // or wherever your media folders are
    fs.readdir(baseDir, { withFileTypes: true }, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        // Only return directories, and filter out node_modules, public, etc.
        const ignore = ['node_modules', 'public', 'editedvideos'];
        const folders = files
            .filter(f => f.isDirectory() && !ignore.includes(f.name))
            .map(f => f.name);
        res.json(folders);
    });
});

// Serve the main UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
}); 
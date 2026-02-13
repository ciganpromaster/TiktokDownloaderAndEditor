const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const randomItem = require('random-item');
const sharp = require('sharp');

// Update the FFmpeg paths to match your actual installation
ffmpeg.setFfmpegPath('C:\\ffmpeg-2025-05-29-git-75960ac270-full_build\\ffmpeg-2025-05-29-git-75960ac270-full_build\\bin\\ffmpeg.exe');
ffmpeg.setFfprobePath('C:\\ffmpeg-2025-05-29-git-75960ac270-full_build\\ffmpeg-2025-05-29-git-75960ac270-full_build\\bin\\ffprobe.exe');

const ffmpegPath = 'C:\\ffmpeg-2025-05-29-git-75960ac270-full_build\\ffmpeg-2025-05-29-git-75960ac270-full_build\\bin\\ffmpeg.exe';
const ffprobePath = 'C:\\ffmpeg-2025-05-29-git-75960ac270-full_build\\ffmpeg-2025-05-29-git-75960ac270-full_build\\bin\\ffprobe.exe';

if (!fs.existsSync(ffmpegPath)) {
    console.error('FFmpeg not found at:', ffmpegPath);
    process.exit(1);
}

if (!fs.existsSync(ffprobePath)) {
    console.error('FFprobe not found at:', ffprobePath);
    process.exit(1);
}

function getRandomMedia(dir, extensions) {
    if (!fs.existsSync(dir)) {
        throw new Error(`Directory not found: ${dir}`);
    }

    const files = fs.readdirSync(dir)
        .filter(f => extensions.includes(path.extname(f).toLowerCase()));

    if (files.length === 0) {
        throw new Error(`No files found in ${dir} with extensions: ${extensions.join(', ')}`);
    }

    const selected = randomItem(files);
    return path.join(dir, selected);
}

async function validateImage(imagePath) {
    try {
        const newPath = imagePath.replace(/\.[^.]+$/, '_converted.jpg');
        await sharp(imagePath)
            .jpeg({
                quality: 90,
                mozjpeg: true
            })
            .toFile(newPath);
        return newPath;
    } catch (error) {
        console.error(`Failed to convert image ${imagePath}:`, error);
        throw error;
    }
}

function buildTextFilter(textOverlay, inputStream) {
    const { text, startTime, endTime, x, y, fontSize, color, borderColor, borderWidth, box, boxColor, boxBorderWidth } = textOverlay;

    let xPos = x === 'center' ? '(w-text_w)/2' : x;
    let yPos = y === 'center' ? '(h-text_h)/2' : y;

    let filter = `drawtext=text='${text}':fontfile=C\\\\:/Windows/Fonts/arial.ttf:` +
        `x=${xPos}:y=${yPos}:fontsize=${fontSize}:fontcolor=${color}:borderw=${borderWidth}:` +
        `bordercolor=${borderColor}:enable='between(t,${startTime},${endTime})'`;

    if (box) {
        filter += `:box=1:boxcolor=${boxColor}:boxborderw=${boxBorderWidth}`;
    }

    return filter;
}

async function createVideoWithPreset(preset) {
    console.log('Processing preset:', JSON.stringify(preset, null, 2)); // Debug log

    if (!preset) {
        throw new Error('No preset provided to createVideoWithPreset');
    }

    // Special handling for TikTok preset
    if (preset.name === "tiktok_iphone13_europe" ||
        (preset.config && preset.config.metadata && preset.config.metadata.platform === "none")) {
        console.log('Using TikTok-specific processing');
        return await createTikTokVideo(preset.config || preset);
    }

    // Original processing for other presets
    console.log('Using standard video processing');
    const config = preset.config || preset;

    if (!config.output?.resolution) {
        throw new Error('Missing output resolution in preset');
    }

    // Add default values for required fields
    const safePreset = {
        ...config,
        count: config.count || 1,
        segments: config.segments || [],
        endVideos: config.endVideos || { count: 0, source: '', extensions: [], duration: 0 },
        outroVideo: config.outroVideo || { source: '', extensions: [], duration: 0 },
        audio: config.audio || { source: '', extensions: [], duration: 0 },
        textOverlays: config.textOverlays || []
    };

    const count = safePreset.count;
    try {
        console.log('Creating video with preset:', safePreset.name);

        const [width, height] = safePreset.output.resolution.split('x');

        // Get media files based on preset
        const mediaFiles = [];
        const inputOptions = [];

        // Skip segments if not provided
        const segments = safePreset.segments;
        for (const segment of segments) {
            if (segment.type === 'video') {
                const videoFile = getRandomMedia(segment.source, segment.extensions);
                mediaFiles.push(videoFile);
                inputOptions.push(['-t', segment.duration.toString()]);
            } else if (segment.type === 'image') {
                const imageFile = await validateImage(getRandomMedia(segment.source, segment.extensions));
                mediaFiles.push(imageFile);
                inputOptions.push([]);
            }
        }

        // Add end videos
        const endVideos = Array.from({ length: safePreset.endVideos.count }, () =>
            getRandomMedia(safePreset.endVideos.source, safePreset.endVideos.extensions)
        );

        endVideos.forEach(vid => {
            mediaFiles.push(vid);
            inputOptions.push(['-t', safePreset.endVideos.duration.toString()]);
        });

        // Add outro video
        const outroVideo = getRandomMedia(safePreset.outroVideo.source, safePreset.outroVideo.extensions);
        mediaFiles.push(outroVideo);
        inputOptions.push(['-t', safePreset.outroVideo.duration.toString()]);

        // Verify all media exists
        mediaFiles.forEach((file, i) => {
            if (!fs.existsSync(file)) throw new Error(`Missing media file ${i + 1}: ${file}`);
        });

        // Get and validate audio
        const audioFile = getRandomMedia(safePreset.audio.source, safePreset.audio.extensions);
        const audioDuration = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioFile, (err, metadata) => {
                err ? reject(err) : resolve(metadata.format.duration);
            });
        });

        if (audioDuration < safePreset.audio.duration) {
            throw new Error(`Audio too short (${audioDuration}s < ${safePreset.audio.duration}s): ${audioFile}`);
        }

        const maxStart = Math.max(0, audioDuration - safePreset.audio.duration);
        const startTime = Math.random() * maxStart;

        // Build FFmpeg command
        const command = ffmpeg();

        // Add all inputs
        mediaFiles.forEach((file, i) => {
            command.input(file);
            if (inputOptions[i] && inputOptions[i].length > 0) {
                command.inputOptions(inputOptions[i]);
            }
        });

        // Add audio
        command.input(audioFile).inputOptions([`-ss ${startTime}`, `-t ${safePreset.audio.duration}`]);

        // Build complex filter
        const filters = [];

        // Process video inputs
        mediaFiles.forEach((file, i) => {
            const isImage = safePreset.segments[i] && safePreset.segments[i].type === 'image';
            if (isImage) {
                const segment = safePreset.segments[i];
                filters.push(`[${i}:v]loop=loop=-1:size=1,trim=duration=${segment.duration},` +
                    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
                    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);
            } else {
                filters.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
                    `pad=${width}:${height},setsar=1[v${i}]`);
            }
        });

        // Build concatenation
        const concatInputs = mediaFiles.map((_, i) => `[v${i}]`).join('');
        filters.push(`${concatInputs}concat=n=${mediaFiles.length}:v=1:a=0[ct]`);

        // Add text overlays
        let currentStream = '[ct]';
        safePreset.textOverlays.forEach((overlay, i) => {
            const filter = buildTextFilter(overlay, currentStream);
            const outputStream = i === safePreset.textOverlays.length - 1 ? '[vout]' : `[temp${i}]`;
            filters.push(`${currentStream}${filter}${outputStream}`);
            currentStream = outputStream;
        });

        command.complexFilter(filters)
            .outputOptions([
                '-map [vout]',
                `-map ${mediaFiles.length}:a`,
                `-c:v ${safePreset.output.codec}`,
                `-preset ${safePreset.output.preset}`,
                `-crf ${safePreset.output.crf}`,
                `-r ${safePreset.output.fps}`,
                '-pix_fmt yuv420p',
                `-c:a ${safePreset.output.audioCodec}`,
                `-b:a ${safePreset.output.audioBitrate}`,
                '-shortest'
            ])
            .on('stderr', (stderrLine) => console.log('FFmpeg output:', stderrLine))
            .on('error', (err) => {
                console.error('FFmpeg error details:');
                console.error('Message:', err.message);
                console.error('Stack:', err.stack);
            });

        const outputPath = `editedvideos/output_${Date.now()}.mp4`;
        console.log('Creating video at:', outputPath);

        return new Promise((resolve, reject) => {
            command.save(outputPath)
                .on('end', () => {
                    console.log('Video creation completed:', outputPath);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('Video creation failed:', err);
                    reject(err);
                });
        });

    } catch (error) {
        console.error('Error in createVideoWithPreset:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

async function createTikTokVideo(preset) {
    try {
        console.log('Creating TikTok-style video with preset:', preset.name);
        const [width, height] = preset.output.resolution.split('x').map(Number);

        // 1. Resolve and validate output directory
        const outputDir = path.resolve(__dirname, 'editedtiktok');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 2. Get main video
        const videoSourceDir = path.resolve(__dirname, preset.source.video);
        const mainVideo = getRandomMedia(videoSourceDir, ['.mp4', '.mov']);
        console.log('Main video:', mainVideo);
        if (!fs.existsSync(mainVideo)) {
            throw new Error(`Main video not found: ${mainVideo}`);
        }

        // 3. Process overlay images - ensure they're different
        const imageSourceDir = path.resolve(__dirname, preset.source.images);
        const allImages = fs.readdirSync(imageSourceDir)
            .filter(f => ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase()));

        if (allImages.length < 2) {
            throw new Error('Need at least 2 different images in the overlay directory');
        }

        // Get two unique random images
        const [image1, image2] = getTwoUniqueRandomItems(allImages);
        const imagePath1 = path.join(imageSourceDir, image1);
        const imagePath2 = path.join(imageSourceDir, image2);

        const overlayImages = [
            {
                path: await validateImage(imagePath1),
                startTime: 1.2,
                endTime: 1.3,
                opacity: 0.5,
                x: '(W-w)/2',  // Center horizontally
                y: '(H-h)/2'   // Center vertically
            },
            {
                path: await validateImage(imagePath2),
                startTime: 2.7,
                endTime: 2.9,
                opacity: 0.5,
                x: '(W-w)/2',  // Center horizontally
                y: '(H-h)/2'   // Center vertically
            }
        ];

        // Validate overlay images
        overlayImages.forEach(img => {
            if (!fs.existsSync(img.path)) {
                throw new Error(`Overlay image not found: ${img.path}`);
            }
        });

        // 4. Build FFmpeg command with centered overlays
        const outputPath = path.join(outputDir, `tiktok_${Date.now()}.mp4`);

        // Base filter for main video
        let filterChain = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]; `;

        // Process each overlay image with center positioning
        overlayImages.forEach((img, i) => {
            filterChain += `[${i + 1}:v]scale=${width}:-1:force_original_aspect_ratio=decrease,pad=${width}:ih:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgba,colorchannelmixer=aa=${img.opacity}[ov${i}]; `;
        });

        // Apply centered overlays
        let currentInput = '[bg]';
        overlayImages.forEach((img, i) => {
            filterChain += `${currentInput}[ov${i}]overlay=x=${img.x}:y=${img.y}:enable='between(t,${img.startTime},${img.endTime})'`;
            if (i < overlayImages.length - 1) {
                filterChain += `[tmp${i}]; `;
                currentInput = `[tmp${i}]`;
            } else {
                filterChain += '[vout]';
            }
        });

        console.log('Filter chain:', filterChain);

        const command = ffmpeg()
            .input(mainVideo)
            .videoCodec(preset.output.codec)
            .outputOptions([
                '-filter_complex', filterChain,
                '-map', '[vout]',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-r', preset.output.fps.toString()
            ]);

        // Add overlay images
        overlayImages.forEach(img => command.input(img.path));

        command.output(outputPath);

        return new Promise((resolve, reject) => {
            command
                .on('end', () => resolve(outputPath))
                .on('error', (err) => {
                    console.error('FFmpeg error:', err.message);
                    reject(err);
                })
                .run();
        });
    } catch (error) {
        console.error('Error in createTikTokVideo:', error);
        throw error;
    }
}

// Helper function to get two unique random items from array
function getTwoUniqueRandomItems(arr) {
    if (arr.length < 2) throw new Error('Array must have at least 2 items');
    const firstIndex = Math.floor(Math.random() * arr.length);
    let secondIndex;
    do {
        secondIndex = Math.floor(Math.random() * arr.length);
    } while (secondIndex === firstIndex);
    return [arr[firstIndex], arr[secondIndex]];
}

// Keep the original function for backward compatibility
async function createVideo() {
    // Load default preset and use it
    const VideoPresetManager = require('./presets.cjs');
    const presetManager = new VideoPresetManager();
    const defaultPreset = presetManager.getPreset('VideoEdit 1');

    if (!defaultPreset) {
        throw new Error('Default preset not found');
    }

    return await createVideoWithPreset(defaultPreset);
}

async function processAllTikTokVideos(preset, progressCallback, selectedFiles) {
    try {
        console.log('Processing TikTok videos with preset:', preset.name);
        const [width, height] = preset.output.resolution.split('x').map(Number);

        // 1. Resolve and validate output directory
        const outputDir = path.resolve(__dirname, 'editedtiktok');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 2. Get videos to process
        const videoSourceDir = path.resolve(__dirname, preset.source.video);
        let allVideos;

        if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
            allVideos = selectedFiles;
        } else {
            allVideos = fs.readdirSync(videoSourceDir)
                .filter(f => ['.mp4', '.mov'].includes(path.extname(f).toLowerCase()));
        }

        if (allVideos.length === 0) {
            throw new Error('No videos found to process');
        }


        // 3. Process overlay images setup (same for all videos)
        const imageSourceDir = path.resolve(__dirname, preset.source.images);
        const allImages = fs.readdirSync(imageSourceDir)
            .filter(f => ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase()));

        if (allImages.length < 2) {
            throw new Error('Need at least 2 different images in the overlay directory');
        }

        // 4. Process each video sequentially
        const processedVideos = [];
        const totalVideos = allVideos.length;

        for (const [index, videoFile] of allVideos.entries()) {
            try {
                if (progressCallback) {
                    progressCallback({
                        current: index + 1,
                        total: totalVideos,
                        file: videoFile,
                        status: 'processing'
                    });
                }

                const mainVideo = path.join(videoSourceDir, videoFile);
                console.log('\nProcessing video:', mainVideo);

                // Get two unique random images for this video
                const [image1, image2] = getTwoUniqueRandomItems(allImages);
                const imagePath1 = path.join(imageSourceDir, image1);
                const imagePath2 = path.join(imageSourceDir, image2);

                const overlayImages = [
                    {
                        path: await validateImage(imagePath1),
                        startTime: 1.2,
                        endTime: 1.3,
                        opacity: 0.5,
                        x: '(W-w)/2',
                        y: '(H-h)/2'
                    },
                    {
                        path: await validateImage(imagePath2),
                        startTime: 2.7,
                        endTime: 2.9,
                        opacity: 0.5,
                        x: '(W-w)/2',
                        y: '(H-h)/2'
                    }
                ];

                // Validate overlay images
                for (const img of overlayImages) {
                    if (!fs.existsSync(img.path)) {
                        throw new Error(`Overlay image not found: ${img.path}`);
                    }
                }

                // Build FFmpeg command
                const outputPath = path.join(outputDir, `tiktok_${path.parse(videoFile).name}_${Date.now()}.mp4`);
                let filterChain = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[bg]; `;

                overlayImages.forEach((img, i) => {
                    filterChain += `[${i + 1}:v]scale=${width}:-1:force_original_aspect_ratio=decrease,pad=${width}:ih:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgba,colorchannelmixer=aa=${img.opacity}[ov${i}]; `;
                });

                let currentInput = '[bg]';
                overlayImages.forEach((img, i) => {
                    filterChain += `${currentInput}[ov${i}]overlay=x=${img.x}:y=${img.y}:enable='between(t,${img.startTime},${img.endTime})'`;
                    if (i < overlayImages.length - 1) {
                        filterChain += `[tmp${i}]; `;
                        currentInput = `[tmp${i}]`;
                    } else {
                        filterChain += '[vout]';
                    }
                });

                const command = ffmpeg()
                    .input(mainVideo)
                    .videoCodec(preset.output.codec)
                    .outputOptions([
                        '-filter_complex', filterChain,
                        '-map', '[vout]',
                        '-map', '0:a?',
                        '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart',
                        '-r', preset.output.fps.toString(),
                        '-c:a', preset.output.audioCodec || 'aac',
                        '-b:a', preset.output.audioBitrate || '192k'
                    ]);

                overlayImages.forEach(img => command.input(img.path));

                // Process the video and wait for completion
                await new Promise((resolve, reject) => {
                    command
                        .output(outputPath)
                        .on('end', () => {
                            console.log('Successfully processed:', outputPath);
                            processedVideos.push(outputPath);
                            if (progressCallback) {
                                progressCallback({
                                    current: index + 1,
                                    total: totalVideos,
                                    file: videoFile,
                                    status: 'completed'
                                });
                            }
                            resolve();
                        })
                        .on('error', (err) => {
                            console.error('Error processing video:', mainVideo, err.message);
                            if (progressCallback) {
                                progressCallback({
                                    current: index + 1,
                                    total: totalVideos,
                                    file: videoFile,
                                    status: 'error',
                                    error: err.message
                                });
                            }
                            reject(err);
                        })
                        .run();
                });

            } catch (error) {
                console.error('Error processing video, continuing with next:', error.message);
                if (progressCallback) {
                    progressCallback({
                        current: index + 1,
                        total: totalVideos,
                        file: videoFile,
                        status: 'error',
                        error: error.message
                    });
                }
                // Continue with next video even if one fails
            }
        }

        console.log('\nFinished processing all videos. Total processed:', processedVideos.length);
        return processedVideos;

    } catch (error) {
        console.error('Error in processAllTikTokVideos:', error);
        throw error;
    }
}

module.exports = {
    createVideo,
    createVideoWithPreset,
    createTikTokVideo,
    processAllTikTokVideos
}; 
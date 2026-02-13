const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function scrapeTikTokUser(username, outputDir, progressCallback) {
    const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
    const userOutputDir = path.join(outputDir, cleanUsername);

    if (!fs.existsSync(userOutputDir)) {
        fs.mkdirSync(userOutputDir, { recursive: true });
    }


    const browser = await puppeteer.launch({
        headless: false, // Show browser to debug and solve captchas
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled' // Helps hide that it's a bot
        ],
        ignoreDefaultArgs: ['--enable-automation'], // Further hide bot status
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Hide puppeteer specific properties
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Use a common user agent to avoid basic blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const profileUrl = `https://www.tiktok.com/@${username.startsWith('@') ? username.slice(1) : username}`;
    console.log(`Navigating to ${profileUrl}`);

    if (progressCallback) progressCallback({ status: 'scraping_links', message: `Navigating to ${username}'s profile...` });

    try {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Manual wait for a few seconds to let things settle
        await new Promise(r => setTimeout(r, 3000));

        // Check for stop signal
        if (progressCallback && progressCallback({ status: 'check_stop' }) === true) {
            await browser.close();
            return [];
        }

        // Wait for videos to load or for a specific container
        await page.waitForSelector('a[href*="/video/"]', { timeout: 15000 }).catch(() => {
            console.log("No videos found initial load. If you see a captcha, please solve it in the browser window.");
            if (progressCallback) progressCallback({ status: 'scraping_links', message: `No videos found initially. Check for captcha in the opened browser window!` });
        });


        // Scroll logic to load all videos
        let lastHeight = await page.evaluate('document.body.scrollHeight');
        let sameHeightCount = 0;
        const maxScrolls = 50; // Safety limit
        let scrollCount = 0;

        while (scrollCount < maxScrolls) {
            // Check for stop signal
            if (progressCallback && progressCallback({ status: 'check_stop' }) === true) break;

            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise(r => setTimeout(r, 2000)); // Wait for lazy load

            let newHeight = await page.evaluate('document.body.scrollHeight');
            if (newHeight === lastHeight) {
                sameHeightCount++;
                if (sameHeightCount >= 3) break; // End of page
            } else {
                sameHeightCount = 0;
                lastHeight = newHeight;
            }
            scrollCount++;
            if (progressCallback) progressCallback({ status: 'scraping_links', message: `Scrolling... (${scrollCount})` });
        }

        const videoLinks = await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('a[href*="/video/"]').forEach(link => {
                const href = link.getAttribute('href');
                if (href) {
                    // Extract full URL
                    if (href.startsWith('http')) {
                        links.add(href);
                    } else if (href.startsWith('/')) {
                        links.add(`https://www.tiktok.com${href}`);
                    }
                }
            });
            return Array.from(links);
        });

        console.log(`Found ${videoLinks.length} videos`);
        if (progressCallback) progressCallback({ status: 'links_found', count: videoLinks.length });

        await browser.close();

        const downloadedFiles = [];
        for (let i = 0; i < videoLinks.length; i++) {
            // Check for stop signal
            if (progressCallback && progressCallback({ status: 'check_stop' }) === true) {
                console.log("Stop requested by user. Ending download loop.");
                break;
            }

            const videoUrl = videoLinks[i];
            const videoId = videoUrl.split('/video/')[1]?.split('?')[0] || `video_${i}`;
            const targetPath = path.join(userOutputDir, `${videoId}.mp4`);


            if (fs.existsSync(targetPath)) {
                console.log(`Skipping already downloaded: ${videoId}`);
                downloadedFiles.push(targetPath);
                continue;
            }

            if (progressCallback) {
                progressCallback({
                    status: 'downloading',
                    current: i + 1,
                    total: videoLinks.length,
                    message: `Downloading video ${i + 1}/${videoLinks.length}`
                });
            }

            try {
                // Using tikwm.com API as it's reliable and free
                const response = await axios.get(`https://www.tikwm.com/api/?url=${videoUrl}`);
                const data = response.data;

                if (data.code === 0 && data.data && data.data.play) {
                    const downloadUrl = data.data.play;
                    const videoResponse = await axios({
                        method: 'get',
                        url: downloadUrl,
                        responseType: 'stream'
                    });

                    const writer = fs.createWriteStream(targetPath);
                    videoResponse.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    downloadedFiles.push(targetPath);
                } else {
                    console.error(`Failed to get download link for ${videoUrl}:`, data.msg);
                }
            } catch (err) {
                console.error(`Error downloading ${videoUrl}:`, err.message);
            }

            // Small delay between downloads to be polite
            await new Promise(r => setTimeout(r, 500));
        }

        return downloadedFiles;

    } catch (error) {
        console.error("Scraping failed:", error);
        if (browser) await browser.close();
        throw error;
    }
}

module.exports = { scrapeTikTokUser };

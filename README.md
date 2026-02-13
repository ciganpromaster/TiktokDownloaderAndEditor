# aiPost - TikTok Video Downloader & Editor

This is a complete TikTok scraping and video editing suite. 

## 🚀 Getting Started

1.  **Extract** the files into a new folder.
2.  **Install FFmpeg**: Ensure you have [FFmpeg](https://ffmpeg.org/download.html) installed on your system and added to your PATH.
3.  **Install Dependencies**: Open a terminal in the folder and run:
    ```bash
    npm install
    ```
4.  **Launch the App**: Run the following command:
    ```bash
    node video-editor-ui.cjs
    ```
5.  **Access the UI**: Open your browser to `http://localhost:3000`.

## 📁 Folder Structure

- `video-editor-ui.cjs`: The main server and API handler.
- `tiktok-scraper-utils.cjs`: Handles TikTok user scraping and downloads.
- `editvideo-enhanced.cjs`: The core video processing engine.
- `presets.cjs` & `video-presets.json`: Manage and store your video editing styles.
- `public/`: The web frontend files.

### Assets Folders
Place your own background videos and music in these folders to use with presets:
- `Money Videos`: For background footage.
- `music`: Place your MP3 files here.
- `discordoutro`: Place your outro video clips here.
- `Manualcaja`, `papolshot`, `lucuryvids`: Used for specific image/video layers in presets.

## 🛠 Features
- **TikTok Scraper**: Download videos by username without watermarks.
- **Visual Preview**: Browse downloaded videos with smooth, lazy-loaded thumbnails.
- **Video Editor**: Apply text overlays, image overlays, and combine clips using presets.
- **Lightbox Slider**: Fullscreen preview of videos with selection toggles.

Enjoy!

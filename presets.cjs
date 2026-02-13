const fs = require('fs');
const path = require('path');

class VideoPresetManager {
    constructor() {
        this.presetsFile = 'video-presets.json';
        this.presets = this.loadPresets();
    }

    loadPresets() {
        try {
            if (fs.existsSync(this.presetsFile)) {
                const data = fs.readFileSync(this.presetsFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading presets:', error);
        }
        return {};
    }

    savePresets() {
        try {
            fs.writeFileSync(this.presetsFile, JSON.stringify(this.presets, null, 2));
        } catch (error) {
            console.error('Error saving presets:', error);
        }
    }

    savePreset(name, config) {
        this.presets[name] = {
            ...config,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.savePresets();
        return this.presets[name];
    }

    getPreset(name) {
        return this.presets[name] || null;
    }

    getAllPresets() {
        return this.presets;
    }

    deletePreset(name) {
        if (this.presets[name]) {
            delete this.presets[name];
            this.savePresets();
            return true;
        }
        return false;
    }

    // Create default preset from current video configuration
    createDefaultPreset() {
        const defaultConfig = {
            name: "VideoEdit 1",
            description: "Default video editing configuration",
            segments: [
                {
                    type: "video",
                    source: "Money Videos",
                    duration: 2.3,
                    extensions: ['.mp4', '.mov']
                },
                {
                    type: "image",
                    source: "Manualcaja",
                    duration: 1.3,
                    extensions: ['.jpg', '.jpeg', '.png']
                },
                {
                    type: "image",
                    source: "papolshot",
                    duration: 0.7,
                    extensions: ['.jpg', '.jpeg', '.png']
                },
                {
                    type: "image",
                    source: "papolshot",
                    duration: 0.5,
                    extensions: ['.jpg', '.jpeg', '.png']
                }
            ],
            endVideos: {
                source: "lucuryvids\\Luxury Views",
                count: 9,
                duration: 0.3778,
                extensions: ['.mp4', '.mov']
            },
            outroVideo: {
                source: "discordoutro",
                duration: 1.6,
                extensions: ['.mp4', '.mov']
            },
            audio: {
                source: "music",
                duration: 10.6,
                extensions: ['.mp3', '.wav']
            },
            textOverlays: [
                {
                    text: "Wanna learn how to make a bank",
                    startTime: 0,
                    endTime: 2.3,
                    x: "center",
                    y: 180,
                    fontSize: 70,
                    color: "white",
                    borderColor: "black",
                    borderWidth: 6
                },
                {
                    text: "from ped0s?",
                    startTime: 0,
                    endTime: 2.3,
                    x: "center",
                    y: 240,
                    fontSize: 70,
                    color: "white",
                    borderColor: "black",
                    borderWidth: 6
                },
                {
                    text: "Pretend to be a girl online",
                    startTime: 2.3,
                    endTime: 3.6,
                    x: "center",
                    y: "h-300",
                    fontSize: 70,
                    color: "white",
                    borderColor: "black",
                    borderWidth: 6
                },
                {
                    text: "Rince and Repeat",
                    startTime: 3.6,
                    endTime: 4.8,
                    x: "center",
                    y: "h/2+50",
                    fontSize: 70,
                    color: "white",
                    borderColor: "black",
                    borderWidth: 6,
                    box: true,
                    boxColor: "black@1.0",
                    boxBorderWidth: 10
                },
                {
                    text: "Enjoy Your New LifeStyle",
                    startTime: 4.8,
                    endTime: 8.2,
                    x: "center",
                    y: 240,
                    fontSize: 70,
                    color: "white",
                    borderColor: "black",
                    borderWidth: 6
                }
            ],
            output: {
                resolution: "1080x1920",
                fps: 25,
                codec: "libx264",
                preset: "fast",
                crf: 23,
                audioCodec: "aac",
                audioBitrate: "192k"
            }
        };

        return this.savePreset("VideoEdit 1", defaultConfig);
    }
}

module.exports = VideoPresetManager; 
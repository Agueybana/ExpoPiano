# ExpoPiano

An interactive web-based piano application with advanced features for music creation and learning.

## Features

- 🎹 Realistic piano interface with full keyboard support
- 🎵 High-quality audio samples
- 🎼 MIDI support for external controllers
- 🎨 Customizable themes
- 🎙️ Multiple reverb effects (Hall, Cathedral, Studio, Plate, etc.)
- 📱 Progressive Web App (PWA) support
- 🤖 AI-powered features
- ⏱️ Timeline for recording and playback
- ⚙️ Customizable settings

## Project Structure

```
ExpoPiano/
├── index.html              # Main application entry point
├── styles.css              # Application styles
├── manifest.json           # PWA manifest
├── service-worker.js       # Service worker for offline support
├── assets-manifest.json    # Asset manifest
├── js/                     # JavaScript modules
│   ├── app.js             # Main application logic
│   ├── audio.js           # Audio engine
│   ├── piano.js           # Piano keyboard logic
│   ├── midi.js            # MIDI controller support
│   ├── renderer.js        # Visual rendering
│   ├── timeline.js        # Recording/playback timeline
│   ├── settings.js        # User settings management
│   ├── theme.js           # Theme management
│   ├── ai.js              # AI features
│   ├── physics.worker.js  # Physics calculations worker
│   └── utils.js           # Utility functions
├── samples/               # Piano audio samples (MP3 format)
├── impulses/              # Reverb impulse response files
└── scripts/               # Utility scripts
    └── prepare_piano_assets.py  # Asset preparation script
```

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/Agueybana/ExpoPiano.git
   cd ExpoPiano
   ```

2. Serve the application locally:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Or using Node.js http-server
   npx http-server -p 8000
   ```

3. Open your browser and navigate to `http://localhost:8000`

## Technologies Used

- HTML5 Canvas for rendering
- Web Audio API for sound processing
- Web MIDI API for MIDI controller support
- Service Workers for offline functionality
- Web Workers for performance optimization

## License

This project is open source. Please check the license file for more details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

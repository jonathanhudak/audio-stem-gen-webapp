# Demucs Node.js Web Application

A web application that provides a user interface for Demucs, an open-source music source separation model. This application allows users to upload audio files and separate them into individual stems (vocals, drums, bass, and other).

## Prerequisites

- Node.js (v16 or higher)
- Python 3.8 or higher (for Demucs)
- Demucs installed and available in PATH

### Installing Demucs

Demucs must be installed and available in your system's PATH. You can install it via pip:

```bash
pip install demucs
```

For more installation options or detailed instructions, visit the [official Demucs repository](https://github.com/adefossez/demucs).

## Setup

1. Clone this repository:
```bash
git clone [your-repo-url]
cd demucs-node-app
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The application will be available at `http://localhost:3000` (or your configured port).

## Features

- Upload audio files for stem separation
- Process audio using Demucs to separate into:
  - Vocals
  - Drums
  - Bass
  - Other
- Download individual stems or all stems as a zip file
- Modern web interface with HTMX for dynamic updates

## Tech Stack

- Node.js & Express.js
- TypeScript
- EJS Templates
- HTMX
- Multer for file uploads
- Archiver for zip file creation

## Acknowledgments

This project wouldn't be possible without:

- [Demucs](https://github.com/adefossez/demucs) - The amazing open-source music source separation model by Alexandre Défossez
- Special thanks to Jessica at [AudioShake](https://www.audioshake.ai/) for recommending this excellent open-source model

## License

MIT

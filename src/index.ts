import express, { Request, Response } from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import archiver from 'archiver';
import { EventEmitter } from 'events';

// Create a global event emitter for progress updates
const progressEmitter = new EventEmitter();

const app = express();
const port = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer to store uploaded files in the uploads folder
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Serve a simple HTML form at the root path.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));

app.get('/', (req: Request, res: Response) => {
  res.render('index');
});

// Endpoint to handle file uploads and run Demucs.
// SSE endpoint for progress updates
app.get('/progress-stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial progress
  res.write(`data: ${JSON.stringify(progressState)}\n\n`);

  // Listen for progress updates
  const sendProgress = (progress: ProgressState) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  };

  progressEmitter.on('progress', sendProgress);

  // Clean up when client disconnects
  req.on('close', () => {
    progressEmitter.removeListener('progress', sendProgress);
  });
});

interface ProgressState {
  [key: string]: number;
}

interface AudioUrls {
  [key: string]: string;
}

const progressState: ProgressState = {};
const audioUrls: AudioUrls = {};

app.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  // Initialize progress state for all stems
  const stems = ['drums', 'bass', 'other', 'vocals'];
  stems.forEach(stem => progressState[stem] = 0);
  progressEmitter.emit('progress', progressState);
  if (!req.file) {
    res.status(400).send('No file uploaded.');
    return;
  }

  const file = req.file;
  console.log(`Received file: ${file.originalname}`);

  try {
    // Create a unique temporary directory for this processing job.
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'demucs-'));
    console.log(`Created temporary directory: ${tempDir}`);

    // Move the uploaded file into our temporary directory.
    const inputFilePath = path.join(tempDir, file.originalname);
    await fsp.rename(file.path, inputFilePath);

    // Create an output directory for Demucs results.
    const outputDir = path.join(tempDir, 'output');
    await fsp.mkdir(outputDir);
    console.log(`Created output directory: ${outputDir}`);

    // Prepare the Demucs command.
    // This example assumes that the Demucs CLI is available as "demucs".
    // You can adjust the command or arguments as needed.
    const stems = ['drums', 'bass', 'other', 'vocals'];
    const demucsCmd = 'demucs';
    const demucsArgs = [inputFilePath, '--out', outputDir];
    console.log(`Running command: ${demucsCmd} ${demucsArgs.join(' ')}`);

    const demucsProcess = spawn(demucsCmd, demucsArgs);
    
    // Reset progress state for new processing
    stems.forEach(stem => progressState[stem] = 0);
    progressEmitter.emit('progress', progressState);

    let currentStem = '';

    // Log Demucs output
    demucsProcess.stdout.on('data', (data) => {
      console.log(`demucs stdout: ${data}`);
    });

    demucsProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`Demucs output: ${output}`);
      
      // Parse progress information
      if (output.includes('Processing')) {
        // Update all stems with the same progress since Demucs processes them together
        const match = output.match(/([0-9]+)%/);
        if (match) {
          const progress = parseInt(match[1], 10) / 100;
          stems.forEach(stem => {
            progressState[stem] = progress;
          });
          progressEmitter.emit('progress', progressState);
        }
      }
    });

    // When Demucs finishes processing…
    demucsProcess.on('close', async (code) => {
      console.log(`demucs process exited with code ${code}`);
      if (code !== 0) {
        // Clean up and notify the client on error.
        await fsp.rm(tempDir, { recursive: true, force: true });
        res.status(500).send('Error processing audio file.');
        return;
      }

      // Demucs creates files in outputDir/htdemucs/<basename>/
      const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
      const resultDir = path.join(outputDir, 'htdemucs', baseName);

      // Create public stems directory if it doesn't exist
      const publicStemsDir = path.join(__dirname, 'public', 'stems');
      await fsp.mkdir(publicStemsDir, { recursive: true });
      console.log('Created public stems directory:', publicStemsDir);
      
      // Ensure the public/stems directory is served statically
      app.use('/stems', express.static(publicStemsDir));
      
      console.log('Looking for stem files in:', resultDir);

      // Process each stem file
      for (const stem of stems) {
        const stemFile = path.join(resultDir, `${stem}.wav`);
        try {
          await fsp.access(stemFile);
          console.log('Found stem file:', stemFile);
          
          // Generate a unique filename using timestamp to avoid conflicts
          const timestamp = Date.now();
          const publicStemPath = path.join(publicStemsDir, `${baseName}_${stem}_${timestamp}.wav`);
          
          await fsp.copyFile(stemFile, publicStemPath);
          console.log('Copied to:', publicStemPath);
          
          // Store the URL using the filename only (not the full path)
          const stemFilename = path.basename(publicStemPath);
          audioUrls[stem] = `/stems/${stemFilename}`;
          
          progressState[stem] = 1;
          progressEmitter.emit('progress', progressState);
        } catch (err) {
          console.error(`Error processing stem file ${stemFile}:`, err);
        }
      }

      // Set all progress to 100% and emit final update
      stems.forEach(stem => progressState[stem] = 1);
      progressEmitter.emit('progress', progressState);
      
      // Send success response with audio URLs
      res.json({ 
        success: true, 
        message: 'Processing complete',
        stems: Object.keys(audioUrls).map(stem => ({
          name: stem,
          url: audioUrls[stem]
        }))
      });

      // Clean up after 1 hour
      setTimeout(async () => {
        try {
          await fsp.rm(tempDir, { recursive: true, force: true });
          console.log(`Cleaned up temporary directory: ${tempDir}`);
        } catch (error) {
          console.error(`Error cleaning up temporary directory: ${error}`);
        }
      }, 3600000); // 1 hour in milliseconds
    });
  } catch (error) {
    console.error('Error processing file:', error);
    // If the file is still in the upload folder, remove it.
    if (req.file && req.file.path) {
      try {
        await fsp.unlink(req.file.path);
      } catch (unlinkErr) {
        console.error('Error cleaning up uploaded file:', unlinkErr);
      }
    }
    res.status(500).send('Internal server error.');
  }
});

// Start the server.
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

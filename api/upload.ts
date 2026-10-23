import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function sendViaBrevoApi(params: {
  files: Array<{ filename: string; mimeType: string; buffer: Buffer; sha256: string }>;
  note: string;
}): Promise<void> {
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  const targetEmail = (process.env.TARGET_EMAIL || '').trim();
  const senderEmail = (process.env.SENDER_EMAIL || '').trim();

  if (!apiKey || !targetEmail || !senderEmail) {
    throw new Error(
      'Server-Konfiguration unvollständig: BREVO_API_KEY, TARGET_EMAIL und SENDER_EMAIL müssen gesetzt sein.'
    );
  }

  const primaryFile = params.files[0];
  const createdAt = new Date().toISOString();
  const subject =
    params.files.length === 1
      ? `[Datei-Upload] ${primaryFile.filename} (${formatBytes(primaryFile.buffer.length)})`
      : `[Datei-Upload] ${params.files.length} Dateien empfangen`;

  const fileDetailsText = params.files
    .map(
      (f, idx) =>
        `${idx + 1}. ${f.filename} — ${formatBytes(f.buffer.length)} (${f.mimeType})\n   SHA-256: ${f.sha256}`
    )
    .join('\n\n');

  const textContent = [
    `Neue Datei(en) über HTTP POST empfangen.`,
    ``,
    fileDetailsText,
    ``,
    `Zeitpunkt: ${createdAt}`,
    params.note ? `Notiz: ${params.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const attachment = params.files.map((f) => ({
    name: f.filename,
    content: f.buffer.toString('base64'),
  }));

  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: 'PostDrop',
        email: senderEmail,
      },
      to: [
        {
          email: targetEmail,
        },
      ],
      subject,
      textContent,
      attachment,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Brevo API Fehler (HTTP ${response.status}): ${errText}`);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
  },
});

export const apiApp = express();

apiApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Filename, X-Note'
  );
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

apiApp.use(express.json({ limit: '30mb' }));
apiApp.use(express.urlencoded({ extended: true, limit: '30mb' }));

apiApp.use(
  express.raw({
    type: (req) => {
      const ct = req.headers['content-type'] || '';
      return (
        !ct.includes('multipart/form-data') &&
        !ct.includes('application/json') &&
        !ct.includes('application/x-www-form-urlencoded')
      );
    },
    limit: '25mb',
  })
);

export const handleFileUploadPost = async (req: Request, res: Response) => {
  try {
    const extractedFiles: Array<{
      filename: string;
      mimeType: string;
      buffer: Buffer;
      sha256: string;
    }> = [];

    const multerFiles = req.files as Express.Multer.File[] | undefined;
    if (multerFiles && Array.isArray(multerFiles) && multerFiles.length > 0) {
      for (const f of multerFiles) {
        const buf = f.buffer;
        extractedFiles.push({
          filename: f.originalname || 'upload.bin',
          mimeType: f.mimetype || 'application/octet-stream',
          buffer: buf,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      const rawFilename =
        (req.headers['x-filename'] as string) ||
        (req.query.filename as string) ||
        `upload-${Date.now()}.bin`;
      const rawMime = (req.headers['content-type'] as string) || 'application/octet-stream';
      const buf = req.body;
      extractedFiles.push({
        filename: path.basename(rawFilename),
        mimeType: rawMime,
        buffer: buf,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    } else if (req.body && typeof req.body === 'object' && req.body.content) {
      const filename = path.basename(
        String(req.body.filename || req.query.filename || `upload-${Date.now()}.txt`)
      );
      const encoding = req.body.encoding === 'base64' ? 'base64' : 'utf-8';
      const buf = Buffer.from(String(req.body.content), encoding);
      extractedFiles.push({
        filename,
        mimeType: String(req.body.mimeType || 'text/plain'),
        buffer: buf,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }

    if (extractedFiles.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Keine Datei im HTTP POST Request gefunden.',
      });
      return;
    }

    const customNote = String(
      (req.body && typeof req.body === 'object' && (req.body.note || req.body.message)) ||
        (req.query.note as string) ||
        (req.headers['x-note'] as string) ||
        ''
    ).trim();

    await sendViaBrevoApi({
      files: extractedFiles,
      note: customNote,
    });

    const transferId = 'tx_' + crypto.randomBytes(6).toString('hex');
    res.status(200).json({
      ok: true,
      message: 'Datei erfolgreich übermittelt.',
      transfer: {
        id: transferId,
        filename: extractedFiles[0].filename,
        sizeBytes: extractedFiles[0].buffer.length,
      },
    });
  } catch (err: unknown) {
    console.error('Upload/Brevo error:', err);
    res.status(500).json({
      ok: false,
      error: 'Übermittlung fehlgeschlagen.',
    });
  }
};

apiApp.post('/api/upload', upload.any(), handleFileUploadPost);
apiApp.post('/api/send', upload.any(), handleFileUploadPost);
apiApp.post('/', upload.any(), handleFileUploadPost);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default apiApp;

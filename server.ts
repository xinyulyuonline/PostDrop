import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import nodemailer, { SendMailOptions } from 'nodemailer';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import dotenv from 'dotenv';

dotenv.config();

let cachedEtherealAccount: { user: string; pass: string } | null = null;

async function getEtherealAccount() {
  if (cachedEtherealAccount) return cachedEtherealAccount;
  const testAccount = await nodemailer.createTestAccount();
  cachedEtherealAccount = {
    user: testAccount.user,
    pass: testAccount.pass,
  };
  return cachedEtherealAccount;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function tryDirectMxSend(
  recipient: string,
  fromAddress: string,
  mailOptions: SendMailOptions
): Promise<boolean> {
  try {
    const domain = recipient.split('@')[1];
    if (!domain) return false;
    const mxRecords = await dns.promises.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) return false;
    mxRecords.sort((a, b) => a.priority - b.priority);
    const mxHost = mxRecords[0].exchange;

    const directTransport = nodemailer.createTransport({
      host: mxHost,
      port: 25,
      secure: false,
      connectionTimeout: 3500,
      greetingTimeout: 3500,
      socketTimeout: 5000,
      tls: { rejectUnauthorized: false },
    });

    await directTransport.sendMail({
      ...mailOptions,
      from: fromAddress,
    });
    return true;
  } catch {
    return false;
  }
}

async function sendFileEmailFromBuffer(
  file: { filename: string; mimeType: string; buffer: Buffer; sha256: string; note: string },
  recipientEmail: string
): Promise<boolean> {
  const recipient = recipientEmail.trim();
  if (!recipient || !isValidEmail(recipient)) {
    return false;
  }

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@postdrop.local';
  const subject = `[Datei-Upload] ${file.filename} (${formatBytes(file.buffer.length)})`;
  const createdAt = new Date().toISOString();

  const textBody = [
    `Neue Datei über HTTP POST empfangen.`,
    ``,
    `Dateiname: ${file.filename}`,
    `Größe: ${formatBytes(file.buffer.length)} (${file.mimeType})`,
    `SHA-256: ${file.sha256}`,
    `Zeitpunkt: ${createdAt}`,
    file.note ? `Notiz: ${file.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const mailOptions: SendMailOptions = {
    from: fromAddress,
    to: recipient,
    subject,
    text: textBody,
    attachments: [
      {
        filename: file.filename,
        content: file.buffer,
        contentType: file.mimeType || 'application/octet-stream',
      },
    ],
  };

  // 1. Custom SMTP via Secrets / Environment Variables
  if (process.env.SMTP_HOST && process.env.SMTP_HOST.trim() !== '') {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER.trim(),
            pass: process.env.SMTP_PASS || '',
          }
        : undefined,
    });
    await transporter.sendMail(mailOptions);
    return true;
  }

  // 2. Direct MX Delivery
  const sentMx = await tryDirectMxSend(recipient, fromAddress, mailOptions);
  if (sentMx) {
    return true;
  }

  // 3. Fallback SMTP Relay
  const ethereal = await getEtherealAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: ethereal.user,
      pass: ethereal.pass,
    },
  });
  await transporter.sendMail(mailOptions);
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
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

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  app.use(
    ['/api/upload', '/api/send'],
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

  const handleFileUploadPost = async (req: Request, res: Response) => {
    try {
      const extractedFiles: Array<{
        originalname: string;
        mimetype: string;
        buffer: Buffer;
      }> = [];

      const multerFiles = req.files as Express.Multer.File[] | undefined;
      if (multerFiles && Array.isArray(multerFiles) && multerFiles.length > 0) {
        for (const f of multerFiles) {
          extractedFiles.push({
            originalname: f.originalname || 'upload.bin',
            mimetype: f.mimetype || 'application/octet-stream',
            buffer: f.buffer,
          });
        }
      } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        const rawFilename =
          (req.headers['x-filename'] as string) ||
          (req.query.filename as string) ||
          `upload-${Date.now()}.bin`;
        const rawMime = (req.headers['content-type'] as string) || 'application/octet-stream';
        extractedFiles.push({
          originalname: path.basename(rawFilename),
          mimetype: rawMime,
          buffer: req.body,
        });
      } else if (req.body && typeof req.body === 'object' && req.body.content) {
        const filename = path.basename(
          String(req.body.filename || req.query.filename || `upload-${Date.now()}.txt`)
        );
        const encoding = req.body.encoding === 'base64' ? 'base64' : 'utf-8';
        const buffer = Buffer.from(String(req.body.content), encoding);
        extractedFiles.push({
          originalname: filename,
          mimetype: String(req.body.mimeType || 'text/plain'),
          buffer,
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

      const recipientEmail = (process.env.TARGET_EMAIL || '').trim();
      const results: Array<{ id: string; filename: string; sizeBytes: number }> = [];

      for (const fileItem of extractedFiles) {
        const id = 'tx_' + crypto.randomBytes(6).toString('hex');
        const sha256 = crypto.createHash('sha256').update(fileItem.buffer).digest('hex');

        await sendFileEmailFromBuffer(
          {
            filename: fileItem.originalname,
            mimeType: fileItem.mimetype,
            buffer: fileItem.buffer,
            sha256,
            note: customNote,
          },
          recipientEmail
        );

        results.push({
          id,
          filename: fileItem.originalname,
          sizeBytes: fileItem.buffer.length,
        });
      }

      res.status(200).json({
        ok: true,
        message: 'Datei erfolgreich übermittelt.',
        transfer: results[0],
      });
    } catch {
      res.status(500).json({
        ok: false,
        error: 'Übermittlung fehlgeschlagen.',
      });
    }
  };

  app.post('/api/upload', upload.any(), handleFileUploadPost);
  app.post('/api/send', upload.any(), handleFileUploadPost);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

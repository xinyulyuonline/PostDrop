import React, { useState, useRef } from 'react';
import { Upload, Check, Copy, CheckCircle2, AlertCircle, FileText } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [note, setNote] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
    transferId?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const endpointUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/upload` : '/api/upload';

  const curlCommand = `curl -X POST "${endpointUrl}" -F "file=@datei.pdf"`;

  const handleCopy = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setStatusMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (note.trim()) {
        formData.append('note', note.trim());
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setStatusMessage({
          type: 'success',
          text: `Datei "${selectedFile.name}" wurde erfolgreich übermittelt.`,
          transferId: data.transfer?.id,
        });
        setSelectedFile(null);
        setNote('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'Übermittlung fehlgeschlagen.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Verbindungsfehler beim Senden der Datei.',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Minimal 3-Zone Top Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          PostDrop
        </a>

        <nav className="hidden sm:flex items-center gap-6 text-xs font-medium text-slate-500">
          <a href="#upload" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Datei senden
          </a>
          <a href="#api" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            HTTP POST API
          </a>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Datei auswählen
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        id="top"
        className="flex-1 max-w-[960px] w-full mx-auto px-6 py-12 flex flex-col justify-center space-y-8"
      >
        <div className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"
            style={{ textWrap: 'balance' }}
          >
            Datei-Übermittlung
          </h1>
          <p className="text-sm text-slate-600">
            Lade eine Datei direkt hier hoch oder sende sie automatisiert per{' '}
            <code className="font-mono text-xs text-slate-800">HTTP POST</code> an den
            API-Endpunkt.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Direct Upload Card */}
          <section
            id="upload"
            className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-sm font-semibold text-slate-900">01. Datei direkt senden</div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    setSelectedFile(e.dataTransfer.files[0]);
                  }
                }}
                className="border border-dashed border-slate-300 hover:border-slate-500 rounded-lg p-8 text-center cursor-pointer transition-colors bg-slate-50/50"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                />
                {selectedFile ? (
                  <div className="space-y-1">
                    <FileText className="w-6 h-6 text-slate-700 mx-auto mb-1" />
                    <div className="text-sm font-semibold text-slate-900 truncate max-w-sm mx-auto">
                      {selectedFile.name}
                    </div>
                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      {formatBytes(selectedFile.size)} · Klicken zum Ändern
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                    <div className="text-sm font-medium text-slate-800">
                      Datei hierher ziehen oder klicken
                    </div>
                    <div className="text-xs text-slate-500">Maximale Dateigröße: 25 MB</div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="note-input" className="block text-xs font-medium text-slate-600">
                  Optionale Notiz
                </label>
                <input
                  id="note-input"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Kurze Referenz oder Nachricht (optional)"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <button
                type="submit"
                disabled={!selectedFile || uploading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploading ? 'Wird gesendet…' : 'Datei absenden'}</span>
              </button>
            </form>

            {statusMessage && (
              <div
                role="status"
                className={`mt-4 px-3.5 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-red-50/70 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  {statusMessage.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <span>{statusMessage.text}</span>
                </div>
                {statusMessage.transferId && (
                  <span className="font-mono text-[11px] text-emerald-700 tabular-nums shrink-0">
                    ID: {statusMessage.transferId}
                  </span>
                )}
              </div>
            )}
          </section>

          {/* Minimal HTTP POST API Reference Card */}
          <section
            id="api"
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between space-y-5"
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">02. Per HTTP POST senden</div>
                <p className="text-xs text-slate-500">
                  Endpunkt für automatisierte Uploads per Skript oder Terminal:
                </p>
              </div>

              <div className="bg-[#0F172A] text-slate-100 rounded-lg p-3.5 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[11px] pb-2 border-b border-slate-800">
                  <span>POST /api/upload</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-sans font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Kopiert</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopieren</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap break-all leading-relaxed">{curlCommand}</pre>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-1.5 text-xs text-slate-500">
              <div>
                Feldname: <code className="font-mono text-slate-800">file</code> (Multipart) oder
                Raw-Binary mit Header <code className="font-mono text-slate-800">X-Filename</code>
              </div>
              <div>
                Optionales Textfeld: <code className="font-mono text-slate-800">note</code>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4">
        <div className="max-w-[960px] mx-auto flex items-center justify-between text-xs text-slate-400">
          <span>PostDrop</span>
          <span className="font-mono">POST /api/upload</span>
        </div>
      </footer>
    </div>
  );
}

export default App;

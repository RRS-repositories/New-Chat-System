import { useEffect, useState } from 'react';
import { FileText, Download, Play } from 'lucide-react';
import type { ChatFile } from '../../types/index.ts';
import { useChat } from '../../context/chatContext.ts';
import { fileKind, formatBytes, isImage, isVideo } from '../../utils/files.ts';
import { Lightbox } from './Lightbox.tsx';

/** Hand a fetched file to the browser's download UI, then release the memory. */
async function saveToDevice(fetchBlob: (p: string) => Promise<string>, path: string, filename: string) {
  const url = await fetchBlob(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function FileAttachment({ file }: { file: ChatFile }) {
  const { actions } = useChat();
  const [thumb, setThumb] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dl = `/api/chat/files/${file.id}/download`;
  useEffect(() => {
    if (isImage(file.mimeType) && file.hasThumb)
      actions
        .fetchBlob(`/api/chat/files/${file.id}/thumb`)
        .then(setThumb)
        .catch(() => setThumb(null));
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function download() {
    setBusy(true);
    setError(null);
    try {
      await saveToDevice(actions.fetchBlob, dl, file.filename);
    } catch (e: any) {
      setError(e?.message || 'Could not download');
    } finally {
      setBusy(false);
    }
  }
  async function openFull() {
    setOpen(true);
    if (!full) setFull(await actions.fetchBlob(dl).catch(() => null));
  }
  function closeFull() {
    setOpen(false);
    if (full) {
      URL.revokeObjectURL(full);
      setFull(null);
    }
  }
  if (isImage(file.mimeType)) {
    return (
      <>
        <button className="file-image" onClick={() => void openFull()} aria-label={`Open ${file.filename}`}>
          {thumb ? (
            <img src={thumb} alt={file.filename} width={200} />
          ) : (
            <span className="fcard file-card">
              <span className="fic">
                <FileText size={17} />
              </span>
              <span className="fmeta">
                <b className="file-name">{file.filename}</b>
              </span>
            </span>
          )}
        </button>
        {open && <Lightbox src={full} alt={file.filename} onClose={closeFull} />}
      </>
    );
  }
  if (isVideo(file.mimeType)) return <VideoAttachment file={file} src={dl} />;
  return (
    <button
      className="fcard file-card"
      disabled={busy}
      aria-label={`Download ${file.filename}`}
      title="Download"
      onClick={() => void download()}
    >
      <span className="fic">{busy ? <Download size={17} /> : <FileText size={17} />}</span>
      <span className="fmeta file-meta">
        <b className="file-name">{file.filename}</b>
        <span>
          {formatBytes(file.sizeBytes)} · {fileKind(file.mimeType, file.filename)}
          {error ? ` · ${error}` : ''}
        </span>
      </span>
    </button>
  );
}

/** Nothing is fetched until the person taps play — a 20 MB video must not pull itself onto a phone unasked. */
function VideoAttachment({ file, src }: { file: ChatFile; src: string }) {
  const { actions } = useChat();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (url) return <video className="file-video" src={url} controls autoPlay preload="metadata" />;
  return (
    <button
      className="fcard file-card"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        actions
          .fetchBlob(src)
          .then(setUrl)
          .catch(() => setBusy(false));
      }}
    >
      <span className="fic">
        <Play size={17} />
      </span>
      <span className="fmeta file-meta">
        <b className="file-name">{file.filename}</b>
        <span>{formatBytes(file.sizeBytes)} · tap to play</span>
      </span>
    </button>
  );
}

export function FileList({ files }: { files: ChatFile[] }) {
  if (!files.length) return null;
  return (
    <div className="file-list">
      {files.map((f) => (
        <FileAttachment key={f.id} file={f} />
      ))}
    </div>
  );
}

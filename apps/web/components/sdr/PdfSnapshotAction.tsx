'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, LoaderCircle } from 'lucide-react';

import './pdf-snapshot-action.css';

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function PdfSnapshotAction() {
  const [exportUrl, setExportUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = window.fetch;
    const wrapped: typeof window.fetch = async (...args) => {
      const url = new URL(requestUrl(args[0]), window.location.origin);
      const match = url.pathname.match(/^\/api\/dashboard\/([^/]+)\/reports$/);
      if (url.origin === window.location.origin && match && url.searchParams.get('scope') !== 'operating') {
        const query = new URLSearchParams(url.searchParams);
        query.delete('scope');
        query.set('format', 'pdf');
        setExportUrl(`/api/dashboard/${encodeURIComponent(decodeURIComponent(match[1]))}/export?${query.toString()}`);
      }
      return previous(...args);
    };
    window.fetch = wrapped;
    return () => {
      if (window.fetch === wrapped) window.fetch = previous;
    };
  }, []);

  async function download() {
    if (!exportUrl || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(exportUrl, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Unable to generate the PDF snapshot.');
      }
      const disposition = response.headers.get('content-disposition') || '';
      const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.replace(/[^a-z0-9._-]+/gi, '-') || 'revenue-report.pdf';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to generate the PDF snapshot.');
    } finally {
      setBusy(false);
    }
  }

  if (!exportUrl) return null;
  return (
    <aside className="pdf-snapshot-action" aria-live="polite">
      <span><FileText size={17} /><b>Executive snapshot</b></span>
      <button type="button" onClick={() => void download()} disabled={busy}>
        {busy ? <LoaderCircle className="pdf-snapshot-spin" size={15} /> : <Download size={15} />}
        {busy ? 'Generating' : 'Download PDF'}
      </button>
      {error ? <small>{error}</small> : null}
    </aside>
  );
}

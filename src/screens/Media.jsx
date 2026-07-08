import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

// The site repo is public and already referenced this way in api/preview.js.
// jsDelivr serves the staging branch's assets over its CDN.
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/projecthood-site/projecthood@staging/';

// Roles allowed to upload. Viewers get a read-only library.
const UPLOAD_ROLES = new Set(['owner', 'editor', 'author']);

// Attach the caller's Supabase access token (mirrors Team/Dashboard/PageEditor).
async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Read a File as base64 (data URL). The endpoint strips the data-URL prefix.
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function MediaCard({ item, onCopy }) {
  const [failed, setFailed] = useState(false);
  const src = CDN_BASE + item.path;
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          aspectRatio: '4 / 3', background: '#f2f1ef', display: 'flex',
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}
      >
        {failed ? (
          <span className="ms" style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)', textAlign: 'center', padding: 12 }}>
            Preview loading…<br />(CDN may lag a minute)
          </span>
        ) : (
          <img
            src={src}
            alt={item.name}
            loading="lazy"
            onError={() => setFailed(true)}
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              // Echo the brand rule: high-contrast black & white.
              filter: 'grayscale(1) contrast(1.08)',
            }}
          />
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          className="ms"
          title={item.name}
          style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {item.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="ms" style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--faint)' }}>{fmtSize(item.size)}</span>
          <button
            className="ms"
            type="button"
            onClick={() => onCopy(item.path)}
            style={{
              fontWeight: 700, fontSize: 10.5, letterSpacing: '.02em', color: 'var(--ink)',
              background: '#fff', border: '1px solid var(--line)', borderRadius: 999,
              padding: '5px 11px', cursor: 'pointer',
            }}
          >
            Copy path
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Media() {
  const toast = useToast();
  const { profile } = useAuth();
  const canUpload = UPLOAD_ROLES.has(profile?.role);

  const [state, setState] = useState({ loading: true, error: null });
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setState({ loading: true, error: null });
    try {
      const res = await fetch('/api/media-list', { headers: await authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Something went wrong (status ${res.status}).`);
      setItems(Array.isArray(body) ? body : []);
      setState({ loading: false, error: null });
    } catch (err) {
      setState({ loading: false, error: err.message || 'Could not load the media library.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    // Reset the input so the same file can be re-picked later.
    if (fileRef.current) fileRef.current.value = '';
    if (!file || uploading) return;

    setUploading(true);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch('/api/upload-media', {
        method: 'POST',
        headers,
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `Upload failed (status ${res.status}).`);
      }
      toast('Uploaded to staging — it goes live when you Publish.');
      await load();
    } catch (err) {
      toast(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function copyPath(path) {
    try {
      await navigator.clipboard.writeText(path);
      toast('Copied — reference it in the Page Editor.');
    } catch {
      toast(`Path: ${path}`);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Helper line */}
      <p className="note" style={{ margin: '0 0 20px', lineHeight: 1.6, maxWidth: '70ch' }}>
        Upload photos for the website. They're saved to staging and go live when you Publish.
        Keep photos high-contrast black &amp; white per the brand.
      </p>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span className="label" style={{ margin: 0 }}>Media library</span>
        <button
          className="ms"
          type="button"
          onClick={load}
          disabled={state.loading}
          style={{
            marginLeft: 'auto', fontWeight: 700, fontSize: 11, letterSpacing: '.02em',
            border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)',
            borderRadius: 999, padding: '6px 13px', cursor: state.loading ? 'not-allowed' : 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Hidden file input, driven by the dropzone button. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onFilePicked}
        style={{ display: 'none' }}
      />

      {state.error ? (
        <div className="card" style={{ padding: 24 }}>
          <div className="ms" style={{ color: 'var(--red-ink)', fontWeight: 600, fontSize: 13 }}>
            Couldn't load the media library: {state.error}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={load}>Try again</button>
        </div>
      ) : state.loading ? (
        <div className="card" style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <span className="spinner" /> <span className="note">Loading media…</span>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          {/* First cell: upload dropzone (author+/editor/owner only). */}
          {canUpload && (
            <button
              type="button"
              onClick={() => !uploading && fileRef.current && fileRef.current.click()}
              disabled={uploading}
              className="card"
              style={{
                aspectRatio: '4 / 3', minHeight: 150, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center',
                border: '1.5px dashed var(--line)', background: '#fafaf8',
                cursor: uploading ? 'not-allowed' : 'pointer', padding: 16,
              }}
            >
              {uploading ? (
                <>
                  <span className="spinner" />
                  <span className="ms" style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)' }}>Uploading…</span>
                </>
              ) : (
                <>
                  <span className="ak" style={{ fontSize: 30, lineHeight: 1, color: 'var(--green)' }}>+</span>
                  <span className="ms" style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--ink)' }}>Upload photo</span>
                  <span className="ms" style={{ fontWeight: 500, fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.4 }}>
                    PNG, JPG, WEBP, GIF · up to 5 MB
                  </span>
                </>
              )}
            </button>
          )}

          {items.map((it) => (
            <MediaCard key={it.path} item={it} onCopy={copyPath} />
          ))}

          {/* Empty state (no images, and either can't upload or alongside the dropzone). */}
          {items.length === 0 && !canUpload && (
            <div className="card" style={{ padding: '32px 24px', textAlign: 'center', gridColumn: '1 / -1' }}>
              <div className="ak" style={{ fontSize: 30, color: 'var(--line)', marginBottom: 8 }}>No photos yet</div>
              <p className="note" style={{ maxWidth: '40ch', margin: '0 auto', lineHeight: 1.6 }}>
                Photos uploaded by an editor will appear here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* CDN lag note */}
      {!state.loading && !state.error && (
        <p className="note" style={{ marginTop: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--faint)' }}>
          Freshly uploaded photos may take a minute to appear via the CDN. Use Refresh if a thumbnail
          hasn't loaded yet.
        </p>
      )}
    </div>
  );
}

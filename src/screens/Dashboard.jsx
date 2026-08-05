import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { relativeTime } from '../lib/format';
import Modal from '../components/Modal';

// Roles that may publish to the live site (UI gate; server enforces too).
const PUBLISH_ROLES = new Set(['owner', 'editor']);

// Attach the caller's Supabase access token, mirroring PageEditor's pattern.
async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Dashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const canPublish = PUBLISH_ROLES.has(profile?.role);

  const [pubStatus, setPubStatus] = useState({ loading: true, error: null, data: null });
  const [showPublish, setShowPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preflight, setPreflight] = useState({ loading: false, error: null, data: null });

  const loadPublishStatus = useCallback(async () => {
    setPubStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/publish?action=status', { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Status ${res.status}`);
      setPubStatus({ loading: false, error: null, data });
    } catch (err) {
      setPubStatus({ loading: false, error: err.message, data: null });
    }
  }, []);

  useEffect(() => {
    loadPublishStatus();
  }, [loadPublishStatus]);

  // Pre-publish checks. Advisory only: if this fails to run, publishing is
  // still allowed — we never want a broken check to lock staff out of shipping.
  const runPreflight = useCallback(async () => {
    setPreflight({ loading: true, error: null, data: null });
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/preflight', { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Status ${res.status}`);
      setPreflight({ loading: false, error: null, data });
    } catch (err) {
      setPreflight({ loading: false, error: err.message, data: null });
    }
  }, []);

  useEffect(() => {
    if (showPublish) runPreflight();
  }, [showPublish, runPreflight]);

  async function confirmPublish() {
    setPublishing(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/publish', { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || `Status ${res.status}`);
      setShowPublish(false);
      toast(body.nothing ? 'Nothing to publish — site is up to date.' : 'Published to projecthood.org · just now');
      loadPublishStatus();
    } catch (err) {
      toast(`Publish failed: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  const ahead = pubStatus.data?.ahead_by ?? 0;
  const changes = pubStatus.data?.changes ?? [];
  // Prefer the count of meaningful edits; fall back to the raw commit count if
  // parsing yielded nothing (e.g. only build/merge commits are pending).
  const displayCount = pubStatus.data?.change_count || ahead;
  const hasPending = ahead > 0;
  const errorCount = preflight.data?.summary?.error ?? 0;
  const warningCount = preflight.data?.summary?.warning ?? 0;
  const blocking = errorCount > 0;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* CTA — open the page editor */}
        <div
          style={{
            background: 'var(--green)', color: '#fff', borderRadius: 14,
            boxShadow: '6px 6px 0 var(--ink)', padding: 26,
          }}
        >
          <div
            className="ms"
            style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--yellow)' }}
          >
            Edit the website{profile?.full_name ? ` · ${profile.full_name.split(' ')[0]}` : ''}
          </div>
          <h2 className="ak" style={{ fontSize: 38, lineHeight: '.88', margin: '8px 0 10px', color: '#fff', maxWidth: '16ch' }}>
            Change any page in plain English
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0, maxWidth: '52ch', color: 'rgba(255,255,255,.92)' }}>
            Open the page editor, tell Claude what to change, and review it before anything goes live.
          </p>
          <button
            className="btn btn-accent cta-btn"
            onClick={() => navigate('/pages')}
            style={{ marginTop: 18 }}
          >
            Open the page editor →
          </button>
        </div>

        {/* Site status */}
        <div className="card" style={{ padding: 20 }}>
          <div className="ak" style={{ fontSize: 20, color: 'var(--ink)', marginBottom: 14 }}>Site status</div>

          {pubStatus.loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span className="spinner" />
              <span className="note">Checking staging vs. live…</span>
            </div>
          ) : pubStatus.error ? (
            <div
              className="ms"
              style={{ background: '#f7ded9', color: 'var(--red-ink)', borderRadius: 9, padding: '10px 12px', fontWeight: 600, fontSize: 12 }}
            >
              Couldn't reach publish service. {pubStatus.error}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ width: 11, height: 11, background: 'var(--green)', borderRadius: 999, flex: 'none' }} />
                <span className="ms" style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>Published &amp; live</span>
              </div>
              <div
                className="ms"
                style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, borderTop: '1px solid var(--line)', paddingTop: 12 }}
              >
                {pubStatus.data?.last_commit_date
                  ? <>Latest change on staging <strong style={{ color: 'var(--ink)' }}>{relativeTime(pubStatus.data.last_commit_date)}</strong>.</>
                  : 'No recent staging activity.'}
              </div>
              {hasPending ? (
                <div
                  className="ms"
                  style={{ marginTop: 12, background: 'var(--amber-t)', border: '1px solid #e7d98f', borderRadius: 9, padding: '10px 12px', fontWeight: 600, fontSize: 12, color: 'var(--amber-d)' }}
                >
                  {displayCount} unpublished change{displayCount === 1 ? '' : 's'} waiting
                </div>
              ) : (
                <div
                  className="ms"
                  style={{ marginTop: 12, background: 'var(--green-t)', borderRadius: 9, padding: '10px 12px', fontWeight: 700, fontSize: 12, color: 'var(--green-d)' }}
                >
                  ✓ All changes published
                </div>
              )}

              {canPublish ? (
                <button
                  className={'btn ' + (hasPending ? 'btn-primary' : 'btn-disabled')}
                  disabled={!hasPending}
                  onClick={() => setShowPublish(true)}
                  style={{ width: '100%', marginTop: 12 }}
                >
                  {hasPending ? 'Review & publish' : 'Nothing to publish'}
                </button>
              ) : (
                <div className="note" style={{ marginTop: 12, lineHeight: 1.5 }}>
                  An editor publishes changes.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showPublish && (
        <Modal title="Publish to the live site?" onClose={() => (publishing ? null : setShowPublish(false))}>
          <div style={{ padding: '20px 22px' }}>
            <div className="label" style={{ marginBottom: 10 }}>
              {displayCount} change{displayCount === 1 ? '' : 's'} will go live
            </div>
            {changes.length > 0 ? (
              <ul
                className="scroll"
                style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, maxHeight: 280, overflowY: 'auto' }}
              >
                {changes.slice(0, 30).map((c, i) => {
                  const shown = Math.min(changes.length, 30);
                  return (
                    <li
                      key={i}
                      style={{
                        display: 'flex', gap: 9, alignItems: 'baseline',
                        padding: '8px 0', borderBottom: i < shown - 1 ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      <span style={{ color: 'var(--green-d)', fontWeight: 800, flex: 'none', fontSize: 12 }}>✓</span>
                      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--body)' }}>
                        {c.text}
                        {c.page && (
                          <span
                            className="ms"
                            style={{ marginLeft: 7, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}
                          >
                            {c.page}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
                {changes.length > 30 && (
                  <li style={{ padding: '8px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                    + {changes.length - 30} more…
                  </li>
                )}
              </ul>
            ) : pubStatus.data?.last_commit_message ? (
              <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--body)', margin: '0 0 16px' }}>
                Latest: “{pubStatus.data.last_commit_message}”
              </p>
            ) : null}
            {/* Pre-publish checks */}
            <div style={{ marginBottom: 14 }}>
              {preflight.loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 0' }}>
                  <span className="spinner" />
                  <span className="note">Checking your changes…</span>
                </div>
              ) : preflight.error ? (
                <div className="ms" style={{ background: 'var(--field)', borderRadius: 9, padding: '10px 12px', fontWeight: 600, fontSize: 12, color: 'var(--muted)' }}>
                  Couldn't run the pre-publish checks ({preflight.error}). You can still publish.
                </div>
              ) : preflight.data ? (
                errorCount === 0 && warningCount === 0 ? (
                  <div className="ms" style={{ background: 'var(--green-t)', borderRadius: 9, padding: '10px 12px', fontWeight: 700, fontSize: 12, color: 'var(--green-d)' }}>
                    ✓ Checks passed{preflight.data.checked ? ` · ${preflight.data.checked} page${preflight.data.checked === 1 ? '' : 's'} reviewed` : ''}
                  </div>
                ) : (
                  <div>
                    <div
                      className="ms"
                      style={{
                        borderRadius: '9px 9px 0 0', padding: '9px 12px', fontWeight: 800, fontSize: 11,
                        letterSpacing: '.04em', textTransform: 'uppercase',
                        background: errorCount > 0 ? '#f7ded9' : 'var(--amber-t)',
                        color: errorCount > 0 ? 'var(--red-ink)' : 'var(--amber-d)',
                      }}
                    >
                      {errorCount > 0
                        ? `${errorCount} problem${errorCount === 1 ? '' : 's'} found`
                        : `${warningCount} thing${warningCount === 1 ? '' : 's'} worth a look`}
                      {errorCount > 0 && warningCount > 0 ? ` · ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
                    </div>
                    <ul
                      className="scroll"
                      style={{
                        listStyle: 'none', margin: 0, padding: '4px 12px 8px', maxHeight: 190, overflowY: 'auto',
                        border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 9px 9px',
                      }}
                    >
                      {(preflight.data.findings || []).map((f, i) => (
                        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '7px 0' }}>
                          <span style={{ flex: 'none', fontWeight: 800, fontSize: 12, color: f.severity === 'error' ? 'var(--red-ink)' : 'var(--amber-d)' }}>
                            {f.severity === 'error' ? '!' : '·'}
                          </span>
                          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--body)' }}>
                            {f.message}
                            <span className="ms" style={{ marginLeft: 7, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                              {f.file}
                            </span>
                          </span>
                        </li>
                      ))}
                      {preflight.data.truncated > 0 && (
                        <li style={{ padding: '7px 0', fontSize: 12.5, color: 'var(--muted)' }}>
                          + {preflight.data.truncated} more…
                        </li>
                      )}
                    </ul>
                  </div>
                )
              ) : null}
            </div>

            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--muted)', background: 'var(--field)', borderRadius: 9, padding: '11px 13px' }}>
              This merges the changes above into <strong style={{ color: 'var(--ink)' }}>projecthood.org</strong>. Nothing else changes.
            </div>
          </div>
          <div style={{ padding: '0 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowPublish(false)} disabled={publishing}>Cancel</button>
            <button
              className="btn btn-primary cta-btn"
              onClick={confirmPublish}
              disabled={publishing || preflight.loading}
              title={blocking ? 'The checks found problems — publish only if you know these are fine.' : undefined}
            >
              {publishing ? 'Publishing…' : blocking ? 'Publish anyway' : 'Publish now'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

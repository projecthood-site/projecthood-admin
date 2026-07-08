import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { relativeTime } from '../lib/format';
import Modal from '../components/Modal';

const ACCENTS = ['#006a63', '#fbe14c', '#712f6b', '#ef4032'];

function KpiCard({ label, value, delta, accent, deltaColor }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ width: 8, alignSelf: 'stretch', borderRadius: 999, flex: 'none', background: accent }} />
        <div>
          <div className="label">{label}</div>
          <div className="ak" style={{ fontSize: 46, lineHeight: '.9', marginTop: 10, color: 'var(--ink)' }}>
            {value}
          </div>
          <div className="ms" style={{ fontWeight: 600, fontSize: 11.5, marginTop: 8, color: deltaColor || 'var(--muted)' }}>
            {delta}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const toast = useToast();
  const { profile } = useAuth();

  const [pubStatus, setPubStatus] = useState({ loading: true, error: null, data: null });
  const [upcoming, setUpcoming] = useState(null);
  const [activity, setActivity] = useState({ loading: true, rows: [] });
  const [showPublish, setShowPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const loadPublishStatus = useCallback(async () => {
    setPubStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/publish?action=status');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setPubStatus({ loading: false, error: null, data });
    } catch (err) {
      setPubStatus({ loading: false, error: err.message, data: null });
    }
  }, []);

  useEffect(() => {
    loadPublishStatus();
  }, [loadPublishStatus]);

  // Real KPI: count of published, upcoming events.
  useEffect(() => {
    let active = true;
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gte('starts_at', new Date().toISOString())
      .then(({ count, error }) => {
        if (active) setUpcoming(error ? null : count ?? 0);
      });
    return () => { active = false; };
  }, []);

  // Activity feed from activity_log.
  useEffect(() => {
    let active = true;
    supabase
      .from('activity_log')
      .select('id, kind, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (active) setActivity({ loading: false, rows: data || [] });
      });
    return () => { active = false; };
  }, []);

  async function confirmPublish() {
    setPublishing(true);
    try {
      const res = await fetch('/api/publish', { method: 'POST' });
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
  const hasPending = ahead > 0;

  const kpis = [
    {
      label: 'Upcoming events',
      value: upcoming == null ? '—' : String(upcoming),
      delta: upcoming == null ? 'Loading…' : 'Published & scheduled ahead',
      accent: ACCENTS[3], deltaColor: 'var(--muted)',
    },
    { label: 'Donations · this month', value: '$48,230', delta: 'Placeholder — wiring in Phase 2', accent: ACCENTS[0] },
    { label: 'Site visitors · 30d', value: '12.4K', delta: 'Placeholder — wiring in Phase 2', accent: ACCENTS[1] },
    { label: 'Active volunteers', value: '312', delta: 'Placeholder — wiring in Phase 2', accent: ACCENTS[2] },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
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
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </div>
          <h2 className="ak" style={{ fontSize: 38, lineHeight: '.88', margin: '8px 0 10px', color: '#fff', maxWidth: '16ch' }}>
            Your website, in one calm place
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0, maxWidth: '52ch', color: 'rgba(255,255,255,.92)' }}>
            Manage events, review what's changed, and publish to the live site — all from here. This
            is the Phase 2 vertical slice: Dashboard and Events are wired to the live database.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                    {ahead} unpublished change{ahead === 1 ? '' : 's'} waiting
                  </div>
                ) : (
                  <div
                    className="ms"
                    style={{ marginTop: 12, background: 'var(--green-t)', borderRadius: 9, padding: '10px 12px', fontWeight: 700, fontSize: 12, color: 'var(--green-d)' }}
                  >
                    ✓ All changes published
                  </div>
                )}
                <button
                  className={'btn ' + (hasPending ? 'btn-primary' : 'btn-disabled')}
                  disabled={!hasPending}
                  onClick={() => setShowPublish(true)}
                  style={{ width: '100%', marginTop: 12 }}
                >
                  {hasPending ? 'Review & publish' : 'Nothing to publish'}
                </button>
              </>
            )}
          </div>

          {/* Activity */}
          <div className="card" style={{ padding: 20 }}>
            <div className="ak" style={{ fontSize: 20, color: 'var(--ink)', marginBottom: 14 }}>Activity</div>
            {activity.loading ? (
              <div className="note">Loading…</div>
            ) : activity.rows.length === 0 ? (
              <div className="note" style={{ lineHeight: 1.5 }}>No activity yet. Changes will show up here as your team works.</div>
            ) : (
              activity.rows.map((a, i) => (
                <div
                  key={a.id}
                  className={i < activity.rows.length - 1 ? 'row-div' : ''}
                  style={{ display: 'flex', gap: 11, paddingBottom: i < activity.rows.length - 1 ? 13 : 0, marginBottom: i < activity.rows.length - 1 ? 13 : 0 }}
                >
                  <span style={{ width: 9, height: 9, marginTop: 4, flex: 'none', background: 'var(--green)', borderRadius: 999 }} />
                  <div>
                    <div className="ms" style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.4 }}>{a.summary}</div>
                    <div className="ms" style={{ fontWeight: 500, fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{relativeTime(a.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showPublish && (
        <Modal title="Publish to the live site?" onClose={() => (publishing ? null : setShowPublish(false))}>
          <div style={{ padding: '20px 22px' }}>
            <div className="label" style={{ marginBottom: 10 }}>
              {ahead} change{ahead === 1 ? '' : 's'} will go live
            </div>
            {pubStatus.data?.last_commit_message && (
              <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--body)', margin: '0 0 16px' }}>
                Latest: “{pubStatus.data.last_commit_message}”
              </p>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--muted)', background: 'var(--field)', borderRadius: 9, padding: '11px 13px' }}>
              This merges your staged changes into <strong style={{ color: 'var(--ink)' }}>projecthood.org</strong>.
            </div>
          </div>
          <div style={{ padding: '0 22px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setShowPublish(false)} disabled={publishing}>Cancel</button>
            <button className="btn btn-primary cta-btn" onClick={confirmPublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish now'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

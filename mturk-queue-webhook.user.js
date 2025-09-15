// ==UserScript==
// @name         MTurk → Webhook: Accepted HIT notifier + panel
// @namespace    https://example.com/mturk
// @version      1.2
// @description  Detect accepted/assigned HITs from /tasks and POST details (workerId, requester, reward, timeRemaining) to a webhook. Adds small UI panel on the page.
// @match        https://worker.mturk.com/tasks*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      webhook.site
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // --- CONFIG ---
  const WEBHOOK_URL = 'https://webhook.site/80b9e516-aa1b-4893-98d3-f805e22a358f'; // <- your webhook
  const POLL_INTERVAL_MS = 1500; // poll frequency (ms). Increase if you hit rate limits.
  const STORAGE_KEY = 'mturk_seen_assignments_v1';

  // --- state ---
  const seenAssignments = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  let panel, listEl, statusEl;

  // --- CSS for panel ---
  GM_addStyle(`
    #mturk-webhook-panel {
      position: fixed;
      right: 12px;
      top: 80px;
      width: 360px;
      max-height: 420px;
      overflow: auto;
      z-index: 999999;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.12);
      font-family: Arial, sans-serif;
      font-size: 13px;
      color: #111;
      padding: 10px;
    }
    #mturk-webhook-panel h4 { margin: 0 0 8px 0; font-size: 14px; }
    #mturk-webhook-panel .mw-row { margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
    #mturk-webhook-panel .mw-small { font-size: 12px; color: #666; }
    #mturk-webhook-panel button { margin-right: 6px; margin-top:6px; }
    #mturk-webhook-panel .mw-status { margin-top:6px; font-weight:600; color:#0a66ff; }
    #mturk-webhook-panel .mw-error { color: #c00; font-weight:700; }
  `);

  // --- build UI ---
  function createPanel() {
    if (document.getElementById('mturk-webhook-panel')) return;
    panel = document.createElement('div');
    panel.id = 'mturk-webhook-panel';
    panel.innerHTML = `
      <h4>📥 Accepted HITs</h4>
      <div id="mw-controls">
        <button id="mw-test-btn">Send test</button>
        <button id="mw-clear-btn">Clear seen</button>
        <button id="mw-toggle-btn">Pause</button>
      </div>
      <div id="mw-status" class="mw-status">idle</div>
      <div id="mw-list" style="margin-top:8px"></div>
    `;
    document.body.appendChild(panel);
    listEl = document.getElementById('mw-list');
    statusEl = document.getElementById('mw-status');

    document.getElementById('mw-test-btn').addEventListener('click', sendTestWebhook);
    document.getElementById('mw-clear-btn').addEventListener('click', () => {
      seenAssignments.clear();
      localStorage.removeItem(STORAGE_KEY);
      listEl.innerHTML = '';
      setStatus('Cleared seen list');
    });
    document.getElementById('mw-toggle-btn').addEventListener('click', togglePolling);
  }

  // --- helpers ---
  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = isError ? 'mw-error' : 'mw-status';
  }

  function getWorkerId() {
    // The worker id appears in the top bar (sample HTML has a .text-uppercase span).
    const el = document.querySelector('.me-bar .text-uppercase') || document.querySelector('.me-bar .text-uppercase span');
    if (!el) return null;
    return el.innerText.trim();
  }

  function formatTimeRemaining(seconds) {
    if (seconds == null) return 'unknown';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  function addToPanel(task, workerId) {
    const container = document.createElement('div');
    container.className = 'mw-row';
    const reqName = (task.project && task.project.requester_name) ? task.project.requester_name : 'Unknown requester';
    const title = (task.project && task.project.title) ? task.project.title : (task.title || 'Untitled HIT');
    const reward = (task.project && task.project.monetary_reward && task.project.monetary_reward.amount_in_dollars != null)
      ? `$${task.project.monetary_reward.amount_in_dollars.toFixed ? task.project.monetary_reward.amount_in_dollars.toFixed(2) : task.project.monetary_reward.amount_in_dollars}`
      : (task.reward || '?');
    const remaining = (task.time_to_deadline_in_seconds != null) ? formatTimeRemaining(task.time_to_deadline_in_seconds) : (task.deadline ? formatTimeRemaining((new Date(task.deadline) - Date.now())/1000) : 'unknown');

    container.innerHTML = `
      <div><b>${reqName}</b> <span class="mw-small">| ${reward}</span></div>
      <div style="margin-top:4px">${title}</div>
      <div class="mw-small">Worker: <b>${workerId || getWorkerId() || 'Unknown'}</b> • Time left: <b>${remaining}</b></div>
      <div class="mw-small">assignmentId: ${task.assignment_id || 'N/A'} • hitId: ${task.task_id || 'N/A'}</div>
    `;
    listEl.insertBefore(container, listEl.firstChild);
  }

  function persistSeen() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seenAssignments)));
  }

  function sendWebhook(payload, cb) {
    try {
      // Use GM_xmlhttpRequest to avoid potential CORS blocks; webhook.site allows CORS but this is robust.
      GM_xmlhttpRequest({
        method: 'POST',
        url: WEBHOOK_URL,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        onload: function(res) {
          console.log('Webhook posted', res.status, res);
          if (cb) cb(null, res);
        },
        onerror: function(err) {
          console.error('Webhook error', err);
          if (cb) cb(err);
        }
      });
    } catch (e) {
      console.error('GM_xmlhttpRequest failed', e);
      if (cb) cb(e);
    }
  }

  // manual test button
  function sendTestWebhook() {
    const testPayload = {
      event: 'hit_accepted_test',
      requester: 'TEST Requester',
      reward: '0.50',
      workerId: getWorkerId() || 'Unknown',
      time: (new Date()).toISOString()
    };
    setStatus('Sending test webhook...');
    sendWebhook(testPayload, (err, res) => {
      if (err) setStatus('Test webhook failed', true);
      else setStatus('Test webhook sent (check webhook.site)');
      console.log('test webhook response', res);
    });
  }

  // --- polling / processing ---
  let pollHandle = null;
  let paused = false;

  function togglePolling() {
    paused = !paused;
    const btn = document.getElementById('mw-toggle-btn');
    if (paused) {
      clearInterval(pollHandle);
      pollHandle = null;
      if (btn) btn.textContent = 'Resume';
      setStatus('Paused by user');
    } else {
      if (btn) btn.textContent = 'Pause';
      setStatus('Resuming polling...');
      pollHandle = setInterval(pollTasks, POLL_INTERVAL_MS);
      pollTasks(); // immediate
    }
  }

  async function pollTasks() {
    setStatus('Polling /tasks...');
    try {
      // same-origin fetch so cookies/session are included
      const res = await fetch('/tasks?format=json', { credentials: 'same-origin' });
      const text = await res.text();

      if (!res.ok) {
        setStatus('Network response not OK: ' + res.status, true);
        return;
      }

      // If Amazon returns a sign-in or CAPTCHA HTML, we should detect and stop sending webhooks
      if (text.includes('captcha') || text.includes('Sign-In') || text.includes('To better protect your account')) {
        setStatus('CAPTCHA/Login detected — waiting for manual action', true);
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        setStatus('Response not JSON — no tasks', true);
        console.debug('Response text:', text.slice(0, 800));
        return;
      }

      const tasks = data.tasks || [];
      setStatus(`Found ${tasks.length} tasks`);

      // iterate tasks and look for assigned/accepted ones
      for (const t of tasks) {
        // consider state 'Assigned' (sample pages use "Assigned")
        if ((t.state && (t.state === 'Assigned' || t.state === 'Accepted')) && t.assignment_id) {
          if (!seenAssignments.has(t.assignment_id)) {
            // new accepted hit — report
            seenAssignments.add(t.assignment_id);
            persistSeen();

            // UI
            addToPanel(t, getWorkerId());

            // Payload: match the example you provided earlier
            const payload = {
              event: 'hit_accepted',
              requester: (t.project && t.project.requester_name) || 'Unknown',
              reward: (t.project && t.project.monetary_reward && t.project.monetary_reward.amount_in_dollars != null)
                ? String(t.project.monetary_reward.amount_in_dollars)
                : (t.reward || '?'),
              workerId: getWorkerId() || 'Unknown',
              time: (new Date()).toISOString(),
              assignmentId: t.assignment_id,
              hitId: t.task_id,
              title: (t.project && t.project.title) || t.title || 'Unknown',
              timeRemainingSeconds: t.time_to_deadline_in_seconds != null ? t.time_to_deadline_in_seconds : null
            };

            setStatus('New accepted HIT — sending webhook...');
            sendWebhook(payload, (err) => {
              if (err) setStatus('Webhook send failed', true);
              else setStatus('Webhook sent for assignment ' + t.assignment_id);
            });
          }
        }
      }

    } catch (err) {
      console.error('pollTasks error', err);
      setStatus('Error polling tasks: ' + (err && err.message), true);
    }
  }

  // --- init ---
  createPanel();
  // kick off polling immediately and then at interval
  pollHandle = setInterval(pollTasks, POLL_INTERVAL_MS);
  pollTasks();

})();

// ============================================================
// Job Dashboard — app.js v2
// ============================================================

const JOBS_URL   = 'jobs.json';
const RESUME_URL = 'resume.json';
const STATE_KEY  = 'job_triage_v1';
const API_KEY_STORAGE = 'anthropic_api_key';

let allJobs    = [];
let resumeData = null;
let triageState = {};
let currentTab  = 'queue';
let currentDiffJob     = null;
let currentDiffChanges = [];
let currentDiffType    = 'resume';

// ============================================================
// INIT
// ============================================================

async function init() {
  triageState = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  await Promise.all([loadJobs(), loadResume()]);
}

async function loadJobs() {
  try {
    const res  = await fetch(JOBS_URL + '?t=' + Date.now());
    const data = await res.json();
    allJobs = data.jobs || [];
    if (data.last_updated) {
      const d = new Date(data.last_updated);
      document.getElementById('last-updated').textContent =
        'Updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (e) {
    allJobs = [];
    console.error('Failed to load jobs.json', e);
  }
  render();
}

async function loadResume() {
  try {
    const res = await fetch(RESUME_URL + '?t=' + Date.now());
    resumeData = await res.json();
  } catch (e) {
    console.error('Failed to load resume.json', e);
    resumeData = null;
  }
}

// ============================================================
// API KEY
// ============================================================

function showSetup() {
  const key = localStorage.getItem(API_KEY_STORAGE) || '';
  document.getElementById('api-key-input').value = key;
  document.getElementById('setup-screen').classList.add('open');
}

function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (val && !val.startsWith('sk-ant-')) {
    alert("That doesn't look like an Anthropic API key. It should start with sk-ant-");
    return;
  }
  localStorage.setItem(API_KEY_STORAGE, val);
  document.getElementById('setup-screen').classList.remove('open');
}

// ============================================================
// TRIAGE
// ============================================================

function acceptJob(jobId) {
  triageState[jobId] = { status: 'accepted', appStatus: 'saved' };
  saveState();
  render();
}

function rejectJob(jobId) {
  triageState[jobId] = { status: 'rejected', appStatus: '' };
  saveState();
  render();
}

function undoJob(jobId) {
  delete triageState[jobId];
  saveState();
  render();
}

function setAppStatus(jobId, status) {
  if (triageState[jobId]) {
    triageState[jobId].appStatus = status;
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(triageState));
}

// ============================================================
// TABS
// ============================================================

function switchTab(tab) {
  currentTab = tab;
  ['queue', 'accepted', 'archive'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    document.getElementById('view-' + t).style.display = t === tab ? 'block' : 'none';
  });
}

// ============================================================
// RENDER
// ============================================================

function render() {
  const queue    = allJobs.filter(j => !triageState[j.id] || triageState[j.id].status === 'new');
  const accepted = allJobs.filter(j => triageState[j.id]?.status === 'accepted');
  const archive  = allJobs.filter(j => triageState[j.id]?.status === 'rejected');

  document.getElementById('count-queue').textContent    = queue.length;
  document.getElementById('count-accepted').textContent = accepted.length;
  document.getElementById('count-archive').textContent  = archive.length;
  document.getElementById('queue-subtitle').textContent =
    queue.length === 0 ? 'All caught up' : `${queue.length} job${queue.length !== 1 ? 's' : ''} to review`;

  renderList('list-queue',    queue,    'queue');
  renderList('list-accepted', accepted, 'accepted');
  renderList('list-archive',  archive,  'archive');
}

function renderList(containerId, jobs, type) {
  const el = document.getElementById(containerId);
  if (jobs.length === 0) { el.innerHTML = emptyState(type); return; }
  el.innerHTML = jobs.map(job => jobCard(job, type)).join('');
}

function emptyState(type) {
  const msgs = {
    queue:    { icon: '✦', title: 'All caught up',          sub: 'New jobs appear here each morning.' },
    accepted: { icon: '◎', title: 'Nothing accepted yet',   sub: 'Accept jobs from the queue to generate tailored documents.' },
    archive:  { icon: '○', title: 'Archive is empty',       sub: 'Rejected jobs will appear here.' },
  };
  const m = msgs[type];
  return `<div class="empty"><div class="empty-icon">${m.icon}</div><h3>${m.title}</h3><p>${m.sub}</p></div>`;
}

function jobCard(job, type) {
  const hasDesc   = job.description && job.description.trim().length > 20;
  const appStatus = triageState[job.id]?.appStatus || 'saved';

  const appStatusSelect = type === 'accepted' ? `
    <select onchange="setAppStatus('${job.id}', this.value)"
      style="font-family:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--border);
             border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer;margin-left:auto;">
      <option value="saved"        ${appStatus==='saved'?'selected':''}>Saved</option>
      <option value="applied"      ${appStatus==='applied'?'selected':''}>Applied</option>
      <option value="interviewing" ${appStatus==='interviewing'?'selected':''}>Interviewing</option>
    </select>` : '';

  const actions = {
    queue: `
      <button class="btn btn-accept" onclick="acceptJob('${job.id}')">✓ Interested</button>
      <button class="btn btn-reject" onclick="rejectJob('${job.id}')">✕ Pass</button>`,
    accepted: `
      <button class="btn btn-generate" onclick="generateDocs('${job.id}','resume')">Generate resume</button>
      <button class="btn btn-generate" style="background:var(--bg);color:var(--text);border-color:var(--border);"
        onclick="generateDocs('${job.id}','cover')">Cover letter</button>
      <button class="btn btn-undo" onclick="undoJob('${job.id}')">Undo</button>
      ${appStatusSelect}`,
    archive: `
      <button class="btn btn-undo" onclick="undoJob('${job.id}')">↩ Restore</button>`,
  };

  return `<div class="job-card" id="card-${job.id}">
    <div class="job-card-top">
      <div>
        <div class="job-company">${esc(job.company)}</div>
        <div class="job-title"><a href="${esc(job.url)}" target="_blank">${esc(job.title)}</a></div>
      </div>
    </div>
    <div class="job-meta">
      ${job.location ? `<span class="meta-tag">${esc(job.location)}</span>` : ''}
      ${job.salary   ? `<span class="meta-tag">${esc(job.salary)}</span>`   : ''}
      <span class="meta-tag new">${esc(job.date_found || 'Today')}</span>
    </div>
    ${hasDesc ? `
    <button class="desc-toggle" onclick="toggleDesc('${job.id}')">
      <span id="toggle-arrow-${job.id}">▸</span> View description
    </button>
    <div class="desc-body" id="desc-${job.id}">${esc(job.description)}</div>` : ''}
    <div class="job-actions" id="actions-${job.id}">${actions[type]}</div>
    <div class="generating-msg" id="gen-${job.id}">
      <div class="spinner"></div> Generating with Claude…
    </div>
  </div>`;
}

function toggleDesc(jobId) {
  const el    = document.getElementById('desc-' + jobId);
  const arrow = document.getElementById('toggle-arrow-' + jobId);
  arrow.textContent = el.classList.toggle('open') ? '▾' : '▸';
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// AI GENERATION
// ============================================================

async function generateDocs(jobId, type) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) { showSetup(); return; }
  if (!resumeData) { alert('Resume data not loaded yet — try again in a moment.'); return; }

  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;

  document.getElementById('actions-' + jobId).style.display = 'none';
  document.getElementById('gen-' + jobId).classList.add('open');

  const prompt = type === 'resume' ? buildResumePrompt(job) : buildCoverPrompt(job);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data  = await res.json();
    const text  = data.content?.map(b => b.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const changes = JSON.parse(clean);

    currentDiffJob     = job;
    currentDiffChanges = changes.map(c => ({ ...c, accepted: true }));
    currentDiffType    = type;
    showDiff(job, type);
  } catch (e) {
    alert('Generation failed: ' + e.message + '\n\nCheck your API key and credits.');
    console.error(e);
  } finally {
    document.getElementById('actions-' + jobId).style.display = 'flex';
    document.getElementById('gen-' + jobId).classList.remove('open');
  }
}

function buildResumePrompt(job) {
  return `You are a professional resume editor helping tailor a resume for a specific job.

CANDIDATE RESUME (JSON):
${JSON.stringify(resumeData, null, 2)}

JOB POSTING:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location || 'Not specified'}
Description: ${job.description || 'Not available'}

INSTRUCTIONS:
Suggest specific edits to tailor Victor's resume for this role. Focus on:
1. Adjusting the summary to mirror language from the job description
2. Reordering or rewording bullet points to emphasize most relevant experience
3. Surfacing the most relevant skills

Return ONLY a JSON array — no preamble, no markdown fences. Each item must be:
{
  "type": "summary" | "bullet" | "skills",
  "experience_company": "Stanley Robotics" (only for bullet type — which job the bullet belongs to),
  "original": "exact original text to change",
  "suggested": "improved version",
  "reason": "one sentence explanation"
}

Max 5 suggestions. Only suggest changes grounded in Victor's real experience. Never invent experience.`;
}

function buildCoverPrompt(job) {
  const r = resumeData;
  return `You are a professional cover letter writer.

CANDIDATE:
Name: ${r.name}
Current role: ${r.experience[0].title} at ${r.experience[0].company} (${r.experience[0].dates})
Summary: ${r.summary}

BASE COVER LETTER:
Dear Hiring Team,

I am writing to express my interest in the [ROLE] position at [COMPANY]. As a customer-facing commercial professional with hands-on experience supporting autonomous vehicle deployments in airport and industrial environments, I believe I can bring immediate value to your team.

At Stanley Robotics, I serve as the primary commercial interface across the full sales cycle — from discovery and business case development through contract negotiation and post-signature coordination. I co-lead our U.S. market entry efforts and manage the commercial relationship with a major international airport serving over 40 million passengers annually.

My experience at EasyMile deepened my understanding of the AV competitive landscape and go-to-market strategies across different deployment contexts. I am drawn to [COMPANY] because [REASON].

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
Victor Achard

JOB POSTING:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location || 'Not specified'}
Description: ${job.description || 'Not available'}

INSTRUCTIONS:
Suggest specific edits to tailor this cover letter for the role.

Return ONLY a JSON array — no preamble, no markdown fences. Each item:
{
  "type": "cover",
  "original": "exact original text to change",
  "suggested": "improved version",
  "reason": "one sentence explanation"
}

Max 4 suggestions. Replace [ROLE], [COMPANY], and [REASON] placeholders with appropriate content. Keep changes honest.`;
}

// ============================================================
// DIFF UI
// ============================================================

function showDiff(job, type) {
  document.getElementById('diff-subtitle').textContent =
    `${type === 'resume' ? 'Resume' : 'Cover letter'} tailored for ${job.title} at ${job.company}`;

  document.getElementById('diff-items').innerHTML = currentDiffChanges.map((c, i) => `
    <div class="diff-item" id="diff-item-${i}">
      <div class="diff-item-header">
        <span>${c.type}${c.experience_company ? ' — ' + c.experience_company : ''}</span>
        <span id="diff-status-${i}" style="font-size:11px;color:var(--green)">✓ accepted</span>
      </div>
      <div class="diff-item-body">
        <div class="diff-original">${esc(c.original)}</div>
        <div class="diff-suggested">${esc(c.suggested)}</div>
        <div class="diff-reason">${esc(c.reason)}</div>
        <div class="diff-item-actions">
          <button class="btn btn-accept" onclick="toggleDiffItem(${i}, true)">✓ Accept</button>
          <button class="btn btn-reject" onclick="toggleDiffItem(${i}, false)">✕ Reject</button>
        </div>
      </div>
    </div>`).join('');

  document.getElementById('diff-modal').classList.add('open');
}

function toggleDiffItem(i, accept) {
  currentDiffChanges[i].accepted = accept;
  const el = document.getElementById('diff-status-' + i);
  el.style.color = accept ? 'var(--green)' : 'var(--muted)';
  el.textContent = accept ? '✓ accepted'   : '✕ rejected';
}

function closeDiff() {
  document.getElementById('diff-modal').classList.remove('open');
  currentDiffJob = null;
  currentDiffChanges = [];
}

// ============================================================
// DOCX DOWNLOAD
// ============================================================

function downloadDocx() {
  if (typeof window.docx === "undefined") { alert("Still loading — try again in 2 seconds."); return; }
 if (!currentDiffJob || !resumeData) return;

  const accepted = currentDiffChanges.filter(c => c.accepted);
  const job      = currentDiffJob;
  const type     = currentDiffType;

  if (type === 'resume') {
    buildResumeDocx(applyResumeChanges(accepted), job);
  } else {
    buildCoverDocx(applyCoverChanges(accepted, job), job);
  }
  closeDiff();
}

function applyResumeChanges(accepted) {
  const r = JSON.parse(JSON.stringify(resumeData));
  accepted.forEach(change => {
    if (change.type === 'summary') {
      r.summary = change.suggested;
    } else if (change.type === 'bullet' && change.experience_company) {
      const exp = r.experience.find(e => e.company === change.experience_company);
      if (exp) {
        exp.bullets = exp.bullets.map(b =>
          b.trim() === change.original.trim() ? change.suggested : b
        );
      }
    } else if (change.type === 'skills') {
      r.skills = r.skills.map(s =>
        s.items.includes(change.original) ? { ...s, items: change.suggested } : s
      );
    }
  });
  return r;
}

function applyCoverChanges(accepted, job) {
  let text = `Dear Hiring Team,

I am writing to express my interest in the ${job.title} position at ${job.company}. As a customer-facing commercial professional with hands-on experience supporting autonomous vehicle deployments in airport and industrial environments, I believe I can bring immediate value to your team.

At Stanley Robotics, I serve as the primary commercial interface across the full sales cycle — from discovery and business case development through contract negotiation and post-signature coordination. I co-lead our U.S. market entry efforts and manage the commercial relationship with a major international airport serving over 40 million passengers annually.

My experience at EasyMile deepened my understanding of the AV competitive landscape and go-to-market strategies across different deployment contexts. I am drawn to ${job.company} because of your approach to commercializing autonomous technology and the opportunity to contribute to early-stage deployments.

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
Victor Achard`;

  accepted.forEach(c => {
    if (c.original && c.suggested) text = text.replace(c.original, c.suggested);
  });
  return text;
}

function buildResumeDocx(r, job) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    LevelFormat, TabStopType, TabStopPosition, BorderStyle,
  } = window.docx;

  const FONT      = 'Calibri';
  const COLOR     = '1A1A18';
  const MUTED     = '555555';
  const HR_COLOR  = 'CCCCCC';
  const NAME_SIZE = 32;
  const HEAD_SIZE = 22;
  const BODY_SIZE = 20;

  const sectionHead = (text) => new Paragraph({
    spacing: { before: 180, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: HR_COLOR } },
    children: [new TextRun({
      text, font: FONT, size: HEAD_SIZE, bold: true, color: COLOR, allCaps: true, characterSpacing: 40,
    })],
  });

  const bullet = (text) => new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, font: FONT, size: BODY_SIZE, color: COLOR })],
  });

  const children = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text: r.name, font: FONT, size: NAME_SIZE, bold: true, color: COLOR })],
  }));

  const contactLine = `US: ${r.contact.us_phone}  /  FR: ${r.contact.fr_phone}  /  ${r.contact.email}  /  ${r.contact.linkedin}`;
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [new TextRun({ text: contactLine, font: FONT, size: BODY_SIZE, color: MUTED })],
  }));

  children.push(new Paragraph({
    spacing: { before: 0, after: 160 },
    children: [new TextRun({ text: r.summary, font: FONT, size: BODY_SIZE, color: COLOR, italics: true })],
  }));

  children.push(sectionHead('Professional Experience'));

  r.experience.forEach(exp => {
    children.push(new Paragraph({
      spacing: { before: 140, after: 20 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: exp.company + ',', font: FONT, size: BODY_SIZE, bold: true, color: COLOR }),
        new TextRun({ text: ' ' + exp.location, font: FONT, size: BODY_SIZE, color: COLOR }),
        new TextRun({ text: '\t' + exp.dates, font: FONT, size: BODY_SIZE, color: MUTED }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: exp.title, font: FONT, size: BODY_SIZE, color: COLOR, italics: true })],
    }));
    exp.bullets.forEach(b => children.push(bullet(b)));
  });

  children.push(sectionHead('Skills'));
  r.skills.forEach(skill => {
    children.push(new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [
        new TextRun({ text: skill.category + ': ', font: FONT, size: BODY_SIZE, bold: true, color: COLOR }),
        new TextRun({ text: skill.items, font: FONT, size: BODY_SIZE, color: COLOR }),
      ],
    }));
  });

  children.push(sectionHead('Education'));
  r.education.forEach(edu => {
    children.push(new Paragraph({
      spacing: { before: 140, after: 20 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: edu.degree, font: FONT, size: BODY_SIZE, bold: true, color: COLOR }),
        new TextRun({ text: '\t' + edu.dates, font: FONT, size: BODY_SIZE, color: MUTED }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: edu.school + '  ' + edu.location, font: FONT, size: BODY_SIZE, color: COLOR })],
    }));
    edu.bullets.forEach(b => children.push(bullet(b)));
  });

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'resume-bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 360 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children,
    }],
  });

  const filename = `Victor_Achard_${job.company.replace(/\s+/g, '_')}_Resume.docx`;
  Packer.toBlob(doc).then(blob => triggerDownload(blob, filename));
}

function buildCoverDocx(text, job) {
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const FONT = 'Calibri';
  const SIZE = 22;
  const COLOR = '1A1A18';

  const children = text.split('\n').map(line =>
    new Paragraph({
      spacing: { before: 0, after: line === '' ? 160 : 60 },
      children: [new TextRun({ text: line, font: FONT, size: SIZE, color: COLOR })],
    })
  );

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  const filename = `Victor_Achard_${job.company.replace(/\s+/g, '_')}_CoverLetter.docx`;
  Packer.toBlob(doc).then(blob => triggerDownload(blob, filename));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const s = document.createElement('script');
s.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
s.onload = () => { window.docxReady = true; };
document.head.appendChild(s);

init();
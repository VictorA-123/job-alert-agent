// ============================================================
// Job Dashboard — app.js
// ============================================================

const JOBS_URL = 'jobs.json';
const STATE_KEY = 'job_triage_v1';
const API_KEY_STORAGE = 'anthropic_api_key';

let allJobs = [];
let triageState = {};   // { [jobId]: { status: 'new'|'accepted'|'rejected', appStatus: 'saved'|'applied'|'interviewing' } }
let currentTab = 'queue';
let currentDiffJob = null;
let currentDiffChanges = [];
let currentDiffType = 'resume'; // 'resume' or 'cover'

// ============================================================
// INIT
// ============================================================

async function init() {
  triageState = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  await loadJobs();
  checkApiKey();
}

async function loadJobs() {
  try {
    const res = await fetch(JOBS_URL + '?t=' + Date.now());
    const data = await res.json();
    allJobs = data.jobs || [];

    // Format last updated
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

// ============================================================
// API KEY
// ============================================================

function checkApiKey() {
  // Don't auto-show setup — only show when user clicks or tries to generate
}

function showSetup() {
  const key = localStorage.getItem(API_KEY_STORAGE) || '';
  document.getElementById('api-key-input').value = key;
  document.getElementById('setup-screen').classList.add('open');
}

function saveApiKey() {
  const val = document.getElementById('api-key-input').value.trim();
  if (!val.startsWith('sk-ant-') && val !== '') {
    alert('That doesn\'t look like an Anthropic API key. It should start with sk-ant-');
    return;
  }
  localStorage.setItem(API_KEY_STORAGE, val);
  document.getElementById('setup-screen').classList.remove('open');
}

// ============================================================
// TRIAGE ACTIONS
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
    render();
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
  if (jobs.length === 0) {
    el.innerHTML = emptyState(type);
    return;
  }
  el.innerHTML = jobs.map(job => jobCard(job, type)).join('');
}

function emptyState(type) {
  const msgs = {
    queue:    { icon: '✦', title: 'All caught up', sub: 'New jobs will appear here each morning.' },
    accepted: { icon: '◎', title: 'Nothing accepted yet', sub: 'Accept jobs from the queue to generate tailored documents.' },
    archive:  { icon: '○', title: 'Archive is empty', sub: 'Rejected jobs will appear here.' },
  };
  const m = msgs[type];
  return `<div class="empty">
    <div class="empty-icon">${m.icon}</div>
    <h3>${m.title}</h3>
    <p>${m.sub}</p>
  </div>`;
}

function jobCard(job, type) {
  const hasDesc = job.description && job.description.trim().length > 20;
  const appStatus = triageState[job.id]?.appStatus || 'saved';

  const appStatusOptions = type === 'accepted' ? `
    <select onchange="setAppStatus('${job.id}', this.value)"
      style="font-family:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--border);
             border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer;margin-left:auto;">
      <option value="saved" ${appStatus==='saved'?'selected':''}>Saved</option>
      <option value="applied" ${appStatus==='applied'?'selected':''}>Applied</option>
      <option value="interviewing" ${appStatus==='interviewing'?'selected':''}>Interviewing</option>
    </select>` : '';

  const actions = {
    queue: `
      <button class="btn btn-accept" onclick="acceptJob('${job.id}')">✓ Interested</button>
      <button class="btn btn-reject" onclick="rejectJob('${job.id}')">✕ Pass</button>`,
    accepted: `
      <button class="btn btn-generate" onclick="generateDocs('${job.id}', 'resume')">Generate resume</button>
      <button class="btn btn-generate" style="background:var(--bg);color:var(--text);border-color:var(--border);"
        onclick="generateDocs('${job.id}', 'cover')">Cover letter</button>
      <button class="btn btn-undo" onclick="undoJob('${job.id}')">Undo</button>
      ${appStatusOptions}`,
    archive: `
      <button class="btn btn-undo" onclick="undoJob('${job.id}')">↩ Restore</button>`,
  };

  return `<div class="job-card" id="card-${job.id}">
    <div class="job-card-top">
      <div>
        <div class="job-company">${escHtml(job.company)}</div>
        <div class="job-title"><a href="${escHtml(job.url)}" target="_blank">${escHtml(job.title)}</a></div>
      </div>
    </div>
    <div class="job-meta">
      ${job.location ? `<span class="meta-tag">${escHtml(job.location)}</span>` : ''}
      ${job.salary   ? `<span class="meta-tag">${escHtml(job.salary)}</span>` : ''}
      <span class="meta-tag new">${escHtml(job.date_found || 'Today')}</span>
    </div>
    ${hasDesc ? `<button class="desc-toggle" onclick="toggleDesc('${job.id}')">
      <span id="toggle-arrow-${job.id}">▸</span> View description
    </button>
    <div class="desc-body" id="desc-${job.id}">${escHtml(job.description)}</div>` : ''}
    <div class="job-actions" id="actions-${job.id}">
      ${actions[type]}
    </div>
    <div class="generating-msg" id="gen-${job.id}">
      <div class="spinner"></div> Generating with Claude…
    </div>
  </div>`;
}

function toggleDesc(jobId) {
  const el = document.getElementById('desc-' + jobId);
  const arrow = document.getElementById('toggle-arrow-' + jobId);
  const open = el.classList.toggle('open');
  arrow.textContent = open ? '▾' : '▸';
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// RESUME / COVER LETTER GENERATION
// ============================================================

async function generateDocs(jobId, type) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) {
    showSetup();
    return;
  }

  const job = allJobs.find(j => j.id === jobId);
  if (!job) return;

  // Show spinner
  document.getElementById('actions-' + jobId).style.display = 'none';
  document.getElementById('gen-' + jobId).classList.add('open');

  const prompt = type === 'resume'
    ? buildResumePrompt(job)
    : buildCoverPrompt(job);

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

    const data = await res.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const changes = JSON.parse(clean);

    currentDiffJob = job;
    currentDiffChanges = changes.map(c => ({ ...c, accepted: true }));
    currentDiffType = type;

    showDiff(job, type);
  } catch (e) {
    alert('Generation failed: ' + e.message + '\n\nMake sure your API key is correct and you have credits.');
    console.error(e);
  } finally {
    document.getElementById('actions-' + jobId).style.display = 'flex';
    document.getElementById('gen-' + jobId).classList.remove('open');
  }
}

function buildResumePrompt(job) {
  return `You are a professional resume editor helping tailor a resume for a specific job.

CANDIDATE RESUME:
Victor Achard
victor@achard.us | +1 314-472-5274 | linkedin.com/in/victor-achard-65b112195

SUMMARY:
Customer-facing commercial professional with experience supporting autonomous vehicle deployments in industrial and airport environments. Background at the intersection of sales, operations, and technology adoption in emerging markets.

EXPERIENCE:
Stanley Robotics, Paris — Business Development Representative (Nov 2024 - Present)
- Serve as primary customer interface across full sales cycle for autonomous vehicle solutions in industrial and airport environments
- Co-lead U.S. market entry efforts as part of a two-person sales team
- Act as Account Manager for a major international airport (40M+ passengers), owning commercial negotiations and contract drafting
- Lead customer-specific business case development with financial and operational models
- Partner with operations and engineering on site visits, workshops, and feasibility assessments

EasyMile, Toulouse — Marketing Insights Coordinator (May 2023 - Dec 2023)
- Conducted market research across public and private transportation sectors
- Analyzed competitors' go-to-market approaches across different use cases

BioMerieux, St. Louis — Global Product Marketing Intern (Jun 2022 - Aug 2022)
- Supported go-to-market transition for a new product generation
- Analyzed sales performance and market data to support launch planning

EDUCATION:
Florida State University — BS Marketing & Statistics (2020-2024), GPA 3.82
James M. Seneff Honors Program, SAS Certification, Study abroad Valencia Spain

SKILLS:
Full-cycle sales, account management, CRM, market analysis, product positioning, Excel, SAS, English (native), French (native), Spanish (intermediate)

---

JOB POSTING:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Description: ${job.description || 'Not available'}

---

INSTRUCTIONS:
Suggest specific edits to tailor Victor's resume for this role. Focus on:
1. Reordering or emphasizing relevant bullet points
2. Adjusting the summary to mirror language from the job description
3. Surfacing the most relevant skills

Return ONLY a JSON array with no preamble or markdown fences. Each item:
{
  "section": "summary" | "experience" | "skills",
  "original": "exact original text to change",
  "suggested": "improved version",
  "reason": "brief reason (one sentence)"
}

Only suggest changes grounded in Victor's real experience. Max 5 suggestions.`;
}

function buildCoverPrompt(job) {
  return `You are a professional cover letter writer helping tailor a cover letter for a specific job application.

CANDIDATE:
Victor Achard — Business Development professional in autonomous vehicles
Currently: BDR at Stanley Robotics (autonomous parking robots, airport/industrial deployments, Paris)
Previously: Marketing at EasyMile (autonomous shuttles), BioMerieux
Education: Florida State University, BS Marketing & Statistics, 3.82 GPA
Planning: Moving back to the US this summer
Languages: English (native), French (native), Spanish (intermediate)

BASE COVER LETTER TEMPLATE:
Dear Hiring Team,

I am writing to express my interest in the [ROLE] position at [COMPANY]. As a customer-facing commercial professional with hands-on experience supporting autonomous vehicle deployments in airport and industrial environments, I believe I can bring immediate value to your team.

At Stanley Robotics, I serve as the primary commercial interface across the full sales cycle — from discovery and business case development through contract negotiation and post-signature coordination. I co-lead our U.S. market entry efforts and manage the commercial relationship with a major international airport serving over 40 million passengers annually.

My experience at EasyMile deepened my understanding of the AV competitive landscape and go-to-market strategies across different deployment contexts. I am drawn to [COMPANY] because [REASON].

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
Victor Achard

---

JOB POSTING:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Description: ${job.description || 'Not available'}

---

INSTRUCTIONS:
Suggest specific edits to tailor the cover letter for this role.

Return ONLY a JSON array with no preamble or markdown fences. Each item:
{
  "section": "opening" | "body" | "closing",
  "original": "exact original text to change",
  "suggested": "improved version",
  "reason": "brief reason (one sentence)"
}

Max 4 suggestions. Keep changes honest and grounded in Victor's real experience.`;
}

// ============================================================
// DIFF UI
// ============================================================

function showDiff(job, type) {
  document.getElementById('diff-subtitle').textContent =
    `${type === 'resume' ? 'Resume' : 'Cover letter'} tailored for ${job.title} at ${job.company}`;

  const container = document.getElementById('diff-items');
  container.innerHTML = currentDiffChanges.map((change, i) => `
    <div class="diff-item" id="diff-item-${i}">
      <div class="diff-item-header">
        <span>${change.section}</span>
        <span style="font-size:11px;color:${change.accepted ? 'var(--green)' : 'var(--muted)'}">
          ${change.accepted ? '✓ accepted' : '✕ rejected'}
        </span>
      </div>
      <div class="diff-item-body">
        <div class="diff-original">${escHtml(change.original)}</div>
        <div class="diff-suggested">${escHtml(change.suggested)}</div>
        <div class="diff-reason">${escHtml(change.reason)}</div>
        <div class="diff-item-actions">
          <button class="btn btn-accept" onclick="toggleDiffItem(${i}, true)">✓ Accept</button>
          <button class="btn btn-reject" onclick="toggleDiffItem(${i}, false)">✕ Reject</button>
        </div>
      </div>
    </div>`).join('');

  document.getElementById('diff-modal').classList.add('open');
}

function toggleDiffItem(index, accept) {
  currentDiffChanges[index].accepted = accept;
  const header = document.querySelector(`#diff-item-${index} .diff-item-header span:last-child`);
  header.style.color = accept ? 'var(--green)' : 'var(--muted)';
  header.textContent = accept ? '✓ accepted' : '✕ rejected';
}

function closeDiff() {
  document.getElementById('diff-modal').classList.remove('open');
  currentDiffJob = null;
  currentDiffChanges = [];
}

// ============================================================
// DOCX DOWNLOAD  (using docx.js from CDN)
// ============================================================

function downloadDocx() {
  if (!currentDiffJob) return;

  const accepted = currentDiffChanges.filter(c => c.accepted);
  const job = currentDiffJob;
  const type = currentDiffType;

  // Build final text by applying accepted changes to base content
  let finalText = type === 'resume'
    ? buildFinalResume(accepted)
    : buildFinalCover(accepted, job);

  const filename = `Victor_Achard_${job.company.replace(/\s+/g, '_')}_${type === 'resume' ? 'Resume' : 'CoverLetter'}.docx`;

  // Use docx library if loaded, otherwise plain text download
  if (typeof docx !== 'undefined') {
    buildDocx(finalText, filename, type, job);
  } else {
    // Fallback: download as .txt
    const blob = new Blob([finalText], { type: 'text/plain' });
    triggerDownload(blob, filename.replace('.docx', '.txt'));
  }

  closeDiff();
}

function buildFinalResume(acceptedChanges) {
  let summary = "Customer-facing commercial professional with experience supporting autonomous vehicle deployments in industrial and airport environments. Background at the intersection of sales, operations, and technology adoption in emerging markets.";
  let experienceBullets = [
    "Serve as primary customer interface across full sales cycle for autonomous vehicle solutions in industrial and airport environments",
    "Co-lead U.S. market entry efforts as part of a two-person sales team",
    "Act as Account Manager for a major international airport (40M+ passengers), owning commercial negotiations and contract drafting",
    "Lead customer-specific business case development with financial and operational models",
    "Partner with operations and engineering on site visits, workshops, and feasibility assessments",
  ];

  acceptedChanges.forEach(change => {
    if (change.section === 'summary') {
      summary = change.suggested;
    } else if (change.section === 'experience') {
      experienceBullets = experienceBullets.map(b =>
        b.includes(change.original.substring(0, 30)) ? change.suggested : b
      );
    }
  });

  return `VICTOR ACHARD
victor@achard.us | +1 314-472-5274 | linkedin.com/in/victor-achard-65b112195

SUMMARY
${summary}

EXPERIENCE

Stanley Robotics, Paris — Business Development Representative
November 2024 - Present
${experienceBullets.map(b => '• ' + b).join('\n')}

EasyMile, Toulouse — Marketing Insights Coordinator
May 2023 - December 2023
• Conducted market research across public and private transportation sectors
• Analyzed competitors' go-to-market approaches across different use cases

BioMerieux, St. Louis — Global Product Marketing Intern
June 2022 - August 2022
• Supported go-to-market transition for a new product generation
• Analyzed sales performance and market data to support launch planning

EDUCATION
Florida State University — BS Marketing & Statistics (2020-2024)
GPA: 3.82 | James M. Seneff Honors Program | SAS Certification

SKILLS
Full-cycle sales · Account management · CRM · Market analysis · Product positioning · Excel · SAS
English (native) · French (native) · Spanish (intermediate)`;
}

function buildFinalCover(acceptedChanges, job) {
  let text = `Dear Hiring Team,

I am writing to express my interest in the ${job.title} position at ${job.company}. As a customer-facing commercial professional with hands-on experience supporting autonomous vehicle deployments in airport and industrial environments, I believe I can bring immediate value to your team.

At Stanley Robotics, I serve as the primary commercial interface across the full sales cycle — from discovery and business case development through contract negotiation and post-signature coordination. I co-lead our U.S. market entry efforts and manage the commercial relationship with a major international airport serving over 40 million passengers annually.

My experience at EasyMile deepened my understanding of the AV competitive landscape and go-to-market strategies across different deployment contexts. I am drawn to ${job.company} because of your approach to commercializing autonomous technology and the opportunity to contribute to early-stage deployments.

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
Victor Achard`;

  acceptedChanges.forEach(change => {
    if (change.original && change.suggested) {
      text = text.replace(change.original, change.suggested);
    }
  });

  return text;
}

function buildDocx(text, filename, type, job) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const lines = text.split('\n');
  const children = lines.map((line, i) => {
    if (i === 0) {
      return new Paragraph({
        children: [new TextRun({ text: line, bold: true, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      });
    }
    if (line.startsWith('•')) {
      return new Paragraph({
        children: [new TextRun({ text: line, size: 22 })],
        bullet: { level: 0 },
        spacing: { after: 60 },
      });
    }
    if (line.match(/^[A-Z][A-Z\s&]+$/) && line.length > 2) {
      return new Paragraph({
        children: [new TextRun({ text: line, bold: true, size: 22 })],
        spacing: { before: 200, after: 80 },
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: line, size: 22 })],
      spacing: { after: 60 },
    });
  });

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  Packer.toBlob(doc).then(blob => {
    triggerDownload(blob, filename);
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Load docx.js from CDN
const docxScript = document.createElement('script');
docxScript.src = 'https://unpkg.com/docx@8.5.0/build/index.js';
document.head.appendChild(docxScript);

// ============================================================
// START
// ============================================================
init();
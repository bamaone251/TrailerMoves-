const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3030);
const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_DIR = path.join(__dirname, 'archives');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'yard-board.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS doors (
  door INTEGER PRIMARY KEY,
  trailer TEXT,
  run TEXT,
  status TEXT NOT NULL DEFAULT 'Empty',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL,
  door INTEGER NOT NULL,
  trailer TEXT,
  run TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
`);

// Backward-compatible migration: Out of Service is a separate door flag so
// trailer/run/loading information is preserved when a door is disabled.
const doorColumns = db.prepare('PRAGMA table_info(doors)').all().map(c => c.name);
if (!doorColumns.includes('out_of_service')) {
  db.exec('ALTER TABLE doors ADD COLUMN out_of_service INTEGER NOT NULL DEFAULT 0');
}

const nowIso = () => new Date().toISOString();
const dayKey = (d = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const displayTime = iso => new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', month:'numeric', day:'numeric', year:'2-digit', hour:'numeric', minute:'2-digit' }).format(new Date(iso));

const insertDoor = db.prepare('INSERT OR IGNORE INTO doors (door, trailer, run, status, updated_at) VALUES (?, NULL, NULL, ?, ?)');
for (let door=10; door<=47; door++) insertDoor.run(door, 'Empty', nowIso());

function getBoard() {
  return db.prepare('SELECT door, trailer, run, status, out_of_service, updated_at FROM doors ORDER BY door').all();
}
function getEvents(day = dayKey()) {
  return db.prepare('SELECT * FROM events WHERE day_key=? ORDER BY id DESC').all(day);
}
function logEvent({door,trailer,run,action,status,actor,notes}) {
  db.prepare(`INSERT INTO events(day_key,door,trailer,run,action,status,actor,notes,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(dayKey(), door, trailer || null, run || null, action, status, actor || null, notes || null, nowIso());
}
function setDoor(door, patch) {
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  const next = {
    trailer: patch.trailer !== undefined ? patch.trailer : cur.trailer,
    run: patch.run !== undefined ? patch.run : cur.run,
    status: patch.status !== undefined ? patch.status : cur.status,
    out_of_service: patch.out_of_service !== undefined ? (patch.out_of_service ? 1 : 0) : cur.out_of_service,
  };
  db.prepare('UPDATE doors SET trailer=?, run=?, status=?, out_of_service=?, updated_at=? WHERE door=?').run(next.trailer || null, next.run || null, next.status, next.out_of_service, nowIso(), door);
  return db.prepare('SELECT * FROM doors WHERE door=?').get(door);
}
function broadcast() { io.emit('board:update', { board: getBoard(), events: getEvents() }); }

function validateDoor(door) { return Number.isInteger(door) && door >= 10 && door <= 47; }

app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/manifest.webmanifest', (req,res)=>res.sendFile(path.join(__dirname,'manifest.webmanifest')));

app.get('/api/state', (req,res) => res.json({ board:getBoard(), events:getEvents(), day:dayKey() }));

app.post('/api/doors/:door/place', (req,res) => {
  const door = Number(req.params.door); const trailer = String(req.body.trailer || '').trim(); const actor = String(req.body.actor || 'Yard Driver').trim();
  if (!validateDoor(door) || !trailer) return res.status(400).json({error:'Valid door and trailer number required.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  if (cur.out_of_service) return res.status(409).json({error:'Door is OUT OF SERVICE. Return it to service before placing a trailer.'});
  if (cur.status !== 'Empty') return res.status(409).json({error:'Door is not empty.'});
  const updated = setDoor(door, {trailer, run:null, status:'Available'});
  logEvent({door,trailer,run:null,action:'Trailer placed on door',status:'Available',actor});
  broadcast(); res.json(updated);
});

app.post('/api/doors/:door/loading', (req,res) => {
  const door = Number(req.params.door); const run = String(req.body.run || '').trim(); const actor = String(req.body.actor || 'Load Desk').trim();
  if (!validateDoor(door) || !run) return res.status(400).json({error:'Run number required.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  if (cur.out_of_service) return res.status(409).json({error:'Door is OUT OF SERVICE. Return it to service before starting a load.'});
  if (cur.status !== 'Available') return res.status(409).json({error:'Trailer must be Available before loading starts.'});
  const updated = setDoor(door, {run, status:'Loading'});
  logEvent({door,trailer:cur.trailer,run,action:'Run assigned / loading started',status:'Loading',actor});
  broadcast(); res.json(updated);
});

app.post('/api/doors/:door/complete', (req,res) => {
  const door = Number(req.params.door); const actor = String(req.body.actor || 'Load Desk').trim();
  if (!validateDoor(door)) return res.status(400).json({error:'Invalid door.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  if (cur.status !== 'Loading') return res.status(409).json({error:'Door must be Loading first.'});
  const updated = setDoor(door, {status:'Loading Complete'});
  logEvent({door,trailer:cur.trailer,run:cur.run,action:'Loading completed',status:'Loading Complete',actor});
  broadcast(); res.json(updated);
});

app.post('/api/doors/:door/remove', (req,res) => {
  const door = Number(req.params.door); const disposition = String(req.body.disposition || ''); const actor = String(req.body.actor || 'Yard Driver').trim();
  if (!validateDoor(door) || !['Pooled','Dispatched'].includes(disposition)) return res.status(400).json({error:'Choose Pooled or Dispatched.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  if (cur.status !== 'Loading Complete') return res.status(409).json({error:'Loading must be complete before trailer removal.'});
  logEvent({door,trailer:cur.trailer,run:cur.run,action:`Trailer removed - ${disposition}`,status:disposition,actor});
  const updated = setDoor(door, {trailer:null,run:null,status:'Empty'});
  broadcast(); res.json(updated);
});

app.post('/api/doors/:door/service', (req,res) => {
  const door = Number(req.params.door);
  const outOfService = Boolean(req.body.out_of_service);
  const actor = String(req.body.actor || 'Load Desk').trim();
  const notes = String(req.body.notes || '').trim();
  if (!validateDoor(door)) return res.status(400).json({error:'Invalid door.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  const updated = setDoor(door, {out_of_service: outOfService});
  logEvent({
    door, trailer:cur.trailer, run:cur.run,
    action: outOfService ? 'Door marked OUT OF SERVICE' : 'Door returned to service',
    status: outOfService ? 'Out of Service' : cur.status,
    actor, notes
  });
  broadcast(); res.json(updated);
});

app.post('/api/doors/:door/edit', (req,res) => {
  const door = Number(req.params.door);
  const actor = String(req.body.actor || 'Load Desk').trim();
  let trailer = String(req.body.trailer || '').trim();
  let run = String(req.body.run || '').trim();
  const status = String(req.body.status || '').trim();
  const outOfService = Boolean(req.body.out_of_service);
  const validStatuses = ['Empty','Available','Loading','Loading Complete'];

  if (!validateDoor(door)) return res.status(400).json({error:'Invalid door.'});
  if (!validStatuses.includes(status)) return res.status(400).json({error:'Invalid status.'});

  if (status === 'Empty') { trailer = ''; run = ''; }
  if (status === 'Available') {
    if (!trailer) return res.status(400).json({error:'Available doors require a trailer number.'});
    run = '';
  }
  if ((status === 'Loading' || status === 'Loading Complete') && (!trailer || !run)) {
    return res.status(400).json({error:'Loading and Loading Complete require both a trailer number and run number.'});
  }

  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  const updated = setDoor(door, {
    trailer: trailer || null,
    run: run || null,
    status,
    out_of_service: outOfService
  });

  const before = `Trailer ${cur.trailer || '—'}, Run ${cur.run || '—'}, ${cur.status}${cur.out_of_service ? ', OUT OF SERVICE' : ''}`;
  const after = `Trailer ${updated.trailer || '—'}, Run ${updated.run || '—'}, ${updated.status}${updated.out_of_service ? ', OUT OF SERVICE' : ''}`;
  logEvent({
    door,
    trailer: updated.trailer,
    run: updated.run,
    action: 'Door information manually edited',
    status: updated.out_of_service ? 'Out of Service' : updated.status,
    actor,
    notes: `${before} → ${after}`
  });
  broadcast();
  res.json(updated);
});

app.post('/api/doors/:door/clear', (req,res) => {
  const door = Number(req.params.door); const actor = String(req.body.actor || 'Supervisor').trim();
  if (!validateDoor(door)) return res.status(400).json({error:'Invalid door.'});
  const cur = db.prepare('SELECT * FROM doors WHERE door=?').get(door);
  logEvent({door,trailer:cur.trailer,run:cur.run,action:'Door manually cleared',status:'Empty',actor});
  const updated = setDoor(door, {trailer:null,run:null,status:'Empty'});
  broadcast(); res.json(updated);
});

async function buildExcel(day = dayKey()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Yard Door Board';
  const board = wb.addWorksheet('Current Board');
  board.columns = [
    {header:'Door',key:'door',width:10},{header:'Trailer #',key:'trailer',width:18},{header:'Run #',key:'run',width:15},{header:'Status',key:'status',width:22},{header:'Out of Service',key:'oos',width:16},{header:'Updated',key:'updated',width:23}
  ];
  for (const row of getBoard()) board.addRow({...row, oos:row.out_of_service ? 'YES' : '', updated:displayTime(row.updated_at)});
  board.getRow(1).font = {bold:true};
  const hist = wb.addWorksheet('Daily Activity');
  hist.columns = [
    {header:'Time',key:'time',width:23},{header:'Door',key:'door',width:10},{header:'Trailer #',key:'trailer',width:18},{header:'Run #',key:'run',width:15},{header:'Action',key:'action',width:32},{header:'Status',key:'status',width:22},{header:'Actor',key:'actor',width:18}
  ];
  for (const e of [...getEvents(day)].reverse()) hist.addRow({time:displayTime(e.created_at), ...e});
  hist.getRow(1).font = {bold:true};
  return wb;
}

function renderPdf(stream, day = dayKey(), boardRows = getBoard(), events = getEvents(day)) {
  const doc = new PDFDocument({size:'LETTER', margin:32, layout:'landscape'});
  doc.pipe(stream);
  doc.fontSize(18).text(`DAILY YARD BOARD — ${day}`, {align:'center'});
  doc.moveDown(.5).fontSize(9);
  const x=[32,72,155,230,350,455,570];
  const headers=['Door','Trailer #','Run #','Status','Out of Service','Updated'];
  headers.forEach((h,i)=>doc.font('Helvetica-Bold').text(h,x[i],doc.y,{width:x[i+1]-x[i]-5}));
  doc.moveDown(.7); let y=doc.y;
  for (const r of boardRows) {
    if (y > 520) { doc.addPage({size:'LETTER',layout:'landscape',margin:32}); y=40; }
    doc.font('Helvetica').fontSize(8);
    const vals=[r.door,r.trailer||'',r.run||'',r.status,r.out_of_service?'YES':'',displayTime(r.updated_at)];
    vals.forEach((v,i)=>doc.text(String(v),x[i],y,{width:(x[i+1]||750)-x[i]-5}));
    y += 14;
  }
  doc.addPage({size:'LETTER',layout:'landscape',margin:32});
  doc.font('Helvetica-Bold').fontSize(14).text('Daily Activity');
  doc.moveDown(.5); y=doc.y;
  const hx=[32,130,170,255,330,500,620];
  const hh=['Time','Door','Trailer','Run','Action','Status','Actor'];
  hh.forEach((h,i)=>doc.font('Helvetica-Bold').fontSize(8).text(h,hx[i],y,{width:(hx[i+1]||760)-hx[i]-4})); y+=14;
  for (const e of [...events].reverse()) {
    if (y > 520) { doc.addPage({size:'LETTER',layout:'landscape',margin:32}); y=40; }
    const vals=[displayTime(e.created_at),e.door,e.trailer||'',e.run||'',e.action,e.status,e.actor||''];
    vals.forEach((v,i)=>doc.font('Helvetica').fontSize(7).text(String(v),hx[i],y,{width:(hx[i+1]||760)-hx[i]-4})); y+=13;
  }
  doc.end();
}

app.get('/api/export/excel', async (req,res) => {
  const day=dayKey(); const wb=await buildExcel(day);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="YARD_BOARD_${day}.xlsx"`);
  await wb.xlsx.write(res); res.end();
});
app.get('/api/export/pdf', (req,res) => {
  const day=dayKey();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="YARD_BOARD_${day}.pdf"`);
  renderPdf(res,day);
});

let lastDay = dayKey();
function archiveAndReset(completedDay) {
  const events = getEvents(completedDay);
  const boardSnapshot = getBoard();
  const [y,m,d] = completedDay.split('-');
  const out = path.join(ARCHIVE_DIR, `DAILY_YARD_BOARD_${m}-${d}-${y.slice(2)}.pdf`);
  const stream = fs.createWriteStream(out);
  renderPdf(stream, completedDay, boardSnapshot, events);
  const tx = db.transaction(() => {
    for (let door=10; door<=47; door++) db.prepare('UPDATE doors SET trailer=NULL, run=NULL, status=?, updated_at=? WHERE door=?').run('Empty', nowIso(), door);
  });
  tx();
  broadcast();
  console.log(`Archived ${completedDay} to ${out} and reset board.`);
}
setInterval(() => {
  const today=dayKey();
  if (today !== lastDay) { const completed=lastDay; lastDay=today; archiveAndReset(completed); }
}, 15000);

io.on('connection', socket => socket.emit('board:update', {board:getBoard(), events:getEvents()}));
server.listen(PORT, '0.0.0.0', () => console.log(`Yard Door Board running on port ${PORT}`));

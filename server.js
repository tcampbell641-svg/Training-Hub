import express from 'express';
import pg from 'pg';
import QRCode from 'qrcode';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const APP_NAME = process.env.APP_NAME || 'Mahindra Technician Training Hub';
const INSTRUCTOR_PIN = process.env.INSTRUCTOR_PIN || '2468';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for cloud mode.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function code6(){ return Math.floor(100000 + Math.random()*900000).toString(); }
function certNo(){ return 'MTH-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function layout(title, body, extra='') { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--red:#c4141c;--red2:#9f0f15;--black:#171717;--line:#dedede;--soft:#f5f5f5;--muted:#666;--green:#1f7a3b;--amber:#a55b00}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d;background:#f6f6f6}.top{background:var(--black);color:#fff;padding:18px 24px;border-bottom:5px solid var(--red);display:flex;align-items:center;justify-content:space-between}.top b{font-size:21px}.top span{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ddd}.wrap{max-width:1180px;margin:auto;padding:24px}.card{border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:18px}.home-card{display:block;text-decoration:none;color:#1d1d1d;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;min-height:150px;transition:.15s ease}.home-card:hover{border-color:#bbb;transform:translateY(-1px)}.home-card .icon{font-size:30px;margin-bottom:14px}.home-card .title{font-size:22px;font-weight:800}.home-card .desc{color:var(--muted);margin-top:8px;line-height:1.45}.hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.hero h1{margin:0;font-size:30px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}.btn,button{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;cursor:pointer}.btn:hover,button:hover{background:var(--red2)}.btn.alt{background:#333}.btn.light{background:#eee;color:#222}.btn.light:hover{background:#ddd}.big{font-size:24px;font-weight:800}.muted{color:var(--muted)}.code{font-size:50px;font-weight:900;letter-spacing:6px}.stat{background:var(--soft);padding:16px;border-radius:14px}.stat b{display:block;font-size:28px;margin-top:4px}.stat span{font-size:13px;color:var(--muted);font-weight:700}.stat.green b{color:var(--green)}input,select,textarea{width:100%;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin-top:5px;background:#fff}label{font-weight:650;display:block;margin:12px 0}.q{padding:14px;border:1px solid #ddd;border-radius:10px;margin:12px 0}.q label{font-weight:400;margin:8px 0}.q input[type=radio]{width:auto;margin-right:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#fafafa}.pass{color:#0b6d2f;font-weight:800}.review{color:#a14500;font-weight:800}.danger{color:#a00000}.qr{max-width:300px;width:100%;height:auto}.center{text-align:center}.steps{font-size:18px;line-height:1.6}.pill{display:inline-block;background:#eee;padding:6px 10px;border-radius:99px;font-size:13px;font-weight:800}.pill.open{background:#e8f5ea;color:#1f6f38}.pill.closed{background:#f1f1f1;color:#555}.pill.joined{background:#eef3ff;color:#274d9c}.pill.results{background:#e8f5ea;color:#1f6f38}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.alert{padding:12px;border-radius:9px;background:#fff3cd;border:1px solid #ffe69c}.success{padding:12px;border-radius:9px;background:#e8f5ea;border:1px solid #b9dfc0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0}.join-box{background:#fff;border:2px solid #eee;border-radius:18px;padding:22px}.live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2f9e44;margin-right:7px}.small{font-size:13px}.nowrap{white-space:nowrap}@media(max-width:700px){.wrap{padding:14px}.top{padding:14px 16px}.top span{display:none}.code{font-size:38px}.hero h1{font-size:26px}.home-card{min-height:125px;padding:18px}th,td{padding:9px}.desktop-only{display:none}}@media print{.no-print,.top{display:none!important}.wrap{max-width:none;padding:0}.card{border:0}.report{font-size:12pt}body{background:#fff}}
</style>${extra}</head><body><div class="top"><b>${esc(APP_NAME)}</b><span>Cloud Training System</span></div><div class="wrap">${body}</div></body></html>`; }

const DEFAULT_QUIZ = [
['Before replacing a component during diagnosis, what should the technician do first?',['Clear all codes','Prove the failure','Disconnect the battery','Replace the ECU'],1],
['Approximate resistance of a properly terminated CAN network with power off?',['120 ohms','60 ohms','12 ohms','0 ohms'],1],
['Which tool is used on supported Mahindra systems to communicate with controllers?',['Timing light','GARUDA','Vacuum gauge','Compression tester'],1],
['Diagnosis should begin by understanding and verifying what?',['Customer complaint','Parts price','Warranty claim','Service interval'],0],
['Freeze-frame data shows what?',['Operating conditions when a fault occurred','Technician name','Parts inventory','Warranty expiration'],0],
['CAN High and CAN Low are primarily used for what?',['Controller communication','Starter current','Hydraulic pressure','Fuel return'],0],
['Best diagnostic practice?',['Replace the most common failed part','Verify inputs and outputs and prove the failure','Clear codes and release','Replace related sensors'],1],
['Low battery voltage can cause what?',['Communication and starting problems','Only tire wear','Only hydraulic leaks','Only PTO noise'],0],
['When measuring resistance, the circuit should normally be what?',['De-energized','Powered','At full throttle','Under hydraulic load'],0],
['Live data helps a technician do what?',['See controller inputs and outputs while operating','Program the radio','Check tire pressure','Print an invoice'],0]
];
const DEFAULT_HUNT = [
['Diagnostic Connector','Locate the tractor diagnostic connector and identify the diagnostic tool used here.','GARUDA'],
['Engine ECU','Locate the engine ECU and identify its role.','ECU'],
['CAN Network Check','With power off, enter the expected normal resistance across CAN High and CAN Low.','60'],
['Battery Voltage','Enter a normal fully charged 12 V battery key-off voltage.','12.6'],
['Proof of Failure','Describe the measurement or data that proves the planted fault.','measurement']
];

async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS classes(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, course TEXT NOT NULL,
    instructor TEXT NOT NULL, pass_score INTEGER NOT NULL DEFAULT 80, hours NUMERIC(5,2) NOT NULL DEFAULT 8,
    join_token TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), active BOOLEAN DEFAULT TRUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS students(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL, dealer TEXT NOT NULL, joined_at TIMESTAMPTZ DEFAULT now(), UNIQUE(class_id,name,dealer)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    activity TEXT NOT NULL, score INTEGER NOT NULL, details JSONB DEFAULT '{}'::jsonb, completed_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS skills(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    skill TEXT NOT NULL, signed_off BOOLEAN DEFAULT FALSE, signed_by TEXT, signed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS instructor_notes(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    comments TEXT DEFAULT '', certification_status TEXT DEFAULT 'Pending', certificate_no TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_questions(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    question TEXT NOT NULL, choices JSONB NOT NULL, answer_index INTEGER NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_stations(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    station_name TEXT NOT NULL, task TEXT NOT NULL, expected TEXT NOT NULL
  )`);
}
await init();

app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/', (req,res)=>res.send(layout('Training Hub', `<div class="grid"><div class="card"><div class="big">Instructor</div><p>Create classes, show the QR code, watch results, sign off skills, and print student reports.</p><a class="btn" href="/instructor">Open Instructor Dashboard</a></div><div class="card"><div class="big">Technician</div><p>Scan the class QR code or enter the class code from your instructor.</p><a class="btn alt" href="/join">Join Training</a></div></div>`)));

app.get('/join', (req,res)=>res.send(layout('Join Training', `<div class="card"><div class="big">Join a Training Class</div><form method="get" action="/join-code"><label>6-Digit Class Code<input name="code" inputmode="numeric" maxlength="6" required></label><button>Continue</button></form></div>`)));
app.get('/join-code', async(req,res)=>{
  const code=(req.query.code||'').trim(); const c=await pool.query('SELECT * FROM classes WHERE code=$1 AND active=true',[code]);
  if(!c.rowCount) return res.send(layout('Class Not Found', `<div class="card"><div class="big">Class not found</div><p>Check the class code with your instructor.</p><a class="btn" href="/join">Try Again</a></div>`));
  res.redirect('/c/'+c.rows[0].join_token);
});

app.get('/c/:token', async(req,res)=>{
  const q=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]);
  if(!q.rowCount) return res.status(404).send(layout('Class Closed','<div class="card">This class is not available.</div>'));
  const c=q.rows[0];
  res.send(layout('Join '+c.course, `<div class="card"><span class="pill">Class ${esc(c.code)}</span><div class="big" style="margin-top:10px">${esc(c.course)}</div><p>Instructor: ${esc(c.instructor)}</p><form method="post" action="/c/${esc(c.join_token)}/join"><label>Your Name<input name="name" required autocomplete="name"></label><label>Dealership<input name="dealer" required></label><button>Join Class</button></form></div>`));
});
app.post('/c/:token/join', async(req,res)=>{
  const cq=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]); if(!cq.rowCount) return res.status(404).send('Class closed');
  const c=cq.rows[0], name=(req.body.name||'').trim(), dealer=(req.body.dealer||'').trim(); if(!name||!dealer) return res.status(400).send('Name and dealer required');
  let s=await pool.query('SELECT * FROM students WHERE class_id=$1 AND lower(name)=lower($2) AND lower(dealer)=lower($3)',[c.id,name,dealer]);
  if(!s.rowCount) s=await pool.query('INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *',[c.id,name,dealer]);
  const student=s.rows[0];
  const skills=['Verify customer complaint','Battery / power supply check','CAN network resistance check','Use GARUDA or approved diagnostic tool','Verify inputs and outputs','Document proof of failure'];
  for(const sk of skills) await pool.query('INSERT INTO skills(student_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[student.id,sk]);
  res.redirect(`/student/${student.id}?token=${encodeURIComponent(c.join_token)}`);
});

async function studentContext(id,token){
  const q=await pool.query(`SELECT s.*,c.course,c.code,c.instructor,c.join_token,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.join_token=$2`,[id,token]); return q.rows[0];
}
app.get('/student/:id', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const r=await pool.query('SELECT activity,score FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]);
  const done=new Set(r.rows.map(x=>x.activity));
  res.send(layout('Technician Home', `<div class="card"><span class="pill">Class ${esc(s.code)}</span><div class="big">Welcome, ${esc(s.name)}</div><p>${esc(s.course)} · ${esc(s.dealer)}</p></div><div class="grid"><div class="card"><div class="big">Module Quiz</div><p>10-question knowledge test.</p>${done.has('Module Quiz')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a>`}</div><div class="card"><div class="big">Scavenger Hunt</div><p>Complete the hands-on stations provided by your instructor.</p>${done.has('Scavenger Hunt')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">Start Hunt</a>`}</div><div class="card"><div class="big">Failure Simulation</div><p>Work through a crank/no-start diagnostic scenario.</p>${done.has('Failure Simulation')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Start Simulation</a>`}</div></div>`));
});

app.get('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  if(!q.rowCount){ for(const x of DEFAULT_QUIZ) await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index) VALUES($1,$2,$3,$4)',[s.class_id,x[0],JSON.stringify(x[1]),x[2]]); q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]); }
  const ids=q.rows.map(x=>x.id).join(',');
  const qs=q.rows.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.question)}</b>${x.choices.map((c,j)=>`<label><input type="radio" name="q_${x.id}" value="${j}" required>${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div>`).join('');
  res.send(layout('Quiz', `<div class="card"><div class="big">${esc(s.course)} — Module Quiz</div><form method="post" action="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="ids" value="${ids}">${qs}<button>Submit Quiz</button></form></div>`));
});
app.post('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const ids=(req.body.ids||'').split(',').map(Number).filter(Boolean); if(!ids.length) return res.status(400).send('No questions');
  const q=await pool.query('SELECT * FROM quiz_questions WHERE id=ANY($1::int[])',[ids]); let correct=0; const missed=[];
  for(const x of q.rows){ const a=Number(req.body['q_'+x.id]); if(a===x.answer_index) correct++; else missed.push(x.question); }
  const score=Math.round(correct/q.rowCount*100); await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Module Quiz',$2,$3)",[s.id,score,JSON.stringify({correct,total:q.rowCount,missed})]);
  res.send(layout('Quiz Complete', `<div class="card center"><div class="big">Quiz Complete</div><div class="code">${score}%</div><p>${correct} of ${q.rowCount} correct</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/hunt', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[s.class_id]);
  if(!q.rowCount){ for(const x of DEFAULT_HUNT) await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[s.class_id,...x]); q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[s.class_id]); }
  const stations=q.rows.map((x,i)=>`<div class="q"><b>Station ${i+1}: ${esc(x.station_name)}</b><p>${esc(x.task)}</p><label>Your Answer<input name="s_${x.id}" required></label></div>`).join('');
  res.send(layout('Scavenger Hunt', `<div class="card"><div class="big">Scavenger Hunt</div><form method="post" action="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">${stations}<button>Finish Hunt</button></form></div>`));
});
app.post('/student/:id/hunt', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1',[s.class_id]); let correct=0; const answers={};
  q.rows.forEach(x=>{ const a=(req.body['s_'+x.id]||'').trim(); answers[x.station_name]=a; if(a.toLowerCase().includes(x.expected.toLowerCase()) || x.expected.toLowerCase().includes(a.toLowerCase())) correct++; });
  const score=Math.round(correct/q.rowCount*100); await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Scavenger Hunt',$2,$3)",[s.id,score,JSON.stringify({answers})]);
  res.send(layout('Hunt Complete', `<div class="card center"><div class="big">Scavenger Hunt Complete</div><div class="code">${score}%</div><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  res.send(layout('Failure Simulation', `<div class="card"><div class="big">Failure Simulation — Crank / No Start</div><div class="alert"><b>Complaint:</b> Tractor cranks normally but will not start. No smoke is seen from the exhaust.</div><form method="post" action="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}"><label>What should you verify first?<select name="first" required><option value="">Choose</option><option value="complaint">Verify the complaint and basic conditions</option><option value="injector">Replace injectors</option><option value="ecu">Replace ECU</option></select></label><label>No smoke during cranking most strongly suggests investigating:<select name="area" required><option value="">Choose</option><option value="fuel">Fuel delivery / injection command</option><option value="tires">Tire pressure</option><option value="pto">PTO clutch</option></select></label><label>Describe a measurement or data point you would use to prove the failure<textarea name="proof" rows="4" required></textarea></label><button>Complete Simulation</button></form></div>`));
});
app.post('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session'); let score=0;
  if(req.body.first==='complaint') score+=35; if(req.body.area==='fuel') score+=35; if((req.body.proof||'').trim().length>=10) score+=30;
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Failure Simulation',$2,$3)",[s.id,score,JSON.stringify({proof:req.body.proof||''})]);
  res.send(layout('Simulation Complete', `<div class="card center"><div class="big">Simulation Complete</div><div class="code">${score}%</div><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function pinForm(message=''){ return layout('Instructor Login', `<div class="card" style="max-width:500px;margin:auto"><div class="big">Instructor Access</div>${message?`<div class="alert">${esc(message)}</div>`:''}<form method="post" action="/instructor/login"><label>Instructor PIN<input type="password" name="pin" inputmode="numeric" required autofocus></label><button>Open Dashboard</button></form></div>`); }
app.get('/instructor',(req,res)=>res.send(pinForm()));
app.post('/instructor/login',(req,res)=>{ if(req.body.pin!==INSTRUCTOR_PIN) return res.send(pinForm('Incorrect PIN.')); res.redirect('/instructor/dashboard?pin='+encodeURIComponent(INSTRUCTOR_PIN)); });
function auth(req,res,next){ if((req.query.pin||req.body.pin)!==INSTRUCTOR_PIN) return res.status(403).send(pinForm('Instructor login required.')); next(); }

app.get('/instructor/dashboard',auth,async(req,res)=>{
  const classes=await pool.query(`SELECT c.*,count(distinct s.id)::int students,count(r.id)::int results FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN results r ON r.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 30`);
  const rows=classes.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td><span class="pill">${esc(c.code)}</span></td><td>${c.students}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td class="nowrap"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Class</a></td></tr>`).join('');
  const active=classes.rows.filter(c=>c.active).length; const students=classes.rows.reduce((a,c)=>a+c.students,0);
  res.send(layout('Instructor Dashboard', `<div class="hero"><div><div class="eyebrow">Instructor Home</div><h1>What do you want to do?</h1><p class="muted">Start classes, build activities, watch technicians, and print training records.</p></div></div><div class="home-grid"><a class="home-card" href="/instructor/new?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">▶</div><div class="title">Start Class</div><div class="desc">Choose a course and instantly create the technician QR code.</div></a><a class="home-card" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🧰</div><div class="title">Build Test / Hunt</div><div class="desc">Add quiz questions and scavenger-hunt stations to a class.</div></a><a class="home-card" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">👨‍🔧</div><div class="title">Student Records</div><div class="desc">Search technicians, open their records, and review scores.</div></a><a class="home-card" href="/instructor/reports?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🖨️</div><div class="title">Print Reports</div><div class="desc">Open printable individual training reports and certificates.</div></a><a class="home-card" href="/instructor/settings?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">⚙️</div><div class="title">Settings</div><div class="desc">See instructor and class settings in one simple place.</div></a></div><div class="grid" style="margin-top:18px"><div class="stat"><span>Open Classes</span><b>${active}</b></div><div class="stat"><span>Recent Students</span><b>${students}</b></div><div class="stat green"><span>Cloud Status</span><b>Online</b></div></div><div class="card"><div class="section-title"><h2>Recent Classes</h2><span class="muted small">Technicians can join from cellular or any internet connection.</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Class</th><th>Code</th><th>Students</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5">No classes yet. Click Start Class above.</td></tr>'}</tbody></table></div></div>`));
});

app.get('/instructor/build-select',auth,async(req,res)=>{
  const q=await pool.query('SELECT id,course,title,code,active FROM classes ORDER BY created_at DESC LIMIT 40');
  const rows=q.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td><a class="btn" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Training</a></td></tr>`).join('');
  res.send(layout('Build Test / Hunt', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Build Test / Scavenger Hunt</div><p class="muted">Choose the class you want to edit.</p><div style="overflow:auto"><table><tr><th>Course</th><th>Code</th><th>Status</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet. Start a class first.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/reports',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`);
  const rows=q.rows.map(s=>`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td>${esc(s.course)}</td><td>${s.activities}</td><td>${s.avg_score}%</td><td class="nowrap"><a class="btn" target="_blank" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Report</a> <a class="btn light" target="_blank" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Certificate</a></td></tr>`).join('');
  res.send(layout('Print Reports', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Print Student Reports</div><p class="muted">Choose a technician to open their printable training record or certificate.</p><div style="overflow:auto"><table><tr><th>Technician</th><th>Course</th><th>Activities</th><th>Average</th><th></th></tr>${rows||'<tr><td colspan="5">No student records yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/settings',auth,async(req,res)=>{
  const q=await pool.query('SELECT course,title,pass_score,hours,instructor,code FROM classes ORDER BY created_at DESC LIMIT 1'); const c=q.rows[0];
  res.send(layout('Settings', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Settings</div><p class="muted">The instructor PIN is securely stored in Render. Passing score and course hours are chosen when each class is created.</p>${c?`<div class="grid"><div class="stat"><span>Last Course</span><b style="font-size:20px">${esc(c.course)}</b></div><div class="stat"><span>Passing Score</span><b>${c.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${c.hours}</b></div></div><p class="small muted">Most recent class: ${esc(c.title)} · Instructor ${esc(c.instructor)} · Code ${esc(c.code)}</p>`:'<p>No classes have been created yet.</p>'}<div class="alert" style="margin-top:18px"><b>Instructor PIN:</b> To change it, update <code>INSTRUCTOR_PIN</code> in Render → Training-Hub → Environment.</div></div>`));
});
app.get('/instructor/new',auth,(req,res)=>res.send(layout('Start Class', `<div class="card"><div class="big">Start a Training Class</div><form method="post" action="/instructor/new"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Class Title<input name="title" placeholder="Example: September Dealer Training" required></label><label>Course<select name="course"><option>Fifty One Hundred Refresh</option><option>Six Thousand Series</option><option>OJA Series</option><option>SU Series</option><option>ROXOR</option><option>Electrical Fundamentals</option><option>CAN / J1939 Diagnostics</option><option>FES / GARUDA Diagnostics</option></select></label><label>Instructor Name<input name="instructor" required></label><div class="grid"><label>Passing Score<input type="number" name="pass_score" min="1" max="100" value="80"></label><label>Course Hours<input type="number" step="0.5" name="hours" min="0" value="8"></label></div><button>Create Class & QR Code</button></form></div>`)));
app.post('/instructor/new',auth,async(req,res)=>{
  let code; for(let i=0;i<8;i++){ code=code6(); const e=await pool.query('SELECT 1 FROM classes WHERE code=$1',[code]); if(!e.rowCount) break; }
  const token=crypto.randomBytes(16).toString('hex');
  const q=await pool.query('INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[code,req.body.title,req.body.course,req.body.instructor,Number(req.body.pass_score)||80,Number(req.body.hours)||0,token]);
  res.redirect(`/instructor/class/${q.rows[0].id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/class/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const students=await pool.query(`SELECT s.*,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities FROM students s LEFT JOIN results r ON r.student_id=s.id WHERE s.class_id=$1 GROUP BY s.id ORDER BY s.name`,[c.id]);
  const origin=`${req.protocol}://${req.get('host')}`, joinUrl=`${origin}/c/${c.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:360,margin:1});
  const completed=students.rows.filter(s=>s.activities>0).length; const classAvg=completed?Math.round(students.rows.filter(s=>s.activities>0).reduce((a,s)=>a+s.avg_score,0)/completed):0;
  const rows=students.rows.map(s=>`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td><span class="pill ${s.activities?'results':'joined'}">${s.activities?'Results Available':'Joined'}</span></td><td>${s.activities}</td><td>${s.activities?s.avg_score+'%':'—'}</td><td><a class="btn light" href="/instructor/student/${s.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">View Student</a></td></tr>`).join('');
  res.send(layout('Live Class', `<meta http-equiv="refresh" content="10"><div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a><a class="btn alt" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Test / Hunt</a></div><div class="hero" style="margin-top:14px"><div><div class="eyebrow"><span class="live-dot"></span>Live Class</div><h1>${esc(c.course)}</h1><p class="muted">${esc(c.title)} · Instructor ${esc(c.instructor)}</p></div><span class="pill ${c.active?'open':'closed'}">${c.active?'CLASS OPEN':'CLASS CLOSED'}</span></div><div class="grid" style="margin-top:14px"><div class="join-box center"><div class="eyebrow">Technician Join Code</div><div class="code">${esc(c.code)}</div><img class="qr" src="${qr}" alt="Technician class QR code"><p class="muted small">Technicians scan this QR code with any phone. Wi-Fi or cellular both work.</p><form class="no-print" method="post" action="/instructor/class/${c.id}/toggle"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="${c.active?'btn alt':'btn'}">${c.active?'Close Class':'Reopen Class'}</button></form></div><div><div class="grid"><div class="stat"><span>Students Joined</span><b>${students.rowCount}</b></div><div class="stat"><span>With Results</span><b>${completed}</b></div><div class="stat"><span>Class Average</span><b>${completed?classAvg+'%':'—'}</b></div></div><div class="card"><div class="section-title"><h2>Live Student Monitor</h2><span class="muted small">Refreshes every 10 seconds</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Technician</th><th>Status</th><th>Activities</th><th>Average</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5">Waiting for technicians to join...</td></tr>'}</tbody></table></div></div></div></div>`));
});
app.post('/instructor/class/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE classes SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/class/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/builder/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const qs=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id]); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[c.id]);
  res.send(layout('Training Builder', `<div class="toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a></div><div class="grid"><div class="card"><div class="big">Add Quiz Question</div><form method="post" action="/instructor/builder/${c.id}/question"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><button>Add Question</button></form><p>${qs.rowCount} custom/default question(s) currently saved.</p></div><div class="card"><div class="big">Add Scavenger Station</div><form method="post" action="/instructor/builder/${c.id}/station"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Station Name<input name="name" required></label><label>Technician Task<textarea name="task" required></textarea></label><label>Expected Answer / Verification<input name="expected" required></label><button>Add Station</button></form><p>${hs.rowCount} station(s) currently saved.</p></div></div>`));
});
app.post('/instructor/builder/:id/question',auth,async(req,res)=>{ await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index) VALUES($1,$2,$3,$4)',[req.params.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer)]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station',auth,async(req,res)=>{ await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[req.params.id,req.body.name,req.body.task,req.body.expected]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/student/:id',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0; const skillRows=skills.rows.map(x=>`<label><input style="width:auto" type="checkbox" name="skill_${x.id}" ${x.signed_off?'checked':''}> ${esc(x.skill)}</label>`).join('');
  const resultRows=results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleString()}</td></tr>`).join('');
  res.send(layout('Student Record', `<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${s.class_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Printable Report</a><a class="btn alt" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Certificate</a></div><div class="card"><div class="big">${esc(s.name)}</div><p>${esc(s.dealer)} · ${esc(s.course)} · Class ${esc(s.code)}</p><div class="grid"><div class="stat"><span>Overall Average</span><b>${avg}%</b></div><div class="stat"><span>Passing Score</span><b>${s.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${s.hours}</b></div></div></div><div class="card"><div class="big">Activity Results</div><table><tr><th>Activity</th><th>Score</th><th>Completed</th></tr>${resultRows||'<tr><td colspan="3">No completed activities yet.</td></tr>'}</table></div><div class="card"><div class="big">Instructor Skills Signoff</div><form method="post" action="/instructor/student/${s.id}/save"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}">${skillRows}<label>Instructor Comments<textarea name="comments" rows="5">${esc(notes.comments||'')}</textarea></label><label>Certification Status<select name="status"><option ${notes.certification_status==='Pending'?'selected':''}>Pending</option><option ${notes.certification_status==='Certified'?'selected':''}>Certified</option><option ${notes.certification_status==='Not Yet Certified'?'selected':''}>Not Yet Certified</option></select></label><button>Save Student Record</button></form></div>`));
});
app.post('/instructor/student/:id/save',auth,async(req,res)=>{
  const skills=await pool.query('SELECT id FROM skills WHERE student_id=$1',[req.params.id]); for(const x of skills.rows){ const on=!!req.body['skill_'+x.id]; await pool.query('UPDATE skills SET signed_off=$1,signed_by=$2,signed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$3',[on,'Instructor',x.id]); }
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[req.params.id]); const cert=(existing.rows[0]?.certificate_no)||certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,comments,certification_status,certificate_no) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET comments=excluded.comments,certification_status=excluded.certification_status,certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[req.params.id,req.body.comments||'',req.body.status||'Pending',cert]);
  res.redirect(`/instructor/student/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/student/:id/report',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{}; const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0;
  res.send(layout('Student Report', `<div class="report"><div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="center"><h1>Mahindra Technician Training Record</h1><p>${esc(s.course)}</p></div><div class="card"><table><tr><th>Technician</th><td>${esc(s.name)}</td><th>Dealer</th><td>${esc(s.dealer)}</td></tr><tr><th>Instructor</th><td>${esc(s.instructor)}</td><th>Class Code</th><td>${esc(s.code)}</td></tr><tr><th>Course Hours</th><td>${s.hours}</td><th>Overall Average</th><td><b>${avg}%</b></td></tr><tr><th>Passing Score</th><td>${s.pass_score}%</td><th>Status</th><td><b>${esc(notes.certification_status|| (avg>=s.pass_score?'PASS':'REVIEW'))}</b></td></tr><tr><th>Certificate No.</th><td colspan="3">${esc(notes.certificate_no||'Pending')}</td></tr></table></div><div class="card"><h2>Activity Results</h2><table><tr><th>Activity</th><th>Score</th><th>Date</th></tr>${results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleDateString()}</td></tr>`).join('')}</table></div><div class="card"><h2>Practical Skills</h2>${skills.rows.map(x=>`<p>☐ ${x.signed_off?'✓ ':''}${esc(x.skill)} ${x.signed_off?`— Verified by ${esc(x.signed_by||'Instructor')}`:''}</p>`).join('')}</div><div class="card"><h2>Instructor Comments</h2><p>${esc(notes.comments||'')}</p><div style="margin-top:50px;display:flex;gap:60px"><div style="flex:1;border-top:1px solid #000;padding-top:5px">Technician Signature</div><div style="flex:1;border-top:1px solid #000;padding-top:5px">Instructor Signature</div></div></div></div>`, `<script>window.addEventListener('load',()=>{});</script>`));
});
app.get('/instructor/student/:id/certificate',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found'); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  res.send(layout('Certificate', `<div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div style="border:10px double #b5121b;padding:50px;text-align:center;min-height:650px"><h1 style="font-size:42px;margin-top:20px">Certificate of Completion</h1><p style="font-size:22px">This certifies that</p><div style="font-size:38px;font-weight:800;margin:35px">${esc(s.name)}</div><p style="font-size:22px">of ${esc(s.dealer)}</p><p style="font-size:20px;margin-top:35px">has completed</p><div style="font-size:30px;font-weight:800">${esc(s.course)}</div><p>${s.hours} training hours</p><p style="margin-top:40px">Certificate: <b>${esc(notes.certificate_no||'Pending Instructor Approval')}</b></p><div style="margin:70px auto 0;max-width:420px;border-top:1px solid #000;padding-top:8px">${esc(s.instructor)} — Instructor</div></div>`, `<style>@page{size:landscape;margin:.4in}</style>`));
});
app.get('/instructor/history',auth,async(req,res)=>{
  const term=(req.query.q||'').trim(); const params=[]; let where=''; if(term){params.push('%'+term+'%'); where='WHERE s.name ILIKE $1 OR s.dealer ILIKE $1 OR c.course ILIKE $1';}
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id ${where} GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`,params);
  res.send(layout('Student Records', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Dashboard</a></div><div class="card"><div class="big">Student Records</div><form method="get"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Search technician, dealer, or course<input name="q" value="${esc(term)}"></label><button>Search</button></form><table><tr><th>Technician</th><th>Dealer</th><th>Course</th><th>Average</th><th></th></tr>${q.rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer)}</td><td>${esc(x.course)}</td><td>${x.avg_score}%</td><td><a class="btn light" href="/instructor/student/${x.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open</a></td></tr>`).join('')}</table></div>`));
});

app.listen(port,'0.0.0.0',()=>console.log(`${APP_NAME} running on port ${port}`));

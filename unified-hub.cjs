'use strict';
// Shared training-class access. Existing class/program IDs remain independent.
module.exports=function registerUnifiedHub(deps){
 const {app,auth,pool,esc,layout,allowedCourseSet,courseAllowedForSession,isEditorRole,companyProgram,programReportingData,programTree,orderedActiveProgramModules,programCompetition,QRCode,certificateIdentity,certificateMarkup,certNo,formatCertDate}=deps;
 const kinds=new Set(['class','program']);
 const key=(kind,id)=>`${kind}:${Number(id)}`;
 async function directory(account){
  const [live,programs,allowed]=await Promise.all([
   pool.query(`SELECT c.*,count(DISTINCT s.id)::int students FROM classes c LEFT JOIN students s ON s.class_id=c.id WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,[account.company_id]),
   pool.query(`SELECT p.*,count(DISTINCT s.id)::int students FROM training_programs p LEFT JOIN program_students s ON s.program_id=p.id WHERE p.company_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,[account.company_id]),allowedCourseSet(account)
  ]);
  return [...live.rows.map(c=>({...c,kind:'class',key:key('class',c.id),name:c.title,course:c.course})),...programs.rows.map(p=>({...p,kind:'program',key:key('program',p.id),name:p.title,course:p.title,code:p.join_code}))].filter(x=>!allowed||allowed.has(x.course)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 }
 const link=(x,action='overview')=>`/instructor/training/${x.kind}/${x.id}${action==='overview'?'':'/'+action}`;
 function nav(x){return `<div class="toolbar no-print"><a class="btn light" href="/instructor/classes">All Classes</a>${[['overview','Class Overview'],['activities','Activities'],['roster','Students'],['leaderboard','Live Progress'],['performance','Performance & Feedback'],['feedback','Training Feedback'],['prepost','Pre/Post'],['reports','Reports & Certificates']].map(([a,t])=>`<a class="btn light" href="${link(x,a)}">${t}</a>`).join('')}</div>`;}
 async function resolve(req,res){
  const kind=req.params.kind,id=Number(req.params.id);if(!kinds.has(kind)||!Number.isSafeInteger(id)||id<1){res.status(404).send('Class not found');return null;}
  const r=kind==='program'?await companyProgram(id,req.account.company_id):(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[id,req.account.company_id])).rows[0];
  if(!r){res.status(404).send('Class not found');return null;}
  const course=kind==='program'?r.title:r.course;
  if(!await courseAllowedForSession(req.account,course,req.method!=='GET')){res.status(403).send('Class access required');return null;}
  return {...r,kind,key:key(kind,id),course,code:kind==='program'?r.join_code:r.code};
 }
 async function picker(account,mode){
  const rows=await directory(account);
  return `<div class="card"><h2>Choose a Class</h2><p>Live classes and classes with modules are available here.</p><div class="grid">${rows.map(x=>`<a class="home-card" href="${link(x,mode)}"><b>${esc(x.title)}</b><p>${esc(x.course)}</p><span class="pill">${x.kind==='program'?'Class with Modules':'Live Class'}</span><p>${esc(x.code)} · ${esc(x.instructor||'Unassigned')} · ${x.students} students</p></a>`).join('')||'<p>No classes available.</p>'}</div></div>`;
 }
 app.get('/instructor/classes',auth,async(req,res)=>{
  const rows=await directory(req.account),term=String(req.query.q||'').trim().toLowerCase(),kind=String(req.query.kind||'');
  const visible=rows.filter(x=>(!kind||x.kind===kind)&&(!term||[x.title,x.course,x.code,x.instructor].some(v=>String(v||'').toLowerCase().includes(term))));
  res.send(layout('Classes',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">Instructor Home</a>${isEditorRole(req.account.role)?'<a class="btn" href="/instructor/new">Start Live Class</a><a class="btn" href="/instructor/programs">Create Class with Modules</a>':''}<a class="btn light" href="/instructor/history">Student Records</a></div><h1>Classes</h1><form method="get" class="card"><label>Search<input name="q" value="${esc(req.query.q||'')}"></label><label>Format<select name="kind"><option value="">All Classes</option><option value="class" ${kind==='class'?'selected':''}>Live Class</option><option value="program" ${kind==='program'?'selected':''}>Class with Modules</option></select></label><button>Apply</button></form><div class="grid"><div class="stat"><span>CLASSES</span><b>${visible.length}</b></div><div class="stat"><span>OPEN</span><b>${visible.filter(x=>x.active).length}</b></div><div class="stat"><span>ENROLLMENTS</span><b>${visible.reduce((n,x)=>n+Number(x.students),0)}</b></div></div><div class="grid">${visible.map(x=>`<div class="card"><span class="pill">${x.kind==='program'?'Class with Modules':'Live Class'}</span><h2>${esc(x.title)}</h2><p>${esc(x.course)} · ${esc(x.code)}</p><p>${esc(x.instructor||'Unassigned')} · ${x.students} students · ${x.active?'Open':'Closed / Hidden'}</p><a class="btn" href="${link(x)}">Open Class</a></div>`).join('')||'<div class="card">No classes match.</div>'}</div>`));
 });
 app.get('/instructor/training/:kind/:id/:action',auth,async(req,res)=>{
  const x=await resolve(req,res);if(!x)return;
  const a=req.params.action;
  const routes=x.kind==='program'?{performance:`/instructor/programs/${x.id}/performance`,feedback:`/instructor/programs/${x.id}/performance#training-feedback`,prepost:`/instructor/programs/${x.id}/prepost`,leaderboard:`/instructor/programs/${x.id}/leaderboard`,reports:`/instructor/programs/${x.id}/performance`,builder:`/instructor/programs/${x.id}`}:{performance:`/instructor/performance/class/${x.id}`,feedback:`/instructor/class/${x.id}/feedback`,prepost:`/instructor/class/${x.id}/prepost`,leaderboard:`/instructor/class/${x.id}`,reports:`/instructor/training/class/${x.id}/roster`,builder:`/instructor/builder/${x.id}`};
  if(a==='activities'){
   let content;
   if(x.kind==='program'){
    const tree=await programTree(x.id),modules=orderedActiveProgramModules(tree);
    content=modules.map(m=>`<div class="card"><h3>${esc(m.title)}</h3><p>${esc(m.activity_type||'Training')}</p><a class="btn" href="/instructor/programs/${x.id}/module/${m.id}/content">Open Module Activities</a></div>`).join('')||'<p>Add modules in the class builder.</p>';
   }else content=[['Tests',`/instructor/builder/${x.id}`],['Scavenger Hunt',`/instructor/hunt/${x.id}`],['Simulation Library','/instructor/simulations'],['Interactive Videos',`/instructor/videos/${x.id}`],['Master Challenge','/instructor/master-challenges']].map(([t,u])=>`<a class="home-card" href="${u}">${t}</a>`).join('');
   res.send(layout('Class Activities',`${nav(x)}<h1>${esc(x.title)} · Activities</h1><div class="grid">${content}</div><div class="toolbar"><a class="btn light" href="/instructor/simulations">Central Simulation Library</a></div>`));return;
  }
  if(a==='roster'||(a==='reports'&&x.kind==='program')){
   const students=x.kind==='program'?(await programReportingData(req.account.company_id,x.id))[0].students:(await pool.query('SELECT * FROM students WHERE class_id=$1 ORDER BY name,id',[x.id])).rows;
   const rows=students.map(s=>{const u=`/instructor/${x.kind==='program'?'program-student':'student'}/${s.id}`;return `<tr><td>${esc(s.name)}</td><td>${esc(s.dealer||'')}</td><td><a class="btn light" href="${u}">Student Record</a> <a class="btn light" href="${u}/report">Print Report</a> <a class="btn light" href="${u}/certificate">Certificate</a>${x.kind==='program'?` <a class="btn light" href="${u}/answers">Pre/Post Answers</a>`:''}</td></tr>`;}).join('');
   res.send(layout('Class Students',`${nav(x)}<h1>${esc(x.title)} · Students & Reports</h1><table><tr><th>Student</th><th>Dealer / Location</th><th>Records</th></tr>${rows||'<tr><td colspan="3">Waiting for students to join.</td></tr>'}</table>`));return;
  }
  if(routes[a])return res.redirect(routes[a]);res.status(404).send('Class action not found');
 });
 app.get('/instructor/training/:kind/:id',auth,async(req,res)=>{
  const x=await resolve(req,res);if(!x)return;
  const joinPath=x.kind==='program'?`/program/join/${x.join_token}`:`/c/${x.join_token}`;
  const joinUrl=`${req.protocol}://${req.get('host')}${joinPath}`,qr=await QRCode.toDataURL(joinUrl,{width:300,margin:2});
  let details='';
  if(x.kind==='program'){
   const d=(await programReportingData(req.account.company_id,x.id))[0],comp=await programCompetition(x,'all');
   details=`<div class="grid"><div class="stat"><span>STUDENTS</span><b>${d.students.length}</b></div><div class="stat"><span>MODULES</span><b>${d.modules.length}</b></div><div class="stat"><span>FEEDBACK RESPONSES</span><b>${d.feedback.length}</b></div></div><div class="card"><h2>Live Class Progress</h2><table><tr><th>Student</th><th>Progress</th><th>Activities Complete</th><th>Points</th></tr>${comp.rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.progress}%</td><td>${r.completed}/${comp.modules.length}</td><td>${r.points}</td></tr>`).join('')||'<tr><td colspan="4">Waiting for students.</td></tr>'}</table><a class="btn" href="${link(x,'leaderboard')}">Open Live Leaderboard</a></div>`;
  }
  res.send(layout('Class Overview',`${nav(x)}<h1>${esc(x.title)}</h1><p>${esc(x.course)} · ${esc(x.instructor||'Unassigned')} · ${x.active?'Open':'Closed / Hidden'}</p><div class="card"><h2>Student Join</h2><b>${esc(x.code)}</b><p><a href="${esc(joinUrl)}">${esc(joinUrl)}</a></p><img class="qr" src="${qr}" alt="Student join QR"></div>${details}<div class="toolbar"><a class="btn" href="${x.kind==='program'?`/instructor/programs/${x.id}`:`/instructor/class/${x.id}`}">Class Builder & Settings</a></div>`));
 });
 app.get('/instructor/program-student/:id/certificate',auth,async(req,res)=>{
  const st=(await pool.query(`SELECT ps.*,p.company_id,p.title course,p.instructor,p.created_at FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND p.company_id=$2`,[req.params.id,req.account.company_id])).rows[0];
  if(!st)return res.status(404).send('Student not found');if(!await courseAllowedForSession(req.account,st.course,false))return res.status(403).send('Class access required');
  const d=(await programReportingData(req.account.company_id,st.program_id))[0],tree=await programTree(st.program_id),required=orderedActiveProgramModules(tree).filter(m=>m.required);
  const done=new Set(d.progress.filter(r=>Number(r.student_id)===Number(st.id)).map(r=>Number(r.module_id)));
  if(!required.length||required.some(m=>!done.has(Number(m.id))))return res.send(layout('Certificate Pending',`<div class="card"><h1>Certificate Pending</h1><p>Complete all required active modules before issuing a certificate.</p><a class="btn" href="/instructor/program-student/${st.id}">Student Record</a></div>`));
  const number=certNo();
  await pool.query(`INSERT INTO program_certificates(student_id,certificate_no) VALUES($1,$2) ON CONFLICT(student_id) DO NOTHING`,[st.id,number]);
  const saved=(await pool.query('SELECT * FROM program_certificates WHERE student_id=$1',[st.id])).rows[0];
  const identity=await certificateIdentity(st),view=certificateMarkup(st,saved.certificate_no,formatCertDate(st.joined_at),formatCertDate(saved.issued_at),`/instructor/program-student/${st.id}`,identity);
  res.send(layout('Certificate',view.body,view.css));
 });
 async function studentDetails(st){
  const d=(await programReportingData(st.company_id,st.program_id))[0],f=d.feedback.find(x=>Number(x.student_id)===Number(st.id));
  const competition=await programCompetition({id:st.program_id,company_id:st.company_id},'all'),r=competition.rows.find(x=>Number(x.id)===Number(st.id));
  const progress=`<div class="card"><h2>All Activity Progress</h2><table><tr><th>Activity</th><th>Progress</th><th>Recorded Result</th></tr>${(r?.cells||[]).map(c=>`<tr><td>${esc(c.module.title)}</td><td>${Math.round(c.completion)}%</td><td>${esc(c.label)}</td></tr>`).join('')||'<tr><td colspan="3">No recorded progress.</td></tr>'}</table><p class="small muted">Linked tests, hunts and simulations use their recorded results. Other modules use saved completion.</p></div>`;
  const feedback=`<div class="card"><h2>Training Feedback</h2>${f?`<p>Overall: ${f.overall}/5 · Instructor: ${f.instructor}/5 · Usefulness: ${f.usefulness}/5 · Hands-On: ${f.hands_on}/5 · Program Duration: ${f.difficulty}/5</p>${[['most_helpful','What did you like most about this training program?'],['improve','What improvements to the content or modules would you like to see?'],['comments','Additional Comments']].map(([k,t])=>`<p style="white-space:pre-wrap"><b>${esc(t)}</b><br>${esc(f[k]||'—')}</p>`).join('')}<p class="small muted">Submitted: ${esc(new Date(f.submitted_at).toLocaleString())}</p>`:'<p>No feedback submitted yet.</p>'}</div>`;
  return progress+feedback;
 }
 return {directory,picker,link,nav,studentDetails};
};

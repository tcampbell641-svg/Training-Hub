'use strict';
module.exports=function sharedTests({pool,allowedCourseSet,esc}){
 async function catalog(account){
  const [q,allowed]=await Promise.all([pool.query(`SELECT p.id program_id,p.title program_title,p.active program_active,p.join_code,
    sec.title section_title,sec.active section_active,m.id module_id,m.title module_title,m.active module_active,
    l.test_mode,l.time_limit_minutes,b.id bank_id,b.title bank_title,b.active bank_active,
    (SELECT count(*)::int FROM program_test_questions pq WHERE pq.bank_id=b.id) question_count,
    (SELECT count(*)::int FROM program_test_attempts a JOIN program_students ps ON ps.id=a.student_id AND ps.program_id=p.id WHERE a.module_id=m.id AND a.status='completed') completed_attempts
   FROM training_programs p JOIN program_sections sec ON sec.program_id=p.id
   JOIN program_modules m ON m.section_id=sec.id JOIN program_module_test_links l ON l.module_id=m.id
   JOIN program_test_banks b ON b.id=l.bank_id AND b.program_id=p.id AND b.company_id=p.company_id
   WHERE p.company_id=$1 AND l.test_mode IN ('Pre-Test','Post-Test')
   ORDER BY p.display_order,p.id,sec.display_order,sec.id,m.display_order,m.id`,[account.company_id]),allowedCourseSet(account)]);
  return q.rows.filter(t=>!allowed||allowed.has(t.program_title));
 }
 function render(rows){
  const groups=new Map();for(const t of rows){if(!groups.has(t.program_id))groups.set(t.program_id,[]);groups.get(t.program_id).push(t);}
  return `<div class="card" id="modular-pre-post-tests"><h2>Modular Program Pre-Tests & Post-Tests</h2><p>These tests are available here and inside their modular program. Questions, time limits, scoring, saved answers and attempt history use the same records from either location.</p><p class="small muted">Students take tests from their enrolled training page. Module access rules still apply. Each attempt retains its original questions, choice order, answers, score and completion time; reports include retakes.</p>${[...groups.values()].map(tests=>{const p=tests[0];return `<section class="card"><h3>${esc(p.program_title)}</h3><p>Class code ${esc(p.join_code)}</p><div class="grid">${tests.map(t=>{const active=t.program_active&&t.section_active&&t.module_active&&t.bank_active;return `<div class="card"><span class="pill">${esc(t.test_mode)}</span> <span class="pill ${active?'open':'closed'}">${active?'Active':'Hidden / Closed'}</span><h3>${esc(t.module_title)}</h3><p>${esc(t.section_title)} · ${esc(t.bank_title)}</p><p>${Number(t.question_count)||0} questions · ${Number(t.time_limit_minutes)>0?Number(t.time_limit_minutes)+' minutes':'Untimed'} · ${Number(t.completed_attempts)||0} recorded attempts</p><a class="btn" href="/instructor/programs/${t.program_id}/module/${t.module_id}/test">Open ${esc(t.test_mode)}</a></div>`;}).join('')}</div><div class="toolbar"><a class="btn light" href="/instructor/programs/${p.program_id}">Open Program</a><a class="btn light" href="/instructor/programs/${p.program_id}/prepost">Pre/Post Results</a><a class="btn light" href="/instructor/programs/${p.program_id}/answers">Student Answers</a><a class="btn light" href="/instructor/programs/${p.program_id}/answers.xlsx">Download Excel</a></div></section>`;}).join('')||'<p class="muted">No modular pre- or post-tests are linked yet. Tests appear automatically when added to a program.</p>'}</div>`;
 }
 return {catalog,render};
};

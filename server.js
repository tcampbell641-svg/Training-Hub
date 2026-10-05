// The Training Hub 2.2.04 MASTER — Methodist Spreadsheet Export / Download Fix
// The Training Hub 2.1.69 MASTER — Forced HCE Pre/Post Answer-Key Self-Heal
// The Training Hub 2.1.49 MASTER — Force Separate 3100 / 4100 Everywhere
// The Training Hub 2.1.35 — Backup History Cleanup
// The Training Hub 2.1.27 — Company-Specific Editable Dashboard Tabs
// The Training Hub 2.1.23 — Add 3100 SU Scavenger Hunt
// The Training Hub 2.1.9 — Simulation Equipment Model Integration
// The Training Hub 2.1.7 — Editable Matched Pre/Post Tests
import express from 'express';
import pg from 'pg';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const APP_NAME = process.env.APP_NAME || 'The Training Hub';
const PLATFORM_VERSION = '2.0';
const tenantContext = new AsyncLocalStorage();
const INSTRUCTOR_PIN = process.env.INSTRUCTOR_PIN || '2468';
const INSTRUCTOR_PIN_CONFIGURED = !!process.env.INSTRUCTOR_PIN;
const SESSION_SIGNING_KEY = crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'tth_account';
const CSRF_COOKIE = 'tth_csrf';
const SESSION_IDLE_MS = Math.max(10,Number(process.env.SESSION_IDLE_MINUTES)||30)*60*1000;
const SESSION_MAX_MS = Math.max(1,Number(process.env.SESSION_MAX_HOURS)||8)*60*60*1000;
const LOGIN_WINDOW_MS = 15*60*1000;
const LOGIN_LOCK_MS = 15*60*1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

const BRAND_DEFAULTS = Object.freeze({
 app_name:'The Training Hub',
 tagline:'Cloud Training System',
 organization_name:'Your Company',
 home_message:'Start classes, build activities, monitor students, and print training records.',
 certificate_title:'Certificate of Completion',
 copyright_holder:'The Training Hub',
 footer_text:'All Rights Reserved.',
 contact_email:'',
 contact_phone:'',
 website_url:'',
 logo_url:'',
 primary_color:'#c4141c',
 secondary_color:'#171717',
 accent_color:'#9f0f15',
 student_label:'Student',
 instructor_label:'Instructor',
 organization_unit_label:'Company / Location',
 equipment_label:'Equipment',
 certificate_location:'',
 certificate_organization_name:'',
 certificate_manager_name:'',
 certificate_manager_title:'Training Manager',
 certificate_prefix:'TTH',
 program_tab_title:'Modular Programs',
 program_tab_description:'Build multi-section training programs with modules, activities, progress, and one program QR code.',
 program_tab_icon:'🧩',
 program_tab_visible:'true'
});
let BRAND={...BRAND_DEFAULTS};
function brand(key,fallback=''){
 const local=tenantContext.getStore()?.brand;
 const source=local||BRAND;
 const v=source?.[key];
 return (v===undefined||v===null||String(v).trim()==='')?fallback:String(v);
}
function activeCompanyId(){ return Number(tenantContext.getStore()?.companyId||0)||null; }
function safeHex(value,fallback){ const v=String(value||'').trim(); return /^#[0-9a-fA-F]{6}$/.test(v)?v:fallback; }
function safeLogoUrl(value=''){ const v=String(value||'').trim(); return /^(https?:\/\/|\/|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i.test(v)?v:''; }
async function refreshBrandSettings(){ BRAND={...BRAND_DEFAULTS}; }
async function companyBrand(companyId){
 const out={...BRAND_DEFAULTS};
 if(!companyId)return out;
 try{
  const q=await pool.query('SELECT key,value FROM company_settings WHERE company_id=$1',[companyId]);
  Object.assign(out,Object.fromEntries(q.rows.map(r=>[r.key,r.value])));
  const cq=await pool.query('SELECT name,website_url,contact_email,contact_phone FROM companies WHERE id=$1',[companyId]);
  if(cq.rowCount){ const c=cq.rows[0]; out.organization_name=c.name||out.organization_name; out.contact_email=c.contact_email||out.contact_email||''; out.contact_phone=c.contact_phone||out.contact_phone||''; out.website_url=c.website_url||out.website_url||''; }
 }catch(e){}
 return out;
}

function safeEq(a,b){
 const aa=Buffer.from(String(a||'')), bb=Buffer.from(String(b||''));
 return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function b64url(v){ return Buffer.from(v).toString('base64url'); }
function unb64url(v){ try{return Buffer.from(v,'base64url').toString('utf8')}catch{return ''} }
function signValue(v){ return crypto.createHmac('sha256',SESSION_SIGNING_KEY).update(v).digest('base64url'); }
function signedValue(v){ return `${v}.${signValue(v)}`; }
function verifySigned(v=''){
 const i=String(v).lastIndexOf('.'); if(i<1)return null;
 const raw=String(v).slice(0,i), sig=String(v).slice(i+1);
 return safeEq(sig,signValue(raw))?raw:null;
}
function securityCookies(req){
 const out={}; for(const part of String(req.headers.cookie||'').split(';')){
  const i=part.indexOf('='); if(i<0)continue; const k=part.slice(0,i).trim();
  try{ out[k]=decodeURIComponent(part.slice(i+1).trim()); }catch{ out[k]=part.slice(i+1).trim(); }
 } return out;
}
function clientIp(req){ return String(req.ip||req.socket?.remoteAddress||'unknown').slice(0,120); }
function ipFingerprint(req){ return crypto.createHash('sha256').update(clientIp(req)+'|'+SESSION_SIGNING_KEY.slice(0,16)).digest('hex').slice(0,24); }
function sessionFromReq(req){
 const raw=verifySigned(securityCookies(req)[SESSION_COOKIE]||''); if(!raw)return null;
 try{
  const d=JSON.parse(unb64url(raw)), now=Date.now();
  if(!['owner','company_admin','instructor','viewer'].includes(d.role)||!d.iat||!d.last)return null;
  if(now-d.last>SESSION_IDLE_MS || now-d.iat>SESSION_MAX_MS)return null;
  return d;
 }catch{return null}
}
function setSession(res, prior=null, overrides={}){
 const now=Date.now();
 const base=prior||{};
 const d={
  role:overrides.role||base.role||'owner',
  user_id:overrides.user_id!==undefined?overrides.user_id:(base.user_id||null),
  company_id:overrides.company_id!==undefined?overrides.company_id:(base.company_id||null),
  name:overrides.name!==undefined?overrides.name:(base.name||''),
  email:overrides.email!==undefined?overrides.email:(base.email||''),
  iat:base.iat||now,last:now,n:base.n||crypto.randomBytes(12).toString('hex')
 };
 const val=signedValue(b64url(JSON.stringify(d)));
 res.cookie(SESSION_COOKIE,val,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:SESSION_MAX_MS});
 return d;
}
function clearSession(res){ res.clearCookie(SESSION_COOKIE,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'}); res.clearCookie(CSRF_COOKIE,{secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'}); }
function newCsrf(res){
 const raw=crypto.randomBytes(24).toString('base64url'), token=signedValue(raw);
 res.cookie(CSRF_COOKIE,token,{httpOnly:false,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:SESSION_MAX_MS});
 return token;
}
function validCsrf(req){
 const cookie=securityCookies(req)[CSRF_COOKIE]||'';
 const supplied=String(req.body?._csrf||req.get('x-csrf-token')||'');
 return !!verifySigned(cookie) && safeEq(cookie,supplied);
}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
 return new Promise((resolve,reject)=>crypto.scrypt(String(password||''),salt,64,(err,key)=>err?reject(err):resolve({salt,hash:key.toString('hex')})));
}
async function verifyPassword(password,salt,hash){
 try{ const x=await hashPassword(password,salt); return safeEq(x.hash,hash); }catch{return false;}
}
function roleLabel(role){ return ({owner:'Owner',company_admin:'Company Admin',instructor:'Instructor',viewer:'Viewer / Manager'})[role]||role; }
function isEditorRole(role){ return ['owner','company_admin','instructor'].includes(role); }
function isCompanyAdminRole(role){ return ['owner','company_admin'].includes(role); }
async function staffAccountById(id){ if(!id)return null; const q=await pool.query('SELECT * FROM app_users WHERE id=$1 AND active=true',[id]); return q.rows[0]||null; }
async function allowedCourseSet(session){
 if(!session||session.role==='owner'||session.role==='company_admin')return null;
 const u=await staffAccountById(session.user_id); if(!u||u.all_courses)return null;
 const q=await pool.query('SELECT course_name FROM user_course_permissions WHERE user_id=$1 AND can_view=true',[u.id]);
 return new Set(q.rows.map(x=>x.course_name));
}
async function courseAllowedForSession(session,course,edit=false){
 if(!session)return false;
 if(session.role==='owner'||session.role==='company_admin')return true;
 if(edit && session.role==='viewer')return false;
 const u=await staffAccountById(session.user_id); if(!u)return false;
 if(u.all_courses)return true;
 const q=await pool.query(`SELECT 1 FROM user_course_permissions WHERE user_id=$1 AND course_name=$2 AND ${edit?'can_edit':'can_view'}=true`,[u.id,course]);
 return !!q.rowCount;
}
function loginState(req){
 const key=ipFingerprint(req), now=Date.now(), prior=loginFailures.get(key)||{first:now,count:0,lockedUntil:0};
 if(prior.lockedUntil>now)return {key,state:prior,locked:true,seconds:Math.ceil((prior.lockedUntil-now)/1000)};
 if(now-prior.first>LOGIN_WINDOW_MS){ prior.first=now; prior.count=0; prior.lockedUntil=0; }
 return {key,state:prior,locked:false,seconds:0};
}
function registerLoginFailure(req){
 const x=loginState(req), now=Date.now(); x.state.count++;
 if(x.state.count>=LOGIN_MAX_FAILURES)x.state.lockedUntil=now+LOGIN_LOCK_MS;
 loginFailures.set(x.key,x.state); return x.state;
}
function clearLoginFailures(req){ loginFailures.delete(ipFingerprint(req)); }
async function auditEvent(req,event,detail='',status='ok'){
 try{
  const sess=sessionFromReq(req);
  await pool.query('INSERT INTO security_audit(event,detail,status,ip_hash,user_agent,company_id,user_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())',[String(event).slice(0,80),String(detail).slice(0,500),String(status).slice(0,30),ipFingerprint(req),String(req.get('user-agent')||'').slice(0,250),sess?.company_id||null,sess?.user_id||null]);
 }catch(e){ console.error('Audit log error:',e.message); }
}
const DEFAULT_LOGO_URL = '';
const DEFAULT_MANAGER_SIGNATURE_URL = '';
if (!process.env.DATABASE_URL) {
 console.error('DATABASE_URL is required for cloud mode.');
 process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });


// ---------------- Google Drive automatic backup system (2.1.33) ----------------
// 2.1.98 OWNER-CONTROLLED BACKUP MODE WITH INTERVAL SELECTION.
// Automatic backup defaults OFF and is controlled from Owner > Google Drive Backup.
// No Render environment-variable change or redeploy is required to turn the schedule on/off.

const GOOGLE_DRIVE_FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID||'').trim();
const GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL||'').trim();
const GOOGLE_DRIVE_PRIVATE_KEY = String(process.env.GOOGLE_DRIVE_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();
const GOOGLE_DRIVE_CLIENT_ID = String(process.env.GOOGLE_DRIVE_CLIENT_ID||'').trim();
const GOOGLE_DRIVE_CLIENT_SECRET = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET||'').trim();
const GOOGLE_DRIVE_REFRESH_TOKEN = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN||'').trim();
const GOOGLE_DRIVE_BACKUP_INTERVAL_HOURS = Math.max(1,Number(process.env.GOOGLE_DRIVE_BACKUP_INTERVAL_HOURS)||24);
const GOOGLE_DRIVE_BACKUP_RETENTION_DAYS = Math.max(1,Number(process.env.GOOGLE_DRIVE_BACKUP_RETENTION_DAYS)||30);
let googleDriveBackupRunning=false;
let googleDriveBackupCancelRequested=false;
let googleDriveBackupAbortController=null;
let googleDriveCurrentRunId=null;

const BACKUP_SETTING_AUTO='backup_auto_enabled';
const BACKUP_SETTING_SCHEDULE='backup_schedule'; // legacy 2.1.97 setting retained for migration
const BACKUP_SETTING_INTERVAL='backup_interval_hours';
const BACKUP_SETTING_RETENTION='backup_retention_days';
function backupIntervalLabel(hours){
 const h=Number(hours)||24;
 if(h===6)return 'Every 6 Hours';
 if(h===12)return 'Every 12 Hours';
 if(h===24)return 'Every 24 Hours';
 if(h===72)return 'Every 3 Days';
 if(h===168)return 'Every 7 Days';
 return `Every ${h} Hour${h===1?'':'s'}`;
}
async function backupPreferences(){
 const q=await pool.query(`SELECT key,value FROM site_settings WHERE key=ANY($1::text[])`,[[BACKUP_SETTING_AUTO,BACKUP_SETTING_INTERVAL,BACKUP_SETTING_SCHEDULE,BACKUP_SETTING_RETENTION]]);
 const m=Object.fromEntries(q.rows.map(r=>[r.key,String(r.value||'')]));
 let hours=Number(m[BACKUP_SETTING_INTERVAL]);
 if(!Number.isFinite(hours)||hours<1){
  const legacy=m[BACKUP_SETTING_SCHEDULE];
  hours=legacy==='3days'?72:legacy==='weekly'?168:24;
 }
 hours=Math.max(1,Math.min(720,Math.round(hours)));
 const retention=Math.max(1,Math.min(365,Number(m[BACKUP_SETTING_RETENTION])||GOOGLE_DRIVE_BACKUP_RETENTION_DAYS));
 return {enabled:m[BACKUP_SETTING_AUTO]==='true',hours,retention};
}
async function saveBackupPreference(key,value){ await pool.query(`INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[key,String(value)]); }

function googleDriveOauthConfigured(){return !!(GOOGLE_DRIVE_FOLDER_ID&&GOOGLE_DRIVE_CLIENT_ID&&GOOGLE_DRIVE_CLIENT_SECRET&&GOOGLE_DRIVE_REFRESH_TOKEN);}
function googleDriveServiceAccountConfigured(){return !!(GOOGLE_DRIVE_FOLDER_ID&&GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL&&GOOGLE_DRIVE_PRIVATE_KEY);}
function googleDriveBackupConfigured(){ return googleDriveOauthConfigured()||googleDriveServiceAccountConfigured(); }
function googleDriveAuthMode(){return googleDriveOauthConfigured()?'Google user OAuth':googleDriveServiceAccountConfigured()?'Service account / Shared Drive':'Not configured';}
async function testGoogleDriveConnection(){
 if(!googleDriveBackupConfigured())return {ok:false,error:'Google Drive backup environment variables are incomplete.'};
 try{
  const token=await googleDriveAccessToken();
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(GOOGLE_DRIVE_FOLDER_ID)}?fields=id,name,mimeType&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error?.message||`Google Drive folder check failed: ${r.status}`);
  return {ok:true,name:String(j.name||'Google Drive folder'),mimeType:String(j.mimeType||'')};
 }catch(e){return {ok:false,error:String(e.message||e)};}
}

function backupSafeIdent(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }
function backupEncodeValue(v){
 if(Buffer.isBuffer(v)) return {__tth_type:'bytea',base64:v.toString('base64')};
 if(v instanceof Date) return {__tth_type:'date',value:v.toISOString()};
 if(typeof v==='bigint') return {__tth_type:'bigint',value:String(v)};
 return v;
}
function backupEncodeRow(row){ const out={}; for(const [k,v] of Object.entries(row))out[k]=backupEncodeValue(v); return out; }
async function gzipWrite(gzip,text){ if(!gzip.write(text))await once(gzip,'drain'); }
async function createTrainingHubBackupFile(runId){
 const ensureNotCancelled=()=>{ if(googleDriveBackupCancelRequested)throw new Error('BACKUP_CANCELLED'); };
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const fileName=`training-hub-backup-${stamp}.ndjson.gz`;
 const filePath=path.join(os.tmpdir(),fileName);
 const output=fs.createWriteStream(filePath,{flags:'wx'}), gzip=zlib.createGzip({level:6});
 gzip.pipe(output);
 const client=await pool.connect();
 let rowCount=0, tableCount=0;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tq=await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  await gzipWrite(gzip,JSON.stringify({type:'manifest',format:'TTH_NDJSON_GZIP_V1',app:'The Training Hub',version:'2.1.33',created_at:new Date().toISOString(),database:'PostgreSQL',table_count:tq.rowCount})+'\n');
  for(const t of tq.rows){
   ensureNotCancelled();
   const table=String(t.tablename);
   const cq=await client.query(`SELECT column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table]);
   await gzipWrite(gzip,JSON.stringify({type:'table',name:table,columns:cq.rows})+'\n');
   tableCount++;
   let offset=0;
   const pageSize=250;
   while(true){
    ensureNotCancelled();
    const q=await client.query(`SELECT * FROM ${backupSafeIdent(table)} OFFSET $1 LIMIT $2`,[offset,pageSize]);
    if(!q.rowCount)break;
    for(const row of q.rows){ await gzipWrite(gzip,JSON.stringify({type:'row',table,data:backupEncodeRow(row)})+'\n'); rowCount++; }
    offset+=q.rowCount;
    if(q.rowCount<pageSize)break;
   }
  }
  await client.query('COMMIT');
  await gzipWrite(gzip,JSON.stringify({type:'end',tables:tableCount,rows:rowCount,completed_at:new Date().toISOString()})+'\n');
  gzip.end(); await once(output,'close');
  const size=fs.statSync(filePath).size;
  if(runId)await pool.query('UPDATE backup_runs SET table_count=$2,row_count=$3,file_size=$4 WHERE id=$1',[runId,tableCount,rowCount,size]);
  return {filePath,fileName,size,tableCount,rowCount};
 }catch(e){
  try{await client.query('ROLLBACK')}catch(_e){}
  try{gzip.destroy()}catch(_e){} try{output.destroy()}catch(_e){} try{fs.unlinkSync(filePath)}catch(_e){}
  throw e;
 }finally{client.release();}
}
function b64urlJson(obj){return Buffer.from(JSON.stringify(obj)).toString('base64url');}
async function googleDriveAccessToken(){
 if(googleDriveOauthConfigured()){
  const body=new URLSearchParams({client_id:GOOGLE_DRIVE_CLIENT_ID,client_secret:GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:GOOGLE_DRIVE_REFRESH_TOKEN,grant_type:'refresh_token'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const j=await r.json().catch(()=>({})); if(!r.ok||!j.access_token)throw new Error(`Google OAuth refresh failed: ${j.error_description||j.error||r.status}`);
  return j.access_token;
 }
 if(googleDriveServiceAccountConfigured()){
  const now=Math.floor(Date.now()/1000);
  const header=b64urlJson({alg:'RS256',typ:'JWT'}), claim=b64urlJson({iss:GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${claim}`;
  const sig=crypto.sign('RSA-SHA256',Buffer.from(unsigned),GOOGLE_DRIVE_PRIVATE_KEY).toString('base64url');
  const assertion=`${unsigned}.${sig}`;
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const j=await r.json().catch(()=>({})); if(!r.ok||!j.access_token)throw new Error(`Google service-account authentication failed: ${j.error_description||j.error||r.status}`);
  return j.access_token;
 }
 throw new Error('Google Drive authentication is not configured.');
}
async function uploadBackupToGoogleDrive(filePath,fileName,size,signal){
 const token=await googleDriveAccessToken();
 const metadata={name:fileName,parents:[GOOGLE_DRIVE_FOLDER_ID],description:'Automatic backup created by The Training Hub 2.1.35'};
 const start=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,createdTime,size',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'application/gzip','X-Upload-Content-Length':String(size)},body:JSON.stringify(metadata),signal});
 if(!start.ok)throw new Error(`Google Drive upload could not start: ${start.status} ${await start.text()}`);
 const uploadUrl=start.headers.get('location'); if(!uploadUrl)throw new Error('Google Drive did not return a resumable upload URL.');
 const upload=await fetch(uploadUrl,{method:'PUT',headers:{'Content-Type':'application/gzip','Content-Length':String(size)},body:fs.createReadStream(filePath),duplex:'half',signal});
 const j=await upload.json().catch(()=>({})); if(!upload.ok||!j.id)throw new Error(`Google Drive upload failed: ${upload.status} ${j.error?.message||''}`);
 return j;
}
async function cleanupOldGoogleDriveBackups(retentionDays=GOOGLE_DRIVE_BACKUP_RETENTION_DAYS){
 if(!retentionDays)return;
 const token=await googleDriveAccessToken();
 const cutoff=Date.now()-Number(retentionDays)*86400000;
 const q=`'${GOOGLE_DRIVE_FOLDER_ID.replace(/'/g,"\\'")}' in parents and trashed=false and name contains 'training-hub-backup-'`;
 const r=await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,createdTime)&pageSize=1000`,{headers:{Authorization:`Bearer ${token}`}});
 if(!r.ok)return; const j=await r.json().catch(()=>({files:[]}));
 for(const f of j.files||[]){ if(new Date(f.createdTime).getTime()<cutoff)await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}}).catch(()=>{}); }
}
async function runGoogleDriveBackup(trigger='automatic'){
 if(googleDriveBackupRunning)return {ok:false,error:'A backup is already running.'};
 const prefs=await backupPreferences();
 if(!prefs.enabled && trigger==='automatic')return {ok:false,error:'Automatic backups are disabled.'};
 if(!googleDriveBackupConfigured())return {ok:false,error:'Google Drive backup environment variables are incomplete.'};
 googleDriveBackupRunning=true;
 googleDriveBackupCancelRequested=false;
 googleDriveBackupAbortController=new AbortController();
 let runId=null, temp='';
 try{
  const iq=await pool.query(`INSERT INTO backup_runs(trigger_type,status,started_at) VALUES($1,'running',now()) RETURNING id`,[trigger]);
  runId=iq.rows[0].id; googleDriveCurrentRunId=Number(runId);
  const backup=await createTrainingHubBackupFile(runId); temp=backup.filePath;
  if(googleDriveBackupCancelRequested)throw new Error('BACKUP_CANCELLED');
  const drive=await uploadBackupToGoogleDrive(backup.filePath,backup.fileName,backup.size,googleDriveBackupAbortController.signal);
  if(googleDriveBackupCancelRequested)throw new Error('BACKUP_CANCELLED');
  await pool.query(`UPDATE backup_runs SET status='success',drive_file_id=$2,drive_file_name=$3,completed_at=now() WHERE id=$1`,[runId,drive.id,drive.name||backup.fileName]);
  cleanupOldGoogleDriveBackups(prefs.retention).catch(e=>console.error('Backup retention cleanup:',e.message));
  return {ok:true,id:runId,file:drive.name||backup.fileName,driveId:drive.id};
 }catch(e){
  const cancelled=googleDriveBackupCancelRequested || String(e?.name||'')==='AbortError' || String(e?.message||e)==='BACKUP_CANCELLED';
  if(!cancelled)console.error('Google Drive backup failed:',e);
  if(runId)await pool.query(`UPDATE backup_runs SET status=$2,error_message=$3,completed_at=now() WHERE id=$1`,[runId,cancelled?'cancelled':'failed',cancelled?'Cancelled by owner.':String(e.message||e).slice(0,2000)]).catch(()=>{});
  return {ok:false,error:cancelled?'Backup cancelled.':String(e.message||e)};
 }finally{
  if(temp)try{fs.unlinkSync(temp)}catch(_e){}
  googleDriveBackupRunning=false;
  googleDriveBackupCancelRequested=false;
  googleDriveBackupAbortController=null;
  googleDriveCurrentRunId=null;
 }
}
async function automaticBackupTick(){
 try{
  const prefs=await backupPreferences();
  if(!prefs.enabled||!googleDriveBackupConfigured()||googleDriveBackupRunning)return;
  const q=await pool.query(`SELECT completed_at FROM backup_runs WHERE status='success' ORDER BY completed_at DESC NULLS LAST LIMIT 1`);
  const last=q.rows[0]?.completed_at?new Date(q.rows[0].completed_at).getTime():0;
  if(!last || Date.now()-last>=prefs.hours*3600000) await runGoogleDriveBackup('automatic');
 }catch(e){console.error('Automatic backup scheduler:',e.message);}
}
function startAutomaticBackupScheduler(){
 console.log('Google Drive backup scheduler: owner controlled (default OFF)');
 setTimeout(()=>automaticBackupTick(),45000);
 const timer=setInterval(()=>automaticBackupTick(),15*60*1000); timer.unref?.();
}
// -----------------------------------------------------------------------------

const LEGACY_DATABASE_URL = String(process.env.LEGACY_DATABASE_URL||'').trim();
let legacyPoolInstance=null;
function legacySourcePool(){
 if(!LEGACY_DATABASE_URL)return null;
 if(!legacyPoolInstance)legacyPoolInstance=new Pool({connectionString:LEGACY_DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false,max:2});
 return legacyPoolInstance;
}
function legacyFingerprint(){return LEGACY_DATABASE_URL?crypto.createHash('sha256').update(LEGACY_DATABASE_URL).digest('hex').slice(0,16):'';}
async function legacyTableExists(lp,name){
 const q=await lp.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,[name]); return !!q.rowCount;
}
async function legacyCount(lp,name){ if(!await legacyTableExists(lp,name))return 0; return Number((await lp.query(`SELECT count(*)::int n FROM ${name}`)).rows[0]?.n||0); }
async function nextImportClassCode(client){ for(let i=0;i<20;i++){const c=code6();if(!(await client.query('SELECT 1 FROM classes WHERE code=$1',[c])).rowCount)return c;} return String(Date.now()).slice(-6); }
function importKey(companyId,prefix,oldKey){const clean=String(oldKey||'item').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'item';return `c${companyId}-legacy-${prefix}-${clean}-${crypto.randomBytes(3).toString('hex')}`;}

app.set('trust proxy',1);
app.disable('x-powered-by');
app.use((req,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=(), payment=()');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.sheetjs.com; connect-src 'self'; frame-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
 if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 next();
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '8mb' }));
app.use((req,res,next)=>{
 const protectedPost=req.method==='POST' && (req.path.startsWith('/instructor/')||req.path.startsWith('/owner/')) && !['/instructor/login','/instructor/staff-login'].includes(req.path);
 if(protectedPost){
  const sess=sessionFromReq(req);
  if(sess && !validCsrf(req)){
   auditEvent(req,'CSRF_BLOCK',req.path,'blocked');
   return res.status(403).send(layout('Security Check',`<div class="card"><div class="big">Security check failed</div><p>This form expired or did not come from this Training Hub session.</p><a class="btn" href="/instructor">Return to Login</a></div>`));
  }
 }
 next();
});
app.use(express.static('public',{dotfiles:'deny',fallthrough:true,index:false,maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use(['/instructor','/student','/owner'],(req,res,next)=>{res.setHeader('Cache-Control','no-store, private');res.setHeader('Pragma','no-cache');next();});

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const xmlEsc=(v='')=>String(v).replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[ch]));
const safeFile=(v='label')=>String(v).replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,60)||'label';
const LABEL_SPECS={
 '30x30':{label:'30 × 30 mm',mmW:30,mmH:30,qr:720,canvasW:600,canvasH:600,nameChars:17,nameLines:2,descChars:20,descLines:1},
 '40x30':{label:'40 × 30 mm',mmW:40,mmH:30,qr:900,canvasW:800,canvasH:600,nameChars:18,nameLines:3,descChars:22,descLines:2,landscape:true},
 '50x30':{label:'50 × 30 mm',mmW:50,mmH:30,qr:900,canvasW:1000,canvasH:600,nameChars:24,nameLines:3,descChars:30,descLines:2,landscape:true},
 '50x40':{label:'50 × 40 mm',mmW:50,mmH:40,qr:900,canvasW:1000,canvasH:800,nameChars:25,nameLines:3,descChars:32,descLines:3,landscape:true},
 '60x40':{label:'60 × 40 mm',mmW:60,mmH:40,qr:900,canvasW:1200,canvasH:800,nameChars:30,nameLines:3,descChars:38,descLines:3,landscape:true},
 '40x60':{label:'40 × 60 mm',mmW:40,mmH:60,qr:800,canvasW:600,canvasH:900,nameChars:20,nameLines:2,descChars:28,descLines:3},
 '50x80':{label:'50 × 80 mm',mmW:50,mmH:80,qr:1000,canvasW:625,canvasH:1000,nameChars:24,nameLines:2,descChars:34,descLines:4},
 '50':{label:'Standard T50M / 50 mm',mmW:50,mmH:62,qr:900,canvasW:625,canvasH:775,nameChars:22,nameLines:2,descChars:30,descLines:3},
 // Backward-compatible alias from earlier builds.
 '30':{label:'30 × 30 mm',mmW:30,mmH:30,qr:720,canvasW:600,canvasH:600,nameChars:17,nameLines:2,descChars:20,descLines:1}
};
function resolveLabelSpec(size,w,h){
 if(size!=='custom') return LABEL_SPECS[size]||null;
 const mmW=Math.min(100,Math.max(20,Number(w)||40)), mmH=Math.min(100,Math.max(20,Number(h)||30));
 const scale=20, canvasW=Math.round(mmW*scale), canvasH=Math.round(mmH*scale), landscape=mmW>mmH;
 return {label:`${mmW} × ${mmH} mm Custom`,mmW,mmH,qr:900,canvasW,canvasH,nameChars:Math.max(14,Math.round(mmW*.48)),nameLines:landscape?3:2,descChars:Math.max(18,Math.round(mmW*.62)),descLines:landscape?3:2,landscape};
}
function wrapLabelText(text='',maxChars=24){ const words=String(text).replace(/\s+/g,' ').trim().split(' ').filter(Boolean); const lines=[]; let line=''; for(const w of words){ const test=line?line+' '+w:w; if(test.length<=maxChars){ line=test; } else { if(line) lines.push(line); line=w; } } if(line) lines.push(line); return lines; }
function trimLabelText(text='',maxChars=80){ const clean=String(text).replace(/\s+/g,' ').trim(); return clean.length>maxChars?clean.slice(0,maxChars-1).trim()+'…':clean; }
function code6(){ return Math.floor(100000 + Math.random()*900000).toString(); }
function certNo(){ return (brand('certificate_prefix','TTH').replace(/[^A-Za-z0-9]/g,'').slice(0,8)||'TTH') + '-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
async function ensureCertificate(studentId){
 const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
 if(existing.rows[0]?.certificate_no) return existing.rows[0].certificate_no;
 const cert=certNo();
 await pool.query(`INSERT INTO instructor_notes(student_id,certificate_no) VALUES($1,$2) ON CONFLICT(student_id) DO UPDATE SET certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[studentId,cert]);
 const check=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
 return check.rows[0]?.certificate_no||cert;
}
function layout(title, body, extra='') {
 const appName=brand('app_name',APP_NAME), tagline=brand('tagline','Cloud Training System');
 const logo=safeLogoUrl(brand('logo_url',''));
 const logoHtml=logo?`<img src="${esc(logo)}" alt="${esc(appName)} logo" style="max-height:44px;max-width:180px;object-fit:contain;margin-right:14px">`:'';
 const contact=[brand('contact_email',''),brand('contact_phone',''),brand('website_url','')].filter(Boolean).map(esc).join(' · ');
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(appName)}</title><style>

:root{--red:${safeHex(brand('primary_color','#c4141c'),'#c4141c')};--red2:${safeHex(brand('accent_color','#9f0f15'),'#9f0f15')};--black:${safeHex(brand('secondary_color','#171717'),'#171717')};--line:#dedede;--soft:#f5f5f5;--muted:#666;--green:#1f7a3b;--amber:#a55b00}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d;background:#f6f6f6}.top{background:var(--black);color:#fff;padding:18px 24px;border-bottom:5px solid var(--red);display:flex;align-items:center;justify-content:space-between}.top b{font-size:21px}.top span{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ddd}.wrap{max-width:1180px;margin:auto;padding:24px}.card{border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:18px}.home-card{display:block;text-decoration:none;color:#1d1d1d;background:#fff;border:1px solid var(--line);border-top:6px solid var(--red)!important;border-radius:18px;padding:24px;min-height:150px;transition:.15s ease}.home-card:hover{border-color:#bbb;transform:translateY(-1px)}.home-card .icon{font-size:30px;margin-bottom:14px}.home-card .title{font-size:22px;font-weight:800}.home-card .desc{color:var(--muted);margin-top:8px;line-height:1.45}.hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.hero h1{margin:0;font-size:30px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}.btn,button{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;cursor:pointer}.btn:hover,button:hover{background:var(--red2)}.btn.alt{background:#333}.btn.light{background:#eee;color:#222}.btn.light:hover{background:#ddd}.btn.danger,button.danger{background:#a00000}.btn.danger:hover,button.danger:hover{background:#7d0000}.big{font-size:24px;font-weight:800}.muted{color:var(--muted)}.code{font-size:50px;font-weight:900;letter-spacing:6px}.stat{background:var(--soft);padding:16px;border-radius:14px}.stat b{display:block;font-size:28px;margin-top:4px}.stat span{font-size:13px;color:var(--muted);font-weight:700}.stat.green b{color:var(--green)}input,select,textarea{width:100%;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin-top:5px;background:#fff}label{font-weight:650;display:block;margin:12px 0}.q{padding:14px;border:1px solid #ddd;border-radius:10px;margin:12px 0}.q label{font-weight:400;margin:8px 0}.q input[type=radio]{width:auto;margin-right:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#fafafa}.pass{color:#0b6d2f;font-weight:800}.review{color:#a14500;font-weight:800}.danger{color:#a00000}.btn.danger,button.danger{color:#fff!important}.btn:not(.light):not(.sim-choice-wrong):not(.sim-choice-neutral),button:not(.light):not(.sim-choice-wrong):not(.sim-choice-neutral){color:#fff!important}.parts-penalty,.parts-penalty *{color:#fff!important}[style*="background:#a00000"],[style*="background:#7d0000"],[style*="background:#5c0a0f"],[style*="background:#c4141c"],[style*="background:#9f0f15"]{color:#fff!important}.alert,.alert *{color:#000!important}.qr{max-width:300px;width:100%;height:auto}.center{text-align:center}.steps{font-size:18px;line-height:1.6}.pill{display:inline-block;background:#eee;padding:6px 10px;border-radius:99px;font-size:13px;font-weight:800}.pill.open{background:#e8f5ea;color:#1f6f38}.pill.closed{background:#f1f1f1;color:#555}.pill.joined{background:#eef3ff;color:#274d9c}.pill.results{background:#e8f5ea;color:#1f6f38}.pill.testing{background:#fff3cd;color:#805600}.pill.hunt{background:#f3e8ff;color:#6b2b91}.progressbar{height:10px;background:#ececec;border-radius:99px;overflow:hidden}.progressbar>span{display:block;height:100%;background:var(--red)}.rating{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.rating label{border:1px solid #ddd;border-radius:8px;padding:9px;text-align:center;font-weight:600}.rating input{width:auto;margin:0 4px 0 0}.feedback-good{border-left:5px solid var(--green)}.feedback-miss{border-left:5px solid var(--red)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.alert{padding:12px;border-radius:9px;background:#fff3cd;border:1px solid #ffe69c;color:#000}.alert *{color:#000}.success{padding:12px;border-radius:9px;background:#e8f5ea;border:1px solid #b9dfc0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0}.join-box{background:#fff;border:2px solid #eee;border-radius:18px;padding:22px}.live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2f9e44;margin-right:7px}.small{font-size:13px}.nowrap{white-space:nowrap}@media(max-width:700px){.wrap{padding:14px}.top{padding:14px 16px}.top span{display:none}.code{font-size:38px}.hero h1{font-size:26px}.home-card{min-height:125px;padding:18px}th,td{padding:9px}.desktop-only{display:none}}@media print{.no-print,.top{display:none!important}.wrap{max-width:none;padding:0}.card{border:0}.report{font-size:12pt}body{background:#fff}}

</style>${extra}</head><body><div class="top"><div style="display:flex;align-items:center">${logoHtml}<b>${esc(appName)}</b></div><span>${esc(tagline)}</span></div><div class="wrap">${body}</div><footer style="max-width:1180px;margin:20px auto 0;padding:14px 18px;color:#666;font-size:12px;text-align:center">© ${new Date().getFullYear()} ${esc(brand('copyright_holder',appName))}. ${esc(brand('footer_text','All Rights Reserved.'))}${contact?`<br>${contact}`:''}</footer><script>(function(){function c(n){const m=document.cookie.match(new RegExp('(?:^|; )'+n.replace(/([.$?*|{}()\[\]\\\/+^])/g,'\\$1')+'=([^;]*)'));return m?decodeURIComponent(m[1]):''}const t=c('tth_csrf');if(!t)return;document.querySelectorAll('form[method="post"],form[method="POST"]').forEach(function(f){if(f.action&&(f.action.includes('/instructor/login')||f.action.includes('/instructor/staff-login')))return;if(f.querySelector('input[name="_csrf"]'))return;const i=document.createElement('input');i.type='hidden';i.name='_csrf';i.value=t;f.appendChild(i);});})();</script></body></html>`;
} 

const DEFAULT_QUIZ = [
['Before replacing a component during diagnosis, what should the student do first?',['Clear all codes','Prove the failure','Disconnect the battery','Replace the ECU'],1],
['Approximate resistance of a properly terminated CAN network with power off?',['120 ohms','60 ohms','12 ohms','0 ohms'],1],
['What should be used when a training procedure requires electronic controller communication?',['The approved diagnostic interface','A timing light only','A tire gauge','A compression tester'],0],
['Diagnosis should begin by understanding and verifying what?',['Customer complaint','Parts price','Warranty claim','Service interval'],0],
['Freeze-frame data shows what?',['Operating conditions when a fault occurred','Student name','Parts inventory','Warranty expiration'],0],
['CAN High and CAN Low are primarily used for what?',['Controller communication','Starter current','Hydraulic pressure','Fuel return'],0],
['Best diagnostic practice?',['Replace the most common failed part','Verify inputs and outputs and prove the failure','Clear codes and release','Replace related sensors'],1],
['Low supply voltage can cause what?',['Communication and operating problems','Only cosmetic damage','Only paperwork errors','Only lubrication concerns'],0],
['When measuring resistance, the circuit should normally be what?',['De-energized','Powered','At full throttle','Under hydraulic load'],0],
['Live data helps a student do what?',['See controller inputs and outputs while operating','Program the radio','Check tire pressure','Print an invoice'],0]
];
const DEFAULT_HUNT = [
['Main Identification Label','Locate the primary equipment or station identification label and record the model, asset, or station ID.','identified'],
['Safety Device','Locate one required safety device or guard and identify its purpose.','safety'],
['Service / Inspection Point','Locate the assigned service, inspection, or maintenance point.','service'],
['Control / Operator Interface','Locate the primary control or operator interface used for the assigned function.','control'],
['Proof of Completion','Describe the observation or measurement that proves the task was completed correctly.','verified']
];

const HUNT_MODEL_SUGGESTIONS = ['Equipment 1','Equipment 2','Equipment 3','Machine A','Machine B','Workstation 1','Workstation 2','Custom Equipment'];
function isSpecialModel(model=''){ return false; }
function huntVerificationWord(station={}){
 const saved=String(station.expected||'').trim();
 const generic=new Set(['verified','verify','verification','complete','completed','done','ok','okay']);
 if(saved && !generic.has(saved.toLowerCase())) return saved;
 const label=String(station.item_label||station.station_name||'').trim();
 const upper=label.toUpperCase();
 const preferred=[
  ['FMCU','FMCU'],['ECU','ECU'],['BATTERY','BATTERY'],['FUSE','FUSE'],['CAM','CAM'],['CRANK','CRANK'],
  ['RAIL','RAIL'],['PTO','PTO'],['GROUND','GROUND'],['DIAGNOSTIC','DIAGNOSTIC'],['GARUDA','GARUDA'],
  ['PIGTAIL','PIGTAIL'],['SOLENOID','SOLENOID'],['CLUSTER','CLUSTER'],['COOLER','COOLER'],['EGR','EGR'],
  ['INLET','INLET'],['PEDAL','PEDAL'],['BRAKE','BRAKE'],['SPEED','SPEED'],['SWITCH','SWITCH'],
  ['FILTER','FILTER'],['PUMP','PUMP'],['CONNECTOR','CONNECTOR'],['SENSOR','SENSOR'],['VALVE','VALVE']
 ];
 for(const [key,word] of preferred) if(upper.includes(key)) return word;
 const stop=new Set(['THE','A','AN','AND','OR','OF','TO','FOR','ON','IN','AT','WITH','WITHOUT','MAIN','PRIMARY','ENGINE','TRACTOR','EQUIPMENT','STATION','LOCATION','POINT','CONTROL','CONTROLLER','ASSEMBLY','COMPONENT','COMPONENTS','SYSTEM','DEVICE','CENTER','CENTRE','POSITION','PRESSURE','TEMP','TEMPERATURE']);
 const tokens=upper.match(/[A-Z0-9]+/g)||[];
 return tokens.find(t=>t.length>=3&&!stop.has(t)) || tokens[0] || 'ITEM';
}

const HUNT_ITEM_LIBRARY = [
{id:'id_label',label:'Identification Label / Asset Tag',task:'Locate the primary identification label, asset tag, or station ID. Enter ID when complete.',expected:'id'},
{id:'safety_guard',label:'Safety Guard / Device',task:'Locate a required safety guard, interlock, emergency stop, or protective device. Enter SAFETY when complete.',expected:'safety'},
{id:'power_source',label:'Primary Power / Energy Source',task:'Locate the primary electrical, hydraulic, pneumatic, mechanical, or other energy source. Enter POWER when complete.',expected:'power'},
{id:'main_disconnect',label:'Main Disconnect / Isolation Point',task:'Locate the approved isolation or disconnect point used before service. Enter ISOLATE when complete.',expected:'isolate'},
{id:'control_panel',label:'Control Panel / Operator Interface',task:'Locate the main control panel, switch group, HMI, or operator interface. Enter CONTROL when complete.',expected:'control'},
{id:'service_point',label:'Service / Maintenance Point',task:'Locate the assigned service or maintenance point and identify its purpose. Enter SERVICE when complete.',expected:'service'},
{id:'inspection_point',label:'Inspection Point',task:'Locate a required inspection point and state what should be checked there. Enter INSPECT when complete.',expected:'inspect'},
{id:'sensor',label:'Sensor / Input Device',task:'Locate an input device, sensor, switch, or detector used by the system. Enter INPUT when complete.',expected:'input'},
{id:'actuator',label:'Output / Actuator',task:'Locate an output device, actuator, relay, valve, motor, lamp, or controlled load. Enter OUTPUT when complete.',expected:'output'},
{id:'network',label:'Communication / Network Connection',task:'Locate the communication, network, diagnostic, or data connection used by the system. Enter NETWORK when complete.',expected:'network'},
{id:'ground_return',label:'Ground / Return Path',task:'Locate the primary ground, return, or common path relevant to the assigned system. Enter GROUND when complete.',expected:'ground'},
{id:'test_point',label:'Diagnostic / Test Point',task:'Locate the approved diagnostic or measurement point and identify what is measured there. Enter TEST when complete.',expected:'test'},

// Restored tractor-specific scavenger-hunt library. These items are added to the existing generic library; nothing is removed.
{id:'m4600_operator_presence',models:['4600'],label:'4600 — Operator Presence Switch',task:'Locate the operator-presence switch and identify how it is used by the tractor safety logic. Enter PRESENCE when complete.',expected:'presence'},
{id:'m4600_battery_cutoff',models:['4600'],label:'4600 — Battery Cut-off Switch',task:'Locate the battery cut-off switch and identify its service/isolation purpose. Enter CUTOFF when complete.',expected:'cutoff'},
{id:'m4600_boost_temp',models:['4600'],label:'4600 — Boost Pressure & Temperature Sender',task:'Locate the boost-pressure and temperature sender and identify its connector. Enter BOOST when complete.',expected:'boost'},
{id:'m4600_pto_switch',models:['4600'],label:'4600 — PTO Switch',task:'Locate the PTO switch and identify the input it provides to the control system. Enter PTO when complete.',expected:'pto'},
{id:'m4600_wif',models:['4600'],label:'4600 — Water in Fuel Sensor',task:'Locate the water-in-fuel sensor and identify where it is serviced. Enter WIF when complete.',expected:'wif'},
{id:'m4600_brake_switch',models:['4600'],label:'4600 — Brake Switch',task:'Locate the brake switch/input and identify where its status can be verified. Enter BRAKE when complete.',expected:'brake'},
{id:'m4600_fuse_boxes',models:['4600'],label:'4600 — Fuse Box(s)',task:'Locate all fuse/relay boxes used on the tractor and identify the main service access. Enter FUSE when complete.',expected:'fuse'},
{id:'m4600_fmcu',models:['4600'],label:'4600 — FMCU',task:'Locate the FMCU and identify its connectors. Enter FMCU when complete.',expected:'fmcu'},
{id:'m4600_ecu',models:['4600'],label:'4600 — ECU',task:'Locate the engine ECU and identify the controller. Enter ECU when complete.',expected:'ecu'},
{id:'m4600_diag_port',models:['4600'],label:'4600 — Diagnostic Port',task:'Locate the tractor diagnostic port used for service-tool connection. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'m4600_trans_drains',models:['4600'],label:'4600 — Transmission Drain Plugs (All 4)',task:'Locate and identify all four transmission drain plugs. The item is complete only after all four drain-plug locations are verified. Enter FOUR when complete.',expected:'four'},

{id:'m5100_cam_phase',models:['5100','fifty one hundred'],label:'5100 — Cam Phase Sensor',task:'Locate the cam phase sensor and identify its connector. Enter CAM when complete.',expected:'cam'},
{id:'m5100_oil_pressure',models:['5100','fifty one hundred'],label:'5100 — Oil Pressure Switch',task:'Locate the engine oil-pressure switch and identify its connector. Enter OIL when complete.',expected:'oil'},
{id:'m5100_ecu',models:['5100','fifty one hundred'],label:'5100 — ECU',task:'Locate the engine ECU and identify the controller. Enter ECU when complete.',expected:'ecu'},
{id:'m5100_diag_port',models:['5100','fifty one hundred'],label:'5100 — Diagnostic Port',task:'Locate the tractor diagnostic port used for service-tool connection. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'m5100_battery',models:['5100','fifty one hundred'],label:'5100 — Battery',task:'Locate the battery and identify service access. Enter BATTERY when complete.',expected:'battery'},
{id:'m5100_battery_cutoff',models:['5100','fifty one hundred'],label:'5100 — Battery Cut-off Switch',task:'Locate the battery cut-off switch and identify its service/isolation purpose. Enter CUTOFF when complete.',expected:'cutoff'},
{id:'m5100_fmcu',models:['5100','fifty one hundred'],label:'5100 — FMCU',task:'Locate the FMCU and identify its connectors. Enter FMCU when complete.',expected:'fmcu'},
{id:'m5100_oil_cooler',models:['5100','fifty one hundred'],label:'5100 — Engine Oil Cooler',task:'Locate the engine oil cooler and identify its service location. Enter COOLER when complete.',expected:'cooler'},
{id:'m5100_accel_pedal',models:['5100','fifty one hundred'],label:'5100 — Accelerator Pedal Sensor',task:'Locate the accelerator-pedal-position sensor and identify its connector/mounting. Enter PEDAL when complete.',expected:'pedal'},

{id:'m6000_auto4wd',models:['6000','6065','6075'],label:'6000 — Auto 4WD Switch',task:'Locate the Auto 4WD switch and identify the available switch positions. Enter 4WD when complete.',expected:'4wd'},
{id:'m6000_fuse_boxes',models:['6000','6065','6075'],label:'6000 — Fuse Box(s)',task:'Locate all fuse/relay boxes used on the tractor and identify the main service access. Enter FUSE when complete.',expected:'fuse'},
{id:'m6000_diag_port',models:['6000','6065','6075'],label:'6000 — Diagnostic Port',task:'Locate the tractor diagnostic port used for service-tool connection. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'m6000_speed_sensor',models:['6000','6065','6075'],label:'6000 — Speed Sensor',task:'Locate the vehicle/transmission speed sensor used by the control system. Enter SPEED when complete.',expected:'speed'},
{id:'m6000_egr',models:['6000','6065','6075'],label:'6000 — EGR',task:'Locate the EGR assembly and identify its major electrical/flow connections. Enter EGR when complete.',expected:'egr'},
{id:'m6000_rail_pressure',models:['6000','6065','6075'],label:'6000 — Rail Pressure Sensor',task:'Locate the common-rail pressure sensor and identify its connector. Enter RAIL when complete.',expected:'rail'},
{id:'m6000_coolant_temp',models:['6000','6065','6075'],label:'6000 — Coolant Temperature Sensor',task:'Locate the engine coolant-temperature sensor and identify its connector. Enter COOLANT when complete.',expected:'coolant'},
{id:'m6000_fmcu',models:['6000','6065','6075'],label:'6000 — FMCU',task:'Locate the FMCU and identify its connectors. Enter FMCU when complete.',expected:'fmcu'},
{id:'m6000_ecu',models:['6000','6065','6075'],label:'6000 — ECU',task:'Locate the engine ECU and identify the controller. Enter ECU when complete.',expected:'ecu'},
{id:'m6000_intentional_pto',models:['6000','6065','6075'],label:'6000 — Intentional PTO Switch',task:'Locate the intentional PTO switch/input and identify its purpose in the PTO control logic. Enter PTO when complete.',expected:'pto'},
{id:'legacy_battery',label:'Battery Location',task:'Locate the battery and identify its location. Enter BATTERY when complete.',expected:'battery'},
{id:'legacy_air_cleaner',label:'Air Cleaner Location',task:'Locate the air cleaner assembly and identify how it is accessed for service. Enter AIR when complete.',expected:'air'},
{id:'legacy_diag_connector',label:'Diagnostic Connector',task:'Locate the tractor diagnostic connector and identify it. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'legacy_ecu',label:'Engine ECU / Controller',task:'Locate the engine ECU/controller and read the controller identification from the label. Enter ECU when complete.',expected:'ecu'},
{id:'legacy_fuse_box',label:'Fuse / Relay Center',task:'Locate the main fuse and relay center. Enter FUSE when you identify it.',expected:'fuse'},
{id:'legacy_main_ground',label:'Main Ground Point',task:'Locate a primary engine/chassis ground point identified in the service information. Enter GROUND when complete.',expected:'ground'},
{id:'legacy_crank_sensor',label:'Crankshaft Position Sensor',task:'Locate the crankshaft-position sensor. Enter CRANK when you identify it.',expected:'crank'},
{id:'legacy_cam_sensor',label:'Cam / Phase Sensor',task:'Locate the cam/phase sensor. Enter CAM when you identify it.',expected:'cam'},
{id:'legacy_rail_sensor',label:'Fuel Rail Pressure Sensor',task:'Locate the fuel-rail pressure sensor and connector. Enter RAIL when complete.',expected:'rail'},
{id:'legacy_fuel_filter',label:'Fuel Filter',task:'Locate the fuel-filter assembly and identify its service access. Enter FILTER when complete.',expected:'filter'},
{id:'legacy_hydraulic_pump',label:'Hydraulic Pump',task:'Locate the main hydraulic pump. Enter PUMP when you identify it.',expected:'pump'},
{id:'legacy_hydraulic_test',label:'Hydraulic Pressure Test Point',task:'Using service information, locate the specified hydraulic pressure test point. Enter TEST when complete.',expected:'test'},
{id:'legacy_pto_control',label:'PTO Control / Solenoid',task:'Locate the PTO control solenoid, valve, or actuator used on this tractor. Enter PTO when complete.',expected:'pto'},
{id:'legacy_three_point',label:'Three-Point Control Components',task:'Locate the primary three-point hitch control or valve components. Enter THREE when complete.',expected:'three'},
{id:'legacy_cluster',label:'Instrument Cluster',task:'Identify the instrument cluster and have the Verifier point out the major warning/indicator area. Enter CLUSTER when complete.',expected:'cluster'},
{id:'legacy_seat_presence',label:'Operator-Presence Seat Detector',task:'Locate the operator-presence detector/switch incorporated into the seat system. Enter SEAT when complete.',expected:'seat'},

// Restored 5100 Refresh hunt items.
{id:'refresh_battery_air',models:['5100','fifty one hundred'],label:'5100 Refresh — Battery & Air Cleaner Relocation',task:'Find the battery and air cleaner in their Refresh locations and discuss how those locations differ from the earlier tractor. Enter FRONT when complete.',expected:'front'},
{id:'refresh_app',models:['5100','fifty one hundred'],label:'5100 Refresh — Accelerator Pedal Sensor Mounting',task:'Locate the accelerator-pedal-position sensor and identify the revised mounting location. Enter APP when complete.',expected:'app'},
{id:'refresh_cooling',models:['5100','fifty one hundred'],label:'5100 Refresh — Water Pump / Crank Pulley',task:'Locate the modified water-pump area and changed crank pulley. Enter COOLING when both have been identified.',expected:'cooling'},
{id:'refresh_exhaust',models:['5100','fifty one hundred'],label:'5100 Refresh — DOC / Exhaust Arrangement',task:'Locate the integrated DOC/exhaust arrangement and identify the changed service layout. Enter DOC when complete.',expected:'doc'},
{id:'refresh_oil_cooler',models:['5100','fifty one hundred'],label:'5100 Refresh — Oil Cooler Location',task:'Locate the revised oil-cooler position. Enter COOLER when complete.',expected:'cooler'},
{id:'refresh_hyd_inlet',models:['5100','fifty one hundred'],label:'5100 Refresh — Hydraulic Pump Inlet Pipe',task:'Locate the modified hydraulic-pump inlet-pipe area and identify the improved pump mounting-bolt access. Enter INLET when complete.',expected:'inlet'},
{id:'refresh_egr',models:['5100','fifty one hundred'],label:'5100 Refresh — EGR Mounting',task:'Locate the EGR assembly and identify the revised mounting arrangement. Enter EGR when complete.',expected:'egr'},
{id:'refresh_oil_fill',models:['5100','fifty one hundred'],label:'5100 Refresh — Engine Oil Fill Location',task:'Locate the revised engine-oil fill location. Enter OIL when complete.',expected:'oil'},

// Restored FMCU hunt library.
{id:'fmcu_controller',group:'fmcu',label:'FMCU Controller Location',task:'Locate the FMCU on the tractor and identify the controller. Enter FMCU when complete.',expected:'fmcu'},
{id:'fmcu_diag_connector',group:'fmcu',label:'FMCU Diagnostic Connector',task:'Locate the correct FMCU diagnostic connector for this tractor. Enter CONNECTOR when complete.',expected:'connector'},
{id:'fmcu_garuda',group:'fmcu',label:'Garuda Interface',task:'Identify the Garuda vehicle interface used to connect the laptop to the tractor network. Enter GARUDA when complete.',expected:'garuda'},
{id:'fmcu_pigtail',group:'fmcu',label:'Correct Diagnostic Pigtail',task:'Identify the correct diagnostic pigtail for this tractor configuration. Enter PIGTAIL when verified.',expected:'pigtail'},
{id:'fmcu_power',group:'fmcu',label:'FMCU Battery Feed',task:'Using the wiring/service information, locate the FMCU battery-feed circuit or fuse. Enter POWER when identified.',expected:'power'},
{id:'fmcu_ignition',group:'fmcu',label:'FMCU Ignition / Wake-Up Feed',task:'Locate the FMCU ignition or wake-up feed circuit. Enter WAKE when identified.',expected:'wake'},
{id:'fmcu_ground',group:'fmcu',label:'FMCU Ground Path',task:'Locate the FMCU ground path or primary ground point. Explain where you would voltage-drop test it. Enter GROUND when complete.',expected:'ground'},
{id:'fmcu_input',group:'fmcu',label:'FMCU Input Circuit',task:'Choose one FMCU switch or sensor input, locate its circuit/component, and identify where live data would confirm its state. Enter INPUT when complete.',expected:'input'},
{id:'fmcu_output',group:'fmcu',label:'FMCU Output Circuit',task:'Locate one FMCU-controlled relay, solenoid, lamp, or actuator and identify where output voltage would be measured. Enter OUTPUT when complete.',expected:'output'},
{id:'fmcu_harness',group:'fmcu',label:'Harness / Connector Inspection Point',task:'Find a harness or connector area where rub-through, backed-out terminals, corrosion, or movement could create an intermittent fault. Enter HARNESS when complete.',expected:'harness'},
{id:'fmcu_network',group:'fmcu',label:'Network Communication Path',task:'Trace the diagnostic communication path from laptop to Garuda to pigtail to vehicle network to FMCU. Enter NETWORK when complete.',expected:'network'},
{id:'fmcu_mecare',group:'fmcu',label:'Me Care Programming Tool',task:'Identify the tool used for FMCU programming and state the battery-voltage precaution before flashing. Enter MECARE when complete.',expected:'mecare'},

// Restored Auto 4WD hunt library.
{id:'auto4wd_switch',group:'auto4wd',label:'Auto 4WD Mode Switch',task:'Locate the Auto 4WD switch and identify positions A, B, and C. Enter SWITCH when complete.',expected:'switch'},
{id:'auto4wd_brake_lh',group:'auto4wd',label:'Left Brake Input',task:'Locate the left-brake input/switch used by Auto 4WD logic and identify where its state is checked. Enter LEFT when complete.',expected:'left'},
{id:'auto4wd_brake_rh',group:'auto4wd',label:'Right Brake Input',task:'Locate the right-brake input/switch used by Auto 4WD logic and identify where its state is checked. Enter RIGHT when complete.',expected:'right'},
{id:'auto4wd_speed',group:'auto4wd',label:'Vehicle Speed Input',task:'Identify the vehicle-speed input/source used by Auto 4WD logic and where the technician verifies the live speed value. Enter SPEED when complete.',expected:'speed'},
{id:'auto4wd_controller',group:'auto4wd',label:'Auto 4WD Controller / FMCU',task:'Locate the controller responsible for Auto 4WD logic. Enter FMCU when complete.',expected:'fmcu'},
{id:'auto4wd_output',group:'auto4wd',label:'4WD Output Circuit',task:'Locate the 4WD output circuit leading from the controller toward the 4WD hardware. Enter OUTPUT when complete.',expected:'output'},
{id:'auto4wd_solenoid',group:'auto4wd',label:'4WD Solenoid / Actuator',task:'Locate the 4WD solenoid, clutch, or actuator hardware and identify its connector. Enter SOLENOID when complete.',expected:'solenoid'},
{id:'auto4wd_telltale',group:'auto4wd',label:'4WD Telltale / Indicator',task:'Locate the 4WD indicator and identify where the controller command can be compared with the displayed telltale. Enter LAMP when complete.',expected:'lamp'},
{id:'auto4wd_low_logic',group:'auto4wd',label:'Auto Mode — Below 14 km/h',task:'Set or describe Auto mode with no brakes below 14 km/h and identify the expected driveline state. Enter 4WD when complete.',expected:'4wd'},
{id:'auto4wd_high_logic',group:'auto4wd',label:'Auto Mode — Above 15 km/h',task:'Set or describe Auto mode with no brakes above 15 km/h and identify the expected driveline state. Enter 2WD when complete.',expected:'2wd'},
{id:'auto4wd_both_brakes',group:'auto4wd',label:'Both-Brakes Logic Check',task:'Apply or describe both brakes and identify the expected Auto 4WD state. Enter 4WD when complete.',expected:'4wd'},
{id:'auto4wd_one_brake',group:'auto4wd',label:'One-Brake Logic Check',task:'Apply or describe one brake and identify the expected Auto 4WD state. Enter 2WD when complete.',expected:'2wd'},

{id:'ppe',group:'fmcu',label:'Required PPE',task:'Identify the PPE required for this task or work area. Enter PPE when complete.',expected:'ppe'},
{id:'lockout',group:'fmcu',label:'Lockout / Tagout Point',task:'Locate the approved lockout/tagout or energy-isolation point. Enter LOTO when complete.',expected:'loto'},
{id:'hazard',group:'fmcu',label:'Primary Hazard',task:'Identify the primary hazard associated with this equipment or station. Enter HAZARD when complete.',expected:'hazard'},
{id:'safe_state',group:'fmcu',label:'Verified Safe State',task:'Identify how the operator or student verifies the equipment is in a safe state before work begins. Enter SAFE when complete.',expected:'safe'},
{id:'input_logic',group:'auto4wd',label:'Required Input / Condition',task:'Identify an input or condition that must be true before the function can occur. Enter INPUT when complete.',expected:'input'},
{id:'decision_logic',group:'auto4wd',label:'Control / Decision Logic',task:'Identify where the operating logic, procedure, or controller decision is defined. Enter LOGIC when complete.',expected:'logic'},
{id:'command_path',group:'auto4wd',label:'Command Path',task:'Trace the command from the operator/process request to the controlled output. Enter COMMAND when complete.',expected:'command'},
{id:'feedback_path',group:'auto4wd',label:'Feedback / Verification',task:'Identify the feedback, indication, measurement, or confirmation used to prove the command occurred. Enter VERIFY when complete.',expected:'verify'}
];
const HUNT_TYPES = {general:'General Equipment / Station Hunt',fmcu:'Safety / Inspection Hunt',auto4wd:'Process / Logic Hunt'};
function huntItemVisible(item,huntType,model){
 if(huntType==='fmcu') return item.group==='fmcu';
 if(huntType==='auto4wd') return item.group==='auto4wd';
 if(item.group) return false;
 if(!item.models||!item.models.length) return true;
 const m=String(model||'').toLowerCase();
 return item.models.some(x=>m.includes(String(x).toLowerCase()));
}

const HUNT_ROLES=[
{name:'Navigator',duty:'Read the station task and use the service information.'},
{name:'Locator',duty:'Physically locate the requested component, connector, test point, or system.'},
{name:'Tool Operator',duty:'Operate the DVOM, diagnostic laptop/interface, gauge, or other required tool.'},
{name:'Recorder',duty:'Enter the verified answer or measurement into the Training Hub.'},
{name:'Verifier',duty:'Confirm the item is correctly identified and explain what was learned before moving on.'}
];
const HUNT_MAX_TRACTORS=5, HUNT_TEAM_NAMES=['RED TEAM','BLACK TEAM','GRAY TEAM','BLUE TEAM','GOLD TEAM'];
function huntTeamInfo(rosterIndex,tractorCount=3){tractorCount=Math.min(5,Math.max(1,Number(tractorCount)||3));const teamIndex=rosterIndex%tractorCount;const memberSlot=Math.floor(rosterIndex/tractorCount)%HUNT_ROLES.length;const rotation=[];for(let i=0;i<tractorCount;i++)rotation.push(((teamIndex+i)%tractorCount)+1);return {name:HUNT_TEAM_NAMES[teamIndex]||`TEAM ${teamIndex+1}`,teamIndex,memberSlot,rotation};}
function huntRoleForStation(memberSlot,stationNumber){return HUNT_ROLES[(memberSlot+Math.max(0,stationNumber-1))%HUNT_ROLES.length];}

const DIAGNOSTIC_SIMULATIONS = {
 'starter-no-operation':{
  key:'starter-no-operation',series:'General Equipment',level:'Level 2',title:'System Will Not Operate',model:'Equipment 1',workOrder:'SIM-GEN-001',hours:100,complaint:'The operator reports that the commanded function does not operate.',assignment:'Verify the complaint, gather evidence, prove the failed path, select the correct repair, and verify operation before replacing parts.',
  rootCauses:[
   {key:'power_supply',diagnosis:'High resistance in the power-supply path',repair:'Repair the high-resistance connection, verify loaded voltage, and confirm normal operation',proof:['loaded_voltage','voltage_drop'],replacementAction:'repair_power',points:{loaded_voltage:20,voltage_drop:20},overrides:{live_data:'Command input: ON | Controller status: enabled | Output feedback: inactive',loaded_voltage:'Supply voltage at the load drops below specification when the function is commanded.',voltage_drop:'Excessive voltage drop is measured across the supply connection under load.'}},
   {key:'open_output',diagnosis:'Open circuit between the controller and the commanded load',repair:'Repair the open output circuit and verify loaded command voltage and operation',proof:['command_test','continuity_test'],replacementAction:'repair_harness',points:{command_test:20,continuity_test:20},overrides:{live_data:'Command input: ON | Controller output request: ON | Load feedback: inactive',command_test:'Correct command is present at the controller but not at the load connector.',continuity_test:'The output circuit is open between the controller and load.'}}
  ],
  actions:[
   {key:'verify_complaint',category:'Visual Inspection',label:'Verify the Complaint',points:10,stage:1,result:'Complaint verified under the stated operating conditions.'},
   {key:'fault_codes',category:'Fault Codes',label:'Check Available Fault Information',points:10,stage:2,result:'Fault information reviewed.'},
   {key:'live_data',category:'Live Data',label:'Compare Commanded State to Actual State',points:15,stage:2,evidenceRequired:true,result:'Relevant live data reviewed.'},
   {key:'wiring',category:'Wiring Diagram',label:'Review the Related Circuit / Logic',points:0,stage:2,evidenceRequired:true,result:'Related circuit and control logic reviewed.'},
   {key:'loaded_voltage',category:'Multimeter',label:'Measure Loaded Supply Voltage',points:0,stage:3,evidenceRequired:true,result:'Loaded supply voltage measured.'},
   {key:'voltage_drop',category:'Multimeter',label:'Perform Voltage-Drop Test Under Load',points:0,stage:3,evidenceRequired:true,result:'Voltage-drop test completed under load.'},
   {key:'command_test',category:'Multimeter',label:'Measure Controller Command at the Load',points:0,stage:3,evidenceRequired:true,result:'Command circuit tested under operating conditions.'},
   {key:'continuity_test',category:'Component Tests',label:'Isolate and Test the Output Circuit',points:0,stage:3,evidenceRequired:true,result:'Output circuit isolated and tested.'},
   {key:'repair_power',category:'Replace Part',label:'Repair Power-Supply Connection',penalty:15,stage:5,result:'PARTS CANNON PENALTY: repair selected before the failure was proven.'},
   {key:'repair_harness',category:'Replace Part',label:'Repair Output Harness / Connection',penalty:15,stage:5,result:'PARTS CANNON PENALTY: repair selected before the failure was proven.'}
  ]
 }
};

// 2.1.33 — twenty Training Hub diagnostic simulations: 10 in each 105-minute segment.
function makeSegmentDiagnostic(cfg){
 const proof=cfg.proof||['live_data','circuit_test'];
 return {key:cfg.key,series:cfg.series,level:'Level 2',title:cfg.title,model:'Equipment 1',workOrder:cfg.workOrder,hours:0,complaint:cfg.complaint,
  assignment:'Verify the complaint, follow the diagnostic path in order, prove the root cause with evidence, make only the supported repair, and verify the repair.',difficulty:'Intermediate',passScore:80,maxPartsPenalties:1,
  instructorSetup:'Plant only the selected controlled fault. Keep the root cause hidden and confirm the complaint is reproducible before release.',
  toolsNeeded:'Diagnostic interface as applicable, digital multimeter, current service information/wiring diagram, and normal hand tools.',plantFault:cfg.diagnosis,expectedReadings:cfg.evidence,
  resetProcedure:'Restore the system to normal, clear related faults when applicable, and verify normal operation before the next technician.',safetyNotes:'Follow all equipment safety procedures and control stored energy before opening circuits or connectors.',
  rootCauses:[{key:'planted_fault',diagnosis:cfg.diagnosis,repair:cfg.repair,proof:proof,replacementAction:'supported_repair',points:Object.fromEntries(proof.map(k=>[k,20])),overrides:{live_data:cfg.live||'Live data does not agree with the expected physical state or command logic.',circuit_test:cfg.evidence,network_test:cfg.evidence,pressure_test:cfg.evidence}}],
  actions:[
   {key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,stage:1,result:'Complaint verified under the stated operating conditions.'},
   {key:'fault_codes',category:'Fault Codes',label:'Read and Record Fault Codes',points:10,stage:2,result:'Fault information recorded.'},
   {key:'live_data',category:'Live Data',label:'Compare Live Data to Physical Machine State',points:15,stage:2,evidenceRequired:true,result:'Relevant inputs, commands, and feedback reviewed.'},
   {key:'service_info',category:'Service Information',label:'Review Wiring / Logic / Service Information',points:5,stage:2,evidenceRequired:true,result:'Related circuit and operating logic reviewed.'},
   {key:'circuit_test',category:'Multimeter',label:cfg.testLabel||'Perform the Proving Circuit Test Under Load',points:0,stage:3,evidenceRequired:true,result:'Proving circuit test completed under the complaint condition.'},
   {key:'network_test',category:'Component Tests',label:'Perform Network / Signal Integrity Test',points:0,stage:3,evidenceRequired:true,result:'Network or signal integrity test completed.'},
   {key:'pressure_test',category:'Component Tests',label:'Verify Output / Actuation Response',points:0,stage:3,evidenceRequired:true,result:'Output or actuation response verified.'},
   {key:'supported_repair',category:'Replace Part',label:'Perform the Supported Repair',penalty:15,stage:5,result:'PARTS CANNON PENALTY: repair selected before the failure was proven.'}
  ]};
}
const SEGMENT_DIAGNOSTIC_CONFIGS = [
 ['seg1-no-crank-permissive','Segment 1 — Inputs & Logic','No Crank — Bad Battery / Starting Circuit','SIM-S1-001','Key is turned to START but the starter does not crank.','Battery voltage collapses under starter load because the battery is weak or internally failed','Replace the proven failed battery, clean/tighten connections as needed, and verify cranking voltage and starter operation',['circuit_test'],'Open-circuit voltage may appear acceptable, but battery voltage drops below specification when a starter load is applied.'],
 ['seg1-pto-no-engage','Segment 1 — Inputs & Logic','PTO Will Not Engage','SIM-S1-002','The PTO switch is selected ON but the PTO does not engage.','The FMCU is missing a required PTO-enable input or interlock condition','Correct the failed input/interlock condition and verify PTO engagement',['live_data','circuit_test'],'Live data identifies the missing enable condition and circuit testing proves the failed input path.'],
 ['seg1-auto4wd-brake','Segment 1 — Inputs & Logic','Auto 4WD Does Not Engage During Braking','SIM-S1-003','Above the operating-speed threshold, both brake pedals are applied but Auto 4WD does not engage.','One brake input is not being recognized by the FMCU','Repair or adjust the failed brake-switch/input circuit and verify Auto 4WD operation',['live_data','circuit_test'],'One brake input remains inactive in live data when both pedals are physically applied.'],
 ['seg1-auto4wd-speed','Segment 1 — Inputs & Logic','Auto 4WD Logic Incorrect — Speed Input','SIM-S1-004','Auto 4WD engagement or disengagement does not match tractor speed.','Vehicle-speed input to the control logic is incorrect or missing','Restore the speed-signal circuit and verify Auto 4WD logic at the correct speed condition',['live_data','circuit_test'],'Controller speed does not agree with actual movement and signal testing proves the speed-input fault.'],
 ['seg1-ops-input','Segment 1 — Inputs & Logic','Operator Presence Input Does Not Change','SIM-S1-005','A safety-controlled function is inhibited even though the operator is seated.','OPS input state does not match the actual seat condition','Repair or adjust the OPS switch/circuit and verify seated and unseated states',['live_data','circuit_test'],'OPS live data remains in the wrong state while the seat switch is physically operated.'],
 ['seg1-brake-switch','Segment 1 — Inputs & Logic','Brake Switch Input Disagreement','SIM-S1-006','Brake-related control logic behaves inconsistently when both pedals are applied.','Left and right brake input states disagree because one switch or circuit is faulty','Correct the switch adjustment/circuit and verify both brake inputs transition together',['live_data','circuit_test'],'One brake input changes and the other does not; circuit testing isolates the failed side.'],
 ['seg1-neutral-input','Segment 1 — Inputs & Logic','Neutral Input Prevents Start','SIM-S1-007','Tractor is physically in neutral but the starter remains inhibited.','Neutral switch input is not reaching the FMCU as an active neutral condition','Repair or adjust the neutral switch/input circuit and verify neutral state in live data',['live_data','circuit_test'],'Physical transmission position is neutral while FMCU data indicates not-neutral.'],
 ['seg1-pto-switch-input','Segment 1 — Inputs & Logic','PTO Switch Input Does Not Change','SIM-S1-008','The PTO switch is moved ON and OFF but the controller does not respond.','PTO switch input circuit is open or high resistance and the FMCU never sees the state change','Repair the PTO switch/input circuit and verify ON/OFF state changes',['live_data','circuit_test'],'Physical switch position changes while live data stays fixed; testing proves the input fault.'],
 ['seg1-starter-command','Segment 1 — Inputs & Logic','All Start Inputs Good — No Starter Relay Command','SIM-S1-009','All start conditions appear satisfied but the starter relay is not commanded.','Starter-relay control path from the FMCU to the relay is open or high resistance','Repair the starter-relay control path and verify relay command and normal cranking',['live_data','circuit_test'],'Permissives are satisfied; command is present at the controller but lost before the relay.'],
 ['seg1-intermittent-input','Segment 1 — Inputs & Logic','Intermittent Safety Input — Connector Pin Tension','SIM-S1-010','A safety-controlled function intermittently drops out when the tractor vibrates or the harness is moved.','Poor connector pin tension causes an intermittent input signal','Repair the terminal/connector and verify stable live data during a wiggle test',['live_data','circuit_test'],'Live data flickers during harness movement and terminal testing confirms poor contact.'],
 ['seg2-fmcu-power-drop','Segment 2 — Circuit Proof & Networks','FMCU Intermittent — High Resistance Power Feed','SIM-S2-001','Multiple controlled functions become intermittent under electrical load.','High resistance in the FMCU power-supply path','Repair the high-resistance power connection and verify loaded voltage and normal operation',['circuit_test'],'FMCU supply voltage drops excessively only when the circuit is loaded.'],
 ['seg2-fmcu-ground','Segment 2 — Circuit Proof & Networks','FMCU Ground Voltage Drop','SIM-S2-002','Controller functions are erratic and multiple outputs are weak or intermittent.','Excessive resistance in the FMCU ground path','Repair the ground path and verify ground-side voltage drop under load',['circuit_test'],'Ground-side voltage drop exceeds acceptable limits while the system is operating.'],
 ['seg2-can-communication','Segment 2 — Circuit Proof & Networks','FMCU / ECU Communication Fault','SIM-S2-003','A controller is missing from diagnostics and related data is unavailable.','Open or high-resistance CAN connection on the affected controller branch','Repair the CAN branch and verify network communication and controller visibility',['network_test'],'Network measurements and isolation identify the affected communication branch.'],
 ['seg2-can-termination','Segment 2 — Circuit Proof & Networks','CAN Network Resistance Incorrect','SIM-S2-004','Multiple modules intermittently lose communication.','One network termination path is open, producing incorrect total CAN resistance','Restore the missing termination/network path and verify approximately 60 ohms with power off',['network_test'],'Power-off network resistance is approximately 120 ohms instead of approximately 60 ohms.'],
 ['seg2-pto-output','Segment 2 — Circuit Proof & Networks','PTO Command Present — Solenoid Does Not Operate','SIM-S2-005','FMCU live data shows PTO output commanded ON but the PTO solenoid does not actuate.','Open or high-resistance output circuit between FMCU command and PTO solenoid','Repair the output circuit and verify loaded voltage and PTO operation',['live_data','circuit_test'],'Command is ON in live data, but loaded voltage is lost before the PTO solenoid.'],
 ['seg2-e4wd-solenoid','Segment 2 — Circuit Proof & Networks','E4WD Command Present — No Front Axle Engagement','SIM-S2-006','FMCU commands Auto 4WD, but the front axle does not engage.','E4WD solenoid circuit is open or the solenoid coil is electrically failed','Repair the circuit or replace the proven failed solenoid, then verify axle engagement',['live_data','circuit_test','pressure_test'],'Command is present; testing proves the solenoid/output fault before mechanical verification.'],
 ['seg2-relay-contacts','Segment 2 — Circuit Proof & Networks','Relay Clicks — Load Does Not Operate','SIM-S2-007','The relay can be heard clicking, but the controlled load does not operate.','Burned or high-resistance relay load contacts','Replace the proven failed relay and verify full loaded voltage reaches the load',['circuit_test'],'Relay coil operates, but excessive voltage drop is measured across the load contacts.'],
 ['seg2-5v-reference','Segment 2 — Circuit Proof & Networks','5-Volt Reference Pulled Low','SIM-S2-008','Several sensor values are implausible and related faults are present.','A sensor or circuit fault is pulling the shared 5-volt reference low','Isolate and repair the failed sensor/circuit, restore 5 volts, and verify sensor values',['live_data','circuit_test'],'Reference voltage is low; isolating branches restores 5 volts and identifies the affected circuit.'],
 ['seg2-harness-vibration','Segment 2 — Circuit Proof & Networks','Intermittent Harness Fault Under Vibration','SIM-S2-009','The fault appears only with vibration or when a specific harness section is moved.','Partially broken conductor or poor terminal contact creates an intermittent open/high resistance','Repair the conductor or terminal and verify the signal stays stable during movement',['live_data','circuit_test'],'Wiggle test changes the signal and testing isolates the affected harness section.'],
 ['seg2-final-validation','Segment 2 — Circuit Proof & Networks','Repair Complete — DTC Returns During Validation','SIM-S2-010','A repair was made and the DTC was cleared, but the fault returns during validation.','The original circuit fault was not fully corrected and fails again under load','Re-test under the exact complaint condition, correct the remaining fault, clear DTCs, and complete validation',['circuit_test','pressure_test'],'Static checks pass, but loaded operating-condition testing reproduces the remaining fault.']
];
for(const c of SEGMENT_DIAGNOSTIC_CONFIGS){
 const [key,series,title,workOrder,complaint,diagnosis,repair,proof,evidence]=c;
 DIAGNOSTIC_SIMULATIONS[key]=makeSegmentDiagnostic({key,series,title,workOrder,complaint,diagnosis,repair,proof,evidence});
}

// 2.1.50 — SIM-S1-001 is a starting-system diagnostic with multiple instructor-selectable root causes.
{
 const sim=DIAGNOSTIC_SIMULATIONS['seg1-no-crank-permissive'];
 if(sim){
  sim.rootCauses=[
   {key:'bad_battery',diagnosis:'Weak / failed battery — voltage collapses under starter load',repair:'Replace the proven failed battery, service the terminals as needed, and verify cranking voltage and normal starter operation',proof:['circuit_test'],replacementAction:'supported_repair',points:{circuit_test:40},overrides:{live_data:'Start request and permissive conditions are present. Battery supply becomes unstable when cranking is attempted.',circuit_test:'Battery open-circuit voltage may look normal, but voltage drops below specification during a loaded cranking/battery test.'}},
   {key:'battery_connection',diagnosis:'High resistance at a battery terminal or cable connection',repair:'Clean, tighten, or repair the high-resistance battery connection and verify acceptable voltage drop while cranking',proof:['circuit_test'],replacementAction:'supported_repair',points:{circuit_test:40},overrides:{live_data:'Start request is present but cranking is weak or absent.',circuit_test:'Voltage-drop testing shows excessive loss across a battery terminal or cable connection during the crank request.'}},
   {key:'ground_cable',diagnosis:'High resistance in the battery negative / engine ground path',repair:'Repair the ground path and verify ground-side voltage drop while cranking',proof:['circuit_test'],replacementAction:'supported_repair',points:{circuit_test:40},overrides:{live_data:'Start request is present but available starter current is limited.',circuit_test:'Ground-side voltage drop exceeds specification during the crank request.'}},
   {key:'start_permissive',diagnosis:'A required start-permissive input is not reaching the FMCU correctly',repair:'Repair the failed permissive input circuit or switch, verify the input changes correctly in live data, and confirm normal cranking',proof:['live_data','circuit_test'],replacementAction:'supported_repair',points:{live_data:20,circuit_test:20},overrides:{live_data:'Physical switch state and FMCU live data disagree.',circuit_test:'Circuit testing isolates the failed start-permissive input path.'}}
  ];
  sim.plantFault='Select one root cause before release. For the standard SIM-S1-001 exercise, use Weak / failed battery unless the instructor intentionally chooses another starting-system fault.';
  sim.expectedReadings='For a bad battery, verify battery voltage under load/cranking. A weak or internally failed battery will show excessive voltage collapse under starter load.';
 }
}

const DEFAULT_MASTER_CHALLENGE = {
 key:'master-general-diagnostic',series:'General Equipment',level:'Master',model:'Equipment 1',workOrder:'MASTER-GEN-001',hours:250,
 title:'Master Diagnostic Challenge',complaint:'The equipment has an intermittent operating fault that becomes more noticeable under load.',assignment:'Use a disciplined diagnostic process to define the symptom, gather evidence, isolate the failed path, prove the root cause, complete the supported repair, and verify the result.',
 passScore:85,maxPartsPenalties:1,targetMinutes:45,
 instructorSetup:'Create one controlled fault that can be safely reproduced. Do not reveal the planted root cause to the student.',
 toolsNeeded:'Approved service information, diagnostic interface when applicable, digital multimeter, and normal test equipment.',
 plantFault:'Select one root cause and create only that controlled fault.',
 expectedReadings:'Expected evidence is defined by the selected root cause and should be confirmed before a repair is chosen.',
 resetProcedure:'Return all connections, settings, and components to the original condition and verify normal operation before the next attempt.',
 safetyNotes:'Follow all company safety procedures and equipment-specific lockout/tagout requirements.',
 rootCauses:[
  {key:'supply_fault',diagnosis:'Loaded power-supply voltage is below specification because of excessive circuit resistance',repair:'Repair the high-resistance power or ground connection and verify voltage under load',proof:['loaded_voltage','voltage_drop'],points:{loaded_voltage:20,voltage_drop:20},overrides:{}},
  {key:'signal_fault',diagnosis:'The controller receives an incorrect or missing input signal',repair:'Repair the input circuit or failed input device after proving power, ground, signal, and wiring',proof:['live_data','input_test'],points:{live_data:20,input_test:20},overrides:{}}
 ],
 actions:[
  {key:'verify_complaint',category:'Visual Inspection',label:'Verify and Define the Complaint',points:10,stage:1,result:'Complaint verified.'},
  {key:'fault_codes',category:'Fault Codes',label:'Gather Fault / Event Information',points:10,stage:2,result:'Fault information gathered.'},
  {key:'live_data',category:'Live Data',label:'Compare Inputs, Commands, and Feedback',points:15,stage:2,evidenceRequired:true,result:'Operating data compared.'},
  {key:'service_info',category:'Service Information',label:'Review Service Information and Diagnostic Logic',points:5,stage:2,evidenceRequired:true,result:'Service information reviewed.'},
  {key:'loaded_voltage',category:'Multimeter',label:'Measure Supply Voltage Under Load',points:0,stage:3,evidenceRequired:true,result:'Loaded voltage measured.'},
  {key:'voltage_drop',category:'Multimeter',label:'Perform Power / Ground Voltage-Drop Tests',points:0,stage:3,evidenceRequired:true,result:'Voltage-drop tests completed.'},
  {key:'input_test',category:'Component Tests',label:'Test the Suspect Input Circuit',points:0,stage:3,evidenceRequired:true,result:'Input circuit tested.'}
 ]
};

const MASTER_CHALLENGE_CACHE = {};
function masterChallengeByKey(key){ return MASTER_CHALLENGE_CACHE[key] || null; }
function allMasterChallenges(){ return Object.values(MASTER_CHALLENGE_CACHE); }

const SIMULATION_OVERRIDE_CACHE = {};
function editableSimulation(key){ return SIMULATION_OVERRIDE_CACHE[key] || DIAGNOSTIC_SIMULATIONS[key] || null; }
function allSimulationKeys(){ return [...new Set([...Object.keys(DIAGNOSTIC_SIMULATIONS),...Object.keys(SIMULATION_OVERRIDE_CACHE)])]; }
function inferActionStage(a){
 if(a.stage) return Math.min(6,Math.max(1,Number(a.stage)||1));
 const k=(a.key||'').toLowerCase(), c=(a.category||'').toLowerCase();
 if(k==='verify_repair'||k.includes('verify_repair')) return 6;
 if(c==='replace part'||k.startsWith('replace_')) return 5;
 if(k==='verify_complaint') return 1;
 if(c.includes('fault')||c.includes('live data')||c.includes('wiring')||c.includes('service information')||c.includes('repair history')) return 2;
 if(c.includes('multimeter')||c.includes('pressure')||c.includes('component')) return 3;
 return 2;
}
function ensureSimulationDefaults(sim){
 if(!sim) return null;
 sim.difficulty=sim.difficulty||'Intermediate';
 sim.passScore=Math.min(100,Math.max(0,Number(sim.passScore)||80));
 sim.maxPartsPenalties=Math.max(0,Number.isFinite(Number(sim.maxPartsPenalties))?Number(sim.maxPartsPenalties):1);
 sim.prerequisiteHunt=sim.prerequisiteHunt||'none';
 sim.instructorSetup=sim.instructorSetup||'Set the equipment up so the complaint can be reproduced safely. Keep the planted failure hidden from the student.';
 sim.toolsNeeded=sim.toolsNeeded||'Laptop/diagnostic interface as applicable, digital multimeter, current Service Information, and normal hand tools.';
 sim.plantFault=sim.plantFault||'Use the selected planted root cause. Create only one controlled fault at a time.';
 sim.expectedReadings=sim.expectedReadings||'Use the root-cause-specific test results in this simulation as the expected evidence.';
 sim.resetProcedure=sim.resetProcedure||'Return the equipment to normal condition, clear/reset any related faults, and verify normal operation before the next student.';
 sim.safetyNotes=sim.safetyNotes||'Follow all company and equipment safety procedures. Secure the equipment as required and do not bypass safety interlocks unless an approved training procedure specifically requires it.';
 sim.hints=Array.isArray(sim.hints)&&sim.hints.length?sim.hints:[
  'Start with the complaint and ask what the controller must see before the function can occur.',
  'Compare the physical equipment condition to live data, then choose the signal or circuit that does not agree.',
  'Before replacing anything, prove the failed path with a measurement under the complaint condition.'
 ];
 sim.actions=Array.isArray(sim.actions)?sim.actions:[];
 if(!sim.actions.some(a=>a.key==='verify_repair')) sim.actions.push({key:'verify_repair',category:'Repair Verification',label:'Verify Repair Under Original Complaint Conditions',points:10,stage:6,evidenceRequired:true,result:'Repeat the original complaint conditions. Confirm the system now operates correctly and record the verification evidence.'});
 const proofKeys=new Set((sim.rootCauses||[]).flatMap(r=>r.proof||[]));
 for(const a of sim.actions){
  a.stage=inferActionStage(a);
  if(a.evidenceRequired===undefined) a.evidenceRequired=proofKeys.has(a.key)||['Live Data','Wiring Diagram','Multimeter','Pressure Tests','Component Tests'].includes(a.category)||a.key==='verify_repair';
  if(!a.whyPrompt && (proofKeys.has(a.key)||Number(a.points||0)>0||a.key==='verify_repair')){
   a.whyPrompt='Why is this step appropriate at this point in the diagnostic process?';
   a.whyCorrect='It proves the current part of the diagnostic path before a component is replaced.';
   a.whyWrong1='Because the fault code or symptom already proves which part has failed.';
   a.whyWrong2='Because replacing the most likely part first is the fastest diagnostic method.';
  }
 }
 return sim;
}

const ALL_TRACTOR_MODELS = ['Equipment 1','Equipment 2','Machine A','Machine B','Workstation 1','Custom Equipment'];
function tractorChoicesForSim(sim){ return ALL_TRACTOR_MODELS; }
function validTractorForSim(sim,model){ return String(model||'').trim().length>0; }
function simulationDisplayTitle(sim,model){
 return sim.title;
}
function simByKey(key){ return ensureSimulationDefaults(editableSimulation(key)); }
function rootCauseByKey(sim,key){ return sim?.rootCauses?.find(x=>x.key===key)||null; }
function simForRoot(key,rootKey){
 const base=simByKey(key), root=rootCauseByKey(base,rootKey); if(!base||!root) return null;
 return {...base,correctDiagnosis:root.diagnosis,correctRepair:root.repair,rootCauseKey:root.key,rootCause:root,actions:base.actions.map(a=>({...a,points:(a.key==='verify_complaint'||a.key==='fault_codes'||a.key==='live_data')?(a.points||0):(root.points?.[a.key]||0),result:(root.overrides?.[a.key]||a.result)}))};
}
async function getSimulationAssignment(classId,simulationKey){
 const q=await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND simulation_key=$2 AND enabled=true`,[classId,simulationKey]);
 const row=q.rows[0]||null; if(!row)return null;
 // 2.1.56 — self-heal assignments created by an older simulation definition whose root-cause key no longer exists.
 // This is especially important for SIM-S1-001, which changed from the old generic 'planted_fault' key to 'bad_battery'.
 const sim=simByKey(simulationKey);
 if(sim&&!rootCauseByKey(sim,row.root_cause_key)){
  const fallback=sim.rootCauses?.[0]?.key||'';
  if(fallback){
   await pool.query(`UPDATE simulation_assignments SET root_cause_key=$3,configured_at=now() WHERE class_id=$1 AND simulation_key=$2`,[classId,simulationKey,fallback]);
   row.root_cause_key=fallback;
  }
 }
 return row;
}
function elapsedText(start){ const sec=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000)); const m=Math.floor(sec/60),ss=String(sec%60).padStart(2,'0'); return `${m}:${ss}`; }
async function getSimAttemptForStudent(studentId,attemptId){
 const q=await pool.query(`SELECT * FROM simulation_attempts WHERE id=$1 AND student_id=$2`,[attemptId,studentId]); return q.rows[0];
}
function isCorrectPathAction(sim,action){
 if(!sim||!action) return false;
 const standard=new Set(['verify_complaint','fault_codes','live_data','service_info','verify_repair']);
 return standard.has(action.key)||(sim.rootCause?.proof||[]).includes(action.key)||(sim.rootCause?.replacementAction===action.key);
}
function isWrongDiagnosticChoice(sim,action){
 if(!sim||!action||action.category==='Replace Part') return false;
 const allProof=new Set((sim.rootCauses||[]).flatMap(r=>r.proof||[]));
 return allProof.has(action.key)&&!(sim.rootCause?.proof||[]).includes(action.key);
}
function proofComplete(sim,actions){
 const keys=new Set(actions.filter(x=>!x.evidence_required||String(x.evidence_text||'').trim()).map(x=>x.action_key));
 const req=sim.rootCause?.proof||[];
 if(!req.length) return actions.some(x=>String(x.evidence_text||'').trim()&&x.category!=='Replace Part');
 return req.every(k=>keys.has(k));
}
function partsPenaltyCount(actions){ return actions.filter(x=>Number(x.penalty||0)>0 && ((x.category||'')==='Replace Part'||String(x.result_text||'').includes('PARTS CANNON'))).length; }
function actionUnlocked(sim,action,actions){
 const done=new Set(actions.map(x=>x.action_key));
 const pendingEvidence=actions.some(x=>x.evidence_required&&!String(x.evidence_text||'').trim());
 if(pendingEvidence&&!done.has(action.key)) return false;
 const stage=inferActionStage(action);
 if(stage===1) return true;
 if(stage===2) return done.has('verify_complaint')||!sim.actions.some(x=>x.key==='verify_complaint');
 const core=sim.actions.filter(x=>['fault_codes','live_data'].includes(x.key));
 if(stage===3) return (done.has('verify_complaint')||!sim.actions.some(x=>x.key==='verify_complaint'))&&core.every(x=>done.has(x.key));
 if(stage===5) return proofComplete(sim,actions);
 if(stage===6){ const repl=sim.rootCause?.replacementAction; return proofComplete(sim,actions)&&(!repl||done.has(repl)); }
 return true;
}
async function studentHuntPrerequisiteMet(studentId,classId,type){
 if(!type||type==='none') return true;
 const c=(await pool.query('SELECT hunt_type FROM classes WHERE id=$1',[classId])).rows[0];
 if(!c||c.hunt_type!==type) return false;
 const q=(await pool.query(`SELECT count(*)::int total,count(hp.id)::int done FROM hunt_stations h LEFT JOIN hunt_progress hp ON hp.station_id=h.id AND hp.student_id=$1 WHERE h.class_id=$2`,[studentId,classId])).rows[0];
 return Number(q.total)>0&&Number(q.done)>=Number(q.total);
}
async function recalcSimulation(attemptId){
 const a=(await pool.query(`SELECT COALESCE(sum(points),0)::int positive,COALESCE(sum(penalty),0)::int penalty FROM simulation_actions WHERE attempt_id=$1`,[attemptId])).rows[0];
 const attempt=(await pool.query('SELECT diagnosis_correct,repair_correct FROM simulation_attempts WHERE id=$1',[attemptId])).rows[0]||{};
 const positive=Number(a.positive)+(attempt.diagnosis_correct?20:0)+(attempt.repair_correct?10:0);
 const hintPenalty=Number((await pool.query('SELECT COALESCE(sum(penalty),0)::int n FROM simulation_hints WHERE attempt_id=$1',[attemptId])).rows[0]?.n||0);
 const penalty=Number(a.penalty)+hintPenalty; const score=Math.max(0,Math.min(100,positive-penalty));
 await pool.query('UPDATE simulation_attempts SET positive_points=$1,penalty_points=$2,score=$3 WHERE id=$4',[positive,penalty,score,attemptId]);
 return {positive,penalty,score};
}
function simulationCss(){ return `<style>
 .sim-shell{display:grid;grid-template-columns:320px 1fr;gap:18px}.sim-assignment{border-left:6px solid var(--red);background:#fff}.sim-assignment-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.sim-assignment-steps div{background:#f5f5f5;border:1px solid #ddd;border-radius:10px;padding:10px}.sim-assignment-steps b{display:block;margin-bottom:4px}.sim-assignment-steps span{display:block;font-size:12px;line-height:1.35;color:#444}.sim-wo{background:#151515;color:#fff;border-radius:18px;padding:20px;border-top:6px solid var(--red);position:sticky;top:12px;height:max-content}.sim-wo h2{margin:6px 0 12px}.sim-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.sim-meta div{background:#272727;border-radius:10px;padding:10px}.sim-meta span{display:block;color:#bbb;font-size:11px;text-transform:uppercase;font-weight:800}.sim-meta b{display:block;margin-top:3px}.sim-score{font-size:42px;font-weight:900}.sim-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sim-tool{border:1px solid #ddd;border-radius:14px;padding:13px;background:#fff}.sim-tool h3{margin:0 0 8px;font-size:15px}.sim-tool form{margin:6px 0}.sim-tool button{width:100%;font-size:13px;padding:9px}.sim-tool button.sim-choice-good{background:#237a3b!important;border-color:#237a3b!important;color:#fff!important;opacity:1!important}.sim-tool button.sim-choice-wrong{background:#ffd966!important;border-color:#d6a800!important;color:#111!important;opacity:1!important}.sim-tool button.sim-choice-neutral{background:#ececec!important;border-color:#cfcfcf!important;color:#333!important;opacity:1!important}.sim-path-key{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;font-weight:800}.sim-path-key span{display:inline-flex;align-items:center;gap:6px}.sim-path-key i{width:12px;height:12px;border-radius:3px;display:inline-block}.sim-path-key .g i{background:#237a3b}.sim-path-key .r i{background:#ffd966;border:1px solid #d6a800}.sim-path-key .n i{background:#bdbdbd}.sim-log{border-left:5px solid #222;background:#fafafa;padding:12px 15px;border-radius:8px;margin:9px 0}.sim-log.good{border-color:#267a3f}.sim-log.penalty{border-color:#d6a800;background:#fff4bf;color:#111}.sim-final{border:3px solid var(--red);background:#fffafa}.parts-penalty{background:#5c0a0f;color:#fff!important;border-radius:10px;padding:10px;font-weight:800}.parts-penalty *{color:#fff!important}.sim-badge{display:inline-block;background:#eee;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800}.sim-timer{font-variant-numeric:tabular-nums}.sim-history td,.sim-history th{white-space:nowrap}@media(max-width:900px){.sim-shell{grid-template-columns:1fr}.sim-wo{position:static}.sim-tools{grid-template-columns:1fr}.sim-assignment-steps{grid-template-columns:1fr}}
</style>`; }




// --- 5.8.1 built-in content pack for company-scoped restoration ---
const LEGACY58_DEFAULT_QUIZ = [
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

const LEGACY58_HUNT_ITEM_LIBRARY = [
{id:'battery',label:'Battery Location',task:'Locate the battery and identify its location. Enter BATTERY when complete.',expected:'battery'},
{id:'air_cleaner',label:'Air Cleaner Location',task:'Locate the air cleaner assembly and identify how it is accessed for service. Enter AIR when complete.',expected:'air'},
{id:'diagnostic_connector',label:'Diagnostic Connector',task:'Locate the tractor diagnostic connector and identify it. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'ecu',label:'Engine ECU / Controller',task:'Locate the engine ECU/controller and read the controller identification from the label. Enter ECU when complete.',expected:'ecu'},
{id:'fuse_box',label:'Fuse / Relay Center',task:'Locate the main fuse and relay center. Enter FUSE when you identify it.',expected:'fuse'},
{id:'main_ground',label:'Main Ground Point',task:'Locate a primary engine/chassis ground point identified in the service information. Enter GROUND when complete.',expected:'ground'},
{id:'crank_sensor',label:'Crankshaft Position Sensor',task:'Locate the crankshaft-position sensor. Enter CRANK when you identify it.',expected:'crank'},
{id:'cam_sensor',label:'Cam / Phase Sensor',task:'Locate the cam/phase sensor. Enter CAM when you identify it.',expected:'cam'},
{id:'rail_sensor',label:'Fuel Rail Pressure Sensor',task:'Locate the fuel-rail pressure sensor and connector. Enter RAIL when complete.',expected:'rail'},
{id:'fuel_filter',label:'Fuel Filter',task:'Locate the fuel-filter assembly and identify its service access. Enter FILTER when complete.',expected:'filter'},
{id:'hydraulic_pump',label:'Hydraulic Pump',task:'Locate the main hydraulic pump. Enter PUMP when you identify it.',expected:'pump'},
{id:'hydraulic_test',label:'Hydraulic Pressure Test Point',task:'Using service information, locate the specified hydraulic pressure test point. Enter TEST when complete.',expected:'test'},
{id:'pto_control',label:'PTO Control / Solenoid',task:'Locate the PTO control solenoid, valve, or actuator used on this tractor. Enter PTO when complete.',expected:'pto'},
{id:'three_point',label:'Three-Point Control Components',task:'Locate the primary three-point hitch control or valve components. Enter THREE when complete.',expected:'three'},
{id:'cluster',label:'Instrument Cluster',task:'Identify the instrument cluster and have the Verifier point out the major warning/indicator area. Enter CLUSTER when complete.',expected:'cluster'},
{id:'seat_presence',label:'Operator-Presence Seat Detector',task:'Locate the operator-presence detector/switch incorporated into the seat system. Enter SEAT when complete.',expected:'seat'},
{id:'refresh_battery_air',label:'5100 Refresh — Battery & Air Cleaner Relocation',task:'Find the battery and air cleaner in their Refresh locations and discuss how those locations differ from the earlier tractor. Enter FRONT when complete.',expected:'front'},
{id:'refresh_app',label:'5100 Refresh — Accelerator Pedal Sensor Mounting',task:'Locate the accelerator-pedal-position sensor and identify the revised mounting location. Enter APP when complete.',expected:'app'},
{id:'refresh_cooling',label:'5100 Refresh — Water Pump / Crank Pulley',task:'Locate the modified water-pump area and changed crank pulley. Enter COOLING when both have been identified.',expected:'cooling'},
{id:'refresh_exhaust',label:'5100 Refresh — DOC / Exhaust Arrangement',task:'Locate the integrated DOC/exhaust arrangement and identify the changed service layout. Enter DOC when complete.',expected:'doc'},
{id:'refresh_oil_cooler',label:'5100 Refresh — Oil Cooler Location',task:'Locate the revised oil-cooler position. Enter COOLER when complete.',expected:'cooler'},
{id:'refresh_hyd_inlet',label:'5100 Refresh — Hydraulic Pump Inlet Pipe',task:'Locate the modified hydraulic-pump inlet-pipe area and identify the improved pump mounting-bolt access. Enter INLET when complete.',expected:'inlet'},
{id:'refresh_egr',label:'5100 Refresh — EGR Mounting',task:'Locate the EGR assembly and identify the revised mounting arrangement. Enter EGR when complete.',expected:'egr'},
{id:'refresh_oil_fill',label:'5100 Refresh — Engine Oil Fill Location',task:'Locate the revised engine-oil fill location. Enter OIL when complete.',expected:'oil'},
{id:'fmcu_controller',group:'fmcu',label:'FMCU Controller Location',task:'Locate the FMCU on the tractor and identify the controller. Enter FMCU when complete.',expected:'fmcu'},
{id:'fmcu_diag_connector',group:'fmcu',label:'FMCU Diagnostic Connector',task:'Locate the correct FMCU diagnostic connector for this tractor. Enter CONNECTOR when complete.',expected:'connector'},
{id:'fmcu_garuda',group:'fmcu',label:'Garuda Interface',task:'Identify the Garuda vehicle interface used to connect the laptop to the tractor network. Enter GARUDA when complete.',expected:'garuda'},
{id:'fmcu_pigtail',group:'fmcu',label:'Correct Diagnostic Pigtail',task:'Identify the correct diagnostic pigtail for this tractor configuration. Enter PIGTAIL when verified.',expected:'pigtail'},
{id:'fmcu_power',group:'fmcu',label:'FMCU Battery Feed',task:'Using the wiring/service information, locate the FMCU battery-feed circuit or fuse. Enter POWER when identified.',expected:'power'},
{id:'fmcu_ignition',group:'fmcu',label:'FMCU Ignition / Wake-Up Feed',task:'Locate the FMCU ignition or wake-up feed circuit. Enter WAKE when identified.',expected:'wake'},
{id:'fmcu_ground',group:'fmcu',label:'FMCU Ground Path',task:'Locate the FMCU ground path or primary ground point. Explain where you would voltage-drop test it. Enter GROUND when complete.',expected:'ground'},
{id:'fmcu_input',group:'fmcu',label:'FMCU Input Circuit',task:'Choose one FMCU switch or sensor input, locate its circuit/component, and identify where live data would confirm its state. Enter INPUT when complete.',expected:'input'},
{id:'fmcu_output',group:'fmcu',label:'FMCU Output Circuit',task:'Locate one FMCU-controlled relay, solenoid, lamp, or actuator and identify where output voltage would be measured. Enter OUTPUT when complete.',expected:'output'},
{id:'fmcu_harness',group:'fmcu',label:'Harness / Connector Inspection Point',task:'Find a harness or connector area where rub-through, backed-out terminals, corrosion, or movement could create an intermittent fault. Enter HARNESS when complete.',expected:'harness'},
{id:'fmcu_network',group:'fmcu',label:'Network Communication Path',task:'Trace the diagnostic communication path from laptop to Garuda to pigtail to vehicle network to FMCU. Enter NETWORK when complete.',expected:'network'},
{id:'fmcu_mecare',group:'fmcu',label:'Me Care Programming Tool',task:'Identify the tool used for FMCU programming and state the battery-voltage precaution before flashing. Enter MECARE when complete.',expected:'mecare'},
{id:'auto4wd_switch',group:'auto4wd',label:'Auto 4WD Mode Switch',task:'Locate the Auto 4WD switch and identify positions A, B, and C. Enter SWITCH when complete.',expected:'switch'},
{id:'auto4wd_brake_lh',group:'auto4wd',label:'Left Brake Input',task:'Locate the left-brake input/switch used by Auto 4WD logic and identify where its state is checked. Enter LEFT when complete.',expected:'left'},
{id:'auto4wd_brake_rh',group:'auto4wd',label:'Right Brake Input',task:'Locate the right-brake input/switch used by Auto 4WD logic and identify where its state is checked. Enter RIGHT when complete.',expected:'right'},
{id:'auto4wd_speed',group:'auto4wd',label:'Vehicle Speed Input',task:'Identify the vehicle-speed input/source used by Auto 4WD logic and where the technician verifies the live speed value. Enter SPEED when complete.',expected:'speed'},
{id:'auto4wd_controller',group:'auto4wd',label:'Auto 4WD Controller / FMCU',task:'Locate the controller responsible for Auto 4WD logic. Enter FMCU when complete.',expected:'fmcu'},
{id:'auto4wd_output',group:'auto4wd',label:'4WD Output Circuit',task:'Locate the 4WD output circuit leading from the controller toward the 4WD hardware. Enter OUTPUT when complete.',expected:'output'},
{id:'auto4wd_solenoid',group:'auto4wd',label:'4WD Solenoid / Actuator',task:'Locate the 4WD solenoid, clutch, or actuator hardware and identify its connector. Enter SOLENOID when complete.',expected:'solenoid'},
{id:'auto4wd_telltale',group:'auto4wd',label:'4WD Telltale / Indicator',task:'Locate the 4WD indicator and identify where the controller command can be compared with the displayed telltale. Enter LAMP when complete.',expected:'lamp'},
{id:'auto4wd_low_logic',group:'auto4wd',label:'Auto Mode — Below 14 km/h',task:'Set or describe Auto mode with no brakes below 14 km/h and identify the expected driveline state. Enter 4WD when complete.',expected:'4wd'},
{id:'auto4wd_high_logic',group:'auto4wd',label:'Auto Mode — Above 15 km/h',task:'Set or describe Auto mode with no brakes above 15 km/h and identify the expected driveline state. Enter 2WD when complete.',expected:'2wd'},
{id:'auto4wd_both_brakes',group:'auto4wd',label:'Both-Brakes Logic Check',task:'Apply or describe both brakes and identify the expected Auto 4WD state. Enter 4WD when complete.',expected:'4wd'},
{id:'auto4wd_one_brake',group:'auto4wd',label:'One-Brake Logic Check',task:'Apply or describe one brake and identify the expected Auto 4WD state. Enter 2WD when complete.',expected:'2wd'}
];

const LEGACY58_DIAGNOSTIC_SIMULATIONS = {
  '5100-crank-no-start':{
    key:'5100-crank-no-start',series:'5100 Series',level:'Level 2',title:'Cranks, No Start',model:'Mahindra Fifty One Hundred Refresh',workOrder:'SIM-NOSTART-001',hours:412,complaint:'Engine cranks normally but will not start. No exhaust smoke is present while cranking.',assignment:'Diagnose the root cause, select the correct repair, and verify the repair.',
    rootCauses:[
      {key:'cam_sensor',diagnosis:'Failed camshaft position sensor',repair:'Replace the camshaft position sensor and verify synchronization and engine starting',replacementAction:'replace_cam_sensor',proof:['cam_circuit','cam_meter'],points:{cam_circuit:20,cam_meter:15},overrides:{live_data:'Engine RPM: 215 RPM | Rail pressure: 29.4 MPa | Cam synchronization: NO | Battery voltage: 10.9 V',cam_circuit:'Cam sensor connector and harness are intact. 5 V reference and ground are present.',cam_meter:'Cam sensor supply: 4.98 V | Ground voltage drop: 0.03 V | Signal: no switching signal while cranking.',rail_pressure:'Rail pressure reaches 29.4 MPa while cranking, which is sufficient for starting.'}},
      {key:'ecu',diagnosis:'Engine ECU internal failure',repair:'Replace/program the engine ECU after proving all powers, grounds, network and inputs are correct; verify starting',replacementAction:'replace_ecu',proof:['wiring','ecu_power_ground'],points:{wiring:20,ecu_power_ground:15},overrides:{live_data:'Engine RPM: 218 RPM | Rail pressure: 29.7 MPa | Cam synchronization: YES | Battery voltage: 11.1 V | Injector command: NO',wiring:'Wiring diagram review identifies the ECU power, ground, crank/cam inputs and injector output circuits required for the no-start.',ecu_power_ground:'All ECU powers are within 0.2 V of battery voltage and loaded ground voltage drop is 0.04 V. Inputs are valid, but injector command remains absent.'}},
      {key:'fuel_filter',diagnosis:'Restricted fuel filter / low-pressure fuel supply',repair:'Replace the restricted fuel filter, prime the fuel system and verify rail pressure and engine starting',replacementAction:'replace_fuel_filter',proof:['fuel_filter','rail_pressure'],points:{fuel_filter:20,rail_pressure:15},overrides:{live_data:'Engine RPM: 214 RPM | Rail pressure: 6.1 MPa | Cam synchronization: YES | Battery voltage: 11.0 V',fuel_filter:'Fuel filter inlet vacuum is excessive and supply volume is below specification.',rail_pressure:'Rail pressure remains at 6.1 MPa while cranking and rises when an alternate clean fuel supply is used.'}},
      {key:'hp_pump',diagnosis:'High-pressure fuel pump cannot build required rail pressure',repair:'Replace the failed high-pressure pump after confirming supply and control, then verify commanded/actual rail pressure and starting',replacementAction:'replace_hp_pump',proof:['rail_pressure','pump_control'],points:{rail_pressure:20,pump_control:15},overrides:{live_data:'Engine RPM: 216 RPM | Rail pressure: 5.4 MPa | Cam synchronization: YES | Battery voltage: 11.0 V | Fuel metering command: HIGH',rail_pressure:'Rail pressure remains at 5.4 MPa while cranking even though low-pressure supply is within specification.',fuel_filter:'Fuel supply volume and filter restriction are within specification.',pump_control:'Fuel metering command and circuit are within specification, but commanded rail pressure is not achieved.'}},
      {key:'injectors',diagnosis:'Injector electrical failure',repair:'Repair the failed injector circuit/component and verify injector command and engine starting',replacementAction:'replace_injectors',proof:['injector_resistance','injector_pulse'],points:{injector_resistance:20,injector_pulse:15},overrides:{live_data:'Engine RPM: 217 RPM | Rail pressure: 29.2 MPa | Cam synchronization: YES | Battery voltage: 11.0 V | Injector command present',injector_resistance:'One injector circuit measures open compared with the remaining injectors. The failure is repeatable.',injector_pulse:'Injector command is present at the ECU. One injector circuit does not carry current during cranking.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,result:'Complaint verified: engine cranks at normal speed, does not start, and no exhaust smoke is present.'},
      {key:'visual_basic',category:'Visual Inspection',label:'Perform Basic Visual Inspection',points:0,result:'Battery terminals are clean and tight. Engine oil and coolant levels are normal. No obvious disconnected harnesses are visible.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Active Fault Codes',points:10,result:'No active fault codes are stored.'},
      {key:'history',category:'Repair History',label:'Review Repair History',points:0,result:'No recent engine-control repairs. Fuel filters were serviced 42 operating hours ago.'},
      {key:'live_data',category:'Live Data',label:'View Cranking Live Data',points:15,result:'Cranking live data retrieved.'},
      {key:'rail_pressure',category:'Pressure Tests',label:'Check Rail Pressure While Cranking',points:0,result:'Rail-pressure test completed.'},
      {key:'cam_circuit',category:'Component Tests',label:'Check Cam Sensor Circuit',points:0,result:'Cam sensor connector and harness are intact. Power and ground are present. Signal must be tested while cranking.'},
      {key:'cam_meter',category:'Multimeter',label:'Meter Test — Cam Sensor Power / Ground / Signal',points:0,result:'Cam sensor circuit tested.'},
      {key:'ecu_power_ground',category:'Multimeter',label:'Meter Test — ECU Power / Ground',points:0,result:'ECU power and ground test completed.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review Engine-Control Wiring Diagram',points:0,result:'Wiring diagram reviewed for the related engine-control circuits.'},
      {key:'service_info',category:'Service Information',label:'Review Diagnostic Procedure',points:0,result:'Service procedure reviewed before component replacement.'},
      {key:'fuel_filter',category:'Component Tests',label:'Inspect Fuel Filter / Supply',points:0,result:'Fuel supply inspection completed.'},
      {key:'pump_control',category:'Component Tests',label:'Test High-Pressure Pump Control',points:0,result:'High-pressure pump control test completed.'},
      {key:'injector_resistance',category:'Component Tests',label:'Check Injector Resistance',points:0,result:'Injector electrical resistance test completed.'},
      {key:'injector_pulse',category:'Multimeter',label:'Check Injector Command / Current',points:0,result:'Injector command test completed.'},
      {key:'replace_cam_sensor',category:'Replace Part',label:'Replace Camshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: camshaft position sensor replaced without proof of failure.'},
      {key:'replace_fuel_filter',category:'Replace Part',label:'Replace Fuel Filter',penalty:15,result:'PARTS CANNON PENALTY: fuel filter replaced without proof of restriction.'},
      {key:'replace_ecu',category:'Replace Part',label:'Replace ECU',penalty:15,result:'PARTS CANNON PENALTY: ECU replaced without proof of ECU failure.'},
      {key:'replace_hp_pump',category:'Replace Part',label:'Replace High-Pressure Pump',penalty:15,result:'PARTS CANNON PENALTY: high-pressure pump replaced without proof of failure.'},
      {key:'replace_injectors',category:'Replace Part',label:'Replace Injectors',penalty:15,result:'PARTS CANNON PENALTY: injectors replaced without proof of failure.'}
    ]
  },
  '6000-no-injector-activation':{
    key:'6000-no-injector-activation',series:'6000 Series',level:'Level 2',title:'Cranks, No Injector Activation',model:'Mahindra 6000 Series',workOrder:'SIM-NOINJECT-001',hours:638,complaint:'Engine cranks normally but will not start. FES shows no injector activation.',assignment:'Use voltage-drop testing, live data and circuit checks to prove the cause before replacing a component.',
    rootCauses:[
      {key:'ecu_fuse_resistance',diagnosis:'High resistance at the ECU supply fuse / fuse connection',repair:'Repair the high-resistance ECU power-supply connection and verify loaded ECU voltage, injector activation and engine starting',proof:['ecu_supply_loaded','fuse_drop'],points:{ecu_supply_loaded:20,fuse_drop:15},overrides:{live_data:'Engine RPM: 223 RPM | Rail pressure: 30.1 MPa | Cam sync: YES | ECU main voltage: 8.7 V while cranking | Injector activation: NO',ecu_supply_loaded:'Battery: 11.2 V cranking | ECU main feed at ECU: 8.7 V under load.',fuse_drop:'Voltage drop across ECU fuse/connection while cranking: 2.45 V. Specification: near 0 V.'}},
      {key:'crank_sensor',diagnosis:'Crankshaft position sensor signal failure',repair:'Repair/replace the crankshaft position sensor circuit and verify engine-speed signal and starting',replacementAction:'replace_crank_sensor',proof:['crank_circuit','crank_scope'],points:{crank_circuit:20,crank_scope:15},overrides:{live_data:'Engine RPM: 0 RPM while cranking | Rail pressure: 29.0 MPa | Cam status: detected | Injector activation: NO',crank_circuit:'Crank sensor power/ground and harness continuity are within specification.',crank_scope:'No crank sensor switching waveform is present at the ECU while cranking.'}},
      {key:'cam_sensor',diagnosis:'Camshaft position sensor signal failure',repair:'Repair/replace the camshaft position sensor circuit and verify synchronization and injector activation',replacementAction:'replace_cam_sensor',proof:['cam_circuit','cam_scope'],points:{cam_circuit:20,cam_scope:15},overrides:{live_data:'Engine RPM: 222 RPM | Rail pressure: 29.8 MPa | Cam synchronization: NO | Injector activation: NO',cam_circuit:'Cam sensor reference voltage and ground are correct; harness continuity to ECU is good.',cam_scope:'No usable camshaft position signal is present at the ECU during cranking.'}},
      {key:'ecu_ground',diagnosis:'Excessive voltage drop in ECU ground circuit',repair:'Repair the ECU ground connection and verify loaded ground voltage drop, injector activation and starting',proof:['ecu_ground_loaded','ground_bypass'],points:{ecu_ground_loaded:20,ground_bypass:15},overrides:{live_data:'Engine RPM: 221 RPM | Rail pressure: 30.0 MPa | Cam sync: YES | ECU voltage unstable | Injector activation: NO',ecu_ground_loaded:'ECU ground voltage drop while cranking: 1.18 V. Specification: less than 0.10 V.',ground_bypass:'Temporary approved ground bypass restores injector activation while cranking.'}},
      {key:'rail_pressure',diagnosis:'Insufficient common-rail pressure during cranking',repair:'Correct the fuel-pressure fault and verify actual rail pressure reaches starting threshold and engine starts',proof:['rail_pressure','fuel_supply'],points:{rail_pressure:20,fuel_supply:15},overrides:{live_data:'Engine RPM: 224 RPM | Actual rail pressure: 6.0 MPa | Desired rail pressure: 30 MPa | Cam sync: YES | Injector activation inhibited',rail_pressure:'Actual rail pressure remains well below desired pressure while cranking.',fuel_supply:'Low-pressure fuel supply is restricted and volume is below specification.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,result:'Complaint verified. Engine cranks normally but does not start.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read FES Fault Codes',points:10,result:'No single fault code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review FES Cranking Data',points:15,result:'Cranking live data retrieved.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review ECU Power / Sensor / Injector Diagram',points:0,result:'Relevant ECU power, grounds, crank/cam inputs and injector-control circuits identified.'},
      {key:'ecu_supply_loaded',category:'Multimeter',label:'Loaded ECU Supply Voltage Test',points:0,result:'ECU supply voltage tested while cranking.'},
      {key:'fuse_drop',category:'Multimeter',label:'Voltage Drop Across ECU Fuse / Connection',points:0,result:'Fuse and connection voltage-drop test completed under cranking load.'},
      {key:'crank_circuit',category:'Component Tests',label:'Check Crank Sensor Circuit',points:0,result:'Crank sensor circuit inspected and electrically tested.'},
      {key:'crank_scope',category:'Component Tests',label:'Check Crank Signal While Cranking',points:0,result:'Crank sensor signal test completed.'},
      {key:'cam_circuit',category:'Component Tests',label:'Check Cam Sensor Circuit',points:0,result:'Cam sensor circuit inspected and electrically tested.'},
      {key:'cam_scope',category:'Component Tests',label:'Check Cam Signal While Cranking',points:0,result:'Cam sensor signal test completed.'},
      {key:'ecu_ground_loaded',category:'Multimeter',label:'Loaded ECU Ground Voltage-Drop Test',points:0,result:'ECU ground tested under cranking load.'},
      {key:'ground_bypass',category:'Component Tests',label:'Perform Approved Ground Bypass Test',points:0,result:'Ground bypass test completed.'},
      {key:'rail_pressure',category:'Pressure Tests',label:'Compare Desired vs Actual Rail Pressure',points:0,result:'Rail pressure comparison completed.'},
      {key:'fuel_supply',category:'Pressure Tests',label:'Check Low-Pressure Fuel Supply',points:0,result:'Low-pressure fuel supply test completed.'},
      {key:'replace_crank_sensor',category:'Replace Part',label:'Replace Crankshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: crank sensor replaced without proof.'},
      {key:'replace_cam_sensor',category:'Replace Part',label:'Replace Camshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: cam sensor replaced without proof.'},
      {key:'replace_ecu',category:'Replace Part',label:'Replace ECU',penalty:15,result:'PARTS CANNON PENALTY: ECU replaced without proving power, ground, inputs and outputs.'},
      {key:'replace_hp_pump',category:'Replace Part',label:'Replace High-Pressure Pump',penalty:15,result:'PARTS CANNON PENALTY: high-pressure pump replaced without proof.'}
    ]
  },
  '3100-hst-no-forward':{
    key:'3100-hst-no-forward',series:'3100',level:'Level 2',title:'No Forward Travel',model:'Mahindra 3100',workOrder:'SIM-NOFWD-001',hours:286,complaint:'Tractor will move in reverse but will not travel forward. Engine operation is normal.',assignment:'Determine whether the failure is an input, controller, electrical output or hydraulic/mechanical problem.',
    rootCauses:[
      {key:'forward_solenoid',diagnosis:'Forward HST solenoid coil is open',repair:'Replace the failed forward HST solenoid and verify coil current and forward travel',replacementAction:'replace_forward_solenoid',proof:['solenoid_resistance','command_voltage'],points:{solenoid_resistance:20,command_voltage:15},overrides:{live_data:'Forward pedal input: 62% | Reverse pedal input: 0% | Forward command: ON | Forward solenoid current: 0 A',solenoid_resistance:'Forward solenoid coil: OL/open. Reverse solenoid coil: 8.4 Ω.',command_voltage:'Controller supplies battery voltage to the forward-solenoid connector when forward is commanded.'}},
      {key:'harness_open',diagnosis:'Open circuit between controller and forward HST solenoid',repair:'Repair the forward-solenoid harness/open connection and verify loaded voltage and forward travel',proof:['command_voltage','harness_continuity'],points:{command_voltage:20,harness_continuity:15},overrides:{live_data:'Forward pedal input: 61% | Forward command: ON | Forward solenoid current: 0 A',command_voltage:'Battery voltage is present at the controller output but 0 V is measured at the solenoid connector under command.',harness_continuity:'Forward-solenoid control wire is open between controller and solenoid connector.'}},
      {key:'pedal_input',diagnosis:'Forward pedal position input is not reaching the controller',repair:'Repair/calibrate the forward pedal input circuit and verify live-data response and forward travel',proof:['pedal_voltage','pedal_live'],points:{pedal_voltage:20,pedal_live:15},overrides:{live_data:'Forward pedal input: 0% even with pedal applied | Reverse input responds normally | Forward command: OFF',pedal_voltage:'Sensor supply and ground are correct; forward pedal signal remains fixed at 0.48 V through pedal travel.',pedal_live:'FMCU live data does not change from 0% as the forward pedal is moved.'}},
      {key:'controller_output',diagnosis:'FMCU/controller does not command the forward solenoid despite valid inputs',repair:'After proving powers, grounds, inputs and output circuit, repair/program/replace the controller and verify forward travel',replacementAction:'replace_controller',proof:['controller_inputs','controller_output_test'],points:{controller_inputs:20,controller_output_test:15},overrides:{live_data:'Forward pedal input: 64% | Neutral/safety inputs valid | Forward command: OFF despite valid request',controller_inputs:'Pedal, neutral/safety, speed and interlock inputs are all valid at the controller.',controller_output_test:'Forward-solenoid circuit load-tests correctly, but the controller never switches the output.'}},
      {key:'hydraulic',diagnosis:'Forward hydrostatic control pressure is not being produced',repair:'Repair the hydraulic/HST control fault and verify forward control pressure and travel',proof:['command_voltage','forward_pressure'],points:{command_voltage:15,forward_pressure:20},overrides:{live_data:'Forward pedal input: 63% | Forward command: ON | Forward solenoid current: normal',command_voltage:'Correct voltage and current are present at the forward HST solenoid.',forward_pressure:'Forward control pressure does not rise with the forward command; reverse control pressure is normal.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Forward / Reverse Complaint',points:10,result:'Reverse travel is normal. Forward travel is absent.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read FMCU Fault Codes',points:10,result:'No active code directly identifies the failed circuit.'},
      {key:'live_data',category:'Live Data',label:'View Pedal Inputs and HST Commands',points:15,result:'HST input/output live data retrieved.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review Forward HST Control Circuit',points:0,result:'Forward pedal, controller and forward-solenoid circuit identified.'},
      {key:'solenoid_resistance',category:'Multimeter',label:'Measure Forward Solenoid Resistance',points:0,result:'Forward solenoid resistance test completed.'},
      {key:'command_voltage',category:'Multimeter',label:'Measure Forward-Solenoid Command Voltage',points:0,result:'Forward-solenoid command voltage tested under load.'},
      {key:'harness_continuity',category:'Multimeter',label:'Check Forward-Solenoid Harness Continuity',points:0,result:'Harness continuity test completed.'},
      {key:'pedal_voltage',category:'Multimeter',label:'Test Forward Pedal Signal Voltage',points:0,result:'Forward pedal supply, ground and signal measured.'},
      {key:'pedal_live',category:'Live Data',label:'Sweep Forward Pedal While Watching Live Data',points:0,result:'Forward pedal live-data sweep completed.'},
      {key:'controller_inputs',category:'Component Tests',label:'Verify Controller Interlock Inputs',points:0,result:'Controller input conditions verified.'},
      {key:'controller_output_test',category:'Component Tests',label:'Load-Test Forward Controller Output Circuit',points:0,result:'Controller output circuit load test completed.'},
      {key:'forward_pressure',category:'Pressure Tests',label:'Check Forward HST Control Pressure',points:0,result:'Forward HST control pressure test completed.'},
      {key:'replace_forward_solenoid',category:'Replace Part',label:'Replace Forward HST Solenoid',penalty:15,result:'PARTS CANNON PENALTY: forward solenoid replaced without proof.'},
      {key:'replace_controller',category:'Replace Part',label:'Replace FMCU / Controller',penalty:15,result:'PARTS CANNON PENALTY: controller replaced without proof.'}
    ]
  },
  'can-network-down':{
    key:'can-network-down',series:'Electrical / CAN',level:'Level 3',title:'Multiple Modules Not Communicating',model:'Mahindra CAN-equipped Tractor',workOrder:'SIM-NETWORK-001',hours:521,complaint:'Multiple controllers are offline. Diagnostic tool cannot communicate with several modules.',assignment:'Use network resistance, voltage, isolation and power/ground testing to identify the failure.',
    rootCauses:[
      {key:'can_high_open',diagnosis:'Open circuit in CAN High',repair:'Repair the CAN High open and verify network resistance, bias voltage and module communication',proof:['network_resistance','can_continuity'],points:{network_resistance:15,can_continuity:20},overrides:{network_resistance:'Key OFF network resistance: approximately 120 Ω, indicating one termination path is missing from the measured network.',can_voltage:'Key ON: CAN High approximately 2.5 V and CAN Low approximately 2.5 V with little differential activity.',can_continuity:'CAN High is open between the backbone junction and rear-controller branch. CAN Low continuity is normal.'}},
      {key:'can_low_short',diagnosis:'CAN Low shorted to ground',repair:'Repair the CAN Low short to ground and verify bias voltage, waveform and communication',proof:['can_voltage','isolation'],points:{can_voltage:15,isolation:20},overrides:{network_resistance:'Key OFF resistance is abnormal and unstable.',can_voltage:'Key ON: CAN High 2.6 V | CAN Low 0.1 V.',isolation:'Disconnecting the rear harness branch restores normal CAN bias voltage and communication.'}},
      {key:'terminator_missing',diagnosis:'One 120-ohm CAN terminating resistor is missing/open',repair:'Restore the missing/open termination and verify approximately 60 Ω key-off resistance and reliable communication',proof:['network_resistance','terminator_check'],points:{network_resistance:20,terminator_check:15},overrides:{network_resistance:'Key OFF network resistance: 119.8 Ω.',terminator_check:'One end of the network measures 120 Ω termination; the opposite terminating resistor is open/missing.'}},
      {key:'module_bus_down',diagnosis:'A failed module is pulling the CAN network down',repair:'Replace/repair the failed module after isolation proves it is loading the bus; verify network communication',replacementAction:'replace_suspect_module',proof:['can_voltage','isolation'],points:{can_voltage:15,isolation:20},overrides:{network_resistance:'Key OFF network resistance is lower than expected.',can_voltage:'Key ON CAN bias voltages are collapsed and communication is intermittent.',isolation:'Network communication returns immediately when the rear controller is disconnected. Powers and grounds to that module are correct.'}},
      {key:'module_power',diagnosis:'Offline module has lost power or ground; CAN network itself is healthy',repair:'Repair the module power/ground supply and verify module wake-up and network communication',proof:['network_resistance','module_power_ground'],points:{network_resistance:15,module_power_ground:20},overrides:{network_resistance:'Key OFF network resistance: 60.4 Ω. Backbone termination is normal.',can_voltage:'CAN High/CAN Low bias and activity are normal at the diagnostic connector.',module_power_ground:'The offline controller has no ignition feed. Ground voltage drop is normal.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Communication Complaint',points:10,result:'Several modules are offline; communication complaint verified.'},
      {key:'fault_codes',category:'Fault Codes',label:'Perform Full Network Scan',points:10,result:'Communication DTCs are present in modules that remain online.'},
      {key:'live_data',category:'Live Data',label:'Identify Online vs Offline Modules',points:15,result:'Network population and missing modules recorded.'},
      {key:'network_resistance',category:'Multimeter',label:'Measure CAN Resistance Key OFF',points:0,result:'Key-off CAN resistance test completed.'},
      {key:'can_voltage',category:'Multimeter',label:'Measure CAN High / CAN Low Bias Voltage',points:0,result:'CAN bias voltages measured.'},
      {key:'can_continuity',category:'Multimeter',label:'Check CAN High / Low Continuity by Branch',points:0,result:'Network branch continuity test completed.'},
      {key:'terminator_check',category:'Component Tests',label:'Check Both 120-ohm Terminators',points:0,result:'CAN terminating resistors checked individually.'},
      {key:'isolation',category:'Component Tests',label:'Isolate Network Branches / Modules',points:0,result:'Network branches isolated one at a time while communication is monitored.'},
      {key:'module_power_ground',category:'Multimeter',label:'Load-Test Suspect Module Power and Ground',points:0,result:'Module power and ground circuits load-tested.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review CAN Backbone and Branch Diagram',points:0,result:'Network topology and termination locations identified.'},
      {key:'replace_suspect_module',category:'Replace Part',label:'Replace Suspect Controller',penalty:15,result:'PARTS CANNON PENALTY: controller replaced before network isolation and power/ground proof.'}
    ]
  },
  '6075-shuttle-reverse':{
    key:'6075-shuttle-reverse',series:'6000 / PST',level:'Level 3',title:'Delayed / No Reverse',model:'Mahindra 6075 Power Shuttle',workOrder:'SIM-PST-001',hours:744,complaint:'Forward engagement is normal. Reverse is delayed and may fail to engage when hot.',assignment:'Separate electrical command, inching/interlock and hydraulic clutch-pressure causes before repair.',
    rootCauses:[
      {key:'reverse_solenoid',diagnosis:'Reverse clutch solenoid electrical failure',repair:'Repair/replace the reverse solenoid circuit and verify current, pressure rise and reverse engagement',replacementAction:'replace_reverse_solenoid',proof:['solenoid_resistance','reverse_command'],points:{solenoid_resistance:20,reverse_command:15},overrides:{live_data:'Shuttle lever: REVERSE | Inching input: released | Reverse command: ON | Reverse solenoid current: 0 A',solenoid_resistance:'Reverse solenoid coil is open. Forward solenoid resistance is within specification.',reverse_command:'Battery voltage is present at the reverse solenoid connector when reverse is commanded.'}},
      {key:'inching_switch',diagnosis:'Inching pedal switch/sensor remains active and inhibits reverse engagement',repair:'Adjust/repair the inching pedal switch/sensor and verify released status and normal reverse engagement',proof:['inching_live','inching_adjustment'],points:{inching_live:20,inching_adjustment:15},overrides:{live_data:'Shuttle lever: REVERSE | Inching input: ACTIVE with pedal released | Reverse command: inhibited',inching_live:'Live data continues to show inching active with the pedal fully released.',inching_adjustment:'Physical switch/sensor adjustment is out of specification and changes state when manually repositioned.'}},
      {key:'hydraulic_pressure',diagnosis:'Reverse clutch apply pressure is below specification',repair:'Repair the hydraulic pressure loss and verify reverse clutch pressure and engagement hot and cold',proof:['reverse_pressure','forward_compare'],points:{reverse_pressure:20,forward_compare:15},overrides:{live_data:'Electrical reverse command and solenoid current are normal.',reverse_pressure:'Reverse clutch pressure rises slowly and remains below specification when hot.',forward_compare:'Forward clutch pressure is normal under the same operating conditions.'}},
      {key:'harness_drop',diagnosis:'Excessive voltage drop in reverse-solenoid feed circuit',repair:'Repair the high-resistance reverse-solenoid feed/connection and verify loaded voltage, current and engagement',proof:['reverse_command','loaded_drop'],points:{reverse_command:15,loaded_drop:20},overrides:{live_data:'Reverse command: ON | Reverse solenoid current: low/intermittent',reverse_command:'Controller output is correct at the source, but voltage at the solenoid falls under load.',loaded_drop:'Loaded voltage drop between controller and reverse solenoid is 3.1 V.'}},
      {key:'clutch_internal',diagnosis:'Internal reverse clutch leakage / mechanical failure',repair:'Repair the reverse clutch pack/internal sealing fault and verify pressure retention and reverse engagement',proof:['reverse_pressure','leak_test'],points:{reverse_pressure:15,leak_test:20},overrides:{live_data:'All electrical commands, inputs and solenoid current are normal.',reverse_pressure:'Reverse apply pressure initially rises but decays rapidly.',leak_test:'Hydraulic leakage test indicates excessive internal leakage in the reverse clutch circuit.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Reverse Engagement Complaint',points:10,result:'Forward is normal; reverse is delayed and worse when warm.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Transmission / Shuttle Fault Codes',points:10,result:'No active code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review Shuttle and Inching Live Data',points:15,result:'Transmission input/output live data retrieved.'},
      {key:'solenoid_resistance',category:'Multimeter',label:'Measure Reverse Solenoid Resistance',points:0,result:'Reverse solenoid resistance test completed.'},
      {key:'reverse_command',category:'Multimeter',label:'Check Reverse-Solenoid Command Voltage',points:0,result:'Reverse-solenoid command voltage measured.'},
      {key:'inching_live',category:'Live Data',label:'Monitor Inching Input Released / Applied',points:0,result:'Inching input state monitored through pedal travel.'},
      {key:'inching_adjustment',category:'Component Tests',label:'Inspect Inching Pedal Switch / Adjustment',points:0,result:'Inching switch/sensor adjustment inspected.'},
      {key:'reverse_pressure',category:'Pressure Tests',label:'Measure Reverse Clutch Pressure',points:0,result:'Reverse clutch apply pressure measured.'},
      {key:'forward_compare',category:'Pressure Tests',label:'Compare Forward Clutch Pressure',points:0,result:'Forward clutch pressure measured for comparison.'},
      {key:'loaded_drop',category:'Multimeter',label:'Loaded Voltage-Drop Test — Reverse Circuit',points:0,result:'Reverse-solenoid feed circuit voltage drop tested under load.'},
      {key:'leak_test',category:'Pressure Tests',label:'Perform Reverse Clutch Leakage Test',points:0,result:'Reverse clutch hydraulic leakage test completed.'},
      {key:'replace_reverse_solenoid',category:'Replace Part',label:'Replace Reverse Solenoid',penalty:15,result:'PARTS CANNON PENALTY: reverse solenoid replaced without proof.'}
    ]
  },
  '6075-inching-pressure-diagnosis':{
    key:'6075-inching-pressure-diagnosis',series:'6000 / PST',level:'Level 3',title:'Inching Pedal / Shuttle Pressure Diagnosis',model:'Mahindra 6075 Power Shuttle',workOrder:'SIM-PST-6075-002',hours:386,complaint:'The operator reports that after using the inching pedal, the tractor may hesitate, creep, or fail to re-engage smoothly when the pedal is released. The concern can affect shuttle engagement and becomes more noticeable after the tractor is warm.',assignment:'Diagnose the complaint without adjusting or replacing parts first. Verify the inching-pedal input and physical adjustment, compare commanded shuttle state with clutch-pressure response, prove whether the failure is electrical, adjustment-related, hydraulic, or internal, then perform the supported repair and verify operation hot and cold.',
    rootCauses:[
      {key:'inching_input_stuck',diagnosis:'Inching pedal switch/sensor input remains ACTIVE with the pedal fully released',repair:'Adjust or repair the inching pedal switch/sensor circuit so live data changes correctly from applied to released, then verify normal shuttle engagement and clutch-pressure recovery',proof:['inching_live','inching_input_circuit'],points:{inching_live:20,inching_input_circuit:15},overrides:{fault_codes:'No active transmission fault code directly identifies the failure.',live_data:'Shuttle request is valid, but Inching Input remains ACTIVE with the pedal physically released. Shuttle apply command is inhibited or reduced.',inching_live:'Live data shows the inching input does not return to RELEASED when the pedal is fully up.',inching_input_circuit:'Switch/sensor supply and ground are correct. Physical switch position or signal adjustment prevents the released state from being recognized.',pressure_released:'Clutch apply pressure remains low because the controller continues to see an inching request.'}},
      {key:'pedal_adjustment',diagnosis:'Inching pedal linkage / switch adjustment prevents full release of the inching function',repair:'Set the inching pedal/linkage/switch adjustment to specification, confirm full released travel, then verify pressure returns normally and the tractor re-engages smoothly',proof:['pedal_free_travel','inching_adjustment'],points:{pedal_free_travel:20,inching_adjustment:15},overrides:{fault_codes:'No active transmission DTC is present.',live_data:'Inching input changes near the top of pedal travel but does not consistently reach the released condition at the physical stop.',pedal_free_travel:'Pedal/linkage free travel is insufficient and the inching mechanism remains partially applied with the pedal released.',inching_adjustment:'Adjustment is outside specification. Correcting the adjustment allows the released state to occur before the pedal reaches the stop.',pressure_released:'Clutch pressure increases to normal only when the linkage is manually moved farther into the released position.'}},
      {key:'low_regulated_pressure',diagnosis:'Transmission / shuttle regulated hydraulic pressure is below specification',repair:'Repair the cause of low regulated transmission pressure, then verify base pressure and both forward/reverse clutch pressures meet specification through the full temperature range',proof:['base_pressure','forward_reverse_compare'],points:{base_pressure:20,forward_reverse_compare:15},overrides:{fault_codes:'No active electrical fault code explains the complaint.',live_data:'Inching input and shuttle commands are correct. Electrical command states match the operator controls.',base_pressure:'Base/regulated transmission pressure is below specification at the test port, especially when warm.',forward_reverse_compare:'Both forward and reverse clutch apply pressures are lower than expected under the same operating conditions.',pressure_released:'Pressure does not fully recover when the inching pedal is released even though the electrical input is correct.'}},
      {key:'inching_hydraulic_valve',diagnosis:'Inching hydraulic valve/spool does not fully return when the pedal is released',repair:'Repair the sticking or maladjusted inching hydraulic valve/linkage, verify free movement and full return, then confirm clutch pressure drops and recovers correctly through repeated pedal cycles',proof:['pressure_applied','pressure_released','mechanical_return'],points:{pressure_applied:10,pressure_released:15,mechanical_return:10},overrides:{fault_codes:'No active transmission DTC is present.',live_data:'Inching input changes correctly from ACTIVE to RELEASED and shuttle command remains valid.',pressure_applied:'Clutch pressure drops normally as the inching pedal is depressed.',pressure_released:'Clutch pressure does not return fully when the pedal is released.',mechanical_return:'The inching valve/linkage does not return completely to its released stop. Manually returning it restores normal clutch pressure and engagement.'}},
      {key:'single_clutch_pressure_loss',diagnosis:'One shuttle clutch circuit has a hydraulic pressure loss while the opposite direction remains normal',repair:'Repair the proven affected clutch hydraulic circuit/internal sealing fault, then verify pressure retention and smooth engagement in both directions hot and cold',proof:['forward_pressure','reverse_pressure','pressure_hold'],points:{forward_pressure:10,reverse_pressure:10,pressure_hold:15},overrides:{fault_codes:'No active electrical DTC is present.',live_data:'Inching input, shuttle lever position, and solenoid command states are correct.',forward_pressure:'Forward clutch apply pressure is within specification and stable.',reverse_pressure:'Reverse clutch apply pressure rises slowly and remains below specification when the complaint occurs.',pressure_hold:'The affected clutch circuit cannot maintain pressure under the hold/leakage check, indicating an internal hydraulic loss.'}},
      {key:'solenoid_current_issue',diagnosis:'Shuttle clutch solenoid is commanded correctly but current/loaded voltage is insufficient',repair:'Repair the high-resistance solenoid feed/ground connection or proven failed solenoid, then verify correct current, clutch-pressure rise, and smooth shuttle engagement',replacementAction:'replace_shuttle_solenoid',proof:['solenoid_command','solenoid_loaded_test'],points:{solenoid_command:15,solenoid_loaded_test:20},overrides:{fault_codes:'A command-related history code may be stored, but it does not identify whether the solenoid or circuit is at fault.',live_data:'Inching input is RELEASED and the requested shuttle direction is commanded ON.',solenoid_command:'Controller output command is present when the direction is requested.',solenoid_loaded_test:'Loaded voltage/current at the commanded clutch solenoid is below expected. Circuit testing isolates excessive resistance in the feed/ground path or an abnormal solenoid load.',pressure_released:'Clutch pressure is low only while the solenoid is receiving insufficient current.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'1 — Verify the Inching / Re-Engagement Complaint',points:10,result:'Complaint reproduced by operating the tractor, applying the inching pedal, releasing it, and observing shuttle re-engagement hot and cold.'},
      {key:'fault_codes',category:'Fault Codes',label:'2 — Read Transmission / Shuttle Fault Codes',points:10,result:'Transmission faults and history are recorded before clearing anything. No code is treated as a parts order.'},
      {key:'live_data',category:'Live Data',label:'3 — Watch Shuttle Command and Inching Input Together',points:15,result:'Shuttle lever request, inching input, clutch/solenoid command state and related interlocks are displayed together.'},
      {key:'inching_live',category:'Live Data',label:'4 — Verify Inching Input Applied and Released',points:0,result:'The inching input is monitored through full pedal travel and at the released stop.'},
      {key:'pedal_free_travel',category:'Component Tests',label:'5 — Inspect Inching Pedal Free Travel / Mechanical Release',points:0,result:'Pedal free travel, linkage travel and full released position are inspected before adjustment.'},
      {key:'inching_adjustment',category:'Component Tests',label:'6 — Check Inching Pedal / Switch Adjustment',points:0,result:'Inching pedal and switch/sensor adjustment are compared with the service procedure.'},
      {key:'inching_input_circuit',category:'Multimeter',label:'Meter-Test Inching Switch / Sensor Circuit',points:0,result:'Inching input supply, ground and signal are tested only after live data indicates an input problem.'},
      {key:'base_pressure',category:'Pressure Tests',label:'7 — Measure Transmission / Shuttle Base Pressure',points:0,result:'Base or regulated transmission pressure is measured at the specified test location and operating condition.'},
      {key:'pressure_applied',category:'Pressure Tests',label:'8 — Watch Clutch Pressure While Inching Pedal Is Applied',points:0,result:'Clutch pressure response is observed as the inching pedal is progressively depressed.'},
      {key:'pressure_released',category:'Pressure Tests',label:'9 — Watch Clutch Pressure Recovery as Pedal Is Released',points:0,result:'Clutch pressure recovery is observed as the inching pedal returns fully to the released position.'},
      {key:'forward_pressure',category:'Pressure Tests',label:'10 — Measure Forward Clutch Apply Pressure',points:0,result:'Forward clutch apply pressure is measured under the same temperature and engine-speed conditions.'},
      {key:'reverse_pressure',category:'Pressure Tests',label:'11 — Measure Reverse Clutch Apply Pressure',points:0,result:'Reverse clutch apply pressure is measured under the same temperature and engine-speed conditions.'},
      {key:'forward_reverse_compare',category:'Pressure Tests',label:'Compare Forward and Reverse Clutch Pressure',points:0,result:'Forward and reverse clutch pressures are compared so a system-wide pressure problem can be separated from a single-clutch problem.'},
      {key:'pressure_hold',category:'Pressure Tests',label:'Perform Clutch Pressure Hold / Leakage Check',points:0,result:'Affected clutch circuit is checked for pressure retention/internal leakage.'},
      {key:'mechanical_return',category:'Component Tests',label:'Check Inching Valve / Linkage Full Mechanical Return',points:0,result:'Mechanical return of the inching valve/linkage is verified with the pedal released.'},
      {key:'solenoid_command',category:'Live Data',label:'Verify Shuttle Solenoid Command',points:0,result:'Controller clutch-solenoid command is compared with the requested direction and inching state.'},
      {key:'solenoid_loaded_test',category:'Multimeter',label:'Loaded Voltage / Current Test — Shuttle Solenoid',points:0,result:'Commanded solenoid feed and ground are tested under load rather than by open-circuit voltage alone.'},
      {key:'service_info',category:'Service Information',label:'Review 6075 Inching Pedal and Pressure Test Procedure',points:0,result:'Service procedure, adjustment points and pressure-test locations are reviewed before repair.'},
      {key:'replace_shuttle_solenoid',category:'Replace Part',label:'Replace Shuttle Solenoid',penalty:15,result:'PARTS CANNON PENALTY: shuttle solenoid replaced before command, loaded circuit and pressure response were proven.'},
      {key:'adjust_inching_pedal',category:'Replace Part',label:'Adjust Inching Pedal Before Testing',penalty:10,result:'DIAGNOSTIC PENALTY: inching adjustment changed before the original condition and pressure response were documented.'},
      {key:'replace_transmission_controller',category:'Replace Part',label:'Replace Transmission Controller',penalty:15,result:'PARTS CANNON PENALTY: controller replaced before inputs, commands, electrical load and hydraulic pressures were proven.'}
    ]
  },
  'fmcu-pto-no-operation':{
    key:'fmcu-pto-no-operation',series:'FMCU Electrical',level:'Level 2',title:'PTO Commanded ON — PTO Does Not Engage',model:'Mahindra 3100',workOrder:'SIM-FMCU-PTO-001',hours:286,complaint:'The operator reports that the PTO will not engage. The PTO switch is being commanded ON, but the PTO does not operate.',assignment:'Follow the FMCU diagnostic path in order. Prove controller power and ground, verify the input state, confirm the FMCU command, test the output circuit at the load, prove the root cause, then verify the repair. Do not replace the FMCU or PTO components without evidence.',
    rootCauses:[
      {key:'fmcu_ground_drop',diagnosis:'Excessive voltage drop in the FMCU ground circuit',repair:'Repair the FMCU ground connection, verify loaded ground voltage drop, confirm stable FMCU communication and input/output operation, then reproduce the original PTO complaint to verify the repair',proof:['controller_power_ground','ground_voltage_drop'],points:{controller_power_ground:20,ground_voltage_drop:15},overrides:{precheck:'Battery voltage and visible fuses appear normal. No obvious connector damage is seen.',fault_codes:'Several intermittent FMCU supply/communication-related faults are stored, but none identifies a failed component.',live_data:'PTO switch state changes correctly. Required interlocks are satisfied. PTO command is inconsistent/intermittent.',controller_power_ground:'Battery feed at FMCU is correct. Ground circuit shows abnormal voltage while the PTO request is active.',ground_voltage_drop:'Loaded FMCU ground voltage drop measures 1.12 V during the complaint. A temporary approved ground bypass restores normal PTO command and operation.',output_command:'With the ground fault present, FMCU output command is unstable.'}},
      {key:'pto_input_open',diagnosis:'Open/high-resistance PTO switch input circuit prevents the FMCU from seeing the PTO request',repair:'Repair the PTO switch input circuit/connector, verify the FMCU live-data state follows the physical switch, then verify normal PTO engagement through repeated operation',proof:['input_live_data','input_circuit_meter'],points:{input_live_data:20,input_circuit_meter:15},overrides:{fault_codes:'No active DTC directly identifies the failed component.',live_data:'PTO switch physically ON | FMCU PTO switch state: OFF | Interlocks otherwise satisfied.',input_live_data:'The physical PTO switch changes position, but the FMCU live-data state remains OFF.',input_circuit_meter:'Switch supply and ground are correct. Signal is present at the switch but missing at the FMCU connector. Continuity test identifies high resistance/open in the signal path.',output_command:'FMCU PTO output command remains OFF because it does not see a valid PTO request.'}},
      {key:'output_harness_open',diagnosis:'Open/high-resistance circuit between the FMCU output and PTO solenoid',repair:'Repair the PTO output harness/connector, verify commanded voltage and current reach the PTO solenoid, then operate the PTO under the original conditions to verify the repair',proof:['output_command','load_voltage'],points:{output_command:15,load_voltage:20},overrides:{live_data:'PTO switch: ON | Interlocks: SATISFIED | FMCU PTO command: ON.',output_command:'FMCU live data shows PTO output COMMAND ON. Voltage is present at the FMCU output pin when commanded.',load_voltage:'0 V is measured at the PTO solenoid connector while the FMCU output is commanded ON. Voltage-drop/continuity testing identifies an open/high-resistance harness connection between the FMCU and load.',solenoid_test:'PTO solenoid coil resistance is within expected range.'}},
      {key:'pto_solenoid_failed',diagnosis:'PTO solenoid coil/load has failed electrically',repair:'Replace the failed PTO solenoid after proving command voltage, ground, and circuit integrity; then verify solenoid current and normal PTO engagement',replacementAction:'replace_pto_solenoid',proof:['load_voltage','solenoid_test'],points:{load_voltage:15,solenoid_test:20},overrides:{live_data:'PTO switch: ON | Interlocks: SATISFIED | FMCU PTO command: ON.',output_command:'FMCU commands the PTO output ON normally.',load_voltage:'Battery voltage reaches the PTO solenoid connector while commanded. Ground voltage drop is 0.04 V.',solenoid_test:'PTO solenoid coil measures open circuit and draws no current when commanded.'}},
      {key:'fmcu_output_driver',diagnosis:'FMCU internal PTO output driver failure',repair:'Replace/program the FMCU only after proving correct powers, grounds, input states, network condition, and an intact output circuit/load; then verify programming, PTO command, and operation',replacementAction:'replace_fmcu',proof:['controller_power_ground','input_live_data','output_command','output_circuit_integrity'],points:{controller_power_ground:10,input_live_data:10,output_command:10,output_circuit_integrity:5},overrides:{fault_codes:'No active DTC directly identifies an output-driver failure.',live_data:'PTO switch: ON | Interlocks: SATISFIED | Required machine states valid | PTO output command expected.',controller_power_ground:'FMCU battery feed, ignition feed, and loaded ground voltage drop are all within specification.',input_live_data:'PTO switch and all required interlock states in live data match the physical tractor.',output_command:'Logic conditions are satisfied, but no PTO output voltage is produced at the FMCU output pin.',output_circuit_integrity:'Output wire to the PTO solenoid has good continuity, no short to power/ground, correct terminal tension, and the solenoid/load tests good.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'1 — Verify the PTO Complaint',points:10,result:'Complaint verified under the same operating conditions: PTO request is made but PTO does not engage.'},
      {key:'precheck',category:'Visual Inspection',label:'2 — Five-Minute Electrical Pre-Check',points:0,result:'Battery condition, fuses/feeds, visible grounds, connector condition and harness routing checked before opening diagnostic software.'},
      {key:'controller_power_ground',category:'Multimeter',label:'3 — Prove FMCU Power, Ignition Feed & Ground',points:0,result:'FMCU power, wake-up feed and ground paths tested under the complaint condition.'},
      {key:'ground_voltage_drop',category:'Multimeter',label:'Loaded Voltage-Drop Test — FMCU Ground',points:0,result:'FMCU ground path voltage-drop tested with the circuit operating.'},
      {key:'connect_tool',category:'Service Information',label:'4 — Connect Correct Garuda / Pigtail / FES iSmart FMCU',points:0,result:'Correct diagnostic interface, connector/pigtail and FMCU diagnostic application verified before diagnosis.'},
      {key:'fault_codes',category:'Fault Codes',label:'5 — Record FMCU Fault Codes / Present State',points:10,result:'FMCU fault codes and present-state information recorded as a starting point, not treated as a parts order.'},
      {key:'live_data',category:'Live Data',label:'6 — Review PTO / Interlock Live Data',points:15,result:'PTO request, neutral/safety conditions and related machine-state data reviewed.'},
      {key:'input_live_data',category:'Live Data',label:'7 — Compare Physical PTO Switch to FMCU Input State',points:0,result:'Physical switch position compared directly to the FMCU live-data input state.'},
      {key:'input_circuit_meter',category:'Multimeter',label:'8 — Meter-Test PTO Input Circuit',points:0,result:'PTO input circuit supply, ground, signal and continuity tested at the switch and FMCU.'},
      {key:'output_command',category:'Live Data',label:'9 — Determine Whether FMCU Commands PTO Output',points:0,result:'Required input conditions checked and FMCU PTO command state observed while the request is active.'},
      {key:'load_voltage',category:'Multimeter',label:'10 — Measure Voltage / Ground at PTO Solenoid While Commanded',points:0,result:'Voltage and ground at the PTO load measured while the FMCU command is active.'},
      {key:'output_circuit_integrity',category:'Multimeter',label:'11 — Prove Output Wiring / Connector Integrity',points:0,result:'Output wiring checked for continuity, voltage drop, shorts and terminal condition between FMCU and PTO load.'},
      {key:'solenoid_test',category:'Component Tests',label:'12 — Test PTO Solenoid Coil / Current',points:0,result:'PTO solenoid electrical condition and current draw tested only after command and delivery were checked.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review FMCU PTO Input / Output Wiring Diagram',points:0,result:'Wiring diagram reviewed to identify the input path, FMCU pins, output path, connectors and load.'},
      {key:'logic_table',category:'Service Information',label:'Use PTO / Neutral / Safety Logic Table',points:0,result:'Actual tractor input state compared with the expected FMCU output decision.'},
      {key:'wiggle',category:'Component Tests',label:'Wiggle-Test Harness While Watching Data / Meter',points:0,result:'Harness sections moved one at a time while live data and electrical measurements are monitored.'},
      {key:'replace_pto_switch',category:'Replace Part',label:'Replace PTO Switch',penalty:15,result:'PARTS CANNON PENALTY: PTO switch replaced without electrical proof of failure.'},
      {key:'replace_pto_solenoid',category:'Replace Part',label:'Replace PTO Solenoid',penalty:15,result:'PARTS CANNON PENALTY: PTO solenoid replaced without proof of failed coil/load.'},
      {key:'replace_fmcu',category:'Replace Part',label:'Replace / Program FMCU',penalty:15,result:'PARTS CANNON PENALTY: FMCU replaced before power, ground, inputs, command and output circuit were proven.'}
    ]
  },
  'auto4wd-no-engage-low-speed':{
    key:'auto4wd-no-engage-low-speed',series:'AUTO 4WD',level:'Level 2',title:'Auto 4WD Will Not Engage Below 14 km/h',model:'Mahindra HCE Platform',workOrder:'SIM-A4WD-001',hours:214,complaint:'The operator reports that with the 4WD switch in Auto, both brakes released, and the tractor traveling below 14 km/h, the tractor remains in 2WD instead of engaging 4WD.',assignment:'Follow the Auto 4WD diagnostic path in order: MODE → SPEED → BRAKES → COMMAND → OUTPUT. Prove what the controller sees, determine what it should command from the logic matrix, then prove the output circuit and hardware before replacing any part.',
    rootCauses:[
      {key:'mode_switch_input',diagnosis:'Auto 4WD mode-switch input does not match the physical switch position',repair:'Repair the Auto 4WD mode-switch input circuit/connector or switch only after proving the input failure; then verify live data shows A / Auto and repeat the functional test',replacementAction:'replace_4wd_switch',proof:['mode_live','mode_circuit'],points:{mode_live:20,mode_circuit:15},overrides:{live_data:'Physical switch: A / AUTO | Controller 4WD switch position: not A / AUTO | Vehicle speed and brake states otherwise plausible.',mode_live:'The physical switch is in A / AUTO, but live data does not report A / AUTO.',mode_circuit:'Testing confirms the Auto-mode request is not reaching the controller correctly.',command_check:'The controller does not command 4WD because it does not see Auto mode.'}},
      {key:'speed_signal_wrong',diagnosis:'Vehicle-speed input is incorrect or unstable, causing the controller to believe the tractor is above the Auto 4WD engagement threshold',repair:'Repair the vehicle-speed input circuit/source so live data matches actual tractor speed; then verify 4WD engages below 14 km/h and releases above 15 km/h with no brakes applied',proof:['speed_live','speed_compare'],points:{speed_live:20,speed_compare:15},overrides:{live_data:'4WD switch: A / AUTO | Both brake inputs: OFF | Vehicle-speed live data does not agree with actual low tractor speed.',speed_live:'Actual tractor speed is below 14 km/h, but controller live data indicates a speed above the Auto-mode engagement threshold or is unstable.',speed_compare:'Independent speed/vehicle-state verification confirms the controller speed input is inaccurate.',command_check:'Because the controller sees the wrong speed condition, its 4WD command does not match the expected low-speed Auto state.'}},
      {key:'brake_input_wrong',diagnosis:'One brake input is stuck or misreported ON, causing Auto logic to command 2WD for a brake-assisted turn',repair:'Repair/adjust the affected brake input circuit or switch so left and right brake live-data states match the pedals; then repeat the Auto 4WD logic matrix checks',proof:['brake_live','brake_individual'],points:{brake_live:20,brake_individual:15},overrides:{live_data:'4WD switch: A / AUTO | Vehicle speed: below 14 km/h | One brake input shows ON even though both brake pedals are released.',brake_live:'With both brake pedals physically released, one controller brake-input state remains ON.',brake_individual:'Testing the left and right brake inputs independently identifies the input that does not follow pedal operation.',command_check:'The controller commands 2WD because it believes one brake is applied.'}},
      {key:'output_harness',diagnosis:'4WD command is correct, but the electrical output does not reach the 4WD actuator because of an open/high-resistance output circuit or connector',repair:'Repair the 4WD output wiring/connector after proving the command is present at the controller and missing at the actuator; then verify physical 4WD engagement through the functional matrix',proof:['command_check','output_delivery'],points:{command_check:15,output_delivery:20},overrides:{live_data:'4WD switch: A / AUTO | Vehicle speed: below 14 km/h | Both brakes: OFF | 4WD command: ON.',command_check:'The controller command matches the logic table and requests 4WD ON.',output_delivery:'The expected electrical command is present at the controller side but is not delivered correctly to the 4WD actuator circuit. Wiring/connector testing isolates the failed path.',actuator_test:'The 4WD actuator/load tests normally when the circuit is supplied correctly.'}},
      {key:'actuator_fault',diagnosis:'4WD actuator / solenoid / clutch hardware does not respond even though the controller command and electrical delivery are correct',repair:'Repair or replace the proven failed 4WD actuator/solenoid/clutch component, then verify physical axle engagement and repeat the Auto 4WD matrix',replacementAction:'replace_4wd_actuator',proof:['output_delivery','actuator_test'],points:{output_delivery:15,actuator_test:20},overrides:{live_data:'4WD switch: A / AUTO | Vehicle speed: below 14 km/h | Both brakes: OFF | 4WD command: ON.',command_check:'The controller correctly commands 4WD ON.',output_delivery:'Electrical command, power/ground path and circuit delivery to the 4WD hardware are present during the command.',actuator_test:'The 4WD actuator/solenoid/clutch hardware does not respond correctly even though the commanded electrical path is present.'}},
      {key:'controller_logic',diagnosis:'Controller/FMCU command does not match the Auto 4WD logic even though mode, speed, and brake inputs are all correct',repair:'Repair/program/replace the controller only after proving the mode, speed, brake inputs and output circuit/hardware are correct; then verify the complete Auto 4WD logic matrix',replacementAction:'replace_fmcu',proof:['mode_live','speed_live','brake_live','command_check','output_circuit_integrity'],points:{mode_live:8,speed_live:8,brake_live:8,command_check:8,output_circuit_integrity:3},overrides:{live_data:'4WD switch: A / AUTO | Vehicle speed: below 14 km/h | Brake LH: OFF | Brake RH: OFF | Expected state: 4WD | Controller command: OFF.',mode_live:'Controller correctly sees A / AUTO.',speed_live:'Controller speed data correctly shows the tractor below 14 km/h.',brake_live:'Both brake inputs correctly show OFF with pedals released.',command_check:'All required inputs match the Auto 4WD logic matrix, but the controller command remains OFF instead of commanding 4WD.',output_circuit_integrity:'4WD output wiring, connectors and actuator/load are proven capable of operating correctly.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'1 — Reproduce the Complaint Under Exact Conditions',points:10,result:'Complaint reproduced with switch in Auto, both brakes released, and tractor below 14 km/h while physical 4WD state is checked.'},
      {key:'logic_matrix',category:'Service Information',label:'2 — Determine the Expected State From the Logic Matrix',points:10,result:'For Auto mode, no brakes and speed below 14 km/h, the expected driveline state is 4WD.'},
      {key:'live_data',category:'Live Data',label:'3 — Build the Auto 4WD Live-Data Screen',points:10,result:'4WD switch position, vehicle speed, LH brake, RH brake, 4WD command and telltale command are displayed together.'},
      {key:'mode_live',category:'Live Data',label:'4 — Verify MODE: Does Live Data Show A / AUTO?',points:0,result:'Physical 4WD switch position compared with controller mode input.'},
      {key:'mode_circuit',category:'Multimeter',label:'Meter-Test 4WD Mode-Switch Input Circuit',points:0,result:'4WD switch/input circuit tested only if the live-data mode does not match the physical switch.'},
      {key:'speed_live',category:'Live Data',label:'5 — Verify SPEED: Does Live Data Show Below 14 km/h?',points:0,result:'Controller vehicle-speed data compared with the actual low-speed operating condition.'},
      {key:'speed_compare',category:'Component Tests',label:'Compare Vehicle-Speed Signal to Actual Tractor Speed',points:0,result:'Vehicle-speed input independently checked when live data does not agree with the tractor.'},
      {key:'brake_live',category:'Live Data',label:'6 — Verify BRAKES: Are LH and RH Inputs Both OFF?',points:0,result:'Both brake live-data states compared with the released brake pedals.'},
      {key:'brake_individual',category:'Component Tests',label:'Test Left and Right Brake Inputs Independently',points:0,result:'Each brake input checked individually so one-brake and both-brakes logic can be distinguished.'},
      {key:'command_check',category:'Live Data',label:'7 — Verify COMMAND: Does the Controller Command 4WD ON?',points:0,result:'Controller 4WD command compared with the expected state from mode, speed and brake inputs.'},
      {key:'output_delivery',category:'Multimeter',label:'8 — Prove OUTPUT: Measure the 4WD Actuator Circuit While Commanded',points:0,result:'Voltage/current delivery and ground path to the 4WD hardware checked while the controller command is active.'},
      {key:'output_circuit_integrity',category:'Multimeter',label:'Prove 4WD Output Wiring / Connector Integrity',points:0,result:'4WD output wiring and connectors checked for continuity, voltage drop, shorts and terminal condition.'},
      {key:'actuator_test',category:'Component Tests',label:'9 — Test 4WD Solenoid / Clutch / Actuator Response',points:0,result:'4WD hardware tested only after the controller command and electrical delivery are proven.'},
      {key:'physical_state',category:'Visual Inspection',label:'10 — Compare Command, Telltale and Physical Axle Engagement',points:0,result:'Controller command, indicator/telltale behavior and actual driveline engagement are compared rather than relying on the lamp alone.'},
      {key:'functional_matrix',category:'Component Tests',label:'11 — Run the Auto 4WD Functional Matrix',points:0,result:'Auto/no brakes/below 14, Auto/no brakes/above 15, Auto/both brakes, Auto/one brake, Mode B and Mode C both-brakes conditions are checked one condition at a time.'},
      {key:'verify_repair',category:'Visual Inspection',label:'12 — Verify the Repair Under the Original Complaint Condition',points:10,result:'Original low-speed Auto complaint is repeated and the commanded state, telltale and physical driveline response are verified.'},
      {key:'replace_4wd_switch',category:'Replace Part',label:'Replace Auto 4WD Switch',penalty:15,result:'PARTS CANNON PENALTY: 4WD switch replaced before proving the mode input failure.'},
      {key:'replace_speed_sensor',category:'Replace Part',label:'Replace Vehicle-Speed Sensor / Source',penalty:15,result:'PARTS CANNON PENALTY: speed component replaced before proving the speed input is wrong.'},
      {key:'replace_brake_switch',category:'Replace Part',label:'Replace Brake Switch',penalty:15,result:'PARTS CANNON PENALTY: brake switch replaced before proving which brake input does not match pedal state.'},
      {key:'replace_4wd_actuator',category:'Replace Part',label:'Replace 4WD Solenoid / Clutch / Actuator',penalty:15,result:'PARTS CANNON PENALTY: 4WD hardware replaced before command and electrical delivery were proven.'},
      {key:'replace_fmcu',category:'Replace Part',label:'Replace / Program FMCU',penalty:20,result:'PARTS CANNON PENALTY: controller replaced before mode, speed, brakes, command and output path were proven.'}
    ]
  },
  '5145-hitch-low':{
    key:'5145-hitch-low',series:'5000 Series',level:'Level 2',title:'Three-Point Hitch Raises Only About One Foot',model:'Mahindra 5155',workOrder:'SIM-5155-001',hours:367,complaint:'Three-point hitch raises from the bottom but stops after approximately one foot of travel.',assignment:'Determine whether the limitation comes from command/calibration, feedback, hydraulics or mechanical linkage.',
    rootCauses:[
      {key:'position_sensor',diagnosis:'Hitch position sensor is misadjusted / feedback reaches full-scale too early',repair:'Adjust/calibrate the hitch position sensor and verify full hitch travel and correct position feedback',proof:['position_live','sensor_voltage'],points:{position_live:20,sensor_voltage:15},overrides:{live_data:'Hitch command: 100% | Hitch position feedback: 100% when arms are only about one-third raised | Raise output: OFF',position_live:'Feedback rises to 100% long before the hitch reaches full mechanical height.',sensor_voltage:'Position sensor signal reaches the upper limit prematurely; supply and ground are correct.'}},
      {key:'calibration',diagnosis:'Hitch controller calibration is incorrect/corrupted',repair:'Perform the specified hitch calibration and verify commanded vs actual position through full travel',proof:['position_live','calibration_check'],points:{position_live:15,calibration_check:20},overrides:{live_data:'Position sensor voltage changes smoothly, but learned lower/upper limits do not correspond to actual hitch travel.',calibration_check:'Stored hitch endpoint values are outside expected range. Sensor electrical sweep is normal.'}},
      {key:'raise_solenoid',diagnosis:'Raise-control solenoid/valve does not maintain commanded flow',repair:'Repair/replace the raise-control solenoid/valve after electrical and hydraulic proof; verify full hitch travel',replacementAction:'replace_raise_solenoid',proof:['raise_command','solenoid_current'],points:{raise_command:15,solenoid_current:20},overrides:{live_data:'Hitch command remains 100% | Position feedback 35% | Raise command ON | Hitch stops raising',raise_command:'Controller continues commanding raise after movement stops.',solenoid_current:'Command voltage is present but raise-solenoid current is abnormal and coil resistance is out of specification.'}},
      {key:'hydraulic_pressure',diagnosis:'Insufficient hitch hydraulic pressure / flow under load',repair:'Repair the hydraulic supply/pressure fault and verify lift capacity and full hitch travel',proof:['hitch_pressure','flow_test'],points:{hitch_pressure:20,flow_test:15},overrides:{live_data:'Hitch command and position feedback remain valid. Raise output remains ON.',hitch_pressure:'Hitch lift pressure is below specification as the arms stop moving.',flow_test:'Hydraulic flow to the hitch circuit drops below specification under load.'}},
      {key:'mechanical_linkage',diagnosis:'Mechanical linkage/interference prevents full hitch travel',repair:'Correct the binding/misadjusted mechanical linkage and verify unrestricted full hitch travel',proof:['visual_linkage','manual_linkage'],points:{visual_linkage:20,manual_linkage:15},overrides:{live_data:'Hitch command remains ON and feedback indicates partial travel.',visual_linkage:'Linkage inspection shows interference/binding near the point where the hitch stops.',manual_linkage:'With hydraulic force removed, the linkage does not move freely through the full expected range.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Hitch Travel Complaint',points:10,result:'Hitch raises approximately one foot and then stops.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Hitch / Controller Fault Codes',points:10,result:'No active code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review Hitch Command and Position Feedback',points:15,result:'Hitch live data retrieved.'},
      {key:'position_live',category:'Live Data',label:'Sweep Hitch Through Available Travel',points:0,result:'Position-feedback response monitored.'},
      {key:'sensor_voltage',category:'Multimeter',label:'Measure Hitch Position Sensor Signal',points:0,result:'Position sensor supply, ground and signal measured.'},
      {key:'calibration_check',category:'Service Information',label:'Check Stored Hitch Calibration / Endpoints',points:0,result:'Hitch calibration values reviewed.'},
      {key:'raise_command',category:'Multimeter',label:'Check Raise-Solenoid Command Voltage',points:0,result:'Raise-solenoid command voltage measured while hitch stops.'},
      {key:'solenoid_current',category:'Component Tests',label:'Check Raise Solenoid Coil / Current',points:0,result:'Raise-solenoid electrical test completed.'},
      {key:'hitch_pressure',category:'Pressure Tests',label:'Measure Hitch Lift Pressure',points:0,result:'Hitch lift pressure measured under load.'},
      {key:'flow_test',category:'Pressure Tests',label:'Check Hydraulic Flow to Hitch Circuit',points:0,result:'Hydraulic flow test completed.'},
      {key:'visual_linkage',category:'Visual Inspection',label:'Inspect Hitch Linkage for Binding / Interference',points:0,result:'Hitch linkage inspected through available travel.'},
      {key:'manual_linkage',category:'Component Tests',label:'Check Linkage Freedom of Movement',points:0,result:'Mechanical linkage freedom-of-movement test completed.'},
      {key:'replace_raise_solenoid',category:'Replace Part',label:'Replace Hitch Raise Solenoid',penalty:15,result:'PARTS CANNON PENALTY: raise solenoid replaced without proof.'},
      {key:'replace_position_sensor',category:'Replace Part',label:'Replace Hitch Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: position sensor replaced without proof.'}
    ]
  }
};

const LEGACY58_DEFAULT_MASTER_CHALLENGE = {
  key:'master-6075-inching-pressure',
  title:'6075 Master Diagnostic Challenge — Inching Pedal / Shuttle Pressure',
  series:'6000 / PST', level:'Master Technician', model:'Mahindra 6075 Power Shuttle', workOrder:'MASTER-6075-001', hours:744,
  complaint:'After using the inching pedal, the tractor may hesitate, creep, or fail to re-engage smoothly when the pedal is released. The concern can become more noticeable when warm.',
  assignment:'Diagnose the complaint without a guided path. Decide which information and tests are necessary, document your evidence, prove the root cause, select the supported repair, and verify the repair under the original complaint conditions.',
  passScore:85, targetMinutes:45, maxPartsPenalties:1, partsPenalty:15, timePenaltyPerMinute:1,
  scoring:{diagnosis:25,repair:15,verification:10,evidence:10},
  hints:[
    {text:'Separate the complaint into input, command, hydraulic pressure, and mechanical response.',penalty:3},
    {text:'Compare inching input status with the physical pedal position, then compare pressure before, during, and after inching.',penalty:6},
    {text:'A correct command does not prove pressure or clutch apply. Prove pressure recovery and compare forward/reverse circuits.',penalty:10}
  ],
  instructorSetup:'Warm the tractor enough to reproduce the complaint. Plant only one hidden failure. Record the normal reference condition before the technician starts.',
  plantFault:'Use the selected hidden root cause. Create the fault in a safe, reversible way and never defeat a safety interlock in a manner that creates an uncontrolled machine movement hazard.',
  expectedReadings:'Expected readings are defined by the selected root cause. The technician must compare actual values to the applicable 6075 service information and document the evidence.',
  resetProcedure:'Return all connectors, adjustments, hydraulic circuits, and software settings to the original configuration. Re-run the complaint verification after reset.',
  safetyNotes:'Park on level ground, secure the tractor, use wheel chocks as needed, keep personnel clear of the tractor, and follow approved pressure-test and electrical-test procedures.',
  rootCauses:[
    {key:'inching_input_active',diagnosis:'Inching input remains ACTIVE with the pedal fully released',repair:'Adjust or repair the inching input circuit/switch/sensor and verify released status plus normal engagement.',proof:['inching_live','pedal_adjustment'],overrides:{inching_live:'Live data shows INCHING ACTIVE with the pedal fully released.',pedal_adjustment:'Physical inspection shows the inching switch/sensor or linkage is out of adjustment. Repositioning it restores the correct released state.'}},
    {key:'pedal_adjustment',diagnosis:'Inching pedal/linkage adjustment prevents full valve or sensor return',repair:'Correct the inching pedal/linkage adjustment and verify full mechanical return, released input status, and normal pressure recovery.',proof:['pedal_adjustment','pressure_recovery'],overrides:{pedal_adjustment:'Pedal/linkage free play and return position are outside the applicable service specification.',pressure_recovery:'Pressure recovery is delayed until the pedal/linkage is manually returned to its full released position.'}},
    {key:'regulated_pressure_low',diagnosis:'Regulated transmission pressure is below specification',repair:'Correct the regulated-pressure fault and verify base pressure, clutch apply pressure, and hot engagement.',proof:['base_pressure','pressure_recovery'],overrides:{base_pressure:'Regulated transmission pressure is below the applicable 6075 specification at the required test condition.',pressure_recovery:'Pressure remains low after the inching pedal is fully released.'}},
    {key:'inching_valve_return',diagnosis:'Inching hydraulic valve/spool does not fully return',repair:'Repair the sticking/restricted inching valve or spool and verify full return plus immediate pressure recovery.',proof:['pressure_recovery','mechanical_return'],overrides:{pressure_recovery:'Clutch pressure drops normally during inching but recovers slowly after pedal release.',mechanical_return:'The inching valve/spool does not consistently return to the full released position even though the pedal/input status is correct.'}},
    {key:'clutch_internal_leak',diagnosis:'Internal clutch circuit leakage causes pressure loss when warm',repair:'Repair the internal clutch/sealing leak and verify pressure retention and engagement hot and cold.',proof:['forward_reverse_compare','leak_test'],overrides:{forward_reverse_compare:'One clutch circuit is substantially lower than the comparison circuit under the same conditions.',leak_test:'Leakage/isolation testing confirms excessive internal leakage in the affected clutch circuit.'}},
    {key:'solenoid_loaded_drop',diagnosis:'Shuttle solenoid is commanded but loaded voltage/current is low',repair:'Repair the high-resistance solenoid feed/ground/connection and verify loaded voltage, current, pressure rise, and engagement.',proof:['solenoid_command','loaded_circuit'],overrides:{solenoid_command:'Controller command is ON and logic conditions are satisfied.',loaded_circuit:'Loaded voltage at the commanded solenoid is substantially below source voltage; voltage-drop testing isolates a high-resistance connection.'}}
  ],
  actions:[
    {key:'verify_complaint',category:'Verification',label:'Verify the Customer Complaint',points:10,result:'Complaint reproduced under the stated operating conditions.'},
    {key:'visual_inspection',category:'Basic Checks',label:'Perform Visual / Mechanical Pre-Check',points:3,result:'No obvious external damage or disconnected components are found. Record any pedal/linkage abnormality you observe.'},
    {key:'fault_codes',category:'Diagnostics',label:'Read and Record Fault Codes',points:5,result:'Fault-code check completed. Use the result as evidence, not a parts order.'},
    {key:'live_data',category:'Diagnostics',label:'Review Shuttle / Inching Live Data',points:5,result:'Relevant shuttle and inching inputs/commands are available for comparison with the physical tractor.'},
    {key:'inching_live',category:'Inputs',label:'Compare Inching Input to Physical Pedal Position',points:8,result:'Inching input status recorded with pedal released, partially applied, and fully applied.'},
    {key:'pedal_adjustment',category:'Mechanical',label:'Measure Inching Pedal / Linkage Adjustment',points:8,result:'Pedal/linkage adjustment and full-return condition checked against service information.'},
    {key:'base_pressure',category:'Pressure Tests',label:'Measure Base / Regulated Transmission Pressure',points:8,result:'Base regulated pressure measured at the required operating condition.'},
    {key:'pressure_during_inching',category:'Pressure Tests',label:'Measure Pressure During Inching Pedal Application',points:5,result:'Pressure response during controlled inching application recorded.'},
    {key:'pressure_recovery',category:'Pressure Tests',label:'Measure Pressure Recovery After Pedal Release',points:8,result:'Pressure recovery time and final pressure recorded after complete pedal release.'},
    {key:'forward_reverse_compare',category:'Pressure Tests',label:'Compare Forward vs Reverse Clutch Pressure',points:8,result:'Forward and reverse clutch pressure compared at the same temperature and operating condition.'},
    {key:'leak_test',category:'Hydraulic Proof',label:'Perform Clutch Circuit Leakage / Isolation Test',points:8,result:'Hydraulic leakage/isolation test completed on the affected circuit.'},
    {key:'solenoid_command',category:'Electrical',label:'Verify Shuttle Solenoid Command',points:6,result:'Controller command and related interlock/input conditions verified.'},
    {key:'loaded_circuit',category:'Electrical',label:'Load-Test Solenoid Feed and Ground',points:8,result:'Loaded voltage/current and voltage-drop measurements recorded at the commanded solenoid.'},
    {key:'mechanical_return',category:'Mechanical',label:'Verify Inching Valve / Spool Full Return',points:8,result:'Mechanical/hydraulic return of the inching valve or spool checked.'},
    {key:'replace_switch',category:'Replace Part',label:'Replace Inching Switch / Sensor',points:0,penalty:15,result:'PARTS CANNON: part replacement selected before the failure was fully proved.'},
    {key:'adjust_pedal_now',category:'Adjustment',label:'Adjust Inching Pedal Before Recording Original Condition',points:0,penalty:10,result:'PROCESS PENALTY: the original condition was altered before it was documented.'},
    {key:'replace_solenoid',category:'Replace Part',label:'Replace Shuttle Solenoid',points:0,penalty:15,result:'PARTS CANNON: solenoid replaced without sufficient proof.'},
    {key:'replace_controller',category:'Replace Part',label:'Replace Controller',points:0,penalty:20,result:'PARTS CANNON: controller replaced without proving inputs, command, circuit, and hydraulic response.'},
    {key:'split_tractor',category:'Repair',label:'Disassemble Transmission / Clutch Pack',points:0,penalty:20,result:'PARTS CANNON: major disassembly selected before pressure/leakage proof.'}
  ]
};

const LEGACY58_EMBEDDED_VIDEO_CATALOG = {
  '4600': [
    {title:'4600 Service Training', source_url:'/videos/4600_Service_Training.mp4', display_order:10, questions:[
      {time:90,question:'How many major changes from the 4500 are highlighted in this 4600 training?',choices:['10','12','14','16'],answer:2,explanation:'The training identifies fourteen things changed from the 4500.',penalty:1},
      {time:190,question:'What should be done with the battery cut-off switch before electrical or ECU work?',choices:['Leave it ON','Isolate the battery','Hold it halfway','Cycle the PTO switch'],answer:1,explanation:'The battery should be isolated before electrical or ECU procedures.',penalty:1},
      {time:405,question:'On the 4600 cluster, which gauge remains the exception to the digital gauges?',choices:['Fuel level','Coolant temperature','Tachometer','Hour meter'],answer:2,explanation:'The training notes that the tachometer is the exception while the other gauges are digital.',penalty:1},
      {time:525,question:'During the service-reminder reset, how long must the trip reset switch be held before release?',choices:['Less than 1 second','More than 5 seconds','Exactly 2 seconds','More than 60 seconds'],answer:1,explanation:'Hold the trip reset switch more than 5 seconds and release it before 30 seconds.',penalty:1},
      {time:640,question:'Which error-code class corresponds to the MIL tell-tale glowing steady?',choices:['Class 2','Class 4','Class 5','Class 6'],answer:2,explanation:'Class 5 is shown with the MIL on steadily.',penalty:1}
    ]}
  ],
  '5100': [
    {title:'5100 Refresh Introduction', source_url:'/videos/5100_Refresh_Introduction.mp4', display_order:10, questions:[
      {time:95,question:'Where were the battery and air cleaner relocated on the Refresh Fifty One Hundred?',choices:['Rear axle area','Front of the radiator / inside the hood','Under the seat','Right rear fender'],answer:1,explanation:'The Refresh layout moves the battery and air cleaner to the front-of-radiator area under/inside the hood.',penalty:1},
      {time:285,question:'Which exhaust component is shown integrated into the new HCE engine arrangement?',choices:['DOC','Muffler bypass valve','SCR-only canister','Spark arrestor'],answer:0,explanation:'The comparison slide identifies the integrated DOC with the exhaust pipe.',penalty:1},
      {time:437,question:'Which sensor is identified as a cam/phase input on the new engine sensor-location slide?',choices:['Cam phase sensor','Seat switch','PTO speed switch','Hydraulic oil level sensor'],answer:0,explanation:'The new sensor-location slide identifies the cam phase sensor.',penalty:1},
      {time:602,question:'The Fifty One Hundred transmission uses a four-speed gearbox with three ranges and F-R shuttle to provide how many speeds?',choices:['8 forward / 8 reverse','10 forward / 10 reverse','12 forward / 12 reverse','16 forward / 8 reverse'],answer:2,explanation:'The training shows a 4-speed gearbox with three ranges and F-R shuttle for 12 forward and 12 reverse speeds.',penalty:1},
      {time:905,question:'What is the first service-reminder interval shown for the new Fifty One Hundred cluster?',choices:['25 hours','50 hours','100 hours','350 hours'],answer:1,explanation:'The first service reminder is shown at 50 hours.',penalty:1}
    ]}
  ],
  '6000': [
    {title:'6000 HCE Training', source_url:'/videos/6000_HCE.mp4', display_order:10, questions:[
      {time:120,question:'What high-capacity hitch-pump flow is highlighted as a 6000 HCE change?',choices:['38 L/min','42 L/min','44 L/min','50 L/min'],answer:2,explanation:'The 6000 HCE slide shows the hitch pump increasing from 42 L/min to 44 L/min.',penalty:1},
      {time:295,question:'What change is shown for the accelerator pedal sensor mounting?',choices:['Moved lower','Mounting shifted upward','Removed from the tractor','Moved into the instrument cluster'],answer:1,explanation:'The HCE comparison shows the accelerator pedal sensor mounting shifted upward for better accessibility and stability.',penalty:1},
      {time:475,question:'What is the purpose of the battery cut-off switch assembly?',choices:['Increase alternator output','Isolate battery power','Control Auto 4WD','Reset the cluster'],answer:1,explanation:'The battery cut-off switch isolates battery power for service and electrical work.',penalty:1},
      {time:664,question:'In Auto 4WD mode, above 15 km/h with no brakes applied, what does the logic command?',choices:['4WD stays ON','4WD turns OFF / 2WD','PTO turns ON','Park brake applies'],answer:1,explanation:'The 4WD logic chart shows Auto mode above 15 km/h with no brakes applied commanding 4WD OFF (2WD).',penalty:1},
      {time:824,question:'How many total active tell-tales are listed for the 6000 / cabin-model cluster summary?',choices:['9','12','16','17'],answer:3,explanation:'The cluster summary lists 17 total active tell-tales for the 5100/6000 and cabin model.',penalty:1},
      {time:999,question:'Which warning is shown as the highest-priority buzzer condition?',choices:['OPS alarm','Service reminder','Air filter clog','Park brake'],answer:0,explanation:'The buzzer-logic table shows the OPS alarm as priority 1.',penalty:1}
    ]}
  ]
};

const EMBEDDED_VIDEO_CATALOG = {};
function embeddedVideoKey(course=''){ return ''; }
async function ensureEmbeddedVideosForClass(c){
 if(!c?.id) return;
 const key=embeddedVideoKey(c.course||''); const defs=EMBEDDED_VIDEO_CATALOG[key]||[];
 if(defs.length){
  const allowed=defs.map(d=>d.source_url);
  await pool.query(`UPDATE training_videos SET active=false WHERE class_id=$1 AND source_url LIKE '/videos/%' AND NOT (source_url = ANY($2::text[]))`,[c.id,allowed]);
 }
 for(const def of defs){
  let row=(await pool.query('SELECT * FROM training_videos WHERE class_id=$1 AND source_url=$2 ORDER BY id LIMIT 1',[c.id,def.source_url])).rows[0];
  if(!row){
   // If the instructor already added a Drive version for this course, reuse the first one
   // instead of leaving a broken duplicate on the student dashboard.
   const firstDef=defs[0]===def;
   let candidate=null;
   if(firstDef){
    candidate=(await pool.query(`SELECT * FROM training_videos WHERE class_id=$1 AND source_url NOT LIKE '/videos/%' ORDER BY active DESC,display_order,id LIMIT 1`,[c.id])).rows[0];
   }
   if(candidate){
    row=(await pool.query('UPDATE training_videos SET title=$2,source_url=$3,display_order=$4,active=true WHERE id=$1 RETURNING *',[candidate.id,def.title,def.source_url,def.display_order])).rows[0];
   }else{
    row=(await pool.query('INSERT INTO training_videos(class_id,title,source_url,display_order,active) VALUES($1,$2,$3,$4,true) RETURNING *',[c.id,def.title,def.source_url,def.display_order])).rows[0];
   }
  }
  const existing=(await pool.query('SELECT count(*)::int n FROM video_questions WHERE video_id=$1',[row.id])).rows[0]?.n||0;
  if(!existing){
   for(const q of def.questions||[]){
    await pool.query('INSERT INTO video_questions(video_id,timestamp_seconds,question,choices,answer_index,explanation,require_correct,parts_cannon_penalty) VALUES($1,$2,$3,$4,$5,$6,true,$7)',[row.id,q.time,q.question,JSON.stringify(q.choices),q.answer,q.explanation||'',q.penalty||0]);
   }
  }
 }
}

function embeddedVideoDefForRow(v){ return null; }
async function ensureEmbeddedQuestionsForVideo(v){
 if(!v?.id) return 0;
 const def=embeddedVideoDefForRow(v); if(!def) return 0;
 const existing=Number((await pool.query('SELECT count(*)::int n FROM video_questions WHERE video_id=$1',[v.id])).rows[0]?.n||0);
 if(existing) return existing;
 for(const q of def.questions||[]){
  await pool.query('INSERT INTO video_questions(video_id,timestamp_seconds,question,choices,answer_index,explanation,require_correct,parts_cannon_penalty) VALUES($1,$2,$3,$4,$5,$6,true,$7)',[v.id,q.time,q.question,JSON.stringify(q.choices),q.answer,q.explanation||'',q.penalty||0]);
 }
 return (def.questions||[]).length;
}

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS companies(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  contact_email TEXT DEFAULT '', contact_phone TEXT DEFAULT '', website_url TEXT DEFAULT '',
  plan_name TEXT DEFAULT 'Standard', created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS app_users(
  id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('company_admin','instructor','viewer')),
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  all_courses BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), last_login_at TIMESTAMPTZ,
  UNIQUE(company_id,email)
 )`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_unique ON app_users(lower(email))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS user_course_permissions(
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL, can_view BOOLEAN NOT NULL DEFAULT TRUE, can_edit BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(user_id,course_name)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_settings(
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(company_id,key)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS custom_dashboards(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '📊',
  color TEXT NOT NULL DEFAULT '#c4141c', display_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS custom_dashboard_cards(
  id SERIAL PRIMARY KEY, dashboard_id INTEGER NOT NULL REFERENCES custom_dashboards(id) ON DELETE CASCADE,
  card_type TEXT NOT NULL DEFAULT 'note', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query(`ALTER TABLE custom_dashboard_cards ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''`);
 await pool.query(`ALTER TABLE custom_dashboard_cards ADD COLUMN IF NOT EXISTS file_id INTEGER`);
 await pool.query(`ALTER TABLE custom_dashboard_cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
 await pool.query(`INSERT INTO company_settings(company_id,key,value)
  SELECT id,'custom_dashboard_enabled','true' FROM companies WHERE lower(trim(name)) LIKE 'methodist mansfield%'
  ON CONFLICT(company_id,key) DO NOTHING`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_courses(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(company_id,name)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_equipment_models(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 100, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(company_id,name)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_file_folders(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(company_id,name)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_files(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES company_file_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '', original_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_company_files_company ON company_files(company_id,folder_id,uploaded_at DESC)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS company_file_chunks(
  id SERIAL PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES company_files(id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL, chunk_data BYTEA NOT NULL, UNIQUE(file_id,chunk_no)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_company_file_chunks_file ON company_file_chunks(file_id,chunk_no)`);
 await pool.query(`ALTER TABLE company_files ALTER COLUMN file_size TYPE BIGINT USING file_size::bigint`);
 await pool.query(`CREATE TABLE IF NOT EXISTS custom_dashboard_file_versions(
  id SERIAL PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES custom_dashboard_cards(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES company_files(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL DEFAULT 1, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(card_id,version_no)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_custom_dashboard_file_versions_card ON custom_dashboard_file_versions(card_id,version_no DESC)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS custom_dashboard_spreadsheets(
  card_id INTEGER PRIMARY KEY REFERENCES custom_dashboard_cards(id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL DEFAULT 'Sheet1', source_name TEXT NOT NULL DEFAULT '',
  data_json JSONB NOT NULL DEFAULT '[]'::jsonb, row_count INTEGER NOT NULL DEFAULT 0, col_count INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS training_programs(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', join_code TEXT NOT NULL, join_token TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE, display_order INTEGER NOT NULL DEFAULT 100, created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_programs_company ON training_programs(company_id,display_order,id)`);
 await pool.query(`ALTER TABLE training_programs ADD COLUMN IF NOT EXISTS all_equipment BOOLEAN NOT NULL DEFAULT FALSE`);
 await pool.query(`CREATE TABLE IF NOT EXISTS training_program_equipment(
  program_id INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  equipment_model_id INTEGER NOT NULL REFERENCES company_equipment_models(id) ON DELETE CASCADE,
  PRIMARY KEY(program_id,equipment_model_id)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_program_equipment_program ON training_program_equipment(program_id)`);
 await pool.query(`ALTER TABLE training_programs ALTER COLUMN all_equipment SET DEFAULT FALSE`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_sections(
  id SERIAL PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 100, active BOOLEAN NOT NULL DEFAULT TRUE
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_modules(
  id SERIAL PRIMARY KEY, section_id INTEGER NOT NULL REFERENCES program_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', activity_type TEXT NOT NULL DEFAULT 'Instructor-Led Activity',
  activity_url TEXT DEFAULT '', instructions TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 100,
  required BOOLEAN NOT NULL DEFAULT TRUE, active BOOLEAN NOT NULL DEFAULT TRUE
 )`);
 await pool.query(`ALTER TABLE program_modules ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER NOT NULL DEFAULT 0`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_module_content(
  id SERIAL PRIMARY KEY, module_id INTEGER NOT NULL REFERENCES program_modules(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'Presentation / Lesson', title TEXT NOT NULL,
  body TEXT DEFAULT '', resource_url TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_module_content_module ON program_module_content(module_id,display_order,id)`);
 await pool.query(`ALTER TABLE program_module_content ADD COLUMN IF NOT EXISTS student_visibility TEXT NOT NULL DEFAULT 'visible'`);
 await pool.query(`UPDATE program_module_content SET student_visibility='visible' WHERE student_visibility IS NULL OR lower(student_visibility) NOT IN ('visible','locked','hidden')`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_module_files(
  id SERIAL PRIMARY KEY, content_id INTEGER NOT NULL UNIQUE REFERENCES program_module_content(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size INTEGER NOT NULL DEFAULT 0, file_data BYTEA NOT NULL, uploaded_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_module_files_content ON program_module_files(content_id)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_module_file_chunks(
  id SERIAL PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES program_module_files(id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL, chunk_data BYTEA NOT NULL, UNIQUE(file_id,chunk_no)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_module_file_chunks_file ON program_module_file_chunks(file_id,chunk_no)`);
 await pool.query(`ALTER TABLE program_module_files ALTER COLUMN file_size TYPE BIGINT USING file_size::bigint`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_schedule_items(
  id SERIAL PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  module_id INTEGER REFERENCES program_modules(id) ON DELETE SET NULL,
  day_name TEXT NOT NULL DEFAULT '', start_time TEXT DEFAULT '', duration_minutes INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL, item_type TEXT NOT NULL DEFAULT 'Training', display_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_schedule_program ON program_schedule_items(program_id,display_order,id)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_students(
  id SERIAL PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, dealer TEXT DEFAULT '', join_token TEXT NOT NULL UNIQUE, joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(program_id,name,dealer)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_module_progress(
  student_id INTEGER NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES program_modules(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT FALSE, completed_at TIMESTAMPTZ, PRIMARY KEY(student_id,module_id)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_test_banks(
  id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, seed_key TEXT UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_test_questions(
  id SERIAL PRIMARY KEY, bank_id INTEGER NOT NULL REFERENCES program_test_banks(id) ON DELETE CASCADE,
  question TEXT NOT NULL, choices JSONB NOT NULL DEFAULT '[]'::jsonb, answer_index INTEGER NOT NULL DEFAULT 0,
  explanation TEXT DEFAULT '', display_order INTEGER NOT NULL DEFAULT 100
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_test_questions_bank ON program_test_questions(bank_id,display_order,id)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_module_test_links(
  module_id INTEGER PRIMARY KEY REFERENCES program_modules(id) ON DELETE CASCADE,
  bank_id INTEGER NOT NULL REFERENCES program_test_banks(id) ON DELETE CASCADE,
  test_mode TEXT NOT NULL DEFAULT 'Quiz', pass_score INTEGER NOT NULL DEFAULT 80,
  randomize BOOLEAN NOT NULL DEFAULT TRUE
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS program_test_attempts(
  id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES program_students(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES program_modules(id) ON DELETE CASCADE,
  bank_id INTEGER NOT NULL REFERENCES program_test_banks(id) ON DELETE CASCADE,
  test_mode TEXT NOT NULL, question_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb, score INTEGER, correct_count INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_program_test_attempts_student ON program_test_attempts(student_id,bank_id,completed_at DESC,id DESC)`);

 await pool.query(`CREATE TABLE IF NOT EXISTS classes(
  id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, course TEXT NOT NULL,
  instructor TEXT NOT NULL, pass_score INTEGER NOT NULL DEFAULT 80, hours NUMERIC(5,2) NOT NULL DEFAULT 8,
  join_token TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), active BOOLEAN DEFAULT TRUE
 )`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS assigned_instructor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_classes_company ON classes(company_id,created_at DESC)`);
 const orphanCount=Number((await pool.query('SELECT count(*)::int n FROM classes WHERE company_id IS NULL')).rows[0].n);
 if(orphanCount){
  let cq=await pool.query(`SELECT id FROM companies WHERE slug='imported-company' LIMIT 1`);
  if(!cq.rowCount)cq=await pool.query(`INSERT INTO companies(name,slug) VALUES('Imported Company','imported-company') RETURNING id`);
  await pool.query('UPDATE classes SET company_id=$1 WHERE company_id IS NULL',[cq.rows[0].id]);
 }

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
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_tractor_count INTEGER NOT NULL DEFAULT 3`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_items_per_tractor INTEGER NOT NULL DEFAULT 5`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_type TEXT NOT NULL DEFAULT 'general'`);
 await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_no INTEGER`);
 await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_model TEXT DEFAULT ''`);
 await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS item_label TEXT DEFAULT ''`);
 await pool.query(`CREATE TABLE IF NOT EXISTS hunt_tractors(class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE, tractor_no INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', PRIMARY KEY(class_id,tractor_no))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS hunt_progress(
  id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  station_id INTEGER REFERENCES hunt_stations(id) ON DELETE CASCADE,
  answer TEXT DEFAULT '', correct BOOLEAN DEFAULT FALSE, completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id,station_id)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS activity_status(
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  activity TEXT DEFAULT 'Joined', status TEXT DEFAULT 'Joined', progress INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0, current_score INTEGER, updated_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS training_feedback(
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  overall INTEGER NOT NULL, instructor INTEGER NOT NULL, usefulness INTEGER NOT NULL,
  hands_on INTEGER NOT NULL, difficulty INTEGER NOT NULL,
  most_helpful TEXT DEFAULT '', improve TEXT DEFAULT '', comments TEXT DEFAULT '', submitted_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS quiz_progress(
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
  is_correct BOOLEAN DEFAULT FALSE, selected_answer INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(student_id,question_id)
 )`);
 await pool.query(`ALTER TABLE quiz_progress ADD COLUMN IF NOT EXISTS selected_answer INTEGER`);
 await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempts(
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  score INTEGER, correct_count INTEGER DEFAULT 0, total_questions INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempt_answers(
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  source_question_id INTEGER, display_order INTEGER NOT NULL,
  question_text TEXT NOT NULL, choices JSONB NOT NULL,
  selected_index INTEGER, selected_answer TEXT,
  correct_index INTEGER NOT NULL, correct_answer TEXT NOT NULL,
  explanation TEXT DEFAULT '', topic TEXT DEFAULT '', is_correct BOOLEAN,
  UNIQUE(attempt_id,display_order)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id,completed_at DESC)`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt ON quiz_attempt_answers(attempt_id,display_order)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS simulation_attempts(
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  simulation_key TEXT NOT NULL, title TEXT NOT NULL, work_order TEXT NOT NULL,
  score INTEGER DEFAULT 0, positive_points INTEGER DEFAULT 0, penalty_points INTEGER DEFAULT 0,
  final_diagnosis TEXT, final_repair TEXT, diagnosis_correct BOOLEAN DEFAULT FALSE, repair_correct BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'in_progress', started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS simulation_actions(
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES simulation_attempts(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL, result_text TEXT NOT NULL,
  points INTEGER DEFAULT 0, penalty INTEGER DEFAULT 0, sequence INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(attempt_id,action_key)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_sim_attempts_student ON simulation_attempts(student_id,completed_at DESC)`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_sim_actions_attempt ON simulation_actions(attempt_id,sequence)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS simulation_assignments(
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  simulation_key TEXT NOT NULL,
  root_cause_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configured_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id,simulation_key)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS simulation_content_overrides(
  simulation_key TEXT PRIMARY KEY,
  content_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
 )`);
 const simOverrides=await pool.query(`SELECT simulation_key,content_json FROM simulation_content_overrides`);
 for(const row of simOverrides.rows){
  if(row.content_json){
   SIMULATION_OVERRIDE_CACHE[row.simulation_key]=row.content_json;
  }
 }
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS root_cause_key TEXT`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS assigned_diagnosis TEXT`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS assigned_repair TEXT`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS tractor_model TEXT`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS tractor_model TEXT`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS technician_limit INTEGER DEFAULT 15`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'Intermediate'`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS pass_score INTEGER DEFAULT 80`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS max_parts_penalties INTEGER DEFAULT 1`);
 await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS prerequisite_hunt_type TEXT DEFAULT 'none'`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'Intermediate'`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS pass_score INTEGER DEFAULT 80`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS max_parts_penalties INTEGER DEFAULT 1`);
 await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT FALSE`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS evidence_text TEXT DEFAULT ''`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS evidence_required BOOLEAN DEFAULT FALSE`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS why_answer TEXT DEFAULT ''`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS why_correct BOOLEAN`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS step_seconds INTEGER DEFAULT 0`);
 await pool.query(`ALTER TABLE simulation_actions ADD COLUMN IF NOT EXISTS feedback_type TEXT DEFAULT 'neutral'`);
 await pool.query(`CREATE TABLE IF NOT EXISTS simulation_hints(id SERIAL PRIMARY KEY,attempt_id INTEGER NOT NULL REFERENCES simulation_attempts(id) ON DELETE CASCADE,level INTEGER NOT NULL,hint_text TEXT NOT NULL,penalty INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT now(),UNIQUE(attempt_id,level))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS master_challenge_content(
  challenge_key TEXT PRIMARY KEY, content_json JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS master_challenge_releases(
  id SERIAL PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  challenge_key TEXT NOT NULL, root_cause_key TEXT NOT NULL, tractor_model TEXT DEFAULT '', enabled BOOLEAN NOT NULL DEFAULT TRUE,
  pass_score INTEGER NOT NULL DEFAULT 85, max_parts_penalties INTEGER NOT NULL DEFAULT 1, target_minutes INTEGER NOT NULL DEFAULT 45,
  released_at TIMESTAMPTZ DEFAULT now(), UNIQUE(class_id,challenge_key)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS master_challenge_attempts(
  id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, challenge_key TEXT NOT NULL, root_cause_key TEXT NOT NULL,
  tractor_model TEXT DEFAULT '', score INTEGER DEFAULT 0, positive_points INTEGER DEFAULT 0, penalty_points INTEGER DEFAULT 0,
  final_diagnosis TEXT DEFAULT '', final_repair TEXT DEFAULT '', verification_notes TEXT DEFAULT '', diagnosis_correct BOOLEAN DEFAULT FALSE,
  repair_correct BOOLEAN DEFAULT FALSE, verified BOOLEAN DEFAULT FALSE, passed BOOLEAN DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'in_progress',
  pass_score INTEGER DEFAULT 85, max_parts_penalties INTEGER DEFAULT 1, target_minutes INTEGER DEFAULT 45,
  started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS master_challenge_actions(
  id SERIAL PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES master_challenge_attempts(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL, result_text TEXT NOT NULL,
  evidence_text TEXT DEFAULT '', points INTEGER DEFAULT 0, penalty INTEGER DEFAULT 0, sequence INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(attempt_id,action_key)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS master_challenge_hints(
  id SERIAL PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES master_challenge_attempts(id) ON DELETE CASCADE,
  level INTEGER NOT NULL, hint_text TEXT NOT NULL, penalty INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(attempt_id,level)
 )`);
 await pool.query(`INSERT INTO master_challenge_content(challenge_key,content_json,updated_at)
  VALUES($1,$2::jsonb,now()) ON CONFLICT(challenge_key) DO NOTHING`,[DEFAULT_MASTER_CHALLENGE.key,JSON.stringify(DEFAULT_MASTER_CHALLENGE)]);
 const masterRows=await pool.query(`SELECT challenge_key,content_json FROM master_challenge_content`);
 for(const row of masterRows.rows){ if(row.content_json) MASTER_CHALLENGE_CACHE[row.challenge_key]=row.content_json; }

 await pool.query(`UPDATE simulation_assignments SET technician_limit=15 WHERE technician_limit IS NULL`);
 await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS explanation TEXT DEFAULT ''`);
 await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT ''`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS show_live_scores BOOLEAN DEFAULT FALSE`);
 await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_feedback BOOLEAN DEFAULT TRUE`);

 await pool.query(`CREATE TABLE IF NOT EXISTS training_videos(
  id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL, source_url TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0, active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS video_questions(
  id SERIAL PRIMARY KEY, video_id INTEGER REFERENCES training_videos(id) ON DELETE CASCADE,
  timestamp_seconds INTEGER NOT NULL DEFAULT 0, question TEXT NOT NULL, choices JSONB NOT NULL, answer_index INTEGER NOT NULL,
  explanation TEXT DEFAULT '', require_correct BOOLEAN DEFAULT TRUE, parts_cannon_penalty INTEGER DEFAULT 0
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS video_progress(
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, video_id INTEGER REFERENCES training_videos(id) ON DELETE CASCADE,
  last_second NUMERIC(10,2) DEFAULT 0, completed BOOLEAN DEFAULT FALSE, score INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(student_id,video_id)
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS video_question_attempts(
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, question_id INTEGER REFERENCES video_questions(id) ON DELETE CASCADE,
  selected_index INTEGER, correct BOOLEAN DEFAULT FALSE, first_correct BOOLEAN DEFAULT FALSE, attempts INTEGER DEFAULT 0,
  parts_cannon INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(student_id,question_id)
 )`);
 const embeddedClasses=await pool.query('SELECT id,course FROM classes');
 for(const c of embeddedClasses.rows) await ensureEmbeddedVideosForClass(c);

 await pool.query(`CREATE TABLE IF NOT EXISTS course_catalog(
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS site_settings(
  key TEXT PRIMARY KEY, value TEXT NOT NULL
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS security_audit(
  id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, detail TEXT DEFAULT '', status TEXT DEFAULT 'ok',
  ip_hash TEXT DEFAULT '', user_agent TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`ALTER TABLE security_audit ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`);
 await pool.query(`ALTER TABLE security_audit ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit(created_at DESC)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS legacy_import_runs(
  id BIGSERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL, imported_by TEXT DEFAULT 'Platform Owner', summary JSONB DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ DEFAULT now()
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_legacy_import_runs_company ON legacy_import_runs(company_id,imported_at DESC)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS backup_runs(
  id BIGSERIAL PRIMARY KEY, trigger_type TEXT NOT NULL DEFAULT 'automatic', status TEXT NOT NULL DEFAULT 'running',
  drive_file_id TEXT DEFAULT '', drive_file_name TEXT DEFAULT '', table_count INTEGER DEFAULT 0, row_count BIGINT DEFAULT 0,
  file_size BIGINT DEFAULT 0, error_message TEXT DEFAULT '', started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC)`);
 await pool.query(`INSERT INTO site_settings(key,value) VALUES($1,'false') ON CONFLICT(key) DO NOTHING`,[BACKUP_SETTING_AUTO]);
 await pool.query(`INSERT INTO site_settings(key,value) VALUES($1,'daily') ON CONFLICT(key) DO NOTHING`,[BACKUP_SETTING_SCHEDULE]);
 await pool.query(`INSERT INTO site_settings(key,value) VALUES($1,'24') ON CONFLICT(key) DO NOTHING`,[BACKUP_SETTING_INTERVAL]);
 await pool.query(`INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,[BACKUP_SETTING_RETENTION,String(GOOGLE_DRIVE_BACKUP_RETENTION_DAYS)]);
 // A backup cannot survive a service restart; close any orphaned 'running' records from a previous process.
 await pool.query(`UPDATE backup_runs SET status='interrupted',error_message=CASE WHEN btrim(COALESCE(error_message,''))='' THEN 'Backup interrupted by service restart.' ELSE error_message END,completed_at=COALESCE(completed_at,now()) WHERE status='running'`);

 const defaults=['New Hire Orientation','Safety Training','Product Training','Service Training','Technical Fundamentals','Diagnostics','Quality Procedures','Leadership Training'];
 for (const name of defaults) await pool.query('INSERT INTO course_catalog(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[name]);
 const settings={...BRAND_DEFAULTS};
 for (const [key,value] of Object.entries(settings)) await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[key,value]);
}
await init();
await refreshBrandSettings();

async function inferRequestCompanyId(req){
 const sess=sessionFromReq(req); if(sess?.company_id)return Number(sess.company_id);
 try{
  let m=req.path.match(/^\/c\/([^/]+)/); if(m){ const q=await pool.query('SELECT company_id FROM classes WHERE join_token=$1',[m[1]]); if(q.rowCount)return Number(q.rows[0].company_id); }
  m=req.path.match(/^\/student\/(\d+)/); if(m){ const q=await pool.query('SELECT c.company_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1',[m[1]]); if(q.rowCount)return Number(q.rows[0].company_id); }
  m=req.path.match(/^\/hunt-station\/(\d+)/); if(m){ const q=await pool.query('SELECT company_id FROM classes WHERE id=$1',[m[1]]); if(q.rowCount)return Number(q.rows[0].company_id); }
 }catch(e){}
 return null;
}
app.use(async(req,res,next)=>{
 const companyId=await inferRequestCompanyId(req);
 const b=await companyBrand(companyId);
 tenantContext.run({companyId,brand:b},()=>next());
});

const FMCU_PROGRAM_TEST_QUESTIONS = [
 ['What is the primary function of the FMCU?',['Control fuel injection','Monitor and control tractor safety and machine functions','Charge the battery','Operate the alternator'],1],
 ['What does ECU stand for?',['Electronic Communication Unit','Engine Control Utility','Electronic Control Unit','Equipment Control Unit'],2],
 ['Where is the FMCU typically located on the tractor?',['Near the rear axle','Inside the fuel tank','Below the dashboard near the steering column','Under the seat'],2],
 ['Which FMCU input detects whether the operator is seated?',['Brake Switch','PTO Switch','Operator Presence Sensor (OPS)','Neutral Switch'],2],
 ['Which FMCU output controls PTO engagement?',['Starter Relay','PTO Solenoid Valve','Ignition Relay','Headlamp Relay'],1],
 ['What is the purpose of CAN communication in the tractor?',['Operate headlights','Connect battery to starter motor','Exchange information between controllers','Control hydraulic pressure'],2],
 ['Which controller is responsible for engine management functions?',['FMCU','Instrument Cluster','ECU','PTO Controller'],2],
 ['Which of the following is an FMCU input?',['Gear Neutral LED','Starter Relay','Park Brake Switch','PTO Solenoid'],2],
 ['Which FMCU connector pin is assigned to the Clutch Switch?',['CAN1 Pin 10','CAN1 Pin 20','CAN2 Pin 15','CAN3 Pin 14'],1],
 ['Which relay is controlled by FMCU to crank the engine?',['Accessory Relay','Headlamp Relay','Starter Relay','PTO Relay'],2],
 ['Which input switch is connected to CAN3 Pin 16?',['Hazard Switch','Ignition Switch','PTO Switch','Brake Switch'],1],
 ['What should be checked first before suspecting FMCU failure?',['Replace controller','Replace wiring harness','Verify power supply, ground, and connectors','Replace relays'],2],
 ['How many pins does the FMCU used in the Mahindra tractors have?',['30 Pins','40 Pins','50 Pins','60 Pins'],3],
 ['Which FMCU output pin controls the Ignition Relay?',['CAN2 Pin 1','CAN2 Pin 3','CAN2 Pin 10','CAN3 Pin 5'],0],
 ['What action does FMCU take if unsafe operator presence conditions are detected during PTO operation?',['Increase PTO speed','Activate safety logic and warning outputs','Increase engine RPM','Turn on work lamps'],1],
 ['Which sensor provides vehicle speed information to FMCU?',['Coolant Temperature Sensor','Vehicle Speed Sensor (VSS)','Fuel Level Sensor','Air Filter Sensor'],1],
 ['What is the value of the CAN network terminating resistor used in the system?',['60 Ohm','100 Ohm','120 Ohm','240 Ohm'],2],
 ['Which circuit protects the alternator charging system?',['10A Fuse','20A Fuse','40A Fuse','80A Fuse'],3],
 ['Which output warns the operator of abnormal machine conditions?',['Buzzer and Tell-tales','Alternator','Fuel Pump','Starter Motor'],0],
 ['During diagnostics, viewing the connector from the wrong side may result in:',['Increased battery voltage','Wrong pin identification','CAN failure','PTO engagement'],1]

];

const AUTO4WD_PROGRAM_TEST_QUESTIONS = [
 ['What is the primary function of the Auto 4WD system?',['Increase engine RPM','Improve traction and braking performance','Increase PTO speed','Reduce hydraulic pressure'],1],
 ['Which controller directly controls the E4WD solenoid?',['ECU','Instrument Cluster','FMCU','Telematics Unit'],2],
 ['The Auto 4WD solenoid operates on:',['24V DC','5V DC','48V DC','12V DC'],3],
 ['When tractor speed exceeds 15 km/h and both brake pedals are applied, Auto 4WD:',['Disengages','Engages automatically','Shuts down engine','Activates PTO'],1],
 ['Which component physically engages the front axle drive?',['Solenoid coil','Accumulator','Coupler','Neutral switch'],2],
 ['Hydraulic oil for the E4WD system is supplied from:',['Fuel Tank','HSU','Radiator','PTO Valve'],1],
 ['What should a technician check first when diagnosing an electrical fault?',['Replace FMCU','Replace sensor','Connector and wiring condition','Replace solenoid'],2],
 ['Which controller manages engine performance, fuel delivery and protection functions?',['FMCU','Cluster','ECU','Telematics'],2],
 ['Which controller manages PTO, safety logic, relays and operator alerts?',['ECU','FMCU','DRL Module','Cluster'],1],
 ['The Operator Presence Sensor (OPS) is located on:',['Steering wheel','Brake pedal','Seat assembly','Dashboard'],2],
 ['A "Short to Ground" DTC generally indicates:',['Battery disconnected','Circuit touching ground unintentionally','Open switch','High CAN voltage'],1],
 ['A DTC classified as "Open Circuit" indicates:',['Wire disconnected or broken','Excessive current flow','Overheating PTO','Low battery only'],0],
 ['Which FMCU input monitors whether the tractor operator is seated?',['Neutral Switch','PTO Switch','OPS Switch','Brake Switch'],2],
 ['Which FMCU output controls PTO engagement?',['PTO Solenoid Valve','Fuel Metering Unit','Head Lamp Relay','Glow Plug Relay'],0],
 ['Why is CAN communication used on modern tractors?',['To increase fuel pressure','To reduce mechanical wear','To exchange information between controllers','To operate the starter motor directly'],2],
 ['In FMCU connector CAN-1, which input is connected to the Clutch Switch?',['Pin 10','Pin 15','Pin 20','Pin 5'],2],
 ['Which relay is controlled by FMCU during engine cranking?',['Head Lamp Relay','Accessory Relay','Starter Relay','Work Lamp Relay'],2],
 ['What is the first step before performing continuity checks?',['Apply battery voltage','Disconnect sensors only','Turn OFF ignition and wait approximately one minute','Start engine'],2],
 ['When OPS changes from ON to OFF while PTO is engaged, FMCU safety logic may:',['Increase PTO speed','Activate warnings and disengage PTO','Turn ON work lamps','Increase engine RPM'],1],
 ['After repair of a DTC-related fault, what is the correct final action?',['Disconnect battery','Replace FMCU','Clear DTC and perform healing/validation procedure','Replace relay'],2]
];

async function repairMahindraFMCUTestBankV218(companyId,bank){
 const markerKey='fmcu_test_answer_key_repair_v218';
 const done=(await pool.query('SELECT value FROM company_settings WHERE company_id=$1 AND key=$2',[companyId,markerKey])).rows[0];
 if(done?.value==='done')return;
 const expected=new Map(FMCU_PROGRAM_TEST_QUESTIONS.map(q=>[q[0],q[2]]));
 const rows=(await pool.query('SELECT id,question,answer_index FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows;
 for(const r of rows){ if(expected.has(r.question)){ const idx=expected.get(r.question); if(Number(r.answer_index)!==Number(idx))await pool.query('UPDATE program_test_questions SET answer_index=$2 WHERE id=$1',[r.id,idx]); } }
 // Repair snapshots and recalculate completed attempts created while the bad key was present.
 const attempts=(await pool.query('SELECT * FROM program_test_attempts WHERE bank_id=$1 ORDER BY id',[bank.id])).rows;
 for(const a of attempts){
  let snap=Array.isArray(a.question_snapshot)?a.question_snapshot:[]; let changed=false;
  snap=snap.map(q=>{ if(expected.has(q.question)){ const idx=expected.get(q.question); if(Number(q.answer_index)!==Number(idx)){changed=true;return {...q,answer_index:idx};} } return q; });
  let correct=0; const answers=(a.answers&&typeof a.answers==='object')?a.answers:{};
  if(a.status==='completed')for(let i=0;i<snap.length;i++){ const ans=Number(answers[i]); if(Number.isFinite(ans)&&ans===Number(snap[i].answer_index))correct++; }
  const score=snap.length?Math.round(correct*100/snap.length):0;
  if(changed||a.status==='completed')await pool.query('UPDATE program_test_attempts SET question_snapshot=$2::jsonb,correct_count=$3,score=$4 WHERE id=$1',[a.id,JSON.stringify(snap),a.status==='completed'?correct:Number(a.correct_count)||0,a.status==='completed'?score:a.score]);
 }
 await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,'done') ON CONFLICT(company_id,key) DO UPDATE SET value='done'`,[companyId,markerKey]);
}

async function ensureMahindraFMCUTestBank(companyId,programId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 if(!/mahindra/i.test(String(cq.rows[0]?.name||'')))return null;
 const seedKey=`mahindra-fmcu-electrical-${programId}`;
 let bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[seedKey])).rows[0];
 if(!bank){
  bank=(await pool.query(`INSERT INTO program_test_banks(company_id,program_id,title,seed_key) VALUES($1,$2,$3,$4) RETURNING *`,[companyId,programId,'FMCU & Electrical Integration Training Assessment',seedKey])).rows[0];
  let ord=10; for(const q of FMCU_PROGRAM_TEST_QUESTIONS){await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[bank.id,q[0],JSON.stringify(q[1]),q[2],'',ord]);ord+=10;}
 }
 const mods=(await pool.query(`SELECT m.id,m.title FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$1`,[programId])).rows;
 const pre=mods.find(m=>/Module 1\s*-\s*FMCU Electrical & Diagnostics Pre-Test/i.test(m.title));
 const post=mods.find(m=>/Module 5\s*-\s*FMCU Electrical & Diagnostics Post Test/i.test(m.title));
 if(pre)await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,'Pre-Test',80,false) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode=EXCLUDED.test_mode,randomize=false`,[pre.id,bank.id]);
 if(post)await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,'Post-Test',80,true) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode=EXCLUDED.test_mode,randomize=true`,[post.id,bank.id]);
 await repairMahindraFMCUTestBankV218(companyId,bank);
 return bank;
}

async function repairBadV2130FMCUOverwrite(companyId,programId){
 const marker=(await pool.query(`SELECT key FROM company_settings WHERE company_id=$1 AND key LIKE 'fmcu_auto4wd_assessment_v2130_%' LIMIT 1`,[companyId])).rows[0];
 if(!marker)return false;
 const bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[`mahindra-fmcu-electrical-${programId}`])).rows[0];
 if(!bank)return false;
 const rows=(await pool.query('SELECT question FROM program_test_questions WHERE bank_id=$1 ORDER BY display_order,id',[bank.id])).rows;
 const looksOverwritten=rows.some(r=>String(r.question||'')==='What is the primary function of the Auto 4WD system?');
 if(!looksOverwritten)return false;
 await pool.query('DELETE FROM program_test_questions WHERE bank_id=$1',[bank.id]);
 let ord=10;
 for(const q of FMCU_PROGRAM_TEST_QUESTIONS){
  await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[bank.id,q[0],JSON.stringify(q[1]),q[2],'',ord]);
  ord+=10;
 }
 await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,'repair_bad_v2130_fmcu_overwrite_v2131','done') ON CONFLICT(company_id,key) DO UPDATE SET value='done'`,[companyId]);
 return true;
}

async function ensureMahindraAuto4WDTest(companyId,programId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 if(!/mahindra/i.test(String(cq.rows[0]?.name||'')))return null;
 const section=(await pool.query(`SELECT s.* FROM program_sections s WHERE s.program_id=$1 AND s.title='HCE Systems' ORDER BY id LIMIT 1`,[programId])).rows[0];
 if(!section)return null;
 let mod=(await pool.query(`SELECT * FROM program_modules WHERE section_id=$1 AND title=$2 ORDER BY id LIMIT 1`,[section.id,'Module 10A - Auto 4WD Test'])).rows[0];
 if(!mod){
  mod=(await pool.query(`INSERT INTO program_modules(section_id,title,description,activity_type,estimated_minutes,display_order,required,active) VALUES($1,$2,$3,$4,$5,$6,true,true) RETURNING *`,[section.id,'Module 10A - Auto 4WD Test','20-question Auto 4WD and electrical integration technician knowledge assessment.','Knowledge Assessment',20,55])).rows[0];
 }
 const seedKey=`mahindra-auto4wd-assessment-${programId}`;
 let bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[seedKey])).rows[0];
 if(!bank){
  bank=(await pool.query(`INSERT INTO program_test_banks(company_id,program_id,title,seed_key) VALUES($1,$2,$3,$4) RETURNING *`,[companyId,programId,'Auto 4WD — Technician Knowledge Assessment',seedKey])).rows[0];
 }
 const count=Number((await pool.query('SELECT count(*)::int n FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows[0].n||0);
 if(count===0){
  let ord=10;
  for(const q of AUTO4WD_PROGRAM_TEST_QUESTIONS){
   await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[bank.id,q[0],JSON.stringify(q[1]),q[2],'',ord]);
   ord+=10;
  }
 }
 await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,'Knowledge Assessment',80,false) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode=EXCLUDED.test_mode,pass_score=80,randomize=false`,[mod.id,bank.id]);
 return {module:mod,bank};
}

async function ensureMahindraDiagnosticSimulationSegments(companyId,programId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 if(!/mahindra/i.test(String(cq.rows[0]?.name||'')))return null;
 const section=(await pool.query(`SELECT s.* FROM program_sections s WHERE s.program_id=$1 AND s.title='FMCU Electrical & Diagnostics' ORDER BY id LIMIT 1`,[programId])).rows[0];
 if(!section)return null;
 let seg1=(await pool.query(`SELECT * FROM program_modules WHERE section_id=$1 AND (title ILIKE 'Module 4 - Diagnostic Exercise with Failure Simulations%' OR title ILIKE 'Module 4A - Diagnostic Simulations%') ORDER BY id LIMIT 1`,[section.id])).rows[0];
 if(!seg1)return null;
 await pool.query(`UPDATE program_modules SET title=$2,description=$3,activity_type='Failure Simulation',estimated_minutes=105,display_order=40,required=true,active=true WHERE id=$1`,[seg1.id,'Module 4A - Diagnostic Simulations — Segment 1','105-minute diagnostic simulation segment focused on complaint verification, controller inputs, start permissives, PTO logic, and Auto 4WD operating logic.']);
 let seg2=(await pool.query(`SELECT * FROM program_modules WHERE section_id=$1 AND title=$2 ORDER BY id LIMIT 1`,[section.id,'Module 4B - Diagnostic Simulations — Segment 2'])).rows[0];
 if(!seg2){
  seg2=(await pool.query(`INSERT INTO program_modules(section_id,title,description,activity_type,estimated_minutes,display_order,required,active) VALUES($1,$2,$3,'Failure Simulation',105,45,true,true) RETURNING *`,[section.id,'Module 4B - Diagnostic Simulations — Segment 2','105-minute diagnostic simulation segment focused on circuit proof, loaded electrical testing, CAN communication, output circuits, root-cause confirmation, repair, and validation.'])).rows[0];
 } else {
  await pool.query(`UPDATE program_modules SET description=$2,activity_type='Failure Simulation',estimated_minutes=105,display_order=45,required=true,active=true WHERE id=$1`,[seg2.id,'105-minute diagnostic simulation segment focused on circuit proof, loaded electrical testing, CAN communication, output circuits, root-cause confirmation, repair, and validation.']);
 }
 const items=[
  [seg1.id,'Segment 1 Plan — 105 Minutes',`Complete the 10 simulations shown directly in this module in order (SIM-S1-001 through SIM-S1-010). Allow approximately 10 minutes per simulation, then use the final 5 minutes for instructor debrief.

Students launch each simulation directly from Module 4A. Instructors continue to use the Simulation Library for release status, planted root cause, class/equipment assignment, scoring, Parts Cannon penalties, preview, setup sheets, and attempt records.`],
  [seg2.id,'Segment 2 Plan — 105 Minutes',`Complete the 10 simulations shown directly in this module in order (SIM-S2-001 through SIM-S2-010). Allow approximately 10 minutes per simulation, then use the final 5 minutes for instructor debrief.

Students launch each simulation directly from Module 4B. Instructors continue to use the Simulation Library for release status, planted root cause, class/equipment assignment, scoring, Parts Cannon penalties, preview, setup sheets, and attempt records.`]
 ];
 for(const [moduleId,title,body] of items){
  const found=(await pool.query('SELECT id FROM program_module_content WHERE module_id=$1 AND title=$2 ORDER BY id LIMIT 1',[moduleId,title])).rows[0];
  if(found)await pool.query(`UPDATE program_module_content SET content_type='Failure Simulation',body=$2,display_order=10,active=true WHERE id=$1`,[found.id,body]);
  else await pool.query(`INSERT INTO program_module_content(module_id,content_type,title,body,resource_url,display_order,active) VALUES($1,'Failure Simulation',$2,$3,'',10,true)`,[moduleId,title,body]);
 }
 // Keep the existing Tuesday schedule, but map each 105-minute block to its own segment.
 const sched=(await pool.query(`SELECT * FROM program_schedule_items WHERE program_id=$1 AND day_name='Tuesday' AND duration_minutes=105 AND title ILIKE '%Diagnostic Exercise with Failure Simulations%' ORDER BY display_order,id`,[programId])).rows;
 if(sched[0])await pool.query(`UPDATE program_schedule_items SET module_id=$2,title='Module 4A - Diagnostic Simulations — Segment 1 (105 Minutes)' WHERE id=$1`,[sched[0].id,seg1.id]);
 if(sched[1])await pool.query(`UPDATE program_schedule_items SET module_id=$2,title='Module 4B - Diagnostic Simulations — Segment 2 (105 Minutes)' WHERE id=$1`,[sched[1].id,seg2.id]);
 return {segment1:seg1,segment2:seg2};
}

async function normalizeLegacy31004100(companyId){
 if(!companyId)return;
 const combo=(await pool.query(`SELECT id FROM company_equipment_models WHERE company_id=$1 AND btrim(name)='3100 / 4100' ORDER BY id LIMIT 1`,[companyId])).rows[0];
 const e3100=(await pool.query(`SELECT id FROM company_equipment_models WHERE company_id=$1 AND btrim(name)='3100' ORDER BY id LIMIT 1`,[companyId])).rows[0];
 if(combo && !e3100) await pool.query(`UPDATE company_equipment_models SET name='3100',display_order=10,active=true WHERE id=$1`,[combo.id]);
 else if(combo && e3100) await pool.query(`UPDATE company_equipment_models SET active=false WHERE id=$1`,[combo.id]);
 if(combo || e3100){
  await pool.query(`INSERT INTO company_equipment_models(company_id,name,display_order,active) VALUES($1,'4100',20,true) ON CONFLICT(company_id,name) DO UPDATE SET active=true,display_order=20`,[companyId]);
 }
 // Normalize every saved use of the legacy combined label, including open scavenger hunts.
 await pool.query(`UPDATE hunt_tractors SET model='3100' WHERE class_id IN (SELECT id FROM classes WHERE company_id=$1) AND btrim(model)='3100 / 4100'`,[companyId]);
 await pool.query(`UPDATE hunt_stations SET tractor_model='3100',station_name=replace(station_name,'3100 / 4100 — ','3100 — ') WHERE class_id IN (SELECT id FROM classes WHERE company_id=$1) AND btrim(COALESCE(tractor_model,''))='3100 / 4100'`,[companyId]);
 await pool.query(`UPDATE simulation_assignments SET tractor_model='3100' WHERE class_id IN (SELECT id FROM classes WHERE company_id=$1) AND btrim(COALESCE(tractor_model,''))='3100 / 4100'`,[companyId]);
 await pool.query(`UPDATE simulation_attempts SET tractor_model='3100' WHERE class_id IN (SELECT id FROM classes WHERE company_id=$1) AND btrim(COALESCE(tractor_model,''))='3100 / 4100'`,[companyId]);
}

async function seedCompanyDefaults(companyId){
 const defaults=['New Hire Orientation','Safety Training','Product Training','Service Training','Technical Fundamentals','Diagnostics','Quality Procedures','Leadership Training'];
 for(const name of defaults)await pool.query('INSERT INTO company_courses(company_id,name) VALUES($1,$2) ON CONFLICT(company_id,name) DO NOTHING',[companyId,name]);
 for(const [key,value] of Object.entries(BRAND_DEFAULTS))await pool.query('INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO NOTHING',[companyId,key,value]);
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 const companyName=String(cq.rows[0]?.name||'');
 await normalizeLegacy31004100(companyId);
 if(/mahindra/i.test(companyName)){
  const certDefaults={certificate_organization_name:'Mahindra Ag North America',certificate_manager_name:'Nazar Mohamed',certificate_manager_title:'National Aftersales Manager'};
  for(const [key,value] of Object.entries(certDefaults)) await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=CASE WHEN btrim(company_settings.value)='' THEN excluded.value ELSE company_settings.value END`,[companyId,key,value]);
 }
 const equipment=/mahindra/i.test(companyName)?['3100','4100','4600','5100','6000','Roxor','Custom Equipment']:['Equipment 1','Equipment 2','Equipment 3','Machine A','Machine B','Workstation 1','Workstation 2','Custom Equipment'];
 let order=10; for(const name of equipment){await pool.query('INSERT INTO company_equipment_models(company_id,name,display_order,active) VALUES($1,$2,$3,true) ON CONFLICT(company_id,name) DO NOTHING',[companyId,name,order]);order+=10;}
 await seedMahindraHCE3100Program(companyId);
 await seedMahindra14ModuleProgram(companyId);
}

async function seedMahindra14ModuleProgram(companyId){
 // If an instructor intentionally deleted the seeded 14-module program, do not recreate it.
 const seedDisabled=(await pool.query(`SELECT value FROM company_settings WHERE company_id=$1 AND key='seed_mahindra14_program_disabled' LIMIT 1`,[companyId])).rows[0];
 if(String(seedDisabled?.value||'').toLowerCase()==='true')return null;
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 const companyName=String(cq.rows[0]?.name||'');
 const hasMahindraProgram=(await pool.query(`SELECT 1 FROM training_programs WHERE company_id=$1 AND title ILIKE '%HCE%3100%Service Training%' LIMIT 1`,[companyId])).rowCount>0;
 if(!/mahindra/i.test(companyName) && !hasMahindraProgram)return null;
 const programTitle='Mahindra Service Training — 14 Module Program';
 let p=(await pool.query('SELECT * FROM training_programs WHERE company_id=$1 AND title=$2 ORDER BY id LIMIT 1',[companyId,programTitle])).rows[0];
 if(!p){
  const token=crypto.randomBytes(18).toString('hex'); let code=programJoinCode();
  while((await pool.query('SELECT 1 FROM training_programs WHERE company_id=$1 AND join_code=$2',[companyId,code])).rowCount)code=programJoinCode();
  p=(await pool.query(`INSERT INTO training_programs(company_id,title,description,join_code,join_token,display_order,all_equipment) VALUES($1,$2,$3,$4,$5,20,true) RETURNING *`,[companyId,programTitle,'Fourteen-module Mahindra service training program organized from Safety, Tools & Fundamentals through Maintenance. Each module is ready for lesson/video content, tests, simulations, or hands-on activities to be added in the Training Hub.',code,token])).rows[0];
 }
 const scount=Number((await pool.query('SELECT count(*)::int n FROM program_sections WHERE program_id=$1',[p.id])).rows[0].n||0);
 if(scount===0){
  const section=(await pool.query('INSERT INTO program_sections(program_id,title,description,display_order) VALUES($1,$2,$3,10) RETURNING id',[p.id,'Mahindra Technical Systems','Fourteen core technical training modules based on the supplied table of contents.'])).rows[0].id;
  const defs=[
   ['M1 - Safety, Tools & Fundamentals','Safety, Tools & Fundamentals',10],
   ['M2 - Engine Fundamentals','Engine Fundamentals',20],
   ['M3 - Intake, Exhaust & Emissions','Intake, Exhaust & Emissions',30],
   ['M4 - Electrical Systems','Electrical Systems',40],
   ['M5 - Starting & Charging','Starting & Charging',50],
   ['M6 - Electrical Diagnostics','Electrical Diagnostics',60],
   ['M7 - HVAC Systems','HVAC Systems',70],
   ['M8 - Fuel Systems & Engine Management','Fuel Systems & Engine Management',80],
   ['M9 - Cooling & Lubrication','Cooling & Lubrication',90],
   ['M10 - Hydraulics & Auxiliary Systems','Hydraulics & Auxiliary Systems',100],
   ['M11 - Drivetrain & Axles','Drivetrain & Axles',110],
   ['M12 - Brakes & Steering','Brakes & Steering',120],
   ['M13 - Body, Cab & Safety Systems','Body, Cab & Safety Systems',130],
   ['M14 - Maintenance','Maintenance',140]
  ];
  for(const [title,desc,ord] of defs){
   await pool.query(`INSERT INTO program_modules(section_id,title,description,activity_type,estimated_minutes,display_order,required,active) VALUES($1,$2,$3,'Presentation / Lesson',0,$4,true,true)`,[section,title,desc,ord]);
  }
 }
 return p;
}

async function seedMahindraHCE3100Program(companyId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 const companyName=String(cq.rows[0]?.name||'');
 if(!/mahindra/i.test(companyName))return null;
 const programTitle='HCE & 3100 Service Training — 3.5 Day Program';
 let p=(await pool.query('SELECT * FROM training_programs WHERE company_id=$1 AND title=$2 ORDER BY id LIMIT 1',[companyId,programTitle])).rows[0];
 if(!p){
  const token=crypto.randomBytes(18).toString('hex'); let code=programJoinCode();
  while((await pool.query('SELECT 1 FROM training_programs WHERE company_id=$1 AND join_code=$2',[companyId,code])).rowCount)code=programJoinCode();
  p=(await pool.query(`INSERT INTO training_programs(company_id,title,description,join_code,join_token,display_order) VALUES($1,$2,$3,$4,$5,10) RETURNING *`,[companyId,programTitle,'3.5 day HCE and 3100 training program restored from the supplied training schedule. Includes FMCU Electrical & Diagnostics, HCE Systems, 3100 Service Training, hands-on work, tests, scavenger hunts, simulations, ride & drive, and the full Monday-Friday schedule.',code,token])).rows[0];
 }
 const scount=Number((await pool.query('SELECT count(*)::int n FROM program_sections WHERE program_id=$1',[p.id])).rows[0].n||0);
 if(scount===0){
  const sections={};
  for(const [key,title,desc,ord] of [
   ['fmcu','FMCU Electrical & Diagnostics','Pre-test, electrical deep dive, diagnostic tools/programs, failure simulations, and post-test.',10],
   ['hce','HCE Systems','HCE pre-test, scavenger hunt, model comparison, engine, Auto 4WD, PST diagnostics, and post-test.',20],
   ['3100','3100 Service Training','3100 pre-test, scavenger hunt, specifications/features, teardown/reassembly, review/Q&A, post-test, and ride & drive.',30]
  ]) sections[key]=(await pool.query('INSERT INTO program_sections(program_id,title,description,display_order) VALUES($1,$2,$3,$4) RETURNING id',[p.id,title,desc,ord])).rows[0].id;

  const defs=[
   ['m1','fmcu','Module 1 - FMCU Electrical & Diagnostics Pre-Test','Pre-Test',30,10,'Introduction and pre-test.'],
   ['m2','fmcu','Module 2 - FMCU Electrical Deep Dive','Presentation / Lesson',90,20,'Electrical deep dive.'],
   ['m3','fmcu','Module 3 - FMCU Diagnostic Tools & Programs','Instructor-Led Activity',90,30,'Diagnostic tools and programs.'],
   ['m4','fmcu','Module 4 - Diagnostic Exercise with Failure Simulations','Failure Simulation',210,40,'Diagnostic exercise with failure simulations. Scheduled in two 105-minute sessions.'],
   ['m5','fmcu','Module 5 - FMCU Electrical & Diagnostics Post Test','Post-Test',30,50,'Post-test for FMCU Electrical & Diagnostics.'],
   ['m6','hce','Module 6 - HCE Pre Test','Pre-Test',30,10,'HCE pre-test.'],
   ['m7','hce','Module 7 - HCE Scavenger Hunt','Scavenger Hunt',45,20,'HCE scavenger hunt.'],
   ['m8','hce','Module 8 - 4500, 4600, 5100 Comparison','Presentation / Lesson',45,30,'4500, 4600, 5100 comparison.'],
   ['m9','hce','Module 9 - HCE Engine','Presentation / Lesson',30,40,'HCE engine.'],
   ['m10','hce','Module 10 - Auto 4WD System','Presentation / Lesson',30,50,'Auto 4WD system.'],
   ['m11','hce','Module 11 - PST Functionality, Testing, and Diagnostics','Instructor-Led Activity',45,60,'PST functionality, testing, and diagnostics.'],
   ['m12','hce','Module 12 - HCE Post Test','Post-Test',15,70,'HCE post-test.'],
   ['m13','3100','Module 13 - 3100 Pre Test','Pre-Test',30,10,'3100 pre-test.'],
   ['m14','3100','Module 14 - 3100 Scavenger Hunt','Scavenger Hunt',30,20,'3100 scavenger hunt.'],
   ['m15','3100','Module 15 - 3100 Specificaitons and Features','Presentation / Lesson',90,30,'3100 Specificaitons and Features. Scheduled as two 45-minute sessions in the supplied schedule.'],
   ['m16','3100','Module 16 - 3100 Teardown and Reassembly','Hands-On Lab',640,40,'3100 teardown and reassembly across Thursday and Friday. Session durations are preserved exactly as listed in the supplied schedule.'],
   ['m17','3100','Module 17 - Review and 3100 Q&A','Instructor-Led Activity',45,50,'Review and 3100 Q&A.'],
   ['m18','3100','Module 18 - 3100 Post Test','Post-Test',45,60,'3100 post-test.'],
   ['ride','3100','3100 & HCE Ride and Drive','Ride & Drive',90,70,'3100 & HCE Ride and Drive.']
  ];
  const mods={};
  for(const [key,sec,title,type,mins,ord,desc] of defs){mods[key]=(await pool.query(`INSERT INTO program_modules(section_id,title,description,activity_type,estimated_minutes,display_order,required,active) VALUES($1,$2,$3,$4,$5,$6,true,true) RETURNING id`,[sections[sec],title,desc,type,mins,ord])).rows[0].id;}

  const sched=[
   ['Monday','8:00 AM',0,'Travel & Set-up','Logistics',null,10],
   ['Tuesday','8:00 AM',30,'Introduction and Module 1 -  FMCU Electrical & Diagnostics Pre-Test (30 Minutes)','Training','m1',100],
   ['Tuesday','8:30 AM',90,'Module 2 - FMCU Electcial Deep Dive (90 Minutes)','Training','m2',110],
   ['Tuesday','10:00 AM',15,'Break (15 Minutes)','Break',null,120],
   ['Tuesday','10:15 AM',90,'Module 3 - FMCU Diagnostic Tools & Programs (90 Minutes)','Training','m3',130],
   ['Tuesday','11:45 AM',45,'Lunch (45 Minutes)','Lunch',null,140],
   ['Tuesday','12:30 PM',105,'Module 4 - Diagnostic Exercise with Failure Simulations (105 Minutes)','Training','m4',150],
   ['Tuesday','2:15 PM',15,'Break (15 Minutes)','Break',null,160],
   ['Tuesday','2:30 PM',105,'Module 4 - Diagnostic Exercise with Failure Simulations (105 Minutes)','Training','m4',170],
   ['Tuesday','4:15 PM',30,'Module 5 - FMCU Electrical & Diagnostics Post Test (30 Minutes)','Training','m5',180],
   ['Tuesday','5:00 PM',0,'Dismiss','Dismiss',null,190],
   ['Wednesday','8:00 AM',30,'Introduction and Module 6 - HCE Pre Test (30 Minutes)','Training','m6',200],
   ['Wednesday','8:30 AM',45,'Module 7 - HCE Scavenger Hunt (45 Minutes)','Training','m7',210],
   ['Wednesday','9:15 AM',45,'Module 8 - 4500, 4600, 5100 Comparison (45 Minutes)','Training','m8',220],
   ['Wednesday','10:00 AM',30,'Module 9 - HCE Engine (30 Minutes)','Training','m9',230],
   ['Wednesday','10:30 AM',15,'Break (15 Minutes)','Break',null,240],
   ['Wednesday','10:45 AM',30,'Module 10 - Auto 4WD System (30 Minutes)','Training','m10',250],
   ['Wednesday','11:15 AM',45,'Module 11 - PST Functionality, Testing, and Diagnostics (45 Minutes)','Training','m11',260],
   ['Wednesday','11:45 AM',15,'Module 12 - HCE Post Test (15 Minutes)','Training','m12',270],
   ['Wednesday','12:00 PM',45,'Lunch (45 Minutes)','Lunch',null,280],
   ['Wednesday','12:45 PM',30,'Module 13 - 3100 Pre Test (30 Minutes)','Training','m13',290],
   ['Wednesday','1:15 PM',30,'Module 14 - 3100 Scavenger Hunt (30 Minutes)','Training','m14',300],
   ['Wednesday','1:45 PM',45,'Module 15 - 3100 Specificaitons and Features (45 Minutes)','Training','m15',310],
   ['Wednesday','2:30 PM',15,'Break (15 Minutes)','Break',null,320],
   ['Wednesday','2:45 PM',45,'Module 15 - 3100 Specificaitons and Features Continued (45 Minutes)','Training','m15',330],
   ['Wednesday','3:30 PM',90,'3100 & HCE Ride and Drive (90 Minutes)','Training','ride',340],
   ['Wednesday','5:00 PM',0,'Dismiss','Dismiss',null,350],
   ['Thursday','8:00 AM',135,'Module 16 - 3100 Teardown and Reassembly (135 Minutes)','Training','m16',400],
   ['Thursday','10:15 AM',15,'Break (15 Minutes)','Break',null,410],
   ['Thursday','10:30 AM',135,'Module 16 - 3100 Teardown and Reassembly Continued (135 Minutes)','Training','m16',420],
   ['Thursday','12:00 PM',45,'Lunch (45 Minutes)','Lunch',null,430],
   ['Thursday','12:45 PM',115,'Module 16 - 3100 Teardown and Reassembly Continued (115 Minutes)','Training','m16',440],
   ['Thursday','2:30 PM',15,'Break (15 Minutes)','Break',null,450],
   ['Thursday','2:45 PM',135,'Module 16 - 3100 Teardown and Reassembly Continued (135 Minutes)','Training','m16',460],
   ['Thursday','5:00 PM',0,'Dismiss','Dismiss',null,470],
   ['Friday','8:00 AM',120,'Module 16 - 3100 Teardown and Reassembly Continued (120 Minutes)','Training','m16',500],
   ['Friday','10:00 AM',15,'Break (15 Minutes)','Break',null,510],
   ['Friday','10:15 AM',45,'Module 17 - Review and 3100 Q&A (45 Minutes)','Training','m17',520],
   ['Friday','11:00 AM',45,'Module 18 - 3100 Post Test (45 Minutes)','Training','m18',530],
   ['Friday','12:00 PM',0,'Dismiss','Dismiss',null,540],
   ['Friday','12:15 PM',0,'Tear Down & Pack Out','Logistics',null,550]
  ];
  for(const [day,time,mins,title,type,mkey,ord] of sched) await pool.query(`INSERT INTO program_schedule_items(program_id,module_id,day_name,start_time,duration_minutes,title,item_type,display_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)`,[p.id,mkey?mods[mkey]:null,day,time,mins,title,type,ord]);
 }
 // 2.1.52 equipment persistence correction.
 // Equipment selection is explicit and must never be overwritten after the instructor saves it.
 // Seed the normal HCE/3100 models only when this program has no saved equipment rows at all.
 const savedEquipmentCount=Number((await pool.query('SELECT count(*)::int n FROM training_program_equipment WHERE program_id=$1',[p.id])).rows[0].n||0);
 if(savedEquipmentCount===0){
  const eqRows=(await pool.query(`SELECT id,name FROM company_equipment_models WHERE company_id=$1 AND active=true AND name=ANY($2::text[]) ORDER BY display_order,name`,[companyId,['3100','4600','5100','6000']])).rows;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('UPDATE training_programs SET all_equipment=false WHERE id=$1 AND company_id=$2',[p.id,companyId]);
   for(const eq of eqRows)await client.query('INSERT INTO training_program_equipment(program_id,equipment_model_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,eq.id]);
   await client.query('COMMIT');
   p.all_equipment=false;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 } else if(p.all_equipment!==false){
  // Older builds could leave the legacy flag on even though a specific saved list exists.
  await pool.query('UPDATE training_programs SET all_equipment=false WHERE id=$1 AND company_id=$2',[p.id,companyId]);
  p.all_equipment=false;
 }
 await ensureMahindraFMCUTestBank(companyId,p.id);
 await ensureMahindra3100PrePostTest(companyId,p.id);
 await repairBadV2130FMCUOverwrite(companyId,p.id);
 await ensureMahindraAuto4WDTest(companyId,p.id);
 await ensureMahindraDiagnosticSimulationSegments(companyId,p.id);
 return p;
}

// 2.1.78: preserve 2.1.77 startup repair/seed, while respecting intentional deletion of the seeded 14-module Mahindra program.
(async()=>{
 try{
  const companies=(await pool.query('SELECT id FROM companies WHERE active=true')).rows;
  for(const c of companies){ await normalizeLegacy31004100(c.id); await seedMahindraHCE3100Program(c.id); await seedMahindra14ModuleProgram(c.id); }
 }catch(e){console.error('2.1.33 startup test migration:',e.message);}
})();

async function companyEquipmentModels(companyId,includeInactive=false){
 await normalizeLegacy31004100(companyId);
 let q=await pool.query(`SELECT * FROM company_equipment_models WHERE company_id=$1 ${includeInactive?'':'AND active=true'} ORDER BY display_order,name`,[companyId]);
 if(!q.rowCount && companyId){
  await seedCompanyDefaults(companyId);
  q=await pool.query(`SELECT * FROM company_equipment_models WHERE company_id=$1 ${includeInactive?'':'AND active=true'} ORDER BY display_order,name`,[companyId]);
 }
 return q.rows;
}
async function programEquipmentSelection(programId,companyId){
 const p=(await pool.query('SELECT id FROM training_programs WHERE id=$1 AND company_id=$2',[programId,companyId])).rows[0];
 if(!p)return {all:false,models:[]};
 const models=(await pool.query(`SELECT cem.* FROM training_program_equipment tpe JOIN company_equipment_models cem ON cem.id=tpe.equipment_model_id WHERE tpe.program_id=$1 AND cem.company_id=$2 AND cem.active=true ORDER BY cem.display_order,cem.name`,[programId,companyId])).rows;
 // 2.1.52: explicit program equipment only. Never expand a saved program back to every company model.
 return {all:false,models};
}
function slugifyCompany(v='company'){ return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||('company-'+Date.now().toString(36)); }
async function uniqueCompanySlug(name){ let base=slugifyCompany(name),slug=base,i=2; while((await pool.query('SELECT 1 FROM companies WHERE slug=$1',[slug])).rowCount)slug=`${base}-${i++}`; return slug; }
function accountHome(sess){ return sess?.role==='owner'&&!sess?.company_id?'/owner':'/instructor/dashboard'; }

app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/', (req,res)=>res.redirect('/instructor'));

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
 res.send(layout('Join '+c.course, `<div class="card"><span class="pill">Class ${esc(c.code)}</span><div class="big" style="margin-top:10px">${esc(c.course)}</div><p>Instructor: ${esc(c.instructor)}</p><form method="post" action="/c/${esc(c.join_token)}/join"><label>Your Name<input name="name" required autocomplete="name"></label><label>${esc(brand('organization_unit_label','Company / Location'))}<input name="dealer" required></label><button>Join Class</button></form></div>`));
});
app.post('/c/:token/join', async(req,res)=>{
 const cq=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]); if(!cq.rowCount) return res.status(404).send('Class closed');
 const c=cq.rows[0], name=(req.body.name||'').trim(), dealer=(req.body.dealer||'').trim(); if(!name||!dealer) return res.status(400).send('Name and dealer required');
 let s=await pool.query('SELECT * FROM students WHERE class_id=$1 AND lower(name)=lower($2) AND lower(dealer)=lower($3)',[c.id,name,dealer]);
 if(!s.rowCount) s=await pool.query('INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *',[c.id,name,dealer]);
 const student=s.rows[0];
 const skills=['Verify customer complaint','Battery / power supply check','CAN network resistance check','Use approved diagnostic software or approved diagnostic tool','Verify inputs and outputs','Document proof of failure'];
 for(const sk of skills) await pool.query('INSERT INTO skills(student_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[student.id,sk]);
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,updated_at) VALUES($1,'Joined','Joined',0,0,now()) ON CONFLICT(student_id) DO UPDATE SET updated_at=now()`,[student.id]);
 res.setHeader('Set-Cookie',`mth_student_${c.id}=${student.id}:${c.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
 res.redirect(`/student/${student.id}?token=${encodeURIComponent(c.join_token)}`);
});

async function studentContext(id,token){
 const q=await pool.query(`SELECT s.*,c.course,c.code,c.instructor,c.join_token,c.pass_score,c.hours,c.hunt_tractor_count,c.company_id,c.created_by_user_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.join_token=$2`,[id,token]); return q.rows[0];
}
app.get('/student/:id', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const r=await pool.query('SELECT activity,score FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]);
 const done=new Set(r.rows.map(x=>x.activity));
 const videos=await pool.query(`SELECT v.*,COALESCE(p.completed,false) completed,p.score FROM training_videos v LEFT JOIN video_progress p ON p.video_id=v.id AND p.student_id=$2 WHERE v.class_id=$1 AND v.active=true ORDER BY v.display_order,v.id`,[s.class_id,s.id]);
 const videoCards=videos.rows.map(v=>`<div class="card"><div class="eyebrow">Interactive Video Training</div><div class="big">${esc(v.title)}</div><p>Watch the training video and answer the questions that appear during playback.</p>${v.completed?`<div class="success">Completed${v.score!==null?' — '+v.score+'%':''}</div>`:`<a class="btn" href="/student/${s.id}/video/${v.id}?token=${encodeURIComponent(s.join_token)}">${v.score!==null?'Resume Video':'Start Video'}</a>`}</div>`).join('');
 const allVideosDone=!videos.rowCount || videos.rows.every(v=>v.completed);
 const quizResults=r.rows.filter(x=>x.activity==='Module Quiz');
 const quizScore=quizResults.length?quizResults[quizResults.length-1].score:null;
 const completedQuizAttempts=Number((await pool.query("SELECT count(*)::int n FROM quiz_attempts WHERE student_id=$1 AND status='completed'",[s.id])).rows[0]?.n||0);
 const passedQuiz=quizScore!==null && quizScore>=s.pass_score;
 if(passedQuiz) await ensureCertificate(s.id);
 const feedback=(await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount>0;
 const simAssignments=(await pool.query(`SELECT simulation_key,root_cause_key FROM simulation_assignments WHERE class_id=$1 AND enabled=true`,[s.class_id])).rows;
 const releasedSimCount=simAssignments.filter(x=>!!simByKey(x.simulation_key)).length;
 const masterReleases=(await pool.query(`SELECT challenge_key FROM master_challenge_releases WHERE class_id=$1 AND enabled=true`,[s.class_id])).rows;
 const releasedMasterCount=masterReleases.filter(x=>!!masterChallengeByKey(x.challenge_key)).length;
 const allCore=['Module Quiz','Scavenger Hunt','Failure Simulation'].every(x=>done.has(x)) && allVideosDone;
 const certificateCard=quizScore===null?`<div class="card"><div class="big">Certificate</div><p class="muted">Your certificate will appear here after you complete and pass the test.</p></div>`:passedQuiz?`<div class="card" style="border:3px solid var(--red);background:#fffafa"><div class="eyebrow">Course Completed</div><div class="big">Your Certificate Is Ready</div><p>You scored <b>${quizScore}%</b>. Open, print, or save your certificate now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="big">Certificate</div><div class="alert">Your test score is ${quizScore}%. A score of ${s.pass_score}% is required before the certificate is available.</div></div>`;
 res.send(layout('Student Home', `<div style="background:linear-gradient(135deg,#171717,#3a080b);color:white;border-radius:18px;padding:24px;margin-bottom:18px;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#f0b8bb">Student Training Portal · 2.0</div><div class="big" style="font-size:30px">Welcome, ${esc(s.name)}</div><p style="margin-bottom:0">${esc(s.course)} · ${esc(s.dealer)} · Class ${esc(s.code)}</p></div>${certificateCard}${videoCards?`<div class="grid">${videoCards}</div>`:''}<div class="grid"><div class="card"><div class="big">Pre-Test / Post-Test</div><p>Your Pre-Test and Post-Test use the <b>same questions</b>. The Post-Test automatically presents them in a different order for a fair improvement comparison.</p>${done.has('Module Quiz')?`<div class="success">Latest Score · ${quizScore}%</div><div class="toolbar" style="margin-top:10px"><a class="btn light" href="/student/${s.id}/quiz-review?token=${encodeURIComponent(s.join_token)}">Review Latest Answers</a><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">${completedQuizAttempts===1?'Take Post-Test':'Retake Post-Test'}</a></div>`:`<a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Pre-Test</a>`}</div><div class="card"><div class="big">QR Scavenger Hunt</div><p>Scan the QR code posted at each training station.</p>${done.has('Scavenger Hunt')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">View Hunt Progress</a>`}</div><div class="card"><div class="big">Diagnostic Simulation Library</div><p>Choose from the diagnostic failures your instructor has released for this class.</p>${releasedSimCount===0?`<div class="alert"><b>Waiting for Instructor</b><br>No diagnostic simulation has been released yet.</div>`:`<div class="success"><b>${releasedSimCount}</b> simulation${releasedSimCount===1?'':'s'} available</div><a class="btn" style="margin-top:10px" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Open Simulation Library</a>`}</div><div class="card" style="border-top:5px solid #171717"><div class="big">Master Diagnostic Challenge</div><p>Final practical diagnostic challenge. There is no guided path—you decide what to test and in what order.</p>${releasedMasterCount===0?`<div class="muted">Waiting for instructor release.</div>`:`<div class="success"><b>${releasedMasterCount}</b> Master Challenge available</div><a class="btn alt" style="margin-top:10px" href="/student/${s.id}/master-challenge?token=${encodeURIComponent(s.join_token)}">Open Master Challenge</a>`}</div><div class="card"><div class="big">Training Feedback</div><p>Tell us what helped and what should be improved.</p>${feedback?'<div class="success">Feedback Submitted — Thank You</div>':allCore?`<a class="btn" href="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">Give Training Feedback</a>`:'<div class="muted">Available after the training activities are finished.</div>'}</div></div>`));
});

app.get('/student/:id/quiz', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const completed=(await pool.query(`SELECT id,completed_at FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at ASC,id ASC`,[s.id])).rows;
 let testRows=[]; let attemptLabel='Pre-Test';
 if(!completed.length){
  let q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  if(!q.rowCount){
   for(const x of DEFAULT_QUIZ) await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[s.class_id,x[0],JSON.stringify(x[1]),x[2],'Review the correct diagnostic principle for this question.','General Diagnostics']);
   q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  }
  testRows=q.rows.map(x=>({source_question_id:x.id,question_text:x.question,choices:Array.isArray(x.choices)?x.choices:[],correct_index:x.answer_index,explanation:x.explanation||'Review this topic with your instructor.',topic:x.topic||''}));
 }else{
  attemptLabel=completed.length===1?'Post-Test':'Post-Test Retake';
  const preRows=(await pool.query(`SELECT source_question_id,question_text,choices,correct_index,explanation,topic FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[completed[0].id])).rows;
  testRows=preRows.map(x=>({source_question_id:x.source_question_id,question_text:x.question_text,choices:Array.isArray(x.choices)?x.choices:[],correct_index:x.correct_index,explanation:x.explanation||'Review this topic with your instructor.',topic:x.topic||''}));
  for(let i=testRows.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [testRows[i],testRows[j]]=[testRows[j],testRows[i]]; }
  if(testRows.length>1 && testRows.every((x,i)=>Number(x.source_question_id)===Number(preRows[i]?.source_question_id))){ testRows.push(testRows.shift()); }
 }
 if(!testRows.length) return res.send(layout('Pre/Post Test',`<div class="card"><div class="big">No Pre/Post Questions Available</div><p>Ask your instructor to add questions to this class.</p><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
 const attempt=(await pool.query(`INSERT INTO quiz_attempts(student_id,class_id,total_questions,status,started_at) VALUES($1,$2,$3,'in_progress',now()) RETURNING *`,[s.id,s.class_id,testRows.length])).rows[0];
 for(let i=0;i<testRows.length;i++){
  const x=testRows[i], choices=Array.isArray(x.choices)?x.choices:[];
  await pool.query(`INSERT INTO quiz_attempt_answers(attempt_id,source_question_id,display_order,question_text,choices,correct_index,correct_answer,explanation,topic) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[attempt.id,x.source_question_id,i+1,x.question_text,JSON.stringify(choices),x.correct_index,choices[x.correct_index]||'',x.explanation||'Review this topic with your instructor.',x.topic||'']);
 }
 await pool.query('DELETE FROM quiz_progress WHERE student_id=$1',[s.id]);
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',0,$2,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=0,total=$2,current_score=NULL,updated_at=now()`,[s.id,testRows.length]);
 const ids=testRows.map(x=>x.source_question_id).filter(x=>x!==null&&x!==undefined).join(',');
 const qs=testRows.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.question_text)}</b>${(x.choices||[]).map((c,j)=>`<label><input type="radio" name="q_${x.source_question_id}" value="${j}" required data-qid="${x.source_question_id}">${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div>`).join('');
 res.send(layout(attemptLabel, `<div class="card"><div class="eyebrow">MATCHED PRE/POST TEST · 2.1.69</div><div class="big">${esc(s.course)} — ${attemptLabel}</div><p class="muted">${completed.length?'This test uses the exact same questions from your Pre-Test in a different order.':'This question set will be locked and reused for your Post-Test in a different order.'}</p><form id="quizForm" method="post" action="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="ids" value="${ids}"><input type="hidden" name="attempt_id" value="${attempt.id}">${qs}<button>Submit ${attemptLabel}</button></form></div>`, `<script>const answered=new Set();document.querySelectorAll('input[type=radio][data-qid]').forEach(el=>el.addEventListener('change',async()=>{answered.add(el.dataset.qid);try{await fetch('/student/${s.id}/quiz-progress?token=${encodeURIComponent(s.join_token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt_id:${attempt.id},qid:Number(el.dataset.qid),answer:Number(el.value),progress:answered.size,total:${testRows.length}})});}catch(e){}}));</script>`));
});

app.post('/student/:id/quiz-progress', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).json({ok:false});
 const attemptId=Number(req.body.attempt_id), qid=Number(req.body.qid), answer=Number(req.body.answer);
 const a=(await pool.query(`SELECT qa.id,qa.choices,qa.correct_index FROM quiz_attempt_answers qa JOIN quiz_attempts a ON a.id=qa.attempt_id WHERE qa.attempt_id=$1 AND qa.source_question_id=$2 AND a.student_id=$3 AND a.status='in_progress'`,[attemptId,qid,s.id])).rows[0];
 if(!a) return res.status(404).json({ok:false});
 const choices=Array.isArray(a.choices)?a.choices:[]; const isCorrect=answer===a.correct_index;
 await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[answer,choices[answer]||'No answer',isCorrect,a.id]);
 const sourceStillExists=(await pool.query('SELECT 1 FROM quiz_questions WHERE id=$1 AND class_id=$2',[qid,s.class_id])).rowCount>0;
 if(sourceStillExists) await pool.query(`INSERT INTO quiz_progress(student_id,question_id,is_correct,selected_answer,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,question_id) DO UPDATE SET is_correct=$3,selected_answer=$4,updated_at=now()`,[s.id,qid,isCorrect,answer]);
 const agg=(await pool.query(`SELECT count(*) FILTER (WHERE selected_index IS NOT NULL)::int answered,count(*) FILTER (WHERE is_correct=true)::int correct FROM quiz_attempt_answers WHERE attempt_id=$1`,[attemptId])).rows[0];
 const current=Number(agg.answered)?Math.round(Number(agg.correct)/Number(agg.answered)*100):null;
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=$2,total=$3,current_score=$4,updated_at=now()`,[s.id,Number(agg.answered),Math.max(0,Number(req.body.total)||0),current]);
 res.json({ok:true});
});

app.post('/student/:id/quiz', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const attemptId=Number(req.body.attempt_id); if(!attemptId) return res.status(400).send('Missing quiz attempt');
 const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[attemptId,s.id])).rows[0];
 if(!attempt) return res.status(400).send(layout('Quiz Already Submitted','<div class="card">This quiz attempt is no longer active.</div>'));
 const answers=await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attemptId]);
 let correct=0; const review=[]; const missed=[];
 for(const row of answers.rows){
  const field='q_'+row.source_question_id; const raw=req.body[field]; const selectedIndex=(raw===undefined||raw===null||raw==='')?row.selected_index:Number(raw);
  const choices=Array.isArray(row.choices)?row.choices:[]; const ok=Number.isInteger(selectedIndex) && selectedIndex===row.correct_index; if(ok) correct++;
  const selectedAnswer=Number.isInteger(selectedIndex)?(choices[selectedIndex]||'No answer'):'No answer';
  await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[Number.isInteger(selectedIndex)?selectedIndex:null,selectedAnswer,ok,row.id]);
  const item={attempt_answer_id:row.id,question_id:row.source_question_id,question:row.question_text,topic:row.topic||'',choices,selected_index:Number.isInteger(selectedIndex)?selectedIndex:null,answer_index:row.correct_index,selected:selectedAnswer,correct:row.correct_answer,explanation:row.explanation||'Review this topic with your instructor.',is_correct:ok};
  review.push(item); if(!ok) missed.push(item);
 }
 const total=answers.rowCount, score=total?Math.round(correct/total*100):0; const details={attempt_id:attemptId,correct,total,missed,review};
 await pool.query(`UPDATE quiz_attempts SET score=$1,correct_count=$2,total_questions=$3,status='completed',completed_at=now() WHERE id=$4`,[score,correct,total,attemptId]);
 await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Module Quiz',$2,$3)",[s.id,score,JSON.stringify(details)]);
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Finished',$2,$2,$3,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Finished',progress=$2,total=$2,current_score=$3,updated_at=now()`,[s.id,total,score]);
 const reviewHtml=renderAttemptReview(review,score,true);
 const passed=score>=s.pass_score; if(passed) await ensureCertificate(s.id);
 const certHtml=passed?`<div class="card center" style="border:4px solid var(--red);background:#fffafa"><div class="eyebrow">Passed · Certificate Ready</div><div class="big" style="font-size:30px">Congratulations, ${esc(s.name)}</div><p>Your certificate of completion is ready now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="alert"><b>Certificate not yet available.</b> Your score was ${score}%. The passing score is ${s.pass_score}%.</div></div>`;
 res.send(layout('Quiz Complete', `<div class="card center"><div class="eyebrow">The Training Hub 1.0 · Attempt #${attemptId}</div><div class="big">Quiz Complete</div><div class="code">${score}%</div><p>${correct} of ${total} correct · ${missed.length} missed</p></div>${certHtml}${reviewHtml}<div class="card center"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/quiz-review', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
 if(attempt){
  const rows=(await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attempt.id])).rows;
  const review=rows.map(attemptRowToReviewItem); const reviewHtml=renderAttemptReview(review,attempt.score,true);
  return res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Permanent Quiz Attempt #${attempt.id} · 2.0</div><div class="big">Quiz Review — Latest Attempt</div><p>Completed ${new Date(attempt.completed_at).toLocaleString()}</p>${reviewHtml}<div class="toolbar"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
 }
 const old=(await pool.query("SELECT score,details,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC,id DESC LIMIT 1",[s.id])).rows[0];
 if(!old) return res.send(layout('Quiz Review', `<div class="card"><div class="big">No Quiz Result Yet</div><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a></div>`));
 const repaired=await repairQuizReviewData(s.id,old.details||{});
 const reviewHtml=repaired.review.length?renderAttemptReview(repaired.review,old.score,true):`<div class="alert"><b>This older attempt has no recoverable question snapshot.</b> New 2.0 attempts are stored permanently.</div>`;
 res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Legacy Quiz Record · 2.0 Recovery</div><div class="big">Quiz Review</div>${reviewHtml}<div class="toolbar" style="margin-top:16px"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
});

app.get('/student/:id/hunt', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[s.class_id]);
 const p=await pool.query('SELECT station_id,correct FROM hunt_progress WHERE student_id=$1',[s.id]);
 const progress=new Map(p.rows.map(x=>[Number(x.station_id),x]));
 const correctCount=p.rows.filter(x=>x.correct).length;
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status='Hunt',progress=$2,total=$3,updated_at=now()`,[s.id,correctCount,q.rowCount]);
 const tractorCount=Math.min(5,Math.max(1,Number(s.hunt_tractor_count)||3));
 const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[s.class_id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
 for(const x of q.rows) if(x.tractor_no&&x.tractor_model&&!models.has(Number(x.tractor_no))) models.set(Number(x.tractor_no),x.tractor_model);
 const tractorName=n=>models.get(n)||`${brand('equipment_label','Equipment')} ${n}`;
 const groups=Array.from({length:tractorCount},(_,i)=>i+1).map(n=>{
  const rows=q.rows.filter(x=>Number(x.tractor_no)===n);
  const body=rows.map(x=>{
   const sn=q.rows.findIndex(y=>y.id===x.id)+1;
   const pr=progress.get(Number(x.id));
   const status=pr?.correct?'<span class="pill results">✓ Correct</span>':pr?'<span class="pill" style="background:#fff1a8;color:#111;border-color:#d1aa00">Try Again</span>':'<span class="pill">Not Scanned</span>';
   const action=pr?.correct?'<span class="muted">Completed</span>':`<button type="button" class="btn hunt-scan-btn" data-station-id="${x.id}" data-item="${esc(x.item_label||x.station_name)}">Scan QR</button>`;
   return `<tr><td>${sn}</td><td><b>${esc(x.item_label||x.station_name)}</b></td><td>${status}</td><td>${action}</td></tr>`
  }).join('');
  return `<div class="card"><div class="section-title"><div><div class="eyebrow">${brand('equipment_label','Equipment').toUpperCase()} ${n}</div><div class="big">${esc(tractorName(n))}</div></div><span class="pill">${rows.length} Item${rows.length===1?'':'s'}</span></div><div style="overflow:auto"><table><tr><th>#</th><th>Hunt Item</th><th>Status</th><th>Action</th></tr>${body||'<tr><td colspan="4">No hunt items assigned.</td></tr>'}</table></div></div>`
 }).join('');
 res.send(layout('Scavenger Hunt', `<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script><div class="card"><div class="eyebrow">Hands-On Individual Activity</div><div class="big">Hands-On Scavenger Hunt</div><div class="grid"><div class="stat"><span>Your Progress</span><b>${correctCount} / ${q.rowCount}</b></div><div class="stat"><span>How It Works</span><b style="font-size:18px">Choose Item · Scan · Verify</b></div></div><div class="alert" style="color:#111"><b>How to use the hunt:</b> Tap <b>Scan QR</b> beside the item you are looking for. Your phone camera will open <b>right here in the Training Hub</b>. Point it at the QR code on the equipment, station, or component.</div></div>${groups}<div id="hunt-scanner-panel" class="card center" style="display:none;border-top:6px solid var(--red)"><div class="eyebrow">IN-APP QR SCANNER</div><div id="hunt-scanner-title" class="big">Scan Hunt QR</div><p class="muted">Keep this page open and point your phone at the station QR code.</p><div id="hunt-reader" style="max-width:520px;margin:16px auto;border-radius:14px;overflow:hidden;background:#111;min-height:260px"></div><div id="hunt-scan-status" class="alert" style="color:#111"><b>Tap Scan QR on an item to start.</b></div><div class="toolbar" style="justify-content:center"><button id="hunt-close-scanner" type="button" class="btn light">Close Scanner</button></div></div><div class="card"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div><script>(function(){const panel=document.getElementById('hunt-scanner-panel'),readerId='hunt-reader',status=document.getElementById('hunt-scan-status'),title=document.getElementById('hunt-scanner-title'),closeBtn=document.getElementById('hunt-close-scanner');let scanner=null,busy=false;function msg(html,bad){status.innerHTML=html;status.style.background=bad?'#ffe082':'';status.style.borderColor=bad?'#d6a700':'';}async function stop(){busy=false;if(scanner){try{await scanner.stop();}catch(e){}try{await scanner.clear();}catch(e){}scanner=null;}}async function start(stationId,item){panel.style.display='block';title.textContent='Find: '+item;panel.scrollIntoView({behavior:'smooth',block:'start'});document.cookie='mth_hunt_target_${Number(s.class_id)}='+encodeURIComponent(stationId)+'; Path=/; Max-Age=1800; SameSite=Lax';await stop();if(!window.Html5Qrcode){msg('<b>QR scanner did not load.</b><br>Refresh this page and try again.',true);return;}msg('<b>Opening camera…</b><br>If asked, choose Allow.',false);try{scanner=new Html5Qrcode(readerId);await scanner.start({facingMode:{ideal:'environment'}},{fps:10,qrbox:{width:250,height:250},aspectRatio:1.0},decoded=>{if(busy)return;let u;try{u=new URL(decoded,location.origin);}catch(e){msg('<b>That is not a Training Hub QR code.</b>',true);return;}const m=u.pathname.match(/^\/hunt-station\/(\d+)\/(\d+)$/);if(!m||Number(m[1])!==${Number(s.class_id)}){msg('<b>Wrong QR type.</b><br>Scan a Scavenger Hunt station QR for this class.',true);return;}busy=true;msg('<b>QR found.</b><br>Checking the station…',false);Promise.resolve(scanner.stop()).catch(()=>{}).finally(()=>{location.href=u.pathname+'?student_id=${Number(s.id)}&token=${encodeURIComponent(s.join_token)}';});},()=>{});msg('<b>Camera ready.</b><br>Hold the station QR inside the square.',false);}catch(e){msg('<b>Camera could not open.</b><br>'+String(e&&e.message?e.message:e)+'<br><br>Check your browser camera permission for this site, then tap Scan QR again.',true);}}document.querySelectorAll('.hunt-scan-btn').forEach(b=>b.addEventListener('click',()=>start(b.dataset.stationId,b.dataset.item||'Hunt Item')));closeBtn.addEventListener('click',async()=>{await stop();panel.style.display='none';});})();</script>`));
});

app.get('/student/:id/hunt/scan/:sid', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const station=(await pool.query('SELECT * FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,s.class_id])).rows[0];
 if(!station) return res.status(404).send(layout('Hunt Item Not Found','<div class="card">This scavenger-hunt item is not available.</div>'));
 res.setHeader('Set-Cookie',`mth_hunt_target_${s.class_id}=${station.id}; Path=/; Max-Age=1800; SameSite=Lax`);
 const huntBack=`/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}`;
 res.send(layout('Scan Hunt QR', `<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script><div class="card center"><div class="eyebrow">SCAVENGER HUNT · SCAN INSIDE TRAINING HUB</div><div class="big">${esc(station.item_label||station.station_name)}</div><p class="muted">${esc(station.tractor_model||'')} ${station.tractor_no?`· ${brand('equipment_label','Equipment')} ${station.tractor_no}`:''}</p><div class="success"><b>Target selected.</b><br>Point the camera below at the QR code where you believe this item is located. You do not need to leave the Training Hub.</div><div id="hunt-reader" style="max-width:520px;margin:16px auto;border-radius:14px;overflow:hidden;background:#111"></div><div id="hunt-scan-status" class="alert" style="color:#111"><b>Starting camera…</b><br>Allow camera access when your browser asks.</div><div class="toolbar" style="justify-content:center"><button id="hunt-start-camera" type="button" class="btn light" style="display:none">Start Camera</button><a class="btn light" href="${huntBack}">Back to Hunt List</a></div></div><script>(function(){const status=document.getElementById('hunt-scan-status'),btn=document.getElementById('hunt-start-camera');let scanner=null,busy=false;function msg(html,bad){status.innerHTML=html;status.style.background=bad?'#ffe082':'';status.style.color='#111';}function handle(decoded){if(busy)return;let u;try{u=new URL(decoded,location.origin);}catch(e){msg('<b>That is not a Training Hub QR code.</b><br>Keep looking for the station QR.',true);return;}const m=u.pathname.match(/^\/hunt-station\/(\d+)\/(\d+)$/);if(!m||Number(m[1])!==${Number(s.class_id)}){msg('<b>Wrong QR type.</b><br>Scan one of the Scavenger Hunt station QR codes for this class.',true);return;}busy=true;msg('<b>QR found.</b><br>Checking the station…',false);Promise.resolve(scanner&&scanner.stop?scanner.stop():null).catch(()=>{}).finally(()=>{location.href=u.pathname+'?student_id=${Number(s.id)}&token=${encodeURIComponent(s.join_token)}';});}async function start(){btn.style.display='none';busy=false;try{if(!window.Html5Qrcode)throw new Error('Scanner library did not load');scanner=new Html5Qrcode('hunt-reader');const cams=await Html5Qrcode.getCameras();if(!cams||!cams.length)throw new Error('No camera found');let cam=cams.find(c=>/back|rear|environment/i.test(c.label))||cams[cams.length-1];await scanner.start(cam.id,{fps:10,qrbox:{width:250,height:250},aspectRatio:1.0},handle,()=>{});msg('<b>Camera ready.</b><br>Hold the QR code inside the square. The Training Hub will scan it automatically.',false);}catch(e){msg('<b>Camera could not start.</b><br>'+String(e&&e.message?e.message:e)+'<br>Tap Start Camera and allow camera access.',true);btn.style.display='inline-block';}}btn.addEventListener('click',start);start();})();</script>`));
});

function readCookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]})); }
app.get('/hunt-station/:cid/:sid', async(req,res)=>{
 const station=(await pool.query('SELECT h.*,c.course,c.code,c.join_token,c.active,c.hunt_tractor_count,c.company_id FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||!station.active) return res.status(404).send(layout('Station Unavailable','<div class="card">This scavenger-hunt station is not available.</div>'));
 const cookies=readCookies(req);
 const cookie=cookies[`mth_student_${station.class_id}`]||''; const [studentId,token]=cookie.split(':'); let student=null; if(studentId&&token===station.join_token) student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[studentId,station.class_id])).rows[0];
 // 2.1.92: allow the in-app modular scavenger scanner to carry the already-linked class student
 // explicitly. This avoids depending on a second class-join cookie on mobile browsers.
 if(!student){
  const qsStudentId=Number(req.query.student_id||0);
  const qsToken=String(req.query.token||'');
  if(qsStudentId&&qsToken===station.join_token){
   student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[qsStudentId,station.class_id])).rows[0]||null;
   if(student)res.append('Set-Cookie',`mth_student_${station.class_id}=${student.id}:${station.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  }
 }
 // Modular Program fallback: if the class cookie is missing, reuse the authenticated program student.
 // This keeps printed station QR codes generic while preventing a second class join on phones.
 if(!student){
  const pc=String(cookies.mth_program_student||'');
  const cut=pc.indexOf(':');
  const programStudentId=Number(cut>0?pc.slice(0,cut):0);
  const programToken=cut>0?pc.slice(cut+1):'';
  if(programStudentId&&programToken){
   const ps=(await pool.query(`SELECT ps.*,p.company_id FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2 AND p.company_id=$3 AND p.active=true`,[programStudentId,programToken,station.company_id])).rows[0];
   if(ps){
    student=(await pool.query(`SELECT * FROM students WHERE class_id=$1 AND lower(trim(name))=lower(trim($2)) ORDER BY CASE WHEN lower(trim(coalesce(dealer,'')))=lower(trim(coalesce($3,''))) THEN 1 ELSE 0 END DESC,id DESC LIMIT 1`,[station.class_id,ps.name,ps.dealer||''])).rows[0];
    if(!student) student=(await pool.query(`INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *`,[station.class_id,ps.name,ps.dealer||''])).rows[0];
    res.append('Set-Cookie',`mth_student_${station.class_id}=${student.id}:${station.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
   }
  }
 }
 if(!student) return res.send(layout('Identify Student', `<div class="card"><span class="pill">Class ${esc(station.code)}</span><div class="big">${esc(station.station_name)}</div><p>Join the class first, then scan this station QR again.</p><a class="btn" href="/c/${esc(station.join_token)}">Join Class</a></div>`));
 const targetId=Number(cookies[`mth_hunt_target_${station.class_id}`]||0);
 const targetStation=targetId?(await pool.query('SELECT id,item_label,station_name,tractor_model,tractor_no FROM hunt_stations WHERE id=$1 AND class_id=$2',[targetId,station.class_id])).rows[0]:null;
 if(targetStation&&Number(targetStation.id)!==Number(station.id)){
  return res.send(layout('Wrong Scavenger Hunt Station', `<div class="card center"><div class="eyebrow">SCAVENGER HUNT CHECK</div><div class="big">Wrong Station</div><div class="alert" style="background:#ffe082;color:#111;border-color:#d6a700"><b>Not the item you selected.</b><br>You scanned <b>${esc(station.item_label||station.station_name)}</b>, but you are currently looking for <b>${esc(targetStation.item_label||targetStation.station_name)}</b>.</div><p>Go back to the tractor and keep looking. Your target is still active, so you can scan another QR code.</p><a class="btn" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">Back to Hunt List</a></div>`));
 }
 const done=(await pool.query('SELECT * FROM hunt_progress WHERE student_id=$1 AND station_id=$2',[student.id,station.id])).rows[0];
 const stationOrder=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[station.class_id])).rows; const stationNumber=Math.max(1,stationOrder.findIndex(x=>Number(x.id)===Number(station.id))+1);
 const matched=targetStation&&Number(targetStation.id)===Number(station.id);
 const matchBanner=matched?'<div class="success"><b>✓ Correct Station</b><br>You found the QR code for the item you selected.</div>':'<div class="alert" style="color:#111"><b>Direct station scan.</b> For right/wrong station checking, start from the <b>Scan QR</b> button beside an item on your Scavenger Hunt list.</div>';
 const verificationWord=huntVerificationWord(station);
 const verificationBox=(matched||!targetStation)&&verificationWord?`<div class="success" style="margin:14px 0;padding:16px;text-align:center"><div class="eyebrow">VERIFICATION WORD</div><div style="font-size:30px;font-weight:900;letter-spacing:.06em;margin-top:4px">${esc(verificationWord.toUpperCase())}</div><div class="small" style="margin-top:6px">Type this word below to verify this station.</div></div>`:'';
 const answerArea=done?.correct?`<div class="success">Completed. Your answer: <b>${esc(done.answer)}</b></div><a class="btn light" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a>`:`${done&&!done.correct?'<div class="alert" style="background:#ffe082;color:#111;border-color:#d6a700"><b>Previous answer was not correct.</b> Review the item and try again.</div>':''}<form method="post" action="/hunt-station/${station.class_id}/${station.id}"><input type="hidden" name="student_id" value="${student.id}"><input type="hidden" name="token" value="${esc(station.join_token)}"><label>Verification Word / Answer<input name="answer" required autofocus autocomplete="off"></label><button>Check Answer</button></form>`;
 res.send(layout(station.station_name, `<div class="card"><span class="pill hunt">Station ${stationNumber}</span><div class="big" style="margin-top:12px">${esc(station.item_label||station.station_name)}</div><p class="muted">${esc(station.tractor_model||'')} ${station.tractor_no?`· ${brand('equipment_label','Equipment')} ${station.tractor_no}`:''}</p>${matchBanner}<h3>Your Task</h3><p>${esc(station.task)}</p>${verificationBox}${answerArea}</div>`));
});
app.post('/hunt-station/:cid/:sid', async(req,res)=>{
 const station=(await pool.query('SELECT h.*,c.join_token FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||req.body.token!==station.join_token) return res.status(403).send('Invalid station');
 const student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[req.body.student_id,station.class_id])).rows[0]; if(!student) return res.status(403).send('Student not found');
 const answer=(req.body.answer||'').trim(); const a=answer.toLowerCase(), e=huntVerificationWord(station).toLowerCase(); const correct=!!a&&(a===e||a.includes(e)||e.includes(a));
 await pool.query(`INSERT INTO hunt_progress(student_id,station_id,answer,correct,completed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,station_id) DO UPDATE SET answer=$3,correct=$4,completed_at=now()`,[student.id,station.id,answer,correct]);
 const total=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1',[station.class_id])).rows[0].n);
 const p=(await pool.query('SELECT count(*) FILTER (WHERE correct)::int correct FROM hunt_progress hp JOIN hunt_stations h ON h.id=hp.station_id WHERE hp.student_id=$1 AND h.class_id=$2',[student.id,station.class_id])).rows[0];
 const done=Number(p.correct)||0;
 const score=total?Math.round(done/total*100):0;
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status=$5,progress=$2,total=$3,current_score=$4,updated_at=now()`,[student.id,done,total,score,done>=total?'Finished':'Hunt']);
 if(done>=total){ await pool.query("DELETE FROM results WHERE student_id=$1 AND activity='Scavenger Hunt'",[student.id]); await pool.query(`INSERT INTO results(student_id,activity,score,details) VALUES($1,'Scavenger Hunt',$2,$3)`,[student.id,score,JSON.stringify({completed:done,total})]); }
 if(!correct){
  return res.send(layout('Check Your Answer', `<div class="card center"><div class="eyebrow">SCAVENGER HUNT CHECK</div><div class="big">Not Quite</div><div class="alert" style="background:#ffe082;color:#111;border-color:#d6a700"><b>That answer is not correct yet.</b><br>Recheck the component, measurement, or identification and try again.</div><p>${done} of ${total} hunt items completed correctly.</p><div class="toolbar" style="justify-content:center"><a class="btn" href="/hunt-station/${station.class_id}/${station.id}">Try This Station Again</a><a class="btn light" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">Back to Hunt List</a></div></div>`));
 }
 res.setHeader('Set-Cookie',`mth_hunt_target_${station.class_id}=; Path=/; Max-Age=0; SameSite=Lax`);
 res.send(layout('Station Correct', `<div class="card center"><div class="eyebrow">SCAVENGER HUNT CHECK</div><div class="big">✓ Correct</div><div class="success"><b>Correct station and correct answer.</b><br>This hunt item is now complete.</div><p>${done} of ${total} hunt items completed correctly.</p><a class="btn" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">Continue Scavenger Hunt</a></div>`));
});

app.get('/student/:id/scenario', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const assignments=(await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND enabled=true ORDER BY configured_at DESC`,[s.class_id])).rows;
 const attempts=(await pool.query(`SELECT * FROM simulation_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[s.id])).rows;
 const latestBySim=new Map(); for(const a of attempts){ if(!latestBySim.has(a.simulation_key)) latestBySim.set(a.simulation_key,a); }
 const cards=assignments.map(a=>{
  const sim=simByKey(a.simulation_key); if(!sim) return '';
  const tractorModel=a.tractor_model||tractorChoicesForSim(sim)[0];
  const displayTitle=simulationDisplayTitle(sim,tractorModel);
  const prev=latestBySim.get(sim.key);
  const status=prev?.status==='completed'?`<div class="success"><b>Latest Score:</b> ${prev.score}%</div>`:prev?.status==='in_progress'?`<div class="alert"><b>In Progress</b> · Attempt #${prev.id}</div>`:'<div class="muted">Not attempted yet.</div>';
  const action=prev?.status==='in_progress'?`<a class="btn" href="/student/${s.id}/scenario/${prev.id}?token=${encodeURIComponent(s.join_token)}">Continue Simulation</a>`:`<form method="post" action="/student/${s.id}/scenario/start?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="simulation_key" value="${esc(sim.key)}"><button>${prev?.status==='completed'?'Run Again':'Start Simulation'}</button></form>`;
  const review=prev?.status==='completed'?`<a class="btn light" href="/student/${s.id}/scenario/${prev.id}/review?token=${encodeURIComponent(s.join_token)}">Review Latest Attempt</a>`:'';
  const prereqText=a.prerequisite_hunt_type&&a.prerequisite_hunt_type!=='none'?`<div class="alert" style="color:#111"><b>Prerequisite:</b> Complete the ${esc(a.prerequisite_hunt_type)} scavenger hunt first.</div>`:'';
  return `<div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><div><div class="eyebrow">${esc(sim.level)} DIAGNOSTIC SIMULATION</div><div class="big">${esc(displayTitle)}</div></div><span class="sim-badge">${esc(sim.workOrder)}</span></div><p><b>Equipment:</b> ${esc(tractorModel)} &nbsp; · &nbsp; <b>Difficulty:</b> ${esc(a.difficulty||sim.difficulty)} &nbsp; · &nbsp; <b>Pass:</b> ${Number(a.pass_score)||sim.passScore}%</p><div class="alert"><b>Customer Complaint:</b><br>${esc(sim.complaint)}</div><div class="card" style="margin:10px 0;padding:12px"><b>Assignment:</b><br>${esc(sim.assignment)}</div>${prereqText}${status}<div class="toolbar" style="margin-top:12px">${action}${review}</div></div>`;
 }).join('');
 const history=attempts.slice(0,20).map(a=>`<tr><td>${esc(a.title)}</td><td>${a.status==='completed'?a.score+'%':'In Progress'}</td><td>${new Date(a.completed_at||a.started_at).toLocaleString()}</td><td>${a.status==='completed'?`<a class="btn light" href="/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}">Review</a>`:`<a class="btn light" href="/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}">Continue</a>`}</td></tr>`).join('');
 res.send(layout('Diagnostic Simulation Library', `<div class="toolbar"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">← Back to Training</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">Diagnostic Failure Simulation System · 2.0</div><div class="big" style="font-size:30px">Simulation Library</div><p style="margin-bottom:0">Your instructor chooses the hidden planted failure. Your job is to prove it.</p></div>${cards||'<div class="card"><div class="big">Waiting for Instructor</div><p>No diagnostic simulations have been released for this class yet.</p></div>'}<div class="card"><div class="big">My Simulation History</div><div style="overflow:auto"><table><thead><tr><th>Simulation</th><th>Score</th><th>Date</th><th></th></tr></thead><tbody>${history||'<tr><td colspan="4">No simulation attempts yet.</td></tr>'}</tbody></table></div></div>`,simulationCss()));
});

app.post('/student/:id/scenario/start', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const simulationKey=(req.body.simulation_key||'').trim(), base=simByKey(simulationKey); if(!base) return res.status(400).send('Unknown simulation.');
 const existing=(await pool.query(`SELECT * FROM simulation_attempts WHERE student_id=$1 AND simulation_key=$2 AND status='in_progress' ORDER BY started_at DESC LIMIT 1`,[s.id,simulationKey])).rows[0];
 if(existing) return res.redirect(`/student/${s.id}/scenario/${existing.id}?token=${encodeURIComponent(s.join_token)}`);
 const assignment=await getSimulationAssignment(s.class_id,simulationKey);
 if(!assignment) return res.status(400).send('Instructor has not released this simulation for your class.');
 const prereq=assignment.prerequisite_hunt_type||'none';
 if(!(await studentHuntPrerequisiteMet(s.id,s.class_id,prereq))) return res.send(layout('Prerequisite Required',`<div class="card"><div class="big">Scavenger Hunt Required First</div><p>Complete the associated ${esc(prereq)} scavenger hunt before starting this simulation.</p><a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">Open Scavenger Hunt</a></div>`));
 const sim=simForRoot(simulationKey,assignment.root_cause_key); if(!sim) return res.status(400).send('Simulation root cause is not configured correctly.');
 const tractorModel=assignment.tractor_model||tractorChoicesForSim(sim)[0];
 if(!validTractorForSim(sim,tractorModel)) return res.status(400).send('Instructor equipment selection is not valid for this simulation.');
 const difficulty=assignment.difficulty||sim.difficulty||'Intermediate', passScore=Math.min(100,Math.max(0,Number(assignment.pass_score)||sim.passScore||80)), maxParts=Math.max(0,Number.isFinite(Number(assignment.max_parts_penalties))?Number(assignment.max_parts_penalties):sim.maxPartsPenalties||1);
 const a=(await pool.query(`INSERT INTO simulation_attempts(student_id,class_id,simulation_key,title,work_order,root_cause_key,assigned_diagnosis,assigned_repair,tractor_model,difficulty,pass_score,max_parts_penalties,status,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'in_progress',now()) RETURNING *`,[s.id,s.class_id,sim.key,simulationDisplayTitle(sim,tractorModel),sim.workOrder,sim.rootCauseKey,sim.correctDiagnosis,sim.correctRepair,tractorModel,difficulty,passScore,maxParts])).rows[0];
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Diagnosing',0,7,0,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Diagnosing',progress=0,total=7,current_score=0,updated_at=now()`,[s.id]);
 res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
});

app.get('/student/:id/scenario/:attemptId', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a) return res.status(404).send('Simulation attempt not found');
 if(a.status==='completed') return res.redirect(`/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}`);
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key);
 const actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
 const hints=(await pool.query('SELECT * FROM simulation_hints WHERE attempt_id=$1 ORDER BY level',[a.id])).rows;
 const doneRows=new Map(actions.map(x=>[x.action_key,x])); const totals=await recalcSimulation(a.id);
 const proofDone=proofComplete(sim,actions), replacementKey=sim.rootCause?.replacementAction||'', replacementDone=!replacementKey||doneRows.has(replacementKey), verifyRow=doneRows.get('verify_repair');
 const pending=actions.find(x=>x.evidence_required&&!String(x.evidence_text||'').trim());
 const core=sim.actions.filter(x=>['fault_codes','live_data'].includes(x.key));
 const stageDone=[
  doneRows.has('verify_complaint')||!sim.actions.some(x=>x.key==='verify_complaint'),
  core.every(x=>doneRows.has(x.key)),
  (sim.rootCause?.proof||[]).some(k=>doneRows.has(k)),
  proofDone,
  replacementDone&&proofDone,
  !!verifyRow&&(!verifyRow.evidence_required||String(verifyRow.evidence_text||'').trim())
 ];
 const stageLabels=['Verify Complaint','Inputs / Data','Command / Circuit','Prove Root Cause','Repair','Verify Repair'];
 const stageBar=`<div class="sim-stagebar">${stageLabels.map((x,i)=>`<div class="${stageDone[i]?'done':(i===stageDone.findIndex(v=>!v)?'current':'locked')}"><b>${i+1}</b><span>${esc(x)}</span></div>`).join('')}</div>`;
 const evidence=actions.length?actions.map((x,i)=>{
  const cls=x.feedback_type==='wrong'||x.penalty?'penalty':x.feedback_type==='good'||x.points?'good':'';
  const why=x.why_answer?`<div class="small" style="margin-top:5px"><b>Why:</b> ${esc(x.why_answer)} ${x.why_correct===true?'✓':x.why_correct===false?'— review reasoning':''}</div>`:'';
  const ev=x.evidence_text?`<div class="small" style="margin-top:5px"><b>Student Evidence:</b> ${esc(x.evidence_text)}</div>`:'';
  return `<div class="sim-log ${cls}"><b>${i+1}. ${esc(x.label)}</b> ${x.points?`<span class="sim-badge">+${x.points}</span>`:''}${x.penalty?`<span class="sim-badge">-${x.penalty}</span>`:''}<div style="margin-top:6px">${esc(x.result_text)}</div>${ev}${why}<div class="small muted" style="margin-top:4px">Step time: ${Number(x.step_seconds||0)} sec</div></div>`;
 }).join(''):'<p class="muted">No diagnostic evidence collected yet. Start by verifying the complaint.</p>';
 let followup='';
 if(pending){
  const def=sim.actions.find(x=>x.key===pending.action_key)||{};
  const choices=[def.whyCorrect,def.whyWrong1,def.whyWrong2].filter(Boolean);
  followup=`<div class="card" style="border:3px solid #d6a800;background:#fff8d6"><div class="eyebrow">RECORD EVIDENCE BEFORE CONTINUING</div><div class="big">${esc(pending.label)}</div><div class="alert" style="color:#111"><b>Test Result:</b><br>${esc(pending.result_text)}</div><form method="post" action="/student/${s.id}/scenario/${a.id}/evidence?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="action_key" value="${esc(pending.action_key)}"><label>What did this test prove?<textarea name="evidence_text" rows="3" required placeholder="Record the reading, state, observation, or circuit result that supports your diagnosis."></textarea></label>${def.whyPrompt&&choices.length?`<label>${esc(def.whyPrompt)}<select name="why_answer" required><option value="">Choose why this step matters</option>${choices.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>`:''}<button>Save Evidence & Continue</button></form></div>`;
 }
 const cats=['Visual Inspection','Fault Codes','Live Data','Wiring Diagram','Multimeter','Pressure Tests','Component Tests','Service Information','Repair History','Replace Part','Repair Verification'];
 const tools=cats.map(cat=>{
  const list=sim.actions.filter(x=>x.category===cat); if(!list.length)return '';
  return `<div class="sim-tool"><h3>${esc(cat)}</h3>${list.map(x=>{
   const row=doneRows.get(x.key);
   if(row){const cls=row.feedback_type==='wrong'||Number(row.penalty||0)>0?'sim-choice-wrong':row.feedback_type==='good'||isCorrectPathAction(sim,x)?'sim-choice-good':'sim-choice-neutral';const icon=cls==='sim-choice-good'?'✓':cls==='sim-choice-wrong'?'!':'•';return `<button type="button" class="${cls}" disabled>${icon} ${esc(x.label)}</button>`;}
   const unlocked=!pending&&actionUnlocked(sim,x,actions);
   if(!unlocked) return `<button type="button" class="sim-choice-neutral" disabled>🔒 ${esc(x.label)} <small>Stage ${inferActionStage(x)}</small></button>`;
   return `<form method="post" action="/student/${s.id}/scenario/${a.id}/action?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="action_key" value="${esc(x.key)}"><button class="${x.category==='Replace Part'?'alt':''}">${esc(x.label)}</button></form>`;
  }).join('')}</div>`;
 }).join('');
 const maxHints=a.difficulty==='Basic'?3:a.difficulty==='Advanced'?1:2;
 const hintPanel=`<div class="card"><div class="section-title"><div><div class="eyebrow">DIAGNOSTIC COACHING</div><div class="big">Hints</div></div><span class="sim-badge">${esc(a.difficulty||'Intermediate')}</span></div>${hints.map(h=>`<div class="alert" style="color:#111"><b>Hint ${h.level} · -${h.penalty} points</b><br>${esc(h.hint_text)}</div>`).join('')}${hints.length<maxHints?`<form method="post" action="/student/${s.id}/scenario/${a.id}/hint?token=${encodeURIComponent(s.join_token)}"><button class="light">Use Hint ${hints.length+1}</button></form>`:'<p class="muted">No additional hints are available at this difficulty level.</p>'}</div>`;
 const finalReady=stageDone[5]&&!pending;
 const finalForm=finalReady?`<div class="card sim-final"><div class="big">Final Diagnosis</div><p>Your evidence and repair verification are complete. Submit the diagnosis that the evidence proves.</p><form method="post" action="/student/${s.id}/scenario/${a.id}/final?token=${encodeURIComponent(s.join_token)}"><label>Root Cause<select name="diagnosis" required><option value="">Choose the proven root cause</option>${sim.rootCauses.map(x=>`<option>${esc(x.diagnosis)}</option>`).join('')}</select></label><label>Repair / Verification<select name="repair" required><option value="">Choose the correct repair and verification</option>${sim.rootCauses.map(x=>`<option>${esc(x.repair)}</option>`).join('')}</select></label><button>Submit Final Diagnosis</button></form></div>`:`<div class="card sim-final" style="opacity:.85"><div class="big">🔒 Final Diagnosis Locked</div><p>Finish the guided path, prove the root cause with recorded evidence, perform the supported repair, and complete repair verification before submitting.</p></div>`;
 res.send(layout('Virtual Diagnostic Bay', `<div class="sim-shell"><aside class="sim-wo"><div class="eyebrow" style="color:#ffb9bd">VIRTUAL SHOP BAY</div><h2>${esc(a.tractor_model||sim.model)}</h2><div class="sim-meta"><div><span>Work Order</span><b>${esc(sim.workOrder)}</b></div><div><span>Hour Meter</span><b>${esc(sim.hours)} h</b></div><div><span>Difficulty</span><b>${esc(a.difficulty||'Intermediate')}</b></div><div><span>Elapsed</span><b id="simTimer" class="sim-timer">${elapsedText(a.started_at)}</b></div></div><div class="alert"><b>Complaint</b><br>${esc(sim.complaint)}</div><hr style="border-color:#444"><div>Current Score</div><div class="sim-score">${totals.score}%</div><div>Earned: ${totals.positive} · Penalties: -${totals.penalty}</div><div class="small" style="margin-top:8px">Pass standard: ${a.pass_score||80}% · Max Parts Cannon: ${a.max_parts_penalties??1}</div>${totals.penalty?`<div class="parts-penalty" style="margin-top:10px">Current Penalties: -${totals.penalty}</div>`:''}</aside><main><div class="card sim-assignment"><div class="eyebrow">ASSOCIATED ASSIGNMENT</div><div class="big">Your Assignment</div><p style="font-size:17px;line-height:1.55;margin-bottom:14px">${esc(sim.assignment)}</p>${stageBar}</div>${followup}<div class="card"><div class="section-title"><div><div class="eyebrow">GUIDED DIAGNOSTIC PATH</div><div class="big">Diagnostic Tools & Information</div><div class="sim-path-key"><span class="g"><i></i>Correct / supported path</span><span class="r"><i></i>Wrong or premature path</span><span class="n"><i></i>Information collected / locked</span></div></div><span class="sim-badge">Attempt #${a.id}</span></div><div class="sim-tools" style="margin-top:15px">${tools}</div></div>${hintPanel}<div class="card"><div class="big">Evidence Log</div>${evidence}</div>${finalForm}</main></div>`, `${simulationCss()}<style>.sim-stagebar{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin-top:14px}.sim-stagebar div{padding:9px;border-radius:10px;border:1px solid #ccc;background:#eee;min-width:0}.sim-stagebar div.done{background:#dff3e5;border-color:#63a874}.sim-stagebar div.current{background:#fff1ad;border-color:#d6a800}.sim-stagebar div.locked{opacity:.55}.sim-stagebar b{display:block}.sim-stagebar span{font-size:11px;font-weight:800}@media(max-width:900px){.sim-stagebar{grid-template-columns:1fr 1fr}}</style><script>const st=new Date(${JSON.stringify(new Date(a.started_at).toISOString())}).getTime();setInterval(()=>{const x=Math.max(0,Math.floor((Date.now()-st)/1000)),m=Math.floor(x/60),ss=String(x%60).padStart(2,'0');const e=document.getElementById('simTimer');if(e)e.textContent=m+':'+ss;},1000);</script>`));
});

app.post('/student/:id/scenario/:attemptId/action', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), action=sim.actions.find(x=>x.key===req.body.action_key); if(!action) return res.status(400).send('Unknown diagnostic action');
 const existing=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
 if(!actionUnlocked(sim,action,existing)) return res.status(400).send('Complete the current diagnostic stage and required evidence before moving to that step.');
 const seq=Number((await pool.query('SELECT COALESCE(max(sequence),0)::int n FROM simulation_actions WHERE attempt_id=$1',[a.id])).rows[0].n)+1;
 const last=existing.length?new Date(existing[existing.length-1].created_at):new Date(a.started_at); const stepSeconds=Math.max(0,Math.floor((Date.now()-last.getTime())/1000));
 let actionPenalty=Number(action.penalty||0), actionResult=action.result, feedback=isCorrectPathAction(sim,action)?'good':isWrongDiagnosticChoice(sim,action)?'wrong':'neutral';
 if(action.category==='Replace Part'){
  const root=sim.rootCause||rootCauseByKey(sim,a.root_cause_key), required=Array.isArray(root?.proof)?root.proof:[], proven=proofComplete(sim,existing);
  if(root?.replacementAction===action.key&&proven){ actionPenalty=0; actionResult='Replacement is supported by the diagnostic evidence already collected. Perform the repair, then verify it under the original complaint conditions.'; feedback='good'; }
  else { actionPenalty=Math.max(15,actionPenalty||0); actionResult='PARTS CANNON PENALTY: a component was replaced before the diagnostic evidence proved that replacement was required.'; feedback='wrong'; }
 }
 const followup=Boolean(action.evidenceRequired||action.whyPrompt);
 await pool.query(`INSERT INTO simulation_actions(attempt_id,action_key,category,label,result_text,points,penalty,sequence,evidence_required,step_seconds,feedback_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(attempt_id,action_key) DO NOTHING`,[a.id,action.key,action.category,action.label,actionResult,action.points||0,actionPenalty,seq,followup,stepSeconds,feedback]);
 const totals=await recalcSimulation(a.id); const progress=Math.min(6,(await pool.query(`SELECT count(*)::int n FROM simulation_actions WHERE attempt_id=$1 AND feedback_type='good'`,[a.id])).rows[0].n);
 await pool.query(`UPDATE activity_status SET activity='Failure Simulation',status='Diagnosing',progress=$1,total=7,current_score=$2,updated_at=now() WHERE student_id=$3`,[Number(progress),totals.score,s.id]);
 res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}${followup?`&evidence=${encodeURIComponent(action.key)}`:''}`);
});

app.post('/student/:id/scenario/:attemptId/evidence', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), key=(req.body.action_key||'').trim(), def=sim.actions.find(x=>x.key===key); if(!def) return res.status(400).send('Unknown diagnostic action');
 const evidence=String(req.body.evidence_text||'').trim(); if(!evidence) return res.status(400).send('Record the evidence or test result before continuing.');
 const why=String(req.body.why_answer||'').trim(), whyCorrect=def.whyPrompt?why===String(def.whyCorrect||''):null;
 await pool.query(`UPDATE simulation_actions SET evidence_text=$1,why_answer=$2,why_correct=$3 WHERE attempt_id=$4 AND action_key=$5`,[evidence,why,whyCorrect,a.id,key]);
 res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
});

app.post('/student/:id/scenario/:attemptId/hint', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), used=Number((await pool.query('SELECT count(*)::int n FROM simulation_hints WHERE attempt_id=$1',[a.id])).rows[0].n||0), max=a.difficulty==='Basic'?3:a.difficulty==='Advanced'?1:2;
 if(used>=max) return res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
 const level=used+1, penalties=[2,4,6], text=sim.hints?.[level-1]||'Return to the diagnostic path and prove the next input, command, or circuit before replacing a part.';
 await pool.query(`INSERT INTO simulation_hints(attempt_id,level,hint_text,penalty) VALUES($1,$2,$3,$4) ON CONFLICT(attempt_id,level) DO NOTHING`,[a.id,level,text,penalties[level-1]]);
 await recalcSimulation(a.id);
 res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
});

app.post('/student/:id/scenario/:attemptId/final', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
 const verify=actions.find(x=>x.action_key==='verify_repair');
 if(!proofComplete(sim,actions)||!verify||!String(verify.evidence_text||'').trim()) return res.status(400).send('Prove the root cause and complete documented repair verification before submitting the final diagnosis.');
 const diagnosis=(req.body.diagnosis||'').trim(), repair=(req.body.repair||'').trim();
 const correctDiagnosis=a.assigned_diagnosis||sim.correctDiagnosis, correctRepair=a.assigned_repair||sim.correctRepair; const diagnosisCorrect=diagnosis===correctDiagnosis, repairCorrect=diagnosisCorrect&&repair===correctRepair;
 await pool.query(`UPDATE simulation_attempts SET final_diagnosis=$1,final_repair=$2,diagnosis_correct=$3,repair_correct=$4 WHERE id=$5`,[diagnosis,repair,diagnosisCorrect,repairCorrect,a.id]);
 const totals=await recalcSimulation(a.id), parts=partsPenaltyCount(actions), passed=diagnosisCorrect&&repairCorrect&&totals.score>=Number(a.pass_score||80)&&parts<=Number(a.max_parts_penalties??1);
 await pool.query(`UPDATE simulation_attempts SET status='completed',completed_at=now(),passed=$2 WHERE id=$1`,[a.id,passed]);
 const hints=(await pool.query('SELECT level,hint_text,penalty FROM simulation_hints WHERE attempt_id=$1 ORDER BY level',[a.id])).rows;
 const details={attempt_id:a.id,simulation_key:a.simulation_key,tractor_model:a.tractor_model||sim.model,work_order:sim.workOrder,difficulty:a.difficulty,diagnosis,repair,diagnosis_correct:diagnosisCorrect,repair_correct:repairCorrect,passed,pass_score:a.pass_score,max_parts_penalties:a.max_parts_penalties,positive_points:totals.positive,penalty_points:totals.penalty,hints,actions:actions.map(x=>({action:x.label,result:x.result_text,evidence:x.evidence_text,why:x.why_answer,why_correct:x.why_correct,step_seconds:x.step_seconds,points:x.points,penalty:x.penalty,feedback:x.feedback_type}))};
 await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Failure Simulation',$2,$3)",[s.id,totals.score,JSON.stringify(details)]);
 await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Finished',7,7,$2,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Finished',progress=7,total=7,current_score=$2,updated_at=now()`,[s.id,totals.score]);
 res.redirect(`/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}`);
});

app.get('/student/:id/scenario/:attemptId/review', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a) return res.status(404).send('Simulation attempt not found');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows, hints=(await pool.query('SELECT * FROM simulation_hints WHERE attempt_id=$1 ORDER BY level',[a.id])).rows;
 const rows=actions.map((x,i)=>`<div class="sim-log ${x.feedback_type==='wrong'||x.penalty?'penalty':x.feedback_type==='good'||x.points?'good':''}"><b>${i+1}. ${esc(x.label)}</b>${x.points?` · +${x.points}`:''}${x.penalty?` · -${x.penalty}`:''}<div>${esc(x.result_text)}</div>${x.evidence_text?`<div class="small"><b>Evidence:</b> ${esc(x.evidence_text)}</div>`:''}${x.why_answer?`<div class="small"><b>Reasoning:</b> ${esc(x.why_answer)} ${x.why_correct?'✓':''}</div>`:''}<div class="small muted">Step time: ${Number(x.step_seconds||0)} sec</div></div>`).join('');
 const elapsed=a.completed_at?Math.max(0,Math.floor((new Date(a.completed_at)-new Date(a.started_at))/1000)):0, elapsedFmt=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
 const expected=(sim.rootCause?.proof||[]).map(k=>sim.actions.find(x=>x.key===k)?.label||k); const wrong=actions.filter(x=>x.feedback_type==='wrong').map(x=>x.label); const parts=partsPenaltyCount(actions);
 res.send(layout('Simulation Review', `<div class="card" style="border-top:6px solid ${a.passed?'#267a3f':'var(--red)'}"><div class="eyebrow">PERMANENT DIAGNOSTIC SIMULATION ATTEMPT #${a.id}</div><div class="big">${esc(a.title||sim.title)} · ${a.passed?'<span class="pill open">PASS</span>':'<span class="pill">REVIEW REQUIRED</span>'}</div><p><b>Equipment:</b> ${esc(a.tractor_model||sim.model)} · <b>Difficulty:</b> ${esc(a.difficulty||'Intermediate')}</p><div class="grid" style="margin-top:12px"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>PASS STANDARD</span><b>${a.pass_score||80}%</b></div><div class="stat"><span>PARTS CANNON</span><b>${parts}/${a.max_parts_penalties??1}</b></div><div class="stat"><span>TIME</span><b>${elapsedFmt}</b></div></div></div><div class="card"><div class="big">Final Diagnosis</div><p><b>Student Diagnosis:</b> ${esc(a.final_diagnosis||'Not submitted')} ${a.diagnosis_correct?'<span class="pill open">CORRECT</span>':'<span class="pill">INCORRECT</span>'}</p><p><b>Correct Diagnosis:</b> ${esc(a.assigned_diagnosis||sim.correctDiagnosis)}</p><p><b>Student Repair:</b> ${esc(a.final_repair||'Not submitted')}</p><p><b>Correct Repair:</b> ${esc(a.assigned_repair||sim.correctRepair)}</p></div><div class="card"><div class="big">Correct Diagnostic Path</div><ol>${expected.map(x=>`<li>${esc(x)}</li>`).join('')}<li>Perform the supported repair.</li><li>Verify repair under the original complaint conditions.</li></ol>${wrong.length?`<div class="alert" style="color:#111"><b>Diagnostic Detours / Premature Choices:</b><br>${wrong.map(esc).join(' · ')}</div>`:'<div class="success">No recorded wrong-path diagnostic selections.</div>'}</div><div class="card"><div class="big">Your Diagnostic Process</div>${rows||'<p>No diagnostic actions recorded.</p>'}</div>${hints.length?`<div class="card"><div class="big">Hints Used</div>${hints.map(h=>`<p><b>Hint ${h.level} (-${h.penalty}):</b> ${esc(h.hint_text)}</p>`).join('')}</div>`:''}<div class="card"><div class="big">Completion Standard</div><p>Required: correct root cause, correct repair, documented repair verification, score of at least <b>${a.pass_score||80}%</b>, and no more than <b>${a.max_parts_penalties??1}</b> Parts Cannon penalty event(s).</p></div><div class="toolbar"><a class="btn" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Simulation Library</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`,simulationCss()));
});

app.get('/student/:id/feedback', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 if((await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount) return res.send(layout('Feedback Complete',`<div class="card center"><div class="big">Thank You</div><p>Your training feedback has already been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
 const rating=(name,label)=>`<label>${label}<div class="rating">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${name}" value="${n}" required>${n}</label>`).join('')}</div><span class="small muted">1 = Low · 5 = Excellent</span></label>`;
 res.send(layout('Training Feedback', `<div class="card"><div class="big">Training Feedback</div><p>Your feedback helps improve future student training.</p><form method="post" action="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">${rating('overall','Overall Training')}${rating('instructor','Instructor Effectiveness')}${rating('usefulness','Usefulness of the Material')}${rating('hands_on','Hands-On Activities')}${rating('difficulty','Difficulty Level / Pace')}<label>What was most helpful?<textarea name="most_helpful" rows="3"></textarea></label><label>What should be improved?<textarea name="improve" rows="3"></textarea></label><label>Other Comments<textarea name="comments" rows="3"></textarea></label><button>Submit Feedback</button></form></div>`));
});
app.post('/student/:id/feedback', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const nums=['overall','instructor','usefulness','hands_on','difficulty'].map(k=>Math.min(5,Math.max(1,Number(req.body[k])||1)));
 await pool.query(`INSERT INTO training_feedback(student_id,overall,instructor,usefulness,hands_on,difficulty,most_helpful,improve,comments,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(student_id) DO UPDATE SET overall=$2,instructor=$3,usefulness=$4,hands_on=$5,difficulty=$6,most_helpful=$7,improve=$8,comments=$9,submitted_at=now()`,[s.id,...nums,req.body.most_helpful||'',req.body.improve||'',req.body.comments||'']);
 res.send(layout('Thank You', `<div class="card center"><div class="big">Thank You</div><p>Your feedback has been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function pinForm(message=''){
 const warning=!INSTRUCTOR_PIN_CONFIGURED?'<div class="alert"><b>Owner setup required:</b> INSTRUCTOR_PIN is not yet set in Render. Set it before production use.</div>':'';
 return layout('Training Hub Login', `<div class="card" style="max-width:760px;margin:auto"><div class="eyebrow">SECURE ACCESS · THE TRAINING HUB 2.1.1</div><div class="big">Account Access</div>${warning}${message?`<div class="alert">${esc(message)}</div>`:''}<div class="grid" style="margin-top:18px"><div class="card" style="margin:0"><div class="big" style="font-size:20px">Platform Owner</div><p class="muted">Create companies, assign administrators and instructors, and manage the full platform.</p><form method="post" action="/instructor/login"><label>Owner PIN<input type="password" name="pin" autocomplete="current-password" required></label><button>Open Owner Console</button></form></div><div class="card" style="margin:0"><div class="big" style="font-size:20px">Company Account</div><p class="muted">Company admins, instructors, and managers sign in here.</p><form method="post" action="/instructor/staff-login"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Sign In</button></form></div></div><div class="toolbar" style="margin-top:16px"><a class="btn alt" href="/join">Student — Join Training</a></div><p class="small muted" style="margin-top:14px">Protected by signed sessions, login lockout, secure cookies, CSRF protection, company isolation, and security audit logging.</p></div>`);
}

app.get('/instructor',(req,res)=>{ const sess=sessionFromReq(req); if(sess){setSession(res,sess); if(!securityCookies(req)[CSRF_COOKIE])newCsrf(res); return res.redirect(accountHome(sess));} res.send(pinForm()); });
app.post('/instructor/login',async(req,res)=>{
 const st=loginState(req);
 if(st.locked){ await auditEvent(req,'OWNER_LOGIN_BLOCKED',`Lockout active (${st.seconds}s remaining)`,'blocked'); return res.status(429).send(pinForm(`Too many failed attempts. Try again in about ${Math.ceil(st.seconds/60)} minute(s).`)); }
 if(!safeEq(req.body.pin,INSTRUCTOR_PIN)){
  const state=registerLoginFailure(req); await auditEvent(req,'OWNER_LOGIN_FAILED',`Failed attempt ${state.count}/${LOGIN_MAX_FAILURES}`,'failed');
  const left=Math.max(0,LOGIN_MAX_FAILURES-state.count); return res.status(403).send(pinForm(left?`Incorrect owner PIN. ${left} attempt(s) remain before temporary lockout.`:'Too many failed attempts. Access is temporarily locked.'));
 }
 clearLoginFailures(req); const sess=setSession(res,null,{role:'owner',company_id:null,name:'Platform Owner',email:''}); newCsrf(res); await auditEvent(req,'OWNER_LOGIN_SUCCESS','Owner session created','ok'); res.redirect('/owner');
});
app.post('/instructor/staff-login',async(req,res)=>{
 const st=loginState(req);
 if(st.locked){ await auditEvent(req,'STAFF_LOGIN_BLOCKED',`Lockout active (${st.seconds}s remaining)`,'blocked'); return res.status(429).send(pinForm(`Too many failed attempts. Try again in about ${Math.ceil(st.seconds/60)} minute(s).`)); }
 const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
 const q=await pool.query(`SELECT u.*,c.active company_active,c.name company_name FROM app_users u JOIN companies c ON c.id=u.company_id WHERE lower(u.email)=lower($1) AND u.active=true ORDER BY u.id LIMIT 1`,[email]);
 const u=q.rows[0];
 if(!u||!u.company_active||!(await verifyPassword(password,u.password_salt,u.password_hash))){ const state=registerLoginFailure(req); await auditEvent(req,'STAFF_LOGIN_FAILED',`Account ${email||'(blank)'} failed attempt ${state.count}/${LOGIN_MAX_FAILURES}`,'failed'); const left=Math.max(0,LOGIN_MAX_FAILURES-state.count); return res.status(403).send(pinForm(left?`Email or password is incorrect. ${left} attempt(s) remain before temporary lockout.`:'Too many failed attempts. Access is temporarily locked.')); }
 clearLoginFailures(req); await pool.query('UPDATE app_users SET last_login_at=now() WHERE id=$1',[u.id]); setSession(res,null,{role:u.role,user_id:u.id,company_id:u.company_id,name:u.name,email:u.email}); newCsrf(res); await auditEvent(req,'STAFF_LOGIN_SUCCESS',`${u.email} · ${u.role}`,'ok'); res.redirect('/instructor/dashboard');
});
app.post('/instructor/logout',async(req,res)=>{ await auditEvent(req,'LOGOUT','Account logged out','ok'); clearSession(res); res.redirect('/instructor'); });

async function companyClassForId(id){ const q=await pool.query('SELECT id,company_id,course FROM classes WHERE id=$1',[Number(id)]); return q.rows[0]||null; }
async function resourceClassForInstructorPath(req){
 let m;
 m=req.path.match(/^\/instructor\/(?:class|builder|hunt)\/(\d+)/); if(m)return companyClassForId(m[1]);
 m=req.path.match(/^\/instructor\/videos\/(\d+)/); if(m)return companyClassForId(m[1]);
 m=req.path.match(/^\/instructor\/(?:simulations|master-challenges)\/[^/]+\/class\/(\d+)/); if(m)return companyClassForId(m[1]);
 m=req.path.match(/^\/instructor\/student\/(\d+)/); if(m){ const q=await pool.query('SELECT c.id,c.company_id,c.course FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1',[m[1]]); return q.rows[0]||null; }
 m=req.path.match(/^\/instructor\/simulation\/(\d+)/); if(m){ const q=await pool.query('SELECT c.id,c.company_id,c.course FROM simulation_attempts a JOIN classes c ON c.id=a.class_id WHERE a.id=$1',[m[1]]); return q.rows[0]||null; }
 m=req.path.match(/^\/instructor\/master-challenges\/attempt\/(\d+)/); if(m){ const q=await pool.query('SELECT c.id,c.company_id,c.course FROM master_challenge_attempts a JOIN classes c ON c.id=a.class_id WHERE a.id=$1',[m[1]]); return q.rows[0]||null; }
 return null;
}
async function authorizeCustomContentKey(req,sess){
 if(!sess?.company_id||sess.role==='owner')return true;
 let m=req.path.match(/^\/instructor\/simulations\/([^/]+)\/(edit|add-root|add-action|delete-custom|reset)$/);
 if(m){ const key=decodeURIComponent(m[1]); if(/^c\d+-/.test(key))return key.startsWith(`c${sess.company_id}-`); return false; }
 m=req.path.match(/^\/instructor\/master-challenges\/([^/]+)\/(edit|add-root|add-action)$/);
 if(m){ const key=decodeURIComponent(m[1]); if(/^c\d+-/.test(key))return key.startsWith(`c${sess.company_id}-`); return false; }
 return true;
}
async function auth(req,res,next){
 const sess=sessionFromReq(req); if(!sess){ clearSession(res); return res.status(403).send(pinForm('Login required or session expired.')); }
 req.instructorSession=setSession(res,sess); req.account=req.instructorSession;
 if(!securityCookies(req)[CSRF_COOKIE])newCsrf(res);
 if(sess.role==='owner'&&!sess.company_id && req.path!=='/instructor/security') return res.redirect('/owner');
 if(req.method==='POST'&&sess.role==='viewer')return res.status(403).send(layout('Read Only',`<div class="card"><div class="big">Read-only account</div><p>Your manager/viewer account can view training records but cannot change training content.</p><a class="btn" href="/instructor/dashboard">Return to Dashboard</a></div>`));
 if(!(await authorizeCustomContentKey(req,sess)))return res.status(403).send(layout('Company Protection',`<div class="card"><div class="big">This template is protected</div><p>Shared system templates cannot be edited directly by a company. Duplicate the template first to create a company-owned editable copy.</p><a class="btn" href="/instructor/dashboard">Return to Dashboard</a></div>`));
 let cls=await resourceClassForInstructorPath(req);
 if(!cls && req.method==='POST' && req.body?.class_id) cls=await companyClassForId(req.body.class_id);
 if(cls){
  if(Number(cls.company_id)!==Number(sess.company_id))return res.status(403).send(layout('Company Protection',`<div class="card"><div class="big">Access denied</div><p>This training record belongs to another company.</p><a class="btn" href="/instructor/dashboard">Return to Dashboard</a></div>`));
  if(!(await courseAllowedForSession(sess,cls.course,req.method!=='GET')))return res.status(403).send(layout('Course Permission',`<div class="card"><div class="big">Course access not assigned</div><p>Your account is not authorized to ${req.method==='GET'?'view':'edit'} this course.</p><a class="btn" href="/instructor/dashboard">Return to Dashboard</a></div>`));
 }
 next();
}


function ownerAuth(req,res,next){
 const sess=sessionFromReq(req); if(!sess||sess.role!=='owner'){ clearSession(res); return res.status(403).send(pinForm('Platform Owner access required.')); }
 req.account=setSession(res,sess); if(!securityCookies(req)[CSRF_COOKIE])newCsrf(res); next();
}
async function companyById(id){ const q=await pool.query('SELECT * FROM companies WHERE id=$1',[Number(id)]); return q.rows[0]||null; }
async function companyUserTable(companyId){
 const q=await pool.query(`SELECT u.*,coalesce(string_agg(p.course_name, ', ' ORDER BY p.course_name),'') course_list FROM app_users u LEFT JOIN user_course_permissions p ON p.user_id=u.id WHERE u.company_id=$1 GROUP BY u.id ORDER BY u.role,u.name`,[companyId]);
 return q.rows;
}
function companyUserRows(users){ return users.map(u=>`<tr><td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.email)}</span></td><td>${esc(roleLabel(u.role))}</td><td>${u.all_courses?'<span class="pill open">All Courses</span>':esc(u.course_list||'No courses assigned')}</td><td><span class="pill ${u.active?'open':'closed'}">${u.active?'Active':'Disabled'}</span></td><td class="nowrap"><a class="btn light" href="/owner/user/${u.id}/courses">Courses</a> <form method="post" action="/owner/user/${u.id}/toggle" style="display:inline"><button class="btn light">${u.active?'Disable':'Enable'}</button></form></td></tr>`).join(''); }

function ownerBaseUrl(req){
 const configured=String(process.env.APP_BASE_URL||'').trim().replace(/\/$/,'');
 return configured || `${req.protocol}://${req.get('host')}`;
}
function welcomeInstructionsText(baseUrl,companyName,email,password=''){
 const lines=[
  'Welcome to The Training Hub',
  '',
  `Company Login Page: ${baseUrl}`,
  'Login Type: Company Account',
  `Company: ${companyName}`,
  `Admin Email: ${email||'Not assigned yet'}`,
  `Temporary Password: ${password||'Use the temporary password supplied by the Platform Owner. If it is no longer available, ask the Platform Owner to reset it.'}`,
  '',
  'On the Training Hub login page, choose Company Account and sign in with the email and temporary password above.'
 ];
 return lines.join('\n');
}
async function loginInfoCard(req,c,admin,password=''){
 const base=ownerBaseUrl(req), email=admin?.email||'', text=welcomeInstructionsText(base,c.name,email,password);
 const qr=await QRCode.toDataURL(base,{width:320,margin:2,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#FFFFFF'}});
 const mailSubject=encodeURIComponent(`The Training Hub login information - ${c.name}`);
 const mailBody=encodeURIComponent(text);
 const mailHref=email?`mailto:${encodeURIComponent(email)}?subject=${mailSubject}&body=${mailBody}`:'#';
 const pwLine=password?`<div class="alert" style="margin-top:12px"><b>Temporary Password:</b> <span style="font-family:monospace;font-size:16px">${esc(password)}</span><br><span class="small">Copy this now. For security, it cannot be displayed again later.</span></div>`:`<div class="alert" style="margin-top:12px"><b>Temporary Password:</b> For security, saved passwords cannot be displayed. Reset the administrator password if a new temporary password is needed.</div>`;
 return `<div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">COMPANY ACCESS</div><div class="big">Company Login Information</div><div style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:24px;align-items:start;margin-top:14px"><div><div style="display:grid;grid-template-columns:180px 1fr;gap:8px 14px"><b>Company Login Page</b><span><a href="${esc(base)}" target="_blank" rel="noopener">${esc(base)}</a></span><b>Login Type</b><span>Company Account</span><b>Company</b><span>${esc(c.name)}</span><b>Admin Email</b><span>${email?esc(email):'<span class="muted">No Company Administrator assigned yet</span>'}</span></div>${pwLine}</div><div class="center" style="padding:14px;border:1px solid #ddd;border-radius:14px;background:#fff"><div class="eyebrow" style="margin-bottom:8px">SCAN TO LOG IN</div><img src="${qr}" alt="QR code for ${esc(c.name)} Training Hub login" style="width:190px;max-width:100%;height:auto;display:block;margin:0 auto"><div class="small muted" style="margin-top:8px">Scan with a phone or tablet to open the Company Account login page.</div></div></div><textarea id="welcome_${c.id}" style="position:absolute;left:-9999px">${esc(text)}</textarea><div class="toolbar" style="margin-top:14px"><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('welcome_${c.id}').value).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Welcome Instructions',1600)})">Copy Welcome Instructions</button>${email?`<a class="btn light" href="${mailHref}">Send Welcome Email</a>`:''}<a class="btn light" href="${esc(base)}" target="_blank" rel="noopener">Open Login Page</a></div>${!email?'<p class="small muted">Create a Company Administrator above to enable the welcome email button.</p>':''}</div>`;
}

app.get('/owner',ownerAuth,async(req,res)=>{
 const q=await pool.query(`SELECT c.*,count(distinct u.id)::int users,count(distinct cl.id)::int classes,count(distinct s.id)::int students FROM companies c LEFT JOIN app_users u ON u.company_id=c.id LEFT JOIN classes cl ON cl.company_id=c.id LEFT JOIN students s ON s.class_id=cl.id GROUP BY c.id ORDER BY c.created_at DESC`);
 const rows=q.rows.map(c=>`<tr><td><b>${esc(c.name)}</b><br><span class="small muted">${esc(c.slug)}</span></td><td>${c.users}</td><td>${c.classes}</td><td>${c.students}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Active':'Paused'}</span></td><td class="nowrap"><a class="btn light" href="/owner/company/${c.id}">Manage / Login Info</a> <form method="post" action="/owner/company/${c.id}/open" style="display:inline"><button>Open 1.0-Style Company Hub</button></form></td></tr>`).join('');
 res.send(layout('Owner Console',`<div class="hero"><div><div class="eyebrow">THE TRAINING HUB 2.1.97 · PLATFORM OWNER</div><h1>Multi-Company Owner Console</h1><p class="muted">Create companies, assign administrators and instructors, then open each company in the familiar Training Hub 1.0-style workspace.</p><div class="toolbar"><a class="btn light" href="/owner/backups">Google Drive Backup</a></div></div><form method="post" action="/instructor/logout"><button class="danger">Secure Logout</button></form></div><div class="grid"><div class="stat"><span>COMPANIES</span><b>${q.rowCount}</b></div><div class="stat"><span>ACTIVE</span><b>${q.rows.filter(x=>x.active).length}</b></div><div class="stat"><span>USERS</span><b>${q.rows.reduce((n,x)=>n+Number(x.users),0)}</b></div><div class="stat"><span>STUDENTS</span><b>${q.rows.reduce((n,x)=>n+Number(x.students),0)}</b></div></div><div class="grid"><div class="card"><div class="big">Create Company</div><form method="post" action="/owner/company/new"><label>Company Name<input name="name" required></label><label>Contact Email<input type="email" name="contact_email"></label><label>Phone<input name="contact_phone"></label><label>Website<input name="website_url"></label><button>Create Company</button></form></div><div class="card"><div class="big">Platform Design</div><p>Every company receives isolated classes, users, branding, courses, student records, and training content. The Owner Console manages companies; each company workspace keeps the familiar Training Hub interface.</p><div class="alert"><b>Roles:</b> Owner · Company Admin · Instructor · Viewer / Manager</div></div></div><div class="card"><div class="section-title"><h2>Companies</h2><span class="muted small">Each company is a separate tenant inside this one Training Hub.</span></div><div style="overflow:auto"><table><tr><th>Company</th><th>Users</th><th>Classes</th><th>Students</th><th>Status</th><th>Actions</th></tr>${rows||'<tr><td colspan="6">No companies yet.</td></tr>'}</table></div></div>`));
});
app.post('/owner/company/new',ownerAuth,async(req,res)=>{
 const name=String(req.body.name||'').trim(); if(!name)return res.status(400).send('Company name required'); const slug=await uniqueCompanySlug(name);
 const q=await pool.query(`INSERT INTO companies(name,slug,contact_email,contact_phone,website_url) VALUES($1,$2,$3,$4,$5) RETURNING *`,[name,slug,String(req.body.contact_email||'').trim(),String(req.body.contact_phone||'').trim(),String(req.body.website_url||'').trim()]); await seedCompanyDefaults(q.rows[0].id); await auditEvent(req,'COMPANY_CREATED',`${name} (#${q.rows[0].id})`,'ok'); res.redirect(`/owner/company/${q.rows[0].id}`);
});

app.get('/owner/backups',ownerAuth,async(req,res)=>{
 const configured=googleDriveBackupConfigured();
 // Any 'running' row not owned by this process is stale (usually left by an earlier restart).
 if(googleDriveBackupRunning&&googleDriveCurrentRunId){
  await pool.query(`UPDATE backup_runs SET status='interrupted',error_message='Backup interrupted by service restart.',completed_at=COALESCE(completed_at,now()) WHERE status='running' AND id<>$1`,[googleDriveCurrentRunId]);
 }else{
  await pool.query(`UPDATE backup_runs SET status='interrupted',error_message='Backup interrupted by service restart.',completed_at=COALESCE(completed_at,now()) WHERE status='running'`);
 }
 const prefs=await backupPreferences();
 const status=!configured?'Not Configured':prefs.enabled?'Automatic Backup ON':'Automatic Backup OFF';
 const runs=(await pool.query(`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 60`)).rows;
 const rows=runs.map(x=>{
  const startedIso=x.started_at?new Date(x.started_at).toISOString():'';
  const statusClass=x.status==='success'?'open':['failed','interrupted','cancelled'].includes(x.status)?'closed':'';
  const recordDelete=`<form method="post" action="/owner/backups/${x.id}/delete-record" style="display:inline" onsubmit="return confirm('Delete this backup history record? This does not delete a Google Drive file.');"><button class="danger" type="submit">Delete Record</button></form>`;
  const fileDelete=x.drive_file_id?` <form method="post" action="/owner/backups/${x.id}/delete-file" style="display:inline" onsubmit="return confirm('Delete this backup file from Google Drive AND remove its history record? This cannot be undone.');"><button class="danger" type="submit">Delete File + Record</button></form>`:'';
  return `<tr><td><span class="backup-local-time" data-utc="${esc(startedIso)}">${startedIso?esc(startedIso):'—'}</span></td><td>${esc(x.trigger_type)}</td><td><span class="pill ${statusClass}">${esc(x.status)}</span></td><td>${x.drive_file_name?esc(x.drive_file_name):'—'}</td><td>${x.file_size?Math.max(1,Math.round(Number(x.file_size)/1024/1024))+' MB':'—'}</td><td>${x.error_message?esc(x.error_message):'—'}</td><td><div class="toolbar" style="gap:6px">${recordDelete}${fileDelete}</div></td></tr>`;
 }).join('');
 const lastSuccess=runs.find(x=>x.status==='success'&&x.completed_at);
 const nextMs=prefs.enabled?(lastSuccess?new Date(lastSuccess.completed_at).getTime()+prefs.hours*3600000:Date.now()+60000):0;
 const nextIso=nextMs?new Date(nextMs).toISOString():'';
 const testResult=String(req.query.test||'');
 const testMessage=testResult==='ok'?`<div class="alert" style="border-left-color:#267a3f"><b>Google Drive connection test passed.</b>${req.query.folder?` Target folder: ${esc(String(req.query.folder))}`:''}</div>`:testResult==='fail'?`<div class="alert"><b>Google Drive connection test failed.</b> ${esc(String(req.query.message||'Check the credentials and folder ID.'))}</div>`:'';
 const deleteResult=String(req.query.delete||'');
 const deleteMessage=deleteResult==='record'?`<div class="alert" style="border-left-color:#267a3f"><b>Backup history record deleted.</b></div>`:deleteResult==='file'?`<div class="alert" style="border-left-color:#267a3f"><b>Google Drive backup file and history record deleted.</b></div>`:deleteResult==='stale'?`<div class="alert" style="border-left-color:#267a3f"><b>Stale backup records cleared.</b></div>`:deleteResult==='fail'?`<div class="alert"><b>Backup deletion failed.</b> ${esc(String(req.query.message||'Please try again.'))}</div>`:'';
 const saved=String(req.query.saved||'')==='1'?`<div class="alert" style="border-left-color:#267a3f"><b>Automatic backup settings saved.</b></div>`:'';
 const cancelMsg=String(req.query.cancel||'')==='1'?`<div class="alert" style="border-left-color:#267a3f"><b>Cancel requested.</b> The current backup will stop as soon as the active database or upload step can safely end.</div>`:'';
 const localTimeScript=`<script>(function(){function fmt(el){var raw=el.getAttribute('data-utc');if(!raw)return;var d=new Date(raw);if(Number.isNaN(d.getTime()))return;el.textContent=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(d);el.title='Stored as UTC: '+raw;}document.querySelectorAll('.backup-local-time').forEach(fmt);})();</script>`;
 res.send(layout('Google Drive Backup Control',`<div class="toolbar"><a class="btn light" href="/owner">← Owner Console</a></div><div class="hero"><div><div class="eyebrow">OWNER TOOLS · 2.1.98</div><h1>Google Drive Backup Control</h1><p class="muted">You control when backups run. Automatic backup defaults OFF and can be changed here without touching Render.</p></div><span class="pill ${configured?'open':'closed'}">${status}</span></div>${testMessage}${deleteMessage}${saved}${cancelMsg}<div class="grid"><div class="card"><div class="big">Connection & Manual Controls</div><p><b>Google Drive credentials:</b> ${configured?'Configured':'Incomplete'}<br><b>Authentication:</b> ${esc(googleDriveAuthMode())}<br><b>Current job:</b> ${googleDriveBackupRunning?'Running':'Idle'}</p>${configured?`<div class="toolbar"><form method="post" action="/owner/backups/test"><button class="light" type="submit">Test Google Drive Connection</button></form><form method="post" action="/owner/backups/run" onsubmit="return confirm('Run a full Training Hub backup to Google Drive now?');"><button ${googleDriveBackupRunning?'disabled':''}>${googleDriveBackupRunning?'Backup Running…':'Run Backup Now'}</button></form>${googleDriveBackupRunning?`<form method="post" action="/owner/backups/cancel" onsubmit="return confirm('Cancel the running backup?');"><button class="danger" type="submit">Cancel Running Backup</button></form>`:''}</div>`:'<div class="alert"><b>Setup required:</b> Add the Google Drive environment variables in Render, then redeploy.</div>'}</div><div class="card"><div class="big">Automatic Backup Schedule</div><form method="post" action="/owner/backups/settings"><label><input type="checkbox" name="enabled" value="1" style="width:auto" ${prefs.enabled?'checked':''}> Automatic Backup ON</label><label>Backup Interval<select name="interval_preset" id="backup_interval_preset" onchange="document.getElementById('backup_custom_hours').disabled=this.value!=='custom'"><option value="6" ${prefs.hours===6?'selected':''}>Every 6 Hours</option><option value="12" ${prefs.hours===12?'selected':''}>Every 12 Hours</option><option value="24" ${prefs.hours===24?'selected':''}>Every 24 Hours</option><option value="72" ${prefs.hours===72?'selected':''}>Every 3 Days</option><option value="168" ${prefs.hours===168?'selected':''}>Every 7 Days</option><option value="custom" ${![6,12,24,72,168].includes(prefs.hours)?'selected':''}>Custom Interval</option></select></label><label>Custom interval (hours)<input id="backup_custom_hours" type="number" min="1" max="720" name="custom_hours" value="${prefs.hours}" ${[6,12,24,72,168].includes(prefs.hours)?'disabled':''}><span class="small muted">Use 1–720 hours. This field is used only when Custom Interval is selected.</span></label><label>Keep Google Drive backups for<input type="number" min="1" max="365" name="retention" value="${prefs.retention}"> days</label><button type="submit">Save Backup Settings</button></form><p class="small muted"><b>Last successful backup:</b> ${lastSuccess?`<span class="backup-local-time" data-utc="${new Date(lastSuccess.completed_at).toISOString()}">${new Date(lastSuccess.completed_at).toISOString()}</span>`:'None yet'}<br><b>Next scheduled backup:</b> ${prefs.enabled?`<span class="backup-local-time" data-utc="${nextIso}">${nextIso}</span>`:'Automatic backup is OFF'}<br><b>Interval:</b> ${backupIntervalLabel(prefs.hours)}</p></div></div><div class="card"><div class="section-title"><div><div class="big">Recent Backup History</div><div class="small muted">Orphaned jobs are marked Interrupted after a service restart. No-file entries can be cleared safely.</div></div><div class="toolbar"><form method="post" action="/owner/backups/clear-stale" onsubmit="return confirm('Clear failed, cancelled, and interrupted backup records that do not have a Google Drive file?');"><button class="danger" type="submit">Clear Stale Backups</button></form><form method="post" action="/owner/backups/clear-failed" onsubmit="return confirm('Clear all failed backup entries from history?');"><button class="danger" type="submit">Clear Failed Backups</button></form></div></div><div style="overflow:auto"><table><tr><th>Started</th><th>Type</th><th>Status</th><th>Drive File</th><th>Size</th><th>Error</th><th>Actions</th></tr>${rows||'<tr><td colspan="7">No backups have run yet.</td></tr>'}</table></div></div>${localTimeScript}`));
});

app.post('/owner/backups/test',ownerAuth,async(req,res)=>{
 const result=await testGoogleDriveConnection();
 if(result.ok){
  await auditEvent(req,'GOOGLE_DRIVE_CONNECTION_TEST','Google Drive connection test passed','ok');
  return res.redirect('/owner/backups?test=ok&folder='+encodeURIComponent(result.name));
 }
 await auditEvent(req,'GOOGLE_DRIVE_CONNECTION_TEST',String(result.error||'Connection test failed'),'failed');
 res.redirect('/owner/backups?test=fail&message='+encodeURIComponent(String(result.error||'Connection test failed')));
});

app.post('/owner/backups/settings',ownerAuth,async(req,res)=>{
 const enabled=req.body.enabled==='1';
 const preset=String(req.body.interval_preset||'24');
 let hours=preset==='custom'?Number(req.body.custom_hours):Number(preset);
 if(!Number.isFinite(hours))hours=24;
 hours=Math.max(1,Math.min(720,Math.round(hours)));
 const retention=Math.max(1,Math.min(365,Number(req.body.retention)||30));
 await saveBackupPreference(BACKUP_SETTING_AUTO,enabled?'true':'false');
 await saveBackupPreference(BACKUP_SETTING_INTERVAL,String(hours));
 await saveBackupPreference(BACKUP_SETTING_RETENTION,String(retention));
 await auditEvent(req,'BACKUP_SETTINGS_UPDATED',`Automatic backup ${enabled?'ON':'OFF'} · ${backupIntervalLabel(hours)} · retention ${retention} days`,'ok');
 res.redirect('/owner/backups?saved=1');
});
app.post('/owner/backups/cancel',ownerAuth,async(req,res)=>{
 if(googleDriveBackupRunning){
  googleDriveBackupCancelRequested=true;
  try{googleDriveBackupAbortController?.abort();}catch(_e){}
  await auditEvent(req,'BACKUP_CANCEL_REQUESTED',`Owner requested cancellation${googleDriveCurrentRunId?` for backup #${googleDriveCurrentRunId}`:''}`,'ok');
 }
 res.redirect('/owner/backups?cancel=1');
});
app.post('/owner/backups/clear-stale',ownerAuth,async(req,res)=>{
 const q=await pool.query(`DELETE FROM backup_runs WHERE status IN ('failed','cancelled','interrupted') AND COALESCE(drive_file_id,'')='' RETURNING id`);
 await auditEvent(req,'STALE_BACKUPS_CLEARED',`Removed ${q.rowCount} stale backup history entr${q.rowCount===1?'y':'ies'}`,'ok');
 res.redirect('/owner/backups?delete=stale');
});

app.post('/owner/backups/clear-failed',ownerAuth,async(req,res)=>{
 const q=await pool.query(`DELETE FROM backup_runs WHERE status='failed' RETURNING id`);
 await auditEvent(req,'BACKUP_HISTORY_CLEARED',`Removed ${q.rowCount} failed backup history entr${q.rowCount===1?'y':'ies'}`,'ok');
 res.redirect('/owner/backups');
});
app.post('/owner/backups/:id/delete-record',ownerAuth,async(req,res)=>{
 const id=Number(req.params.id);
 if(Number.isInteger(id)&&id>0){
  const q=await pool.query(`DELETE FROM backup_runs WHERE id=$1 RETURNING id,drive_file_name`,[id]);
  if(q.rowCount)await auditEvent(req,'BACKUP_HISTORY_ENTRY_DELETED',`Removed backup history entry #${id}${q.rows[0].drive_file_name?` (${q.rows[0].drive_file_name})`:''}`,'ok');
 }
 res.redirect('/owner/backups?delete=record');
});
app.post('/owner/backups/:id/delete-file',ownerAuth,async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isInteger(id)||id<=0)return res.redirect('/owner/backups?delete=fail&message='+encodeURIComponent('Invalid backup record.'));
 const q=await pool.query(`SELECT * FROM backup_runs WHERE id=$1`,[id]);
 if(!q.rowCount)return res.redirect('/owner/backups?delete=fail&message='+encodeURIComponent('Backup record not found.'));
 const row=q.rows[0];
 if(!row.drive_file_id)return res.redirect('/owner/backups?delete=fail&message='+encodeURIComponent('This history record does not have a Google Drive file attached.'));
 try{
  const token=await googleDriveAccessToken();
  const dr=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.drive_file_id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
  if(!dr.ok&&dr.status!==404)throw new Error(`Google Drive delete failed: ${dr.status} ${await dr.text()}`);
  await pool.query(`DELETE FROM backup_runs WHERE id=$1`,[id]);
  await auditEvent(req,'BACKUP_FILE_DELETED',`Deleted Google Drive backup and history entry #${id}${row.drive_file_name?` (${row.drive_file_name})`:''}`,'ok');
  return res.redirect('/owner/backups?delete=file');
 }catch(e){
  await auditEvent(req,'BACKUP_FILE_DELETE_FAILED',String(e.message||e),'failed');
  return res.redirect('/owner/backups?delete=fail&message='+encodeURIComponent(String(e.message||e)));
 }
});
// Backward-compatible route from older masters: failed-entry delete now removes the history record only.
app.post('/owner/backups/:id/delete',ownerAuth,async(req,res)=>{
 const id=Number(req.params.id);
 if(Number.isInteger(id)&&id>0)await pool.query(`DELETE FROM backup_runs WHERE id=$1 RETURNING id`,[id]);
 res.redirect('/owner/backups?delete=record');
});

app.post('/owner/backups/run',ownerAuth,async(req,res)=>{
 if(!googleDriveBackupConfigured())return res.status(400).send(layout('Backup Not Configured','<div class="card"><div class="big">Google Drive backup is not configured.</div><p>Add the required Render environment variables first.</p><a class="btn" href="/owner/backups">Back</a></div>'));
 if(googleDriveBackupRunning)return res.redirect('/owner/backups');
 runGoogleDriveBackup('manual').catch(e=>console.error('Manual backup:',e));
 await auditEvent(req,'BACKUP_STARTED','Manual Google Drive backup started','ok');
 res.redirect('/owner/backups');
});

app.get('/owner/company/:id',ownerAuth,async(req,res)=>{
 const c=await companyById(req.params.id); if(!c)return res.status(404).send('Company not found'); await seedCompanyDefaults(c.id); const users=await companyUserTable(c.id); const courses=(await pool.query('SELECT * FROM company_courses WHERE company_id=$1 ORDER BY active DESC,name',[c.id])).rows; const primaryAdmin=users.find(u=>u.role==='company_admin'&&u.active)||users.find(u=>u.role==='company_admin')||null; const loginCard=await loginInfoCard(req,c,primaryAdmin);
 res.send(layout('Manage Company',`<div class="toolbar"><a class="btn light" href="/owner">← Owner Console</a><form method="post" action="/owner/company/${c.id}/open"><button>Open 1.0-Style Company Hub</button></form></div><div class="hero"><div><div class="eyebrow">COMPANY TENANT #${c.id}</div><h1>${esc(c.name)}</h1><p class="muted">${esc(c.contact_email||'')} ${c.website_url?`· ${esc(c.website_url)}`:''}</p></div><span class="pill ${c.active?'open':'closed'}">${c.active?'ACTIVE':'PAUSED'}</span></div><div class="grid"><div class="card"><div class="big">Add Company Administrator</div><form method="post" action="/owner/company/${c.id}/user"><input type="hidden" name="role" value="company_admin"><label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Temporary Password<input type="password" name="password" minlength="8" required></label><button>Add Company Admin</button></form></div><div class="card"><div class="big">Company Status</div><p>Pausing a company prevents its staff from signing in while preserving all training records.</p><form method="post" action="/owner/company/${c.id}/toggle"><button class="${c.active?'danger':'alt'}">${c.active?'Pause Company':'Reactivate Company'}</button></form><div style="margin-top:24px;padding-top:18px;border-top:2px solid #eee"><div class="big" style="font-size:18px;color:#9b1118">Danger Zone</div><p class="small"><b>Permanent deletion cannot be undone.</b> This removes the company account and its company-specific users, classes, students, programs, tests, records, certificates, scavenger hunts, simulations, uploaded module files, and other training content.</p><form method="post" action="/owner/company/${c.id}/delete" onsubmit="return confirm('Permanently delete ${esc(c.name).replace(/'/g,"\\'")}? This cannot be undone.');"><label>Type <b>${esc(c.name)}</b> to confirm<input name="confirm_name" autocomplete="off" required placeholder="${esc(c.name)}"></label><button class="danger" type="submit">Delete Company Permanently</button></form></div></div></div>${loginCard}<div class="card"><div class="big">Users & Permissions</div><div style="overflow:auto"><table><tr><th>User</th><th>Role</th><th>Course Access</th><th>Status</th><th>Actions</th></tr>${companyUserRows(users)||'<tr><td colspan="5">No users yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Course Catalog</div><p class="muted">Company admins can add and archive courses from their own Company & Content Editor.</p><div>${courses.map(x=>`<span class="pill ${x.active?'open':'closed'}" style="margin:4px">${esc(x.name)}</span>`).join('')}</div></div>`));
});
app.post('/owner/company/:id/toggle',ownerAuth,async(req,res)=>{ await pool.query('UPDATE companies SET active=NOT active WHERE id=$1',[req.params.id]); await auditEvent(req,'COMPANY_STATUS_CHANGED',`Company #${req.params.id}`,'ok'); res.redirect(`/owner/company/${req.params.id}`); });
app.post('/owner/company/:id/delete',ownerAuth,async(req,res)=>{
 const c=await companyById(req.params.id);
 if(!c)return res.status(404).send('Company not found');
 const typed=String(req.body.confirm_name||'').trim();
 if(typed!==String(c.name).trim()){
  await auditEvent(req,'COMPANY_DELETE_REJECTED',`Name confirmation did not match for ${c.name} (#${c.id})`,'failed');
  return res.status(400).send(layout('Delete Company',`<div class="card" style="max-width:760px;margin:auto;border-top:6px solid var(--red)"><div class="big">Company was not deleted</div><div class="alert">The confirmation name did not exactly match <b>${esc(c.name)}</b>.</div><a class="btn" href="/owner/company/${c.id}">Back to Company</a></div>`));
 }
 const client=await pool.connect();
 try{
  await auditEvent(req,'COMPANY_DELETE_CONFIRMED',`Permanent delete requested for ${c.name} (#${c.id})`,'ok');
  await client.query('BEGIN');
  const result=await client.query('DELETE FROM companies WHERE id=$1 RETURNING id,name',[c.id]);
  if(!result.rowCount)throw new Error('Company could not be deleted.');
  await client.query('COMMIT');
 }catch(e){
  try{await client.query('ROLLBACK');}catch(_e){}
  client.release();
  await auditEvent(req,'COMPANY_DELETE_FAILED',`${c.name} (#${c.id}) · ${e.message}`,'failed');
  return res.status(500).send(layout('Delete Company',`<div class="card" style="max-width:760px;margin:auto;border-top:6px solid var(--red)"><div class="big">Company could not be deleted</div><div class="alert">${esc(e.message)}</div><a class="btn" href="/owner/company/${c.id}">Back to Company</a></div>`));
 }
 client.release();
 const sess=sessionFromReq(req); setSession(res,sess,{company_id:null,name:'Platform Owner'});
 res.send(layout('Company Deleted',`<div class="card" style="max-width:760px;margin:auto;border-top:6px solid var(--red)"><div class="eyebrow">PLATFORM OWNER</div><div class="big">Company Deleted</div><p><b>${esc(c.name)}</b> and its company-specific training data were permanently deleted.</p><a class="btn" href="/owner">Return to Owner Console</a></div>`));
});
app.post('/owner/company/:id/open',ownerAuth,async(req,res)=>{ const c=await companyById(req.params.id); if(!c||!c.active)return res.status(404).send('Company unavailable'); const sess=sessionFromReq(req); setSession(res,sess,{company_id:c.id,name:'Platform Owner'}); await auditEvent(req,'OWNER_OPEN_COMPANY',`${c.name} (#${c.id})`,'ok'); res.redirect('/instructor/dashboard'); });
app.post('/owner/exit-company',ownerAuth,async(req,res)=>{ const sess=sessionFromReq(req); setSession(res,sess,{company_id:null,name:'Platform Owner'}); res.redirect('/owner'); });

async function createCompanyUser(companyId,body,allowedRoles=['company_admin','instructor','viewer']){
 const role=allowedRoles.includes(body.role)?body.role:allowedRoles[0], name=String(body.name||'').trim(), email=String(body.email||'').trim().toLowerCase(), password=String(body.password||'');
 if(!name||!email||password.length<8)throw new Error('Name, email, and a password of at least 8 characters are required.');
 const ph=await hashPassword(password); const q=await pool.query(`INSERT INTO app_users(company_id,name,email,role,password_salt,password_hash,all_courses) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING *`,[companyId,name,email,role,ph.salt,ph.hash]); return q.rows[0];
}
app.post('/owner/company/:id/user',ownerAuth,async(req,res)=>{ try{
 const companyId=Number(req.params.id), temporaryPassword=String(req.body.password||'');
 const c=await companyById(companyId); if(!c)return res.status(404).send('Company not found');
 const u=await createCompanyUser(companyId,req.body); await auditEvent(req,'USER_CREATED',`${u.email} · ${u.role} · company #${req.params.id}`,'ok');
 const loginCard=await loginInfoCard(req,c,u,temporaryPassword);
 res.send(layout('Company Administrator Created',`<div class="toolbar"><a class="btn light" href="/owner/company/${c.id}">← Back to ${esc(c.name)}</a><a class="btn light" href="/owner">Owner Console</a></div><div class="success"><b>Company Administrator created.</b> Copy or send the login information below before leaving this page.</div>${loginCard}`));
 }catch(e){res.status(400).send(layout('User Not Created',`<div class="card"><div class="big">Could not create user</div><div class="alert">${esc(e.message)}</div><a class="btn" href="/owner/company/${req.params.id}">Back</a></div>`));} });
app.post('/owner/user/:id/toggle',ownerAuth,async(req,res)=>{ const q=await pool.query('UPDATE app_users SET active=NOT active WHERE id=$1 RETURNING company_id,email,active',[req.params.id]); if(!q.rowCount)return res.status(404).send('User not found'); await auditEvent(req,'USER_STATUS_CHANGED',`${q.rows[0].email} · ${q.rows[0].active?'enabled':'disabled'}`,'ok'); res.redirect(`/owner/company/${q.rows[0].company_id}`); });
app.get('/owner/user/:id/courses',ownerAuth,async(req,res)=>{
 const u=(await pool.query(`SELECT u.*,c.name company_name FROM app_users u JOIN companies c ON c.id=u.company_id WHERE u.id=$1`,[req.params.id])).rows[0]; if(!u)return res.status(404).send('User not found'); const courses=(await pool.query('SELECT * FROM company_courses WHERE company_id=$1 AND active=true ORDER BY name',[u.company_id])).rows; const perms=new Map((await pool.query('SELECT * FROM user_course_permissions WHERE user_id=$1',[u.id])).rows.map(x=>[x.course_name,x]));
 res.send(layout('Course Permissions',`<div class="toolbar"><a class="btn light" href="/owner/company/${u.company_id}">← ${esc(u.company_name)}</a></div><div class="card"><div class="eyebrow">${esc(roleLabel(u.role))}</div><div class="big">${esc(u.name)} · Course Permissions</div><p class="muted">${esc(u.email)}</p><form method="post" action="/owner/user/${u.id}/courses"><label><input type="checkbox" name="all_courses" value="1" style="width:auto" ${u.all_courses?'checked':''}> Access all current and future company courses</label><div class="card"><div class="big" style="font-size:18px">Specific Courses</div>${courses.map(c=>{const x=perms.get(c.name);return `<div class="grid" style="grid-template-columns:2fr 1fr 1fr;align-items:center;border-bottom:1px solid #eee;padding:8px 0"><b>${esc(c.name)}</b><label style="margin:0"><input type="checkbox" style="width:auto" name="view_${c.id}" value="1" ${x?.can_view?'checked':''}> View / Run</label><label style="margin:0"><input type="checkbox" style="width:auto" name="edit_${c.id}" value="1" ${x?.can_edit?'checked':''}> Edit</label></div>`}).join('')}</div><button>Save Permissions</button></form></div>`));
});
app.post('/owner/user/:id/courses',ownerAuth,async(req,res)=>{ const u=(await pool.query('SELECT * FROM app_users WHERE id=$1',[req.params.id])).rows[0]; if(!u)return res.status(404).send('User not found'); const courses=(await pool.query('SELECT * FROM company_courses WHERE company_id=$1',[u.company_id])).rows; await pool.query('UPDATE app_users SET all_courses=$2 WHERE id=$1',[u.id,req.body.all_courses==='1']); await pool.query('DELETE FROM user_course_permissions WHERE user_id=$1',[u.id]); if(req.body.all_courses!=='1'){ for(const c of courses){ const view=req.body[`view_${c.id}`]==='1'||req.body[`edit_${c.id}`]==='1', edit=req.body[`edit_${c.id}`]==='1'; if(view)await pool.query('INSERT INTO user_course_permissions(user_id,course_name,can_view,can_edit) VALUES($1,$2,$3,$4)',[u.id,c.name,view,edit]); } } await auditEvent(req,'COURSE_PERMISSIONS_UPDATED',`User ${u.email}`,'ok'); res.redirect(`/owner/user/${u.id}/courses`); });
app.post('/owner/user/:id/password',ownerAuth,async(req,res)=>{ const password=String(req.body.password||''); if(password.length<8)return res.status(400).send('Password must be at least 8 characters'); const u=(await pool.query('SELECT * FROM app_users WHERE id=$1',[req.params.id])).rows[0]; if(!u)return res.status(404).send('User not found'); const ph=await hashPassword(password); await pool.query('UPDATE app_users SET password_salt=$2,password_hash=$3 WHERE id=$1',[u.id,ph.salt,ph.hash]); await auditEvent(req,'PASSWORD_RESET',`User ${u.email}`,'ok'); res.redirect(`/owner/company/${u.company_id}`); });


app.get('/owner/import-legacy',ownerAuth,async(req,res)=>{
 const companies=(await pool.query('SELECT id,name,active FROM companies ORDER BY name')).rows;
 const lp=legacySourcePool(); let preview=null,error='';
 if(lp){
  try{
   preview={classes:await legacyCount(lp,'classes'),courses:await legacyCount(lp,'course_catalog'),questions:await legacyCount(lp,'quiz_questions'),hunt:await legacyCount(lp,'hunt_stations'),videos:await legacyCount(lp,'training_videos'),videoQuestions:await legacyCount(lp,'video_questions'),simulations:await legacyCount(lp,'simulation_content_overrides'),challenges:await legacyCount(lp,'master_challenge_content'),students:await legacyCount(lp,'students')};
  }catch(e){error=e.message;}
 }
 const fp=legacyFingerprint(); const prior=fp?(await pool.query(`SELECT r.*,c.name company_name FROM legacy_import_runs r JOIN companies c ON c.id=r.company_id WHERE r.source_fingerprint=$1 ORDER BY r.imported_at DESC LIMIT 10`,[fp])).rows:[];
 const companyOptions=companies.map(c=>`<option value="${c.id}">${esc(c.name)}${c.active?'':' (Paused)'}</option>`).join('');
 const priorRows=prior.map(r=>`<tr><td>${new Date(r.imported_at).toLocaleString()}</td><td>${esc(r.company_name)}</td><td>${esc(JSON.stringify(r.summary||{}))}</td></tr>`).join('');
 res.send(layout('Import 5.8.1 Content',`<div class="toolbar"><a class="btn light" href="/owner">← Owner Console</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">THE TRAINING HUB 2.1</div><div class="big">Import Existing 5.8.1 Training Content</div><p>This is a read-only migration from your old Training Hub database into one 2.0 company. The old database is never changed.</p>${!lp?'<div class="alert"><b>Setup required:</b> Add <code>LEGACY_DATABASE_URL</code> to this 2.0 Render service using the <b>Internal Database URL</b> from the old 5.8.1 PostgreSQL database.</div>':error?`<div class="alert"><b>Legacy database connection failed:</b> ${esc(error)}</div>`:'<div class="success"><b>Legacy database connected.</b> Ready to preview and import.</div>'}</div>${preview?`<div class="grid"><div class="stat"><span>CLASSES</span><b>${preview.classes}</b></div><div class="stat"><span>COURSES</span><b>${preview.courses}</b></div><div class="stat"><span>QUIZ QUESTIONS</span><b>${preview.questions}</b></div><div class="stat"><span>HUNT STATIONS</span><b>${preview.hunt}</b></div><div class="stat"><span>VIDEOS</span><b>${preview.videos}</b></div><div class="stat"><span>VIDEO QUESTIONS</span><b>${preview.videoQuestions}</b></div><div class="stat"><span>CUSTOM SIMULATIONS</span><b>${preview.simulations}</b></div><div class="stat"><span>MASTER CHALLENGES</span><b>${preview.challenges}</b></div><div class="stat"><span>OLD STUDENTS</span><b>${preview.students}</b></div></div><div class="card"><div class="big">Choose Destination Company</div><form method="post" action="/owner/import-legacy"><label>Import Into Company<select name="company_id" required><option value="">Choose company</option>${companyOptions}</select></label><label><input type="checkbox" name="branding" value="1" style="width:auto"> Also import legacy site/certificate settings into this company's branding settings</label><label><input type="checkbox" name="confirm" value="yes" style="width:auto" required> I understand imported classes will be created as <b>closed</b> copies so no old join code becomes active accidentally.</label>${prior.length?'<label><input type="checkbox" name="allow_duplicate" value="yes" style="width:auto"> This source has been imported before. Allow another import anyway.</label>':''}<button>Import Training Content</button></form><div class="alert" style="margin-top:14px"><b>Videos:</b> video records, timed questions, and trigger times are imported. The physical MP4 files must still be copied from the old GitHub <code>public/videos</code> folder into the 2.0 repository <code>public/videos</code> folder.</div><p class="muted small">Student history is intentionally not imported by this content-migration tool. Your old 5.8.1 database remains available as the permanent historical record.</p></div>`:''}${companies.length?`<div class="card" style="border-top:6px solid #171717"><div class="eyebrow">DATABASE-ALTERNATIVE RESTORE</div><div class="big">Restore 5.8.1 Built-In Content Pack</div><p>The older Hub stored substantial training content in the application code rather than PostgreSQL rows. Use this when the legacy database preview shows zeros.</p><form method="post" action="/owner/restore-58-pack"><label>Restore Into Company<select name="company_id" required><option value="">Choose company</option>${companyOptions}</select></label><label><input type="checkbox" name="confirm_pack" value="yes" style="width:auto" required> Restore the known 5.8.1 built-in quiz, hunt, simulation, Master Challenge, and interactive-video question packs into this company.</label><button>Restore 5.8.1 Built-In Content</button></form><div class="alert" style="margin-top:14px"><b>Safe restore:</b> creates closed template classes and company-namespaced diagnostic content. It does not activate old join codes or modify the old database.</div></div>`:''}${prior.length?`<div class="card"><div class="big">Previous Imports From This Source</div><div style="overflow:auto"><table><tr><th>Date</th><th>Company</th><th>Summary</th></tr>${priorRows}</table></div></div>`:''}`));
});


app.post('/owner/restore-58-pack',ownerAuth,async(req,res)=>{
 const companyId=Number(req.body.company_id)||0, company=await companyById(companyId); if(!company)return res.status(404).send('Company not found');
 if(req.body.confirm_pack!=='yes')return res.status(400).send('Restore confirmation required.');
 const dest=await pool.connect();
 const summary={courses:0,template_classes:0,quiz_questions:0,hunt_library_items:0,videos:0,video_questions:0,simulations:0,master_challenges:0};
 try{
  await dest.query('BEGIN');
  const packCourses=['4600 Service Training','5100 Refresh Introduction','6000 HCE Training','5.8 Diagnostic & Scavenger Hunt Library'];
  for(const name of packCourses){await dest.query(`INSERT INTO company_courses(company_id,name,active) VALUES($1,$2,true) ON CONFLICT(company_id,name) DO UPDATE SET active=true`,[companyId,name]);summary.courses++;}
  // Company-specific legacy simulations are namespaced so they never appear in another company.
  for(const [oldKey,sim0] of Object.entries(LEGACY58_DIAGNOSTIC_SIMULATIONS)){
   const key=`c${companyId}-legacy58-${oldKey}`; const sim=JSON.parse(JSON.stringify(sim0)); sim.key=key;
   await dest.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=EXCLUDED.content_json,updated_at=now()`,[key,JSON.stringify(sim)]);
   SIMULATION_OVERRIDE_CACHE[key]=sim; summary.simulations++;
  }
  const masterKey=`c${companyId}-legacy58-${LEGACY58_DEFAULT_MASTER_CHALLENGE.key}`; const master=JSON.parse(JSON.stringify(LEGACY58_DEFAULT_MASTER_CHALLENGE)); master.key=masterKey;
  await dest.query(`INSERT INTO master_challenge_content(challenge_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(challenge_key) DO UPDATE SET content_json=EXCLUDED.content_json,updated_at=now()`,[masterKey,JSON.stringify(master)]);
  MASTER_CHALLENGE_CACHE[masterKey]=master; summary.master_challenges++;
  async function makeTemplate(title,course){
   const exists=await dest.query(`SELECT id FROM classes WHERE company_id=$1 AND title=$2 AND course=$3 ORDER BY id DESC LIMIT 1`,[companyId,title,course]);
   if(exists.rowCount)return exists.rows[0].id;
   const code=await nextImportClassCode(dest), token=crypto.randomBytes(16).toString('hex');
   const q=await dest.query(`INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,created_at,active,company_id,created_by_user_id,hunt_tractor_count,hunt_items_per_tractor,hunt_type,show_live_scores,student_feedback) VALUES($1,$2,$3,$4,80,8,$5,now(),false,$6,NULL,3,5,'general',false,true) RETURNING id`,[code,title,course,'5.8.1 Content Pack',token,companyId]);
   summary.template_classes++; return q.rows[0].id;
  }
  const templateByVideoKey={
   '4600':await makeTemplate('5.8.1 Template · 4600 Service Training','4600 Service Training'),
   '5100':await makeTemplate('5.8.1 Template · 5100 Refresh Introduction','5100 Refresh Introduction'),
   '6000':await makeTemplate('5.8.1 Template · 6000 HCE Training','6000 HCE Training')
  };
  // Restore default quiz bank to each model template.
  for(const cid of Object.values(templateByVideoKey)){
   const qcount=Number((await dest.query('SELECT count(*)::int n FROM quiz_questions WHERE class_id=$1',[cid])).rows[0].n||0);
   if(!qcount)for(const x of LEGACY58_DEFAULT_QUIZ){await dest.query(`INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[cid,x[0],JSON.stringify(x[1]),x[2],'Restored from the Training Hub 5.8.1 built-in quiz bank.','5.8.1 Diagnostics']);summary.quiz_questions++;}
  }
  // Restore the three 5.8.1 video/question packs.
  for(const [vkey,defs] of Object.entries(LEGACY58_EMBEDDED_VIDEO_CATALOG)){
   const cid=templateByVideoKey[vkey]; if(!cid)continue;
   for(const def of defs){
    let v=(await dest.query(`SELECT id FROM training_videos WHERE class_id=$1 AND source_url=$2 LIMIT 1`,[cid,def.source_url])).rows[0];
    if(!v){v=(await dest.query(`INSERT INTO training_videos(class_id,title,source_url,display_order,active) VALUES($1,$2,$3,$4,true) RETURNING id`,[cid,def.title,def.source_url,Number(def.display_order)||10])).rows[0];summary.videos++;}
    const existing=Number((await dest.query('SELECT count(*)::int n FROM video_questions WHERE video_id=$1',[v.id])).rows[0].n||0);
    if(!existing)for(const x of def.questions||[]){await dest.query(`INSERT INTO video_questions(video_id,timestamp_seconds,question,choices,answer_index,explanation,require_correct,parts_cannon_penalty) VALUES($1,$2,$3,$4::jsonb,$5,$6,true,$7)`,[v.id,Number(x.time)||0,x.question,JSON.stringify(x.choices||[]),Number(x.answer)||0,x.explanation||'',Number(x.penalty)||0]);summary.video_questions++;}
   }
  }
  // Restore the old scavenger-hunt item library into a closed reference/template class.
  const huntClass=await makeTemplate('5.8.1 Template · Scavenger Hunt Library','5.8 Diagnostic & Scavenger Hunt Library');
  const hc=Number((await dest.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1',[huntClass])).rows[0].n||0);
  if(!hc){let n=0;for(const item of LEGACY58_HUNT_ITEM_LIBRARY){n++;await dest.query(`INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)`,[huntClass,item.label||item.id,item.task||'Locate and identify this item.',item.expected||'VERIFIED',Math.min(5,Math.max(1,((n-1)%5)+1)),'5.8.1 Library',item.label||item.id]);summary.hunt_library_items++;}}
  await dest.query('COMMIT'); await auditEvent(req,'LEGACY58_CONTENT_PACK_RESTORED',`${company.name} · ${JSON.stringify(summary)}`,'ok');
  res.send(layout('5.8.1 Content Restored',`<div class="card" style="border-top:6px solid #267a3f"><div class="eyebrow">THE TRAINING HUB 2.1</div><div class="big">5.8.1 Built-In Content Restored</div><p>The known 5.8.1 built-in training content was restored into <b>${esc(company.name)}</b> without changing the old database.</p><div class="grid">${Object.entries(summary).map(([k,v])=>`<div class="stat"><span>${esc(k.replaceAll('_',' ').toUpperCase())}</span><b>${v}</b></div>`).join('')}</div><div class="alert"><b>Videos:</b> the video records and exact timed questions are restored. Copy the three MP4 files from the old GitHub <code>public/videos</code> folder into the 2.0 repository <code>public/videos</code> folder.</div><div class="toolbar"><a class="btn" href="/owner/company/${companyId}">Manage ${esc(company.name)}</a><a class="btn light" href="/owner">Owner Console</a></div></div>`));
 }catch(e){try{await dest.query('ROLLBACK')}catch{} console.error('5.8.1 content-pack restore failed:',e); await auditEvent(req,'LEGACY58_PACK_RESTORE_FAILED',e.message,'error'); res.status(500).send(layout('Restore Failed',`<div class="card"><div class="big">Restore stopped safely.</div><div class="alert">${esc(e.message)}</div><a class="btn" href="/owner/import-legacy">Back</a></div>`));}
 finally{dest.release();}
});

app.post('/owner/import-legacy',ownerAuth,async(req,res)=>{
 const lp=legacySourcePool(); if(!lp)return res.status(400).send(layout('Import Not Configured','<div class="card"><div class="big">LEGACY_DATABASE_URL is not configured.</div><a class="btn" href="/owner/import-legacy">Back</a></div>'));
 const companyId=Number(req.body.company_id)||0, company=await companyById(companyId); if(!company)return res.status(404).send('Company not found'); if(req.body.confirm!=='yes')return res.status(400).send('Import confirmation required.');
 const fp=legacyFingerprint(); const previous=await pool.query('SELECT 1 FROM legacy_import_runs WHERE company_id=$1 AND source_fingerprint=$2 LIMIT 1',[companyId,fp]); if(previous.rowCount&&req.body.allow_duplicate!=='yes')return res.status(409).send(layout('Already Imported',`<div class="card"><div class="big">This 5.8.1 database has already been imported into ${esc(company.name)}.</div><p>Return to the importer and check the duplicate-import confirmation only if you intentionally want another copy.</p><a class="btn" href="/owner/import-legacy">Back</a></div>`));
 let src; try{src=await lp.connect(); await src.query('SELECT 1');}catch(e){return res.status(500).send(layout('Legacy Connection Failed',`<div class="card"><div class="big">Could not connect to the old database.</div><div class="alert">${esc(e.message)}</div><a class="btn" href="/owner/import-legacy">Back</a></div>`));}
 const dest=await pool.connect(); const summary={courses:0,classes:0,quiz_questions:0,hunt_stations:0,videos:0,video_questions:0,simulations:0,master_challenges:0};
 try{
  await dest.query('BEGIN');
  // Course catalog
  if(await legacyTableExists(lp,'course_catalog')){const rows=(await src.query('SELECT * FROM course_catalog ORDER BY id')).rows;for(const r of rows){await dest.query(`INSERT INTO company_courses(company_id,name,active) VALUES($1,$2,$3) ON CONFLICT(company_id,name) DO UPDATE SET active=EXCLUDED.active`,[companyId,r.name,r.active!==false]);summary.courses++;}}
  // Optional branding/site settings
  if(req.body.branding==='1'&&await legacyTableExists(lp,'site_settings')){const rows=(await src.query('SELECT key,value FROM site_settings')).rows;for(const r of rows)await dest.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=EXCLUDED.value`,[companyId,r.key,String(r.value??'')]);}
  // Custom simulation definitions, namespaced to this company.
  const simMap=new Map();
  if(await legacyTableExists(lp,'simulation_content_overrides')){const rows=(await src.query('SELECT simulation_key,content_json FROM simulation_content_overrides')).rows;for(const r of rows){const nk=importKey(companyId,'sim',r.simulation_key), body=JSON.parse(JSON.stringify(r.content_json||{}));body.key=nk;await dest.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=EXCLUDED.content_json,updated_at=now()`,[nk,JSON.stringify(body)]);SIMULATION_OVERRIDE_CACHE[nk]=body;simMap.set(r.simulation_key,nk);summary.simulations++;}}
  const masterMap=new Map();
  if(await legacyTableExists(lp,'master_challenge_content')){const rows=(await src.query('SELECT challenge_key,content_json FROM master_challenge_content')).rows;for(const r of rows){const nk=importKey(companyId,'master',r.challenge_key), body=JSON.parse(JSON.stringify(r.content_json||{}));body.key=nk;await dest.query(`INSERT INTO master_challenge_content(challenge_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(challenge_key) DO UPDATE SET content_json=EXCLUDED.content_json,updated_at=now()`,[nk,JSON.stringify(body)]);MASTER_CHALLENGE_CACHE[nk]=body;masterMap.set(r.challenge_key,nk);summary.master_challenges++;}}
  const classMap=new Map(), videoMap=new Map();
  const classes=(await src.query('SELECT * FROM classes ORDER BY id')).rows;
  for(const c of classes){
   const newCode=await nextImportClassCode(dest), token=crypto.randomBytes(16).toString('hex');
   const q=await dest.query(`INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,created_at,active,company_id,created_by_user_id,hunt_tractor_count,hunt_items_per_tractor,hunt_type,show_live_scores,student_feedback) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,NULL,$10,$11,$12,$13,$14) RETURNING id`,[newCode,`Imported · ${c.title}`,c.course,c.instructor,Number(c.pass_score)||80,Number(c.hours)||0,token,c.created_at||new Date(),companyId,Number(c.hunt_tractor_count)||3,Number(c.hunt_items_per_tractor)||5,c.hunt_type||'general',!!c.show_live_scores,c.student_feedback!==false]);
   const newClassId=q.rows[0].id;classMap.set(c.id,newClassId);summary.classes++;
   await dest.query(`INSERT INTO company_courses(company_id,name,active) VALUES($1,$2,true) ON CONFLICT(company_id,name) DO NOTHING`,[companyId,c.course]);
   if(await legacyTableExists(lp,'quiz_questions')){const rows=(await src.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id])).rows;for(const r of rows){await dest.query(`INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[newClassId,r.question,JSON.stringify(r.choices),r.answer_index,r.explanation||'',r.topic||'']);summary.quiz_questions++;}}
   if(await legacyTableExists(lp,'hunt_tractors')){const rows=(await src.query('SELECT * FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[c.id])).rows;for(const r of rows)await dest.query(`INSERT INTO hunt_tractors(class_id,tractor_no,model) VALUES($1,$2,$3) ON CONFLICT(class_id,tractor_no) DO UPDATE SET model=EXCLUDED.model`,[newClassId,r.tractor_no,r.model||'']);}
   if(await legacyTableExists(lp,'hunt_stations')){const rows=(await src.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[c.id])).rows;for(const r of rows){await dest.query(`INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)`,[newClassId,r.station_name,r.task,r.expected,r.tractor_no??null,r.tractor_model||'',r.item_label||'']);summary.hunt_stations++;}}
   if(await legacyTableExists(lp,'training_videos')){const rows=(await src.query('SELECT * FROM training_videos WHERE class_id=$1 ORDER BY display_order,id',[c.id])).rows;for(const r of rows){const vq=await dest.query(`INSERT INTO training_videos(class_id,title,source_url,display_order,active,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[newClassId,r.title,r.source_url,Number(r.display_order)||0,r.active!==false,r.created_at||new Date()]);videoMap.set(r.id,vq.rows[0].id);summary.videos++;}}
   if(await legacyTableExists(lp,'simulation_assignments')){const rows=(await src.query('SELECT * FROM simulation_assignments WHERE class_id=$1 ORDER BY id',[c.id])).rows;for(const r of rows){const sk=simMap.get(r.simulation_key)||r.simulation_key;await dest.query(`INSERT INTO simulation_assignments(class_id,simulation_key,root_cause_key,enabled,configured_at,technician_limit,tractor_model,difficulty,pass_score,max_parts_penalties,prerequisite_hunt_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(class_id,simulation_key) DO UPDATE SET root_cause_key=EXCLUDED.root_cause_key,enabled=EXCLUDED.enabled,tractor_model=EXCLUDED.tractor_model,difficulty=EXCLUDED.difficulty,pass_score=EXCLUDED.pass_score,max_parts_penalties=EXCLUDED.max_parts_penalties,prerequisite_hunt_type=EXCLUDED.prerequisite_hunt_type`,[newClassId,sk,r.root_cause_key,r.enabled!==false,r.configured_at||new Date(),Number(r.technician_limit)||15,r.tractor_model||'',r.difficulty||'Intermediate',Number(r.pass_score)||80,Number(r.max_parts_penalties)||3,r.prerequisite_hunt_type||'none']);}}
   if(await legacyTableExists(lp,'master_challenge_releases')){const rows=(await src.query('SELECT * FROM master_challenge_releases WHERE class_id=$1 ORDER BY id',[c.id])).rows;for(const r of rows){const ck=masterMap.get(r.challenge_key)||r.challenge_key;await dest.query(`INSERT INTO master_challenge_releases(class_id,challenge_key,root_cause_key,tractor_model,enabled,pass_score,max_parts_penalties,target_minutes,released_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(class_id,challenge_key) DO UPDATE SET root_cause_key=EXCLUDED.root_cause_key,tractor_model=EXCLUDED.tractor_model,enabled=EXCLUDED.enabled,pass_score=EXCLUDED.pass_score,max_parts_penalties=EXCLUDED.max_parts_penalties,target_minutes=EXCLUDED.target_minutes`,[newClassId,ck,r.root_cause_key,r.tractor_model||'',r.enabled!==false,Number(r.pass_score)||85,Number(r.max_parts_penalties)||1,Number(r.target_minutes)||45,r.released_at||new Date()]);}}
  }
  if(await legacyTableExists(lp,'video_questions')){const rows=(await src.query('SELECT * FROM video_questions ORDER BY id')).rows;for(const r of rows){const nv=videoMap.get(r.video_id);if(!nv)continue;await dest.query(`INSERT INTO video_questions(video_id,timestamp_seconds,question,choices,answer_index,explanation,require_correct,parts_cannon_penalty) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,[nv,Number(r.timestamp_seconds)||0,r.question,JSON.stringify(r.choices),r.answer_index,r.explanation||'',r.require_correct!==false,Number(r.parts_cannon_penalty)||0]);summary.video_questions++;}}
  await dest.query(`INSERT INTO legacy_import_runs(company_id,source_fingerprint,summary) VALUES($1,$2,$3::jsonb)`,[companyId,fp,JSON.stringify(summary)]);
  await dest.query('COMMIT'); await auditEvent(req,'LEGACY_CONTENT_IMPORTED',`${company.name} · ${JSON.stringify(summary)}`,'ok');
  res.send(layout('Import Complete',`<div class="card" style="border-top:6px solid #267a3f"><div class="eyebrow">5.8.1 → 2.0 MIGRATION</div><div class="big">Import Complete</div><p>Training content was copied into <b>${esc(company.name)}</b>. The old database was not modified.</p><div class="grid">${Object.entries(summary).map(([k,v])=>`<div class="stat"><span>${esc(k.replaceAll('_',' ').toUpperCase())}</span><b>${v}</b></div>`).join('')}</div><div class="alert"><b>Next:</b> copy any MP4 files used by these videos from the old repository <code>public/videos</code> folder into the 2.0 repository <code>public/videos</code> folder, then redeploy.</div><div class="toolbar"><a class="btn" href="/owner/company/${companyId}">Manage ${esc(company.name)}</a><a class="btn light" href="/owner">Owner Console</a></div></div>`));
 }catch(e){try{await dest.query('ROLLBACK')}catch{} console.error('Legacy import failed:',e); await auditEvent(req,'LEGACY_IMPORT_FAILED',e.message,'error'); res.status(500).send(layout('Import Failed',`<div class="card"><div class="big">Import stopped safely.</div><div class="alert">${esc(e.message)}</div><p>No partial target-database changes were kept because the 2.0 import transaction was rolled back.</p><a class="btn" href="/owner/import-legacy">Back to Import</a></div>`));}
 finally{dest.release();src.release();}
});

app.get('/instructor/security',auth,async(req,res)=>{
 const sess=req.account; let logs;
 if(sess.role==='owner'&&!sess.company_id) logs=(await pool.query('SELECT event,detail,status,ip_hash,created_at FROM security_audit ORDER BY created_at DESC LIMIT 75')).rows;
 else logs=(await pool.query('SELECT event,detail,status,ip_hash,created_at FROM security_audit WHERE company_id=$1 ORDER BY created_at DESC LIMIT 75',[sess.company_id])).rows;
 const checks=[
  ['Owner PIN stored in Render',INSTRUCTOR_PIN_CONFIGURED,'Set INSTRUCTOR_PIN in Render Environment for platform-owner access'],
  ['Automatic session signing key',true,'Generated automatically each time the server starts — no separate SESSION_SECRET required'],
  ['HTTPS secure cookies',process.env.NODE_ENV==='production','NODE_ENV should be production on Render'],
  ['Signed account sessions',true,'Owner and company accounts are signed and time limited'],['CSRF form protection',true,'Active'],['Login lockout',true,'5 failures = 15-minute lockout'],
  ['Company isolation',true,'Server checks company ownership of class, student, and attempt records'],['Role permissions',true,'Owner · Company Admin · Instructor · Viewer'],
  ['Security headers',true,'CSP, HSTS, frame blocking, no-sniff'],['Audit logging',true,'Stored in PostgreSQL and company scoped']
 ];
 const rows=checks.map(x=>`<tr><td><b>${esc(x[0])}</b></td><td><span class="pill ${x[1]?'open':'closed'}">${x[1]?'PROTECTED':'ACTION NEEDED'}</span></td><td>${esc(x[2])}</td></tr>`).join('');
 const logrows=logs.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString()}</td><td><b>${esc(x.event)}</b></td><td>${esc(x.status)}</td><td>${esc(x.detail||'')}</td><td class="small">${esc(x.ip_hash||'')}</td></tr>`).join('');
 res.send(layout('Security Center',`<div class="toolbar"><a class="btn light" href="${sess.role==='owner'&&!sess.company_id?'/owner':'/instructor/dashboard'}">← ${sess.role==='owner'&&!sess.company_id?'Owner Console':'Instructor Home'}</a><form method="post" action="/instructor/logout" style="display:inline"><button class="danger">Secure Logout</button></form></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">THE TRAINING HUB 2.0 · MULTI-COMPANY SECURITY</div><div class="big">Security Center</div><p>Account sessions are signed, time-limited, company-scoped, and refreshed while you are actively using the Hub.</p><div class="grid"><div class="stat"><span>IDLE TIMEOUT</span><b>${Math.round(SESSION_IDLE_MS/60000)} min</b></div><div class="stat"><span>MAX SESSION</span><b>${Math.round(SESSION_MAX_MS/3600000)} hr</b></div><div class="stat"><span>LOGIN LOCKOUT</span><b>${LOGIN_MAX_FAILURES} tries</b></div><div class="stat green"><span>CSRF</span><b>ON</b></div></div></div><div class="card"><div class="big">Protection Status</div><div style="overflow:auto"><table><thead><tr><th>Protection</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div></div><div class="card"><div class="big">Recent Security Audit</div><p class="muted">IP addresses are stored as one-way fingerprints rather than plain addresses.</p><div style="overflow:auto"><table><thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Details</th><th>IP Fingerprint</th></tr></thead><tbody>${logrows||'<tr><td colspan="5">No security events recorded yet.</td></tr>'}</tbody></table></div></div>`));
});

app.use('/instructor',(req,res,next)=>{
 if(req.method!=='POST' || req.path==='/login' || req.path==='/logout')return next();
 const started=Date.now(); res.on('finish',()=>{ if(res.statusCode<500) auditEvent(req,'INSTRUCTOR_CHANGE',`${req.method} /instructor${req.path} · ${res.statusCode} · ${Date.now()-started}ms`,res.statusCode<400?'ok':'blocked'); }); next();
});

app.get('/instructor/dashboard',auth,async(req,res)=>{
 const sess=req.account, company=await companyById(sess.company_id); if(!company)return res.status(403).send('Company unavailable');
 const all=(await pool.query(`SELECT c.*,count(distinct s.id)::int students,count(r.id)::int results FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN results r ON r.student_id=s.id WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,[sess.company_id])).rows;
 const allowed=await allowedCourseSet(sess); const classes=allowed?all.filter(c=>allowed.has(c.course)):all;
 const rows=classes.slice(0,30).map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td><span class="pill">${esc(c.code)}</span></td><td>${esc(c.instructor||'Unassigned')}</td><td><b>${c.students}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'LIVE':'Closed'}</span></td><td class="nowrap"><a class="btn" href="/instructor/class/${c.id}">Open Live Class</a></td></tr>`).join('');
 const active=classes.filter(c=>c.active).length, students=classes.reduce((a,c)=>a+Number(c.students),0);
 const certCount=Number((await pool.query(`SELECT count(*)::int n FROM instructor_notes n JOIN students s ON s.id=n.student_id JOIN classes c ON c.id=s.class_id WHERE c.company_id=$1 AND n.certificate_no IS NOT NULL`,[sess.company_id])).rows[0].n||0);
 const canEdit=isEditorRole(sess.role), canAdmin=isCompanyAdminRole(sess.role);
 const ownerBar=sess.role==='owner'?`<form method="post" action="/owner/exit-company" style="display:inline"><button class="light">← Switch Company / Owner Console</button></form>`:'';
 const dashboardDefaults=[
  {id:'tests',title:'Tests',description:'Build and manage quiz questions.',icon:'📝',href:'/instructor/build-select',order:10},
  {id:'hunt',title:'Scavenger Hunt',description:'Choose equipment/stations, build hunt items, and print QR stations.',icon:'🔎',href:'/instructor/hunt-select',order:20},
  {id:'qrlabels',title:'QR Label Center',description:'View every scavenger-hunt QR label in one place, grouped by equipment model, and edit the matching hunt item.',icon:'🏷️',href:'/instructor/qr-labels',order:25},
  {id:'simulations',title:'Simulation Release Center',description:'Choose one class and equipment model, then release an entire 10-simulation segment from one screen.',icon:'🛠️',href:'/instructor/simulations/release-center',order:30},
  {id:'master',title:'Master Diagnostic Challenge',description:'Build, edit, release, and score final practical diagnostic certification challenges.',icon:'🧠',href:'/instructor/master-challenges',order:40},
  {id:'prepost',title:'Pre/Post Improvement',description:'Compare starting knowledge to final test performance by class, student, and topic.',icon:'📈',href:'/instructor/prepost',order:50},
  {id:'videos',title:'Interactive Videos',description:'Add company training videos with editable timed questions, scoring, and penalty logic.',icon:'🎬',href:'/instructor/videos',order:60},
  {id:'files',title:'Company Files',description:'Private file library for this company. Store manuals, PowerPoints, PDFs, forms, worksheets, and other training resources.',icon:'📁',href:'/instructor/company-files',order:65},
  {id:'reports',title:'Reports & Certificates',description:'Print records and certificates for completed students.',icon:'🏆',href:'/instructor/reports',order:70},
  {id:'performance',title:'Performance & Feedback',description:'Compare tests, activities, class results, and training feedback by class and instructor.',icon:'📊',href:'/instructor/performance',order:75},
  {id:'feedback',title:'Training Feedback',description:'Review student ratings and comments.',icon:'★',href:'/instructor/feedback',order:80},
  {id:'programs',title:brand('program_tab_title','Modular Programs'),description:brand('program_tab_description','Build multi-section training programs with modules and one program QR code.'),icon:brand('program_tab_icon','🧩'),href:'/instructor/programs',order:90},
  {id:'team',title:'Team & Permissions',description:'Create instructors and managers, assign course access, and manage company accounts.',icon:'👥',href:'/instructor/team',order:100,adminOnly:true},
  {id:'admin',title:'Admin & Content',description:'Company branding, course catalog, wording, and training-system settings.',icon:'⚙️',href:'/instructor/admin',order:110,adminOnly:true,alwaysVisible:true}
 ];
 const customDashboardEnabled=await methodistDashEnabled(sess.company_id);
 if(customDashboardEnabled)dashboardDefaults.splice(9,0,{id:'customdash',title:'Dashboard',description:'Open and manage company dashboards.',icon:'📊',href:'/instructor/custom-dashboards',order:76});
 const dashboardCards=dashboardDefaults.map(d=>{
   const prefix=`dash_${d.id}_`;
   const title=d.id==='programs'?brand('program_tab_title',d.title):brand(prefix+'title',d.title);
   const description=d.id==='programs'?brand('program_tab_description',d.description):brand(prefix+'description',d.description);
   const icon=d.id==='programs'?brand('program_tab_icon',d.icon):brand(prefix+'icon',d.icon);
   const visible=d.alwaysVisible?true:(d.id==='programs'?brand('program_tab_visible','true')!=='false':brand(prefix+'visible','true')!=='false');
   const order=Number(brand(prefix+'order',String(d.order)))||d.order;
   const color=safeHex(brand(prefix+'color',brand('primary_color','#c4141c')),brand('primary_color','#c4141c'));
   return {...d,title,description,icon,visible,order,color};
 }).filter(d=>(!d.adminOnly||canAdmin)&&d.visible).sort((a,b)=>a.order-b.order);
 const dashboardHtml=dashboardCards.map(d=>`<a class="home-card" href="${d.href}" style="border-top:6px solid ${esc(d.color)}"><div class="icon">${esc(d.icon)}</div><div class="title">${esc(d.title)}</div><div class="desc">${esc(d.description)}</div></a>`).join('');
 res.send(layout('Instructor Dashboard', `<div style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-radius:22px;padding:28px;border-bottom:7px solid var(--red);box-shadow:0 8px 24px rgba(0,0,0,.12)"><div class="eyebrow" style="color:#ffb9bd">${esc(brand('app_name','The Training Hub').toUpperCase())} · VERSION 2.1</div><h1 style="margin:7px 0 4px;font-size:36px">Instructor Command Center</h1><p style="margin:0;color:#eee">${esc(company.name)} · ${esc(roleLabel(sess.role))} ${sess.name?`· ${esc(sess.name)}`:''}</p><div class="toolbar" style="margin-top:18px">${canEdit?'<a class="btn" href="/instructor/new">+ Start New Class</a>':''}<a class="btn light" href="/instructor/history">Student Records</a><a class="btn light" href="/instructor/security">Security Center</a>${ownerBar}<form method="post" action="/instructor/logout" style="display:inline"><button class="danger">Logout</button></form></div></div><div class="grid" style="margin-top:18px"><div class="stat"><span>LIVE CLASSES</span><b>${active}</b></div><div class="stat"><span>${esc(brand('student_label','Student').toUpperCase())}S</span><b>${students}</b></div><div class="stat"><span>CERTIFICATES ISSUED</span><b>${certCount}</b></div><div class="stat green"><span>SYSTEM</span><b>ONLINE</b></div></div><div class="home-grid">${dashboardHtml}</div><div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><h2>Live & Recent Classes</h2><span class="pill open">2.1 MULTI-COMPANY</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Class</th><th>Code</th><th>Instructor</th><th>Students</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No classes available for this account.</td></tr>'}</tbody></table></div></div>`));
});

// ========================= METHODIST MANSFIELD DASHBOARDS =========================
async function methodistDashEnabled(companyId){
 const q=await pool.query(`SELECT 1 FROM companies c WHERE c.id=$1 AND (lower(trim(c.name)) LIKE 'methodist mansfield%' OR EXISTS(SELECT 1 FROM company_settings s WHERE s.company_id=c.id AND s.key='custom_dashboard_enabled' AND s.value='true'))`,[companyId]);
 return !!q.rowCount;
}
async function methodistDashGate(req,res,next){
 if(!await methodistDashEnabled(req.account.company_id))return res.status(404).send('Dashboard unavailable');
 next();
}
async function scopedCustomDashboard(req,id){
 const q=await pool.query('SELECT * FROM custom_dashboards WHERE id=$1 AND company_id=$2',[Number(id)||0,req.account.company_id]);return q.rows[0]||null;
}
function dashboardSafeLink(raw){
 const url=String(raw||'').trim();
 if(url.startsWith('/')&&!url.startsWith('//')&&!url.includes('\\'))return url;
 try{const u=new URL(url);if(['https:','http:'].includes(u.protocol))return u.href;}catch(e){}
 return '';
}
function dashboardOrder(value){return Math.max(1,Math.min(9999,Number(value)||100));}
function dashboardCardType(value){return ['note','metric','link','jotform','excel','spreadsheet','file','image','video','chart'].includes(String(value))?String(value):'note';}
function dashboardTypeLabel(t){return ({note:'Text',metric:'KPI / Metric',link:'Link',jotform:'Jotform',excel:'Excel Embed / File',spreadsheet:'Spreadsheet Grid',file:'File',image:'Image',video:'Video',chart:'Chart'})[t]||'Text';}
function dashboardJotformUrl(raw){
 const safe=dashboardSafeLink(raw); if(!safe)return '';
 try{const u=new URL(safe),h=u.hostname.toLowerCase();if(h==='jotform.com'||h.endsWith('.jotform.com'))return u.href;}catch(e){}
 return '';
}
function dashboardExcelEmbedUrl(raw){
 const safe=dashboardSafeLink(raw);if(!safe)return '';
 try{const u=new URL(safe),h=u.hostname.toLowerCase();if(h.includes('office.com')||h.includes('sharepoint.com')||h.includes('onedrive.live.com')||h.includes('1drv.ms')||h.includes('microsoft.com'))return u.href;}catch(e){}
 return '';
}
function dashboardFileKind(name=''){const ext=(String(name).split('.').pop()||'').toLowerCase();if(['xlsx','xls','csv'].includes(ext))return'excel';if(['png','jpg','jpeg','webp'].includes(ext))return'image';if(['mp4','mov'].includes(ext))return'video';return'file';}
function dashboardChartHtml(body=''){
 const vals=String(body||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const m=line.match(/^(.+?)[=:,]\s*(-?\d+(?:\.\d+)?)$/);return m?{label:m[1].trim(),value:Number(m[2])}:null}).filter(Boolean);
 if(!vals.length)return '<p class="muted">Enter chart data as one item per line, for example: Completed=42</p>';
 const max=Math.max(1,...vals.map(x=>Math.abs(x.value)));
 return `<div>${vals.map(x=>`<div style="display:grid;grid-template-columns:minmax(90px,1fr) 3fr 70px;gap:10px;align-items:center;margin:9px 0"><b>${esc(x.label)}</b><div style="height:18px;background:#eee;border-radius:9px;overflow:hidden"><div style="height:100%;width:${Math.max(2,Math.min(100,Math.abs(x.value)/max*100))}%;background:var(--red)"></div></div><span>${esc(x.value)}</span></div>`).join('')}</div>`;
}
async function dashboardCardRows(dashboardId,companyId,orderSql='c.display_order,c.id'){
 return (await pool.query(`SELECT c.*,f.original_name,f.title AS file_title,f.mime_type,f.file_size,f.uploaded_at,s.sheet_name,s.source_name,s.data_json,s.row_count,s.col_count,s.updated_at AS spreadsheet_updated_at FROM custom_dashboard_cards c LEFT JOIN company_files f ON f.id=c.file_id AND f.company_id=$2 LEFT JOIN custom_dashboard_spreadsheets s ON s.card_id=c.id WHERE c.dashboard_id=$1 ORDER BY ${orderSql}`,[dashboardId,companyId])).rows;
}
function dashboardSpreadsheetHtml(c,canEdit=false){
 const data=Array.isArray(c.data_json)?c.data_json:[];
 if(!data.length)return `<div class="alert"><b>No spreadsheet imported yet.</b>${canEdit?' Open Edit Dashboard and import an Excel/CSV file into this item.':''}</div>`;
 const maxCols=Math.max(1,Math.min(50,Number(c.col_count)||Math.max(...data.slice(0,50).map(r=>Array.isArray(r)?r.length:0),1)));
 const rows=data.slice(0,2000).map(r=>Array.isArray(r)?r.slice(0,maxCols):[]);
 const header=(rows[0]||[]).map((v,i)=>String(v??'').trim()||`Column ${i+1}`);
 while(header.length<maxCols)header.push(`Column ${header.length+1}`);
 const body=rows.slice(1);
 const id=`sheet_${Number(c.id)||0}`;
 const th=header.map((h,i)=>`<th data-col="${i}" onclick="sortGrid('${id}',${i})" style="cursor:pointer;position:sticky;top:0;background:#f4f4f4;z-index:2;white-space:nowrap">${esc(h)} ↕</th>`).join('');
 const tr=body.map((r,ri)=>`<tr data-row="${ri}">${header.map((_,ci)=>`<td data-col="${ci}" ${canEdit?'contenteditable="false"':''}>${esc(r[ci]??'')}</td>`).join('')}</tr>`).join('');
 const commonResponses=new Set(['strongly agree','agree','neutral','neither agree nor disagree','disagree','strongly disagree','excellent','very good','good','fair','poor','always','often','sometimes','rarely','never','yes','no']);
 const colStats=header.map((h,i)=>{
  const vals=body.map(r=>String(r[i]??'').trim()).filter(Boolean);
  const uniq=[...new Set(vals.map(v=>v.toLowerCase()))];
  const matched=vals.filter(v=>commonResponses.has(v.toLowerCase())).length;
  const ratio=vals.length?matched/vals.length:0;
  return {i,h:String(h),vals,uniq,ratio};
 });
 const nonEmptyCols=colStats.filter(x=>x.vals.length>0);
 const metadataRe=/^(respondent id|collector id|start date|end date|ip address|email address|first name|last name|custom data\s*\d*)$/i;
 const roleCandidates=nonEmptyCols.filter(x=>/(^|\b)(my\s+role|role|job\s*title|job\s*role|position|profession|department|unit)(\b|$)/i.test(x.h));
 let roleGuess=(roleCandidates[0]?.i ?? -1);
 if(roleGuess<0)roleGuess=nonEmptyCols.find(x=>/my\s+role|role|position|job title/i.test(String(x.h)))?.i ?? -1;
 if(roleGuess<0)roleGuess=(nonEmptyCols[0]?.i ?? 0);
 const rolePool=roleCandidates.length?roleCandidates:nonEmptyCols.filter(x=>!metadataRe.test(x.h));
 const roleOptions=(rolePool.length?rolePool:nonEmptyCols).map(x=>`<option value="${x.i}" ${x.i===roleGuess?'selected':''}>${esc(x.h)}</option>`).join('');
 const allRoleOptions=nonEmptyCols.map(x=>`<option value="${x.i}" ${x.i===roleGuess?'selected':''}>${esc(x.h)}</option>`).join('');
 const likelyScoreCols=new Set(nonEmptyCols.filter(x=>x.i!==roleGuess && !metadataRe.test(x.h) && x.uniq.length>=2 && x.uniq.length<=12 && x.ratio>=0.55).map(x=>x.i));
 const scoreOptions=nonEmptyCols.map(x=>{const h=x.h,i=x.i,disabled=/score|total|average/i.test(String(h))||i===roleGuess||metadataRe.test(h);const likely=likelyScoreCols.has(i);return `<label data-score-col-label data-likely="${likely?'1':'0'}" style="display:${likely?'flex':'none'};gap:8px;align-items:flex-start;margin:5px 0"><input type="checkbox" value="${i}" ${disabled?'disabled':''} onchange="refreshScoreMapping('${id}')"><span>${esc(h)}</span></label>`}).join('');
 return `<div class="sheet-grid" id="${id}" data-card-id="${Number(c.id)||0}" data-title="${esc(c.title||'Spreadsheet')}" data-sheet-name="${esc(c.sheet_name||'Sheet1')}" style="min-width:0"><div class="toolbar" style="gap:8px;align-items:center;flex-wrap:wrap"><input class="sheet-search" placeholder="Search spreadsheet..." oninput="filterGrid('${id}',this.value)" style="max-width:300px"><span class="small muted">${Number(c.row_count)||rows.length} rows · ${Number(c.col_count)||maxCols} columns · ${esc(c.sheet_name||'Sheet1')}</span><button type="button" class="btn light" onclick="downloadGridExcel('${id}')">⬇ Download Excel</button><button type="button" class="btn light" onclick="downloadGridCsv('${id}')">⬇ Download CSV</button>${canEdit?`<button type="button" class="btn light" onclick="toggleGridAnalysis('${id}',this)">Role / Scoring</button><button type="button" class="btn light" onclick="toggleGridEdit('${id}',this)">Edit Cells</button><button type="button" class="btn" style="display:none" data-save-grid="${id}" onclick="saveGrid('${id}',this)">Save Cell Changes</button>`:''}</div>${canEdit?`<div id="${id}_analysis" class="card" style="display:none;margin:10px 0;background:#fafafa;border-top:4px solid var(--red)"><div class="big" style="font-size:18px">Role & Response Scoring</div><p class="small muted">Choose the Role column, select the survey response columns you want scored, and define the response-to-number mapping. Original response text stays intact. Scores are calculated behind the scenes so wide surveys do not exceed the 50-column grid limit. Excel/CSV exports include Total Score and Average Score after scoring.</p><div class="grid"><label>Role Column<select id="${id}_role">${roleOptions}</select><div class="toolbar" style="margin-top:6px"><button type="button" class="btn light" data-role-all="0" data-role-options="${Buffer.from(allRoleOptions).toString('base64')}" onclick="toggleAllRoleColumns('${id}',this)">Show All Columns</button></div><span class="small muted">Only likely role fields are shown first.</span></label><label>Sort / Group<div class="toolbar"><button type="button" class="btn light" onclick="sortGridByRole('${id}')">Sort by Role A–Z</button><button type="button" class="btn light" onclick="sortGridRoleScore('${id}')">Role + Highest Score</button></div></label></div><div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1fr);gap:16px;margin-top:10px"><div><b>Response Columns to Score</b><div class="toolbar" style="margin-top:6px;gap:6px;flex-wrap:wrap"><input id="${id}_scoresearch" placeholder="Search survey questions..." oninput="filterScoreColumns('${id}',this.value)" style="max-width:260px"><button type="button" class="btn light" onclick="showAllScoreColumns('${id}',this)">Show All Columns</button><button type="button" class="btn light" onclick="selectLikelyScoreColumns('${id}')">Select Likely Survey Questions</button><button type="button" class="btn light" onclick="clearScoreColumns('${id}')">Clear</button></div><div id="${id}_scorecols" style="max-height:260px;overflow:auto;border:1px solid #ddd;background:#fff;border-radius:10px;padding:10px;margin-top:6px">${scoreOptions}</div></div><div><b>Response Scores</b><p class="small muted" style="margin:4px 0 8px">Select survey columns on the left. The unique response choices will appear here; assign each response a numeric score.</p><div id="${id}_mappingrows" style="max-height:320px;overflow:auto;border:1px solid #ddd;background:#fff;border-radius:10px;padding:10px"><span class="small muted">Select one or more response columns first.</span></div></div></div><div class="toolbar" style="margin-top:10px"><button type="button" class="btn" onclick="applyGridScores('${id}',this)">Apply Scores & Save</button><button type="button" class="btn light" onclick="showRoleSummary('${id}')">Role Score Summary</button><span id="${id}_scorestatus" class="small muted"></span></div><div id="${id}_rolesummary" style="margin-top:10px"></div></div>`:''}<div style="overflow:auto;max-height:620px;border:1px solid #ddd;border-radius:10px"><table style="border-collapse:collapse;width:max-content;min-width:100%"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${data.length>2000?'<div class="small muted" style="margin-top:6px">Showing the first 2,000 rows.</div>':''}</div>`;
}
function dashboardSpreadsheetScripts(dashboardId,canEdit){return String.raw`<script>
function filterGrid(id,q){q=String(q||'').toLowerCase();document.querySelectorAll('#'+id+' tbody tr').forEach(r=>r.style.display=!q||r.innerText.toLowerCase().includes(q)?'':'none');}
function sortGrid(id,col){const tb=document.querySelector('#'+id+' tbody');if(!tb)return;const rows=[...tb.rows],asc=tb.dataset.sortCol==col?tb.dataset.sortDir!=='asc':true;rows.sort((a,b)=>{let x=(a.cells[col]?.innerText||'').trim(),y=(b.cells[col]?.innerText||'').trim(),nx=Number(x.replace(/[$,%]/g,'')),ny=Number(y.replace(/[$,%]/g,''));if(x!==''&&y!==''&&!Number.isNaN(nx)&&!Number.isNaN(ny))return asc?nx-ny:ny-nx;return asc?x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'}):y.localeCompare(x,undefined,{numeric:true,sensitivity:'base'});});rows.forEach(r=>tb.appendChild(r));tb.dataset.sortCol=String(col);tb.dataset.sortDir=asc?'asc':'desc';}
function gridHeaders(id){return [...document.querySelectorAll('#'+id+' thead th')].map(x=>x.textContent.replace(/\s*↕\s*$/,'').trim());}
function initGridAnalysis(id){refreshScoreMapping(id);}
function toggleAllRoleColumns(id,btn){const role=document.getElementById(id+'_role'),headers=gridHeaders(id);if(!role||!btn)return;const current=role.value;if(btn.dataset.roleAll==='1'){location.reload();return;}role.innerHTML=headers.map((h,i)=>'<option value="'+i+'" '+(String(i)===String(current)?'selected':'')+'>'+String(h).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</option>').join('');btn.dataset.roleAll='1';btn.textContent='Likely Role Fields Only';}
function filterScoreColumns(id,q){q=String(q||'').trim().toLowerCase();document.querySelectorAll('#'+id+'_scorecols [data-score-col-label]').forEach(l=>{const txt=l.innerText.toLowerCase();const visible=!q?l.dataset.likely==='1':txt.includes(q);l.style.display=visible?'flex':'none';});}
function showAllScoreColumns(id,btn){const box=document.getElementById(id+'_scorecols');if(!box)return;const all=btn.dataset.all==='1';box.querySelectorAll('[data-score-col-label]').forEach(l=>l.style.display=all?(l.dataset.likely==='1'?'flex':'none'):'flex');btn.dataset.all=all?'0':'1';btn.textContent=all?'Show All Columns':'Show Likely Only';}
function selectLikelyScoreColumns(id){document.querySelectorAll('#'+id+'_scorecols [data-score-col-label][data-likely="1"] input[type=checkbox]:not(:disabled)').forEach(x=>x.checked=true);refreshScoreMapping(id);}
function clearScoreColumns(id){document.querySelectorAll('#'+id+'_scorecols input[type=checkbox]').forEach(x=>x.checked=false);refreshScoreMapping(id);}
function defaultScoreForResponse(v){const k=String(v||'').trim().toLowerCase();const m={'strongly agree':5,'agree':4,'neutral':3,'neither agree nor disagree':3,'disagree':2,'strongly disagree':1,'excellent':5,'very good':4,'good':3,'fair':2,'poor':1,'always':5,'often':4,'sometimes':3,'rarely':2,'never':1,'yes':1,'no':0};return Object.prototype.hasOwnProperty.call(m,k)?m[k]:'';}
function refreshScoreMapping(id){const grid=document.getElementById(id),out=document.getElementById(id+'_mappingrows');if(!grid||!out)return;const checks=[...document.querySelectorAll('#'+id+'_scorecols input[type=checkbox]:checked')],counts=new Map();checks.forEach(ch=>{const ci=Number(ch.value);grid.querySelectorAll('tbody tr').forEach(r=>{const v=(r.cells[ci]?.innerText||'').trim();if(v)counts.set(v,(counts.get(v)||0)+1);});});if(!counts.size){out.innerHTML='<span class="small muted">Select one or more response columns first.</span>';return;}const vals=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}));out.innerHTML='<div class="small muted" style="margin-bottom:8px">'+vals.length+' unique response choice'+(vals.length===1?'':'s')+'</div>'+vals.map(([v,n],i)=>{const d=defaultScoreForResponse(v);const opts=['','0','1','2','3','4','5'].map(x=>'<option value="'+x+'" '+(String(d)===x?'selected':'')+'>'+(x===''?'Ignore':x)+'</option>').join('');return '<div style="display:grid;grid-template-columns:minmax(160px,1fr) 90px 70px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eee"><span>'+String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span><select data-score-response="'+encodeURIComponent(v)+'">'+opts+'</select><span class="small muted">'+n+'×</span></div>';}).join('');}
function toggleGridAnalysis(id,btn){const p=document.getElementById(id+'_analysis');if(!p)return;const open=p.style.display==='none'||!p.style.display;p.style.display=open?'block':'none';btn.textContent=open?'Close Role / Scoring':'Role / Scoring';if(open)initGridAnalysis(id);}
function sortGridByRole(id){const s=document.getElementById(id+'_role');if(!s)return;sortGrid(id,Number(s.value));}
function scoreMapping(id){const map=new Map();document.querySelectorAll('#'+id+'_mappingrows [data-score-response]').forEach(s=>{if(s.value==='')return;let raw='';try{raw=decodeURIComponent(s.dataset.scoreResponse||'');}catch(e){raw=s.dataset.scoreResponse||'';}if(raw)map.set(raw.trim().toLowerCase(),Number(s.value));});return map;}
function ensureScoreColumn(id,name){const grid=document.getElementById(id),head=grid.querySelector('thead tr'),headers=gridHeaders(id);let idx=headers.findIndex(h=>h.toLowerCase()===String(name).toLowerCase());if(idx>=0)return idx;if(headers.length>=50)return -1;idx=headers.length;const th=document.createElement('th');th.dataset.col=idx;th.style.cssText='cursor:pointer;position:sticky;top:0;background:#f4f4f4;z-index:2;white-space:nowrap';th.textContent=name+' ↕';th.onclick=()=>sortGrid(id,idx);head.appendChild(th);grid.querySelectorAll('tbody tr').forEach(r=>{const td=document.createElement('td');td.dataset.col=idx;r.appendChild(td);});return idx;}
async function applyGridScores(id,btn){const grid=document.getElementById(id),map=scoreMapping(id),status=document.getElementById(id+'_scorestatus'),checks=[...document.querySelectorAll('#'+id+'_scorecols input[type=checkbox]:checked')];if(!map.size){status.textContent=' Add at least one response=score mapping.';return;}if(!checks.length){status.textContent=' Select at least one response column.';return;}const sourceCols=checks.map(x=>Number(x.value));let scored=0,rowsScored=0;grid.querySelectorAll('tbody tr').forEach(r=>{let total=0,count=0;sourceCols.forEach(src=>{const raw=(r.cells[src]?.innerText||'').trim(),v=map.get(raw.toLowerCase());if(v!==undefined){total+=v;count++;scored++;}});r.dataset.totalScore=count?String(Number(total.toFixed(2))):'';r.dataset.averageScore=count?String(Number((total/count).toFixed(2))):'';r.dataset.scoreCount=String(count);if(count)rowsScored++;});grid.dataset.scoresApplied='1';grid.dataset.scoreColumns=sourceCols.join(',');showRoleSummary(id);document.querySelectorAll('#'+id+'_scorecols input[type=checkbox]').forEach(x=>x.checked=false);const search=document.getElementById(id+'_scoresearch');if(search)search.value='';const mapping=document.getElementById(id+'_mappingrows');if(mapping)mapping.innerHTML='<span class="small muted">Select one or more response columns first.</span>';document.querySelectorAll('#'+id+'_scorecols [data-score-col-label]').forEach(l=>l.style.display=l.dataset.likely==='1'?'flex':'none');status.textContent=' Saved scoring for '+scored+' response cells across '+rowsScored+' rows. Scoring controls reset and are ready for another selection.';}
function sortGridRoleScore(id){const grid=document.getElementById(id),tb=grid.querySelector('tbody'),roleSel=document.getElementById(id+'_role');if(!tb||!roleSel)return;if(grid.dataset.scoresApplied!=='1'){const status=document.getElementById(id+'_scorestatus');if(status)status.textContent=' Apply scores first, then use Role + Highest Score.';return;}const roleCol=Number(roleSel.value),rows=[...tb.rows];rows.sort((a,b)=>{const ar=(a.cells[roleCol]?.innerText||'').trim(),br=(b.cells[roleCol]?.innerText||'').trim(),rc=ar.localeCompare(br,undefined,{numeric:true,sensitivity:'base'});if(rc)return rc;return (Number(b.dataset.averageScore)||0)-(Number(a.dataset.averageScore)||0);});rows.forEach(r=>tb.appendChild(r));}
function showRoleSummary(id){const grid=document.getElementById(id),roleSel=document.getElementById(id+'_role'),out=document.getElementById(id+'_rolesummary');if(!grid||!roleSel||!out)return;const roleCol=Number(roleSel.value);if(grid.dataset.scoresApplied!=='1'){out.innerHTML='<div class="alert">Apply scores first. Scores are calculated behind the scenes and do not add extra grid columns.</div>';return;}const groups=new Map();grid.querySelectorAll('tbody tr').forEach(r=>{const role=(r.cells[roleCol]?.innerText||'Unspecified').trim()||'Unspecified',v=Number(r.dataset.averageScore);if(!groups.has(role))groups.set(role,{n:0,sum:0,scored:0});const g=groups.get(role);g.n++;if(r.dataset.averageScore!==''&&!Number.isNaN(v)){g.sum+=v;g.scored++;}});const rows=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'})).map(([role,g])=>'<tr><td><b>'+String(role).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</b></td><td>'+g.n+'</td><td>'+(g.scored?(g.sum/g.scored).toFixed(2):'—')+'</td></tr>').join('');out.innerHTML='<div class="big" style="font-size:17px">Score Summary by Role</div><div class="small muted" style="margin:4px 0 8px">Scores are calculated from the selected response columns; original response columns remain unchanged.</div><div style="overflow:auto"><table><thead><tr><th>Role</th><th>Responses</th><th>Average Score</th></tr></thead><tbody>'+rows+'</tbody></table></div>'; }
function toggleGridEdit(id,btn){const grid=document.getElementById(id),on=grid.dataset.edit!=='1';grid.dataset.edit=on?'1':'0';grid.querySelectorAll('tbody td').forEach(td=>{td.contentEditable=on?'true':'false';td.style.background=on?'#fffbea':''});btn.textContent=on?'Stop Editing':'Edit Cells';const s=document.querySelector('[data-save-grid="'+id+'"]');if(s)s.style.display=on?'inline-block':'none';}
async function saveGrid(id,btn){const grid=document.getElementById(id),cardId=grid.dataset.cardId,head=[...grid.querySelectorAll('thead th')].map(x=>x.textContent.replace(/\s*↕\s*$/,'').trim()),rows=[head,...[...grid.querySelectorAll('tbody tr')].map(r=>[...r.cells].map(c=>c.innerText))],original=btn?.dataset?.originalLabel||btn?.textContent||'Save Cell Changes';if(btn){btn.dataset.originalLabel=original;btn.disabled=true;btn.textContent='Saving...';}try{const r=await fetch('/instructor/custom-dashboards/${dashboardId}/cards/'+cardId+'/spreadsheet/save',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent((document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/)||[])[1]||'')},body:JSON.stringify({data:rows})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Save failed');if(btn){btn.textContent='Saved';setTimeout(()=>btn.textContent=original,1200);}return true;}catch(e){if(btn)btn.textContent='Save failed';alert(e.message);return false;}finally{if(btn)btn.disabled=false;}}
function gridExportRows(id){const grid=document.getElementById(id);if(!grid)return[];const scored=grid.dataset.scoresApplied==='1',head=[...grid.querySelectorAll('thead th')].map(x=>x.textContent.replace(/\s*↕\s*$/,'').trim());if(scored)head.push('Total Score','Average Score');const body=[...grid.querySelectorAll('tbody tr')].map(r=>{const vals=[...r.cells].map(c=>c.innerText);if(scored)vals.push(r.dataset.totalScore||'',r.dataset.averageScore||'');return vals;});return [head,...body];}
function safeExportName(v,ext){let n=String(v||'spreadsheet').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').slice(0,100)||'spreadsheet';return n.toLowerCase().endsWith('.'+ext)?n:n+'.'+ext;}
function downloadGridCsv(id){const grid=document.getElementById(id),rows=gridExportRows(id);if(!grid||!rows.length)return;const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=safeExportName(grid.dataset.title||grid.dataset.sheetName||'spreadsheet','csv');document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
function downloadGridExcel(id){const grid=document.getElementById(id),rows=gridExportRows(id);if(!grid||!rows.length)return;if(typeof XLSX==='undefined'){alert('Excel export library did not load. Refresh the page and try again, or use Download CSV.');return;}const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();const sheet=String(grid.dataset.sheetName||'Sheet1').replace(/[\[\]\*\?\/\\:]/g,' ').slice(0,31)||'Sheet1';XLSX.utils.book_append_sheet(wb,ws,sheet);XLSX.writeFile(wb,safeExportName(grid.dataset.title||sheet,'xlsx'));}
</script>`;}

function dashboardCardView(c,opts={}){
 const type=dashboardCardType(c.card_type), safe=dashboardSafeLink(c.link_url), fileUrl=c.file_id?`/instructor/company-files/${c.file_id}/download`:'', canEdit=!!opts.canEdit;
 let content='';
 if(type==='metric')content=`<div style="font-size:40px;font-weight:900;line-height:1.1">${esc(c.body)}</div>`;
 else if(type==='link')content=`${c.body?`<p style="white-space:pre-wrap">${esc(c.body)}</p>`:''}${safe?`<a class="btn" href="${esc(safe)}" target="_blank" rel="noopener">Open Link</a>`:''}`;
 else if(type==='jotform'){const u=dashboardJotformUrl(c.link_url);content=u?`<iframe src="${esc(u)}" title="${esc(c.title)}" style="width:100%;min-height:620px;border:1px solid #ddd;border-radius:12px;background:#fff" loading="lazy"></iframe>`:`<div class="alert">Add a valid Jotform URL to display this form.</div>`;}
 else if(type==='excel'){const u=dashboardExcelEmbedUrl(c.link_url);content=(u?`<iframe src="${esc(u)}" title="${esc(c.title)}" style="width:100%;min-height:520px;border:1px solid #ddd;border-radius:12px;background:#fff" loading="lazy"></iframe>`:'')+(fileUrl?`<div class="toolbar" style="margin-top:12px"><a class="btn" href="${fileUrl}">Open / Download Excel</a><span class="small muted">${esc(c.original_name||'')}</span></div>`:'')+(c.body?`<p class="small muted">${esc(c.body)}</p>`:'');}
 else if(type==='spreadsheet')content=dashboardSpreadsheetHtml(c,canEdit)+(fileUrl?`<div class="toolbar" style="margin-top:12px"><a class="btn light" href="${fileUrl}">Open Original Spreadsheet File</a><span class="small muted">${esc(c.original_name||c.source_name||'')}</span></div>`:'');
 else if(type==='image'&&fileUrl)content=`<img src="${fileUrl}" alt="${esc(c.title)}" style="max-width:100%;height:auto;border-radius:12px">`;
 else if(type==='video'&&fileUrl)content=`<video controls playsinline preload="metadata" src="${fileUrl}" style="width:100%;max-height:620px;border-radius:12px;background:#000"></video>`;
 else if(type==='file')content=`${c.body?`<p style="white-space:pre-wrap">${esc(c.body)}</p>`:''}${fileUrl?`<a class="btn" href="${fileUrl}">Open / Download File</a><div class="small muted" style="margin-top:8px">${esc(c.original_name||'')}</div>`:'<div class="alert">No file attached.</div>'}`;
 else if(type==='chart')content=dashboardChartHtml(c.body);
 else content=`<p style="white-space:pre-wrap">${esc(c.body)}</p>`;
 return `<div class="card" style="border-top:5px solid #c4141c"><div class="section-title"><div><div class="eyebrow">${esc(dashboardTypeLabel(type))}${c.category?` · ${esc(c.category)}`:''}</div><div class="big">${esc(c.title)}</div></div>${c.updated_at?`<span class="small muted" data-local-time="${esc(new Date(c.updated_at).toISOString())}"></span>`:''}</div>${content}</div>`;
}
app.get('/instructor/custom-dashboards',auth,methodistDashGate,async(req,res)=>{
 const sort=String(req.query.sort||'order');const order=sort==='title'?'lower(title),id':sort==='updated'?'created_at DESC,id DESC':'display_order,id';
 const dashboards=(await pool.query(`SELECT * FROM custom_dashboards WHERE company_id=$1 ORDER BY ${order}`,[req.account.company_id])).rows;
 const canEdit=isEditorRole(req.account.role);
 const cards=dashboards.map(d=>`<div class="card" style="border-top:6px solid ${esc(safeHex(d.color,'#c4141c'))}"><div class="big">${esc(d.icon)} ${esc(d.title)}</div><p>${esc(d.description)}</p><a class="btn" href="/instructor/custom-dashboards/${d.id}">Open Dashboard</a>${canEdit?` <a class="btn light" href="/instructor/custom-dashboards/${d.id}/edit">Edit</a>`:''}</div>`).join('');
 res.send(layout('Dashboards',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a><form method="get" style="display:inline"><select name="sort" onchange="this.form.submit()"><option value="order" ${sort==='order'?'selected':''}>Custom Order</option><option value="title" ${sort==='title'?'selected':''}>Name A–Z</option><option value="updated" ${sort==='updated'?'selected':''}>Newest</option></select></form></div><div class="hero"><div><div class="eyebrow">METHODIST MANSFIELD</div><h1>Dashboards</h1><p class="muted">Create, sort, and manage dashboards with Excel, Jotform, files, links, KPIs, charts, images, and video.</p></div></div>${canEdit?`<div class="card"><div class="big">Add Dashboard</div><form method="post" action="/instructor/custom-dashboards"><label>Dashboard name<input name="title" required maxlength="160" placeholder="Example: Training Overview"></label><button>Create Dashboard</button></form></div>`:''}<div class="grid">${cards||'<div class="card">No dashboards yet.</div>'}</div>`));
});
app.post('/instructor/custom-dashboards',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const title=String(req.body.title||'').trim().slice(0,160);if(!title)return res.status(400).send('Dashboard name required');
 const q=await pool.query('INSERT INTO custom_dashboards(company_id,title) VALUES($1,$2) RETURNING id',[req.account.company_id,title]);
 res.redirect(`/instructor/custom-dashboards/${q.rows[0].id}/edit`);
});
app.get('/instructor/custom-dashboards/:id',auth,methodistDashGate,async(req,res)=>{
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const sort=String(req.query.sort||'order'),dir=String(req.query.dir||'asc')==='desc'?'desc':'asc',category=String(req.query.category||'').trim().slice(0,80);
 const orderMap={order:`c.display_order ${dir},c.id ${dir}`,title:`lower(c.title) ${dir},c.id ${dir}`,type:`c.card_type ${dir},lower(c.title) ${dir}`,updated:`c.updated_at ${dir},c.id ${dir}`,category:`lower(c.category) ${dir},lower(c.title) ${dir}`};
 let cards=await dashboardCardRows(d.id,req.account.company_id,orderMap[sort]||orderMap.order);if(category)cards=cards.filter(x=>String(x.category||'')===category);
 const categories=[...new Set((await dashboardCardRows(d.id,req.account.company_id,'lower(c.category),c.id')).map(x=>String(x.category||'').trim()).filter(Boolean))];
 const canEdit=isEditorRole(req.account.role), html=cards.map(c=>dashboardCardView(c,{canEdit})).join('');
 const catOptions=`<option value="">All Categories</option>`+categories.map(x=>`<option value="${esc(x)}" ${x===category?'selected':''}>${esc(x)}</option>`).join('');
 res.send(layout(d.title,`<div class="toolbar"><a class="btn light" href="/instructor/custom-dashboards">← Dashboards</a>${canEdit?`<a class="btn" href="/instructor/custom-dashboards/${d.id}/edit">Edit Dashboard</a>`:''}<form method="get" style="display:inline-flex;gap:8px;align-items:center"><select name="sort"><option value="order" ${sort==='order'?'selected':''}>Custom Order</option><option value="title" ${sort==='title'?'selected':''}>Name</option><option value="type" ${sort==='type'?'selected':''}>Type</option><option value="category" ${sort==='category'?'selected':''}>Category</option><option value="updated" ${sort==='updated'?'selected':''}>Last Updated</option></select><select name="dir"><option value="asc" ${dir==='asc'?'selected':''}>Ascending</option><option value="desc" ${dir==='desc'?'selected':''}>Descending</option></select><select name="category">${catOptions}</select><button class="btn light">Sort / Filter</button></form></div><div class="hero"><div><div class="eyebrow">METHODIST MANSFIELD DASHBOARD</div><h1>${esc(d.icon)} ${esc(d.title)}</h1><p class="muted">${esc(d.description)}</p></div></div><div class="grid">${html||'<div class="card">No dashboard items match this view.</div>'}</div><script>document.querySelectorAll('[data-local-time]').forEach(x=>{try{x.textContent='Updated '+new Date(x.dataset.localTime).toLocaleString()}catch(e){}})</script>${cards.some(c=>dashboardCardType(c.card_type)==='spreadsheet')?'<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>':''}${dashboardSpreadsheetScripts(d.id,canEdit)}`));
});
app.get('/assets/dashboard-spreadsheet.js',(req,res)=>{
 res.type('application/javascript').send(`(function(){
 const books={};
 function qs(id){return document.getElementById(id)}
 function csrf(){const m=document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/);return m?decodeURIComponent(m[1]):''}
 function setStatus(cardId,msg,isError){const el=qs('sheetStatus_'+cardId);if(el){el.textContent=' '+msg;el.style.color=isError?'#b00020':'';}}
 function loadScript(src){return new Promise((resolve,reject)=>{const x=document.createElement('script');x.src=src;x.onload=resolve;x.onerror=()=>reject(new Error('Could not load spreadsheet reader'));document.head.appendChild(x);});}
 async function ensureXLSX(){
   if(window.XLSX)return window.XLSX;
   const sources=['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js','https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'];
   let lastErr;
   for(const src of sources){try{await loadScript(src);if(window.XLSX)return window.XLSX;}catch(e){lastErr=e;}}
   throw lastErr||new Error('Spreadsheet reader could not load. Check internet access and refresh.');
 }
 async function readFile(cardId,input){
   if(!input||!input.files||!input.files[0]){setStatus(cardId,'Choose a spreadsheet file first.',true);return;}
   const sel=qs('sheetName_'+cardId);if(sel)sel.innerHTML='<option>Reading spreadsheet…</option>';
   try{
     setStatus(cardId,'Reading spreadsheet…',false);
     const XLSX=await ensureXLSX();
     const f=input.files[0];
     const buf=await f.arrayBuffer();
     const wb=XLSX.read(buf,{type:'array',cellDates:false});
     books[cardId]={wb,file:f};
     if(!wb.SheetNames||!wb.SheetNames.length)throw new Error('No worksheets were found in this file.');
     if(sel){sel.innerHTML='';for(const n of wb.SheetNames){const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);}}
     setStatus(cardId,wb.SheetNames.length+' worksheet(s) found. Select a worksheet and click Import / Update Cells.',false);
   }catch(e){
     books[cardId]=null;
     if(sel)sel.innerHTML='<option>Could not read spreadsheet</option>';
     setStatus(cardId,e&&e.message?e.message:'Could not read spreadsheet.',true);
   }
 }
 async function doImport(dashboardId,cardId){
   let item=books[cardId];
   const input=qs('sheetFile_'+cardId),sel=qs('sheetName_'+cardId);
   if(!item&&input&&input.files&&input.files[0]){await readFile(cardId,input);item=books[cardId];}
   if(!item){setStatus(cardId,'Choose a spreadsheet file first.',true);return;}
   try{
     const XLSX=await ensureXLSX();
     const name=sel&&sel.value?sel.value:item.wb.SheetNames[0];
     const ws=item.wb.Sheets[name];
     let data=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
     data=data.slice(0,2000).map(r=>(Array.isArray(r)?r:[]).slice(0,50).map(v=>String(v==null?'':v).slice(0,5000)));
     while(data.length&&data[data.length-1].every(v=>String(v).trim()===''))data.pop();
     if(!data.length)throw new Error('The selected worksheet is empty.');
     setStatus(cardId,'Importing '+data.length+' rows…',false);
     const r=await fetch('/instructor/custom-dashboards/'+dashboardId+'/cards/'+cardId+'/spreadsheet/import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf()},body:JSON.stringify({sheet_name:name,source_name:item.file.name,data})});
     const txt=await r.text();let j={};try{j=JSON.parse(txt)}catch(e){}
     if(!r.ok||!j.ok)throw new Error(j.error||txt||'Import failed');
     setStatus(cardId,'Import complete. Reloading…',false);
     location.reload();
   }catch(e){setStatus(cardId,e&&e.message?e.message:'Import failed.',true);}
 }
 function init(){
   document.querySelectorAll('.spreadsheet-file-input').forEach(input=>{
     input.addEventListener('change',()=>readFile(Number(input.dataset.cardId),input));
   });
   document.querySelectorAll('.spreadsheet-import-btn').forEach(btn=>{
     btn.addEventListener('click',()=>doImport(Number(btn.dataset.dashboardId),Number(btn.dataset.cardId)));
   });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
 window.loadWorkbook=(cardId,input)=>readFile(Number(cardId),input);
 window.importWorkbook=(dashboardId,cardId)=>doImport(Number(dashboardId),Number(cardId));
})();`);
});

app.get('/instructor/custom-dashboards/:id/edit',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const cards=await dashboardCardRows(d.id,req.account.company_id,'c.display_order,c.id');
 const versions=(await pool.query(`SELECT v.card_id,v.version_no,v.uploaded_at,f.id file_id,f.original_name,f.file_size FROM custom_dashboard_file_versions v JOIN company_files f ON f.id=v.file_id WHERE v.card_id=ANY($1::int[]) ORDER BY v.card_id,v.version_no DESC`,[cards.length?cards.map(x=>x.id):[0]])).rows;
 const byCard=new Map();for(const v of versions){if(!byCard.has(Number(v.card_id)))byCard.set(Number(v.card_id),[]);byCard.get(Number(v.card_id)).push(v);}
 const typeOptions=(current='note')=>[['note','Text'],['metric','KPI / Metric'],['chart','Chart'],['link','Link'],['jotform','Jotform'],['excel','Excel Embed / File'],['spreadsheet','Spreadsheet Grid (cells)'],['file','File'],['image','Image'],['video','Video']].map(([v,l])=>`<option value="${v}" ${current===v?'selected':''}>${l}</option>`).join('');
 const html=cards.map(c=>{const vs=byCard.get(Number(c.id))||[];return `<div class="card"><form method="post" action="/instructor/custom-dashboards/${d.id}/cards/${c.id}"><div class="big">Edit Item</div><div class="grid"><label>Title<input name="title" value="${esc(c.title)}" required maxlength="160"></label><label>Type<select name="card_type">${typeOptions(c.card_type)}</select></label><label>Category<input name="category" value="${esc(c.category||'')}" placeholder="Example: Nursing, Quality, Education"></label><label>Custom Order<input type="number" name="display_order" value="${c.display_order}"></label></div><label>Text / KPI value / chart data<textarea name="body" rows="4">${esc(c.body)}</textarea></label><label>Link / Embed URL<input name="link_url" value="${esc(c.link_url)}" placeholder="Jotform, Excel Online, SharePoint, or web link"></label><button>Save Item</button></form>${c.file_id?`<div class="success" style="margin-top:10px"><b>Current file:</b> ${esc(c.original_name||'File')} · ${Math.max(1,Math.round(Number(c.file_size||0)/1024))} KB <a class="btn light" href="/instructor/company-files/${c.file_id}/download">Open</a></div>`:''}<div style="margin-top:12px"><label>Upload / Replace Attached File<input type="file" id="dashFile_${c.id}" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.mp4,.mov,.txt,.zip"></label><button type="button" class="btn light" onclick="uploadDashboardFile(${d.id},${c.id},'dashFile_${c.id}','dashStatus_${c.id}')">${c.file_id?'Replace File':'Attach File'}</button><span id="dashStatus_${c.id}" class="small muted"></span></div>${vs.length?`<details style="margin-top:12px"><summary>File version history (${vs.length})</summary>${vs.map(v=>`<div class="small" style="padding:6px 0">Version ${v.version_no} · ${esc(v.original_name)} · <span data-local-time="${esc(new Date(v.uploaded_at).toISOString())}"></span> · <a href="/instructor/company-files/${v.file_id}/download">Open</a></div>`).join('')}</details>`:''}<div class="card" style="margin:12px 0;background:#fafafa"><div class="big" style="font-size:17px">Import Spreadsheet into Cells</div><p class="small muted">Upload Excel (.xlsx/.xls) or CSV, choose the worksheet, then import it as a searchable, sortable grid. Re-importing updates this same dashboard item.</p><input type="file" id="sheetFile_${c.id}" class="spreadsheet-file-input" data-card-id="${c.id}" accept=".xlsx,.xls,.csv"><div class="small muted" style="margin-top:6px">After choosing a file, wait for the worksheet name to appear below, then click <b>Import / Update Cells</b>.</div><div class="grid" style="margin-top:8px"><label>Worksheet<select id="sheetName_${c.id}"><option>Choose a spreadsheet file first</option></select></label><label>Import limit<span class="small muted">Up to 2,000 rows × 50 columns</span></label></div><button type="button" class="btn light spreadsheet-import-btn" data-dashboard-id="${d.id}" data-card-id="${c.id}">Import / Update Cells</button><span id="sheetStatus_${c.id}" class="small muted"></span>${c.sheet_name?`<div class="success" style="margin-top:8px"><b>Imported:</b> ${esc(c.sheet_name)} · ${Number(c.row_count)||0} rows · ${Number(c.col_count)||0} columns${c.source_name?` · ${esc(c.source_name)}`:''}<div class="small muted" style="margin-top:6px">Open the dashboard to download the current edited grid as Excel or CSV.</div></div>`:''}</div><form method="post" action="/instructor/custom-dashboards/${d.id}/cards/${c.id}/delete" onsubmit="return confirm('Delete this dashboard item?')"><button class="danger">Delete Item</button></form></div>`}).join('');
 res.send(layout('Edit Dashboard',`<div class="toolbar"><a class="btn light" href="/instructor/custom-dashboards/${d.id}">← View Dashboard</a><a class="btn light" href="/instructor/company-files">Company File Library</a></div><h1>Edit Dashboard</h1><div class="card"><form method="post" action="/instructor/custom-dashboards/${d.id}/edit"><div class="grid"><label>Name<input name="title" value="${esc(d.title)}" required maxlength="160"></label><label>Icon / Emoji<input name="icon" value="${esc(d.icon)}" maxlength="20"></label><label>Color<input type="color" name="color" value="${esc(safeHex(d.color,'#c4141c'))}"></label><label>Display Order<input type="number" name="display_order" value="${d.display_order}"></label></div><label>Description<textarea name="description" rows="3">${esc(d.description)}</textarea></label><button>Save Dashboard</button></form><form method="post" action="/instructor/custom-dashboards/${d.id}/delete" onsubmit="return confirm('Delete this dashboard and all its items?')"><button class="danger">Delete Dashboard</button></form></div><div class="card"><div class="big">Add Dashboard Item</div><form method="post" action="/instructor/custom-dashboards/${d.id}/cards"><div class="grid"><label>Title<input name="title" required maxlength="160"></label><label>Type<select name="card_type">${typeOptions('note')}</select></label><label>Category<input name="category" placeholder="Optional category"></label><label>Custom Order<input type="number" name="display_order" value="100"></label></div><label>Text / KPI value / chart data<textarea name="body" rows="4" placeholder="For a chart use lines like: Completed=42"></textarea></label><label>Link / Embed URL<input name="link_url" placeholder="Jotform or Excel Online/SharePoint links can display inside the dashboard"></label><button>Add Item</button></form><p class="small muted">For a native spreadsheet grid, choose Spreadsheet Grid (cells), add the item, then use Import Spreadsheet into Cells below. Excel/CSV grids can be searched, sorted, filtered, and edited inside the Training Hub. You can still attach the original file and replace it later with version history.</p></div><div class="grid">${html}</div><script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script><script src="/assets/dashboard-spreadsheet.js"></script><script>
const dashBooks={};
async function loadWorkbook(cardId,input){const st=document.getElementById('sheetStatus_'+cardId),sel=document.getElementById('sheetName_'+cardId);if(!input.files||!input.files[0])return;try{if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader did not load. Refresh and try again.');st.textContent=' Reading spreadsheet...';const f=input.files[0],buf=await f.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:false});dashBooks[cardId]={wb,file:f};sel.innerHTML=wb.SheetNames.map(n=>'<option value="'+String(n).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+String(n).replace(/</g,'&lt;')+'</option>').join('');st.textContent=' '+wb.SheetNames.length+' worksheet(s) found.';}catch(e){st.textContent=' '+e.message;}}
async function importWorkbook(dashboardId,cardId){const item=dashBooks[cardId],st=document.getElementById('sheetStatus_'+cardId),sel=document.getElementById('sheetName_'+cardId);if(!item){st.textContent=' Choose a spreadsheet file first.';return;}try{const name=sel.value,ws=item.wb.Sheets[name];let data=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});data=data.slice(0,2000).map(r=>(Array.isArray(r)?r:[]).slice(0,50).map(v=>String(v??'').slice(0,5000)));while(data.length&&data[data.length-1].every(v=>String(v).trim()===''))data.pop();st.textContent=' Importing '+data.length+' rows...';const r=await fetch('/instructor/custom-dashboards/'+dashboardId+'/cards/'+cardId+'/spreadsheet/import',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':dashCsrf()},body:JSON.stringify({sheet_name:name,source_name:item.file.name,data})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Import failed');st.textContent=' Import complete.';location.reload();}catch(e){st.textContent=' '+e.message;}}
function dashCsrf(){const m=document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/);return m?decodeURIComponent(m[1]):'';}
async function uploadDashboardFile(dashboardId,cardId,inputId,statusId){const input=document.getElementById(inputId),status=document.getElementById(statusId);if(!input.files||!input.files[0]){status.textContent=' Choose a file first.';return;}const f=input.files[0],headers={'X-CSRF-Token':dashCsrf()},base='/instructor/company-files/upload-chunked';let uploadId=null;try{status.textContent=' Preparing...';let r=await fetch(base+'/start?name='+encodeURIComponent(f.name)+'&mime='+encodeURIComponent(f.type||'application/octet-stream')+'&title='+encodeURIComponent(f.name)+'&size='+encodeURIComponent(f.size),{method:'POST',headers});let j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Could not start upload');uploadId=j.file_id;const chunkSize=4*1024*1024,total=Math.max(1,Math.ceil(f.size/chunkSize));for(let i=0;i<total;i++){status.textContent=' Uploading '+Math.round(i/total*100)+'%';const blob=f.slice(i*chunkSize,Math.min((i+1)*chunkSize,f.size));r=await fetch(base+'/chunk?file_id='+uploadId+'&chunk_no='+i,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:await blob.arrayBuffer()});j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Upload failed');}r=await fetch(base+'/complete?file_id='+uploadId+'&size='+f.size,{method:'POST',headers});j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Could not finalize upload');const form=new URLSearchParams({file_id:String(uploadId)});r=await fetch('/instructor/custom-dashboards/'+dashboardId+'/cards/'+cardId+'/attach-file',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:form});if(!r.ok)throw new Error(await r.text()||'Could not attach file');status.textContent=' Complete';location.reload();}catch(e){if(uploadId)fetch(base+'/abort?file_id='+uploadId,{method:'POST',headers}).catch(()=>{});status.textContent=' '+e.message;}}
document.querySelectorAll('[data-local-time]').forEach(x=>{try{x.textContent=new Date(x.dataset.localTime).toLocaleString()}catch(e){}})
</script>`));
});
app.post('/instructor/custom-dashboards/:id/edit',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const title=String(req.body.title||'').trim().slice(0,160);if(!title)return res.status(400).send('Dashboard name required');
 await pool.query('UPDATE custom_dashboards SET title=$1,description=$2,icon=$3,color=$4,display_order=$5 WHERE id=$6 AND company_id=$7',[title,String(req.body.description||'').slice(0,4000),String(req.body.icon||'📊').slice(0,20),safeHex(req.body.color,'#c4141c'),dashboardOrder(req.body.display_order),d.id,req.account.company_id]);res.redirect(`/instructor/custom-dashboards/${d.id}/edit`);
});
app.post('/instructor/custom-dashboards/:id/delete',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 await pool.query('DELETE FROM custom_dashboards WHERE id=$1 AND company_id=$2',[Number(req.params.id)||0,req.account.company_id]);res.redirect('/instructor/custom-dashboards');
});
app.post('/instructor/custom-dashboards/:id/cards',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const title=String(req.body.title||'').trim().slice(0,160);if(!title)return res.status(400).send('Item title required');
 const type=dashboardCardType(req.body.card_type), link=type==='jotform'?dashboardJotformUrl(req.body.link_url):(type==='excel'?dashboardSafeLink(req.body.link_url):dashboardSafeLink(req.body.link_url));
 await pool.query('INSERT INTO custom_dashboard_cards(dashboard_id,card_type,title,body,link_url,category,display_order,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())',[d.id,type,title,String(req.body.body||'').slice(0,10000),link,String(req.body.category||'').trim().slice(0,100),dashboardOrder(req.body.display_order)]);res.redirect(`/instructor/custom-dashboards/${d.id}/edit`);
});
app.post('/instructor/custom-dashboards/:id/cards/:cardId',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const title=String(req.body.title||'').trim().slice(0,160);if(!title)return res.status(400).send('Item title required');
 const type=dashboardCardType(req.body.card_type), link=type==='jotform'?dashboardJotformUrl(req.body.link_url):dashboardSafeLink(req.body.link_url);
 await pool.query('UPDATE custom_dashboard_cards SET title=$1,card_type=$2,body=$3,link_url=$4,category=$5,display_order=$6,updated_at=now() WHERE id=$7 AND dashboard_id=$8',[title,type,String(req.body.body||'').slice(0,10000),link,String(req.body.category||'').trim().slice(0,100),dashboardOrder(req.body.display_order),Number(req.params.cardId)||0,d.id]);res.redirect(`/instructor/custom-dashboards/${d.id}/edit`);
});
app.post('/instructor/custom-dashboards/:id/cards/:cardId/attach-file',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 const cardId=Number(req.params.cardId)||0,fileId=Number(req.body.file_id)||0;const c=(await pool.query('SELECT * FROM custom_dashboard_cards WHERE id=$1 AND dashboard_id=$2',[cardId,d.id])).rows[0];if(!c)return res.sendStatus(404);
 const f=await companyFileRow(fileId,req.account.company_id);if(!f||Number(f.file_size)<=0)return res.status(400).send('Uploaded file not found');
 const v=Number((await pool.query('SELECT COALESCE(max(version_no),0)::int n FROM custom_dashboard_file_versions WHERE card_id=$1',[cardId])).rows[0].n||0)+1;
 const suggested=dashboardFileKind(f.original_name),nextType=['note','metric','link','chart','jotform'].includes(c.card_type)?suggested:c.card_type;
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('UPDATE custom_dashboard_cards SET file_id=$1,card_type=$2,updated_at=now() WHERE id=$3 AND dashboard_id=$4',[fileId,nextType,cardId,d.id]);await client.query('INSERT INTO custom_dashboard_file_versions(card_id,file_id,version_no) VALUES($1,$2,$3)',[cardId,fileId,v]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 await auditEvent(req,'DASHBOARD_FILE_ATTACHED',`${d.title} · ${c.title} · ${f.original_name} · v${v}`,'ok');res.send('OK');
});
app.post('/instructor/custom-dashboards/:id/cards/:cardId/spreadsheet/import',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Edit access required'});
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.status(404).json({ok:false,error:'Dashboard not found'});
 const cardId=Number(req.params.cardId)||0,c=(await pool.query('SELECT id FROM custom_dashboard_cards WHERE id=$1 AND dashboard_id=$2',[cardId,d.id])).rows[0];if(!c)return res.status(404).json({ok:false,error:'Dashboard item not found'});
 let data=Array.isArray(req.body?.data)?req.body.data:[];data=data.slice(0,2000).map(r=>(Array.isArray(r)?r:[]).slice(0,50).map(v=>String(v??'').slice(0,5000)));
 if(!data.length)return res.status(400).json({ok:false,error:'Spreadsheet has no rows to import'});
 const cols=Math.max(1,...data.map(r=>r.length));for(const r of data)while(r.length<cols)r.push('');
 const sheet=String(req.body?.sheet_name||'Sheet1').trim().slice(0,200)||'Sheet1',source=String(req.body?.source_name||'').trim().slice(0,300);
 await pool.query(`INSERT INTO custom_dashboard_spreadsheets(card_id,sheet_name,source_name,data_json,row_count,col_count,updated_by,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,now()) ON CONFLICT(card_id) DO UPDATE SET sheet_name=EXCLUDED.sheet_name,source_name=EXCLUDED.source_name,data_json=EXCLUDED.data_json,row_count=EXCLUDED.row_count,col_count=EXCLUDED.col_count,updated_by=EXCLUDED.updated_by,updated_at=now()`,[cardId,sheet,source,JSON.stringify(data),data.length,cols,req.account.user_id||null]);
 await pool.query("UPDATE custom_dashboard_cards SET card_type='spreadsheet',updated_at=now() WHERE id=$1 AND dashboard_id=$2",[cardId,d.id]);
 await auditEvent(req,'DASHBOARD_SPREADSHEET_IMPORTED',`${d.title} · ${sheet} · ${data.length} rows × ${cols} cols`,'ok');res.json({ok:true,rows:data.length,cols});
});
app.post('/instructor/custom-dashboards/:id/cards/:cardId/spreadsheet/save',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Edit access required'});
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.status(404).json({ok:false,error:'Dashboard not found'});
 const cardId=Number(req.params.cardId)||0,c=(await pool.query('SELECT id FROM custom_dashboard_cards WHERE id=$1 AND dashboard_id=$2',[cardId,d.id])).rows[0];if(!c)return res.status(404).json({ok:false,error:'Dashboard item not found'});
 let data=Array.isArray(req.body?.data)?req.body.data:[];data=data.slice(0,2000).map(r=>(Array.isArray(r)?r:[]).slice(0,50).map(v=>String(v??'').slice(0,5000)));if(!data.length)return res.status(400).json({ok:false,error:'No cell data received'});
 const cols=Math.max(1,...data.map(r=>r.length));for(const r of data)while(r.length<cols)r.push('');
 const q=await pool.query('UPDATE custom_dashboard_spreadsheets SET data_json=$1::jsonb,row_count=$2,col_count=$3,updated_by=$4,updated_at=now() WHERE card_id=$5 RETURNING card_id',[JSON.stringify(data),data.length,cols,req.account.user_id||null,cardId]);if(!q.rowCount)return res.status(400).json({ok:false,error:'Import a spreadsheet first'});
 await pool.query('UPDATE custom_dashboard_cards SET updated_at=now() WHERE id=$1 AND dashboard_id=$2',[cardId,d.id]);res.json({ok:true,rows:data.length,cols});
});

app.post('/instructor/custom-dashboards/:id/cards/:cardId/delete',auth,methodistDashGate,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.sendStatus(403);
 const d=await scopedCustomDashboard(req,req.params.id);if(!d)return res.sendStatus(404);
 await pool.query('DELETE FROM custom_dashboard_cards WHERE id=$1 AND dashboard_id=$2',[Number(req.params.cardId)||0,d.id]);res.redirect(`/instructor/custom-dashboards/${d.id}/edit`);
});

// ========================= EDITABLE MODULAR PROGRAMS =========================
function programJoinCode(){ return String(Math.floor(100000+Math.random()*900000)); }
async function companyProgram(id,companyId){ const q=await pool.query('SELECT * FROM training_programs WHERE id=$1 AND company_id=$2',[id,companyId]); return q.rows[0]||null; }
async function programTree(programId){
 const sections=(await pool.query('SELECT * FROM program_sections WHERE program_id=$1 ORDER BY display_order,id',[programId])).rows;
 const ids=sections.map(x=>x.id); let modules=[];
 if(ids.length) modules=(await pool.query('SELECT * FROM program_modules WHERE section_id=ANY($1::int[]) ORDER BY display_order,id',[ids])).rows;
 return {sections,modules};
}
function orderedActiveProgramModules(tree){
 return tree.sections.filter(s=>s.active).flatMap(sec=>tree.modules.filter(m=>m.active&&Number(m.section_id)===Number(sec.id)));
}
async function programStudentModuleAccess(studentId,programId,moduleId){
 const tree=await programTree(programId);
 const ordered=orderedActiveProgramModules(tree);
 const targetIndex=ordered.findIndex(m=>Number(m.id)===Number(moduleId));
 if(targetIndex<0)return false;
 const prog=(await pool.query('SELECT module_id,completed FROM program_module_progress WHERE student_id=$1',[studentId])).rows;
 const done=new Set(prog.filter(x=>x.completed).map(x=>Number(x.module_id)));
 const firstIncomplete=ordered.findIndex(m=>!done.has(Number(m.id)));
 const maxVisibleIndex=firstIncomplete<0?ordered.length-1:firstIncomplete;
 return targetIndex<=maxVisibleIndex;
}
app.get('/instructor/programs',auth,async(req,res)=>{
 await seedMahindraHCE3100Program(req.account.company_id);
 await seedMahindra14ModuleProgram(req.account.company_id);
 const canEdit=isEditorRole(req.account.role), canAdmin=isCompanyAdminRole(req.account.role);
 const q=await pool.query(`SELECT p.*,count(distinct ps.id)::int students FROM training_programs p LEFT JOIN program_students ps ON ps.program_id=p.id WHERE p.company_id=$1 GROUP BY p.id ORDER BY p.display_order,p.id`,[req.account.company_id]);
 const rows=q.rows.map(p=>`<tr><td><b>${esc(p.title)}</b><br><span class="muted small">${esc(p.description||'')}</span></td><td><span class="pill">${esc(p.join_code)}</span></td><td>${p.students}</td><td><span class="pill ${p.active?'open':'closed'}">${p.active?'Open':'Hidden'}</span></td><td class="nowrap"><a class="btn" href="/instructor/programs/${p.id}">Open Program</a>${canEdit?` <form method="post" action="/instructor/programs/${p.id}/toggle" style="display:inline"><button class="btn light">${p.active?'Hide':'Show'}</button></form> <form method="post" action="/instructor/programs/${p.id}/delete" style="display:inline" onsubmit="return confirm('Permanently delete this entire program? This removes its sections, modules, schedule, student records, test attempts, and program progress. This cannot be undone.')"><button class="danger">Delete</button></form>`:''}</td></tr>`).join('');
 const create=canEdit?`<div class="card"><div class="big">Create Modular Program</div><form method="post" action="/instructor/programs"><label>Program / Training Title<input name="title" placeholder="Example: HCE & 3100 Service Training — 3.5 Day Program" required></label><label>Description<textarea name="description" rows="3"></textarea></label><label>Display Order<input type="number" name="display_order" value="100"></label><button>Create Program</button></form></div>`:'';
 res.send(layout(brand('program_tab_title','Modular Programs'),`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a>${canAdmin?'<a class="btn light" href="/instructor/programs/settings">Edit This Dashboard Tab</a>':''}</div><div class="hero"><div><div class="eyebrow">PROGRAM BUILDER</div><h1>${esc(brand('program_tab_title','Modular Programs'))}</h1><p class="muted">${esc(brand('program_tab_description','Build multi-section training programs with modules, activities, and one program QR code.'))}</p></div></div>${create}<div class="card"><div class="big">Programs</div><div style="overflow:auto"><table><tr><th>Training Title</th><th>Program Code</th><th>Students</th><th>Status</th><th></th></tr>${rows||'<tr><td colspan="5">No modular programs yet.</td></tr>'}</table></div></div>`));
});
app.post('/instructor/programs',auth,async(req,res)=>{ if(!isEditorRole(req.account.role))return res.status(403).send('Edit access required'); const title=String(req.body.title||'').trim(); if(!title)return res.redirect('/instructor/programs'); const token=crypto.randomBytes(18).toString('hex'); let code=programJoinCode(); while((await pool.query('SELECT 1 FROM training_programs WHERE company_id=$1 AND join_code=$2',[req.account.company_id,code])).rowCount)code=programJoinCode(); const q=await pool.query('INSERT INTO training_programs(company_id,title,description,join_code,join_token,display_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[req.account.company_id,title,String(req.body.description||'').trim(),code,token,Number(req.body.display_order)||100]); res.redirect(`/instructor/programs/${q.rows[0].id}`); });
app.get('/instructor/programs/settings',auth,companyAdminOnly,async(req,res)=>{ res.send(layout('Edit Modular Programs Tab',`<div class="toolbar"><a class="btn light" href="/instructor/programs">← Modular Programs</a></div><div class="card"><div class="big">Edit Dashboard Tab</div><p class="muted">These settings affect only this company.</p><form method="post" action="/instructor/programs/settings"><label>Tab Name<input name="title" value="${esc(brand('program_tab_title','Modular Programs'))}" required></label><label>Tab Description<textarea name="description" rows="3">${esc(brand('program_tab_description',''))}</textarea></label><label>Tab Icon / Emoji<input name="icon" value="${esc(brand('program_tab_icon','🧩'))}"></label><label><input style="width:auto" type="checkbox" name="visible" value="1" ${brand('program_tab_visible','true')!=='false'?'checked':''}> Show this tab on the dashboard</label><button>Save Tab Settings</button></form></div>`)); });
app.post('/instructor/programs/settings',auth,companyAdminOnly,async(req,res)=>{ const vals={program_tab_title:String(req.body.title||'Modular Programs').trim(),program_tab_description:String(req.body.description||'').trim(),program_tab_icon:String(req.body.icon||'🧩').trim(),program_tab_visible:req.body.visible==='1'?'true':'false'}; for(const [k,v] of Object.entries(vals))await pool.query('INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=EXCLUDED.value',[req.account.company_id,k,v]); res.redirect('/instructor/programs'); });
app.get('/instructor/programs/:id',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); const canEdit=isEditorRole(req.account.role); const tree=await programTree(p.id); const origin=`${req.protocol}://${req.get('host')}`; const joinUrl=`${origin}/program/join/${p.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:360,margin:3}); const students=Number((await pool.query('SELECT count(*)::int n FROM program_students WHERE program_id=$1',[p.id])).rows[0].n||0);
 const programStudentsRows=(await pool.query(`SELECT ps.id,ps.name,ps.dealer,ps.joined_at,COALESCE(round(avg(a.score) FILTER (WHERE a.status='completed')),0)::int avg_score,count(a.id) FILTER (WHERE a.status='completed')::int tests FROM program_students ps LEFT JOIN program_test_attempts a ON a.student_id=ps.id WHERE ps.program_id=$1 GROUP BY ps.id ORDER BY ps.joined_at DESC`,[p.id])).rows;
 const studentRosterCard=`<div class="card" style="border-top:6px solid #1f7a3b"><div class="section-title"><div><div class="eyebrow">PROGRAM STUDENT RECORDS · 2.1.72</div><div class="big">Students & Results</div><p class="muted">Students who join this Modular Program are recorded here automatically. Completed tests and module progress are retained in their program record.</p></div><span class="pill open">${programStudentsRows.length} RECORDED</span></div><div style="overflow:auto"><table><tr><th>Student</th><th>${esc(brand('organization_unit_label','Company / Location'))}</th><th>Tests</th><th>Average</th><th>Joined</th><th></th></tr>${programStudentsRows.map(st=>`<tr><td><b>${esc(st.name)}</b></td><td>${esc(st.dealer||'')}</td><td>${st.tests}</td><td>${st.avg_score}%</td><td>${st.joined_at?new Date(st.joined_at).toLocaleString():''}</td><td><a class="btn light" href="/instructor/program-student/${st.id}">Open Record</a></td></tr>`).join('')||'<tr><td colspan="6">No students have joined this program yet.</td></tr>'}</table></div></div>`;
 const companyEquipment=await companyEquipmentModels(req.account.company_id); const programEquipment=await programEquipmentSelection(p.id,req.account.company_id); const selectedEquipmentIds=new Set(programEquipment.models.map(x=>Number(x.id))); const effectiveEquipment=programEquipment.all?companyEquipment:programEquipment.models;
 // Module content-status is determined ONLY by actual uploaded module files.
 // This keeps the program overview honest: a text block/link alone does not mark a module as loaded.
 const uploadedModuleFiles=(await pool.query(`SELECT pc.module_id,pf.original_name,pf.mime_type,pf.file_size
  FROM program_module_content pc
  JOIN program_module_files pf ON pf.content_id=pc.id
  JOIN program_modules pm ON pm.id=pc.module_id
  JOIN program_sections ps ON ps.id=pm.section_id
  WHERE ps.program_id=$1
  ORDER BY pc.module_id,pc.display_order,pc.id`,[p.id])).rows;
 const uploadedFilesByModule=new Map();
 for(const f of uploadedModuleFiles){const mid=Number(f.module_id);if(!uploadedFilesByModule.has(mid))uploadedFilesByModule.set(mid,[]);uploadedFilesByModule.get(mid).push(f);}
 function moduleUploadStatus(moduleId){
  const fs=uploadedFilesByModule.get(Number(moduleId))||[];
  if(!fs.length)return `<span class="pill closed" title="No training file is uploaded to this module">NO FILE UPLOADED</span>`;
  const labels=[];
  for(const f of fs){
   const name=String(f.original_name||''); const ext=(name.split('.').pop()||'').toLowerCase();
   const label=ext==='pptx'||ext==='ppt'?'POWERPOINT':ext==='pdf'?'PDF':ext==='docx'||ext==='doc'?'WORD':ext==='xlsx'||ext==='xls'?'EXCEL':ext==='csv'?'CSV':ext==='txt'?'TEXT':(ext?ext.toUpperCase():'FILE');
   if(!labels.includes(label))labels.push(label);
  }
  const detail=fs.map(f=>String(f.original_name||'Uploaded file')).join(' • ');
  return `<span class="pill open" title="${esc(detail)}">✓ ${fs.length>1?fs.length+' FILES · ':''}${esc(labels.join(' + '))} UPLOADED</span>`;
 }
 const equipmentCard=`<div class="card" style="border-top:6px solid var(--red)"><div class="section-title"><div><div class="eyebrow">PROGRAM EQUIPMENT</div><div class="big">Equipment Selection</div><p class="muted">Select only the equipment models used in this modular program.</p></div><span class="pill open">${effectiveEquipment.length} SELECTED</span></div>${canEdit?`<form method="post" action="/instructor/programs/${p.id}/equipment"><div class="grid" style="margin-top:12px">${companyEquipment.map(eq=>`<label style="padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff"><input style="width:auto;margin-right:8px" type="checkbox" name="equipment_ids" value="${eq.id}" ${selectedEquipmentIds.has(Number(eq.id))?'checked':''}> ${esc(eq.name)}</label>`).join('')}</div><button style="margin-top:12px">Save Equipment Selection</button></form>`:`<div class="toolbar">${effectiveEquipment.map(eq=>`<span class="pill open">${esc(eq.name)}</span>`).join('')||'<span class="muted">No equipment selected.</span>'}</div>`}</div>`;
 const schedule=(await pool.query('SELECT * FROM program_schedule_items WHERE program_id=$1 ORDER BY display_order,id',[p.id])).rows;
 const dayOrder=['Monday','Tuesday','Wednesday','Thursday','Friday'];
 const scheduleHtml=dayOrder.map(day=>{const items=schedule.filter(x=>x.day_name===day&&x.active); if(!items.length)return ''; return `<div class="card"><div class="eyebrow">${esc(day.toUpperCase())}</div><div style="overflow:auto"><table><tr><th>Time</th><th>Schedule Item</th><th>Duration</th><th>Type</th><th></th></tr>${items.map(x=>`<tr><td><b>${esc(x.start_time||'')}</b></td><td>${esc(x.title)}</td><td>${Number(x.duration_minutes)>0?esc(String(x.duration_minutes))+' min':'—'}</td><td>${esc(x.item_type||'')}</td><td>${canEdit?`<a class="btn light" href="/instructor/programs/${p.id}/schedule/${x.id}/edit">Edit</a> <form method="post" action="/instructor/programs/${p.id}/schedule/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete this schedule item?')"><button class="danger">Delete</button></form>`:''}</td></tr>`).join('')}</table></div></div>`}).join('');
 const sectionHtml=tree.sections.map(sec=>{const mods=tree.modules.filter(m=>m.section_id===sec.id); const modRows=mods.map(m=>`<tr><td><b>${esc(m.title)}</b><br><span class="muted small">${esc(m.description||'')}</span></td><td>${esc(m.activity_type)}${Number(m.estimated_minutes)>0?`<br><span class="small muted">${m.estimated_minutes} min</span>`:''}</td><td>${m.required?'Required':'Optional'}</td><td>${m.active?'Active':'Hidden'}</td><td>${moduleUploadStatus(m.id)}</td><td>${canEdit?`<a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/content">Edit Content</a> <a class="btn light" href="/instructor/programs/${p.id}/module/${m.id}/edit">Edit Module</a> <form method="post" action="/instructor/programs/${p.id}/module/${m.id}/delete" style="display:inline" onsubmit="return confirm('Delete this module?')"><button class="danger">Delete</button></form>`:''}</td></tr>`).join(''); return `<div class="card"><div class="section-title"><div><div class="eyebrow">SECTION / TRACK</div><h2>${esc(sec.title)}</h2><p class="muted">${esc(sec.description||'')}</p></div>${canEdit?`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/section/${sec.id}/edit">Edit Section</a><form method="post" action="/instructor/programs/${p.id}/section/${sec.id}/delete" onsubmit="return confirm('Delete this section and every module inside it?')"><button class="danger">Delete</button></form></div>`:''}</div><div style="overflow:auto"><table><tr><th>Module</th><th>Activity Type</th><th>Requirement</th><th>Status</th><th>Uploaded Content</th><th></th></tr>${modRows||'<tr><td colspan="6">No modules in this section.</td></tr>'}</table></div>${canEdit?`<form method="post" action="/instructor/programs/${p.id}/module" style="margin-top:14px"><input type="hidden" name="section_id" value="${sec.id}"><div class="grid"><label>New Module<input name="title" required></label><label>Activity Type<select name="activity_type">${['Pre-Test','Post-Test','Regular Quiz','Video','Presentation / Lesson','Scavenger Hunt','Failure Simulation','Master Diagnostic Challenge','Hands-On Lab','Instructor-Led Activity','Ride & Drive','Skills Verification','Document / Resource','Custom Activity'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Estimated Minutes<input type="number" name="estimated_minutes" value="0"></label><label>Display Order<input type="number" name="display_order" value="100"></label></div><button>+ Add Module</button></form>`:''}</div>`}).join('');
 res.send(layout(p.title,`<div class="toolbar"><a class="btn light" href="/instructor/programs">← ${esc(brand('program_tab_title','Modular Programs'))}</a>${canEdit?`<a class="btn light" href="/instructor/programs/${p.id}/edit">Edit Program</a>`:''}</div><div class="hero"><div><div class="eyebrow">MODULAR TRAINING PROGRAM</div><h1>${esc(p.title)}</h1><p class="muted">${esc(p.description||'')}</p><div class="grid"><div class="stat"><span>PROGRAM CODE</span><b>${esc(p.join_code)}</b></div><div class="stat"><span>STUDENTS</span><b>${students}</b></div><div class="stat"><span>SECTIONS</span><b>${tree.sections.length}</b></div><div class="stat"><span>MODULES</span><b>${tree.modules.length}</b></div></div></div><div class="join-panel" style="position:static;max-width:330px"><div class="eyebrow">ONE PROGRAM QR CODE</div><img class="qr" src="${qr}"><p class="small muted">Students scan once to enter the entire program.</p><div style="word-break:break-all"><a href="${esc(joinUrl)}" target="_blank">${esc(joinUrl)}</a></div></div></div>${studentRosterCard}${equipmentCard}<div class="card"><div class="section-title"><div><div class="eyebrow">PROGRAM SCHEDULE</div><h2>3.5 Day Schedule</h2><p class="muted">The schedule below was loaded from your supplied HCE and 3100 spreadsheet. Every entry can be edited, added, or removed.</p></div></div>${canEdit?`<form method="post" action="/instructor/programs/${p.id}/schedule"><div class="grid"><label>Day<select name="day_name">${['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=>`<option>${d}</option>`).join('')}</select></label><label>Start Time<input name="start_time" placeholder="8:00 AM"></label><label>Duration Minutes<input type="number" name="duration_minutes" value="0"></label><label>Type<input name="item_type" value="Training"></label><label>Display Order<input type="number" name="display_order" value="900"></label></div><label>Schedule Item<input name="title" required></label><button>+ Add Schedule Item</button></form>`:''}</div>${scheduleHtml}${canEdit?`<div class="card"><div class="big">Add Section / Track</div><form method="post" action="/instructor/programs/${p.id}/section"><div class="grid"><label>Section Name<input name="title" placeholder="Example: FMCU Electrical & Diagnostics" required></label><label>Display Order<input type="number" name="display_order" value="100"></label></div><label>Description<textarea name="description" rows="2"></textarea></label><button>+ Add Section</button></form></div>`:''}${sectionHtml||'<div class="card"><p>No sections yet. Add the first section above.</p></div>'}`));
});

app.post('/instructor/programs/:id/equipment',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 let ids=req.body.equipment_ids||[]; if(!Array.isArray(ids))ids=[ids]; ids=[...new Set(ids.map(Number).filter(Number.isInteger))];
 const valid=ids.length?(await pool.query('SELECT id FROM company_equipment_models WHERE company_id=$1 AND active=true AND id=ANY($2::int[])',[req.account.company_id,ids])).rows.map(x=>Number(x.id)):[];
 if(!valid.length)return res.status(400).send('Select at least one equipment model for this modular program.');
 const client=await pool.connect(); try{await client.query('BEGIN');await client.query('UPDATE training_programs SET all_equipment=false WHERE id=$1 AND company_id=$2',[p.id,req.account.company_id]);await client.query('DELETE FROM training_program_equipment WHERE program_id=$1',[p.id]);for(const id of valid)await client.query('INSERT INTO training_program_equipment(program_id,equipment_model_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 res.redirect(`/instructor/programs/${p.id}`);
});

app.post('/instructor/programs/:id/schedule',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query(`INSERT INTO program_schedule_items(program_id,day_name,start_time,duration_minutes,title,item_type,display_order,active) VALUES($1,$2,$3,$4,$5,$6,$7,true)`,[p.id,String(req.body.day_name||'').trim(),String(req.body.start_time||'').trim(),Number(req.body.duration_minutes)||0,String(req.body.title||'').trim(),String(req.body.item_type||'Training').trim(),Number(req.body.display_order)||900]); res.redirect(`/instructor/programs/${p.id}`); });
app.get('/instructor/programs/:id/schedule/:sid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); const x=(await pool.query('SELECT * FROM program_schedule_items WHERE id=$1 AND program_id=$2',[req.params.sid,p.id])).rows[0]; if(!x)return res.status(404).send('Schedule item not found'); res.send(layout('Edit Schedule Item',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}">← Program</a></div><div class="card"><div class="big">Edit Schedule Item</div><form method="post" action="/instructor/programs/${p.id}/schedule/${x.id}/edit"><div class="grid"><label>Day<select name="day_name">${['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=>`<option ${x.day_name===d?'selected':''}>${d}</option>`).join('')}</select></label><label>Start Time<input name="start_time" value="${esc(x.start_time||'')}"></label><label>Duration Minutes<input type="number" name="duration_minutes" value="${Number(x.duration_minutes)||0}"></label><label>Type<input name="item_type" value="${esc(x.item_type||'')}"></label><label>Display Order<input type="number" name="display_order" value="${x.display_order}"></label></div><label>Schedule Item<input name="title" value="${esc(x.title)}" required></label><label><input style="width:auto" type="checkbox" name="active" value="1" ${x.active?'checked':''}> Active</label><button>Save Schedule Item</button></form></div>`)); });
app.post('/instructor/programs/:id/schedule/:sid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('UPDATE program_schedule_items SET day_name=$3,start_time=$4,duration_minutes=$5,title=$6,item_type=$7,display_order=$8,active=$9 WHERE id=$1 AND program_id=$2',[req.params.sid,p.id,String(req.body.day_name||'').trim(),String(req.body.start_time||'').trim(),Number(req.body.duration_minutes)||0,String(req.body.title||'').trim(),String(req.body.item_type||'Training').trim(),Number(req.body.display_order)||100,req.body.active==='1']); res.redirect(`/instructor/programs/${p.id}`); });
app.post('/instructor/programs/:id/schedule/:sid/delete',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('DELETE FROM program_schedule_items WHERE id=$1 AND program_id=$2',[req.params.sid,p.id]); res.redirect(`/instructor/programs/${p.id}`); });

app.post('/instructor/programs/:id/toggle',auth,async(req,res)=>{ if(!isEditorRole(req.account.role))return res.status(403).send('Edit access required'); await pool.query('UPDATE training_programs SET active=NOT active WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id]); res.redirect('/instructor/programs'); });
app.get('/instructor/programs/:id/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); res.send(layout('Edit Program',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}">← Program</a></div><div class="card"><div class="big">Edit Program</div><form method="post" action="/instructor/programs/${p.id}/edit"><label>Title<input name="title" value="${esc(p.title)}" required></label><label>Description<textarea name="description" rows="4">${esc(p.description||'')}</textarea></label><label>Display Order<input type="number" name="display_order" value="${p.display_order}"></label><button>Save Program</button></form><form method="post" action="/instructor/programs/${p.id}/delete" onsubmit="return confirm('Delete this entire program, all sections, modules, and program student progress?')" style="margin-top:18px"><button class="danger">Delete Entire Program</button></form></div>`)); });
app.post('/instructor/programs/:id/edit',auth,async(req,res)=>{ if(!isEditorRole(req.account.role))return res.status(403).send('Edit access required'); await pool.query('UPDATE training_programs SET title=$3,description=$4,display_order=$5 WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id,String(req.body.title||'').trim(),String(req.body.description||'').trim(),Number(req.body.display_order)||100]); res.redirect(`/instructor/programs/${req.params.id}`); });
app.post('/instructor/programs/:id/delete',auth,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).send('Edit access required');
 const p=await companyProgram(req.params.id,req.account.company_id);
 if(!p)return res.redirect('/instructor/programs');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // The Mahindra 14-module program is a seeded default. Record an intentional deletion so startup/page seeding will not bring it back.
  if(String(p.title||'').trim()==='Mahindra Service Training — 14 Module Program'){
   await client.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,'seed_mahindra14_program_disabled','true') ON CONFLICT(company_id,key) DO UPDATE SET value='true'`,[req.account.company_id]);
  }
  await client.query('DELETE FROM training_programs WHERE id=$1 AND company_id=$2',[p.id,req.account.company_id]);
  await client.query('COMMIT');
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  throw e;
 }finally{client.release();}
 res.redirect('/instructor/programs');
});
app.post('/instructor/programs/:id/section',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('INSERT INTO program_sections(program_id,title,description,display_order) VALUES($1,$2,$3,$4)',[p.id,String(req.body.title||'').trim(),String(req.body.description||'').trim(),Number(req.body.display_order)||100]); res.redirect(`/instructor/programs/${p.id}`); });
app.get('/instructor/programs/:id/section/:sid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); const sec=(await pool.query('SELECT * FROM program_sections WHERE id=$1 AND program_id=$2',[req.params.sid,p.id])).rows[0]; if(!sec)return res.status(404).send('Section not found'); res.send(layout('Edit Section',`<div class="card"><div class="big">Edit Section</div><form method="post" action="/instructor/programs/${p.id}/section/${sec.id}/edit"><label>Section Name<input name="title" value="${esc(sec.title)}" required></label><label>Description<textarea name="description">${esc(sec.description||'')}</textarea></label><label>Display Order<input type="number" name="display_order" value="${sec.display_order}"></label><label><input style="width:auto" type="checkbox" name="active" value="1" ${sec.active?'checked':''}> Active</label><button>Save Section</button></form></div>`)); });
app.post('/instructor/programs/:id/section/:sid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('UPDATE program_sections SET title=$3,description=$4,display_order=$5,active=$6 WHERE id=$1 AND program_id=$2',[req.params.sid,p.id,String(req.body.title||'').trim(),String(req.body.description||'').trim(),Number(req.body.display_order)||100,req.body.active==='1']); res.redirect(`/instructor/programs/${p.id}`); });
app.post('/instructor/programs/:id/section/:sid/delete',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('DELETE FROM program_sections WHERE id=$1 AND program_id=$2',[req.params.sid,p.id]); res.redirect(`/instructor/programs/${p.id}`); });
app.post('/instructor/programs/:id/module',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); const sec=(await pool.query('SELECT id FROM program_sections WHERE id=$1 AND program_id=$2',[req.body.section_id,p.id])).rows[0]; if(sec)await pool.query('INSERT INTO program_modules(section_id,title,activity_type,estimated_minutes,display_order) VALUES($1,$2,$3,$4,$5)',[sec.id,String(req.body.title||'').trim(),String(req.body.activity_type||'Instructor-Led Activity'),Number(req.body.estimated_minutes)||0,Number(req.body.display_order)||100]); res.redirect(`/instructor/programs/${p.id}`); });
app.get('/instructor/programs/:id/module/:mid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); const tree=await programTree(p.id); const m=tree.modules.find(x=>Number(x.id)===Number(req.params.mid)); if(!m)return res.status(404).send('Module not found'); const opts=tree.sections.map(s=>`<option value="${s.id}" ${s.id===m.section_id?'selected':''}>${esc(s.title)}</option>`).join(''); res.send(layout('Edit Module',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}">← Program</a><a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/content">Edit Module Content</a></div><div class="card"><div class="big">Edit Module</div><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/edit"><label>Module Title<input name="title" value="${esc(m.title)}" required></label><label>Section<select name="section_id">${opts}</select></label><label>Activity Type<input name="activity_type" value="${esc(m.activity_type)}"></label><label>Description<textarea name="description" rows="3">${esc(m.description||'')}</textarea></label><label>Activity Link / URL<input name="activity_url" value="${esc(m.activity_url||'')}" placeholder="Optional: link to an existing test, video, simulation, document, etc."></label><label>Instructions<textarea name="instructions" rows="4">${esc(m.instructions||'')}</textarea></label><div class="grid"><label>Estimated Minutes<input type="number" name="estimated_minutes" value="${Number(m.estimated_minutes)||0}"></label><label>Display Order<input type="number" name="display_order" value="${m.display_order}"></label><label><input style="width:auto" type="checkbox" name="required" value="1" ${m.required?'checked':''}> Required</label><label><input style="width:auto" type="checkbox" name="active" value="1" ${m.active?'checked':''}> Active</label></div><button>Save Module</button></form></div>`)); });
app.post('/instructor/programs/:id/module/:mid/edit',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); const sec=(await pool.query('SELECT id FROM program_sections WHERE id=$1 AND program_id=$2',[req.body.section_id,p.id])).rows[0]; if(sec)await pool.query('UPDATE program_modules SET section_id=$3,title=$4,activity_type=$5,description=$6,activity_url=$7,instructions=$8,estimated_minutes=$9,display_order=$10,required=$11,active=$12 WHERE id=$1 AND section_id IN (SELECT id FROM program_sections WHERE program_id=$2)',[req.params.mid,p.id,sec.id,String(req.body.title||'').trim(),String(req.body.activity_type||'').trim(),String(req.body.description||'').trim(),String(req.body.activity_url||'').trim(),String(req.body.instructions||'').trim(),Number(req.body.estimated_minutes)||0,Number(req.body.display_order)||100,req.body.required==='1',req.body.active==='1']); res.redirect(`/instructor/programs/${p.id}`); });


const OJA_SU_3100_PRE_POST_QUESTIONS=[
 ['How many forward and reverse speeds are provided on the 26 HP manual gear version?',['6 forward and 6 reverse','8 forward and 8 reverse','10 forward and 10 reverse','12 forward and 12 reverse'],1,'The 26 HP manual gear version is listed with 8 forward and 8 reverse speeds.'],
 ['How many operating ranges are provided on the 3100 HST version?',['Two','Three','Four','Five'],1,'The HST version uses three operating ranges.'],
 ['What type of speed control is provided within each HST range?',['Four fixed speeds','Six fixed speeds','Unlimited speed variation','Two-speed powershift'],2,'The HST provides unlimited speed variation within each of its three ranges.'],
 ['Which statement correctly describes the rear PTO on the 3100 SU platform?',['Two-speed, mechanically engaged','Single-speed, six-spline, electric push-button engagement','Variable-speed, pedal controlled','Ground-speed PTO only'],1,'The rear PTO is single-speed, uses a six-spline shaft, and is engaged by an electric push button.'],
 ['What does the HST unit do with engine power?',['Converts it directly into electrical power','Converts it into hydraulic power and then back into mechanical power','Sends it only to the PTO','Uses a dry clutch to create all travel speeds'],1,'The HST unit converts engine power into hydraulic power and then reconverts it into mechanical power.'],
 ['In the manual transmission, what does range selection primarily determine?',['Engine oil pressure','Vehicle speed range','PTO spline count','Hydraulic relief pressure'],1,'Range selection determines the vehicle speed range.'],
 ['What is one benefit of four-wheel-drive operation identified in the training?',['Lower battery voltage','Reduced PTO speed','Improved traction and reduced wheel slip','Elimination of the differential'],2,'Four-wheel-drive operation improves traction and reduces wheel slip.'],
 ['If the PTO will not engage, which item should be included in the technician\'s checks?',['PTO solenoid operation','Headlamp aim only','Fuel tank capacity','Front tire pressure only'],0,'PTO troubleshooting includes checking the PTO switch, PTO solenoid, hydraulic pressure, and wet clutch assembly.'],
 ['What is the main purpose of the HST neutral setting procedure?',['Increase road speed','Eliminate tractor creep when the pedals are released','Raise PTO horsepower','Increase hydraulic lift capacity'],1,'The HST neutral setting procedure is used to eliminate creeping with the forward and reverse pedals released.'],
 ['What torque is specified for Bolt (3) after setting HST neutral?',['10-15 Nm','20-25 Nm','30-35 Nm','45-50 Nm'],2,'Bolt (3) is tightened to 30-35 Nm while holding the eccentric pivot so it does not move.'],
 ['Where should the eccentric pivot groove be positioned to establish true HST neutral?',['At the first mark','At the second mark','At the midpoint between the two neutral-boundary marks','Fully clockwise'],2,'The eccentric pivot groove is positioned at the midpoint between the two neutral-boundary marks.'],
 ['What type of hydraulic circuit is listed for the 3100 SU?',['Closed-center','Open circuit','Load-sensing closed center only','Electric-hydraulic only'],1,'The hydraulic specifications list an open circuit for the gear and HST variants.'],
 ['What is the lift capacity at the hitch?',['700 kg','800 kg','900 kg','1,200 kg'],2,'The hydraulic specifications list 900 kg lift capacity at the hitch.'],
 ['What relief-valve operating pressure is specified for the hydraulic system?',['120-130 bar','145-155 bar','173-179 bar','200-210 bar'],2,'The hydraulic specification table lists relief-valve operating pressure at 173-179 bar.'],
 ['What alternator capacity is listed for the 3100 electrical system?',['12 V, 35 A','12 V, 45 A','12 V, 55 A','24 V, 55 A'],2,'The electrical specifications identify a 12-volt, 55-amp internal-fan alternator.'],
 ['What battery specification is listed in the electrical specifications?',['72 Ah, 650 CCA','85 Ah, 750 CCA','104 Ah, 925 CCA','120 Ah, 1,100 CCA'],2,'The battery is listed as 104 Ah with 925 CCA.'],
 ['Where is the fuse box located?',['Under the operator seat','In front of the radiator','Inside the rear axle housing','Behind the instrument cluster only'],1,'The fuse box location is listed as in front of the radiator.'],
 ['At what hour interval is the first scheduled service listed?',['25 hours','50 hours','100 hours','200 hours'],1,'The first scheduled service is listed at 50 hours.'],
 ['After the initial service, how often is engine oil changed under the listed schedule?',['Every 200 hours only','Every 300 hours or 6 months','Every 400 hours or 12 months','Every 800 hours or 24 months'],2,'Engine oil is changed initially at 50 hours and then every 400 hours or 12 months.'],
 ['What is the listed transmission-oil change interval for HST models?',['Every 400 hours or 12 months','Every 800 hours or 24 months','Every 1,200 hours or 12 months','Transmission oil is never changed'],0,'For HST models, the transmission-oil change interval is every 400 hours or 12 months.']
];

async function repairProgramTestAnswerKey(companyId,bank,expectedQuestions,markerSuffix){
 if(!bank||!Array.isArray(expectedQuestions)||!expectedQuestions.length)return;
 const markerKey=`program_test_answer_key_repair_${String(markerSuffix||bank.id)}`;
 const done=(await pool.query('SELECT value FROM company_settings WHERE company_id=$1 AND key=$2',[companyId,markerKey])).rows[0];
 if(done?.value==='done')return;
 const expected=new Map(expectedQuestions.map(q=>[String(q[0]||''),Number(q[2])]));
 const rows=(await pool.query('SELECT id,question,answer_index FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows;
 for(const r of rows){
  const key=String(r.question||'');
  if(!expected.has(key))continue;
  const idx=expected.get(key);
  if(Number(r.answer_index)!==idx)await pool.query('UPDATE program_test_questions SET answer_index=$2 WHERE id=$1',[r.id,idx]);
 }
 // Repair saved snapshots as well. Post-Test shuffling moves the entire question object,
 // so the correct answer index must travel with that exact question.
 const attempts=(await pool.query('SELECT * FROM program_test_attempts WHERE bank_id=$1 ORDER BY id',[bank.id])).rows;
 for(const a of attempts){
  let snap=Array.isArray(a.question_snapshot)?a.question_snapshot:[]; let changed=false;
  snap=snap.map(q=>{
   const key=String(q?.question||'');
   if(expected.has(key)){
    const idx=expected.get(key);
    if(Number(q.answer_index)!==idx){changed=true;return {...q,answer_index:idx};}
   }
   return q;
  });
  let correct=Number(a.correct_count)||0,score=a.score;
  if(a.status==='completed'){
   correct=0; const answers=(a.answers&&typeof a.answers==='object')?a.answers:{};
   for(let i=0;i<snap.length;i++){const ans=Number(answers[i]);if(Number.isFinite(ans)&&ans===Number(snap[i].answer_index))correct++;}
   score=snap.length?Math.round(correct*100/snap.length):0;
  }
  if(changed||a.status==='completed')await pool.query('UPDATE program_test_attempts SET question_snapshot=$2::jsonb,correct_count=$3,score=$4 WHERE id=$1',[a.id,JSON.stringify(snap),correct,score]);
 }
 await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,'done') ON CONFLICT(company_id,key) DO UPDATE SET value='done'`,[companyId,markerKey]);
}

async function ensureMahindra3100PrePostTest(companyId,programId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 if(!/mahindra/i.test(String(cq.rows[0]?.name||'')))return null;
 const section=(await pool.query(`SELECT s.* FROM program_sections s WHERE s.program_id=$1 AND (s.title ILIKE '3100 Service Training' OR s.title ILIKE '%3100%') ORDER BY CASE WHEN s.title='3100 Service Training' THEN 0 ELSE 1 END,id LIMIT 1`,[programId])).rows[0];
 if(!section)return null;
 const pre=(await pool.query(`SELECT * FROM program_modules WHERE section_id=$1 AND (activity_type='Pre-Test' OR title ILIKE '%3100%Pre%Test%') ORDER BY display_order,id LIMIT 1`,[section.id])).rows[0];
 const post=(await pool.query(`SELECT * FROM program_modules WHERE section_id=$1 AND (activity_type='Post-Test' OR title ILIKE '%3100%Post%Test%') ORDER BY display_order,id LIMIT 1`,[section.id])).rows[0];
 if(!pre&&!post)return null;
 const seedKey=`mahindra-3100-su-part2-pre-post-${programId}`;
 let bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[seedKey])).rows[0];
 if(!bank)bank=(await pool.query(`INSERT INTO program_test_banks(company_id,program_id,title,seed_key) VALUES($1,$2,$3,$4) RETURNING *`,[companyId,programId,'OJA Small Utility (SU) - Part 2 Assessment',seedKey])).rows[0];
 const count=Number((await pool.query('SELECT count(*)::int n FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows[0]?.n||0);
 if(count===0){
  let ord=10;
  for(const q of OJA_SU_3100_PRE_POST_QUESTIONS){
   await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[bank.id,q[0],JSON.stringify(q[1]),q[2],q[3]||'',ord]);
   ord+=10;
  }
 }
 await repairProgramTestAnswerKey(companyId,bank,OJA_SU_3100_PRE_POST_QUESTIONS,`oja3100_v2167_${programId}`);
 if(pre)await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,'Pre-Test',80,false) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode='Pre-Test',pass_score=80,randomize=false`,[pre.id,bank.id]);
 if(post)await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,'Post-Test',80,true) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode='Post-Test',pass_score=80,randomize=true`,[post.id,bank.id]);
 return bank;
}

const HCE_NEW_PRE_POST_QUESTIONS=[["When the operator leaves the seat while the PTO is engaged, which controller evaluates the safety logic?",["Engine ECU","FMCU","Instrument cluster","Alternator regulator"],1,"The 3100 FMCU training shows the FMCU receiving the operator-presence and PTO inputs, evaluating the safety logic, and commanding the warning/buzzer/PTO response."],["During diagnosis of an intermittent electrical fault, what is recommended at major ground points?",["Replace the controller first","Measure resistance only with the battery disconnected","Perform a voltage-drop test under load","Increase fuse size"],2,"The FMCU/electrical training specifically recommends voltage-drop testing across ground points when electrical faults are suspected."],["What is one reason technicians should know the physical locations of electrical components and ground points?",["It reduces troubleshooting time","It increases PTO speed","It changes hydraulic pressure","It eliminates the need for wiring diagrams"],0,"The training states that knowing component and ground locations helps technicians inspect wiring, connectors, relays, fuses, and control modules more quickly."],["In the FMCU PTO safety example, which input indicates the operator is no longer detected in the seat?",["Vehicle Speed = 0","PTO = ON","OPS = OFF","Park Brake = ON"],2,"The example identifies OPS = OFF when the operator leaves the seat."],["Where was the battery relocated on the 5100 Refresh?",["Behind the rear axle","Under the operator platform","In front of the radiator under the hood","Inside the clutch housing"],2,"The 5100 Refresh material states that the battery mounting was shifted from the side to the front of the radiator inside the hood."],["What change was made to the 5100 Refresh air-cleaner location?",["Moved to the front of the radiator","Moved behind the engine","Mounted under the operator platform","Removed from the tractor"],0,"The air cleaner was relocated to the front of the radiator."],["What is the displacement of the 5100 Refresh engine?",["2,732 cc","2,987 cc","3,200 cc","3,500 cc"],1,"The 5100 Refresh engine specification lists 2,987 cc displacement."],["What is the stated benefit of the modified water pump on the 5100 Refresh engine?",["Higher fuel pressure","Faster coolant circulation","Higher alternator output","Lower PTO speed"],1,"The training identifies faster coolant circulation as the benefit of the modified water pump."],["How is the engine oil pump driven on the 5100 Refresh engine?",["By an electric motor","By the camshaft","Crankshaft mounted","By the PTO shaft"],2,"The engine oil pump drive was changed to a crankshaft-mounted arrangement."],["Which transmission section contains the dual-clutch system and forward-reverse shuttle assembly?",["Clutch housing","Speed housing","Rear axle housing","PTO housing"],0,"The 5100 transmission material identifies the clutch housing as containing the dual clutch and forward-reverse shuttle assembly."],["What type of gears are used in the 5100 transmission speed housing?",["Sliding spur gears","Chain-driven gears","Full constant-mesh helical gears","Planetary-only gears"],2,"The speed housing uses full constant-mesh helical gears."],["How many forward and reverse speeds are provided by the 5100 four-speed gearbox, three ranges, and forward-reverse shuttle?",["8 forward / 8 reverse","10 forward / 10 reverse","12 forward / 12 reverse","16 forward / 8 reverse"],2,"The four-speed gearbox with three ranges and the shuttle provides 12 forward and 12 reverse speeds."],["Which ASABE-related feature is identified in the 6000 HCE training?",["Intentional PTO switch","Mechanical-only cluster","Removal of operator-presence logic","Elimination of automatic 4WD"],0,"The 6000 HCE training identifies the intentional PTO switch as an ASABE-related change."],["What alternator capacity is identified for the 6000 HCE?",["35 A","45 A","55 A","75 A"],2,"The 6000 HCE training identifies a 55-amp alternator."],["What hitch-pump flow is identified for the 6000 HCE after the increase?",["38 L/min","40 L/min","42 L/min","44 L/min"],3,"The training indicates the hitch-pump flow increased from 42 L/min to 44 L/min."],["Which engine ECU is identified for the HCE Tier IV 6000 Series?",["EDC17C55","MD1CS162","EMS-C55","FMCU MUX V4.0"],1,"The HCE Tier IV 6000 Series training identifies the EMS ECU as MD1CS162."],["How does the 6000 HCE instrument cluster receive engine RPM information?",["Mechanical tachometer cable","Analog fuel-level circuit","CAN message from the engine ECU","Direct battery-voltage measurement"],2,"The training identifies engine RPM as information received by the cluster through a CAN message from the engine ECU."],["Under the park-brake logic shown in the 6000 HCE training, when does the buzzer sound?",["Park brake disengaged and tractor in neutral","Park brake engaged, neutral not indicated, and vehicle speed above 0.1 km/h","Ignition off and clutch depressed","Vehicle stopped with neutral indicated"],1,"The training answer key identifies the buzzer condition as park brake engaged, neutral not indicated, and vehicle speed above 0.1 km/h."],["Which listed warning has the highest buzzer priority in the 6000 HCE training?",["Service reminder","Air-filter clog","OPS alarm","Battery-charge indication"],2,"The 6000 HCE answer key identifies the OPS alarm as the highest listed buzzer priority."],["What practice is listed as a DO when servicing CRDi electrical systems?",["Perform ECU electrical work with power on","Bypass fault codes to speed diagnosis","Disconnect the battery before servicing the ECU","Mix sensor types if connectors fit"],2,"The 6000 HCE training lists disconnecting the battery before servicing the ECU as a correct practice."]];



async function forceRepairNewHCEPrePostV2169(){
 const expected=new Map(HCE_NEW_PRE_POST_QUESTIONS.map(q=>[String(q[0]),{choices:q[1],answer_index:Number(q[2]),explanation:String(q[3]||'')} ]));
 const banks=(await pool.query(`SELECT DISTINCT b.id,b.company_id,b.program_id,b.title
   FROM program_test_banks b
   JOIN program_test_questions q ON q.bank_id=b.id
   WHERE q.question = ANY($1::text[])`,[Array.from(expected.keys())])).rows;
 for(const bank of banks){
  const rows=(await pool.query('SELECT id,question,choices,answer_index,explanation FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows;
  for(const r of rows){
   const e=expected.get(String(r.question||'')); if(!e)continue;
   const choices=Array.isArray(r.choices)?r.choices:[];
   if(Number(r.answer_index)!==e.answer_index || JSON.stringify(choices)!==JSON.stringify(e.choices) || String(r.explanation||'')!==e.explanation){
    await pool.query('UPDATE program_test_questions SET choices=$2::jsonb,answer_index=$3,explanation=$4 WHERE id=$1',[r.id,JSON.stringify(e.choices),e.answer_index,e.explanation]);
   }
  }
  const attempts=(await pool.query('SELECT * FROM program_test_attempts WHERE bank_id=$1 ORDER BY id',[bank.id])).rows;
  for(const a of attempts){
   let snap=Array.isArray(a.question_snapshot)?a.question_snapshot:[];
   let changed=false;
   snap=snap.map(q=>{
    const e=expected.get(String(q?.question||'')); if(!e)return q;
    const next={...q,choices:[...e.choices],answer_index:e.answer_index,explanation:e.explanation};
    if(Number(q?.answer_index)!==e.answer_index || JSON.stringify(q?.choices||[])!==JSON.stringify(e.choices) || String(q?.explanation||'')!==e.explanation)changed=true;
    return next;
   });
   let correct=Number(a.correct_count)||0,score=a.score;
   if(a.status==='completed'){
    correct=0; const answers=(a.answers&&typeof a.answers==='object')?a.answers:{};
    for(let i=0;i<snap.length;i++){
     const ans=Number(answers[i]);
     if(Number.isFinite(ans)&&ans===Number(snap[i]?.answer_index))correct++;
    }
    score=snap.length?Math.round(correct*100/snap.length):0;
   }
   if(changed||a.status==='completed')await pool.query('UPDATE program_test_attempts SET question_snapshot=$2::jsonb,correct_count=$3,score=$4 WHERE id=$1',[a.id,JSON.stringify(snap),correct,score]);
  }
  await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,'done') ON CONFLICT(company_id,key) DO UPDATE SET value='done'`,[bank.company_id,`hce_new_force_repair_v2169_${bank.program_id||bank.id}`]);
 }
}

// 2.1.69 startup self-heal: repair the already-imported HCE bank and all saved attempts
// immediately on every deployment, without requiring the instructor to open the test editor first.
await forceRepairNewHCEPrePostV2169();

const HCE_PRE_POST_QUESTIONS=[
 ['Which horsepower versions are listed in the 3100 SU model tree?',['26 HP only','26 and 35 HP','26, 35, and 40 HP','35 and 40 HP only'],2],
 ['How is the 3100 SU fuel system described in the training material?',['Mechanical inline injection','Carbureted gasoline','ECU-controlled common-rail direct injection','Mechanical rotary-pump indirect injection'],2],
 ['Which statement correctly describes the 3100 SU air-intake configurations?',['All versions are naturally aspirated','Only the 26 HP version is turbocharged','The 35 and 40 HP versions are turbocharged, while the 26 HP version is naturally aspirated','All versions use the same turbocharger'],2],
 ['On 3100 HST models, what is one primary benefit of the transmission oil cooler?',['It increases PTO speed','It protects HST seals and O-rings from heat-related damage','It increases engine oil pressure','It eliminates the need for transmission oil'],1],
 ['Before replacing an electronic controller for an intermittent electrical complaint, what ground-circuit test is specifically recommended?',['Resistance check with the battery disconnected only','Voltage-drop test under load','Continuity check of the positive cable only','Fuse-size comparison'],1],
 ['Which group contains inputs used by the 3100 safety and operating logic?',['Operator presence, PTO status, neutral status, vehicle speed, and park brake','Fuel level, tire pressure, horn switch, and headlight aim','Engine oil brand, coolant color, and wheel size','Only engine RPM and battery voltage'],0],
 ['When using a 3100 FMCU logic table, what is the correct diagnostic process?',['Replace the output device first','Match the tractor inputs, check the expected output, then test the difference','Clear all faults and retest without checking inputs','Ignore the input side and test only the controller output'],1],
 ['On the 5100 Refresh, which component was moved from the side of the tractor to the front area under the hood?',['PTO housing','Battery','Rear axle','Clutch housing'],1],
 ['What change was made to the air-cleaner location on the 5100 Refresh?',['It was removed','It was moved behind the engine','It was moved to the front of the radiator','It was mounted under the operator platform'],2],
 ['What engine displacement is listed for the 5100 Refresh?',['2,732 cc','2,987 cc','3,200 cc','3,500 cc'],1],
 ['What type of gears are used in the 5100 transmission speed housing?',['Sliding spur gears','Planetary-only gears','Full constant-mesh helical gears','Chain-driven gears'],2],
 ['How many forward and reverse speeds are provided by the 5100 four-speed gearbox, three-range transmission, and forward-reverse shuttle?',['8 forward and 8 reverse','10 forward and 10 reverse','12 forward and 12 reverse','16 forward and 8 reverse'],2],
 ['What final-drive arrangement is used on the 5100 Refresh rear axle in place of the previous bull-gear setup?',['Chain reduction','Planetary gearing','Belt reduction','Hydraulic motor drive'],1],
 ['How does the 5100 instrument cluster receive engine RPM information?',['Through a mechanical cable from the crankshaft','Through an analog fuel-level circuit','Through a CAN message from the engine ECU','Directly from battery voltage'],2],
 ['Which of the following is listed as an ASABE-related change on the 6000 HCE?',['Intentional PTO switch','Mechanical-only instrument cluster','Removal of the operator-presence sensor','Elimination of automatic 4WD'],0],
 ['What alternator capacity is identified for the 6000 HCE electrical system?',['35 amp','45 amp','55 amp','75 amp'],2],
 ['What hitch-pump flow increase is identified for the 6000 HCE?',['30 to 35 L/min','38 to 40 L/min','42 to 44 L/min','44 to 50 L/min'],2],
 ['Which engine ECU is identified for the HCE Tier IV 6000 Series?',['EDC17C55','MD1CS162','EMS-C55','FMCU MUX V4.0'],1],
 ['What engine-drive change is identified on the 6000 HCE?',['A single-belt design','A chain-driven accessory system','A dual-belt-only design','Removal of the accessory drive'],0],
 ['What is the role of the FMCU on the 6000 HCE?',['It manages vehicle functions and safety-related inputs','It replaces the engine ECU and controls fuel injection','It only controls the cab air conditioner','It only stores service-hour information'],0]
];

function canonicalTestMode(value=''){
 const v=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
 // Only explicit test content/activity types are tests. Do not use substring
 // matching here: "Presentation / Lesson" begins with "pre" and was being
 // incorrectly classified as a Pre-Test, which hid the training-file uploader.
 if(/^pre(?:\s*-\s*|\s+)test$/.test(v))return 'Pre-Test';
 if(/^post(?:\s*-\s*|\s+)test$/.test(v))return 'Post-Test';
 if(v==='quiz'||v==='regular quiz')return 'Quiz';
 return '';
}
function normalizedMatchedTestBase(text=''){
 return String(text||'')
  .toLowerCase()
  .replace(/\b(pre|post)[ -]?test\b/g,'')
  .replace(/\bpre\b|\bpost\b/g,'')
  .replace(/[^a-z0-9]+/g,' ')
  .trim();
}
async function ensureNativeModuleTest(programId,companyId,moduleId,modeHint,titleHint=''){
 const mode=canonicalTestMode(modeHint||titleHint); if(!mode)return null;
 const mod=(await pool.query(`SELECT m.*,s.program_id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE m.id=$1 AND s.program_id=$2`,[moduleId,programId])).rows[0];
 if(!mod)return null;
 let link=(await pool.query(`SELECT l.*,b.title bank_title FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id WHERE l.module_id=$1`,[moduleId])).rows[0];
 if(link){
  if(link.test_mode!==mode)await pool.query('UPDATE program_module_test_links SET test_mode=$2,randomize=$3 WHERE module_id=$1',[moduleId,mode,mode==='Post-Test']);
  return (await pool.query(`SELECT l.*,b.title bank_title FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id WHERE l.module_id=$1`,[moduleId])).rows[0];
 }
 const combined=`${mod.title||''} ${titleHint||''}`;
 const isHCE=/\bHCE\b/i.test(combined);
 let bank=null;
 if(isHCE){
  const seedKey=`hce-pre-post-${programId}`;
  bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[seedKey])).rows[0];
  if(!bank)bank=(await pool.query(`INSERT INTO program_test_banks(company_id,program_id,title,seed_key) VALUES($1,$2,'HCE Training Assessment',$3) RETURNING *`,[companyId,programId,seedKey])).rows[0];
  const count=Number((await pool.query('SELECT count(*)::int n FROM program_test_questions WHERE bank_id=$1',[bank.id])).rows[0]?.n||0);
  if(count===0){
   let ord=10;
   for(const q of HCE_PRE_POST_QUESTIONS){
    await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,'',$5)`,[bank.id,q[0],JSON.stringify(q[1]),q[2],ord]);
    ord+=10;
   }
  }
  await repairProgramTestAnswerKey(companyId,bank,HCE_PRE_POST_QUESTIONS,`hce_v2167_${programId}`);
  await repairProgramTestAnswerKey(companyId,bank,HCE_NEW_PRE_POST_QUESTIONS,`hce_new_v2168_${programId}`);
 }else{
  const base=normalizedMatchedTestBase(combined)||`module-${moduleId}`;
  const seedKey=`matched-test-${programId}-${base.replace(/\s+/g,'-').slice(0,80)}`;
  bank=(await pool.query('SELECT * FROM program_test_banks WHERE seed_key=$1',[seedKey])).rows[0];
  if(!bank)bank=(await pool.query(`INSERT INTO program_test_banks(company_id,program_id,title,seed_key) VALUES($1,$2,$3,$4) RETURNING *`,[companyId,programId,String(titleHint||mod.title||'Training Assessment').replace(/\bPre-Test\b|\bPost-Test\b/gi,'').trim()||'Training Assessment',seedKey])).rows[0];
 }
 await pool.query(`INSERT INTO program_module_test_links(module_id,bank_id,test_mode,pass_score,randomize) VALUES($1,$2,$3,80,$4) ON CONFLICT(module_id) DO UPDATE SET bank_id=EXCLUDED.bank_id,test_mode=EXCLUDED.test_mode,randomize=EXCLUDED.randomize`,[moduleId,bank.id,mode,mode==='Post-Test']);
 return (await pool.query(`SELECT l.*,b.title bank_title FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id WHERE l.module_id=$1`,[moduleId])).rows[0];
}
async function repairModuleNativeTests(programId,companyId,moduleIds=[]){
 if(!moduleIds.length)return;
 const rows=(await pool.query(`SELECT pc.*,m.title module_title FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$1 AND pc.module_id=ANY($2::int[]) AND pc.active=true AND lower(pc.content_type) IN ('pre-test','post-test','regular quiz') ORDER BY pc.module_id,pc.display_order,pc.id`,[programId,moduleIds])).rows;
 const grouped=new Map();
 for(const x of rows){
  const mode=canonicalTestMode(x.content_type); if(!mode)continue;
  const key=`${x.module_id}:${mode}`;
  if(!grouped.has(key))grouped.set(key,[]);
  grouped.get(key).push(x);
 }
 for(const list of grouped.values()){
  const keep=list[0];
  await ensureNativeModuleTest(programId,companyId,keep.module_id,keep.content_type,`${keep.module_title||''} ${keep.title||''}`);
  if(list.length>1){
   const ids=list.slice(1).map(x=>x.id);
   await pool.query('DELETE FROM program_module_content WHERE id=ANY($1::int[])',[ids]);
  }
 }
 // Self-heal links accidentally created by the old substring test detector.
 // Preserve intentional test modules (Pre-Test/Post-Test/Quiz activity types)
 // and special native assessments such as Knowledge Assessment.
 const mods=(await pool.query(`SELECT m.id,m.activity_type FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$1 AND m.id=ANY($2::int[])`,[programId,moduleIds])).rows;
 for(const mod of mods){
  const hasExplicitContent=rows.some(x=>Number(x.module_id)===Number(mod.id)&&canonicalTestMode(x.content_type));
  const activityMode=canonicalTestMode(mod.activity_type);
  if(!hasExplicitContent&&!activityMode){
   await pool.query(`DELETE FROM program_module_test_links WHERE module_id=$1 AND test_mode IN ('Pre-Test','Post-Test','Quiz')`,[mod.id]);
  }
 }
}

const PROGRAM_CONTENT_TYPES=['Overview / Text','Presentation / Lesson','Video','Pre-Test','Post-Test','Regular Quiz','Scavenger Hunt','Failure Simulation','Master Diagnostic Challenge','Hands-On Lab','Instructor-Led Activity','Ride & Drive','Skills Verification','Document / Resource','Existing Hub Activity','Custom Activity'];
function normalizeStudentVisibility(v){const x=String(v||'visible').trim().toLowerCase();return ['visible','locked','hidden'].includes(x)?x:'visible';}
function studentVisibilityLabel(v){const x=normalizeStudentVisibility(v);return x==='locked'?'Locked':x==='hidden'?'Hidden':'Visible';}
function studentVisibilityPill(v){const x=normalizeStudentVisibility(v);return x==='visible'?'<span class="pill open">Student: Visible</span>':x==='locked'?'<span class="pill testing">Student: Locked</span>':'<span class="pill closed">Student: Hidden</span>';}


app.get('/instructor/programs/:id/module/:mid/content',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found');
 const tree=await programTree(p.id); const m=tree.modules.find(x=>Number(x.id)===Number(req.params.mid)); if(!m)return res.status(404).send('Module not found');
 await repairModuleNativeTests(p.id,req.account.company_id,[m.id]);
 await dedupeModuleScavengerContent(p.id,m.id);
 const sec=tree.sections.find(x=>Number(x.id)===Number(m.section_id));
 const items=(await pool.query(`SELECT pc.*,pf.id file_id,pf.original_name,pf.mime_type,pf.file_size FROM program_module_content pc LEFT JOIN program_module_files pf ON pf.content_id=pc.id WHERE pc.module_id=$1 ORDER BY pc.display_order,pc.id`,[m.id])).rows;
 const testLink=(await pool.query(`SELECT l.*,b.title bank_title,(SELECT count(*)::int FROM program_test_questions q WHERE q.bank_id=b.id) question_count FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id WHERE l.module_id=$1`,[m.id])).rows[0];
 const huntChoices=await programHuntChoices(req.account.company_id);
 const canEdit=isEditorRole(req.account.role);
 const moduleTitle=String(m.title||'');
 const simPrefix=moduleTitle.includes('Module 4A')?'seg1-':moduleTitle.includes('Module 4B')?'seg2-':'';
 const linkedSimulations=simPrefix?allSimulationKeys().filter(k=>k.startsWith(simPrefix)).sort((a,b)=>String(simByKey(a)?.workOrder||'').localeCompare(String(simByKey(b)?.workOrder||''))):[];
 const linkedSimulationPanel=linkedSimulations.length?`<div class="card" style="border-top:6px solid var(--red)"><div class="section-title"><div><div class="eyebrow">NATIVE MODULE SIMULATIONS</div><div class="big">${simPrefix==='seg1-'?'Segment 1 — 10 Simulations':'Segment 2 — 10 Simulations'}</div></div><span class="pill open">${linkedSimulations.length} LINKED</span></div><p class="muted">These are built directly into this module. Students see and launch these simulations from Module ${simPrefix==='seg1-'?'4A':'4B'} without going to the separate Simulation Library.</p>${linkedSimulations.map((key,i)=>{const sim=simByKey(key);return `<div style="margin:10px 0;padding:14px;border:1px solid #ddd;border-radius:12px;background:#fff"><div class="section-title"><div><div class="eyebrow">${esc(sim.workOrder)} · ${i+1} OF 10</div><b>${esc(sim.title)}</b></div><a class="btn light" href="/instructor/simulations/${encodeURIComponent(sim.key)}/edit">Edit Simulation</a></div><p class="small"><b>Customer Complaint:</b> ${esc(sim.complaint)}</p></div>`;}).join('')}</div>`:'';
 const rows=items.map(x=>{
  const vis=normalizeStudentVisibility(x.student_visibility);
  const isHunt=isScavengerContent(x), linkedHuntId=huntClassRef(x.resource_url), linkedHunt=huntChoices.find(h=>Number(h.id)===linkedHuntId);
  const huntOptions=['<option value="">— Select Existing Training Hub Hunt —</option>',...huntChoices.map(h=>`<option value="${h.id}" ${Number(h.id)===linkedHuntId?'selected':''}>${esc(h.course||h.title)} · Class ${esc(h.code)} · ${h.item_count} items${h.models?' · '+esc(h.models):''}</option>`)].join('');
  return `<div class="q" style="border-left:5px solid ${x.active?'var(--red)':'#999'}"><div class="section-title"><div><div class="eyebrow">${esc(x.content_type)}</div><div class="big" style="font-size:20px">${esc(x.title)}</div><div class="small muted">Order ${x.display_order} · ${x.active?'Content enabled':'Content disabled'}</div><div style="margin-top:6px">${studentVisibilityPill(vis)}</div></div>${canEdit?`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/edit">Edit</a><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/visibility/visible"><button class="btn light">Student Visible</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/visibility/locked"><button class="btn light">Lock</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/visibility/hidden"><button class="btn light">Hide</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/toggle"><button class="btn light">${x.active?'Disable Content':'Enable Content'}</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/delete" onsubmit="return confirm('Delete this module content?')"><button class="danger">Delete</button></form></div>`:''}</div>${x.body?`<p style="white-space:pre-wrap">${esc(x.body)}</p>`:''}${isHunt?`<div class="card" style="margin-top:12px;background:#fafafa;border-top:5px solid var(--red)"><div class="eyebrow">EXISTING TRAINING HUB HUNT</div><div class="big" style="font-size:18px">${linkedHunt?`Linked: ${esc(linkedHunt.course||linkedHunt.title)} · Class ${esc(linkedHunt.code)}`:'Choose the hunt already built in the Training Hub'}</div>${linkedHunt?`<div class="success" style="margin:10px 0"><b>${linkedHunt.item_count} hunt items</b>${linkedHunt.models?` · ${esc(linkedHunt.models)}`:''}</div>`:''}${canEdit?`<form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/hunt-link"><label>Select Existing Hunt<select name="hunt_class_id">${huntOptions}</select></label><button>${linkedHunt?'Change Linked Hunt':'Link Hunt to Module'}</button></form>`:''}<div class="toolbar" style="margin-top:10px">${linkedHunt?`<a class="btn light" href="/instructor/hunt/${linkedHunt.id}">Open / Edit This Hunt</a>`:`<a class="btn light" href="/instructor/hunt-select">Open Scavenger Hunt Library</a>`}</div></div>`:x.resource_url?`<a class="btn" href="${esc(x.resource_url)}" target="_blank">Open Resource / Activity</a>`:''}${!isHunt&&x.file_id?`<div class="success" style="margin-top:12px"><b>Uploaded Training File:</b> ${esc(x.original_name)} · ${Math.max(1,Math.round(Number(x.file_size||0)/1024))} KB<div class="toolbar" style="margin-top:8px">${isModuleVideoFile(x)?`<video controls preload="metadata" style="display:block;width:100%;max-width:800px;margin:10px 0;background:#000;border-radius:10px" src="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/file"></video>`:''}<a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/file" target="_blank">${isModuleVideoFile(x)?'Open Video':'Open / Download File'}</a><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content/${x.id}/file/delete" onsubmit="return confirm('Remove the uploaded file from this module?')"><button class="danger">Remove File</button></form></div></div>`:''}${canonicalTestMode(x.content_type)?`<div class="success" style="margin-top:12px"><b>Native Training Hub ${esc(canonicalTestMode(x.content_type))}</b><br>This content block launches the built-in test on the student side. Questions are managed in the Test Bank, not as a PowerPoint/file.${testLink?`<div class="toolbar" style="margin-top:8px"><a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/test">Edit / Import Test Questions</a></div>`:''}</div>`:!isHunt&&canEdit?`<div class="card" style="margin-top:12px;background:#fafafa"><b>${x.file_id?'Replace':'Upload'} PowerPoint / Training File</b><p class="small muted">Stored directly in The Training Hub database using large-file chunked upload. No GitHub, SharePoint, OneDrive, or external host is required. Maximum 2 GB.</p><input type="file" id="moduleFile-${x.id}" accept=".pptx,.ppt,.pdf,.docx,.xlsx,.xls,.txt,.csv,.mp4,.m4v,.mov,.webm,video/*"><button type="button" style="margin-top:8px" onclick="uploadModuleFile(${x.id},${p.id},${m.id})">${x.file_id?'Replace File':'Upload File'}</button><div id="moduleFileStatus-${x.id}" class="small muted" style="margin-top:6px"></div></div>`:''}</div>`;
 }).join('');
 const add=canEdit?`<div class="card" style="border-top:6px solid var(--red)"><div class="big">+ Add Module Content</div><p class="muted">Add as many content blocks as this module needs. They appear to students in display-order sequence.</p><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/content"><div class="grid"><label>Content Type<select name="content_type">${PROGRAM_CONTENT_TYPES.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label>Display Order<input type="number" name="display_order" value="${items.length?Math.max(...items.map(x=>Number(x.display_order)||0))+10:10}"></label></div><label>Content Title<input name="title" placeholder="Example: FMCU Diagnostic Presentation" required></label><label>Text / Student Instructions<textarea name="body" rows="6" placeholder="Enter lesson text, instructions, lab steps, instructor directions, or student directions here."></textarea></label><label>Resource / Activity Link<input name="resource_url" placeholder="Optional. Leave blank if you will upload the PowerPoint/file directly after adding this content block."></label><div class="alert"><b>Direct file upload:</b> Add this content block first. Then use the Upload PowerPoint / Training File box that appears on the saved content item below.</div><div class="grid"><label>Student Access<select name="student_visibility"><option value="visible">Visible — students can open it</option><option value="locked">Locked — students see it but cannot open it</option><option value="hidden">Hidden — students do not see it</option></select></label><label><input style="width:auto" type="checkbox" name="active" value="1" checked> Content enabled</label></div><button>Add Content</button></form></div>`:'';
 const mediaBulk=canEdit?`<div class="card" style="border-top:6px solid #171717"><div class="section-title"><div><div class="eyebrow">STUDENT MEDIA ACCESS</div><div class="big">PowerPoint & Video Controls</div></div><span class="pill">Instructor always has access</span></div><p class="muted">These controls only change what students can see/open in this module. Instructor and Owner access is never blocked.</p><div class="toolbar"><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/media-visibility/visible"><button class="btn">Show All PowerPoints & Videos</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/media-visibility/locked"><button class="btn light">Lock All PowerPoints & Videos</button></form><form method="post" action="/instructor/programs/${p.id}/module/${m.id}/media-visibility/hidden"><button class="danger">Hide All PowerPoints & Videos</button></form></div><div class="small muted" style="margin-top:10px"><b>Visible:</b> student can open · <b>Locked:</b> title is shown but cannot be opened · <b>Hidden:</b> student does not see the item.</div></div>`:'';
 res.send(layout('Module Content Editor',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}">← Program</a><a class="btn light" href="/instructor/programs/${p.id}/module/${m.id}/edit">Edit Module Details</a>${testLink?`<a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/test">Edit ${esc(testLink.test_mode)} Questions</a>`:''}</div>${testLink?`<div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">NATIVE MATCHED TEST</div><div class="big">${esc(testLink.test_mode)} · ${esc(testLink.bank_title)}</div><p><b>${testLink.question_count}</b> question(s). This module is linked to the same FMCU question bank as its matching Pre/Post module. Editing the bank updates both tests.</p><a class="btn" href="/instructor/programs/${p.id}/module/${m.id}/test">Edit Test Bank</a></div>`:''}<div class="hero"><div><div class="eyebrow">MODULE CONTENT EDITOR</div><h1>${esc(m.title)}</h1><p class="muted">${esc(sec?.title||'')} · ${esc(m.activity_type)}${Number(m.estimated_minutes)>0?' · '+m.estimated_minutes+' min':''}</p></div><span class="pill">${items.length} CONTENT ITEM${items.length===1?'':'S'}</span></div>${linkedSimulationPanel}${add}${mediaBulk}<div class="card"><div class="big">Module Content</div><p class="muted">Edit, hide, reorder, or remove anything below. Nothing is hard-coded.</p>${rows||'<div class="alert"><b>No content has been added yet.</b><br>Use + Add Module Content above to build this module.</div>'}</div><script>async function uploadModuleFile(cid,pid,mid){const input=document.getElementById('moduleFile-'+cid),status=document.getElementById('moduleFileStatus-'+cid);if(!input||!input.files||!input.files[0]){status.textContent='Choose a file first.';return;}const f=input.files[0];const max=2*1024*1024*1024;if(f.size>max){status.textContent='File is larger than the 2 GB limit.';return;}const ext=(f.name.split('.').pop()||'').toLowerCase();if(!['pptx','ppt','pdf','docx','xlsx','xls','txt','csv','mp4','m4v','mov','webm'].includes(ext)){status.textContent='That file type is not allowed.';return;}const token=(document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/)||[])[1]||'';const headers={'X-CSRF-Token':decodeURIComponent(token)};const base='/instructor/programs/'+pid+'/module/'+mid+'/content/'+cid+'/file-chunked';let uploadId=null;try{status.textContent='Preparing '+f.name+'...';let r=await fetch(base+'/start?name='+encodeURIComponent(f.name)+'&mime='+encodeURIComponent(f.type||'application/octet-stream')+'&size='+encodeURIComponent(f.size),{method:'POST',headers});let j=await r.json().catch(()=>({ok:false,error:'Could not start upload'}));if(!r.ok||!j.ok)throw new Error(j.error||'Could not start upload');uploadId=j.file_id;const chunkSize=4*1024*1024,total=Math.max(1,Math.ceil(f.size/chunkSize));for(let i=0;i<total;i++){const start=i*chunkSize,end=Math.min(start+chunkSize,f.size),blob=f.slice(start,end);status.textContent='Uploading '+f.name+' — '+Math.round((i/total)*100)+'% ('+(i+1)+' of '+total+')';r=await fetch(base+'/chunk?file_id='+encodeURIComponent(uploadId)+'&chunk_no='+i,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:await blob.arrayBuffer()});j=await r.json().catch(()=>({ok:false,error:'Chunk upload failed'}));if(!r.ok||!j.ok)throw new Error(j.error||('Upload failed at chunk '+(i+1)));}status.textContent='Finalizing upload...';r=await fetch(base+'/complete?file_id='+encodeURIComponent(uploadId)+'&size='+encodeURIComponent(f.size),{method:'POST',headers});j=await r.json().catch(()=>({ok:false,error:'Could not finalize upload'}));if(!r.ok||!j.ok)throw new Error(j.error||'Could not finalize upload');status.textContent='Upload complete. Reloading...';location.reload();}catch(e){if(uploadId){fetch(base+'/abort?file_id='+encodeURIComponent(uploadId),{method:'POST',headers}).catch(()=>{});}status.textContent='Upload failed: '+e.message;}}</script>`));
});
app.post('/instructor/programs/:id/module/:mid/content',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const m=(await pool.query('SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE m.id=$1 AND s.program_id=$2',[req.params.mid,p.id])).rows[0]; if(!m)return res.status(404).send('Module not found');
 const title=String(req.body.title||'').trim(),contentType=String(req.body.content_type||'Custom Activity').trim();
 const studentVisibility=normalizeStudentVisibility(req.body.student_visibility);
 if(title){
  const mode=canonicalTestMode(contentType);
  if(isScavengerContent({content_type:contentType})){
   const existing=(await pool.query(`SELECT id FROM program_module_content WHERE module_id=$1 AND lower(content_type) LIKE '%scavenger hunt%' ORDER BY display_order,id LIMIT 1`,[m.id])).rows[0];
   if(existing)await pool.query(`UPDATE program_module_content SET title=$2,body=$3,display_order=$4,active=$5,student_visibility=$6 WHERE id=$1`,[existing.id,title,String(req.body.body||'').trim(),Number(req.body.display_order)||100,req.body.active==='1',studentVisibility]);
   else await pool.query('INSERT INTO program_module_content(module_id,content_type,title,body,resource_url,display_order,active,student_visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[m.id,contentType,title,String(req.body.body||'').trim(),'',Number(req.body.display_order)||100,req.body.active==='1',studentVisibility]);
   await dedupeModuleScavengerContent(p.id,m.id);
  }else if(mode){
   const existing=(await pool.query(`SELECT id FROM program_module_content WHERE module_id=$1 AND active=true AND lower(content_type)=lower($2) ORDER BY display_order,id LIMIT 1`,[m.id,contentType])).rows[0];
   if(existing){
    await pool.query(`UPDATE program_module_content SET title=$2,body=$3,resource_url=$4,display_order=$5,active=$6,student_visibility=$7 WHERE id=$1`,[existing.id,title,String(req.body.body||'').trim(),String(req.body.resource_url||'').trim(),Number(req.body.display_order)||100,req.body.active==='1',studentVisibility]);
   }else{
    await pool.query('INSERT INTO program_module_content(module_id,content_type,title,body,resource_url,display_order,active,student_visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[m.id,contentType,title,String(req.body.body||'').trim(),String(req.body.resource_url||'').trim(),Number(req.body.display_order)||100,req.body.active==='1',studentVisibility]);
   }
   await ensureNativeModuleTest(p.id,req.account.company_id,m.id,contentType,title);
  }else{
   await pool.query('INSERT INTO program_module_content(module_id,content_type,title,body,resource_url,display_order,active,student_visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[m.id,contentType,title,String(req.body.body||'').trim(),String(req.body.resource_url||'').trim(),Number(req.body.display_order)||100,req.body.active==='1',studentVisibility]);
  }
 }
 res.redirect(`/instructor/programs/${p.id}/module/${m.id}/content`);
});

app.post('/instructor/programs/:id/module/:mid/content/:cid/hunt-link',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const x=(await pool.query(`SELECT pc.* FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.id=$1 AND pc.module_id=$2 AND s.program_id=$3`,[req.params.cid,req.params.mid,p.id])).rows[0];
 if(!x||!isScavengerContent(x))return res.status(404).send('Scavenger hunt content not found');
 const classId=Number(req.body.hunt_class_id)||0;
 if(classId){
  const valid=(await pool.query(`SELECT c.id FROM classes c WHERE c.id=$1 AND c.company_id=$2 AND EXISTS(SELECT 1 FROM hunt_stations hs WHERE hs.class_id=c.id)`,[classId,req.account.company_id])).rows[0];
  if(!valid)return res.status(400).send('Selected scavenger hunt was not found.');
  await pool.query('UPDATE program_module_content SET resource_url=$2 WHERE id=$1',[x.id,`hunt-class:${classId}`]);
 }else await pool.query("UPDATE program_module_content SET resource_url='' WHERE id=$1",[x.id]);
 await dedupeModuleScavengerContent(p.id,req.params.mid);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});

app.get('/instructor/programs/:id/module/:mid/content/:cid/edit',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found');
 const q=await pool.query(`SELECT pc.* FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.id=$1 AND pc.module_id=$2 AND s.program_id=$3`,[req.params.cid,req.params.mid,p.id]); const x=q.rows[0]; if(!x)return res.status(404).send('Content not found');
 res.send(layout('Edit Module Content',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/module/${req.params.mid}/content">← Module Content</a></div><div class="card"><div class="big">Edit Module Content</div><form method="post" action="/instructor/programs/${p.id}/module/${req.params.mid}/content/${x.id}/edit"><label>Content Type<select name="content_type">${PROGRAM_CONTENT_TYPES.map(t=>`<option ${t===x.content_type?'selected':''}>${esc(t)}</option>`).join('')}</select></label><label>Title<input name="title" value="${esc(x.title)}" required></label><label>Text / Student Instructions<textarea name="body" rows="8">${esc(x.body||'')}</textarea></label><label>Resource / Activity Link<input name="resource_url" value="${esc(x.resource_url||'')}"></label><div class="grid"><label>Display Order<input type="number" name="display_order" value="${x.display_order}"></label><label>Student Access<select name="student_visibility"><option value="visible" ${normalizeStudentVisibility(x.student_visibility)==='visible'?'selected':''}>Visible — students can open it</option><option value="locked" ${normalizeStudentVisibility(x.student_visibility)==='locked'?'selected':''}>Locked — students see it but cannot open it</option><option value="hidden" ${normalizeStudentVisibility(x.student_visibility)==='hidden'?'selected':''}>Hidden — students do not see it</option></select></label><label><input style="width:auto" type="checkbox" name="active" value="1" ${x.active?'checked':''}> Content enabled</label></div><button>Save Content</button></form></div>`));
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/edit',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 await pool.query(`UPDATE program_module_content SET content_type=$4,title=$5,body=$6,resource_url=$7,display_order=$8,active=$9,student_visibility=$10 WHERE id=$1 AND module_id=$2 AND module_id IN (SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$3)`,[req.params.cid,req.params.mid,p.id,String(req.body.content_type||'Custom Activity').trim(),String(req.body.title||'').trim(),String(req.body.body||'').trim(),String(req.body.resource_url||'').trim(),Number(req.body.display_order)||100,req.body.active==='1',normalizeStudentVisibility(req.body.student_visibility)]);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/toggle',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 await pool.query(`UPDATE program_module_content SET active=NOT active WHERE id=$1 AND module_id=$2 AND module_id IN (SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$3)`,[req.params.cid,req.params.mid,p.id]);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/visibility/:mode',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const mode=normalizeStudentVisibility(req.params.mode);
 await pool.query(`UPDATE program_module_content SET student_visibility=$4 WHERE id=$1 AND module_id=$2 AND module_id IN (SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$3)`,[req.params.cid,req.params.mid,p.id,mode]);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});
app.post('/instructor/programs/:id/module/:mid/media-visibility/:mode',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const mode=normalizeStudentVisibility(req.params.mode);
 const m=(await pool.query(`SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE m.id=$1 AND s.program_id=$2`,[req.params.mid,p.id])).rows[0];
 if(!m)return res.status(404).send('Module not found');
 await pool.query(`UPDATE program_module_content pc SET student_visibility=$2 WHERE pc.module_id=$1 AND (lower(pc.content_type) LIKE '%video%' OR lower(pc.content_type) LIKE '%presentation%' OR EXISTS(SELECT 1 FROM program_module_files pf WHERE pf.content_id=pc.id AND (lower(pf.mime_type) LIKE 'video/%' OR lower(pf.original_name) LIKE '%.mp4' OR lower(pf.original_name) LIKE '%.m4v' OR lower(pf.original_name) LIKE '%.mov' OR lower(pf.original_name) LIKE '%.webm' OR lower(pf.original_name) LIKE '%.ppt' OR lower(pf.original_name) LIKE '%.pptx')))`,[m.id,mode]);
 res.redirect(`/instructor/programs/${p.id}/module/${m.id}/content`);
});

app.post('/instructor/programs/:id/module/:mid/content/:cid/delete',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 await pool.query(`DELETE FROM program_module_content WHERE id=$1 AND module_id=$2 AND module_id IN (SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$3)`,[req.params.cid,req.params.mid,p.id]);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});

const moduleFileRaw=express.raw({type:'application/octet-stream',limit:'250mb'});
const moduleFileChunkRaw=express.raw({type:'application/octet-stream',limit:'6mb'});
function safeTrainingFileName(name='training-file'){return String(name||'training-file').replace(/[\r\n]/g,'').replace(/[^a-zA-Z0-9._ ()-]/g,'_').slice(0,180)||'training-file';}
function allowedTrainingFile(name=''){const ext=(String(name).split('.').pop()||'').toLowerCase();return ['pptx','ppt','pdf','docx','xlsx','xls','txt','csv','mp4','m4v','mov','webm'].includes(ext);}

app.post('/instructor/programs/:id/module/:mid/content/:cid/file-chunked/start',auth,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const q=await pool.query(`SELECT pc.id FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.id=$1 AND pc.module_id=$2 AND s.program_id=$3`,[req.params.cid,req.params.mid,p.id]); if(!q.rowCount)return res.status(404).json({ok:false,error:'Content not found'});
  const original=safeTrainingFileName(req.query.name||'training-file'); if(!allowedTrainingFile(original))return res.status(400).json({ok:false,error:'File type not allowed'});
  const expected=Math.max(0,Number(req.query.size)||0); if(!expected)return res.status(400).json({ok:false,error:'The uploaded file was empty'}); if(expected>2*1024*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 2 GB limit'});
  const mime=String(req.query.mime||'application/octet-stream').slice(0,120); const client=await pool.connect(); let fileId;
  try{await client.query('BEGIN');await client.query('DELETE FROM program_module_files WHERE content_id=$1',[req.params.cid]);const fq=await client.query(`INSERT INTO program_module_files(content_id,original_name,mime_type,file_size,file_data,uploaded_at) VALUES($1,$2,$3,0,$4,now()) RETURNING id`,[req.params.cid,original,mime,Buffer.alloc(0)]);fileId=fq.rows[0].id;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  return res.json({ok:true,file_id:fileId,name:original,expected_size:expected});
 }catch(e){console.error('Chunked module upload start error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Could not start upload').slice(0,180)});}
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/file-chunked/chunk',auth,moduleFileChunkRaw,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const fileId=Math.max(0,Number(req.query.file_id)||0), chunkNo=Math.max(0,Number(req.query.chunk_no)||0); if(!fileId)return res.status(400).json({ok:false,error:'Missing upload file id'});
  const fq=await pool.query(`SELECT pf.id FROM program_module_files pf JOIN program_module_content pc ON pc.id=pf.content_id JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pf.id=$1 AND pc.id=$2 AND pc.module_id=$3 AND s.program_id=$4`,[fileId,req.params.cid,req.params.mid,p.id]); if(!fq.rowCount)return res.status(404).json({ok:false,error:'Upload session not found'});
  const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||''); if(!data.length)return res.status(400).json({ok:false,error:'Empty upload chunk'}); if(data.length>5*1024*1024)return res.status(413).json({ok:false,error:'Upload chunk is too large'});
  await pool.query(`INSERT INTO program_module_file_chunks(file_id,chunk_no,chunk_data) VALUES($1,$2,$3) ON CONFLICT(file_id,chunk_no) DO UPDATE SET chunk_data=EXCLUDED.chunk_data`,[fileId,chunkNo,data]); return res.json({ok:true,chunk_no:chunkNo,size:data.length});
 }catch(e){console.error('Chunked module upload chunk error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Chunk upload failed').slice(0,180)});}
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/file-chunked/complete',auth,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const fileId=Math.max(0,Number(req.query.file_id)||0), expected=Math.max(0,Number(req.query.size)||0); if(!fileId||!expected)return res.status(400).json({ok:false,error:'Missing upload information'}); if(expected>2*1024*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 2 GB limit'});
  const fq=await pool.query(`SELECT pf.* FROM program_module_files pf JOIN program_module_content pc ON pc.id=pf.content_id JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pf.id=$1 AND pc.id=$2 AND pc.module_id=$3 AND s.program_id=$4`,[fileId,req.params.cid,req.params.mid,p.id]); if(!fq.rowCount)return res.status(404).json({ok:false,error:'Upload session not found'});
  const sq=await pool.query('SELECT COALESCE(sum(octet_length(chunk_data)),0)::bigint AS total,count(*)::int AS chunks FROM program_module_file_chunks WHERE file_id=$1',[fileId]); const total=Number(sq.rows[0]?.total||0); if(total!==expected)return res.status(400).json({ok:false,error:`Upload incomplete: received ${total} of ${expected} bytes`});
  await pool.query('UPDATE program_module_files SET file_size=$2,uploaded_at=now() WHERE id=$1',[fileId,total]); await auditEvent(req,'PROGRAM_FILE_UPLOADED',`${fq.rows[0].original_name} · ${total} bytes · chunked`,'ok'); return res.json({ok:true,file_id:fileId,size:total});
 }catch(e){console.error('Chunked module upload complete error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Could not finalize upload').slice(0,180)});}
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/file-chunked/abort',auth,async(req,res)=>{
 try{const p=await companyProgram(req.params.id,req.account.company_id);if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});const fileId=Math.max(0,Number(req.query.file_id)||0);if(fileId)await pool.query(`DELETE FROM program_module_files pf USING program_module_content pc,program_modules m,program_sections s WHERE pf.id=$1 AND pf.content_id=pc.id AND pc.id=$2 AND pc.module_id=$3 AND m.id=pc.module_id AND s.id=m.section_id AND s.program_id=$4`,[fileId,req.params.cid,req.params.mid,p.id]);return res.json({ok:true});}catch(e){return res.status(500).json({ok:false,error:'Could not cancel upload'});}
});

app.post('/instructor/programs/:id/module/:mid/content/:cid/file',auth,moduleFileRaw,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const q=await pool.query(`SELECT pc.id FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.id=$1 AND pc.module_id=$2 AND s.program_id=$3`,[req.params.cid,req.params.mid,p.id]); if(!q.rowCount)return res.status(404).json({ok:false,error:'Content not found'});
  const original=safeTrainingFileName(req.query.name||'training-file'); if(!allowedTrainingFile(original))return res.status(400).json({ok:false,error:'File type not allowed'});
  const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||''); if(!data.length)return res.status(400).json({ok:false,error:'The uploaded file was empty'}); if(data.length>250*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 250 MB limit'});
  const mime=String(req.query.mime||'application/octet-stream').slice(0,120);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM program_module_files WHERE content_id=$1',[req.params.cid]);
   const fq=await client.query(`INSERT INTO program_module_files(content_id,original_name,mime_type,file_size,file_data,uploaded_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,[req.params.cid,original,mime,data.length,Buffer.alloc(0)]);
   const fileId=fq.rows[0].id, chunkSize=2*1024*1024;
   for(let offset=0,chunkNo=0;offset<data.length;offset+=chunkSize,chunkNo++){
    await client.query('INSERT INTO program_module_file_chunks(file_id,chunk_no,chunk_data) VALUES($1,$2,$3)',[fileId,chunkNo,data.subarray(offset,Math.min(offset+chunkSize,data.length))]);
   }
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  await auditEvent(req,'PROGRAM_FILE_UPLOADED',`${original} · ${data.length} bytes`,'ok'); return res.json({ok:true,name:original,size:data.length});
 }catch(e){console.error('Module file upload error:',e);const detail=String(e?.message||e||'').slice(0,180);return res.status(500).json({ok:false,error:detail?('Upload could not be saved: '+detail):'Upload could not be saved'});}
});
// 2.1.79 Media Performance: serve database-backed training files in batches instead of one SQL query per chunk.
// This reduces PostgreSQL round trips for large PowerPoints and videos while preserving the existing file format/database design.
const mediaChunkMetaCache=new Map();
const MEDIA_META_TTL_MS=10*60*1000;
async function mediaChunkMeta(table,fileId){
 const key=`${table}:${fileId}`,now=Date.now(),cached=mediaChunkMetaCache.get(key);
 if(cached&&now-cached.at<MEDIA_META_TTL_MS)return cached.rows;
 const rows=(await pool.query(`SELECT chunk_no,octet_length(chunk_data)::int AS len FROM ${table} WHERE file_id=$1 ORDER BY chunk_no`,[fileId])).rows;
 mediaChunkMetaCache.set(key,{at:now,rows});
 if(mediaChunkMetaCache.size>500){const first=mediaChunkMetaCache.keys().next().value;if(first)mediaChunkMetaCache.delete(first);}
 return rows;
}
function setPrivateMediaCacheHeaders(res,fileRow){
 const size=Number(fileRow?.file_size||0),stamp=fileRow?.uploaded_at?new Date(fileRow.uploaded_at).getTime():0;
 res.setHeader('Cache-Control','private, max-age=86400, stale-while-revalidate=604800');
 res.setHeader('ETag',`W/\"tth-${fileRow?.id||0}-${size}-${stamp||0}\"`);
 res.setHeader('X-Content-Type-Options','nosniff');
}
async function streamChunkedDbFile(res,{table,fileId,fallbackData,totalSize}){
 const allowed=new Set(['program_module_file_chunks','company_file_chunks']);
 if(!allowed.has(table))throw new Error('Invalid chunk table');
 const meta=await mediaChunkMeta(table,fileId);
 if(meta.length){
  const batchSize=8;
  for(let i=0;i<meta.length;i+=batchSize){
   const wanted=meta.slice(i,i+batchSize).map(x=>Number(x.chunk_no));
   const rows=(await pool.query(`SELECT chunk_no,chunk_data FROM ${table} WHERE file_id=$1 AND chunk_no=ANY($2::int[]) ORDER BY chunk_no`,[fileId,wanted])).rows;
   if(rows.length!==wanted.length)throw new Error(`Missing file chunk while streaming file ${fileId}`);
   for(const row of rows){const buf=Buffer.from(row.chunk_data||'');if(buf.length&&!res.write(buf))await new Promise(resolve=>res.once('drain',resolve));}
  }
  return res.end();
 }
 const fallback=Buffer.from(fallbackData||'');
 if(fallback.length&&!res.write(fallback))await new Promise(resolve=>res.once('drain',resolve));
 return res.end();
}
async function programModuleFileBytes(fileRow){
 const chunks=(await pool.query('SELECT chunk_data FROM program_module_file_chunks WHERE file_id=$1 ORDER BY chunk_no',[fileRow.id])).rows;
 if(chunks.length)return Buffer.concat(chunks.map(x=>Buffer.from(x.chunk_data)));
 return Buffer.from(fileRow.file_data||'');
}

// ========================= COMPANY FILE LIBRARY =========================
function allowedCompanyFile(name=''){
 const ext=(String(name).split('.').pop()||'').toLowerCase();
 return ['pptx','ppt','pdf','docx','doc','xlsx','xls','csv','txt','zip','png','jpg','jpeg','webp','mp4','mov'].includes(ext);
}
async function companyFileRow(fileId,companyId){
 const q=await pool.query(`SELECT f.*,fo.name folder_name,u.name uploaded_by_name FROM company_files f LEFT JOIN company_file_folders fo ON fo.id=f.folder_id LEFT JOIN app_users u ON u.id=f.uploaded_by WHERE f.id=$1 AND f.company_id=$2`,[fileId,companyId]);
 return q.rows[0]||null;
}
app.get('/instructor/company-files',auth,async(req,res)=>{
 const companyId=req.account.company_id, canEdit=isEditorRole(req.account.role);
 const folders=(await pool.query('SELECT * FROM company_file_folders WHERE company_id=$1 ORDER BY lower(name),id',[companyId])).rows;
 const folderId=Math.max(0,Number(req.query.folder)||0);
 const files=(await pool.query(`SELECT f.*,fo.name folder_name,u.name uploaded_by_name FROM company_files f LEFT JOIN company_file_folders fo ON fo.id=f.folder_id LEFT JOIN app_users u ON u.id=f.uploaded_by WHERE f.company_id=$1 AND ($2::int=0 OR f.folder_id=$2) ORDER BY f.uploaded_at DESC,f.id DESC`,[companyId,folderId])).rows;
 const folderTabs=`<a class="btn ${folderId===0?'':'light'}" href="/instructor/company-files">All Files</a>`+folders.map(x=>`<a class="btn ${folderId===Number(x.id)?'':'light'}" href="/instructor/company-files?folder=${x.id}">${esc(x.name)}</a>`).join('');
 const folderOptions=`<option value="">General / No Folder</option>`+folders.map(x=>`<option value="${x.id}" ${folderId===Number(x.id)?'selected':''}>${esc(x.name)}</option>`).join('');
 const rows=files.map(f=>`<tr><td><b>${esc(f.title||f.original_name)}</b><br><span class="small muted">${esc(f.original_name)}</span></td><td>${esc(f.folder_name||'General')}</td><td>${Math.max(1,Math.round(Number(f.file_size||0)/1024))} KB</td><td>${f.uploaded_at?new Date(f.uploaded_at).toLocaleString():''}<br><span class="small muted">${esc(f.uploaded_by_name||'')}</span></td><td class="nowrap"><a class="btn light" href="/instructor/company-files/${f.id}/download">Open / Download</a>${canEdit?` <form method="post" action="/instructor/company-files/${f.id}/delete" style="display:inline" onsubmit="return confirm('Delete this company file?')"><button class="danger">Delete</button></form>`:''}</td></tr>`).join('');
 const editBox=canEdit?`<div class="grid"><div class="card" style="border-top:6px solid var(--red)"><div class="big">Upload Company File</div><p class="muted">Files are private to this company and stored inside The Training Hub database using large-file chunked upload. Maximum 2 GB per file.</p><label>Display Title<input id="companyFileTitle" placeholder="Optional — defaults to file name"></label><label>Folder<select id="companyFileFolder">${folderOptions}</select></label><input type="file" id="companyFileInput"><button type="button" style="margin-top:10px" onclick="uploadCompanyFile()">Upload File</button><div id="companyFileStatus" class="small muted" style="margin-top:8px"></div></div><div class="card"><div class="big">Create Folder</div><form method="post" action="/instructor/company-files/folder"><label>Folder Name<input name="name" required placeholder="Example: Service Manuals"></label><button>Create Folder</button></form><p class="small muted" style="margin-top:12px">Each company has its own folders and files. Other companies cannot see them.</p></div></div>`:'';
 res.send(layout('Company Files',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Command Center</a></div><div class="hero"><div><div class="eyebrow">PRIVATE COMPANY LIBRARY · 2.1.65</div><h1>Company Files</h1><p class="muted">Store company-specific manuals, presentations, forms, worksheets, spreadsheets, videos, and reference documents.</p></div><span class="pill open">${files.length} FILE${files.length===1?'':'S'}</span></div>${editBox}<div class="card"><div class="section-title"><div class="big">Folders</div><span class="muted small">Company isolated</span></div><div class="toolbar">${folderTabs}</div></div><div class="card"><div class="big">Files</div><div style="overflow:auto"><table><thead><tr><th>File</th><th>Folder</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No files have been uploaded to this company yet.</td></tr>'}</tbody></table></div></div>${canEdit?`<script>async function uploadCompanyFile(){const input=document.getElementById('companyFileInput'),status=document.getElementById('companyFileStatus');if(!input.files||!input.files[0]){status.textContent='Choose a file first.';return;}const f=input.files[0];const max=2*1024*1024*1024;if(f.size>max){status.textContent='File is larger than the 2 GB limit.';return;}const title=document.getElementById('companyFileTitle').value||'';const folder=document.getElementById('companyFileFolder').value||'';const token=(document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/)||[])[1]||'';const headers={'X-CSRF-Token':decodeURIComponent(token)};const base='/instructor/company-files/upload-chunked';let uploadId=null;try{status.textContent='Preparing '+f.name+'...';let r=await fetch(base+'/start?name='+encodeURIComponent(f.name)+'&mime='+encodeURIComponent(f.type||'application/octet-stream')+'&title='+encodeURIComponent(title)+'&folder='+encodeURIComponent(folder)+'&size='+encodeURIComponent(f.size),{method:'POST',headers});let j=await r.json().catch(()=>({ok:false,error:'Could not start upload'}));if(!r.ok||!j.ok)throw new Error(j.error||'Could not start upload');uploadId=j.file_id;const chunkSize=4*1024*1024,total=Math.max(1,Math.ceil(f.size/chunkSize));for(let i=0;i<total;i++){const start=i*chunkSize,end=Math.min(start+chunkSize,f.size),blob=f.slice(start,end);status.textContent='Uploading '+f.name+' — '+Math.round((i/total)*100)+'% ('+(i+1)+' of '+total+')';r=await fetch(base+'/chunk?file_id='+encodeURIComponent(uploadId)+'&chunk_no='+i,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:await blob.arrayBuffer()});j=await r.json().catch(()=>({ok:false,error:'Chunk upload failed'}));if(!r.ok||!j.ok)throw new Error(j.error||('Upload failed at chunk '+(i+1)));}status.textContent='Finalizing upload...';r=await fetch(base+'/complete?file_id='+encodeURIComponent(uploadId)+'&size='+encodeURIComponent(f.size),{method:'POST',headers});j=await r.json().catch(()=>({ok:false,error:'Could not finalize upload'}));if(!r.ok||!j.ok)throw new Error(j.error||'Could not finalize upload');status.textContent='Upload complete. Reloading...';location.reload();}catch(e){if(uploadId){fetch(base+'/abort?file_id='+encodeURIComponent(uploadId),{method:'POST',headers}).catch(()=>{});}status.textContent='Upload failed: '+e.message;}}</script>`:''}`));
});
app.post('/instructor/company-files/folder',auth,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const name=String(req.body.name||'').trim().slice(0,100); if(name)await pool.query('INSERT INTO company_file_folders(company_id,name) VALUES($1,$2) ON CONFLICT(company_id,name) DO NOTHING',[req.account.company_id,name]);
 res.redirect('/instructor/company-files');
});

app.post('/instructor/company-files/upload-chunked/start',auth,async(req,res)=>{
 try{
  if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const original=safeTrainingFileName(req.query.name||'company-file'); if(!allowedCompanyFile(original))return res.status(400).json({ok:false,error:'File type not allowed'});
  const expected=Math.max(0,Number(req.query.size)||0); if(!expected)return res.status(400).json({ok:false,error:'The uploaded file was empty'}); if(expected>2*1024*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 2 GB limit'});
  let folderId=Number(req.query.folder)||null; if(folderId){const fq=await pool.query('SELECT id FROM company_file_folders WHERE id=$1 AND company_id=$2',[folderId,req.account.company_id]); if(!fq.rowCount)folderId=null;}
  const title=String(req.query.title||'').trim().slice(0,180)||original; const mime=String(req.query.mime||'application/octet-stream').slice(0,120);
  const q=await pool.query(`INSERT INTO company_files(company_id,folder_id,title,original_name,mime_type,file_size,uploaded_by,uploaded_at) VALUES($1,$2,$3,$4,$5,0,$6,now()) RETURNING id`,[req.account.company_id,folderId,title,original,mime,req.account.user_id||null]);
  return res.json({ok:true,file_id:q.rows[0].id,name:original,expected_size:expected});
 }catch(e){console.error('Chunked company upload start error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Could not start upload').slice(0,180)});}
});
app.post('/instructor/company-files/upload-chunked/chunk',auth,moduleFileChunkRaw,async(req,res)=>{
 try{
  if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const fileId=Math.max(0,Number(req.query.file_id)||0),chunkNo=Math.max(0,Number(req.query.chunk_no)||0); if(!fileId)return res.status(400).json({ok:false,error:'Missing upload file id'});
  const fq=await pool.query('SELECT id FROM company_files WHERE id=$1 AND company_id=$2',[fileId,req.account.company_id]); if(!fq.rowCount)return res.status(404).json({ok:false,error:'Upload session not found'});
  const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||''); if(!data.length)return res.status(400).json({ok:false,error:'Empty upload chunk'}); if(data.length>5*1024*1024)return res.status(413).json({ok:false,error:'Upload chunk is too large'});
  await pool.query(`INSERT INTO company_file_chunks(file_id,chunk_no,chunk_data) VALUES($1,$2,$3) ON CONFLICT(file_id,chunk_no) DO UPDATE SET chunk_data=EXCLUDED.chunk_data`,[fileId,chunkNo,data]);
  return res.json({ok:true,chunk_no:chunkNo,size:data.length});
 }catch(e){console.error('Chunked company upload chunk error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Chunk upload failed').slice(0,180)});}
});
app.post('/instructor/company-files/upload-chunked/complete',auth,async(req,res)=>{
 try{
  if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const fileId=Math.max(0,Number(req.query.file_id)||0),expected=Math.max(0,Number(req.query.size)||0); if(!fileId||!expected)return res.status(400).json({ok:false,error:'Missing upload information'}); if(expected>2*1024*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 2 GB limit'});
  const fq=await pool.query('SELECT * FROM company_files WHERE id=$1 AND company_id=$2',[fileId,req.account.company_id]); if(!fq.rowCount)return res.status(404).json({ok:false,error:'Upload session not found'});
  const sq=await pool.query('SELECT COALESCE(sum(octet_length(chunk_data)),0)::bigint AS total,count(*)::int AS chunks FROM company_file_chunks WHERE file_id=$1',[fileId]); const total=Number(sq.rows[0]?.total||0); if(total!==expected)return res.status(400).json({ok:false,error:`Upload incomplete: received ${total} of ${expected} bytes`});
  await pool.query('UPDATE company_files SET file_size=$2,uploaded_at=now() WHERE id=$1 AND company_id=$3',[fileId,total,req.account.company_id]); await auditEvent(req,'COMPANY_FILE_UPLOADED',`${fq.rows[0].original_name} · ${total} bytes · chunked`,'ok');
  return res.json({ok:true,file_id:fileId,size:total});
 }catch(e){console.error('Chunked company upload complete error:',e);return res.status(500).json({ok:false,error:String(e?.message||e||'Could not finalize upload').slice(0,180)});}
});
app.post('/instructor/company-files/upload-chunked/abort',auth,async(req,res)=>{
 try{if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});const fileId=Math.max(0,Number(req.query.file_id)||0);if(fileId)await pool.query('DELETE FROM company_files WHERE id=$1 AND company_id=$2 AND file_size=0',[fileId,req.account.company_id]);return res.json({ok:true});}catch(e){return res.status(500).json({ok:false,error:'Could not cancel upload'});}
});

app.post('/instructor/company-files/upload',auth,moduleFileRaw,async(req,res)=>{
 try{
  if(!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const original=safeTrainingFileName(req.query.name||'company-file'); if(!allowedCompanyFile(original))return res.status(400).json({ok:false,error:'File type not allowed'});
  const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||''); if(!data.length)return res.status(400).json({ok:false,error:'The uploaded file was empty'}); if(data.length>250*1024*1024)return res.status(413).json({ok:false,error:'File exceeds 250 MB limit'});
  let folderId=Number(req.query.folder)||null; if(folderId){const fq=await pool.query('SELECT id FROM company_file_folders WHERE id=$1 AND company_id=$2',[folderId,req.account.company_id]); if(!fq.rowCount)folderId=null;}
  const title=String(req.query.title||'').trim().slice(0,180)||original; const mime=String(req.query.mime||'application/octet-stream').slice(0,120);
  const client=await pool.connect(); let fileId;
  try{await client.query('BEGIN');const q=await client.query(`INSERT INTO company_files(company_id,folder_id,title,original_name,mime_type,file_size,uploaded_by,uploaded_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,[req.account.company_id,folderId,title,original,mime,data.length,req.account.user_id||null]);fileId=q.rows[0].id;const chunkSize=2*1024*1024;for(let offset=0,chunkNo=0;offset<data.length;offset+=chunkSize,chunkNo++)await client.query('INSERT INTO company_file_chunks(file_id,chunk_no,chunk_data) VALUES($1,$2,$3)',[fileId,chunkNo,data.subarray(offset,Math.min(offset+chunkSize,data.length))]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  await auditEvent(req,'COMPANY_FILE_UPLOADED',`${original} · ${data.length} bytes`,'ok');res.json({ok:true,id:fileId,name:original,size:data.length});
 }catch(e){console.error('Company file upload error:',e);res.status(500).json({ok:false,error:String(e?.message||e||'Upload failed').slice(0,180)});}
});
app.get('/instructor/company-files/:id/download',auth,async(req,res)=>{
 try{
  const f=await companyFileRow(req.params.id,req.account.company_id); if(!f)return res.status(404).send('File not found');
  res.setHeader('Content-Type',f.mime_type||'application/octet-stream');
  setPrivateMediaCacheHeaders(res,f);
  res.setHeader('Accept-Ranges','bytes');
  if(Number(f.file_size)>0&&!req.headers.range)res.setHeader('Content-Length',String(Number(f.file_size)));
  const inline=String(req.query.inline||'')==='1' && /^(image\/|video\/)/i.test(String(f.mime_type||''));
  res.setHeader('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  await streamChunkedDbFileWithRange(req,res,{table:'company_file_chunks',fileId:f.id,fallbackData:null,totalSize:f.file_size});
 }catch(e){
  console.error('Company file download error:',e);
  if(!res.headersSent)return res.status(500).send('File download failed. Please try again.');
  try{res.end();}catch(_e){}
 }
});
app.post('/instructor/company-files/:id/delete',auth,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).send('Access denied'); const f=await companyFileRow(req.params.id,req.account.company_id); if(f)await pool.query('DELETE FROM company_files WHERE id=$1 AND company_id=$2',[f.id,req.account.company_id]); res.redirect('/instructor/company-files');
});

function moduleFileMime(f){
 const ext=(String(f?.original_name||'').split('.').pop()||'').toLowerCase();
 const m=String(f?.mime_type||'').toLowerCase();
 if(m&&m!=='application/octet-stream')return m;
 return ({mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',pdf:'application/pdf'})[ext]||'application/octet-stream';
}
function isModuleVideoFile(f){
 const ext=(String(f?.original_name||'').split('.').pop()||'').toLowerCase();
 return String(f?.mime_type||'').toLowerCase().startsWith('video/')||['mp4','m4v','mov','webm'].includes(ext);
}
function renderProgramStudentContent(x,st){
 const vis=normalizeStudentVisibility(x.student_visibility);
 if(vis==='hidden')return '';
 const header=`<div class="eyebrow">${esc(x.content_type)}</div><b>${esc(x.title)}</b>${x.body?`<p style="white-space:pre-wrap">${esc(x.body)}</p>`:''}`;
 if(vis==='locked')return `<div style="margin:12px 0;padding:14px;border:1px solid #d4a300;border-radius:12px;background:#fffaf0">${header}<div class="alert" style="margin-top:10px"><b>Locked by Instructor</b><br>This PowerPoint/video is visible in your program, but the instructor has not opened student access yet.</div></div>`;
 const media=x.file_id?(isModuleVideoFile(x)?`<div class="tth-lazy-media" style="margin-top:12px"><video class="tth-lazy-video" controls preload="none" playsinline style="width:100%;max-width:1100px;max-height:78vh;background:#000;border-radius:12px" data-src="/program/student/${st.id}/file/${x.file_id}?token=${encodeURIComponent(st.join_token)}"></video><div class="small muted tth-media-status" style="margin-top:6px">Video will prepare as you reach it · ${esc(x.original_name||'Training video')}</div></div>`:`<a class="btn tth-training-file-link" data-file-kind="presentation" href="/program/student/${st.id}/file/${x.file_id}?token=${encodeURIComponent(st.join_token)}">Open / Download ${esc(x.original_name||x.content_type)}</a><span class="small muted tth-file-status" style="margin-left:8px"></span>`):x.resource_url?`<a class="btn" href="${esc(x.resource_url)}" target="_blank">Open ${esc(x.content_type)}</a>`:'';
 return `<div style="margin:12px 0;padding:14px;border:1px solid #ddd;border-radius:12px;background:#fafafa">${header}${media}</div>`;
}
async function streamChunkedDbFileWithRange(req,res,{table,fileId,fallbackData,totalSize,maxRangeBytes=0}){
 const allowed=new Set(['program_module_file_chunks','company_file_chunks']); if(!allowed.has(table))throw new Error('Invalid chunk table');
 const size=Number(totalSize)||0, range=String(req.headers.range||'');
 if(!range||!size){return streamChunkedDbFile(res,{table,fileId,fallbackData,totalSize});}
 const m=range.match(/^bytes=(\d*)-(\d*)$/); if(!m){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end();}
 let start=m[1]?Number(m[1]):0, end=m[2]?Number(m[2]):size-1;
 if(!m[1]&&m[2]){const suffix=Number(m[2]);start=Math.max(0,size-suffix);end=size-1;}
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=size||end<start){res.status(416).setHeader('Content-Range',`bytes */${size}`);return res.end();}
 // Browsers often begin video playback with an open-ended request such as bytes=0-.
 // Do not pull the entire database-backed video into PostgreSQL/Node for that first request.
 // Serve a small window, then let the browser request the next range as playback advances.
 if(maxRangeBytes>0&&m[1]&&!m[2])end=Math.min(end,start+Math.max(1,Number(maxRangeBytes))-1);
 end=Math.min(end,size-1); res.status(206); res.setHeader('Accept-Ranges','bytes'); res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`); res.setHeader('Content-Length',String(end-start+1));
 const meta=await mediaChunkMeta(table,fileId);
 if(meta.length){
  let offset=0;const needed=[];const bounds=new Map();
  for(const c of meta){const cs=offset,ce=offset+Number(c.len)-1;offset=ce+1;if(ce<start)continue;if(cs>end)break;needed.push(Number(c.chunk_no));bounds.set(Number(c.chunk_no),[cs,ce]);}
  if(needed.length){
   const rows=(await pool.query(`SELECT chunk_no,chunk_data FROM ${table} WHERE file_id=$1 AND chunk_no=ANY($2::int[]) ORDER BY chunk_no`,[fileId,needed])).rows;
   if(rows.length!==needed.length)throw new Error(`Missing file chunk while range streaming file ${fileId}`);
   for(const row of rows){const [cs]=bounds.get(Number(row.chunk_no));const buf=Buffer.from(row.chunk_data||'');const a=Math.max(0,start-cs),b=Math.min(buf.length,end-cs+1),piece=buf.subarray(a,b);if(piece.length&&!res.write(piece))await new Promise(resolve=>res.once('drain',resolve));}
  }
  return res.end();
 }
 const fallback=Buffer.from(fallbackData||'');const piece=fallback.subarray(start,end+1);if(piece.length&&!res.write(piece))await new Promise(resolve=>res.once('drain',resolve));return res.end();
}
app.get('/instructor/programs/:id/module/:mid/content/:cid/file',auth,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found');
  const q=await pool.query(`SELECT pf.* FROM program_module_files pf JOIN program_module_content pc ON pc.id=pf.content_id JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.id=$1 AND pc.module_id=$2 AND s.program_id=$3`,[req.params.cid,req.params.mid,p.id]); const f=q.rows[0]; if(!f)return res.status(404).send('File not found');
  // Instructor/Owner access is never restricted by the student visibility setting.
  // Visible / Locked / Hidden applies only to student-facing routes.
  res.setHeader('Content-Type',moduleFileMime(f));
  setPrivateMediaCacheHeaders(res,f);
  res.setHeader('Accept-Ranges','bytes');
  if(Number(f.file_size)>0&&!req.headers.range)res.setHeader('Content-Length',String(Number(f.file_size)));
  res.setHeader('Content-Disposition',`${isModuleVideoFile(f)?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  await streamChunkedDbFileWithRange(req,res,{table:'program_module_file_chunks',fileId:f.id,fallbackData:f.file_data,totalSize:f.file_size,maxRangeBytes:isModuleVideoFile(f)?4*1024*1024:0});
 }catch(e){
  console.error('Instructor module file download error:',e);
  if(!res.headersSent)return res.status(500).send('Training file download failed. Please try again.');
  try{res.end();}catch(_e){}
 }
});
app.post('/instructor/programs/:id/module/:mid/content/:cid/file/delete',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 await pool.query(`DELETE FROM program_module_files WHERE content_id=$1 AND content_id IN (SELECT pc.id FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.module_id=$2 AND s.program_id=$3)`,[req.params.cid,req.params.mid,p.id]);
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/content`);
});

app.post('/instructor/programs/:id/module/:mid/delete',auth,async(req,res)=>{ const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query('DELETE FROM program_modules WHERE id=$1 AND section_id IN (SELECT id FROM program_sections WHERE program_id=$2)',[req.params.mid,p.id]); res.redirect(`/instructor/programs/${p.id}`); });


const testBankCsvRaw=express.raw({type:['text/csv','application/csv','application/vnd.ms-excel','application/octet-stream'],limit:'2mb'});
function parseCsvRows(text=''){
 const rows=[]; let row=[],field='',quoted=false;
 const src=String(text||'').replace(/^\uFEFF/,'');
 for(let i=0;i<src.length;i++){
  const ch=src[i];
  if(quoted){
   if(ch==='"'&&src[i+1]==='"'){field+='"';i++;}
   else if(ch==='"'){quoted=false;}
   else field+=ch;
  }else{
   if(ch==='"')quoted=true;
   else if(ch===','){row.push(field);field='';}
   else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
   else if(ch!=='\r')field+=ch;
  }
 }
 if(field.length||row.length){row.push(field);rows.push(row);}
 return rows.filter(r=>r.some(v=>String(v||'').trim()!==''));
}
function normalizeTestBankCsv(text=''){
 const rows=parseCsvRows(text); if(!rows.length)throw new Error('The CSV file is empty.');
 const header=rows[0].map(x=>String(x||'').trim().toLowerCase().replace(/\s+/g,'_'));
 const required=['question','a','b','c','d','correct_answer'];
 for(const k of required)if(!header.includes(k))throw new Error('Missing required column: '+k);
 const idx=Object.fromEntries(header.map((h,i)=>[h,i]));
 const out=[];
 for(let r=1;r<rows.length;r++){
  const x=rows[r],question=String(x[idx.question]||'').trim();
  if(!question)continue;
  const choices=['a','b','c','d'].map(k=>String(x[idx[k]]||'').trim());
  if(choices.some(v=>!v))throw new Error('Row '+(r+1)+' is missing one or more answer choices.');
  const raw=String(x[idx.correct_answer]||'').trim().toUpperCase();
  let answer;
  if(/^[ABCD]$/.test(raw)){
   answer=raw.charCodeAt(0)-65;
  }else{
   answer=Number(raw);
   if(Number.isInteger(answer)&&answer>=1&&answer<=4)answer-=1;
  }
  if(!Number.isInteger(answer)||answer<0||answer>3)throw new Error('Row '+(r+1)+' has an invalid correct_answer. Use A, B, C, or D.');
  out.push({
   question,choices,answer_index:answer,
   explanation:idx.explanation!==undefined?String(x[idx.explanation]||'').trim():'',
   display_order:idx.display_order!==undefined?(Number(x[idx.display_order])||((out.length+1)*10)):((out.length+1)*10)
  });
 }
 if(!out.length)throw new Error('No valid questions were found in the CSV file.');
 return out;
}

app.get('/instructor/programs/:id/module/:mid/test',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found');
 const q=await pool.query(`SELECT l.*,b.title bank_title FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$1 AND s.program_id=$2`,[req.params.mid,p.id]); const link=q.rows[0]; if(!link)return res.status(404).send('No native test is linked to this module');
 const qs=(await pool.query('SELECT * FROM program_test_questions WHERE bank_id=$1 ORDER BY display_order,id',[link.bank_id])).rows;
 const isMatched=link.test_mode==='Pre-Test'||link.test_mode==='Post-Test';
 const rows=qs.map((x,i)=>{const ch=Array.isArray(x.choices)?x.choices:[];return `<div class="q"><div class="section-title"><div><b>${i+1}. ${esc(x.question)}</b><div class="small muted">${ch.map((c,j)=>`${String.fromCharCode(65+j)}. ${esc(c)}${j===x.answer_index?' ✓':''}`).join(' · ')}</div></div><div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/module/${req.params.mid}/test/question/${x.id}/edit">Edit</a><form method="post" action="/instructor/programs/${p.id}/module/${req.params.mid}/test/question/${x.id}/delete" onsubmit="return confirm('Delete this question from this test?')"><button class="danger">Delete</button></form></div></div></div>`}).join('');
 const evalBox=/Auto 4WD/i.test(link.bank_title)?`<div class="alert"><b>Suggested Evaluation:</b> 18–20 Excellent · 15–17 Good · 12–14 Needs Improvement · Below 12 Retraining Recommended.</div>`:'';
 res.send(layout('Program Test Bank',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/module/${req.params.mid}/content">← Module Content</a></div><div class="hero"><div><div class="eyebrow">${isMatched?'MATCHED PRE / POST TEST BANK':'TECHNICIAN KNOWLEDGE ASSESSMENT'}</div><h1>${esc(link.bank_title)}</h1><p>${isMatched?`${esc(link.test_mode)} · Same question bank is used for the matched Pre/Post tests.`:`${esc(link.test_mode)} · Standalone test bank.`}</p></div><span class="pill">${qs.length} QUESTIONS</span></div><div class="card" style="border-top:6px solid #171717"><div class="eyebrow">BULK IMPORT</div><div class="big">Import Training Hub Question Bank CSV</div><p class="muted">Use columns: <b>question, a, b, c, d, correct_answer, explanation, display_order</b>. Correct answer may be A, B, C, or D. Letter answers are stored exactly as selected. For a matched Pre/Post bank, import once here and both tests use the same questions.</p><label><input type="checkbox" id="replaceTestBank" checked style="width:auto"> Replace the existing questions in this bank</label><input type="file" id="testBankCsv" accept=".csv,text/csv"><button type="button" id="importTestBankBtn" style="margin-top:10px">Import CSV Question Bank</button><div id="testBankImportStatus" class="small muted" style="margin-top:8px"></div></div><div class="card" style="border-top:6px solid var(--red)"><div class="big">+ Add Question</div><form method="post" action="/instructor/programs/${p.id}/module/${req.params.mid}/test/question"><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3"></textarea></label><label>Display Order<input type="number" name="display_order" value="${qs.length?Math.max(...qs.map(x=>Number(x.display_order)||0))+10:10}"></label><button>Add Question</button></form></div><div class="card"><div class="big">Questions</div>${evalBox}${rows||'<p>No questions in this bank.</p>'}</div><script>
(()=>{const btn=document.getElementById('importTestBankBtn'),input=document.getElementById('testBankCsv'),status=document.getElementById('testBankImportStatus'),replace=document.getElementById('replaceTestBank');if(!btn)return;btn.addEventListener('click',async()=>{if(!input.files||!input.files[0]){status.textContent='Choose the CSV question-bank file first.';return;}const f=input.files[0];if(!/\.csv$/i.test(f.name)){status.textContent='Choose a .csv file.';return;}btn.disabled=true;status.textContent='Importing '+f.name+'...';try{const token=(document.cookie.match(/(?:^|; )tth_csrf=([^;]*)/)||[])[1]||'';const r=await fetch('/instructor/programs/${p.id}/module/${req.params.mid}/test/import-csv?replace='+(replace.checked?'1':'0'),{method:'POST',headers:{'Content-Type':'text/csv','X-CSRF-Token':decodeURIComponent(token)},body:await f.arrayBuffer()});const j=await r.json().catch(()=>({ok:false,error:'Import failed'}));if(!r.ok||!j.ok)throw new Error(j.error||'Import failed');status.textContent='Imported '+j.imported+' questions. Reloading...';location.reload();}catch(e){status.textContent='Import failed: '+e.message;btn.disabled=false;}});})();</script>`));
});

app.post('/instructor/programs/:id/module/:mid/test/import-csv',auth,testBankCsvRaw,async(req,res)=>{
 try{
  const p=await companyProgram(req.params.id,req.account.company_id);
  if(!p||!isEditorRole(req.account.role))return res.status(403).json({ok:false,error:'Access denied'});
  const link=(await pool.query(`SELECT l.* FROM program_module_test_links l JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$1 AND s.program_id=$2`,[req.params.mid,p.id])).rows[0];
  if(!link)return res.status(404).json({ok:false,error:'Test bank not found'});
  const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||'');
  if(!data.length)return res.status(400).json({ok:false,error:'The uploaded CSV file was empty'});
  const items=normalizeTestBankCsv(data.toString('utf8'));
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   if(String(req.query.replace||'1')!=='0')await client.query('DELETE FROM program_test_questions WHERE bank_id=$1',[link.bank_id]);
   for(const q of items)await client.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[link.bank_id,q.question,JSON.stringify(q.choices),q.answer_index,q.explanation,q.display_order]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  await auditEvent(req,'PROGRAM_TEST_BANK_CSV_IMPORTED',`${p.title} · module ${req.params.mid} · ${items.length} questions`,'ok');
  res.json({ok:true,imported:items.length,bank_id:link.bank_id});
 }catch(e){
  console.error('Test bank CSV import error:',e);
  res.status(400).json({ok:false,error:String(e?.message||e||'Import failed').slice(0,220)});
 }
});

app.post('/instructor/programs/:id/module/:mid/test/question',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); const link=(await pool.query(`SELECT l.* FROM program_module_test_links l JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$1 AND s.program_id=$2`,[req.params.mid,p.id])).rows[0]; if(!link)return res.status(404).send('Test not found');
 const question=String(req.body.question||'').trim(); if(question)await pool.query(`INSERT INTO program_test_questions(bank_id,question,choices,answer_index,explanation,display_order) VALUES($1,$2,$3::jsonb,$4,$5,$6)`,[link.bank_id,question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer)||0,String(req.body.explanation||'').trim(),Number(req.body.display_order)||100]); res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/test`);
});
app.get('/instructor/programs/:id/module/:mid/test/question/:qid/edit',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p)return res.status(404).send('Program not found'); const q=(await pool.query(`SELECT tq.* FROM program_test_questions tq JOIN program_module_test_links l ON l.bank_id=tq.bank_id JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE tq.id=$1 AND l.module_id=$2 AND s.program_id=$3`,[req.params.qid,req.params.mid,p.id])).rows[0]; if(!q)return res.status(404).send('Question not found'); const ch=Array.isArray(q.choices)?q.choices:[];
 res.send(layout('Edit Test Question',`<div class="toolbar"><a class="btn light" href="/instructor/programs/${p.id}/module/${req.params.mid}/test">← Test Bank</a></div><div class="card"><div class="big">Edit Question</div><form method="post" action="/instructor/programs/${p.id}/module/${req.params.mid}/test/question/${q.id}/edit"><label>Question<textarea name="question" required>${esc(q.question)}</textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" value="${esc(ch[i]||'')}" required></label>`).join('')}<label>Correct Answer<select name="answer">${[0,1,2,3].map(i=>`<option value="${i}" ${i===q.answer_index?'selected':''}>${String.fromCharCode(65+i)}</option>`).join('')}</select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3">${esc(q.explanation||'')}</textarea></label><label>Display Order<input type="number" name="display_order" value="${q.display_order}"></label><button>Save Question</button></form></div>`));
});
app.post('/instructor/programs/:id/module/:mid/test/question/:qid/edit',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied');
 const answer=Math.max(0,Math.min(3,Number(req.body.answer)||0));
 const result=await pool.query(`UPDATE program_test_questions SET question=$4,choices=$5::jsonb,answer_index=$6,explanation=$7,display_order=$8 WHERE id=$1 AND bank_id=(SELECT l.bank_id FROM program_module_test_links l JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$2 AND s.program_id=$3 LIMIT 1) RETURNING id`,[req.params.qid,req.params.mid,p.id,String(req.body.question||'').trim(),JSON.stringify([req.body.c0||'',req.body.c1||'',req.body.c2||'',req.body.c3||'']),answer,String(req.body.explanation||'').trim(),Number(req.body.display_order)||100]);
 if(!result.rowCount)return res.status(404).send('Question not found');
 res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/test`);
});
app.post('/instructor/programs/:id/module/:mid/test/question/:qid/delete',auth,async(req,res)=>{
 const p=await companyProgram(req.params.id,req.account.company_id); if(!p||!isEditorRole(req.account.role))return res.status(403).send('Access denied'); await pool.query(`DELETE FROM program_test_questions WHERE id=$1 AND bank_id=(SELECT l.bank_id FROM program_module_test_links l JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$2 AND s.program_id=$3 LIMIT 1)`,[req.params.qid,req.params.mid,p.id]); res.redirect(`/instructor/programs/${p.id}/module/${req.params.mid}/test`);
});

function shuffleProgramQuestions(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
async function programStudentTestContext(studentId,token,moduleId){
 const st=(await pool.query(`SELECT ps.*,p.company_id,p.title program_title FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2 AND p.active=true`,[studentId,String(token||'')])).rows[0]; if(!st)return null;
 const link=(await pool.query(`SELECT l.*,b.title bank_title,m.title module_title,m.section_id FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id JOIN program_modules m ON m.id=l.module_id JOIN program_sections s ON s.id=m.section_id WHERE l.module_id=$1 AND s.program_id=$2 AND m.active=true AND s.active=true`,[moduleId,st.program_id])).rows[0]; if(!link)return null; if(!(await programStudentModuleAccess(st.id,st.program_id,link.module_id)))return null; return {st,link};
}
app.get('/program/student/:id/module/:mid/test',async(req,res)=>{
 const ctx=await programStudentTestContext(req.params.id,req.query.token,req.params.mid); if(!ctx)return res.status(403).send('Invalid test session'); const {st,link}=ctx; const b=await companyBrand(st.company_id);
 let attempt=(await pool.query(`SELECT * FROM program_test_attempts WHERE student_id=$1 AND module_id=$2 AND status='in_progress' ORDER BY id DESC LIMIT 1`,[st.id,link.module_id])).rows[0];
 // Pre-Test must stay in the editable bank's source/display order so printed answer sheets line up exactly.
 // If an older in-progress Pre-Test was created while randomization was enabled, rebuild it before display.
 if(attempt && link.test_mode==='Pre-Test'){
  const ordered=(await pool.query('SELECT * FROM program_test_questions WHERE bank_id=$1 ORDER BY display_order,id',[link.bank_id])).rows.map(q=>({id:q.id,question:q.question,choices:Array.isArray(q.choices)?q.choices:[],answer_index:q.answer_index,explanation:q.explanation||''}));
  attempt=(await pool.query('UPDATE program_test_attempts SET question_snapshot=$2::jsonb,total_questions=$3 WHERE id=$1 RETURNING *',[attempt.id,JSON.stringify(ordered),ordered.length])).rows[0];
 }
 if(!attempt){ let snapshot;
  if(link.test_mode==='Post-Test'){
   // A Pre-Test and Post-Test may be separate modules with separately imported but matching banks.
   // Prefer the exact same bank, then a Pre-Test in the same section, then a Pre-Test with the same
   // normalized module title. This keeps the two tests on separate module paths while still treating
   // them as a matched pair.
   const normalizeTestTitle=(v)=>String(v||'').toLowerCase().replace(/\b(pre|post)[ -]?test\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
   const candidates=(await pool.query(`SELECT a.*,m.title pre_module_title,m.section_id pre_section_id,m.display_order pre_module_order,s.display_order pre_section_order,b.title pre_bank_title FROM program_test_attempts a JOIN program_modules m ON m.id=a.module_id JOIN program_sections s ON s.id=m.section_id LEFT JOIN program_test_banks b ON b.id=a.bank_id WHERE a.student_id=$1 AND a.test_mode='Pre-Test' AND a.status='completed' AND s.program_id=$2 ORDER BY a.completed_at DESC,a.id DESC`,[st.id,st.program_id])).rows;
   const postTitle=normalizeTestTitle(link.module_title);
   const postBankTitle=normalizeTestTitle(link.bank_title);
   // Treat separately imported Pre/Post modules as one pair when they represent the same lesson.
   // Matching priority: same bank, same normalized bank title, same normalized module title,
   // same section, then the nearest completed Pre-Test earlier in this program. This allows a
   // Pre-Test -> Video -> Post-Test path without forcing both tests onto one module/route.
   const scoreCandidate=(a)=>{
    let score=0;
    if(Number(a.bank_id)===Number(link.bank_id))score+=1000;
    if(postBankTitle&&normalizeTestTitle(a.pre_bank_title)===postBankTitle)score+=500;
    if(postTitle&&normalizeTestTitle(a.pre_module_title)===postTitle)score+=300;
    if(Number(a.pre_section_id)===Number(link.section_id))score+=150;
    return score;
   };
   let matched=candidates.filter(a=>scoreCandidate(a)>0);
   if(!matched.length&&candidates.length){
    // Last-resort program pairing: a completed Pre-Test in this same modular program is enough
    // to unlock the Post-Test. Prefer the most recently completed attempt. This prevents a
    // separately created Post-Test module from becoming permanently locked because of bank IDs.
    matched=[...candidates];
   }
   matched.sort((a,b)=>scoreCandidate(b)-scoreCandidate(a)||new Date(b.completed_at||0)-new Date(a.completed_at||0));
   const pre=matched[0];
   if(!pre)return res.send(tenantContext.run({companyId:st.company_id,brand:b},()=>layout('Post-Test Locked',`<div class="card"><div class="big">Complete the Matching Pre-Test First</div><p>This Post-Test is a separate module, but it still requires the matching Pre-Test to be completed first.</p><a class="btn" href="/program/student/${st.id}?token=${encodeURIComponent(st.join_token)}">Back to Program</a></div>`)));
   // Use the Post-Test bank's current questions when it is a separate bank. This keeps any edits to
   // the Post-Test module intact while preserving the matched-question behavior.
   if(Number(pre.bank_id)===Number(link.bank_id)) snapshot=Array.isArray(pre.question_snapshot)?pre.question_snapshot:[];
   else { const postQs=(await pool.query('SELECT * FROM program_test_questions WHERE bank_id=$1 ORDER BY display_order,id',[link.bank_id])).rows; snapshot=postQs.map(q=>({id:q.id,question:q.question,choices:Array.isArray(q.choices)?q.choices:[],answer_index:q.answer_index,explanation:q.explanation||''})); }
   snapshot=shuffleProgramQuestions(snapshot); const sourceIds=snapshot.map(x=>x.id).join(','); if(snapshot.length>1&&sourceIds===([...snapshot].sort((a,b)=>Number(a.id)-Number(b.id))).map(x=>x.id).join(','))snapshot=[...snapshot.slice(1),snapshot[0]];
  } else { const qs=(await pool.query('SELECT * FROM program_test_questions WHERE bank_id=$1 ORDER BY display_order,id',[link.bank_id])).rows; snapshot=qs.map(q=>({id:q.id,question:q.question,choices:Array.isArray(q.choices)?q.choices:[],answer_index:q.answer_index,explanation:q.explanation||''})); if(link.randomize)snapshot=shuffleProgramQuestions(snapshot); }
  attempt=(await pool.query(`INSERT INTO program_test_attempts(student_id,module_id,bank_id,test_mode,question_snapshot,total_questions) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,[st.id,link.module_id,link.bank_id,link.test_mode,JSON.stringify(snapshot),snapshot.length])).rows[0];
 }
 const snap=Array.isArray(attempt.question_snapshot)?attempt.question_snapshot:[]; const cards=snap.map((q,i)=>`<div class="q"><b>${i+1}. ${esc(q.question)}</b><div style="margin-top:8px">${(q.choices||[]).map((c,j)=>`<label style="font-weight:500"><input style="width:auto;margin-right:8px" type="radio" name="q_${i}" value="${j}" required>${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div></div>`).join('');
 res.send(tenantContext.run({companyId:st.company_id,brand:b},()=>layout(link.test_mode,`<div class="hero"><div><div class="eyebrow">${esc(link.test_mode.toUpperCase())}</div><h1>${esc(link.bank_title)}</h1><p>${snap.length} questions · ${link.test_mode==='Knowledge Assessment'?'Auto 4WD technician knowledge assessment':'matched Pre/Post question bank'}</p></div></div><form method="post" action="/program/student/${st.id}/module/${link.module_id}/test?token=${encodeURIComponent(st.join_token)}">${cards}<button>Submit ${esc(link.test_mode)}</button></form>`)));
});
app.post('/program/student/:id/module/:mid/test',async(req,res)=>{
 const ctx=await programStudentTestContext(req.params.id,req.query.token,req.params.mid); if(!ctx)return res.status(403).send('Invalid test session'); const {st,link}=ctx; const b=await companyBrand(st.company_id); const attempt=(await pool.query(`SELECT * FROM program_test_attempts WHERE student_id=$1 AND module_id=$2 AND status='in_progress' ORDER BY id DESC LIMIT 1`,[st.id,link.module_id])).rows[0]; if(!attempt)return res.redirect(`/program/student/${st.id}/module/${link.module_id}/test?token=${encodeURIComponent(st.join_token)}`);
 const snap=Array.isArray(attempt.question_snapshot)?attempt.question_snapshot:[]; let correct=0; const answers={}; for(let i=0;i<snap.length;i++){const ans=Number(req.body[`q_${i}`]);answers[i]=Number.isFinite(ans)?ans:null;if(ans===Number(snap[i].answer_index))correct++;} const score=snap.length?Math.round(correct*100/snap.length):0;
 await pool.query(`UPDATE program_test_attempts SET answers=$2::jsonb,score=$3,correct_count=$4,status='completed',completed_at=now() WHERE id=$1`,[attempt.id,JSON.stringify(answers),score,correct]); await pool.query(`INSERT INTO program_module_progress(student_id,module_id,completed,completed_at) VALUES($1,$2,true,now()) ON CONFLICT(student_id,module_id) DO UPDATE SET completed=true,completed_at=now()`,[st.id,link.module_id]);
 const review=snap.map((q,i)=>{const selected=answers[i];const right=Number(selected)===Number(q.answer_index);const choices=Array.isArray(q.choices)?q.choices:[];const selectedText=Number.isInteger(selected)&&choices[selected]!==undefined?`${String.fromCharCode(65+selected)}. ${choices[selected]}`:'No answer';const correctText=choices[q.answer_index]!==undefined?`${String.fromCharCode(65+Number(q.answer_index))}. ${choices[q.answer_index]}`:'Correct answer unavailable';return `<div class="q" style="text-align:left;border-left:5px solid ${right?'#1f7a3b':'#c4141c'}"><b>${i+1}. ${esc(q.question)}</b><div class="small" style="margin-top:7px"><b>Your answer:</b> ${esc(selectedText)}</div><div class="small"><b>Correct answer:</b> ${esc(correctText)}</div><div class="small"><b>${right?'✓ Correct':'✗ Incorrect'}</b></div></div>`;}).join('');
 res.send(tenantContext.run({companyId:st.company_id,brand:b},()=>layout('Test Complete',`<div class="card" style="max-width:900px;margin:auto;text-align:center"><div class="eyebrow">${esc(link.test_mode.toUpperCase())} COMPLETE</div><div class="big">${esc(link.bank_title)}</div><div class="stat" style="margin:20px auto;max-width:260px"><span>SCORE</span><b>${score}%</b></div><p><b>${correct} of ${snap.length}</b> correct.</p>${/Auto 4WD/i.test(link.bank_title)?`<div class="alert"><b>Suggested Evaluation:</b><br>${correct>=18?'Excellent':correct>=15?'Good':correct>=12?'Needs Improvement':'Retraining Recommended'}</div>`:''}<a class="btn" href="/program/student/${st.id}?token=${encodeURIComponent(st.join_token)}">Return to Program</a></div><div class="card" style="max-width:900px;margin:18px auto"><div class="section-title"><div><div class="eyebrow">ANSWER REVIEW</div><div class="big">Question-by-Question Results</div></div></div><p class="muted">${link.test_mode==='Knowledge Assessment'?'This standalone Auto 4WD assessment uses the editable question bank shown to the instructor.':'Pre-Test questions are shown in the same source order as the editable bank. The Post-Test uses the same questions in a different order.'}</p>${review}</div>`)));
});

app.get('/program/join/:token',async(req,res)=>{ const p=(await pool.query('SELECT p.*,c.name company_name FROM training_programs p JOIN companies c ON c.id=p.company_id WHERE p.join_token=$1 AND p.active=true AND c.active=true',[req.params.token])).rows[0]; if(!p)return res.status(404).send('Program unavailable'); const b=await companyBrand(p.company_id); res.send(tenantContext.run({companyId:p.company_id,brand:b},()=>layout('Join Program',`<div class="card" style="max-width:720px;margin:auto"><div class="eyebrow">MODULAR TRAINING PROGRAM</div><div class="big">${esc(p.title)}</div><p>${esc(p.description||'')}</p><form method="post" action="/program/join/${p.join_token}"><label>Your Name<input name="name" required></label><label>${esc(b.organization_unit_label||'Company / Location')}<input name="dealer"></label><button>Join Program</button></form></div>`))); });
app.post('/program/join/:token',async(req,res)=>{ const p=(await pool.query('SELECT * FROM training_programs WHERE join_token=$1 AND active=true',[req.params.token])).rows[0]; if(!p)return res.status(404).send('Program unavailable'); const name=String(req.body.name||'').trim(),dealer=String(req.body.dealer||'').trim(); if(!name)return res.redirect(`/program/join/${p.join_token}`); let st=(await pool.query('SELECT * FROM program_students WHERE program_id=$1 AND name=$2 AND dealer=$3',[p.id,name,dealer])).rows[0]; if(!st){const token=crypto.randomBytes(18).toString('hex');st=(await pool.query('INSERT INTO program_students(program_id,name,dealer,join_token) VALUES($1,$2,$3,$4) RETURNING *',[p.id,name,dealer,token])).rows[0];} res.redirect(`/program/student/${st.id}?token=${encodeURIComponent(st.join_token)}`); });


function isScavengerContent(x){ return String(x?.content_type||'').toLowerCase().includes('scavenger hunt'); }
function huntClassRef(value=''){
 const m=String(value||'').trim().match(/^hunt-class:(\d+)$/i);
 return m?Number(m[1]):0;
}
async function programHuntChoices(companyId){
 return (await pool.query(`
  SELECT c.id,c.code,c.title,c.course,c.active,c.hunt_type,
         count(DISTINCT hs.id)::int item_count,
         string_agg(DISTINCT NULLIF(ht.model,''), ', ' ORDER BY NULLIF(ht.model,'')) AS models
  FROM classes c
  LEFT JOIN hunt_stations hs ON hs.class_id=c.id
  LEFT JOIN hunt_tractors ht ON ht.class_id=c.id
  WHERE c.company_id=$1
  GROUP BY c.id
  HAVING count(DISTINCT hs.id)>0
  ORDER BY c.active DESC,c.created_at DESC,c.id DESC`,[companyId])).rows;
}
async function ensureProgram3100ScavengerModule(programId,companyId){
 const p=(await pool.query('SELECT id,title FROM training_programs WHERE id=$1 AND company_id=$2',[programId,companyId])).rows[0];
 if(!p)return;
 const sections=(await pool.query('SELECT * FROM program_sections WHERE program_id=$1 ORDER BY display_order,id',[programId])).rows;
 const eq=(await pool.query(`SELECT em.name FROM training_program_equipment pe JOIN company_equipment_models em ON em.id=pe.equipment_model_id WHERE pe.program_id=$1 AND em.company_id=$2`,[programId,companyId])).rows.map(x=>String(x.name||''));
 const wants3100=/\b3100\b/i.test(String(p.title||''))||sections.some(x=>/\b3100\b/i.test(String(x.title||'')))||eq.some(x=>/\b3100\b/i.test(x));
 if(!wants3100)return;
 const existing=(await pool.query(`SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$1 AND (lower(m.activity_type) LIKE '%scavenger hunt%' OR lower(m.title) LIKE '%scavenger hunt%') AND m.title ~* '(^|[^0-9])3100([^0-9]|$)' LIMIT 1`,[programId])).rows[0];
 if(existing)return;
 const sec=sections.find(x=>/\b3100\b/i.test(String(x.title||'')));
 if(!sec)return;
 const ord=Number((await pool.query('SELECT COALESCE(max(display_order),0)::int n FROM program_modules WHERE section_id=$1',[sec.id])).rows[0].n||0)+10;
 await pool.query(`INSERT INTO program_modules(section_id,title,description,activity_type,estimated_minutes,display_order,required,active) VALUES($1,'3100 Scavenger Hunt','Hands-on 3100 scavenger hunt linked to the matching Training Hub hunt.','Scavenger Hunt',30,$2,true,true)`,[sec.id,ord]);
}

async function ensureProgramScavengerLinks(programId,companyId){
 await ensureProgram3100ScavengerModule(programId,companyId);
 // 2.1.93: make sure the dedicated 3100 hunt actually exists, is active, and has stations
 // before trying to auto-link the Modular Program's 3100 Scavenger Hunt module.
 await ensureMahindra3100SUHuntClass(companyId);
 const mods=(await pool.query(`SELECT m.* FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE s.program_id=$1 AND m.active=true AND (lower(m.activity_type) LIKE '%scavenger hunt%' OR lower(m.title) LIKE '%scavenger hunt%') ORDER BY s.display_order,m.display_order,m.id`,[programId])).rows;
 if(!mods.length)return;
 const hunts=await programHuntChoices(companyId);
 for(const m of mods){
  let x=(await pool.query(`SELECT * FROM program_module_content WHERE module_id=$1 AND lower(content_type) LIKE '%scavenger hunt%' ORDER BY display_order,id LIMIT 1`,[m.id])).rows[0];
  if(!x){
   x=(await pool.query(`INSERT INTO program_module_content(module_id,content_type,title,body,resource_url,display_order,active) VALUES($1,'Scavenger Hunt',$2,$3,'',10,true) RETURNING *`,[m.id,m.title||'Scavenger Hunt',m.description||'Open the scavenger hunt for this module.'])).rows[0];
  }
  if(String(x.resource_url||'').trim())continue;
  const text=`${m.title||''} ${m.description||''} ${m.instructions||''}`;
  const nums=[...new Set((text.match(/\b\d{3,4}\b/g)||[]))];
  if(!nums.length)continue;
  let best=null,bestScore=0;
  for(const h of hunts){
   const hay=`${h.course||''} ${h.title||''} ${h.models||''}`;
   let score=0;
   for(const n of nums)if(new RegExp(`(^|[^0-9])${n}([^0-9]|$)`,'i').test(hay))score+=20;
   if(h.active)score+=1;
   if(score>bestScore){best=h;bestScore=score;}
  }
  if(best&&bestScore>=20)await pool.query('UPDATE program_module_content SET resource_url=$2 WHERE id=$1',[x.id,`hunt-class:${best.id}`]);
 }
}

async function dedupeModuleScavengerContent(programId,moduleId){
 const rows=(await pool.query(`SELECT pc.* FROM program_module_content pc JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pc.module_id=$1 AND s.program_id=$2 AND lower(pc.content_type) LIKE '%scavenger hunt%' ORDER BY pc.display_order,pc.id`,[moduleId,programId])).rows;
 if(rows.length<=1)return rows[0]||null;
 const keep=rows[0], linked=rows.find(x=>huntClassRef(x.resource_url))||keep;
 if(linked.id!==keep.id || linked.resource_url!==keep.resource_url){
  await pool.query(`UPDATE program_module_content SET title=$2,body=$3,resource_url=$4,display_order=$5,active=$6 WHERE id=$1`,[
   keep.id, linked.title||keep.title, linked.body||keep.body, linked.resource_url||keep.resource_url,
   Math.min(...rows.map(x=>Number(x.display_order)||100)), rows.some(x=>x.active)
  ]);
 }
 const drop=rows.filter(x=>x.id!==keep.id).map(x=>x.id);
 if(drop.length)await pool.query('DELETE FROM program_module_content WHERE id=ANY($1::int[])',[drop]);
 return (await pool.query('SELECT * FROM program_module_content WHERE id=$1',[keep.id])).rows[0];
}

function programStudentHuntButton(st,m,moduleContent){
 const huntContent=(moduleContent||[]).filter(x=>Number(x.module_id)===Number(m.id)&&isScavengerContent(x));
 const isHunt=String(m.activity_type||'').toLowerCase().includes('scavenger hunt')||huntContent.length>0;
 if(!isHunt)return '';
 const linked=huntContent.find(x=>String(x.resource_url||'').trim())||huntContent[0];
 const raw=String(linked?.resource_url||m.activity_url||'').trim();
 const internal=!!huntClassRef(raw);
 const target=internal||!raw
   ?` href="/program/student/${st.id}/module/${m.id}/hunt?token=${encodeURIComponent(st.join_token)}"`
   :` href="${esc(raw)}" target="_blank"`;
 return `<div style="margin:16px 0;padding:18px;border:2px solid var(--red);border-radius:14px;background:#fff7f7;text-align:center"><div class="eyebrow">SCAVENGER HUNT</div><div class="big" style="margin-bottom:8px">Hands-On Activity</div><a class="btn" style="display:block;width:100%;box-sizing:border-box;font-size:20px;padding:16px"${target}>START SCAVENGER HUNT</a><div class="small muted" style="margin-top:8px">${internal?'Linked to the existing Training Hub scavenger hunt.':'Tap here to open the scavenger hunt for this module.'}</div></div>`;
}

app.get('/program/student/:id',async(req,res)=>{
 const q=await pool.query(`SELECT ps.*,p.title program_title,p.description program_description,p.company_id FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2 AND p.active=true`,[req.params.id,String(req.query.token||'')]);
 const st=q.rows[0]; if(!st)return res.status(403).send('Invalid program session');
 const b=await companyBrand(st.company_id);
 await ensureProgramScavengerLinks(st.program_id,st.company_id);
 const tree=await programTree(st.program_id);
 const prog=(await pool.query('SELECT module_id,completed FROM program_module_progress WHERE student_id=$1',[st.id])).rows;
 const done=new Set(prog.filter(x=>x.completed).map(x=>Number(x.module_id)));
 const activeModules=orderedActiveProgramModules(tree), activeModuleIds=activeModules.map(m=>m.id);
 const firstIncompleteIndex=activeModules.findIndex(m=>!done.has(Number(m.id)));
 const maxVisibleIndex=firstIncompleteIndex<0?activeModules.length-1:firstIncompleteIndex;
 const visibleModules=activeModules.filter((m,i)=>i<=maxVisibleIndex);
 const visibleModuleIds=new Set(visibleModules.map(m=>Number(m.id)));
 if(activeModuleIds.length)await repairModuleNativeTests(st.program_id,st.company_id,activeModuleIds);
 for(const mid of activeModuleIds)await dedupeModuleScavengerContent(st.program_id,mid);
 const moduleContent=activeModuleIds.length?(await pool.query(`SELECT pc.*,pf.id file_id,pf.original_name,pf.file_size FROM program_module_content pc LEFT JOIN program_module_files pf ON pf.content_id=pc.id WHERE pc.module_id=ANY($1::int[]) AND pc.active=true AND COALESCE(pc.student_visibility,'visible')<>'hidden' ORDER BY pc.display_order,pc.id`,[activeModuleIds])).rows:[];
 const testLinks=activeModuleIds.length?(await pool.query(`SELECT l.*,b.title bank_title FROM program_module_test_links l JOIN program_test_banks b ON b.id=l.bank_id WHERE l.module_id=ANY($1::int[])`,[activeModuleIds])).rows:[];
 const testResults=activeModuleIds.length?(await pool.query(`SELECT DISTINCT ON (module_id) module_id,test_mode,score,correct_count,total_questions,completed_at FROM program_test_attempts WHERE student_id=$1 AND status='completed' AND module_id=ANY($2::int[]) ORDER BY module_id,completed_at DESC,id DESC`,[st.id,activeModuleIds])).rows:[];
 const required=activeModules.filter(m=>m.required), requiredDone=required.filter(m=>done.has(m.id)).length;
 const scheduleAll=(await pool.query('SELECT * FROM program_schedule_items WHERE program_id=$1 AND active=true ORDER BY display_order,id',[st.program_id])).rows;
 const schedule=scheduleAll.filter(x=>!x.module_id||visibleModuleIds.has(Number(x.module_id)));
 const studentSchedule=schedule.length?`<div class="card"><div class="big">Program Schedule</div><div style="overflow:auto"><table><tr><th>Day</th><th>Time</th><th>Activity</th><th>Duration</th></tr>${schedule.map(x=>`<tr><td><b>${esc(x.day_name)}</b></td><td>${esc(x.start_time||'')}</td><td>${esc(x.title)}</td><td>${Number(x.duration_minutes)>0?x.duration_minutes+' min':'—'}</td></tr>`).join('')}</table></div></div>`:'';
 const studentEquipment=await programEquipmentSelection(st.program_id,st.company_id); const visibleEquipment=studentEquipment.models; const studentEquipmentCard=`<div class="card"><div class="section-title"><div><div class="eyebrow">EQUIPMENT</div><div class="big">Program Equipment</div></div><span class="pill open">${visibleEquipment.length} MODEL${visibleEquipment.length===1?'':'S'}</span></div><div class="toolbar">${visibleEquipment.map(eq=>`<span class="pill">${esc(eq.name)}</span>`).join('')||'<span class="muted">No equipment selected.</span>'}</div></div>`;

 // Link a modular-program student to the matching student record in this company.
 // Dealer/location is used as a preference, not a hard requirement, because the modular-program
 // join and class join can contain slightly different company/location text. Prefer an active
 // class that already has released simulations, then an exact dealer/location match, then newest.
 let classStudent=(await pool.query(`
  SELECT s.*,c.code,c.course,c.created_at,c.join_token,
         CASE WHEN lower(trim(coalesce(s.dealer,'')))=lower(trim(coalesce($3,''))) THEN 1 ELSE 0 END dealer_match,
         (SELECT count(*)::int FROM simulation_assignments sa WHERE sa.class_id=c.id AND sa.enabled=true) released_count
  FROM students s
  JOIN classes c ON c.id=s.class_id
  WHERE c.company_id=$1 AND lower(trim(s.name))=lower(trim($2))
  ORDER BY c.active DESC,
           (SELECT count(*) FROM simulation_assignments sa WHERE sa.class_id=c.id AND sa.enabled=true) DESC,
           CASE WHEN lower(trim(coalesce(s.dealer,'')))=lower(trim(coalesce($3,''))) THEN 1 ELSE 0 END DESC,
           c.created_at DESC
  LIMIT 1`,[st.company_id,st.name,st.dealer||''])).rows[0]||null;
 let classLinkMode=classStudent?'name-match':'';
 // Automatic program-to-class link.
 // If this company has exactly one active class with released simulations, connect this modular-program
 // student to that class automatically. If the student has not separately joined the class yet, create
 // the matching class-student record so released simulations immediately appear in the program.
 if(!classStudent){
  // 2.1.55: choose the best active class with released simulations instead of requiring
  // exactly one active class. Prefer a course/title match to this program, then the class
  // whose simulation release was configured most recently. This prevents a student from
  // being stuck on "Student class link needed" when more than one active class exists.
  const activeReleasedClasses=(await pool.query(`
   SELECT c.*,
          (SELECT count(*)::int FROM simulation_assignments sa WHERE sa.class_id=c.id AND sa.enabled=true) released_count,
          (SELECT max(sa.configured_at) FROM simulation_assignments sa WHERE sa.class_id=c.id AND sa.enabled=true) last_release,
          CASE WHEN lower(trim(coalesce(c.course,'')))=lower(trim(coalesce($2,''))) THEN 2
               WHEN lower(trim(coalesce(c.course,''))) LIKE '%'||lower(trim(coalesce($2,'')))||'%'
                 OR lower(trim(coalesce($2,''))) LIKE '%'||lower(trim(coalesce(c.course,'')))||'%' THEN 1
               ELSE 0 END course_match
   FROM classes c
   WHERE c.company_id=$1 AND c.active=true
     AND EXISTS (SELECT 1 FROM simulation_assignments sa WHERE sa.class_id=c.id AND sa.enabled=true)
   ORDER BY course_match DESC,last_release DESC NULLS LAST,c.created_at DESC`,[st.company_id,st.program_title||''])).rows;
  if(activeReleasedClasses.length>=1){
   const c=activeReleasedClasses[0];
   let linked=(await pool.query(`SELECT s.*, $2::text AS code, $3::text AS course, $4::timestamptz AS created_at, $5::text AS join_token, $6::int AS released_count FROM students s WHERE s.class_id=$1 AND lower(trim(s.name))=lower(trim($7)) ORDER BY CASE WHEN lower(trim(coalesce(s.dealer,'')))=lower(trim(coalesce($8,''))) THEN 1 ELSE 0 END DESC,id DESC LIMIT 1`,[c.id,c.code,c.course,c.created_at,c.join_token,c.released_count,st.name,st.dealer||''])).rows[0]||null;
   if(!linked){
    const created=(await pool.query(`INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) ON CONFLICT(class_id,name,dealer) DO UPDATE SET name=EXCLUDED.name RETURNING *`,[c.id,st.name,st.dealer||''])).rows[0];
    linked={...created,code:c.code,course:c.course,created_at:c.created_at,join_token:c.join_token,released_count:c.released_count};
   }
   classStudent=linked; classLinkMode='best-active-release';
  }
 }
 let released=new Map(), latestAttempt=new Map();
 if(classStudent){
  const aa=(await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND enabled=true`,[classStudent.class_id])).rows; for(const a of aa)released.set(a.simulation_key,a);
  const at=(await pool.query(`SELECT * FROM simulation_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[classStudent.id])).rows; for(const a of at)if(!latestAttempt.has(a.simulation_key))latestAttempt.set(a.simulation_key,a);
 }
 function programSimulationCards(m){
  const title=String(m.title||''); const prefix=title.includes('Module 4A')?'seg1-':title.includes('Module 4B')?'seg2-':''; if(!prefix)return '';
  const keys=allSimulationKeys().filter(k=>k.startsWith(prefix)).sort((a,b)=>String(simByKey(a)?.workOrder||'').localeCompare(String(simByKey(b)?.workOrder||'')));
  const segmentName=prefix==='seg1-'?'Segment 1 — Inputs & Logic':'Segment 2 — Circuit Proof & Networks';
  const cards=keys.map((key,i)=>{const sim=simByKey(key);if(!sim)return '';const a=released.get(key),prev=latestAttempt.get(key);let state='<span class="pill">Not Released</span>',action='<div class="small muted">Your instructor must release this simulation to your class before it can be started.</div>';
   if(a&&classStudent){state=prev?.status==='completed'?`<span class="pill open">Complete · ${prev.score}%</span>`:prev?.status==='in_progress'?'<span class="pill testing">In Progress</span>':'<span class="pill open">Released</span>'; if(prev?.status==='in_progress'){
    const href=`/student/${classStudent.id}/scenario/${prev.id}?token=${encodeURIComponent(classStudent.join_token)}`;
    action=`<a class="btn" href="${href}">Continue Simulation</a>`;
   } else {
    action=`<form method="post" action="/student/${classStudent.id}/scenario/start?token=${encodeURIComponent(classStudent.join_token)}" style="display:inline"><input type="hidden" name="simulation_key" value="${esc(sim.key)}"><button class="btn">${prev?.status==='completed'?'Run Again':'Start Simulation'}</button></form>`;
   }}
   return `<div style="margin:10px 0;padding:14px;border:1px solid #ddd;border-radius:12px;background:#fff"><div class="section-title"><div><div class="eyebrow">${esc(sim.workOrder)} · ${i+1} of 10</div><b>${esc(sim.title)}</b></div>${state}</div><p class="small"><b>Customer Complaint:</b> ${esc(sim.complaint)}</p><div class="toolbar">${action}</div></div>`;}).join('');
  const linkNote=!classStudent?`<div class="alert"><b>Student class link needed:</b> These simulations are released through an instructor class. Join the instructor's active class, then reopen this program.</div>`:classLinkMode==='best-active-release'?`<div class="success"><b>Class linked automatically:</b> This program student is linked to active class ${esc(classStudent.code||'')} using the best active release match for this training program.</div>`:'';
  return `<div style="margin:14px 0;padding:14px;border:2px solid #c4141c;border-radius:14px;background:#fafafa"><div class="section-title"><div><div class="eyebrow">105-MINUTE DIAGNOSTIC BLOCK</div><div class="big" style="font-size:20px">${segmentName}</div></div><span class="pill open">10 Simulations</span></div>${linkNote}${cards}</div>`;
 }
 const sections=tree.sections.filter(s=>s.active).map(sec=>{const mods=visibleModules.filter(m=>m.section_id===sec.id); if(!mods.length)return ''; return `<div class="card"><div class="eyebrow">SECTION / TRACK</div><div class="big">${esc(sec.title)}</div><p class="muted">${esc(sec.description||'')}</p>${mods.map(m=>`<div class="q" style="border-left:5px solid ${done.has(m.id)?'#1f7a3b':'#c4141c'}"><div class="section-title"><div><b>${esc(m.title)}</b><div class="small muted">${esc(m.activity_type)} · ${m.required?'Required':'Optional'}</div></div><span class="pill ${done.has(m.id)?'open':''}">${done.has(m.id)?'Complete':'Open'}</span></div>${m.description?`<p>${esc(m.description)}</p>`:''}${m.instructions?`<div class="alert">${esc(m.instructions)}</div>`:''}${programStudentHuntButton(st,m,moduleContent)}${programSimulationCards(m)}${moduleContent.filter(x=>Number(x.module_id)===Number(m.id)&&!String(x.title||'').startsWith('Segment ')&&!canonicalTestMode(x.content_type)&&!isScavengerContent(x)).map(x=>renderProgramStudentContent(x,st)).join('')}${(()=>{const tl=testLinks.find(x=>Number(x.module_id)===Number(m.id));if(!tl)return '';const tr=testResults.find(x=>Number(x.module_id)===Number(m.id));return `<div class="success" style="margin:10px 0"><b>${esc(tl.test_mode)}:</b> ${tr?`Completed · ${tr.score}% (${tr.correct_count}/${tr.total_questions})`:'Ready'}<br><a class="btn" style="margin-top:8px" href="/program/student/${st.id}/module/${m.id}/test?token=${encodeURIComponent(st.join_token)}">${tr?'Retake':'Start'} ${esc(tl.test_mode)}</a></div>`;})()}<div class="toolbar" style="margin-top:10px">${m.activity_url?`<a class="btn" href="${esc(m.activity_url)}" target="_blank">Open Activity</a>`:''}${testLinks.some(x=>Number(x.module_id)===Number(m.id))?'':`<form method="post" action="/program/student/${st.id}/module/${m.id}?token=${encodeURIComponent(st.join_token)}"><button class="btn ${done.has(m.id)?'light':''}">${done.has(m.id)?'Mark Incomplete':'Mark Complete'}</button></form>`}</div></div>`).join('')||'<p class="muted">No active modules in this section.</p>'}</div>`}).join('');
 const mediaPerfScript=`<script>(function(){
 const vids=[...document.querySelectorAll('.tth-lazy-video')];
 function prepare(v){if(v.dataset.loaded)return;v.dataset.loaded='1';v.preload='metadata';v.src=v.dataset.src||'';const box=v.closest('.tth-lazy-media'),st=box&&box.querySelector('.tth-media-status');if(st)st.textContent='Preparing training video…';v.addEventListener('loadedmetadata',()=>{if(st)st.textContent='Ready · press Play';},{once:true});v.addEventListener('playing',()=>{if(st)st.textContent='Playing';});v.addEventListener('waiting',()=>{if(st)st.textContent='Buffering video…';});v.addEventListener('canplay',()=>{if(st&&v.paused)st.textContent='Ready · press Play';});v.load();}
 if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){prepare(e.target);io.unobserve(e.target);}}),{rootMargin:'500px 0px'});vids.forEach(v=>io.observe(v));}else vids.slice(0,1).forEach(prepare);
 vids.forEach(v=>v.addEventListener('play',()=>prepare(v),{once:true}));
 document.querySelectorAll('.tth-training-file-link').forEach(a=>a.addEventListener('click',()=>{const st=a.parentElement&&a.parentElement.querySelector('.tth-file-status');if(st){st.textContent='Preparing file…';setTimeout(()=>{if(st)st.textContent='';},12000);}}));
})();</script>`;
 res.send(tenantContext.run({companyId:st.company_id,brand:b},()=>layout(st.program_title,`<div class="hero"><div><div class="eyebrow">YOUR TRAINING PROGRAM</div><h1>${esc(st.program_title)}</h1><p>${esc(st.program_description||'')}</p></div><div class="stat"><span>REQUIRED PROGRESS</span><b>${requiredDone}/${required.length}</b></div></div>${studentEquipmentCard}${studentSchedule}<div class="success"><b>Module Progression:</b> Complete the current module to unlock the next module. Future modules stay hidden until they are unlocked.</div>${sections}`,mediaPerfScript)));
});
app.get('/program/student/:id/module/:mid/hunt',async(req,res)=>{
 const st=(await pool.query(`SELECT ps.*,p.company_id,p.title program_title FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2 AND p.active=true`,[req.params.id,String(req.query.token||'')])).rows[0];
 if(!st)return res.status(403).send('Invalid program session');
 const m=(await pool.query(`SELECT m.* FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE m.id=$1 AND s.program_id=$2 AND m.active=true`,[req.params.mid,st.program_id])).rows[0];
 if(!m)return res.status(404).send('Module not found');
 if(!(await programStudentModuleAccess(st.id,st.program_id,m.id)))return res.status(403).send('Complete the current module before opening this module.');
 await ensureProgramScavengerLinks(st.program_id,st.company_id);
 await dedupeModuleScavengerContent(st.program_id,m.id);
 const c=(await pool.query(`SELECT * FROM program_module_content WHERE module_id=$1 AND active=true AND lower(content_type) LIKE '%scavenger hunt%' ORDER BY display_order,id`,[m.id])).rows;
 const linked=c.find(x=>String(x.resource_url||'').trim())||c[0];
 const href=String(linked?.resource_url||m.activity_url||'').trim();
 const classId=huntClassRef(href);
 if(classId){
  const hc=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[classId,st.company_id])).rows[0];
  if(!hc)return res.status(404).send('Linked scavenger hunt class not found');
  let cs=(await pool.query(`SELECT * FROM students WHERE class_id=$1 AND lower(trim(name))=lower(trim($2)) ORDER BY CASE WHEN lower(trim(coalesce(dealer,'')))=lower(trim(coalesce($3,''))) THEN 1 ELSE 0 END DESC,id DESC LIMIT 1`,[hc.id,st.name,st.dealer||''])).rows[0];
  if(!cs)cs=(await pool.query(`INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *`,[hc.id,st.name,st.dealer||''])).rows[0];
  res.append('Set-Cookie',`mth_student_${hc.id}=${cs.id}:${hc.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  res.append('Set-Cookie',`mth_program_student=${st.id}:${st.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  return res.redirect(`/student/${cs.id}/hunt?token=${encodeURIComponent(hc.join_token)}`);
 }
 if(href)return res.redirect(href);
 const b=await companyBrand(st.company_id);
 res.send(tenantContext.run({companyId:st.company_id,brand:b},()=>layout('Scavenger Hunt',`<div class="card" style="max-width:760px;margin:auto;text-align:center;border-top:6px solid var(--red)"><div class="eyebrow">SCAVENGER HUNT</div><div class="big">Waiting for Instructor</div><p>This module is set up as a Scavenger Hunt, but the hunt has not been linked or released yet.</p><div class="alert" style="color:#111"><b>Instructor:</b> open this module in the Module Content Editor and add the Scavenger Hunt activity/link. Once it is linked, this same START SCAVENGER HUNT button will open it directly.</div><a class="btn light" href="/program/student/${st.id}?token=${encodeURIComponent(st.join_token)}">Back to Program</a></div>`)));
});

app.get('/program/student/:id/file/:fid',async(req,res)=>{
 try{
  const stq=await pool.query(`SELECT ps.id,ps.program_id,ps.join_token FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2 AND p.active=true`,[req.params.id,String(req.query.token||'')]); const st=stq.rows[0]; if(!st)return res.status(403).send('Invalid program session');
  const q=await pool.query(`SELECT pf.*,pc.student_visibility,m.id module_id FROM program_module_files pf JOIN program_module_content pc ON pc.id=pf.content_id JOIN program_modules m ON m.id=pc.module_id JOIN program_sections s ON s.id=m.section_id WHERE pf.id=$1 AND pc.active=true AND m.active=true AND s.active=true AND s.program_id=$2`,[req.params.fid,st.program_id]); const f=q.rows[0]; if(!f)return res.status(404).send('File not found');
  if(!(await programStudentModuleAccess(st.id,st.program_id,f.module_id)))return res.status(403).send('Complete the current module before opening this training file.');
  res.setHeader('Content-Type',moduleFileMime(f));
  setPrivateMediaCacheHeaders(res,f);
  res.setHeader('Accept-Ranges','bytes');
  if(Number(f.file_size)>0&&!req.headers.range)res.setHeader('Content-Length',String(Number(f.file_size)));
  res.setHeader('Content-Disposition',`${isModuleVideoFile(f)?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  await streamChunkedDbFileWithRange(req,res,{table:'program_module_file_chunks',fileId:f.id,fallbackData:f.file_data,totalSize:f.file_size,maxRangeBytes:isModuleVideoFile(f)?4*1024*1024:0});
 }catch(e){
  console.error('Student module file download error:',e);
  if(!res.headersSent)return res.status(500).send('Training file download failed. Please try again.');
  try{res.end();}catch(_e){}
 }
});

app.post('/program/student/:id/module/:mid',async(req,res)=>{
 const st=(await pool.query('SELECT ps.*,p.company_id FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND ps.join_token=$2',[req.params.id,String(req.query.token||'')])).rows[0];
 if(!st)return res.status(403).send('Invalid session');
 const m=(await pool.query('SELECT m.id FROM program_modules m JOIN program_sections s ON s.id=m.section_id WHERE m.id=$1 AND s.program_id=$2 AND m.active=true AND s.active=true',[req.params.mid,st.program_id])).rows[0];
 if(m){
  if(!(await programStudentModuleAccess(st.id,st.program_id,m.id)))return res.status(403).send('Complete the current module before opening this module.');
  const ex=(await pool.query('SELECT completed FROM program_module_progress WHERE student_id=$1 AND module_id=$2',[st.id,m.id])).rows[0];
  const next=!(ex?.completed);
  await pool.query('INSERT INTO program_module_progress(student_id,module_id,completed,completed_at) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,module_id) DO UPDATE SET completed=EXCLUDED.completed,completed_at=EXCLUDED.completed_at',[st.id,m.id,next,next?new Date():null]);
 }
 res.redirect(`/program/student/${st.id}?token=${encodeURIComponent(st.join_token)}`);
});

app.get('/instructor/simulations',auth,async(req,res)=>{
 const acs=await allowedCourseSet(req.account);
 const q=await pool.query(`SELECT a.*,s.name,s.dealer,c.course,c.code FROM simulation_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE c.company_id=$1 ORDER BY COALESCE(a.completed_at,a.started_at) DESC,a.id DESC LIMIT 200`,[req.account.company_id]);
 const visibleAttempts=acs?q.rows.filter(a=>acs.has(a.course)):q.rows;
 const rows=visibleAttempts.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.dealer)}</td><td>${esc(a.title)}</td><td>${a.status==='completed'?a.score+'%':'In Progress'}</td><td>${a.penalty_points?'-'+a.penalty_points:'0'}</td><td>${a.completed_at?new Date(a.completed_at).toLocaleString():new Date(a.started_at).toLocaleString()}</td><td><a class="btn light" href="/instructor/simulation/${a.id}">Open</a></td></tr>`).join('');
 let classes=(await pool.query(`SELECT c.*, (SELECT count(*)::int FROM students s WHERE s.class_id=c.id) student_count FROM classes c WHERE c.company_id=$1 ORDER BY c.active DESC,c.created_at DESC LIMIT 100`,[req.account.company_id])).rows; if(acs) classes=classes.filter(c=>acs.has(c.course));
 const releaseAll=(await pool.query(`SELECT sa.*,c.code,c.course FROM simulation_assignments sa JOIN classes c ON c.id=sa.class_id WHERE c.company_id=$1 ORDER BY sa.configured_at DESC,sa.id DESC`,[req.account.company_id])).rows;
 const releases=acs?releaseAll.filter(r=>acs.has(r.course)):releaseAll;
 const releaseRows=releases.map(r=>{ const sim=simByKey(r.simulation_key); const title=sim?.title||r.simulation_key; return `<tr><td><b>${esc(title)}</b><br><span class="muted small">${esc(r.tractor_model||sim?.model||'')}</span></td><td><b>${esc(r.code)}</b><br><span class="muted small">${esc(r.course||'')}</span></td><td><span class="pill ${r.enabled?'open':'closed'}">${r.enabled?'ACTIVE':'INACTIVE'}</span></td><td class="nowrap"><form method="post" action="/instructor/simulations/${encodeURIComponent(r.simulation_key)}/class/${r.class_id}/${r.enabled?'deactivate':'activate'}" style="display:inline"><button type="submit" class="${r.enabled?'danger':''}" onclick="return confirm('${r.enabled?'Deactivate this simulation for class '+esc(r.code)+'? Students will no longer see it, but prior attempts will stay saved.':'Reactivate this simulation for class '+esc(r.code)+'?'}')">${r.enabled?'Deactivate':'Reactivate'}</button></form></td></tr>`; }).join('');
 const assignments=releases.filter(r=>r.enabled);
 const latestBySim=new Map();
 for(const a of assignments){ if(!latestBySim.has(a.simulation_key)) latestBySim.set(a.simulation_key,a); }
 const classOptions=classes.map(c=>`<option value="${c.id}">${esc(c.code)} · ${c.student_count} student(s) · ${c.active?'Active':'Closed'}</option>`).join('');
 const companyModels=(await companyEquipmentModels(req.account.company_id)).map(x=>x.name);
 const segment=String(req.query.segment||'all').toLowerCase();
 const allLibraryKeys=allSimulationKeys().filter(key=>DIAGNOSTIC_SIMULATIONS[key]||key.startsWith(`c${req.account.company_id}-`));
 const segmentForKey=key=>key.startsWith('seg1-')?'segment1':key.startsWith('seg2-')?'segment2':'other';
 const seg1Count=allLibraryKeys.filter(k=>segmentForKey(k)==='segment1').length;
 const seg2Count=allLibraryKeys.filter(k=>segmentForKey(k)==='segment2').length;
 const visibleLibraryKeys=allLibraryKeys.filter(key=>segment==='all'||segmentForKey(key)===segment);
 const segmentFilter=`<div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><div><div class="eyebrow">105-MINUTE DIAGNOSTIC BLOCKS</div><div class="big">Simulation Segments</div></div><span class="pill">20 Guided Scenarios</span></div><p class="muted">The Simulation tab is the master location for the diagnostic activities. Each 105-minute segment contains 10 simulations: approximately 10 minutes per scenario plus a 5-minute instructor debrief.</p><div class="toolbar"><a class="btn ${segment==='all'?'':'light'}" href="/instructor/simulations?segment=all">All Simulations</a><a class="btn ${segment==='segment1'?'':'light'}" href="/instructor/simulations?segment=segment1">Segment 1 · Inputs & Logic (${seg1Count})</a><a class="btn ${segment==='segment2'?'':'light'}" href="/instructor/simulations?segment=segment2">Segment 2 · Circuit Proof & Networks (${seg2Count})</a><a class="btn ${segment==='other'?'':'light'}" href="/instructor/simulations?segment=other">Other / Custom</a></div></div>`;
 const sims=visibleLibraryKeys.map(key=>simByKey(key)).filter(Boolean).map(sim=>{
  const a=latestBySim.get(sim.key)||null;
  const selectedClass=a?.class_id||'';
  const selectedRoot=a?.root_cause_key||'';
  const selectedTractor=(a?.tractor_model||'');
  const simulationModels=[...companyModels];
  if(selectedTractor && !simulationModels.includes(selectedTractor)) simulationModels.unshift(selectedTractor);
  const selectedClassRow=classes.find(c=>Number(c.id)===Number(selectedClass));
  return `<div class="card" style="border-top:5px solid var(--red)">
   <div class="section-title"><div><div class="eyebrow">${esc(sim.series||'DIAGNOSTIC SIMULATION')} · ${esc(sim.workOrder||'')}</div><div class="big">${esc(sim.title)}</div></div>${selectedClass&&selectedRoot&&selectedTractor?'<span class="pill open">RELEASED</span>':'<span class="pill">NOT RELEASED</span>'}</div>
   <p><b>Work Order:</b> ${esc(sim.workOrder)}</p>
   <div class="alert"><b>Customer Complaint:</b> ${esc(sim.complaint)}</div>
   <form method="post" action="/instructor/simulations/${encodeURIComponent(sim.key)}/configure" style="margin-top:14px">
    <label>Class<select name="class_id" class="sim-class-select" required><option value="" data-count="0">Choose class</option>${classes.map(c=>`<option value="${c.id}" data-count="${Math.max(0,Number(c.student_count)||0)}" ${Number(selectedClass)===Number(c.id)?'selected':''}>${esc(c.code)} · ${c.student_count} student(s) · ${c.active?'Active':'Closed'}</option>`).join('')}</select></label>
    <label>Equipment / Model<select name="tractor_model" required><option value="">— Select Equipment Model —</option>${simulationModels.map(m=>`<option value="${esc(m)}" ${selectedTractor===m?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
    <label>Planted Root Cause<select name="root_cause_key" required><option value="">Select the failure BEFORE students begin</option>${sim.rootCauses.map(r=>`<option value="${esc(r.key)}" ${selectedRoot===r.key?'selected':''}>${esc(r.diagnosis)}</option>`).join('')}</select></label>
    <div class="grid"><label>Difficulty<select name="difficulty"><option ${a?.difficulty==='Basic'?'selected':''}>Basic</option><option ${(!a?.difficulty||a?.difficulty==='Intermediate')?'selected':''}>Intermediate</option><option ${a?.difficulty==='Advanced'?'selected':''}>Advanced</option></select></label><label>Passing Score<input type="number" min="0" max="100" name="pass_score" value="${Number(a?.pass_score)||sim.passScore||80}"></label><label>Max Parts Cannon Penalties<input type="number" min="0" max="20" name="max_parts_penalties" value="${Number.isFinite(Number(a?.max_parts_penalties))?Number(a.max_parts_penalties):sim.maxPartsPenalties}"></label><label>Scavenger Hunt Prerequisite<select name="prerequisite_hunt_type"><option value="none" ${(!a?.prerequisite_hunt_type||a?.prerequisite_hunt_type==='none')?'selected':''}>None</option><option value="general" ${a?.prerequisite_hunt_type==='general'?'selected':''}>General Equipment / Station Hunt</option><option value="fmcu" ${a?.prerequisite_hunt_type==='fmcu'?'selected':''}>Safety / Inspection Hunt</option><option value="auto4wd" ${a?.prerequisite_hunt_type==='auto4wd'?'selected':''}>Process / Logic Hunt</option></select></label></div>
    <button>${selectedClass&&selectedRoot&&selectedTractor?'Update Simulation':'Release This Simulation'}</button>
   </form>
   ${selectedClass&&selectedRoot&&selectedTractor?`<div class="success" style="margin-top:10px"><b>Instructor Only:</b> Class ${esc(selectedClassRow?.code||selectedClass)} · Equipment: ${esc(selectedTractor)} · All enrolled students · Root Cause: ${esc(rootCauseByKey(sim,selectedRoot)?.diagnosis||'')}</div>`:''}
   <div class="toolbar"><a class="btn" href="/instructor/simulations/${encodeURIComponent(sim.key)}/edit">Edit Everything</a><a class="btn light" href="/instructor/simulations/${encodeURIComponent(sim.key)}/preview">Preview</a><a class="btn light" href="/instructor/simulations/${encodeURIComponent(sim.key)}/setup-sheet">Instructor Setup Sheet</a>${DIAGNOSTIC_SIMULATIONS[sim.key]?'':`<form method="post" action="/instructor/simulations/${encodeURIComponent(sim.key)}/duplicate" style="display:inline"><button class="light" type="submit">Duplicate</button></form>`}</div>
  </div>`;
 }).join('');
 res.send(layout('Diagnostic Simulations', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Command Center</a><a class="btn" href="/instructor/simulations/release-center">Quick Release Center</a><a class="btn light" href="/instructor/simulations/new">+ Create Simulation</a><a class="btn light" href="/instructor/simulations/live">Live Progress</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">Diagnostic Failure Simulation System · 2.1.34</div><div class="big" style="font-size:30px">Simulation Library</div><p style="margin-bottom:0">Your 20 guided diagnostic scenarios now live here in two 105-minute segments. Choose a segment, configure the class, equipment and hidden root cause, then release each scenario to students.</p></div>${segmentFilter}${sims}<div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><div><div class="eyebrow">RELEASE CONTROL</div><div class="big">Simulation Releases by Class</div></div><span class="pill">Activate / Deactivate</span></div><p class="muted">Deactivating a release hides it from students in that class. The simulation, setup, completed attempts, scores, and history are not deleted.</p><div style="overflow:auto"><table><thead><tr><th>Simulation</th><th>Class</th><th>Status</th><th>Action</th></tr></thead><tbody>${releaseRows||'<tr><td colspan="4">No simulations have been released yet.</td></tr>'}</tbody></table></div></div><div class="card"><div class="big">Student Attempts</div><p>Permanent record of each student's diagnostic path, test sequence, parts-cannon penalties, final diagnosis, repair selection, score, and elapsed time.</p><div style="overflow:auto"><table class="sim-history"><thead><tr><th>${esc(brand('student_label','Student'))}</th><th>${esc(brand('organization_unit_label','Company / Location'))}</th><th>Simulation</th><th>Score</th><th>Penalty</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7">No student has run a simulation yet.</td></tr>'}</tbody></table></div></div>`,simulationCss()));
});


// 2.1.44 — Quick Release Center: choose class once, then release a whole 10-simulation segment.
app.get('/instructor/simulations/release-center',auth,async(req,res)=>{
 const acs=await allowedCourseSet(req.account);
 let classes=(await pool.query(`SELECT c.*, (SELECT count(*)::int FROM students s WHERE s.class_id=c.id) student_count FROM classes c WHERE c.company_id=$1 ORDER BY c.active DESC,c.created_at DESC`,[req.account.company_id])).rows;
 if(acs) classes=classes.filter(c=>acs.has(c.course));
 const classId=Number(req.query.class_id)||Number(classes.find(c=>c.active&&Number(c.student_count)>0)?.id)||Number(classes[0]?.id)||0;
 const selectedClass=classes.find(c=>Number(c.id)===classId)||null;
 const segment=String(req.query.segment||'segment1')==='segment2'?'segment2':'segment1';
 const prefix=segment==='segment2'?'seg2-':'seg1-';
 const keys=allSimulationKeys().filter(k=>k.startsWith(prefix)).slice(0,10);
 const companyModels=(await companyEquipmentModels(req.account.company_id)).map(x=>x.name);
 let assigned=new Map();
 if(selectedClass){
  const rows=(await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1`,[selectedClass.id])).rows;
  for(const r of rows) assigned.set(r.simulation_key,r);
 }
 const existingModel=[...assigned.values()].find(a=>a.enabled&&a.tractor_model)?.tractor_model||'';
 if(existingModel&&!companyModels.includes(existingModel))companyModels.unshift(existingModel);
 const classOptions=classes.map(c=>`<option value="${c.id}" ${Number(c.id)===classId?'selected':''}>${esc(c.code)} · ${esc(c.course||'')} · ${c.student_count} student(s) · ${c.active?'Active':'Closed'}</option>`).join('');
 const modelOptions=companyModels.map(m=>`<option value="${esc(m)}" ${existingModel===m?'selected':''}>${esc(m)}</option>`).join('');
 const simRows=keys.map((key,i)=>{
  const sim=simByKey(key); if(!sim)return '';
  const a=assigned.get(key)||null;
  const selectedRoot=rootCauseByKey(sim,a?.root_cause_key)?a.root_cause_key:(sim.rootCauses?.[0]?.key||'');
  const rootOpts=(sim.rootCauses||[]).map(r=>`<option value="${esc(r.key)}" ${selectedRoot===r.key?'selected':''}>${esc(r.diagnosis)}</option>`).join('');
  const repairedRootNotice=a?.root_cause_key&&!rootCauseByKey(sim,a.root_cause_key)?`<div class="success" style="margin-top:8px"><b>Root cause updated:</b> This released simulation used an older root-cause setting. It will use <b>${esc(rootCauseByKey(sim,selectedRoot)?.diagnosis||selectedRoot)}</b>.</div>`:'';
  return `<div style="padding:14px 0;border-bottom:1px solid #e3e3e3"><div class="section-title"><div style="min-width:0"><label style="display:flex;gap:10px;align-items:flex-start;margin:0"><input type="checkbox" name="simulation_key" value="${esc(key)}" checked style="width:auto;margin-top:4px"><span><span class="eyebrow">${esc(sim.workOrder||key)} · ${i+1} OF 10</span><br><b>${esc(sim.title)}</b></span></label></div><span class="pill ${a?.enabled?'open':'closed'}">${a?.enabled?'RELEASED':'NOT RELEASED'}</span></div><div class="toolbar" style="margin:8px 0 4px"><a class="btn light" href="/instructor/simulations/${encodeURIComponent(key)}/edit">Edit Simulation</a><a class="btn light" href="/instructor/simulations/${encodeURIComponent(key)}/preview">Preview</a><a class="btn light" href="/instructor/simulations/${encodeURIComponent(key)}/setup-sheet">Setup Sheet</a></div><div class="grid" style="margin-top:10px"><label>Planted Root Cause<select name="root_${esc(key)}" required>${rootOpts}</select></label><div class="alert"><b>Customer Complaint:</b> ${esc(sim.complaint||'')}</div></div>${repairedRootNotice}</div>`;
 }).join('');
 const noClasses=!classes.length?`<div class="alert"><b>No classes available.</b> Create or open a class before releasing simulations.</div>`:'';
 const noStudents=selectedClass&&Number(selectedClass.student_count)<1?`<div class="alert"><b>No class-student record yet.</b> You can still release simulations now. When a modular-program student opens the program, the Training Hub will link that student to this active class automatically.</div>`:'';
 res.send(layout('Simulation Quick Release', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulation Library</a><a class="btn light" href="/instructor/dashboard">Instructor Command Center</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">SIMULATION QUICK RELEASE · 2.1.56</div><div class="big" style="font-size:30px">Release a Whole Segment From One Screen</div><p style="margin-bottom:0">Choose the class once, choose the equipment once, verify the hidden root cause for each scenario, then release the selected simulations together.</p></div>${noClasses}<div class="card"><div class="big">1. Choose Class & Segment</div><form method="get" action="/instructor/simulations/release-center"><div class="grid"><label>Class<select name="class_id" required>${classOptions}</select></label><label>Simulation Segment<select name="segment"><option value="segment1" ${segment==='segment1'?'selected':''}>Module 4A · Segment 1 · Inputs & Logic</option><option value="segment2" ${segment==='segment2'?'selected':''}>Module 4B · Segment 2 · Circuit Proof & Networks</option></select></label></div><button>Load Segment</button></form></div>${selectedClass?`<form method="post" action="/instructor/simulations/release-center"><input type="hidden" name="class_id" value="${selectedClass.id}"><input type="hidden" name="segment" value="${segment}"><div class="card" style="border-top:6px solid var(--red)"><div class="section-title"><div><div class="eyebrow">2. RELEASE CONTROL</div><div class="big">${segment==='segment1'?'Module 4A · Segment 1':'Module 4B · Segment 2'}</div><p class="muted" style="margin-bottom:0">Class ${esc(selectedClass.code)} · ${selectedClass.student_count} student(s)</p></div><span class="pill open">10 SIMULATIONS</span></div>${noStudents}<label>Equipment / Model<select name="tractor_model" required><option value="">— Select Equipment Model —</option>${modelOptions}</select></label><div class="alert" style="margin-top:10px"><b>Simple release:</b> All 10 simulations are selected by default. Uncheck any you do not want. Root causes are preselected but can be changed before release. Difficulty, passing score, Parts Cannon limits, and prerequisites can still be changed later from an individual simulation.</div>${simRows}<div class="toolbar" style="margin-top:16px"><button type="submit" name="mode" value="release">Release Selected Simulations</button><button type="submit" name="mode" value="deactivate" class="danger" onclick="return confirm('Deactivate the selected simulations for class ${esc(selectedClass.code)}? Prior student attempts will remain saved.')">Deactivate Selected</button></div></div></form>`:''}`));
});

app.post('/instructor/simulations/release-center',auth,async(req,res)=>{
 const classId=Number(req.body.class_id), segment=req.body.segment==='segment2'?'segment2':'segment1', mode=req.body.mode==='deactivate'?'deactivate':'release';
 const prefix=segment==='segment2'?'seg2-':'seg1-';
 const allowedKeys=new Set(allSimulationKeys().filter(k=>k.startsWith(prefix)).slice(0,10));
 let selected=req.body.simulation_key||[]; if(!Array.isArray(selected))selected=[selected]; selected=selected.filter(k=>allowedKeys.has(k));
 if(!classId||!selected.length)return res.status(400).send('Choose a class and at least one simulation.');
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[classId,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found.');
 if(mode==='deactivate'){
  await pool.query(`UPDATE simulation_assignments SET enabled=false WHERE class_id=$1 AND simulation_key=ANY($2::text[])`,[classId,selected]);
  return res.redirect(`/instructor/simulations/release-center?class_id=${classId}&segment=${segment}&saved=1`);
 }
 const tractorModel=(req.body.tractor_model||'').trim(); const models=(await companyEquipmentModels(req.account.company_id)).map(x=>x.name); if(!tractorModel||!models.includes(tractorModel))return res.status(400).send('Choose a valid equipment/model.');
 for(const key of selected){
  const sim=simByKey(key); if(!sim)continue;
  const rootKey=(req.body[`root_${key}`]||'').trim(); if(!rootCauseByKey(sim,rootKey))return res.status(400).send(`Choose a valid planted root cause for ${sim.workOrder||key}.`);
  const activeAttempts=Number((await pool.query(`SELECT count(*)::int n FROM simulation_attempts WHERE class_id=$1 AND simulation_key=$2 AND status='in_progress'`,[classId,key])).rows[0]?.n||0); if(activeAttempts)continue;
  const prior=(await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND simulation_key=$2`,[classId,key])).rows[0]||{};
  const difficulty=['Basic','Intermediate','Advanced'].includes(prior.difficulty)?prior.difficulty:(sim.difficulty||'Intermediate');
  const passScore=Math.min(100,Math.max(0,Number(prior.pass_score)||sim.passScore||80));
  const maxParts=Math.min(20,Math.max(0,Number.isFinite(Number(prior.max_parts_penalties))?Number(prior.max_parts_penalties):(sim.maxPartsPenalties||1)));
  const prereq=['none','general','fmcu','auto4wd'].includes(prior.prerequisite_hunt_type)?prior.prerequisite_hunt_type:'none';
  await pool.query(`INSERT INTO simulation_assignments(class_id,simulation_key,root_cause_key,tractor_model,technician_limit,difficulty,pass_score,max_parts_penalties,prerequisite_hunt_type,enabled,configured_at) VALUES($1,$2,$3,$4,15,$5,$6,$7,$8,true,now()) ON CONFLICT(class_id,simulation_key) DO UPDATE SET root_cause_key=$3,tractor_model=$4,technician_limit=15,difficulty=$5,pass_score=$6,max_parts_penalties=$7,prerequisite_hunt_type=$8,enabled=true,configured_at=now()`,[classId,key,rootKey,tractorModel,difficulty,passScore,maxParts,prereq]);
 }
 res.redirect(`/instructor/simulations/release-center?class_id=${classId}&segment=${segment}&saved=1`);
});

app.get('/instructor/simulations/new',auth,async(req,res)=>{
 res.send(layout('Create Simulation', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulation Library</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">CUSTOM FAILURE SIMULATION</div><div class="big">Create New Simulation</div><p>This creates a complete starter simulation that you can customize in the Simulation Editor.</p><form method="post" action="/instructor/simulations/new"><div class="grid"><label>Simulation Title<input name="title" required placeholder="Example: PTO Will Not Engage"></label><label>Series / Course<input name="series" placeholder="Example: Product Line A"></label><label>Default Model<input name="model" placeholder="Example: Model A"></label><label>Work Order<input name="workOrder" placeholder="SIM-CUSTOM-001"></label></div><label>Customer Complaint<textarea name="complaint" rows="3" required></textarea></label><label>Student Assignment<textarea name="assignment" rows="3" required>Verify the complaint, follow the diagnostic path, prove the root cause, make only the supported repair, and verify the repair.</textarea></label><label>First Planted Root Cause<input name="diagnosis" required></label><label>Correct Repair / Verification<textarea name="repair" rows="3" required></textarea></label><button>Create Simulation & Open Editor</button></form></div>`));
});

app.post('/instructor/simulations/new',auth,async(req,res)=>{
 const clean=v=>String(v||'').trim(); const title=clean(req.body.title); if(!title) return res.status(400).send('Simulation title is required.');
 const key=`c${req.account.company_id}-sim-${Date.now().toString(36)}`; const diagnosis=clean(req.body.diagnosis)||'Instructor-defined root cause', repair=clean(req.body.repair)||'Repair the proven failure and verify operation.';
 const sim=ensureSimulationDefaults({key,series:clean(req.body.series)||'Custom',level:'Level 2',title,model:clean(req.body.model)||'Equipment 1',workOrder:clean(req.body.workOrder)||('SIM-'+Date.now().toString().slice(-6)),hours:0,complaint:clean(req.body.complaint),assignment:clean(req.body.assignment),rootCauses:[{key:'root_1',diagnosis,repair,proof:['live_data','circuit_test'],points:{live_data:15,circuit_test:35},overrides:{live_data:'Record the live-data result for the planted failure.',circuit_test:'Record the circuit measurement that proves the planted failure.'}}],actions:[{key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,stage:1,result:'Complaint verified under the stated operating conditions.'},{key:'fault_codes',category:'Fault Codes',label:'Read and Record Fault Codes',points:10,stage:2,result:'Fault-code check completed.'},{key:'live_data',category:'Live Data',label:'Compare Live Data to Physical Equipment State',points:15,stage:2,evidenceRequired:true,result:'Relevant live data reviewed.'},{key:'wiring',category:'Wiring Diagram',label:'Review the Related Wiring / Logic',points:0,stage:2,evidenceRequired:true,result:'Related circuit/logic information reviewed.'},{key:'circuit_test',category:'Multimeter',label:'Perform the Proving Circuit Test',points:0,stage:3,evidenceRequired:true,result:'Circuit test completed under the complaint condition.'},{key:'replace_part',category:'Replace Part',label:'Replace the Suspected Component',penalty:15,stage:5,result:'PARTS CANNON PENALTY: component replaced before proof.'}]});
 sim.rootCauses[0].replacementAction='replace_part';
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now())`,[key,JSON.stringify(sim)]); SIMULATION_OVERRIDE_CACHE[key]=sim;
 res.redirect(`/instructor/simulations/${encodeURIComponent(key)}/edit`);
});

app.post('/instructor/simulations/:key/duplicate',auth,async(req,res)=>{
 const source=simByKey(req.params.key); if(!source) return res.status(404).send('Simulation not found');
 const clone=JSON.parse(JSON.stringify(source)), key=`c${req.account.company_id}-sim-${Date.now().toString(36)}`; clone.key=key; clone.title=source.title+' — Copy'; clone.workOrder=(source.workOrder||'SIM')+'-COPY';
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now())`,[key,JSON.stringify(clone)]); SIMULATION_OVERRIDE_CACHE[key]=clone;
 res.redirect(`/instructor/simulations/${encodeURIComponent(key)}/edit`);
});

app.post('/instructor/simulations/:key/add-root',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found'); const next=JSON.parse(JSON.stringify(sim));
 const n=(next.rootCauses?.length||0)+1, key='root_'+n+'_'+Date.now().toString(36).slice(-4); next.rootCauses=next.rootCauses||[]; next.rootCauses.push({key,diagnosis:'New planted root cause',repair:'Repair the proven failure and verify operation.',proof:[],points:{},overrides:{}});
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=$2::jsonb,updated_at=now()`,[req.params.key,JSON.stringify(next)]); SIMULATION_OVERRIDE_CACHE[req.params.key]=next;
 res.redirect(`/instructor/simulations/${encodeURIComponent(req.params.key)}/edit`);
});

app.post('/instructor/simulations/:key/add-action',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found'); const next=JSON.parse(JSON.stringify(sim));
 const key='step_'+Date.now().toString(36); next.actions=next.actions||[]; next.actions.push({key,category:'Component Tests',label:'New Diagnostic Step',result:'Enter the result the student should receive.',points:0,penalty:0,stage:3,evidenceRequired:true});
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=$2::jsonb,updated_at=now()`,[req.params.key,JSON.stringify(next)]); SIMULATION_OVERRIDE_CACHE[req.params.key]=next;
 res.redirect(`/instructor/simulations/${encodeURIComponent(req.params.key)}/edit`);
});

app.post('/instructor/simulations/:key/delete-custom',auth,async(req,res)=>{
 if(DIAGNOSTIC_SIMULATIONS[req.params.key]) return res.status(400).send('Factory simulations cannot be deleted.');
 await pool.query('DELETE FROM simulation_assignments WHERE simulation_key=$1',[req.params.key]); await pool.query('DELETE FROM simulation_content_overrides WHERE simulation_key=$1',[req.params.key]); delete SIMULATION_OVERRIDE_CACHE[req.params.key];
 res.redirect(`/instructor/simulations`);
});

app.get('/instructor/simulations/:key/setup-sheet',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found');
 const roots=(sim.rootCauses||[]).map((r,i)=>`<div class="card"><div class="eyebrow">PLANTED ROOT CAUSE ${i+1}</div><div class="big">${esc(r.diagnosis)}</div><p><b>Correct Repair:</b> ${esc(r.repair)}</p><p><b>Proof Required:</b> ${(r.proof||[]).map(k=>esc(sim.actions.find(a=>a.key===k)?.label||k)).join(' → ')||'Instructor-defined proof'}</p></div>`).join('');
 res.send(layout('Instructor Setup Sheet', `<div class="toolbar no-print"><a class="btn light" href="/instructor/simulations">← Simulation Library</a><button onclick="window.print()">Print Setup Sheet</button></div><div class="card" style="border-top:7px solid var(--red)"><div class="eyebrow">THE TRAINING HUB · INSTRUCTOR ONLY</div><div class="big" style="font-size:30px">${esc(sim.title)}</div><p>${esc(sim.workOrder)} · ${esc(sim.series)} · ${esc(sim.model)}</p><div class="alert"><b>Complaint:</b><br>${esc(sim.complaint)}</div><p><b>Assignment:</b> ${esc(sim.assignment)}</p></div><div class="card"><div class="big">Setup</div><p><b>Instructor Setup:</b> ${esc(sim.instructorSetup)}</p><p><b>Tools Needed:</b> ${esc(sim.toolsNeeded)}</p><p><b>How to Plant Fault:</b> ${esc(sim.plantFault)}</p><p><b>Expected Readings / Evidence:</b> ${esc(sim.expectedReadings)}</p><p><b>Reset Procedure:</b> ${esc(sim.resetProcedure)}</p><p><b>Safety:</b> ${esc(sim.safetyNotes)}</p></div>${roots}<div class="card"><div class="big">Completion Standard</div><p>Default passing score: ${sim.passScore}% · Default maximum Parts Cannon penalties: ${sim.maxPartsPenalties}</p></div>`,simulationCss()));
});

app.get('/instructor/simulations/live',auth,async(req,res)=>{
 const attempts=(await pool.query(`SELECT a.*,s.name,s.dealer,c.code FROM simulation_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.status='in_progress' AND c.company_id=$1 ORDER BY a.started_at`,[req.account.company_id])).rows;
 const cards=[];
 for(const a of attempts){
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key); if(!sim) continue; const acts=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows; const hints=(await pool.query('SELECT count(*)::int n FROM simulation_hints WHERE attempt_id=$1',[a.id])).rows[0].n||0; const last=acts[acts.length-1]; const proof=proofComplete(sim,acts); const verify=acts.some(x=>x.action_key==='verify_repair'&&String(x.evidence_text||'').trim()); let stage=1; if(acts.some(x=>x.action_key==='verify_complaint'))stage=2;if(acts.some(x=>['fault_codes','live_data'].includes(x.action_key)))stage=3;if((sim.rootCause?.proof||[]).some(k=>acts.some(x=>x.action_key===k)))stage=4;if(proof)stage=5;if(verify)stage=6;
  cards.push(`<div class="card" style="border-left:6px solid ${last?.feedback_type==='wrong'?'#d6a800':'#267a3f'}"><div class="section-title"><div><div class="eyebrow">CLASS ${esc(a.code)} · ATTEMPT #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.title)}</div></div><span class="sim-badge">Stage ${stage}/6</span></div><p>${esc(a.dealer)} · ${esc(a.tractor_model||'')} · ${esc(a.difficulty||'Intermediate')}</p><div class="grid"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>PENALTY</span><b>-${a.penalty_points}</b></div><div class="stat"><span>HINTS</span><b>${hints}</b></div><div class="stat"><span>ELAPSED</span><b>${elapsedText(a.started_at)}</b></div></div><p><b>Last Step:</b> ${esc(last?.label||'Not started')}<br><span class="muted">${esc(last?.result_text||'Waiting for first diagnostic choice.')}</span></p><a class="btn light" href="/instructor/simulation/${a.id}">Open Student Path</a></div>`);
 }
 res.send(layout('Live Simulation Progress', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulation Library</a></div><div class="card" style="background:#171717;color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">LIVE INSTRUCTOR VIEW · REFRESHES EVERY 10 SECONDS</div><div class="big" style="font-size:30px">Simulation Progress</div><p>Watch the class diagnostic path, score, penalties, hints, elapsed time, and current stage.</p></div>${cards.join('')||'<div class="card"><div class="big">No Active Simulation Attempts</div><p>Students currently diagnosing will appear here automatically.</p></div>'}`,`${simulationCss()}<script>setTimeout(()=>location.reload(),10000)</script>`));
});

app.get('/instructor/simulations/:key/edit',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found');
 const rootCards=(sim.rootCauses||[]).map((r,ri)=>{
  return `<div class="card" style="border-left:5px solid var(--red)"><div class="section-title"><div><div class="big">Root Cause ${ri+1}</div><div class="eyebrow">EVERY FIELD EDITABLE</div></div><label style="width:auto;display:flex;gap:8px;align-items:center"><input type="checkbox" name="root_${ri}_delete" value="yes" style="width:auto"> Delete this root cause</label></div><div class="grid"><label>Root Cause Key<input name="root_${ri}_key" value="${esc(r.key||'')}" required></label><label>Replacement / Repair Action Key<input name="root_${ri}_replacementAction" value="${esc(r.replacementAction||'')}"></label></div><label>Diagnosis / Root Cause Description<textarea name="root_${ri}_diagnosis" rows="2">${esc(r.diagnosis||'')}</textarea></label><label>Correct Repair & Verification<textarea name="root_${ri}_repair" rows="3">${esc(r.repair||'')}</textarea></label><label>Required proof-step keys (comma separated)<input name="root_${ri}_proof" value="${esc((r.proof||[]).join(', '))}"></label><label>Per-Step Scoring JSON<textarea name="root_${ri}_points_json" rows="4">${esc(JSON.stringify(r.points||{},null,2))}</textarea></label><label>Root-Cause-Specific Test Results / Overrides JSON<textarea name="root_${ri}_overrides_json" rows="8">${esc(JSON.stringify(r.overrides||{},null,2))}</textarea></label><p class="muted">Use the diagnostic step key on the left and the points/result on the right. This lets you add, remove, or change any root-cause-specific test result without being limited to existing rows.</p></div>`;
 }).join('');
 const actionCards=(sim.actions||[]).map((a,i)=>`<div class="card" style="border-left:5px solid ${a.penalty?'#d8a900':'#777'}"><div class="section-title"><div><div class="big">Diagnostic Step ${i+1}</div><div class="eyebrow">EVERY FIELD EDITABLE</div></div><label style="width:auto;display:flex;gap:8px;align-items:center"><input type="checkbox" name="action_${i}_delete" value="yes" style="width:auto"> Delete this diagnostic step</label></div><div class="grid"><label>Step Key<input name="action_${i}_key" value="${esc(a.key||'')}" required></label><label>Category<input name="action_${i}_category" value="${esc(a.category||'')}"></label><label>Button / Step Name<input name="action_${i}_label" value="${esc(a.label||'')}"></label></div><label>Default Result<textarea name="action_${i}_result" rows="3">${esc(a.result||'')}</textarea></label><div class="grid"><label>Base Points<input type="number" min="0" max="100" name="action_${i}_points" value="${Number(a.points)||0}"></label><label>Parts Cannon Penalty<input type="number" min="0" max="100" name="action_${i}_penalty" value="${Number(a.penalty)||0}"></label><label>Guided Stage (1-6)<input type="number" min="1" max="6" name="action_${i}_stage" value="${inferActionStage(a)}"></label><label>Evidence Required<select name="action_${i}_evidenceRequired"><option value="1" ${a.evidenceRequired?'selected':''}>Yes</option><option value="0" ${!a.evidenceRequired?'selected':''}>No</option></select></label></div><label>Why? Question<input name="action_${i}_whyPrompt" value="${esc(a.whyPrompt||'')}"></label><label>Correct Why Answer<input name="action_${i}_whyCorrect" value="${esc(a.whyCorrect||'')}"></label><label>Wrong Why Answer 1<input name="action_${i}_whyWrong1" value="${esc(a.whyWrong1||'')}"></label><label>Wrong Why Answer 2<input name="action_${i}_whyWrong2" value="${esc(a.whyWrong2||'')}"></label><label>Additional Step Fields JSON<textarea name="action_${i}_extra_json" rows="5">${esc(JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>!['key','category','label','result','points','penalty','stage','evidenceRequired','whyPrompt','whyCorrect','whyWrong1','whyWrong2'].includes(k))),null,2))}</textarea></label></div>`).join('');
 res.send(layout('Edit Simulation', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulation Library</a><a class="btn light" href="/instructor/simulations/${encodeURIComponent(sim.key)}/preview">Preview</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">SIMULATION EDITOR</div><div class="big" style="font-size:30px">${esc(sim.title)}</div><p style="margin-bottom:0">Changes apply to this simulation for all future student attempts.</p></div><form method="post" action="/instructor/simulations/${encodeURIComponent(sim.key)}/edit"><input type="hidden" name="root_count" value="${sim.rootCauses.length}"><input type="hidden" name="action_count" value="${sim.actions.length}"><div class="card"><div class="big">Simulation Setup</div><div class="grid"><label>Title<input name="title" required value="${esc(sim.title||'')}"></label><label>Series<input name="series" value="${esc(sim.series||'')}"></label><label>Level<input name="level" value="${esc(sim.level||'')}"></label><label>Default Model Name<input name="model" value="${esc(sim.model||'')}"></label><label>Work Order<input name="workOrder" value="${esc(sim.workOrder||'')}"></label><label>Hour Meter<input type="number" min="0" name="hours" value="${Number(sim.hours)||0}"></label></div><label>Customer Complaint<textarea name="complaint" rows="4">${esc(sim.complaint||'')}</textarea></label><label>Student Assignment<textarea name="assignment" rows="3">${esc(sim.assignment||'')}</textarea></label><div class="grid"><label>Default Difficulty<select name="difficulty"><option ${sim.difficulty==='Basic'?'selected':''}>Basic</option><option ${sim.difficulty==='Intermediate'?'selected':''}>Intermediate</option><option ${sim.difficulty==='Advanced'?'selected':''}>Advanced</option></select></label><label>Default Passing Score<input type="number" min="0" max="100" name="passScore" value="${sim.passScore}"></label><label>Default Max Parts Cannon Penalties<input type="number" min="0" max="20" name="maxPartsPenalties" value="${sim.maxPartsPenalties}"></label></div></div><div class="card"><div class="big">Instructor Setup & Safety</div><label>Instructor Setup Notes<textarea name="instructorSetup" rows="3">${esc(sim.instructorSetup||'')}</textarea></label><label>Tools Needed<textarea name="toolsNeeded" rows="2">${esc(sim.toolsNeeded||'')}</textarea></label><label>How to Plant the Fault<textarea name="plantFault" rows="3">${esc(sim.plantFault||'')}</textarea></label><label>Expected Readings / Evidence<textarea name="expectedReadings" rows="3">${esc(sim.expectedReadings||'')}</textarea></label><label>Reset Procedure<textarea name="resetProcedure" rows="3">${esc(sim.resetProcedure||'')}</textarea></label><label>Safety Notes<textarea name="safetyNotes" rows="3">${esc(sim.safetyNotes||'')}</textarea></label></div><div class="card"><div class="big">Hint Levels</div><label>Hint 1 (small hint, -2)<textarea name="hint_0" rows="2">${esc(sim.hints?.[0]||'')}</textarea></label><label>Hint 2 (more specific, -4)<textarea name="hint_1" rows="2">${esc(sim.hints?.[1]||'')}</textarea></label><label>Hint 3 (strong direction, -6)<textarea name="hint_2" rows="2">${esc(sim.hints?.[2]||'')}</textarea></label></div><div class="card"><div class="section-title"><div><div class="big">Planted Root Causes</div><p class="muted">Edit the diagnosis, repair, proof steps, scoring, and the test results students see for each planted failure.</p></div><button type="submit" class="light" formmethod="post" formaction="/instructor/simulations/${encodeURIComponent(sim.key)}/add-root">+ Add Root Cause</button></div></div>${rootCards}<div class="card"><div class="section-title"><div><div class="big">Diagnostic Choices / Tools</div><p class="muted">These are the selections the student makes while following the diagnostic path.</p></div><button type="submit" class="light" formmethod="post" formaction="/instructor/simulations/${encodeURIComponent(sim.key)}/add-action">+ Add Diagnostic Step</button></div></div>${actionCards}<div class="card" style="border-top:6px solid #171717"><div class="big">Advanced — Full Simulation JSON</div><p class="muted">This is the complete simulation definition. You can edit any property here, including fields not shown above. If you use this box, it becomes the source of truth when you click <b>Save Full JSON</b>.</p><label>Complete Simulation JSON<textarea name="full_json" rows="24" style="font-family:monospace">${esc(JSON.stringify(sim,null,2))}</textarea></label><button type="submit" class="alt" formaction="/instructor/simulations/${encodeURIComponent(sim.key)}/edit-json">Save Full JSON</button></div><div class="card"><button style="font-size:18px;padding:14px 24px">Save Simulation Changes</button>${DIAGNOSTIC_SIMULATIONS[sim.key]?`<a class="btn light" style="margin-left:8px" href="/instructor/simulations/${encodeURIComponent(sim.key)}/reset">Reset to Factory Default</a>`:`<button type="submit" class="alt" formmethod="post" formaction="/instructor/simulations/${encodeURIComponent(sim.key)}/delete-custom" style="margin-left:8px">Delete Custom Simulation</button>`}</div></form>`,simulationCss()));
});

app.post('/instructor/simulations/:key/edit',auth,async(req,res)=>{
 const base=simByKey(req.params.key); if(!base) return res.status(404).send('Simulation not found');
 const clean=v=>(v??'').toString().trim();
 const next=JSON.parse(JSON.stringify(base));
 next.title=clean(req.body.title)||base.title; next.series=clean(req.body.series); next.level=clean(req.body.level); next.model=clean(req.body.model); next.workOrder=clean(req.body.workOrder); next.hours=Math.max(0,Number(req.body.hours)||0); next.complaint=clean(req.body.complaint); next.assignment=clean(req.body.assignment);
 next.difficulty=['Basic','Intermediate','Advanced'].includes(req.body.difficulty)?req.body.difficulty:'Intermediate'; next.passScore=Math.min(100,Math.max(0,Number(req.body.passScore)||80)); next.maxPartsPenalties=Math.min(20,Math.max(0,Number(req.body.maxPartsPenalties)||0));
 next.instructorSetup=clean(req.body.instructorSetup); next.toolsNeeded=clean(req.body.toolsNeeded); next.plantFault=clean(req.body.plantFault); next.expectedReadings=clean(req.body.expectedReadings); next.resetProcedure=clean(req.body.resetProcedure); next.safetyNotes=clean(req.body.safetyNotes); next.hints=[clean(req.body.hint_0),clean(req.body.hint_1),clean(req.body.hint_2)].filter(Boolean);
 const rootCount=Math.min(50,Math.max(0,Number(req.body.root_count)||0));
 const roots=[];
 for(let ri=0;ri<rootCount && ri<(next.rootCauses||[]).length;ri++){
  if(req.body[`root_${ri}_delete`]==='yes') continue;
  const old=next.rootCauses[ri]||{}; let points={},overrides={};
  try{points=JSON.parse(req.body[`root_${ri}_points_json`]||'{}')}catch{return res.status(400).send(`Root Cause ${ri+1}: Per-Step Scoring JSON is invalid.`)}
  try{overrides=JSON.parse(req.body[`root_${ri}_overrides_json`]||'{}')}catch{return res.status(400).send(`Root Cause ${ri+1}: Test Results / Overrides JSON is invalid.`)}
  roots.push({...old,key:clean(req.body[`root_${ri}_key`])||old.key||`root_${ri+1}`,diagnosis:clean(req.body[`root_${ri}_diagnosis`]),repair:clean(req.body[`root_${ri}_repair`]),proof:clean(req.body[`root_${ri}_proof`]).split(',').map(x=>x.trim()).filter(Boolean),replacementAction:clean(req.body[`root_${ri}_replacementAction`]),points,overrides});
 }
 next.rootCauses=roots;
 const actionCount=Math.min(100,Math.max(0,Number(req.body.action_count)||0));
 const actions=[];
 for(let i=0;i<actionCount && i<(next.actions||[]).length;i++){
  if(req.body[`action_${i}_delete`]==='yes') continue;
  const old=next.actions[i]||{}; let extra={};
  try{extra=JSON.parse(req.body[`action_${i}_extra_json`]||'{}')}catch{return res.status(400).send(`Diagnostic Step ${i+1}: Additional Fields JSON is invalid.`)}
  actions.push({...old,...extra,key:clean(req.body[`action_${i}_key`])||old.key||`step_${i+1}`,category:clean(req.body[`action_${i}_category`]),label:clean(req.body[`action_${i}_label`]),result:clean(req.body[`action_${i}_result`]),points:Math.max(0,Number(req.body[`action_${i}_points`])||0),penalty:Math.max(0,Number(req.body[`action_${i}_penalty`])||0),stage:Math.min(6,Math.max(1,Number(req.body[`action_${i}_stage`])||inferActionStage(old))),evidenceRequired:req.body[`action_${i}_evidenceRequired`]==='1',whyPrompt:clean(req.body[`action_${i}_whyPrompt`]),whyCorrect:clean(req.body[`action_${i}_whyCorrect`]),whyWrong1:clean(req.body[`action_${i}_whyWrong1`]),whyWrong2:clean(req.body[`action_${i}_whyWrong2`])});
 }
 next.actions=actions;
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=$2::jsonb,updated_at=now()`,[req.params.key,JSON.stringify(next)]);
 SIMULATION_OVERRIDE_CACHE[req.params.key]=next;
 res.redirect(`/instructor/simulations/${encodeURIComponent(req.params.key)}/edit?saved=1`);
});

app.post('/instructor/simulations/:key/edit-json',auth,async(req,res)=>{
 const current=simByKey(req.params.key); if(!current) return res.status(404).send('Simulation not found');
 let next;
 try{ next=JSON.parse(String(req.body.full_json||'')); }catch(e){ return res.status(400).send('Full Simulation JSON is invalid. Correct the JSON and try again.'); }
 if(!next||typeof next!=='object'||Array.isArray(next)) return res.status(400).send('Full Simulation JSON must be one JSON object.');
 next.key=req.params.key;
 if(!Array.isArray(next.rootCauses)) return res.status(400).send('Full Simulation JSON must include a rootCauses array.');
 if(!Array.isArray(next.actions)) return res.status(400).send('Full Simulation JSON must include an actions array.');
 await pool.query(`INSERT INTO simulation_content_overrides(simulation_key,content_json,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(simulation_key) DO UPDATE SET content_json=$2::jsonb,updated_at=now()`,[req.params.key,JSON.stringify(next)]);
 SIMULATION_OVERRIDE_CACHE[req.params.key]=next;
 res.redirect(`/instructor/simulations/${encodeURIComponent(req.params.key)}/edit?saved=1`);
});

app.get('/instructor/simulations/:key/reset',auth,async(req,res)=>{
 if(!DIAGNOSTIC_SIMULATIONS[req.params.key]) return res.status(404).send('Simulation not found');
 await pool.query('DELETE FROM simulation_content_overrides WHERE simulation_key=$1',[req.params.key]);
 delete SIMULATION_OVERRIDE_CACHE[req.params.key];
 res.redirect(`/instructor/simulations/${encodeURIComponent(req.params.key)}/edit`);
});

app.post('/instructor/simulations/:key/class/:classId/deactivate',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found');
 const classId=Number(req.params.classId); if(!classId) return res.status(400).send('Invalid class.');
 const q=await pool.query(`UPDATE simulation_assignments SET enabled=false WHERE class_id=$1 AND simulation_key=$2 RETURNING id`,[classId,sim.key]);
 if(!q.rowCount) return res.status(404).send('Simulation release not found for this class.');
 res.redirect(`/instructor/simulations`);
});

app.post('/instructor/simulations/:key/class/:classId/activate',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found');
 const classId=Number(req.params.classId); if(!classId) return res.status(400).send('Invalid class.');
 const q=await pool.query(`UPDATE simulation_assignments SET enabled=true,configured_at=now() WHERE class_id=$1 AND simulation_key=$2 RETURNING id`,[classId,sim.key]);
 if(!q.rowCount) return res.status(404).send('Simulation release not found for this class.');
 res.redirect(`/instructor/simulations`);
});

app.post('/instructor/simulations/:key/configure',auth,async(req,res)=>{
 const sim=simByKey(req.params.key); if(!sim) return res.status(404).send('Simulation not found');
 const classId=Number(req.body.class_id), rootKey=(req.body.root_cause_key||'').trim(), tractorModel=(req.body.tractor_model||'').trim(); if(!classId||!rootCauseByKey(sim,rootKey)||!validTractorForSim(sim,tractorModel)) return res.status(400).send('Choose a valid class, equipment/model, and root cause.');
 const difficulty=['Basic','Intermediate','Advanced'].includes(req.body.difficulty)?req.body.difficulty:'Intermediate';
 const passScore=Math.min(100,Math.max(0,Number(req.body.pass_score)||80));
 const maxParts=Math.min(20,Math.max(0,Number(req.body.max_parts_penalties)||0));
 const prereq=['none','general','fmcu','auto4wd'].includes(req.body.prerequisite_hunt_type)?req.body.prerequisite_hunt_type:'none';
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[classId])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const activeAttempts=Number((await pool.query(`SELECT count(*)::int n FROM simulation_attempts WHERE class_id=$1 AND simulation_key=$2 AND status='in_progress'`,[classId,sim.key])).rows[0].n);
 if(activeAttempts) return res.send(layout('Root Cause Locked', `<div class="card"><div class="big">Cannot Change Root Cause Yet</div><div class="alert">${activeAttempts} student simulation attempt(s) are currently in progress for this class. Finish those attempts before changing the planted failure.</div><a class="btn" href="/instructor/simulations">Back to Simulations</a></div>`));
 await pool.query(`INSERT INTO simulation_assignments(class_id,simulation_key,root_cause_key,tractor_model,technician_limit,difficulty,pass_score,max_parts_penalties,prerequisite_hunt_type,enabled,configured_at) VALUES($1,$2,$3,$4,15,$5,$6,$7,$8,true,now()) ON CONFLICT(class_id,simulation_key) DO UPDATE SET root_cause_key=$3,tractor_model=$4,technician_limit=15,difficulty=$5,pass_score=$6,max_parts_penalties=$7,prerequisite_hunt_type=$8,enabled=true,configured_at=now()`,[classId,sim.key,rootKey,tractorModel,difficulty,passScore,maxParts,prereq]);
 res.redirect(`/instructor/simulations`);
});

app.get('/instructor/simulations/:key/preview',auth,async(req,res)=>{
 const sim=simByKey(req.params.key);
 if(!sim) return res.status(404).send('Simulation not found');
 const grouped={}; for(const a of sim.actions){(grouped[a.category]||(grouped[a.category]=[])).push(a)}
 const tools=Object.entries(grouped).map(([cat,items])=>`<div class="card"><div class="big">${esc(cat)}</div>${items.map(a=>`<div class="sim-log ${a.penalty?'penalty':a.points?'good':''}"><b>${esc(a.label)}</b>${a.points?` <span class="sim-badge">+${a.points}</span>`:''}${a.penalty?` <span class="sim-badge">-${a.penalty}</span>`:''}<div style="margin-top:6px">${esc(a.result)}</div></div>`).join('')}</div>`).join('');
 res.send(layout('Instructor Simulation Preview', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulation Library</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">INSTRUCTOR PREVIEW · NOT A STUDENT ATTEMPT</div><div class="big" style="font-size:28px">${esc(sim.title)}</div><p><b>Equipment:</b> Selected by instructor when released<br>${esc(sim.workOrder)} · ${esc(sim.hours)} hours</p><div class="alert"><b>Customer Complaint:</b> ${esc(sim.complaint)}</div><p><b>Assignment:</b> ${esc(sim.assignment)}</p><div class="alert"><b>Instructor Root-Cause Choices:</b>${sim.rootCauses.map(r=>`<div style="margin-top:8px"><b>${esc(r.diagnosis)}</b><br><span class="muted">${esc(r.repair)}</span></div>`).join('')}</div></div><div class="card"><div class="big">Scoring</div><table><tr><th>Area</th><th>Points</th></tr><tr><td>Verify customer complaint</td><td>10</td></tr><tr><td>Check fault codes</td><td>10</td></tr><tr><td>Review live data</td><td>15</td></tr><tr><td>Correct circuit testing</td><td>20</td></tr><tr><td>Proper multimeter testing</td><td>15</td></tr><tr><td>Correct root cause</td><td>20</td></tr><tr><td>Correct repair / verification</td><td>10</td></tr><tr><th>Total</th><th>100</th></tr></table><div class="parts-penalty" style="margin-top:12px">Unproven component replacement: -15 points each</div></div>${tools}`,simulationCss()));
});
app.get('/instructor/simulation/:attemptId',auth,async(req,res)=>{
 const q=await pool.query(`SELECT a.*,s.name,s.dealer,s.id student_id,c.course,c.code FROM simulation_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1`,[req.params.attemptId]); const a=q.rows[0]; if(!a) return res.status(404).send('Simulation attempt not found');
 const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows, hints=(await pool.query('SELECT * FROM simulation_hints WHERE attempt_id=$1 ORDER BY level',[a.id])).rows;
 const rows=actions.map((x,i)=>`<div class="sim-log ${x.feedback_type==='wrong'||x.penalty?'penalty':x.feedback_type==='good'||x.points?'good':''}"><b>${i+1}. ${esc(x.category)} — ${esc(x.label)}</b>${x.points?` · +${x.points}`:''}${x.penalty?` · -${x.penalty}`:''}<div>${esc(x.result_text)}</div>${x.evidence_text?`<div class="small"><b>Evidence:</b> ${esc(x.evidence_text)}</div>`:''}${x.why_answer?`<div class="small"><b>Reasoning:</b> ${esc(x.why_answer)} ${x.why_correct?'✓':'— review'}</div>`:''}<div class="small muted">Step time: ${Number(x.step_seconds||0)} sec</div></div>`).join('');
 const parts=partsPenaltyCount(actions), proof=proofComplete(sim,actions), verify=actions.some(x=>x.action_key==='verify_repair'&&String(x.evidence_text||'').trim());
 res.send(layout('Simulation Attempt', `<div class="toolbar"><a class="btn light" href="/instructor/simulations">← Simulations</a><a class="btn light" href="/instructor/simulations/live">Live Progress</a><a class="btn light" href="/instructor/student/${a.student_id}">Student Record</a></div><div class="card"><div class="eyebrow">Permanent Simulation Attempt #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.title||sim.title)}</div><p>${esc(a.dealer)} · ${esc(a.tractor_model||sim.model)} · Class ${esc(a.code)} · ${esc(a.difficulty||'Intermediate')}</p><div class="grid"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>PARTS CANNON</span><b>${parts}/${a.max_parts_penalties??1}</b></div><div class="stat"><span>PROOF</span><b>${proof?'YES':'NO'}</b></div><div class="stat"><span>VERIFY</span><b>${verify?'YES':'NO'}</b></div></div></div><div class="card"><div class="big">Final Decision</div><p><b>Status:</b> ${esc(a.status)} ${a.status==='completed'?(a.passed?'<span class="pill open">PASS</span>':'<span class="pill">REVIEW REQUIRED</span>'):''}</p><p><b>Diagnosis:</b> ${esc(a.final_diagnosis||'Not submitted')} ${a.diagnosis_correct?'✓':''}</p><p><b>Correct Diagnosis:</b> ${esc(a.assigned_diagnosis||sim.correctDiagnosis)}</p><p><b>Repair:</b> ${esc(a.final_repair||'Not submitted')}</p><p><b>Correct Repair:</b> ${esc(a.assigned_repair||sim.correctRepair)}</p></div><div class="card"><div class="big">Diagnostic Path, Evidence & Step Timing</div>${rows||'<p>No actions recorded.</p>'}</div>${hints.length?`<div class="card"><div class="big">Hints Used</div>${hints.map(h=>`<p><b>Hint ${h.level} (-${h.penalty}):</b> ${esc(h.hint_text)}</p>`).join('')}</div>`:''}`,simulationCss()));
});

app.get('/instructor/build-select',auth,async(req,res)=>{
 const q=await pool.query('SELECT id,course,title,code,active FROM classes WHERE company_id=$1 ORDER BY created_at DESC LIMIT 40',[req.account.company_id]);
 const acs=await allowedCourseSet(req.account); const visibleRows=acs?q.rows.filter(c=>acs.has(c.course)):q.rows; const rows=visibleRows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td><a class="btn" href="/instructor/builder/${c.id}">Build Training</a></td></tr>`).join('');
 res.send(layout('Build Test', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="big">Build Pre/Post Test</div><p class="muted">Choose the class whose matched Pre-Test / Post-Test question bank you want to edit.</p><div style="overflow:auto"><table><tr><th>Course</th><th>Code</th><th>Status</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet. Start a class first.</td></tr>'}</table></div></div>`));
});



// ========================= MASTER DIAGNOSTIC CHALLENGE =========================
app.get('/instructor/master-challenges',auth,async(req,res)=>{
 let classes=(await pool.query(`SELECT c.*,count(s.id)::int student_count FROM classes c LEFT JOIN students s ON s.class_id=c.id WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,[req.account.company_id])).rows; const acs=await allowedCourseSet(req.account); if(acs) classes=classes.filter(c=>acs.has(c.course));
 const relAll=(await pool.query(`SELECT r.*,c.code,c.course FROM master_challenge_releases r JOIN classes c ON c.id=r.class_id WHERE c.company_id=$1 ORDER BY r.released_at DESC`,[req.account.company_id])).rows;
 const rel=acs?relAll.filter(r=>acs.has(r.course)):relAll;
 const attemptsAll=(await pool.query(`SELECT a.*,s.name,s.dealer,c.code,c.course FROM master_challenge_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE c.company_id=$1 ORDER BY a.started_at DESC LIMIT 100`,[req.account.company_id])).rows;
 const attempts=acs?attemptsAll.filter(a=>acs.has(a.course)):attemptsAll;
 const cards=allMasterChallenges().filter(ch=>ch.key===DEFAULT_MASTER_CHALLENGE.key||ch.key.startsWith(`c${req.account.company_id}-`)).map(ch=>{ const releases=rel.filter(r=>r.challenge_key===ch.key); const a=releases[0]; return `<div class="card" style="border-top:6px solid #171717"><div class="section-title"><div><div class="eyebrow">MASTER DIAGNOSTIC CHALLENGE</div><div class="big">${esc(ch.title)}</div></div><span class="pill">${esc(ch.level||'Master')}</span></div><p><b>Default Model:</b> ${esc(ch.model||'')} · <b>Pass:</b> ${Number(ch.passScore)||85}% · <b>Target:</b> ${Number(ch.targetMinutes)||45} min</p><div class="alert"><b>Complaint:</b><br>${esc(ch.complaint||'')}</div><form method="post" action="/instructor/master-challenges/${encodeURIComponent(ch.key)}/release"><label>Class<select name="class_id" required><option value="">Choose class</option>${classes.map(c=>`<option value="${c.id}">${esc(c.code)} · ${esc(c.course)} · ${c.student_count} tech(s)</option>`).join('')}</select></label><label>Equipment / Model<input name="tractor_model" value="${esc(ch.model||'')}"></label><label>Hidden Root Cause<select name="root_cause_key" required><option value="">Choose planted failure</option>${(ch.rootCauses||[]).map(r=>`<option value="${esc(r.key)}">${esc(r.diagnosis)}</option>`).join('')}</select></label><div class="grid"><label>Pass Score<input type="number" name="pass_score" min="0" max="100" value="${Number(ch.passScore)||85}"></label><label>Max Parts Cannon<input type="number" name="max_parts_penalties" min="0" max="20" value="${Number(ch.maxPartsPenalties)||1}"></label><label>Target Minutes<input type="number" name="target_minutes" min="1" max="240" value="${Number(ch.targetMinutes)||45}"></label></div><button>Release / Update Challenge</button></form><div class="toolbar" style="margin-top:12px">${ch.key===DEFAULT_MASTER_CHALLENGE.key?`<form method="post" action="/instructor/master-challenges/${encodeURIComponent(ch.key)}/duplicate" style="display:inline"><button class="alt">Duplicate to Edit</button></form>`:`<a class="btn alt" href="/instructor/master-challenges/${encodeURIComponent(ch.key)}/edit">Edit Everything</a>`}<a class="btn light" href="/instructor/master-challenges/${encodeURIComponent(ch.key)}/preview">Preview</a>${ch.key===DEFAULT_MASTER_CHALLENGE.key?'':`<form method="post" action="/instructor/master-challenges/${encodeURIComponent(ch.key)}/duplicate" style="display:inline"><button class="light">Duplicate</button></form>`}</div></div>`; }).join('');
 const relRows=rel.map(r=>{ const ch=masterChallengeByKey(r.challenge_key); return `<tr><td><b>${esc(ch?.title||r.challenge_key)}</b></td><td>${esc(r.code)}<br><span class="small muted">${esc(r.tractor_model||'')}</span></td><td><span class="pill ${r.enabled?'open':'closed'}">${r.enabled?'ACTIVE':'INACTIVE'}</span></td><td><form method="post" action="/instructor/master-challenges/${encodeURIComponent(r.challenge_key)}/class/${r.class_id}/${r.enabled?'deactivate':'activate'}"><button class="${r.enabled?'danger':''}">${r.enabled?'Deactivate':'Reactivate'}</button></form></td></tr>`; }).join('');
 const attRows=attempts.map(a=>`<tr><td>${esc(a.name)}<br><span class="small muted">${esc(a.dealer)}</span></td><td>${esc(masterChallengeByKey(a.challenge_key)?.title||a.challenge_key)}</td><td>${esc(a.code)}</td><td>${a.status==='completed'?`${a.score}% ${a.passed?'<span class="pill open">PASS</span>':'<span class="pill">REVIEW</span>'}`:'IN PROGRESS'}</td><td><a class="btn light" href="/instructor/master-challenges/attempt/${a.id}">Open</a></td></tr>`).join('');
 res.send(layout('Master Diagnostic Challenge', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Command Center</a><a class="btn" href="/instructor/master-challenges/new">+ New Master Challenge</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">FINAL PRACTICAL CERTIFICATION</div><div class="big" style="font-size:32px">Master Diagnostic Challenge</div><p style="margin-bottom:0">No guided path. The student chooses the tests, documents evidence, proves the failure, repairs it, and verifies the repair.</p></div>${cards}<div class="card"><div class="big">Challenge Releases</div><p class="muted">Deactivate a release without deleting the challenge or prior attempts.</p><div style="overflow:auto"><table><tr><th>Challenge</th><th>Class</th><th>Status</th><th>Action</th></tr>${relRows||'<tr><td colspan="4">No challenges released yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Student Attempts</div><div style="overflow:auto"><table><tr><th>${esc(brand('student_label','Student'))}</th><th>Challenge</th><th>Class</th><th>Result</th><th></th></tr>${attRows||'<tr><td colspan="5">No attempts yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/master-challenges/new',auth,async(req,res)=>{ res.send(layout('New Master Challenge',`<div class="toolbar"><a class="btn light" href="/instructor/master-challenges">← Master Challenges</a></div><div class="card"><div class="big">Create New Master Challenge</div><form method="post" action="/instructor/master-challenges/new"><label>Title<input name="title" required></label><div class="grid"><label>Series / Course<input name="series"></label><label>Model<input name="model"></label><label>Work Order<input name="workOrder"></label></div><label>Customer Complaint<textarea name="complaint" required></textarea></label><label>Student Assignment<textarea name="assignment" required>Diagnose without a guided path. Document evidence, prove the root cause, select the supported repair, and verify the repair.</textarea></label><label>First Hidden Root Cause<input name="diagnosis" required></label><label>Correct Repair<textarea name="repair" required></textarea></label><button>Create & Open Editor</button></form></div>`)); });
app.post('/instructor/master-challenges/new',auth,async(req,res)=>{ const clean=v=>String(v||'').trim(); const key=`c${req.account.company_id}-master-${Date.now().toString(36)}`; const base=JSON.parse(JSON.stringify(DEFAULT_MASTER_CHALLENGE)); base.key=key;base.title=clean(req.body.title)||'Custom Master Challenge';base.series=clean(req.body.series)||'Custom';base.model=clean(req.body.model)||'Instructor Selected';base.workOrder=clean(req.body.workOrder)||('MASTER-'+Date.now().toString().slice(-6));base.complaint=clean(req.body.complaint);base.assignment=clean(req.body.assignment);base.rootCauses=[{key:'root_1',diagnosis:clean(req.body.diagnosis),repair:clean(req.body.repair),proof:['verify_complaint'],overrides:{}}]; await pool.query(`INSERT INTO master_challenge_content(challenge_key,content_json,updated_at) VALUES($1,$2::jsonb,now())`,[key,JSON.stringify(base)]);MASTER_CHALLENGE_CACHE[key]=base;res.redirect(`/instructor/master-challenges/${encodeURIComponent(key)}/edit`); });

app.get('/instructor/master-challenges/:key/edit',auth,async(req,res)=>{ const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Challenge not found'); const roots=(ch.rootCauses||[]).map((r,i)=>`<div class="card"><div class="section-title"><div class="big">Hidden Root Cause ${i+1}</div></div><input type="hidden" name="root_key_${i}" value="${esc(r.key)}"><label>Diagnosis<input name="root_diag_${i}" value="${esc(r.diagnosis||'')}"></label><label>Correct Repair<textarea name="root_repair_${i}">${esc(r.repair||'')}</textarea></label><label>Proof Action Keys — comma separated<input name="root_proof_${i}" value="${esc((r.proof||[]).join(','))}"></label><label>Root-Cause Test Results / Overrides JSON<textarea name="root_overrides_${i}" rows="5">${esc(JSON.stringify(r.overrides||{},null,2))}</textarea></label><label style="color:#a00000"><input type="checkbox" name="root_delete_${i}" value="yes" style="width:auto"> Delete this root cause when saved</label></div>`).join(''); const actions=(ch.actions||[]).map((a,i)=>`<div class="card"><div class="big">Diagnostic Choice ${i+1}</div><input type="hidden" name="action_key_${i}" value="${esc(a.key)}"><div class="grid"><label>Category<input name="action_cat_${i}" value="${esc(a.category||'')}"></label><label>Label<input name="action_label_${i}" value="${esc(a.label||'')}"></label><label>Points<input type="number" name="action_points_${i}" value="${Number(a.points)||0}"></label><label>Penalty<input type="number" name="action_penalty_${i}" value="${Number(a.penalty)||0}"></label></div><label>Default Result<textarea name="action_result_${i}" rows="2">${esc(a.result||'')}</textarea></label><label style="color:#a00000"><input type="checkbox" name="action_delete_${i}" value="yes" style="width:auto"> Delete this diagnostic choice when saved</label></div>`).join(''); res.send(layout('Edit Master Challenge',`<div class="toolbar"><a class="btn light" href="/instructor/master-challenges">← Master Challenges</a></div><div class="card" style="background:#171717;color:#fff"><div class="eyebrow" style="color:#ddd">FULLY EDITABLE MASTER CHALLENGE</div><div class="big">${esc(ch.title)}</div></div><form method="post" action="/instructor/master-challenges/${encodeURIComponent(ch.key)}/edit"><input type="hidden" name="root_count" value="${(ch.rootCauses||[]).length}"><input type="hidden" name="action_count" value="${(ch.actions||[]).length}"><div class="card"><div class="big">Challenge Setup</div><div class="grid"><label>Title<input name="title" value="${esc(ch.title||'')}"></label><label>Series / Course<input name="series" value="${esc(ch.series||'')}"></label><label>Level<input name="level" value="${esc(ch.level||'')}"></label><label>Model<input name="model" value="${esc(ch.model||'')}"></label><label>Work Order<input name="workOrder" value="${esc(ch.workOrder||'')}"></label><label>Hour Meter<input type="number" name="hours" value="${Number(ch.hours)||0}"></label></div><label>Customer Complaint<textarea name="complaint" rows="4">${esc(ch.complaint||'')}</textarea></label><label>Student Assignment<textarea name="assignment" rows="4">${esc(ch.assignment||'')}</textarea></label></div><div class="card"><div class="big">Scoring & Standards</div><div class="grid"><label>Default Pass Score<input type="number" min="0" max="100" name="passScore" value="${Number(ch.passScore)||85}"></label><label>Target Minutes<input type="number" min="1" name="targetMinutes" value="${Number(ch.targetMinutes)||45}"></label><label>Max Parts Cannon<input type="number" min="0" name="maxPartsPenalties" value="${Number(ch.maxPartsPenalties)||1}"></label><label>Default Parts Penalty<input type="number" min="0" name="partsPenalty" value="${Number(ch.partsPenalty)||15}"></label><label>Time Penalty / Minute<input type="number" min="0" name="timePenaltyPerMinute" value="${Number(ch.timePenaltyPerMinute)||1}"></label><label>Diagnosis Points<input type="number" min="0" name="score_diagnosis" value="${Number(ch.scoring?.diagnosis)||25}"></label><label>Repair Points<input type="number" min="0" name="score_repair" value="${Number(ch.scoring?.repair)||15}"></label><label>Verification Points<input type="number" min="0" name="score_verification" value="${Number(ch.scoring?.verification)||10}"></label><label>Evidence Points<input type="number" min="0" name="score_evidence" value="${Number(ch.scoring?.evidence)||10}"></label></div></div><div class="card"><div class="big">Instructor Setup & Safety</div><label>Instructor Setup Notes<textarea name="instructorSetup">${esc(ch.instructorSetup||'')}</textarea></label><label>How to Plant the Fault<textarea name="plantFault">${esc(ch.plantFault||'')}</textarea></label><label>Expected Readings / Evidence<textarea name="expectedReadings">${esc(ch.expectedReadings||'')}</textarea></label><label>Reset Procedure<textarea name="resetProcedure">${esc(ch.resetProcedure||'')}</textarea></label><label>Safety Notes<textarea name="safetyNotes">${esc(ch.safetyNotes||'')}</textarea></label></div><div class="card"><div class="big">Hints</div>${[0,1,2].map(i=>`<div class="grid"><label>Hint ${i+1}<textarea name="hint_text_${i}">${esc(ch.hints?.[i]?.text||'')}</textarea></label><label>Penalty<input type="number" min="0" name="hint_penalty_${i}" value="${Number(ch.hints?.[i]?.penalty)||0}"></label></div>`).join('')}</div><div class="card"><div class="section-title"><div class="big">Hidden Root Causes</div><button class="light" formaction="/instructor/master-challenges/${encodeURIComponent(ch.key)}/add-root" formmethod="post">+ Add Root Cause</button></div></div>${roots}<div class="card"><div class="section-title"><div class="big">Diagnostic Choices / Tools</div><button class="light" formaction="/instructor/master-challenges/${encodeURIComponent(ch.key)}/add-action" formmethod="post">+ Add Diagnostic Choice</button></div><p class="muted">All choices are presented together to the student. There is no guided stage order.</p></div>${actions}<div class="card"><button style="font-size:18px">Save All Challenge Changes</button></div></form>`)); });

app.post('/instructor/master-challenges/:key/edit',auth,async(req,res)=>{ const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Challenge not found'); const n=Number(req.body.root_count)||0,m=Number(req.body.action_count)||0; const roots=[];for(let i=0;i<n;i++){if(req.body[`root_delete_${i}`]==='yes')continue;let overrides={};try{overrides=JSON.parse(req.body[`root_overrides_${i}`]||'{}')}catch{}roots.push({key:req.body[`root_key_${i}`]||`root_${i+1}`,diagnosis:req.body[`root_diag_${i}`]||'',repair:req.body[`root_repair_${i}`]||'',proof:String(req.body[`root_proof_${i}`]||'').split(',').map(x=>x.trim()).filter(Boolean),overrides});} const actions=[];for(let i=0;i<m;i++){if(req.body[`action_delete_${i}`]==='yes')continue;actions.push({key:req.body[`action_key_${i}`]||`action_${i+1}`,category:req.body[`action_cat_${i}`]||'Diagnostic',label:req.body[`action_label_${i}`]||'',points:Number(req.body[`action_points_${i}`])||0,penalty:Number(req.body[`action_penalty_${i}`])||0,result:req.body[`action_result_${i}`]||''});} const next={...ch,title:req.body.title||ch.title,series:req.body.series||'',level:req.body.level||'Master Student',model:req.body.model||'',workOrder:req.body.workOrder||'',hours:Number(req.body.hours)||0,complaint:req.body.complaint||'',assignment:req.body.assignment||'',passScore:Number(req.body.passScore)||85,targetMinutes:Number(req.body.targetMinutes)||45,maxPartsPenalties:Number(req.body.maxPartsPenalties)||0,partsPenalty:Number(req.body.partsPenalty)||15,timePenaltyPerMinute:Number(req.body.timePenaltyPerMinute)||0,scoring:{diagnosis:Number(req.body.score_diagnosis)||0,repair:Number(req.body.score_repair)||0,verification:Number(req.body.score_verification)||0,evidence:Number(req.body.score_evidence)||0},instructorSetup:req.body.instructorSetup||'',plantFault:req.body.plantFault||'',expectedReadings:req.body.expectedReadings||'',resetProcedure:req.body.resetProcedure||'',safetyNotes:req.body.safetyNotes||'',hints:[0,1,2].map(i=>({text:req.body[`hint_text_${i}`]||'',penalty:Number(req.body[`hint_penalty_${i}`])||0})),rootCauses:roots,actions}; await pool.query(`UPDATE master_challenge_content SET content_json=$2::jsonb,updated_at=now() WHERE challenge_key=$1`,[ch.key,JSON.stringify(next)]);MASTER_CHALLENGE_CACHE[ch.key]=next;res.redirect(`/instructor/master-challenges/${encodeURIComponent(ch.key)}/edit&saved=1`); });
app.post('/instructor/master-challenges/:key/add-root',auth,async(req,res)=>{const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Not found');const next=JSON.parse(JSON.stringify(ch));next.rootCauses=next.rootCauses||[];next.rootCauses.push({key:'root_'+Date.now().toString(36),diagnosis:'New hidden root cause',repair:'Edit the correct repair and verification.',proof:[],overrides:{}});await pool.query(`UPDATE master_challenge_content SET content_json=$2::jsonb,updated_at=now() WHERE challenge_key=$1`,[ch.key,JSON.stringify(next)]);MASTER_CHALLENGE_CACHE[ch.key]=next;res.redirect(`/instructor/master-challenges/${encodeURIComponent(ch.key)}/edit`);});
app.post('/instructor/master-challenges/:key/add-action',auth,async(req,res)=>{const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Not found');const next=JSON.parse(JSON.stringify(ch));next.actions=next.actions||[];next.actions.push({key:'action_'+Date.now().toString(36),category:'Diagnostic',label:'New Diagnostic Choice',points:0,penalty:0,result:'Edit the result shown to the student.'});await pool.query(`UPDATE master_challenge_content SET content_json=$2::jsonb,updated_at=now() WHERE challenge_key=$1`,[ch.key,JSON.stringify(next)]);MASTER_CHALLENGE_CACHE[ch.key]=next;res.redirect(`/instructor/master-challenges/${encodeURIComponent(ch.key)}/edit`);});
app.post('/instructor/master-challenges/:key/duplicate',auth,async(req,res)=>{const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Not found');const next=JSON.parse(JSON.stringify(ch));next.key=`c${req.account.company_id}-master-${Date.now().toString(36)}`;next.title=ch.title+' — Copy';await pool.query(`INSERT INTO master_challenge_content(challenge_key,content_json,updated_at) VALUES($1,$2::jsonb,now())`,[next.key,JSON.stringify(next)]);MASTER_CHALLENGE_CACHE[next.key]=next;res.redirect(`/instructor/master-challenges/${encodeURIComponent(next.key)}/edit`);});
app.post('/instructor/master-challenges/:key/release',auth,async(req,res)=>{const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Not found');const classId=Number(req.body.class_id),root=req.body.root_cause_key;if(!classId||!(ch.rootCauses||[]).some(r=>r.key===root))return res.status(400).send('Choose a class and valid hidden root cause.');await pool.query(`INSERT INTO master_challenge_releases(class_id,challenge_key,root_cause_key,tractor_model,enabled,pass_score,max_parts_penalties,target_minutes,released_at) VALUES($1,$2,$3,$4,true,$5,$6,$7,now()) ON CONFLICT(class_id,challenge_key) DO UPDATE SET root_cause_key=$3,tractor_model=$4,enabled=true,pass_score=$5,max_parts_penalties=$6,target_minutes=$7,released_at=now()`,[classId,ch.key,root,req.body.tractor_model||ch.model,Number(req.body.pass_score)||ch.passScore||85,Number(req.body.max_parts_penalties)||0,Number(req.body.target_minutes)||ch.targetMinutes||45]);res.redirect(`/instructor/master-challenges`);});
app.post('/instructor/master-challenges/:key/class/:classId/deactivate',auth,async(req,res)=>{await pool.query(`UPDATE master_challenge_releases SET enabled=false WHERE class_id=$1 AND challenge_key=$2`,[req.params.classId,req.params.key]);res.redirect(`/instructor/master-challenges`);});
app.post('/instructor/master-challenges/:key/class/:classId/activate',auth,async(req,res)=>{await pool.query(`UPDATE master_challenge_releases SET enabled=true WHERE class_id=$1 AND challenge_key=$2`,[req.params.classId,req.params.key]);res.redirect(`/instructor/master-challenges`);});
app.get('/instructor/master-challenges/:key/preview',auth,async(req,res)=>{const ch=masterChallengeByKey(req.params.key);if(!ch)return res.status(404).send('Not found');res.send(layout('Master Challenge Preview',`<div class="toolbar"><a class="btn light" href="/instructor/master-challenges">← Master Challenges</a></div><div class="card"><div class="eyebrow">STUDENT VIEW PREVIEW</div><div class="big">${esc(ch.title)}</div><div class="alert"><b>Complaint:</b> ${esc(ch.complaint)}</div><p><b>Assignment:</b> ${esc(ch.assignment)}</p><div class="grid"><div class="stat"><span>PASS</span><b>${ch.passScore}%</b></div><div class="stat"><span>TARGET</span><b>${ch.targetMinutes} min</b></div></div></div><div class="card"><div class="big">Unstructured Diagnostic Choices</div>${(ch.actions||[]).map(a=>`<div class="q"><b>${esc(a.label)}</b><br><span class="muted">${esc(a.category)}</span></div>`).join('')}</div>`));});

app.get('/student/:id/master-challenge',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid session');const releases=(await pool.query(`SELECT * FROM master_challenge_releases WHERE class_id=$1 AND enabled=true ORDER BY released_at DESC`,[s.class_id])).rows;const cards=[];for(const r of releases){const ch=masterChallengeByKey(r.challenge_key);if(!ch)continue;const last=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE student_id=$1 AND class_id=$2 AND challenge_key=$3 ORDER BY started_at DESC LIMIT 1`,[s.id,s.class_id,ch.key])).rows[0];cards.push(`<div class="card" style="border-top:6px solid #171717"><div class="eyebrow">MASTER DIAGNOSTIC CHALLENGE</div><div class="big">${esc(ch.title)}</div><p><b>Equipment:</b> ${esc(r.tractor_model||ch.model)} · <b>Pass:</b> ${r.pass_score}% · <b>Target:</b> ${r.target_minutes} min</p><div class="alert"><b>Complaint:</b><br>${esc(ch.complaint)}</div><p>${esc(ch.assignment)}</p>${last?.status==='in_progress'?`<a class="btn alt" href="/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${last.id}?token=${encodeURIComponent(s.join_token)}">Continue Challenge</a>`:`<form method="post" action="/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/start?token=${encodeURIComponent(s.join_token)}"><button class="alt">Start Master Challenge</button></form>`}${last?.status==='completed'?` <a class="btn light" href="/student/${s.id}/master-challenge/review/${last.id}?token=${encodeURIComponent(s.join_token)}">Review Last Attempt</a>`:''}</div>`);}res.send(layout('Master Diagnostic Challenge',`<div class="toolbar"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">← Training Home</a></div><div class="card" style="background:#171717;color:#fff;border-bottom:6px solid var(--red)"><div class="big">Master Diagnostic Challenge</div><p>No guided path. Choose your diagnostic tests, document evidence, prove the root cause, make the supported repair, and verify the result.</p></div>${cards.join('')||'<div class="card">No Master Challenge is currently released.</div>'}`));});
app.post('/student/:id/master-challenge/:key/start',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid session');const r=(await pool.query(`SELECT * FROM master_challenge_releases WHERE class_id=$1 AND challenge_key=$2 AND enabled=true`,[s.class_id,req.params.key])).rows[0];const ch=masterChallengeByKey(req.params.key);if(!r||!ch)return res.status(404).send('Challenge not available');const a=(await pool.query(`INSERT INTO master_challenge_attempts(student_id,class_id,challenge_key,root_cause_key,tractor_model,pass_score,max_parts_penalties,target_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[s.id,s.class_id,ch.key,r.root_cause_key,r.tractor_model||ch.model,r.pass_score,r.max_parts_penalties,r.target_minutes])).rows[0];res.redirect(`/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${a.id}?token=${encodeURIComponent(s.join_token)}`);});
app.get('/student/:id/master-challenge/:key/attempt/:aid',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid session');const a=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[req.params.aid,s.id])).rows[0];const ch=masterChallengeByKey(req.params.key);if(!a||!ch)return res.status(404).send('Active challenge not found');const root=(ch.rootCauses||[]).find(r=>r.key===a.root_cause_key)||{};const done=(await pool.query(`SELECT * FROM master_challenge_actions WHERE attempt_id=$1 ORDER BY sequence`,[a.id])).rows;const doneKeys=new Set(done.map(x=>x.action_key));const choices=(ch.actions||[]).filter(x=>!doneKeys.has(x.key)).map(x=>`<form method="post" action="/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${a.id}/action?token=${encodeURIComponent(s.join_token)}" class="q"><input type="hidden" name="action_key" value="${esc(x.key)}"><b>${esc(x.label)}</b><br><span class="muted small">${esc(x.category)}</span><label>Evidence / reason for choosing this test<textarea name="evidence" rows="2" placeholder="What are you trying to prove or rule out?"></textarea></label><button>Perform This Action</button></form>`).join('');const history=done.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.label)}</b> <span class="pill">${esc(x.category)}</span><p>${esc(x.result_text)}</p>${x.evidence_text?`<p><b>Your evidence/reason:</b> ${esc(x.evidence_text)}</p>`:''}${x.penalty?`<div class="alert"><b>Penalty:</b> -${x.penalty}</div>`:''}</div>`).join('');const elapsed=Math.max(0,Math.round((Date.now()-new Date(a.started_at).getTime())/60000));const hintButtons=(ch.hints||[]).map((h,i)=>`<form method="post" action="/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${a.id}/hint?token=${encodeURIComponent(s.join_token)}" style="display:inline"><input type="hidden" name="level" value="${i+1}"><button class="light">Hint ${i+1} (-${Number(h.penalty)||0})</button></form>`).join('');res.send(layout('Master Challenge Attempt',`<div class="card" style="background:#171717;color:#fff"><div class="eyebrow" style="color:#ddd">MASTER CHALLENGE IN PROGRESS</div><div class="big">${esc(ch.title)}</div><p>${esc(a.tractor_model)} · Elapsed ${elapsed} min · Target ${a.target_minutes} min</p></div><div class="card"><div class="alert"><b>Complaint:</b> ${esc(ch.complaint)}</div><p><b>Assignment:</b> ${esc(ch.assignment)}</p><div class="toolbar">${hintButtons}</div></div><div class="card"><div class="big">Your Diagnostic Record</div>${history||'<p>No tests performed yet.</p>'}</div><div class="card"><div class="big">Choose Your Next Action</div><p class="muted">There is no guided path. The sequence is part of your score and review.</p>${choices||'<p>All available diagnostic choices have been used.</p>'}</div><div class="card"><div class="big">Final Decision</div><form method="post" action="/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${a.id}/finish?token=${encodeURIComponent(s.join_token)}"><label>Final Diagnosis<select name="diagnosis" required><option value="">Choose the proven root cause</option>${(ch.rootCauses||[]).map(r=>`<option value="${esc(r.diagnosis)}">${esc(r.diagnosis)}</option>`).join('')}</select></label><label>Repair / Corrective Action<select name="repair" required><option value="">Choose the supported repair</option>${(ch.rootCauses||[]).map(r=>`<option value="${esc(r.repair)}">${esc(r.repair)}</option>`).join('')}</select></label><label>Repair Verification Notes<textarea name="verification" required placeholder="How did you verify the complaint is corrected under the original conditions?"></textarea></label><label><input type="checkbox" name="verified" value="yes" style="width:auto"> I recreated the original operating condition and verified the repair.</label><button class="alt">Submit Final Diagnosis</button></form></div>`));});
app.post('/student/:id/master-challenge/:key/attempt/:aid/action',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid');const a=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[req.params.aid,s.id])).rows[0];const ch=masterChallengeByKey(req.params.key);if(!a||!ch)return res.status(404).send('Not found');const act=(ch.actions||[]).find(x=>x.key===req.body.action_key);const root=(ch.rootCauses||[]).find(r=>r.key===a.root_cause_key)||{};if(!act)return res.status(400).send('Invalid action');const seq=Number((await pool.query(`SELECT COALESCE(max(sequence),0)+1 n FROM master_challenge_actions WHERE attempt_id=$1`,[a.id])).rows[0].n)||1;const result=(root.overrides&&root.overrides[act.key])||act.result||'Test completed.';let points=Number(act.points)||0;if((root.proof||[]).includes(act.key))points+=5;const penalty=Number(act.penalty)||0;await pool.query(`INSERT INTO master_challenge_actions(attempt_id,action_key,category,label,result_text,evidence_text,points,penalty,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(attempt_id,action_key) DO NOTHING`,[a.id,act.key,act.category||'Diagnostic',act.label||act.key,result,req.body.evidence||'',points,penalty,seq]);res.redirect(`/student/${s.id}/master-challenge/${encodeURIComponent(ch.key)}/attempt/${a.id}?token=${encodeURIComponent(s.join_token)}`);});
app.post('/student/:id/master-challenge/:key/attempt/:aid/hint',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid');const a=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[req.params.aid,s.id])).rows[0];const ch=masterChallengeByKey(req.params.key);const level=Math.max(1,Math.min(3,Number(req.body.level)||1));const h=ch?.hints?.[level-1];if(a&&h)await pool.query(`INSERT INTO master_challenge_hints(attempt_id,level,hint_text,penalty) VALUES($1,$2,$3,$4) ON CONFLICT(attempt_id,level) DO NOTHING`,[a.id,level,h.text||'',Number(h.penalty)||0]);res.redirect(`/student/${s.id}/master-challenge/${encodeURIComponent(req.params.key)}/attempt/${req.params.aid}?token=${encodeURIComponent(s.join_token)}`);});
app.post('/student/:id/master-challenge/:key/attempt/:aid/finish',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid');const a=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[req.params.aid,s.id])).rows[0];const ch=masterChallengeByKey(req.params.key);if(!a||!ch)return res.status(404).send('Not found');const root=(ch.rootCauses||[]).find(r=>r.key===a.root_cause_key)||{};const acts=(await pool.query(`SELECT * FROM master_challenge_actions WHERE attempt_id=$1`,[a.id])).rows;const hints=(await pool.query(`SELECT * FROM master_challenge_hints WHERE attempt_id=$1`,[a.id])).rows;const diagnosis=req.body.diagnosis||'',repair=req.body.repair||'',verification=req.body.verification||'',verified=req.body.verified==='yes';const diagOK=diagnosis===root.diagnosis;const repairOK=repair===root.repair;const proofKeys=new Set(root.proof||[]),doneKeys=new Set(acts.map(x=>x.action_key));const proofDone=[...proofKeys].filter(k=>doneKeys.has(k)).length;const proofRatio=proofKeys.size?proofDone/proofKeys.size:1;let positive=acts.reduce((n,x)=>n+Math.max(0,Number(x.points)||0),0);positive+=diagOK?(Number(ch.scoring?.diagnosis)||25):0;positive+=repairOK?(Number(ch.scoring?.repair)||15):0;positive+=verified?(Number(ch.scoring?.verification)||10):0;positive+=Math.round((Number(ch.scoring?.evidence)||10)*proofRatio);const parts=acts.filter(x=>Number(x.penalty)>0).length;let penalty=acts.reduce((n,x)=>n+Math.max(0,Number(x.penalty)||0),0)+hints.reduce((n,x)=>n+Math.max(0,Number(x.penalty)||0),0);const elapsed=Math.max(0,Math.round((Date.now()-new Date(a.started_at).getTime())/60000));if(elapsed>a.target_minutes)penalty+=(elapsed-a.target_minutes)*(Number(ch.timePenaltyPerMinute)||0);const score=Math.max(0,Math.min(100,positive-penalty));const passed=diagOK&&repairOK&&verified&&proofRatio>=1&&score>=a.pass_score&&parts<=a.max_parts_penalties;await pool.query(`UPDATE master_challenge_attempts SET score=$1,positive_points=$2,penalty_points=$3,final_diagnosis=$4,final_repair=$5,verification_notes=$6,diagnosis_correct=$7,repair_correct=$8,verified=$9,passed=$10,status='completed',completed_at=now() WHERE id=$11`,[score,positive,penalty,diagnosis,repair,verification,diagOK,repairOK,verified,passed,a.id]);await pool.query(`INSERT INTO results(student_id,activity,score,completed_at) VALUES($1,'Master Diagnostic Challenge',$2,now())`,[s.id,score]);res.redirect(`/student/${s.id}/master-challenge/review/${a.id}?token=${encodeURIComponent(s.join_token)}`);});
app.get('/student/:id/master-challenge/review/:aid',async(req,res)=>{const s=await studentContext(req.params.id,req.query.token);if(!s)return res.status(403).send('Invalid');const a=(await pool.query(`SELECT * FROM master_challenge_attempts WHERE id=$1 AND student_id=$2`,[req.params.aid,s.id])).rows[0];const ch=masterChallengeByKey(a?.challenge_key);if(!a||!ch)return res.status(404).send('Not found');const root=(ch.rootCauses||[]).find(r=>r.key===a.root_cause_key)||{};const acts=(await pool.query(`SELECT * FROM master_challenge_actions WHERE attempt_id=$1 ORDER BY sequence`,[a.id])).rows;res.send(layout('Master Challenge Review',`<div class="toolbar"><a class="btn light" href="/student/${s.id}/master-challenge?token=${encodeURIComponent(s.join_token)}">← Master Challenges</a></div><div class="card" style="border-top:6px solid ${a.passed?'#267a3f':'var(--red)'}"><div class="eyebrow">MASTER DIAGNOSTIC CHALLENGE</div><div class="big">${esc(ch.title)} · ${a.passed?'<span class="pill open">PASS</span>':'<span class="pill">REVIEW REQUIRED</span>'}</div><div class="grid"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>POSITIVE</span><b>${a.positive_points}</b></div><div class="stat"><span>PENALTIES</span><b>-${a.penalty_points}</b></div><div class="stat"><span>PASS STANDARD</span><b>${a.pass_score}%</b></div></div></div><div class="card"><div class="big">Final Decision</div><p><b>Your Diagnosis:</b> ${esc(a.final_diagnosis)} ${a.diagnosis_correct?'✓':'✕'}</p><p><b>Correct Diagnosis:</b> ${esc(root.diagnosis||'')}</p><p><b>Your Repair:</b> ${esc(a.final_repair)}</p><p><b>Expected Repair:</b> ${esc(root.repair||'')}</p><p><b>Verification:</b> ${esc(a.verification_notes||'')}</p></div><div class="card"><div class="big">Diagnostic Sequence</div>${acts.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.label)}</b><p>${esc(x.result_text)}</p>${x.evidence_text?`<p><b>Evidence:</b> ${esc(x.evidence_text)}</p>`:''}</div>`).join('')}</div>`));});
app.get('/instructor/master-challenges/attempt/:aid',auth,async(req,res)=>{const a=(await pool.query(`SELECT a.*,s.name,s.dealer,c.code FROM master_challenge_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1`,[req.params.aid])).rows[0];if(!a)return res.status(404).send('Not found');const ch=masterChallengeByKey(a.challenge_key),root=(ch?.rootCauses||[]).find(r=>r.key===a.root_cause_key)||{};const acts=(await pool.query(`SELECT * FROM master_challenge_actions WHERE attempt_id=$1 ORDER BY sequence`,[a.id])).rows;const hints=(await pool.query(`SELECT * FROM master_challenge_hints WHERE attempt_id=$1 ORDER BY level`,[a.id])).rows;res.send(layout('Master Challenge Attempt',`<div class="toolbar"><a class="btn light" href="/instructor/master-challenges">← Master Challenges</a></div><div class="card"><div class="eyebrow">INSTRUCTOR REVIEW</div><div class="big">${esc(a.name)} · ${esc(ch?.title||a.challenge_key)}</div><p>${esc(a.dealer)} · Class ${esc(a.code)} · ${esc(a.tractor_model)}</p><div class="grid"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>STATUS</span><b>${a.status==='completed'?(a.passed?'PASS':'REVIEW'):'LIVE'}</b></div><div class="stat"><span>PENALTY</span><b>-${a.penalty_points}</b></div></div></div><div class="card"><div class="big">Hidden Root Cause</div><div class="alert"><b>${esc(root.diagnosis||'')}</b><br>${esc(root.repair||'')}</div></div><div class="card"><div class="big">Diagnostic Sequence & Evidence</div>${acts.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.label)}</b> <span class="pill">${esc(x.category)}</span><p>${esc(x.result_text)}</p><p><b>Evidence / Reason:</b> ${esc(x.evidence_text||'—')}</p>${x.penalty?`<div class="alert">Penalty -${x.penalty}</div>`:''}</div>`).join('')||'<p>No actions yet.</p>'}</div>${hints.length?`<div class="card"><div class="big">Hints Used</div>${hints.map(h=>`<p>Hint ${h.level}: ${esc(h.hint_text)} (-${h.penalty})</p>`).join('')}</div>`:''}<div class="card"><div class="big">Final Decision</div><p><b>Diagnosis:</b> ${esc(a.final_diagnosis||'Not submitted')}</p><p><b>Repair:</b> ${esc(a.final_repair||'Not submitted')}</p><p><b>Verification:</b> ${esc(a.verification_notes||'Not submitted')}</p></div>`));});
// ======================= END MASTER DIAGNOSTIC CHALLENGE =======================

async function ensureMahindra3100SUHuntClass(companyId){
 const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]);
 if(!/mahindra/i.test(String(cq.rows[0]?.name||'')))return null;
 const course='3100 SU Training';
 await pool.query('INSERT INTO company_courses(company_id,name,active) VALUES($1,$2,true) ON CONFLICT(company_id,name) DO UPDATE SET active=true',[companyId,course]);
 let c=(await pool.query('SELECT * FROM classes WHERE company_id=$1 AND course=$2 ORDER BY id LIMIT 1',[companyId,course])).rows[0];
 if(!c){
  const code=await nextImportClassCode(pool);
  const token=crypto.randomBytes(16).toString('hex');
  const instructor=(await pool.query(`SELECT name FROM app_users WHERE company_id=$1 AND active=true AND role IN ('company_admin','instructor') ORDER BY CASE WHEN role='company_admin' THEN 0 ELSE 1 END,id LIMIT 1`,[companyId])).rows[0]?.name||'Company Instructor';
  c=(await pool.query(`INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,active,company_id,created_by_user_id,hunt_tractor_count,hunt_items_per_tractor,hunt_type,show_live_scores,student_feedback) VALUES($1,$2,$3,$4,80,8,$5,true,$6,NULL,1,10,'general',false,true) RETURNING *`,[code,'3100 SU Training',course,instructor,token,companyId])).rows[0];
 }else{
  // The old seed created this class closed. A closed class makes every printed station QR report
  // "station unavailable", so keep the dedicated 3100 scavenger class open when it is used by the program.
  c=(await pool.query(`UPDATE classes SET active=true,hunt_tractor_count=1,hunt_items_per_tractor=10,hunt_type='general' WHERE id=$1 RETURNING *`,[c.id])).rows[0];
 }
 await pool.query(`INSERT INTO hunt_tractors(class_id,tractor_no,model) VALUES($1,1,'3100') ON CONFLICT(class_id,tractor_no) DO UPDATE SET model='3100'`,[c.id]);
 const defaults=[
  ['FMCU','Locate the FMCU and identify its connectors. Enter FMCU when complete.','fmcu'],
  ['Diagnostic Port','Locate the tractor diagnostic port used for service-tool connection. Enter DIAGNOSTIC when complete.','diagnostic'],
  ['Operator Presence Sensor / Switch','Locate the operator-presence sensor/switch used by the safety logic. Enter PRESENCE when complete.','presence'],
  ['PTO Switch','Locate the PTO switch and identify the input it provides to the FMCU. Enter PTO when complete.','pto'],
  ['Neutral Switch / Input','Locate the neutral switch/input used by the operating logic. Enter NEUTRAL when complete.','neutral'],
  ['Park Brake Switch / Input','Locate the park-brake switch/input used by the operating logic. Enter BRAKE when complete.','brake'],
  ['Fuse / Relay Center','Locate the primary fuse/relay center and identify service access. Enter FUSE when complete.','fuse'],
  ['Battery / Main Power','Locate the battery/main electrical power source and identify service access. Enter BATTERY when complete.','battery'],
  ['Main Ground Point','Locate a primary chassis/engine ground point used by the electrical system. Enter GROUND when complete.','ground'],
  ['Transmission Oil Cooler / HST Cooling','Locate the transmission/HST oil-cooling component or circuit identified in the 3100 service training. Enter COOLER when complete.','cooler']
 ];
 const existing=(await pool.query(`SELECT id,item_label FROM hunt_stations WHERE class_id=$1 AND COALESCE(tractor_no,1)=1 ORDER BY id`,[c.id])).rows;
 const have=new Set(existing.map(x=>String(x.item_label||'').trim().toLowerCase()));
 for(const [label,task,expected] of defaults){
  if(have.has(label.toLowerCase()))continue;
  const n=Number((await pool.query(`SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1 AND COALESCE(tractor_no,1)=1`,[c.id])).rows[0].n||0);
  if(n>=10)break;
  await pool.query(`INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,1,'3100',$5)`,[c.id,`3100 — ${label}`,task,expected,label]);
 }
 // Normalize any older 3100 rows so labels and the QR Label Center group them under 3100.
 await pool.query(`UPDATE hunt_stations SET tractor_no=COALESCE(tractor_no,1),tractor_model='3100' WHERE class_id=$1`,[c.id]);
 return c;
}

app.get('/instructor/hunt-select',auth,async(req,res)=>{
 await ensureMahindra3100SUHuntClass(req.account.company_id);
 const q=await pool.query('SELECT id,course,title,code,active,hunt_tractor_count,hunt_type FROM classes WHERE company_id=$1 ORDER BY created_at DESC LIMIT 60',[req.account.company_id]);
 const acs=await allowedCourseSet(req.account); const visibleHunts=acs?q.rows.filter(c=>acs.has(c.course)):q.rows; const rows=visibleHunts.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="small muted">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td>${esc(HUNT_TYPES[c.hunt_type]||HUNT_TYPES.general)}</td><td>${c.hunt_tractor_count||3}</td><td><a class="btn" href="/instructor/hunt/${c.id}">Open Scavenger Hunt</a></td></tr>`).join('');
 res.send(layout('Scavenger Hunt', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="eyebrow">Dedicated Activity Tab</div><div class="big">Scavenger Hunt</div><p>Choose a class. The scavenger hunt is managed separately from tests and diagnostic simulations.</p><table><tr><th>Class</th><th>Code</th><th>Hunt Type</th><th>Tractors</th><th></th></tr>${rows||'<tr><td colspan="5">No classes yet.</td></tr>'}</table></div>`));
});

// 2.1.83 QR Label Center: one company-scoped location for every hunt QR label, with direct one-label printing and selectable/custom sizes.
// Labels are generated directly from hunt_stations, so the printed label and the scavenger-hunt item always use the same saved wording.
app.get('/instructor/qr-labels',auth,async(req,res)=>{
 const companyId=req.account.company_id;
 const requestedSize=String(req.query.size||'40x30');
 const size=(requestedSize==='custom'||LABEL_SPECS[requestedSize])?requestedSize:'40x30';
 const customW=Math.min(100,Math.max(20,Number(req.query.w)||40)); const customH=Math.min(100,Math.max(20,Number(req.query.h)||30));
 const modelFilter=String(req.query.model||'').trim();
 const acs=await allowedCourseSet(req.account);
 const q=await pool.query(`SELECT h.*,c.course,c.title class_title,c.code,c.active class_active
   FROM hunt_stations h JOIN classes c ON c.id=h.class_id
   WHERE c.company_id=$1 ORDER BY COALESCE(NULLIF(h.tractor_model,''),'Uncategorized'),c.course,c.code,COALESCE(h.tractor_no,99),h.id`,[companyId]);
 let rows=acs?q.rows.filter(r=>acs.has(r.course)):q.rows;
 const allModels=[...new Set(rows.map(r=>String(r.tractor_model||'Uncategorized').trim()||'Uncategorized'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 if(modelFilter) rows=rows.filter(r=>String(r.tractor_model||'Uncategorized').trim()===modelFilter);
 const canEdit=isEditorRole(req.account.role);
 const presetEntries=Object.entries(LABEL_SPECS).filter(([v])=>v!=='30');
 const sizeOptions=presetEntries.map(([v,x])=>`<option value="${esc(v)}" ${size===v?'selected':''}>${esc(x.label)}</option>`).join('')+`<option value="custom" ${size==='custom'?'selected':''}>Custom size…</option>`;
 const modelOptions=['<option value="">All Models</option>',...allModels.map(m=>`<option value="${esc(m)}" ${modelFilter===m?'selected':''}>${esc(m)}</option>`)].join('');
 const grouped=new Map(); for(const r of rows){const m=String(r.tractor_model||'Uncategorized').trim()||'Uncategorized'; if(!grouped.has(m))grouped.set(m,[]); grouped.get(m).push(r);}
 const sections=[...grouped.entries()].map(([model,items])=>{
   const itemCards=items.map((h,i)=>{
     const label=String(h.item_label||h.station_name||`Station ${i+1}`).replace(/^.*?—\s*/,'').trim();
     const status=h.class_active?'<span class="pill open">Class Active</span>':'<span class="pill closed">Class Closed</span>';
     const edit=canEdit?`<details style="margin-top:10px"><summary class="btn light" style="cursor:pointer;display:inline-block">Edit Label / Hunt Item</summary><form method="post" action="/instructor/qr-labels/${h.id}/edit" class="card" style="margin-top:10px;background:#fafafa"><input type="hidden" name="return_size" value="${esc(size)}"><input type="hidden" name="return_w" value="${esc(customW)}"><input type="hidden" name="return_h" value="${esc(customH)}"><input type="hidden" name="return_model" value="${esc(modelFilter)}"><label>Item / Label Name<input name="item_label" value="${esc(label)}" required></label><label>Student Task<textarea name="task" rows="3" required>${esc(h.task||'')}</textarea></label><label>Expected Answer / Verification<input name="expected" value="${esc(h.expected||'')}" required></label><div class="alert"><b>Matched automatically:</b> saving here updates the actual scavenger-hunt station. The next QR label generated for this station uses these exact same words.</div><button>Save Changes</button></form></details>`:'';
     return `<div class="card" style="margin:10px 0;border-left:5px solid var(--red)"><div class="section-title"><div><div class="eyebrow">${esc(h.course)} · CLASS ${esc(h.code)} · EQUIPMENT ${esc(h.tractor_no||'')}</div><div class="big" style="font-size:20px">${esc(label)}</div></div>${status}</div><p><b>Task:</b> ${esc(h.task||'')}</p><p class="small muted"><b>Expected:</b> ${esc(h.expected||'')}</p><div class="toolbar"><a class="btn" href="/instructor/class/${h.class_id}/hunt-label-one/${h.id}?size=${encodeURIComponent(size)}&w=${encodeURIComponent(customW)}&h=${encodeURIComponent(customH)}" target="_blank">🖨️ Print One Label</a><a class="btn light" href="/instructor/class/${h.class_id}/hunt-label-png/${h.id}?size=${encodeURIComponent(size)}&w=${encodeURIComponent(customW)}&h=${encodeURIComponent(customH)}">Download PNG</a><a class="btn light" href="/instructor/hunt/${h.class_id}">Open Matching Hunt</a><a class="btn light" href="/instructor/class/${h.class_id}/hunt-qr" target="_blank">Full QR Sheet</a></div>${edit}</div>`;
   }).join('');
   return `<div class="card" style="border-top:6px solid var(--red)"><div class="section-title"><div><div class="eyebrow">MODEL CATEGORY</div><div class="big">${esc(model)}</div></div><span class="pill">${items.length} QR label${items.length===1?'':'s'}</span></div>${itemCards}</div>`;
 }).join('');
 res.send(layout('QR Label Center',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a><a class="btn light" href="/instructor/hunt-select">Scavenger Hunts</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">CENTRAL QR LABEL LIBRARY · 2.1.83</div><div class="big">QR Label Center</div><p>Choose a model and label size, then print exactly one QR label directly from the Training Hub. Presets include 30 × 30, 40 × 30, 50 × 30, 50 × 40, and 60 × 40 mm, plus a custom width and height. Your label edits still update the same scavenger-hunt station, so the QR label always stays matched.</p><form id="labelFilterForm" method="get" action="/instructor/qr-labels"><div class="grid"><label>Model Category<select name="model">${modelOptions}</select></label><label>Label Size<select id="labelSize" name="size">${sizeOptions}</select></label><label class="custom-size" style="${size==='custom'?'':'display:none'}">Custom Width (mm)<input id="customW" name="w" type="number" min="20" max="100" step="1" value="${esc(customW)}"></label><label class="custom-size" style="${size==='custom'?'':'display:none'}">Custom Height (mm)<input id="customH" name="h" type="number" min="20" max="100" step="1" value="${esc(customH)}"></label></div><button>Apply Filter / Label Size</button></form><div class="success" style="margin-top:12px"><b>${rows.length}</b> label${rows.length===1?'':'s'} shown · <b>${grouped.size}</b> model categor${grouped.size===1?'y':'ies'}.</div></div>${sections||'<div class="alert">No scavenger-hunt QR labels have been built yet. Create or open a Scavenger Hunt and add its stations first.</div>'}<script>(function(){const s=document.getElementById('labelSize'),f=document.getElementById('labelFilterForm'),w=document.getElementById('customW'),h=document.getElementById('customH');function sync(){document.querySelectorAll('.custom-size').forEach(x=>x.style.display=s.value==='custom'?'block':'none');}s.addEventListener('change',()=>{sync();localStorage.setItem('tthLabelSize',s.value);});[w,h].forEach(x=>x&&x.addEventListener('change',()=>localStorage.setItem('tthLabel'+(x===w?'W':'H'),x.value)));sync();})();</script>`));
});

app.post('/instructor/qr-labels/:sid/edit',auth,async(req,res)=>{
 if(!isEditorRole(req.account.role))return res.status(403).send('Edit permission required');
 const sid=Number(req.params.sid); const companyId=req.account.company_id;
 const existing=(await pool.query(`SELECT h.*,c.course FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.company_id=$2`,[sid,companyId])).rows[0];
 if(!existing)return res.status(404).send('QR label / hunt item not found');
 const allowed=await allowedCourseSet(req.account); if(allowed&&!allowed.has(existing.course))return res.status(403).send('Course access denied');
 const item=String(req.body.item_label||'').trim(),task=String(req.body.task||'').trim(),expected=String(req.body.expected||'').trim();
 if(!item||!task||!expected)return res.status(400).send('Item name, task, and expected answer are required.');
 const stationName=`${existing.tractor_model||`Equipment ${existing.tractor_no||''}`} — ${item}`;
 await pool.query('UPDATE hunt_stations SET item_label=$2,station_name=$3,task=$4,expected=$5 WHERE id=$1',[sid,item,stationName,task,expected]);
 const qs=new URLSearchParams(); const size=String(req.body.return_size||'40x30'); if(size==='custom'||LABEL_SPECS[size])qs.set('size',size); if(size==='custom'){qs.set('w',String(req.body.return_w||40));qs.set('h',String(req.body.return_h||30));} const model=String(req.body.return_model||'').trim(); if(model)qs.set('model',model);
 res.redirect('/instructor/qr-labels?'+qs.toString());
});

app.get('/instructor/hunt/:id',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found'); const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)); const target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5)); const huntType=HUNT_TYPES[c.hunt_type]?c.hunt_type:'general';
 const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]); const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[c.id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model])); const companyModels=(await companyEquipmentModels(c.company_id)).map(x=>x.name);
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); const balanced=counts.every(n=>n===target);
 const tractorCards=Array.from({length:count},(_,i)=>i+1).map(n=>{
  const model=models.get(n)||'';
  const items=hs.rows.filter(x=>Number(x.tractor_no)===n); const remaining=Math.max(0,target-items.length);
  const selectOptions=['<option value="">— Select Equipment Model —</option>',...companyModels.map(x=>`<option value="${esc(x)}" ${model===x?'selected':''}>${esc(x)}</option>`)].join('');
  const visibleLibrary=model ? HUNT_ITEM_LIBRARY.filter(x=>huntItemVisible(x,huntType,model)).filter(x=>!items.some(h=>(h.item_label||'')===x.label)) : [];
  const itemChecks=visibleLibrary.map(x=>`<label style="font-weight:500;margin:6px 0"><input style="width:auto;margin-right:8px" type="checkbox" name="items" value="${esc(x.id)}">${esc(x.label)}</label>`).join('');
  const modelNote=huntType==='fmcu'?`<div class="alert" style="margin:10px 0"><b>Safety / Inspection Hunt:</b> Safety and inspection items are shown below.</div>`:huntType==='auto4wd'?`<div class="alert" style="margin:10px 0"><b>Process / Logic Hunt:</b> Process, command, feedback, and verification items are shown below.</div>`:'';
  const status=items.length===target?`<span class="pill results">${items.length}/${target} READY</span>`:items.length>target?`<span class="pill" style="background:#fff1f0;color:#a61b1b">${items.length}/${target} · REMOVE ${items.length-target}</span>`:`<span class="pill">${items.length}/${target} ITEMS</span>`;
  const huntChooser=!model ? `<div class="alert" style="margin-top:10px"><b>Choose a tractor model first.</b><br>Select a model from the list above and click Save Model. The hunt-item choices will then appear.</div>` : items.length>target ? `<div class="alert" style="margin-top:10px"><b>Equipment ${n} has ${items.length-target} extra hunt item${items.length-target===1?'':'s'}.</b><br>The new target of ${target} was saved. Delete ${items.length-target} item${items.length-target===1?'':'s'} from Current Hunt below to balance this equipment/station. Nothing was deleted automatically.</div>` : remaining===0 ? `<div class="success" style="margin-top:10px"><b>Equipment ${n} is complete.</b> It has the required ${target} hunt items.</div>` : `<form method="post" action="/instructor/hunt/${c.id}/tractor/${n}/items"><div class="alert" style="margin:10px 0"><b>Select ${remaining} more item${remaining===1?'':'s'}.</b> Every equipment/station must have exactly ${target} hunt items.</div>${itemChecks||'<p class="muted">No additional built-in items are available. Use a custom hunt item below if needed.</p>'}<button>Add Selected Hunt Items</button></form>`;
  return `<div class="card"><div class="section-title"><div><div class="eyebrow">${brand('equipment_label','Equipment').toUpperCase()} ${n}</div><div class="big">${esc(model||'Choose Equipment Model')}</div></div>${status}</div><form method="post" action="/instructor/hunt/${c.id}/tractor/${n}/model"><label>Equipment Model<select name="model">${selectOptions}</select></label><button>Save Model</button></form><hr>${modelNote}${huntChooser}</div>`
 }).join('');
 const current=hs.rows.map((h,i)=>`<div class="q"><span class="pill">Equipment ${h.tractor_no||'—'}</span> <b>${esc(h.tractor_model||'')} — ${esc(h.item_label||h.station_name)}</b><div class="small muted">${esc(h.task)}</div><form method="post" action="/instructor/hunt/${c.id}/station/${h.id}/delete" style="margin-top:8px"><button class="danger" onclick="return confirm('Delete this hunt item?')">Delete Hunt Item</button></form></div>`).join('');
 const balanceText=balanced?`<div class="success" style="margin-top:12px"><b>Balanced Hunt Ready:</b> All ${count} tractor${count===1?'':'s'} have exactly ${target} hunt items.</div>`:`<div class="alert" style="margin-top:12px"><b>Balance Required:</b> Every equipment/station must have exactly ${target} hunt items. Current counts: ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div>`;
 res.send(layout('Scavenger Hunt Builder', `<div class="toolbar"><a class="btn light" href="/instructor/hunt-select">← Hunt Classes</a><a class="btn light" href="/instructor/class/${c.id}">Class Dashboard</a>${balanced?`<a class="btn" href="/instructor/class/${c.id}/hunt-qr">Open Full QR Sheets</a><a class="btn light" href="/instructor/class/${c.id}/hunt-label-print">Generate T50M Labels</a>`:`<span class="pill">Finish all equipment/stations before printing QR codes</span>`}</div><div class="card"><div class="eyebrow">SCAVENGER HUNT TAB</div><div class="big">${esc(c.course)} · Class ${esc(c.code)}</div><p>Choose the number of equipment/stations and the number of hunt items per equipment/station. The same item count is enforced on each one.</p><div class="grid"><form method="post" action="/instructor/hunt/${c.id}/type"><label>Hunt Type<select name="hunt_type">${Object.entries(HUNT_TYPES).map(([v,l])=>`<option value="${v}" ${huntType===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label><button>Save Hunt Type</button></form><form method="post" action="/instructor/hunt/${c.id}/tractor-count"><label>How Many Equipment / Stations Will You Use?<select name="tractor_count">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===count?'selected':''}>${n} ${brand('equipment_label','Equipment')}${n===1?'':'s'}</option>`).join('')}</select></label><button>Save Equipment Count</button></form><form method="post" action="/instructor/hunt/${c.id}/items-per-tractor"><label>Hunt Items Per Equipment / Station<select name="items_per_tractor">${Array.from({length:12},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===target?'selected':''}>${n} Item${n===1?'':'s'} Each</option>`).join('')}</select></label><button>Save Item Count</button></form></div>${balanceText}<div class="alert" style="margin-top:12px"><b>Individual scavenger hunt:</b> Each student scans and completes every station on their own phone. No teams are used.</div></div><div class="grid">${tractorCards}</div><div class="card"><div class="big">Add Custom Hunt Item</div><p class="muted">Custom items also count toward the required ${target} items for each equipment/station.</p><form method="post" action="/instructor/hunt/${c.id}/custom"><label>${esc(brand('equipment_label','Equipment'))}<select name="tractor_no">${Array.from({length:count},(_,i)=>`<option value="${i+1}">Equipment ${i+1}</option>`).join('')}</select></label><label>Item Name<input name="name" required></label><label>Student Task<textarea name="task" required></textarea></label><label>Expected Answer / Verification<input name="expected" required></label><button>Add Custom Hunt Item</button></form></div><div class="card"><div class="section-title"><div class="big">Current Hunt</div><span class="pill">${hs.rowCount} total items</span></div>${current||'<p>No hunt items have been added yet.</p>'}<form method="post" action="/instructor/hunt/${c.id}/clear"><button class="danger" onclick="return confirm('Clear the entire hunt for this class?')">Clear Entire Hunt</button></form></div>`));
});
app.post('/instructor/hunt/:id/type',auth,async(req,res)=>{const cid=Number(req.params.id),huntType=HUNT_TYPES[req.body.hunt_type]?req.body.hunt_type:'general';const current=(await pool.query('SELECT hunt_type FROM classes WHERE id=$1',[cid])).rows[0];if(current&&current.hunt_type!==huntType){await pool.query('DELETE FROM hunt_stations WHERE class_id=$1',[cid]);await pool.query(`DELETE FROM results WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);}await pool.query('UPDATE classes SET hunt_type=$2 WHERE id=$1',[cid,huntType]);res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/tractor-count',auth,async(req,res)=>{const cid=Number(req.params.id),count=Math.min(5,Math.max(1,Number(req.body.tractor_count)||3));await pool.query('UPDATE classes SET hunt_tractor_count=$2 WHERE id=$1',[cid,count]);await pool.query('DELETE FROM hunt_tractors WHERE class_id=$1 AND tractor_no>$2',[cid,count]);await pool.query('DELETE FROM hunt_stations WHERE class_id=$1 AND COALESCE(tractor_no,999)>$2',[cid,count]);res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/items-per-tractor',auth,async(req,res)=>{const cid=Number(req.params.id),target=Math.min(12,Math.max(1,Number(req.body.items_per_tractor)||5));await pool.query('UPDATE classes SET hunt_items_per_tractor=$2 WHERE id=$1',[cid,target]);res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/tractor/:slot/model',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.params.slot)||1)),model=(req.body.model||'').trim();await pool.query(`INSERT INTO hunt_tractors(class_id,tractor_no,model) VALUES($1,$2,$3) ON CONFLICT(class_id,tractor_no) DO UPDATE SET model=$3`,[cid,slot,model]);if(!model){await pool.query('DELETE FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot]);}else{await pool.query('UPDATE hunt_stations SET tractor_model=$3 WHERE class_id=$1 AND tractor_no=$2',[cid,slot,model]);}res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/tractor/:slot/items',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.params.slot)||1));const cq=(await pool.query('SELECT hunt_items_per_tractor,hunt_type FROM classes WHERE id=$1',[cid])).rows[0];const huntType=HUNT_TYPES[cq?.hunt_type]?cq.hunt_type:'general';const target=Math.min(12,Math.max(1,Number(cq?.hunt_items_per_tractor)||5));const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0];const model=mq?.model||`Equipment ${slot}`;let ids=req.body.items||[];if(!Array.isArray(ids))ids=[ids];let current=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0].n);for(const id of ids){if(current>=target)break;const item=HUNT_ITEM_LIBRARY.find(x=>x.id===id);if(!item)continue;if(!huntItemVisible(item,huntType,model))continue;const exists=await pool.query('SELECT 1 FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2 AND item_label=$3',[cid,slot,item.label]);if(!exists.rowCount){await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${item.label}`,item.task,item.expected,slot,model,item.label]);current++;}}res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/custom',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.body.tractor_no)||1));const cq=(await pool.query('SELECT hunt_items_per_tractor FROM classes WHERE id=$1',[cid])).rows[0];const target=Math.min(12,Math.max(1,Number(cq?.hunt_items_per_tractor)||5));const current=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0].n);if(current>=target)return res.send(layout('Equipment Hunt Full',`<div class="card"><div class="big">Equipment ${slot} already has ${target} hunt items</div><div class="alert">Delete an existing item before adding another custom item.</div><a class="btn" href="/instructor/hunt/${cid}">Back to Scavenger Hunt</a></div>`));const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0];const model=mq?.model||`Equipment ${slot}`;await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${req.body.name}`,req.body.task,req.body.expected,slot,model,req.body.name]);res.redirect(`/instructor/hunt/${cid}`);});
app.post('/instructor/hunt/:id/station/:sid/delete',auth,async(req,res)=>{await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]);res.redirect(`/instructor/hunt/${req.params.id}`);});
app.post('/instructor/hunt/:id/clear',auth,async(req,res)=>{const cid=Number(req.params.id);await pool.query('DELETE FROM hunt_stations WHERE class_id=$1',[cid]);await pool.query(`DELETE FROM results WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);res.redirect(`/instructor/hunt/${cid}`);});


async function buildPrePostData(classId=null){
 const params=[]; let where='';
 if(classId){ params.push(Number(classId)); where='WHERE s.class_id=$1'; }
 const students=(await pool.query(`SELECT s.id,s.name,s.dealer,s.class_id,c.course,c.code,c.title FROM students s JOIN classes c ON c.id=s.class_id ${where} ORDER BY c.created_at DESC,s.name`,params)).rows;
 const output=[]; const topicMap=new Map();
 for(const st of students){
  const attempts=(await pool.query(`SELECT id,score,correct_count,total_questions,completed_at FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at ASC,id ASC`,[st.id])).rows;
  const pre=attempts[0]||null, post=attempts.length>=2?attempts[attempts.length-1]:null;
  const improvement=pre&&post?Number(post.score)-Number(pre.score):null;
  output.push({...st,attempt_count:attempts.length,pre,post,improvement});
  if(pre&&post){
   for(const [kind,a] of [['pre',pre],['post',post]]){
    const rows=(await pool.query(`SELECT COALESCE(NULLIF(topic,''),'General Diagnostics') topic,count(*)::int total,count(*) FILTER (WHERE is_correct=true)::int correct FROM quiz_attempt_answers WHERE attempt_id=$1 GROUP BY COALESCE(NULLIF(topic,''),'General Diagnostics')`,[a.id])).rows;
    for(const r of rows){ if(!topicMap.has(r.topic)) topicMap.set(r.topic,{topic:r.topic,preCorrect:0,preTotal:0,postCorrect:0,postTotal:0}); const t=topicMap.get(r.topic); if(kind==='pre'){t.preCorrect+=Number(r.correct);t.preTotal+=Number(r.total);}else{t.postCorrect+=Number(r.correct);t.postTotal+=Number(r.total);} }
   }
  }
 }
 const paired=output.filter(x=>x.pre&&x.post);
 const preAvg=paired.length?Math.round(paired.reduce((a,x)=>a+Number(x.pre.score),0)/paired.length):null;
 const postAvg=paired.length?Math.round(paired.reduce((a,x)=>a+Number(x.post.score),0)/paired.length):null;
 const avgImprovement=paired.length?Math.round(paired.reduce((a,x)=>a+Number(x.improvement),0)/paired.length):null;
 const improved=paired.filter(x=>x.improvement>0).length;
 const topics=[...topicMap.values()].map(t=>({...t,prePct:t.preTotal?Math.round(t.preCorrect/t.preTotal*100):null,postPct:t.postTotal?Math.round(t.postCorrect/t.postTotal*100):null})).map(t=>({...t,gain:t.prePct!==null&&t.postPct!==null?t.postPct-t.prePct:null})).sort((a,b)=>(b.gain??-999)-(a.gain??-999));
 return {students:output,paired,preAvg,postAvg,avgImprovement,improved,topics};
}

app.get('/instructor/prepost',auth,async(req,res)=>{
 let classes=(await pool.query(`SELECT c.id,c.course,c.code,c.title,c.active,(SELECT count(*)::int FROM students s WHERE s.class_id=c.id) students FROM classes c WHERE c.company_id=$1 ORDER BY c.active DESC,c.created_at DESC LIMIT 100`,[req.account.company_id])).rows; {const acs=await allowedCourseSet(req.account); if(acs) classes=classes.filter(c=>acs.has(c.course));}
 const cards=classes.map(c=>`<div class="card" style="border-top:5px solid ${c.active?'var(--red)':'#333'}"><div class="eyebrow">CLASS ${esc(c.code)} · ${c.active?'LIVE':'CLOSED'}</div><div class="big">${esc(c.course)}</div><p>${esc(c.title||'')} · ${c.students} student${c.students===1?'':'s'}</p><a class="btn" href="/instructor/class/${c.id}/prepost">Open Improvement Dashboard</a></div>`).join('');
 res.send(layout('Pre/Post Improvement',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Command Center</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">KNOWLEDGE IMPROVEMENT · 2.0</div><div class="big" style="font-size:30px">Pre-Test vs Post-Test</div><p style="margin-bottom:0">Pre-Test and Post-Test use the same locked question set for each student, with the Post-Test reshuffled into a different order.</p></div><div class="grid">${cards||'<div class="card">No classes yet.</div>'}</div>`));
});

app.get('/instructor/class/:id/prepost',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const d=await buildPrePostData(c.id);
 const rows=d.students.map(x=>{const pre=x.pre?`${x.pre.score}%`:'Not taken'; const post=x.post?`${x.post.score}%`:'Waiting'; const gain=x.improvement===null?'—':`${x.improvement>0?'+':''}${x.improvement} pts`; const cls=x.improvement===null?'':x.improvement>0?'pass':x.improvement<0?'danger':'review'; const status=x.attempt_count===0?'Needs Pre-Test':x.attempt_count===1?'Needs Post-Test':x.improvement>0?'Improved':x.improvement===0?'No Change':'Declined'; return `<tr><td><b>${esc(x.name)}</b><br><span class="small muted">${esc(x.dealer||'')}</span></td><td>${pre}</td><td>${post}</td><td class="${cls}"><b>${gain}</b></td><td>${esc(status)}</td><td><a class="btn light" href="/instructor/student/${x.id}">Open</a></td></tr>`}).join('');
 const topicRows=d.topics.map(t=>`<tr><td><b>${esc(t.topic)}</b></td><td>${t.prePct===null?'—':t.prePct+'%'}</td><td>${t.postPct===null?'—':t.postPct+'%'}</td><td class="${t.gain>0?'pass':t.gain<0?'danger':'review'}"><b>${t.gain===null?'—':(t.gain>0?'+':'')+t.gain+' pts'}</b></td></tr>`).join('');
 const paired=d.paired.length;
 res.send(layout('Pre/Post Improvement',`<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${c.id}">← Live Class</a><a class="btn light" href="/instructor/prepost">All Classes</a><button onclick="window.print()">Print Dashboard</button></div><div class="card" style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">PRE-TEST VS POST-TEST</div><div class="big" style="font-size:30px">${esc(c.course)} · Class ${esc(c.code)}</div><p style="margin-bottom:0">Measures knowledge gain using the same question set for Pre-Test and Post-Test, with the Post-Test questions presented in a different order.</p></div><div class="grid"><div class="stat"><span>PAIRED TECHNICIANS</span><b>${paired}</b></div><div class="stat"><span>PRE-TEST AVERAGE</span><b>${d.preAvg===null?'—':d.preAvg+'%'}</b></div><div class="stat green"><span>POST-TEST AVERAGE</span><b>${d.postAvg===null?'—':d.postAvg+'%'}</b></div><div class="stat"><span>AVERAGE IMPROVEMENT</span><b>${d.avgImprovement===null?'—':(d.avgImprovement>0?'+':'')+d.avgImprovement+' pts'}</b></div><div class="stat"><span>TECHNICIANS IMPROVED</span><b>${d.improved}/${paired}</b></div></div><div class="card"><div class="section-title"><div><div class="big">Student Improvement</div><p class="muted">A student needs at least two completed quiz attempts to produce a Pre/Post comparison.</p></div></div><div style="overflow:auto"><table><thead><tr><th>${esc(brand('student_label','Student'))}</th><th>Pre-Test</th><th>Post-Test</th><th>Improvement</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">No students enrolled yet.</td></tr>'}</tbody></table></div></div><div class="card"><div class="big">Topic Improvement</div><p class="muted">Aggregates correct-answer percentage by quiz topic from paired Pre-Test and Post-Test attempts.</p><div style="overflow:auto"><table><thead><tr><th>Topic</th><th>Pre-Test</th><th>Post-Test</th><th>Gain</th></tr></thead><tbody>${topicRows||'<tr><td colspan="4">Topic improvement appears after students complete both tests.</td></tr>'}</tbody></table></div></div><div class="alert"><b>Measurement rule:</b> The student's first completed Pre-Test locks that exact question set. Every Post-Test uses those same questions in a reshuffled order. Additional retakes never replace the original Pre-Test question set.</div>`));
});

app.get('/instructor/reports',auth,async(req,res)=>{
 const classQ=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities,s.joined_at,'class'::text source FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id WHERE c.company_id=$1 GROUP BY s.id,c.course,c.code,s.joined_at ORDER BY s.joined_at DESC LIMIT 200`,[req.account.company_id]);
 const programQ=await pool.query(`SELECT ps.id,ps.name,ps.dealer,p.title course,p.join_code code,COALESCE(round(avg(a.score) FILTER (WHERE a.status='completed')),0)::int avg_score,count(a.id) FILTER (WHERE a.status='completed')::int activities,ps.joined_at,'program'::text source FROM program_students ps JOIN training_programs p ON p.id=ps.program_id LEFT JOIN program_test_attempts a ON a.student_id=ps.id WHERE p.company_id=$1 GROUP BY ps.id,p.title,p.join_code,ps.joined_at ORDER BY ps.joined_at DESC LIMIT 200`,[req.account.company_id]);
 const acs=await allowedCourseSet(req.account); let combined=[...classQ.rows,...programQ.rows].sort((a,b)=>new Date(b.joined_at)-new Date(a.joined_at)).slice(0,300); if(acs)combined=combined.filter(x=>x.source==='program'||acs.has(x.course));
 const rows=combined.map(s=>s.source==='program'?`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer||'')}</span></td><td>${esc(s.course)}<br><span class="pill open">Modular Program</span></td><td>${s.activities}</td><td>${s.avg_score}%</td><td class="nowrap"><a class="btn" target="_blank" href="/instructor/program-student/${s.id}/report">Print Report</a> <a class="btn light" href="/instructor/program-student/${s.id}">Open Record</a></td></tr>`:`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td>${esc(s.course)}</td><td>${s.activities}</td><td>${s.avg_score}%</td><td class="nowrap"><a class="btn" target="_blank" href="/instructor/student/${s.id}/report">Print Report</a> <a class="btn light" target="_blank" href="/instructor/student/${s.id}/certificate/edit">Edit Certificate</a></td></tr>`).join('');
 res.send(layout('Print Reports', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="big">Print Student Reports</div><p class="muted">Live Class and Modular Program records are shown together. Existing Modular Program students appear automatically.</p><div style="overflow:auto"><table><tr><th>${esc(brand('student_label','Student'))}</th><th>Course / Program</th><th>Scored Activities</th><th>Average</th><th></th></tr>${rows||'<tr><td colspan="5">No student records yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/settings',auth,async(req,res)=>{
 const q=await pool.query('SELECT course,title,pass_score,hours,instructor,code FROM classes WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1',[req.account.company_id]); const c=q.rows[0];
 res.send(layout('Settings', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="big">Settings</div><p class="muted">Your account is protected by the Training Hub 2.0 security system. Passing score and course hours are chosen when each class is created.</p>${c?`<div class="grid"><div class="stat"><span>Last Course</span><b style="font-size:20px">${esc(c.course)}</b></div><div class="stat"><span>Passing Score</span><b>${c.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${c.hours}</b></div></div><p class="small muted">Most recent class: ${esc(c.title)} · Instructor ${esc(c.instructor)} · Code ${esc(c.code)}</p>`:'<p>No classes have been created yet.</p>'}<div class="alert" style="margin-top:18px"><b>Account Role:</b> ${esc(roleLabel(req.account.role))}. Company administrators manage instructor passwords and course permissions from Team & Permissions.</div></div>`));
});
app.get('/instructor/new',auth,async(req,res)=>{ if(!isEditorRole(req.account.role)) return res.status(403).send('Read-only account'); let cq=await pool.query('SELECT name FROM company_courses WHERE company_id=$1 AND active=true ORDER BY name',[req.account.company_id]); let courseRows=cq.rows; const acs=await allowedCourseSet(req.account); if(acs)courseRows=courseRows.filter(x=>acs.has(x.name)); const options=courseRows.map(x=>`<option>${esc(x.name)}</option>`).join(''); res.send(layout('Start Class', `<div class="card"><div class="big">Start a Training Class</div><form method="post" action="/instructor/new"><label>Class Title<input name="title" placeholder="Example: September Company / Location Training" required></label><label>Course<select name="course">${options}</select></label><label>Instructor Name<input name="instructor" required></label><div class="grid"><label>Passing Score<input type="number" name="pass_score" min="1" max="100" value="80"></label><label>Course Hours<input type="number" step="0.5" name="hours" min="0" value="8"></label></div><label><input style="width:auto" type="checkbox" name="student_feedback" value="1" checked> Show missed-question feedback to students after the quiz</label><label><input style="width:auto" type="checkbox" name="show_live_scores" value="1"> Show current scores on the live leaderboard</label><button>Create Class & QR Code</button></form></div>`)); });
app.post('/instructor/new',auth,async(req,res)=>{
 let code; for(let i=0;i<8;i++){ code=code6(); const e=await pool.query('SELECT 1 FROM classes WHERE code=$1',[code]); if(!e.rowCount) break; }
 const token=crypto.randomBytes(16).toString('hex');
 if(!(await courseAllowedForSession(req.account,req.body.course,true))) return res.status(403).send('Course permission not assigned'); const q=await pool.query('INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,student_feedback,show_live_scores,company_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[code,req.body.title,req.body.course,req.body.instructor,Number(req.body.pass_score)||80,Number(req.body.hours)||0,token,req.body.student_feedback==='1',req.body.show_live_scores==='1',req.account.company_id,req.account.user_id||null]);
 await ensureEmbeddedVideosForClass(q.rows[0]);
 res.redirect(`/instructor/class/${q.rows[0].id}`);
});

app.get('/instructor/class/:id',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const students=await pool.query(`SELECT s.*,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities,a.activity current_activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status FROM students s LEFT JOIN results r ON r.student_id=s.id LEFT JOIN activity_status a ON a.student_id=s.id LEFT JOIN instructor_notes n ON n.student_id=s.id WHERE s.class_id=$1 GROUP BY s.id,a.activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status ORDER BY s.name`,[c.id]);
 const origin=`${req.protocol}://${req.get('host')}`, joinUrl=`${origin}/c/${c.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:420,margin:1});
 const completed=students.rows.filter(s=>s.activities>0).length; const classAvg=completed?Math.round(students.rows.filter(s=>s.activities>0).reduce((a,s)=>a+s.avg_score,0)/completed):0;
 const certs=students.rows.filter(s=>s.certificate_no).length;
 const testing=students.rows.filter(s=>(s.status||'')==='Testing').length;
 const rows=students.rows.map(s=>{const status=s.status||'Joined';const cls=status==='Testing'?'testing':status==='Hunt'?'hunt':s.activities?'results':'joined';const progress=s.total?`${s.progress||0}/${s.total}`:'—';const live=c.show_live_scores&&s.current_score!==null?`${s.current_score}%`:'Hidden';const cert=s.certificate_no?'<span class="pill results">Issued</span>':'<span class="pill">Pending</span>';return `<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td><span class="pill ${cls}">${esc(status)}</span><br><span class="small muted">${esc(s.current_activity||'Joined')}</span></td><td><b>${progress}</b></td><td>${live}</td><td>${s.activities?'<b>'+s.avg_score+'%</b>':'—'}</td><td>${cert}</td><td><a class="btn light" href="/instructor/student/${s.id}">Open Student Record</a></td></tr>`}).join('');
 const liveCss=`<style>
 .live-shell{max-width:1320px;margin:auto}.live-banner{background:linear-gradient(135deg,#171717 0%,#5f0b10 100%);color:#fff;border-radius:22px;padding:25px 28px;border-bottom:6px solid var(--red);box-shadow:0 10px 28px rgba(0,0,0,.12)}.live-banner .eyebrow{color:#ffb7ba}.live-banner h1{margin:5px 0 6px;font-size:34px}.live-banner p{margin:0;color:#eee}.live-banner-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}.version-badge{background:#fff;color:#7e0d12;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;letter-spacing:.06em}.live-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.live-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}.live-kpi{background:#fff;border:1px solid #e3e3e3;border-radius:16px;padding:16px}.live-kpi span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;font-weight:800}.live-kpi b{display:block;font-size:28px;margin-top:5px}.live-main{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start}.join-panel{background:#fff;border:1px solid #ddd;border-radius:20px;padding:18px;text-align:center;position:sticky;top:12px}.join-panel .code{font-size:44px}.join-panel .qr{max-width:245px}.leader-card{background:#fff;border:1px solid #ddd;border-radius:20px;overflow:hidden;min-width:0}.leader-head{padding:18px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.leader-head h2{margin:0}.leader-table{overflow:hidden;width:100%}.leader-table table{width:100%;min-width:0;table-layout:fixed}.leader-table th,.leader-table td{padding:10px 8px;overflow-wrap:anywhere}.leader-table th:nth-child(1),.leader-table td:nth-child(1){width:19%}.leader-table th:nth-child(2),.leader-table td:nth-child(2){width:16%}.leader-table th:nth-child(3),.leader-table td:nth-child(3){width:9%}.leader-table th:nth-child(4),.leader-table td:nth-child(4){width:11%}.leader-table th:nth-child(5),.leader-table td:nth-child(5){width:13%}.leader-table th:nth-child(6),.leader-table td:nth-child(6){width:11%}.leader-table th:nth-child(7),.leader-table td:nth-child(7){width:21%;text-align:center;padding-left:6px;padding-right:6px}.leader-table td:nth-child(7) .btn{display:block;width:100%;max-width:100%;padding:9px 6px;font-size:12px;white-space:normal;line-height:1.15;text-align:center;overflow-wrap:normal;word-break:normal}.leader-table tbody tr:hover{background:#fffafa}.leader-table th{background:#f7f7f7;font-size:11px}.open-state{color:#176b32}.closed-state{color:#9b1b1b}@media(max-width:1050px){.live-main{grid-template-columns:270px minmax(0,1fr)}.join-panel .qr{max-width:220px}.leader-table th,.leader-table td{padding:9px 6px;font-size:13px}.leader-table td:nth-child(7) .btn{font-size:11px;padding:8px 5px;white-space:normal}}@media(max-width:900px){.live-kpis{grid-template-columns:repeat(2,1fr)}.live-main{grid-template-columns:1fr}.join-panel{position:static}.live-banner h1{font-size:28px}.leader-table{overflow-x:auto}.leader-table table{min-width:760px;table-layout:auto}}@media(max-width:520px){.live-kpis{grid-template-columns:1fr 1fr}.live-actions .btn,.live-actions button{flex:1;text-align:center}.join-panel .code{font-size:38px}}
 </style>`;
 res.send(layout('Live Class', `<meta http-equiv="refresh" content="5"><div class="live-shell"><div class="live-banner"><div class="live-banner-top"><div><div class="eyebrow"><span class="live-dot"></span> LIVE CLASS CONTROL · VERSION 5.2</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · Instructor ${esc(c.instructor)}</p></div><span class="version-badge">${c.active?'● CLASS OPEN':'● CLASS CLOSED'}</span></div></div><div class="live-actions no-print"><a class="btn" style="background:#b40d14;color:#fff;border-color:#7f0a0f" href="/instructor/dashboard">← Instructor Command Center</a><a class="btn alt" href="/instructor/builder/${c.id}">Build Test / Hunt</a>${isCompanyAdminRole(req.account.role)?`<a class="btn light" href="/instructor/class/${c.id}/instructor">Assign Instructor</a>`:''}<a class="btn" href="/instructor/class/${c.id}/hunt-qr">Open Full QR Sheets</a><a class="btn" style="background:#171717;color:#fff;border-color:#000" href="/instructor/class/${c.id}/hunt-label-print">Generate T50M Labels</a><a class="btn" style="background:#b40d14;color:#fff;border-color:#7f0a0f" href="/instructor/class/${c.id}/prepost">Pre/Post Improvement</a><a class="btn" style="background:#b40d14;color:#fff;border-color:#7f0a0f" href="/instructor/class/${c.id}/feedback">Training Feedback</a></div><div class="live-kpis"><div class="live-kpi"><span>Students Joined</span><b>${students.rowCount}</b></div><div class="live-kpi"><span>Testing Now</span><b>${testing}</b></div><div class="live-kpi"><span>With Results</span><b>${completed}</b></div><div class="live-kpi"><span>Class Average</span><b>${completed?classAvg+'%':'—'}</b></div><div class="live-kpi"><span>Certificates Issued</span><b>${certs}</b></div></div><div class="live-main"><div class="join-panel"><div class="eyebrow">Student Join Code</div><div class="code">${esc(c.code)}</div><img class="qr" src="${qr}" alt="Student class QR code"><p class="muted small">Scan to join from any phone using Wi-Fi or cellular.</p><div style="margin:12px 0;padding:12px;border:1px solid #d8d8d8;border-radius:10px;background:#f7f7f7;word-break:break-all;text-align:left"><b style="color:#111">USING A COMPUTER?</b><br><span style="color:#111">Open this class join link:</span><br><a href="${esc(joinUrl)}" target="_blank">${esc(joinUrl)}</a></div><div class="success" style="margin:12px 0"><b>${c.active?'Class is open for students':'Class is currently closed'}</b></div><form class="no-print" method="post" action="/instructor/class/${c.id}/toggle"><button class="${c.active?'btn alt':'btn'}" style="width:100%">${c.active?'Close Class':'Reopen Class'}</button></form></div><div class="leader-card"><div class="leader-head"><div><div class="eyebrow">Live Activity</div><h2>Student Leaderboard</h2></div><span class="muted small">Auto-refreshes every 5 seconds · Live scores ${c.show_live_scores?'ON':'HIDDEN'}</span></div><div class="leader-table"><table><thead><tr><th>${esc(brand('student_label','Student'))}</th><th>Status</th><th>Progress</th><th>Live Score</th><th>Completed Avg.</th><th>Certificate</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Waiting for students to join...</td></tr>'}</tbody></table></div></div></div></div>`,liveCss));
});
app.get('/instructor/class/:id/instructor',auth,companyAdminOnly,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const users=(await pool.query(`SELECT id,name,email,role,active FROM app_users WHERE company_id=$1 AND role IN ('instructor','company_admin') ORDER BY active DESC,role,name`,[req.account.company_id])).rows;
 const options=users.map(u=>`<option value="${u.id}" ${Number(c.assigned_instructor_user_id)===Number(u.id)?'selected':''} ${u.active?'':'disabled'}>${esc(u.name)} · ${esc(roleLabel(u.role))}${u.active?'':' · Disabled'}</option>`).join('');
 res.send(layout('Assign Instructor',`<div class="toolbar"><a class="btn light" href="/instructor/class/${c.id}">← Live Class</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">CLASS ${esc(c.code)}</div><div class="big">Assign Instructor</div><p><b>${esc(c.course)}</b> · ${esc(c.title)}</p><div class="success"><b>Current Instructor:</b> ${esc(c.instructor||'Unassigned')}</div><form method="post" action="/instructor/class/${c.id}/instructor"><label>Assigned Instructor<select name="user_id" required><option value="">Choose instructor</option>${options}</select></label><button>Assign Instructor</button></form><p class="small muted">Changing the instructor keeps the same class code, enrolled students, quiz results, simulations, scavenger hunts, and class records.</p></div>`));
});
app.post('/instructor/class/:id/instructor',auth,companyAdminOnly,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const u=(await pool.query(`SELECT id,name,email,role,active FROM app_users WHERE id=$1 AND company_id=$2 AND role IN ('instructor','company_admin')`,[Number(req.body.user_id),req.account.company_id])).rows[0];
 if(!u||!u.active)return res.status(400).send(layout('Instructor Not Assigned',`<div class="card"><div class="big">Choose an active instructor</div><p>The selected account is unavailable or disabled.</p><a class="btn" href="/instructor/class/${c.id}/instructor">Back</a></div>`));
 await pool.query('UPDATE classes SET assigned_instructor_user_id=$1,instructor=$2 WHERE id=$3 AND company_id=$4',[u.id,u.name,c.id,req.account.company_id]);
 await auditEvent(req,'CLASS_INSTRUCTOR_ASSIGNED',`Class ${c.code} · ${u.name} · ${u.email}`,'ok');
 res.redirect(`/instructor/class/${c.id}`);
});

app.post('/instructor/class/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE classes SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/class/${req.params.id}`); });

app.get('/instructor/builder/:id',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const qs=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id]);
 const qcards=qs.rows.map((q,i)=>`<div class="q"><div class="section-title"><div><b>${i+1}. ${esc(q.question)}</b>${q.topic?`<div class="small"><span class="pill">${esc(q.topic)}</span></div>`:''}</div><div class="toolbar"><a class="btn light" href="/instructor/builder/${c.id}/question/${q.id}/edit">Edit</a><form method="post" action="/instructor/builder/${c.id}/question/${q.id}/delete" style="display:inline"><button class="danger" onclick="return confirm('Delete this question?')">Delete</button></form></div></div><div class="small muted" style="margin-top:6px">${(q.choices||[]).map((x,j)=>`${String.fromCharCode(65+j)}. ${esc(x)}${j===q.answer_index?' ✓':''}`).join(' · ')}</div>${q.explanation?`<p class="small"><b>Feedback:</b> ${esc(q.explanation)}</p>`:''}</div>`).join('');
 const addForm=`<details class="card" style="margin-top:16px"><summary class="big" style="cursor:pointer">+ Add New Question</summary><form method="post" action="/instructor/builder/${c.id}/question" style="margin-top:14px"><label>Topic / Module<input name="topic"></label><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3"></textarea></label><button>Add Question</button></form></details>`;
 res.send(layout('Pre/Post Test Builder', `<div class="toolbar"><a class="btn light" href="/instructor/build-select">← Back to Tests</a><a class="btn light" href="/instructor/hunt/${c.id}">Open Scavenger Hunt</a></div><div class="card"><div class="eyebrow">${esc(c.course)}</div><div class="big">Editable Pre/Post Test Bank</div><p><b>${qs.rowCount}</b> saved question${qs.rowCount===1?'':'s'}. Edit this one bank for both tests. Each student's Pre-Test locks its question set; the Post-Test uses those same questions in a different order.</p><div class="success"><b>Matched testing:</b> Pre and Post use identical questions for that student. Only the question order changes.</div>${qcards||'<div class="alert">No questions saved yet.</div>'}</div>${addForm}`));
});
app.get('/instructor/builder/:id/question/:qid/edit',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const q=(await pool.query('SELECT * FROM quiz_questions WHERE id=$1 AND class_id=$2',[req.params.qid,c.id])).rows[0]; if(!q)return res.status(404).send('Question not found'); const choices=Array.isArray(q.choices)?q.choices:[];
 res.send(layout('Edit Question',`<div class="toolbar"><a class="btn light" href="/instructor/builder/${c.id}">← Back to Test Builder</a></div><div class="card"><div class="big">Edit Quiz Question</div><form method="post" action="/instructor/builder/${c.id}/question/${q.id}/edit"><label>Topic / Module<input name="topic" value="${esc(q.topic||'')}"></label><label>Question<textarea name="question" required>${esc(q.question)}</textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" value="${esc(choices[i]||'')}" required></label>`).join('')}<label>Correct Answer<select name="answer">${['A','B','C','D'].map((x,i)=>`<option value="${i}" ${Number(q.answer_index)===i?'selected':''}>${x}</option>`).join('')}</select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3">${esc(q.explanation||'')}</textarea></label><button>Save Question</button></form></div>`));
});
app.post('/instructor/builder/:id/question/:qid/edit',auth,async(req,res)=>{
 const c=(await pool.query('SELECT id FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 await pool.query('UPDATE quiz_questions SET question=$3,choices=$4,answer_index=$5,explanation=$6,topic=$7 WHERE id=$1 AND class_id=$2',[req.params.qid,c.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer),req.body.explanation||'',req.body.topic||'']); res.redirect(`/instructor/builder/${c.id}`);
});
app.post('/instructor/builder/:id/question',auth,async(req,res)=>{ await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer),req.body.explanation||'',req.body.topic||'']); res.redirect(`/instructor/builder/${req.params.id}`); });
app.post('/instructor/builder/:id/station',auth,async(req,res)=>{ await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[req.params.id,req.body.name,req.body.task,req.body.expected]); res.redirect(`/instructor/builder/${req.params.id}`); });
app.post('/instructor/builder/:id/question/:qid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM quiz_questions WHERE id=$1 AND class_id=$2',[req.params.qid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}`); });
app.post('/instructor/builder/:id/station/:sid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}`); });

app.get('/instructor/class/:id/hunt-qr',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 let hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before QR sheets can be printed. ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`));
 const origin=`${req.protocol}://${req.get('host')}`; const cards=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:320,margin:1}); cards.push(`<div class="card center hunt-qr-card" style="break-inside:avoid"><div class="eyebrow">Scavenger Hunt Station ${i+1}</div><h2>${esc(h.station_name)}</h2><div class="scan-heading">SCAN FROM INSIDE THE TRAINING HUB</div><img class="qr" src="${qr}" alt="QR code for ${esc(h.station_name)}"><div class="scan-steps"><b>Before you scan:</b> Join the class on this phone first.<br><b>1.</b> Open the Scavenger Hunt on your phone.<br><b>2.</b> Tap <b>Scan QR</b> beside the item you are hunting for.<br><b>3.</b> Point the Training Hub camera scanner at this QR code.</div><div style="margin:14px 0;padding:12px;border:1px solid #d8d8d8;border-radius:10px;background:#f7f7f7;word-break:break-all"><b>USING A COMPUTER?</b><br>Open this station link:<br><a href="${esc(url)}" target="_blank">${esc(url)}</a></div><p class="station-task"><b>Your task:</b> ${esc(h.task)}</p><p class="small muted">Class ${esc(c.code)} · ${esc(c.course)}</p></div>`)}
 res.send(layout('Scavenger Hunt QR Codes', `<div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button><a class="btn light" href="/instructor/class/${c.id}">Back to Class</a></div><div class="center"><h1>${esc(c.course)} — Scavenger Hunt QR Codes</h1><p>Print these and place each code at the matching equipment/component station.</p></div><div class="grid">${cards.join('')}</div>`, `<style>.scan-heading{font-weight:900;font-size:18px;letter-spacing:.04em;margin:10px 0 4px}.scan-steps{text-align:left;max-width:420px;margin:10px auto 14px;padding:12px 14px;border:1px solid #d8d8d8;border-radius:10px;line-height:1.6;background:#fafafa}.station-task{text-align:left;max-width:420px;margin:10px auto;line-height:1.45}@media print{.grid{grid-template-columns:1fr 1fr}.card{border:1px solid #999!important;padding:14px!important}.qr{max-width:220px}.scan-heading{font-size:16px}.scan-steps{font-size:12px;line-height:1.45;padding:8px 10px}.station-task{font-size:12px}}</style>`));
});


app.get('/instructor/class/:id/hunt-label-print',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 res.send(layout('Generate T50M Labels', `<div class="toolbar"><a class="btn light" href="/instructor/hunt/${c.id}">← Back to Scavenger Hunt</a><a class="btn light" href="/instructor/class/${c.id}">Class Dashboard</a></div><div class="card" style="max-width:720px;margin:0 auto"><div class="eyebrow">SCAVENGER HUNT</div><div class="big">Generate T50M Label Files</div><p>Choose the label size loaded in your T50M Pro. The Training Hub will generate label files with the station description included, ready to import into SUPVAN Editor. This uses only the QR system already built into the Training Hub and does not depend on Chrome printing.</p><form method="get" action="/instructor/class/${c.id}/hunt-label-files"><label>Label Size<select name="size" required><option value="" selected disabled>— Select Label Size —</option><option value="30x30">30 × 30 mm</option><option value="40x30">40 × 30 mm</option><option value="50x30">50 × 30 mm</option><option value="50x40">50 × 40 mm</option><option value="60x40">60 × 40 mm</option><option value="40x60">40 × 60 mm</option><option value="50x80">50 × 80 mm</option><option value="50">Standard T50M / 50 mm</option></select></label><button type="submit" style="width:100%;margin-top:12px">Generate Label Files</button></form><div class="alert" style="margin-top:14px"><b>SUPVAN Editor workflow:</b> Generate the label files here, download each PNG label, import it into SUPVAN Editor, set your physical label size, and print from SUPVAN Editor.</div></div>`));
});

app.get('/instructor/class/:id/hunt-label-files',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const size=String(req.query.size||''); if(!LABEL_SPECS[size])return res.status(400).send('Choose a valid label size.'); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]); const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5)); const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before QR label files can be generated.</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`)); const pin=''; const cards=hs.rows.map((h,i)=>{const item=esc((h.item_label||h.station_name||`Station ${i+1}`).replace(/^.*?—\s*/,'')); return `<div class="card"><div class="eyebrow">STATION ${i+1}</div><div class="big" style="font-size:20px">${item}</div><p class="muted">${esc(h.tractor_model||brand('equipment_label','Equipment'))} · Equipment ${esc(h.tractor_no||'')}</p><a class="btn" href="/instructor/class/${c.id}/hunt-label-png/${h.id}?size=${encodeURIComponent(size)}">Download PNG Label</a><div class="small muted" style="margin-top:8px">This downloads a PNG label with the item name and description already on it. Import that PNG into SUPVAN Editor.</div></div>`}).join(''); res.send(layout('Generated T50M Label Files', `<div class="toolbar"><a class="btn light" href="/instructor/class/${c.id}/hunt-label-print">← Change Label Size</a></div><div class="card"><div class="big">${esc(LABEL_SPECS[size].label)} QR Files</div><p>${hs.rowCount} station PNG label file${hs.rowCount===1?'':'s'} ready. These use the QR generator already built into Training Hub—no Sharp, no ZIP module, and no browser printing. Download each PNG label and import it into SUPVAN Editor.</p><div class="alert"><b>Important:</b> The selected size controls the label layout. Set the same physical label size inside SUPVAN Editor before printing.</div></div><div class="grid">${cards}</div>`)); });

app.get('/instructor/class/:id/hunt-label-one/:sid',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const size=String(req.query.size||'40x30'),spec=resolveLabelSpec(size,req.query.w,req.query.h); if(!spec)return res.status(400).send('Invalid label size.');
 const h=(await pool.query('SELECT * FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,c.id])).rows[0]; if(!h)return res.status(404).send('Station not found');
 const rows=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id])).rows; const index=Math.max(0,rows.findIndex(x=>Number(x.id)===Number(h.id)));
 const origin=`${req.protocol}://${req.get('host')}`,url=`${origin}/hunt-station/${c.id}/${h.id}`; const qr=await QRCode.toDataURL(url,{type:'image/png',width:1000,margin:2,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#FFFFFF'}});
 const itemText=String((h.item_label||h.station_name||`Station ${index+1}`)).replace(/^.*?—\s*/,'').trim(); const model=String(h.tractor_model||brand('equipment_label','Equipment')); const equipment=String(h.tractor_no||'');
 const landscape=spec.mmW>spec.mmH; const qrMm=Math.max(16,Math.min(spec.mmH-(landscape?6:14), landscape?spec.mmW*.42:spec.mmW*.68));
 const labelHtml=landscape?`<div class="label landscape"><div class="info"><div class="model">${esc(model)}</div><div class="item">${esc(itemText)}</div><div class="meta">Equipment ${esc(equipment)} · Station ${index+1}</div></div><div class="qrbox"><img src="${qr}" alt="QR"><div>SCAN QR</div></div></div>`:`<div class="label portrait"><div class="model">${esc(model)}</div><div class="item">${esc(itemText)}</div><img class="qrsquare" src="${qr}" alt="QR"><div class="meta">Equipment ${esc(equipment)} · Station ${index+1}</div></div>`;
 const previewScale=Math.max(2.2,Math.min(4.4,520/(spec.mmW*3.7795275591)));
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Print ${esc(itemText)}</title><style>
 @page{size:${spec.mmW}mm ${spec.mmH}mm;margin:0}
 *{box-sizing:border-box}html,body{margin:0;padding:0;background:#ececec;font-family:Arial,sans-serif;color:#111}
 .controls{padding:14px 18px;background:#fff;border-bottom:1px solid #ccc;position:sticky;top:0;z-index:10}
 .controls button,.controls a{display:inline-block;padding:10px 14px;margin:0 8px 6px 0;border:0;border-radius:8px;background:#c4141c;color:#fff;text-decoration:none;font-weight:800;cursor:pointer}
 .controls .note{display:inline-block;margin:6px 0 0 4px;font-size:13px;color:#444}.controls .note b{color:#000}
 .preview-stage{display:flex;justify-content:center;align-items:flex-start;padding:34px 20px 50px;min-height:calc(100vh - 90px)}
 .preview-frame{background:#d9d9d9;border:1px solid #bbb;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.12)}
 .sheet{width:${spec.mmW}mm;height:${spec.mmH}mm;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.25);zoom:${previewScale.toFixed(3)}}
 .label{width:${spec.mmW}mm;height:${spec.mmH}mm;padding:1.6mm;color:#000;background:#fff;overflow:hidden;border:.25mm solid #ddd}
 .landscape{display:flex;align-items:center;justify-content:space-between;gap:1.2mm}.info{flex:1;min-width:0}
 .model{font-weight:900;font-size:${Math.max(8,Math.min(13,spec.mmH*.34))}pt;line-height:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .item{font-weight:900;font-size:${Math.max(7,Math.min(11,spec.mmH*.26))}pt;line-height:1.02;margin-top:.8mm;overflow-wrap:normal;word-break:normal;hyphens:none;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
 .meta{font-weight:700;font-size:${Math.max(5.5,Math.min(7.5,spec.mmH*.16))}pt;line-height:1.05;margin-top:.8mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .qrbox{width:${qrMm}mm;text-align:center;font-weight:900;font-size:5.5pt;line-height:1;flex:0 0 auto}.qrbox img,.qrsquare{width:${qrMm}mm;height:${qrMm}mm;display:block;margin:0 auto}.qrbox div{margin-top:.5mm}
 .portrait{text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:space-between}.portrait .model{font-size:${Math.max(7.5,Math.min(11,spec.mmW*.24))}pt;max-width:100%}.portrait .item{font-size:${Math.max(6.5,Math.min(9.5,spec.mmW*.19))}pt;margin-top:.4mm;max-width:100%;-webkit-line-clamp:2}.portrait .meta{font-size:${Math.max(5,Math.min(7,spec.mmW*.13))}pt}
 @media print{html,body{width:${spec.mmW}mm!important;height:${spec.mmH}mm!important;background:#fff!important;overflow:hidden!important}.controls{display:none!important}.preview-stage{display:block!important;padding:0!important;min-height:0!important}.preview-frame{padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important}.sheet{zoom:1!important;margin:0!important;width:${spec.mmW}mm!important;height:${spec.mmH}mm!important;box-shadow:none!important}.label{border:0!important;width:${spec.mmW}mm!important;height:${spec.mmH}mm!important;page-break-inside:avoid!important;break-inside:avoid!important}}
 </style></head><body><div class="controls"><button onclick="window.print()">🖨️ Print This One Label</button><a href="/instructor/qr-labels?size=${encodeURIComponent(size)}&w=${encodeURIComponent(spec.mmW)}&h=${encodeURIComponent(spec.mmH)}">Back to QR Label Center</a><span>Selected size: <b>${esc(spec.label)}</b></span><div class="note">Preview is enlarged only so you can read it. The print job remains exactly <b>${spec.mmW} × ${spec.mmH} mm</b>. In the printer dialog choose the same paper/label size and set scale to <b>100%</b>.</div></div><div class="preview-stage"><div class="preview-frame"><div class="sheet">${labelHtml}</div></div></div><script>setTimeout(()=>{document.title='${esc(itemText).replace(/'/g,"\\'")} · ${spec.mmW}x${spec.mmH}mm'},100)</script></body></html>`;
 res.setHeader('Cache-Control','no-store'); res.send(html);
});

app.get('/instructor/class/:id/hunt-label-png/:sid',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const size=String(req.query.size||''); const spec=resolveLabelSpec(size,req.query.w,req.query.h); if(!spec)return res.status(400).send('Invalid label size.'); const h=(await pool.query('SELECT * FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,c.id])).rows[0]; if(!h)return res.status(404).send('Station not found'); const rows=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id])).rows; const index=Math.max(0,rows.findIndex(x=>Number(x.id)===Number(h.id))); const origin=`${req.protocol}://${req.get('host')}`,url=`${origin}/hunt-station/${c.id}/${h.id}`; const qrDataUrl=await QRCode.toDataURL(url,{type:'image/png',width:spec.qr,margin:2,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#FFFFFF'}}); const itemText=String((h.item_label||h.station_name||`Station ${index+1}`)).replace(/^.*?—\s*/,'').trim(); const descSource=String(h.task||h.expected||'Scan this station in the Training Hub.').replace(/\s+/g,' ').trim(); const descLimit=spec.landscape?Math.max(42,Math.round(spec.mmW*1.8)):Math.max(36,Math.round(spec.mmH*1.6)); const desc=trimLabelText(descSource,descLimit); const nameLines=wrapLabelText(itemText,spec.nameChars).slice(0,spec.nameLines); const descLines=wrapLabelText(desc,spec.descChars).slice(0,spec.descLines); const tractorLine=(h.tractor_model?`${h.tractor_model} · `:'')+`Equipment ${h.tractor_no||''}`; const stationNo=`STATION ${index+1}`; const qrBox=spec.landscape?Math.min(Math.round(spec.canvasH*.70),Math.round(spec.canvasW*.46)):Math.min(Math.round(spec.canvasW*.62),Math.round(spec.canvasH*.46)); const layoutData={w:spec.canvasW,h:spec.canvasH,qrBox,stationNo,tractorLine,nameLines,descLines,classLine:`Class ${c.code}`,qrDataUrl,sizeLabel:spec.label,landscape:!!spec.landscape}; const filename=`station_${String(index+1).padStart(2,'0')}_${safeFile(itemText||`station_${index+1}`)}_${safeFile(size)}_LABEL.png`; res.send(layout('Download PNG Label', `<div class="card" style="max-width:860px;margin:0 auto"><div class="eyebrow">T50M LABEL FILE</div><div class="big">PNG Label Generator</div><p>This page creates a <b>PNG label file</b> with the station description included. It should start downloading automatically. If it does not, use the <b>Download PNG Now</b> button.</p><div class="toolbar no-print"><a class="btn light" href="/instructor/qr-labels?size=${encodeURIComponent(size)}&w=${encodeURIComponent(spec.mmW)}&h=${encodeURIComponent(spec.mmH)}">← Back to Label Files</a><button id="downloadBtn" type="button">Download PNG Now</button></div><div class="center"><canvas id="labelCanvas" style="max-width:100%;border:1px solid #ccc;background:#fff"></canvas></div><div class="alert" style="margin-top:12px"><b>Backup option:</b> You can still import this PNG into your label-printer software if direct browser printing is unavailable.</div></div><script>
const labelData=${JSON.stringify(layoutData)};
const filename=${JSON.stringify(filename)};
function drawWrappedCentered(ctx, lines, x, y, lineHeight, font){ ctx.font=font; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; lines.forEach((line,i)=>ctx.fillText(line.toUpperCase(), x, y + i*lineHeight)); }
function drawWrappedLeft(ctx, lines, x, y, lineHeight, font){ ctx.font=font; ctx.textAlign='left'; ctx.textBaseline='alphabetic'; lines.forEach((line,i)=>ctx.fillText(line, x, y + i*lineHeight)); }
function downloadCanvas(canvas){ const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=filename; document.body.appendChild(a); a.click(); a.remove(); }
(function(){
 const c=document.getElementById('labelCanvas');
 const ctx=c.getContext('2d');
 c.width=labelData.w; c.height=labelData.h;
 const img=new Image();
 img.onload=()=>{
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle='#000000'; ctx.lineWidth=2; ctx.strokeRect(1,1,c.width-2,c.height-2);
  ctx.fillStyle='#000000';
  if(labelData.landscape){
   const leftW=300;
   ctx.font='800 24px Arial'; ctx.textAlign='left'; ctx.fillText(labelData.stationNo,24,44);
   ctx.font='700 19px Arial'; ctx.fillText(labelData.tractorLine,24,78);
   drawWrappedLeft(ctx,labelData.nameLines,24,132,42,'900 34px Arial');
   const taskY=132 + Math.max(1,labelData.nameLines.length)*42 + 28;
   drawWrappedLeft(ctx,labelData.descLines,24,taskY,30,'600 23px Arial');
   ctx.font='800 22px Arial'; ctx.fillText(labelData.classLine,24,c.height-32);
   const qrX=c.width-labelData.qrBox-34;
   const qrY=Math.round((c.height-labelData.qrBox)/2)-8;
   ctx.lineWidth=3; ctx.strokeRect(qrX-10,qrY-10,labelData.qrBox+20,labelData.qrBox+20);
   ctx.drawImage(img,qrX,qrY,labelData.qrBox,labelData.qrBox);
   ctx.font='900 24px Arial'; ctx.textAlign='center'; ctx.fillText('SCAN QR',qrX+labelData.qrBox/2,qrY+labelData.qrBox+34);
  }else{
   ctx.font='700 15px Arial'; ctx.textAlign='left'; ctx.fillText(labelData.stationNo,18,24);
   ctx.font='700 12px Arial'; ctx.textAlign='right'; ctx.fillText(labelData.tractorLine,c.width-18,24);
   drawWrappedCentered(ctx,labelData.nameLines,c.width/2,46,24,'800 22px Arial');
   const qrX=(c.width-labelData.qrBox)/2;
   const qrY=labelData.sizeLabel.includes('50 × 80')?112:labelData.sizeLabel.includes('40 × 60')?98:labelData.sizeLabel.includes('30 mm')?96:104;
   ctx.lineWidth=1.5; ctx.strokeRect(qrX-8,qrY-8,labelData.qrBox+16,labelData.qrBox+16);
   ctx.drawImage(img,qrX,qrY,labelData.qrBox,labelData.qrBox);
   const scanY=qrY+labelData.qrBox+26;
   ctx.font='800 18px Arial'; ctx.textAlign='center'; ctx.fillText('SCAN QR',c.width/2,scanY);
   drawWrappedLeft(ctx,labelData.descLines,18,scanY+26,18,'500 14px Arial');
   ctx.font='700 11px Arial'; ctx.textAlign='left'; ctx.fillText(labelData.classLine,18,c.height-18);
  }
  setTimeout(()=>downloadCanvas(c),250);
 };
 img.src=labelData.qrDataUrl;
 document.getElementById('downloadBtn').addEventListener('click',()=>downloadCanvas(c));
})();
</script>`)); });

app.get('/instructor/class/:id/hunt-qr-t50m',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
 const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before T50M Pro labels can be printed. ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`));
 const origin=`${req.protocol}://${req.get('host')}`; const labels=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:520,margin:4,color:{dark:'#000000',light:'#FFFFFF'}}); const tractorLine=h.tractor_model?`Equipment ${h.tractor_no} · ${h.tractor_model}`:`Equipment ${h.tractor_no}`; labels.push(`<section class="t50-label"><div class="t50-head"><div class="t50-station">STATION ${i+1}</div><div class="t50-tractor">${esc(tractorLine)}</div></div><div class="t50-name">${esc(h.station_name)}</div><div class="t50-qr-box"><img class="t50-qr" src="${qr}" alt="QR code for ${esc(h.station_name)}"></div><div class="t50-scan">SCAN QR</div><div class="t50-task">${esc(h.task)}</div><div class="t50-class">Class ${esc(c.code)} · ${esc(c.course)}</div><div class="t50-note">Best for KATASYMBOL / SUPVAN T50M Pro thermal label printing.</div><div class="t50-url">${esc(url)}</div></section>`)}
 res.send(layout('T50M Pro QR Labels', `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));</script><div class="no-print toolbar"><button onclick="window.print()">Print Again</button><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-50x80">Open 50 × 80 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-40x60">Open 40 × 60 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-30">Open 30 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr">Open Standard QR Sheets</a><a class="btn light" href="/instructor/class/${c.id}">Back to Class</a></div><div class="card no-print"><div class="big">T50M Pro Printer-Friendly Labels</div><p>Use this view when printing scavenger hunt QR labels on your KATASYMBOL / SUPVAN T50M Pro. The layout is high-contrast black-and-white with one large QR code per label and minimal shading for reliable thermal printing.</p><ul><li>Recommended label width: <b>50 mm</b></li><li>Recommended print setting: <b>Actual Size / 100%</b></li><li>Print one station per label</li><li>Test-scan the first label before printing the full set</li></ul></div><div class="t50-grid">${labels.join('')}</div>`, `<style>
  .t50-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
  .t50-label{background:#fff!important;color:#000!important;border:2px solid #000;border-radius:0;padding:12px;break-inside:avoid;page-break-inside:avoid;box-shadow:none;text-align:center}
  .t50-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px;font-size:11px;font-weight:900;letter-spacing:.03em}
  .t50-station,.t50-tractor,.t50-name,.t50-scan,.t50-task,.t50-class,.t50-note,.t50-url{color:#000!important}
  .t50-name{font-size:17px;line-height:1.15;font-weight:900;text-transform:uppercase;margin:4px 0 10px}
  .t50-qr-box{display:flex;justify-content:center;align-items:center;background:#fff;padding:4px;border:1px solid #000}
  .t50-qr{width:220px;height:220px;max-width:100%;image-rendering:pixelated}
  .t50-scan{font-size:16px;font-weight:900;letter-spacing:.08em;margin:8px 0 4px}
  .t50-task{font-size:11px;line-height:1.3;margin:4px 0 6px;text-align:left}
  .t50-class{font-size:11px;font-weight:800;margin-top:4px}
  .t50-note{font-size:10px;margin-top:2px}
  .t50-url{font-size:9px;line-height:1.15;word-break:break-all;margin-top:6px}
  @page{size:50mm auto;margin:4mm}
  @media print{
   body{background:#fff!important;color:#000!important}
   .no-print{display:none!important}
   .t50-grid{display:block}
   .t50-label{width:42mm;min-height:60mm;margin:0 auto 4mm auto;padding:3mm;border:1.5pt solid #000;page-break-after:always}
   .t50-head{font-size:7pt;margin-bottom:1mm}
   .t50-name{font-size:11pt;margin:1mm 0 2mm}
   .t50-qr-box{padding:1mm;border:1pt solid #000}
   .t50-qr{width:31mm;height:31mm}
   .t50-scan{font-size:8.5pt;margin:1mm 0 .5mm}
   .t50-task{font-size:6.8pt;line-height:1.2;margin:.8mm 0;text-align:left}
   .t50-class{font-size:7pt}
   .t50-note{font-size:6pt}
   .t50-url{font-size:5.2pt;line-height:1.1;margin-top:1mm}
  }
 </style>`));
});


app.get('/instructor/class/:id/hunt-qr-t50m-50x80',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
 const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before 50 × 80 mm labels can be printed. ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`));
 const origin=`${req.protocol}://${req.get('host')}`; const labels=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:620,margin:4,color:{dark:'#000000',light:'#FFFFFF'}}); const item=(h.item_label||h.station_name||`Station ${i+1}`).replace(/^.*?—\s*/,'').trim(); const tractorLine=h.tractor_model?`Equipment ${h.tractor_no} · ${h.tractor_model}`:`Equipment ${h.tractor_no}`; labels.push(`<section class="t5080-label"><div class="t5080-top"><div class="t5080-station">STATION ${i+1}</div><div class="t5080-tractor">${esc(tractorLine)}</div></div><div class="t5080-name">${esc(item)}</div><div class="t5080-qrbox"><img class="t5080-qr" src="${qr}" alt="QR code for ${esc(item)}"></div><div class="t5080-scan">SCAN QR</div><div class="t5080-task">${esc(h.task)}</div><div class="t5080-class">Class ${esc(c.code)} · ${esc(c.course)}</div></section>`)}
 res.send(layout('T50M Pro 50 × 80 mm QR Labels', `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));</script><div class="no-print toolbar"><button onclick="window.print()">Print Again</button><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m">Open 50 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-40x60">Open 40 × 60 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-30">Open 30 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}">Back to Class</a></div><div class="card no-print"><div class="big">T50M Pro — 50 × 80 mm QR Labels</div><p>This layout is designed for 50 × 80 mm label stock. It gives you a large QR code plus enough room for the station name and a short task reminder.</p><ul><li>Label size: <b>50 × 80 mm</b></li><li>QR target: approximately <b>34–36 mm square</b></li><li>Print at <b>Actual Size / 100%</b></li><li>Use one label per station</li><li>Test-scan the first printed label before printing the full set</li></ul></div><div class="t5080-grid">${labels.join('')}</div>`, `<style>
  .t5080-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
  .t5080-label{background:#fff!important;color:#000!important;border:2px solid #000;padding:12px;text-align:center;break-inside:avoid;page-break-inside:avoid;box-shadow:none}
  .t5080-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px;font-size:11px;font-weight:900;letter-spacing:.03em}
  .t5080-station,.t5080-tractor,.t5080-name,.t5080-scan,.t5080-task,.t5080-class{color:#000!important}
  .t5080-name{font-size:16px;line-height:1.08;font-weight:900;text-transform:uppercase;margin:2px 0 8px;overflow-wrap:anywhere}
  .t5080-qrbox{display:flex;justify-content:center;background:#fff;padding:4px;border:1px solid #000}
  .t5080-qr{width:220px;height:220px;max-width:100%;image-rendering:pixelated}
  .t5080-scan{font-size:15px;font-weight:900;letter-spacing:.08em;margin:6px 0 4px}
  .t5080-task{font-size:11px;line-height:1.25;margin:4px 0 6px;text-align:left}
  .t5080-class{font-size:10px;font-weight:800;margin-top:2px}
  @page{size:50mm 80mm;margin:3mm}
  @media print{
   body{background:#fff!important;color:#000!important}
   .no-print{display:none!important}
   .t5080-grid{display:block}
   .t5080-label{width:44mm;min-height:72mm;margin:0 auto 3mm;padding:2.5mm;border:1.25pt solid #000;page-break-after:always}
   .t5080-top{font-size:6.8pt;margin-bottom:.8mm}
   .t5080-name{font-size:10pt;line-height:1.02;margin:.5mm 0 1.2mm}
   .t5080-qrbox{padding:.8mm;border:1pt solid #000}
   .t5080-qr{width:35mm;height:35mm}
   .t5080-scan{font-size:8pt;margin:1mm 0 .6mm}
   .t5080-task{font-size:6.8pt;line-height:1.18;margin:.6mm 0;text-align:left}
   .t5080-class{font-size:6.2pt;margin-top:.6mm}
  }
 </style>`));
});


app.get('/instructor/class/:id/hunt-qr-t50m-40x60',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
 const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before 40 × 60 mm labels can be printed. ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`));
 const origin=`${req.protocol}://${req.get('host')}`; const labels=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:580,margin:4,color:{dark:'#000000',light:'#FFFFFF'}}); const item=(h.item_label||h.station_name||`Station ${i+1}`).replace(/^.*?—\s*/,'').trim(); const tractorLine=h.tractor_model?`T${h.tractor_no} · ${h.tractor_model}`:`Equipment ${h.tractor_no}`; labels.push(`<section class="t4060-label"><div class="t4060-top"><div class="t4060-station">STATION ${i+1}</div><div class="t4060-tractor">${esc(tractorLine)}</div></div><div class="t4060-name">${esc(item)}</div><div class="t4060-qrbox"><img class="t4060-qr" src="${qr}" alt="QR code for ${esc(item)}"></div><div class="t4060-scan">SCAN QR</div><div class="t4060-task">${esc(h.task)}</div><div class="t4060-class">Class ${esc(c.code)}</div></section>`)}
 res.send(layout('T50M Pro 40 × 60 mm QR Labels', `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));</script><div class="no-print toolbar"><button onclick="window.print()">Print Again</button><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-50x80">Open 50 × 80 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-30">Open 30 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}">Back to Class</a></div><div class="card no-print"><div class="big">T50M Pro — 40 × 60 mm QR Labels</div><p>This layout is designed for 40 × 60 mm label stock. It keeps a large QR code while still showing the station name and a short task reminder.</p><ul><li>Label size: <b>40 × 60 mm</b></li><li>QR target: approximately <b>28–30 mm square</b></li><li>Print at <b>Actual Size / 100%</b></li><li>Use one label per station</li><li>Test-scan the first label before printing the full set</li></ul></div><div class="t4060-grid">${labels.join('')}</div>`, `<style>
  .t4060-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
  .t4060-label{background:#fff!important;color:#000!important;border:2px solid #000;padding:10px;text-align:center;break-inside:avoid;page-break-inside:avoid;box-shadow:none}
  .t4060-top{display:flex;justify-content:space-between;gap:6px;align-items:flex-start;margin-bottom:5px;font-size:10px;font-weight:900;letter-spacing:.03em}
  .t4060-station,.t4060-tractor,.t4060-name,.t4060-scan,.t4060-task,.t4060-class{color:#000!important}
  .t4060-name{font-size:15px;line-height:1.06;font-weight:900;text-transform:uppercase;margin:2px 0 6px;overflow-wrap:anywhere}
  .t4060-qrbox{display:flex;justify-content:center;background:#fff;padding:3px;border:1px solid #000}
  .t4060-qr{width:190px;height:190px;max-width:100%;image-rendering:pixelated}
  .t4060-scan{font-size:13px;font-weight:900;letter-spacing:.08em;margin:5px 0 3px}
  .t4060-task{font-size:10px;line-height:1.2;margin:3px 0 4px;text-align:left}
  .t4060-class{font-size:9px;font-weight:800;margin-top:2px}
  @page{size:40mm 60mm;margin:2.5mm}
  @media print{
   body{background:#fff!important;color:#000!important}
   .no-print{display:none!important}
   .t4060-grid{display:block}
   .t4060-label{width:35mm;min-height:55mm;margin:0 auto 2.5mm;padding:2mm;border:1.25pt solid #000;page-break-after:always}
   .t4060-top{font-size:6pt;margin-bottom:.6mm}
   .t4060-name{font-size:8.5pt;line-height:1.02;margin:.4mm 0 1mm}
   .t4060-qrbox{padding:.6mm;border:1pt solid #000}
   .t4060-qr{width:29mm;height:29mm}
   .t4060-scan{font-size:7.2pt;margin:.7mm 0 .4mm}
   .t4060-task{font-size:5.9pt;line-height:1.15;margin:.4mm 0;text-align:left}
   .t4060-class{font-size:5.5pt;margin-top:.4mm}
  }
 </style>`));
});

app.get('/instructor/class/:id/hunt-qr-t50m-30',auth,async(req,res)=>{ const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c)return res.status(404).send('Class not found'); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
 const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every equipment/station must have exactly ${target} hunt items before 30 mm labels can be printed. ${counts.map((n,i)=>`Equipment ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}">Back to Scavenger Hunt</a></div>`));
 const origin=`${req.protocol}://${req.get('host')}`; const labels=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:520,margin:4,color:{dark:'#000000',light:'#FFFFFF'}}); const item=(h.item_label||h.station_name||`Station ${i+1}`).replace(/^.*?—\s*/,'').trim(); labels.push(`<section class="t30-label"><div class="t30-station">STATION ${i+1}</div><div class="t30-name">${esc(item)}</div><div class="t30-qrbox"><img class="t30-qr" src="${qr}" alt="QR code for ${esc(item)}"></div><div class="t30-scan">SCAN QR</div><div class="t30-class">Class ${esc(c.code)} · T${esc(h.tractor_no||'')}</div></section>`)}
 res.send(layout('T50M Pro 30 mm QR Labels', `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));</script><div class="no-print toolbar"><button onclick="window.print()">Print Again</button><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m">Open 50 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-50x80">Open 50 × 80 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}/hunt-qr-t50m-40x60">Open 40 × 60 mm Labels</a><a class="btn light" href="/instructor/class/${c.id}">Back to Class</a></div><div class="card no-print"><div class="big">T50M Pro — 30 mm Compact QR Labels</div><p>This compact view is designed for 30 mm label stock. It removes the task paragraph and long URL so the QR code can stay large enough to scan reliably.</p><ul><li>Label width: <b>30 mm</b></li><li>QR target: approximately <b>22–24 mm square</b></li><li>Print at <b>Actual Size / 100%</b></li><li>Use one label per station</li><li>Test-scan the first printed label before printing the rest</li></ul></div><div class="t30-grid">${labels.join('')}</div>`, `<style>
  .t30-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
  .t30-label{background:#fff!important;color:#000!important;border:2px solid #000;padding:8px;text-align:center;break-inside:avoid;page-break-inside:avoid;box-shadow:none}
  .t30-station,.t30-name,.t30-scan,.t30-class{color:#000!important}
  .t30-station{font-size:11px;font-weight:900;letter-spacing:.05em}
  .t30-name{font-size:13px;line-height:1.05;font-weight:900;text-transform:uppercase;margin:4px 0 6px;overflow-wrap:anywhere}
  .t30-qrbox{display:flex;justify-content:center;background:#fff;padding:3px}
  .t30-qr{width:170px;height:170px;max-width:100%;image-rendering:pixelated}
  .t30-scan{font-size:12px;font-weight:900;letter-spacing:.08em;margin-top:4px}
  .t30-class{font-size:9px;font-weight:700;margin-top:2px}
  @page{size:30mm auto;margin:2mm}
  @media print{
   body{background:#fff!important;color:#000!important}
   .no-print{display:none!important}
   .t30-grid{display:block}
   .t30-label{width:26mm;min-height:37mm;margin:0 auto 2mm;padding:1.5mm;border:1.25pt solid #000;page-break-after:always}
   .t30-station{font-size:6.5pt}
   .t30-name{font-size:7.6pt;line-height:1.02;margin:.7mm 0 1mm}
   .t30-qrbox{padding:.5mm}
   .t30-qr{width:22.5mm;height:22.5mm}
   .t30-scan{font-size:7pt;margin-top:.6mm}
   .t30-class{font-size:5.5pt;margin-top:.4mm}
  }
 </style>`));
});


// ========================= PERFORMANCE & FEEDBACK ANALYTICS =========================
app.get('/instructor/performance',auth,async(req,res)=>{
 const companyId=req.account.company_id;
 const instructor=String(req.query.instructor||'').trim(), course=String(req.query.course||'').trim();
 const from=String(req.query.from||'').trim(), to=String(req.query.to||'').trim();
 const params=[companyId]; let where='c.company_id=$1';
 if(instructor){params.push(instructor);where+=` AND c.instructor=$${params.length}`;}
 if(course){params.push(course);where+=` AND c.course=$${params.length}`;}
 if(from){params.push(from);where+=` AND c.created_at >= $${params.length}::date`;}
 if(to){params.push(to);where+=` AND c.created_at < ($${params.length}::date + interval '1 day')`;}
 const sql=`WITH latest_quiz AS (
   SELECT DISTINCT ON (r.student_id) r.student_id,r.score,r.completed_at
   FROM results r WHERE r.activity='Module Quiz' ORDER BY r.student_id,r.completed_at DESC,r.id DESC
  ), first_two_quiz AS (
   SELECT qa.student_id,
    max(CASE WHEN rn=1 THEN qa.score END) pre_score,
    max(CASE WHEN rn=2 THEN qa.score END) post_score
   FROM (SELECT student_id,score,row_number() OVER(PARTITION BY student_id ORDER BY completed_at,id) rn FROM quiz_attempts WHERE status='completed') qa
   WHERE rn<=2 GROUP BY qa.student_id
  ), result_agg AS (
   SELECT s.class_id,
    round(avg(r.score)::numeric,1) activity_avg,
    count(r.id)::int activity_results,
    count(DISTINCT r.student_id)::int students_with_activity,
    round(avg(r.score) FILTER (WHERE r.activity='Scavenger Hunt')::numeric,1) hunt_avg,
    round(avg(r.score) FILTER (WHERE r.activity='Failure Simulation')::numeric,1) sim_avg,
    count(r.id) FILTER (WHERE r.activity='Failure Simulation')::int sim_attempts,
    round(avg(r.score) FILTER (WHERE r.activity='Master Diagnostic Challenge')::numeric,1) master_avg,
    round(avg(r.score) FILTER (WHERE r.activity LIKE 'Interactive Video — %')::numeric,1) video_avg
   FROM students s LEFT JOIN results r ON r.student_id=s.id GROUP BY s.class_id
  ), quiz_agg AS (
   SELECT s.class_id,round(avg(lq.score)::numeric,1) quiz_avg,
    count(lq.student_id)::int quiz_students,
    count(lq.student_id) FILTER (WHERE lq.score>=c.pass_score)::int quiz_passed,
    round(avg(ft.pre_score)::numeric,1) pre_avg,round(avg(ft.post_score)::numeric,1) post_avg,
    round(avg(ft.post_score-ft.pre_score) FILTER (WHERE ft.post_score IS NOT NULL)::numeric,1) improvement_avg
   FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN latest_quiz lq ON lq.student_id=s.id LEFT JOIN first_two_quiz ft ON ft.student_id=s.id
   GROUP BY s.class_id
  ), feedback_agg AS (
   SELECT s.class_id,count(f.student_id)::int feedback_responses,
    round(avg(f.overall)::numeric,1) feedback_overall,round(avg(f.instructor)::numeric,1) feedback_instructor,
    round(avg(f.usefulness)::numeric,1) feedback_usefulness,round(avg(f.hands_on)::numeric,1) feedback_hands_on,
    round(avg(f.difficulty)::numeric,1) feedback_difficulty
   FROM students s LEFT JOIN training_feedback f ON f.student_id=s.id GROUP BY s.class_id
  )
  SELECT c.id,c.code,c.title,c.course,c.instructor,c.pass_score,c.created_at,c.active,
   count(DISTINCT s.id)::int students,
   coalesce(q.quiz_avg,0) quiz_avg,coalesce(q.quiz_students,0)::int quiz_students,coalesce(q.quiz_passed,0)::int quiz_passed,
   q.pre_avg,q.post_avg,q.improvement_avg,
   coalesce(a.activity_avg,0) activity_avg,coalesce(a.activity_results,0)::int activity_results,coalesce(a.students_with_activity,0)::int students_with_activity,
   a.hunt_avg,a.sim_avg,coalesce(a.sim_attempts,0)::int sim_attempts,a.master_avg,a.video_avg,
   coalesce(f.feedback_responses,0)::int feedback_responses,f.feedback_overall,f.feedback_instructor,f.feedback_usefulness,f.feedback_hands_on,f.feedback_difficulty
  FROM classes c LEFT JOIN students s ON s.class_id=c.id
  LEFT JOIN result_agg a ON a.class_id=c.id LEFT JOIN quiz_agg q ON q.class_id=c.id LEFT JOIN feedback_agg f ON f.class_id=c.id
  WHERE ${where} GROUP BY c.id,q.quiz_avg,q.quiz_students,q.quiz_passed,q.pre_avg,q.post_avg,q.improvement_avg,a.activity_avg,a.activity_results,a.students_with_activity,a.hunt_avg,a.sim_avg,a.sim_attempts,a.master_avg,a.video_avg,f.feedback_responses,f.feedback_overall,f.feedback_instructor,f.feedback_usefulness,f.feedback_hands_on,f.feedback_difficulty
  ORDER BY c.created_at DESC LIMIT 200`;
 let rows=(await pool.query(sql,params)).rows;
 const acs=await allowedCourseSet(req.account); if(acs) rows=rows.filter(x=>acs.has(x.course));
 const allClasses=(await pool.query('SELECT DISTINCT course,instructor FROM classes WHERE company_id=$1 ORDER BY course,instructor',[companyId])).rows;
 const allowedClasses=acs?allClasses.filter(x=>acs.has(x.course)):allClasses;
 const courses=[...new Set(allowedClasses.map(x=>x.course).filter(Boolean))].sort();
 const instructors=[...new Set(allowedClasses.map(x=>x.instructor).filter(Boolean))].sort();
 const pct=(n,d)=>d?Math.round((Number(n)||0)*100/Number(d)):0;
 const n1=v=>(v===null||v===undefined||v==='')?'—':Number(v).toFixed(1);
 const clsRows=rows.map(x=>`<tr><td><b>${esc(x.course)}</b><br><span class="small muted">${esc(x.title)}</span><br><span class="pill">${esc(x.code)}</span></td><td>${esc(x.instructor||'Unassigned')}</td><td>${x.students}</td><td><b>${n1(x.quiz_avg)}${x.quiz_students?'%':''}</b><br><span class="small muted">Pass ${pct(x.quiz_passed,x.quiz_students)}% · ${x.quiz_students} tested</span></td><td>${n1(x.activity_avg)}${x.activity_results?'%':''}<br><span class="small muted">${x.activity_results} results</span></td><td>${n1(x.sim_avg)}${x.sim_avg!==null?'%':''}<br><span class="small muted">${x.sim_attempts} simulations</span></td><td>${n1(x.feedback_overall)}/5<br><span class="small muted">Instructor ${n1(x.feedback_instructor)}/5 · ${x.feedback_responses} responses</span></td><td>${x.improvement_avg===null?'—':`${Number(x.improvement_avg)>=0?'+':''}${Number(x.improvement_avg).toFixed(1)} pts`}<br><span class="small muted">Pre ${n1(x.pre_avg)} · Post ${n1(x.post_avg)}</span></td><td><a class="btn light" href="/instructor/performance/class/${x.id}">Open</a></td></tr>`).join('');
 const byInstructor=new Map();
 for(const x of rows){const k=x.instructor||'Unassigned'; if(!byInstructor.has(k))byInstructor.set(k,{name:k,classes:0,students:0,quizN:0,quizSum:0,actN:0,actSum:0,fbN:0,fbOverallSum:0,fbInstructorSum:0,simN:0,simSum:0}); const z=byInstructor.get(k); z.classes++;z.students+=Number(x.students)||0; if(Number(x.quiz_students)){z.quizN+=Number(x.quiz_students);z.quizSum+=(Number(x.quiz_avg)||0)*Number(x.quiz_students);} if(Number(x.activity_results)){z.actN+=Number(x.activity_results);z.actSum+=(Number(x.activity_avg)||0)*Number(x.activity_results);} if(Number(x.feedback_responses)){z.fbN+=Number(x.feedback_responses);z.fbOverallSum+=(Number(x.feedback_overall)||0)*Number(x.feedback_responses);z.fbInstructorSum+=(Number(x.feedback_instructor)||0)*Number(x.feedback_responses);} if(Number(x.sim_attempts)){z.simN+=Number(x.sim_attempts);z.simSum+=(Number(x.sim_avg)||0)*Number(x.sim_attempts);}}
 const instRows=[...byInstructor.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(z=>`<tr><td><b>${esc(z.name)}</b></td><td>${z.classes}</td><td>${z.students}</td><td>${z.quizN?(z.quizSum/z.quizN).toFixed(1)+'%':'—'}</td><td>${z.actN?(z.actSum/z.actN).toFixed(1)+'%':'—'}</td><td>${z.simN?(z.simSum/z.simN).toFixed(1)+'%':'—'}</td><td>${z.fbN?(z.fbOverallSum/z.fbN).toFixed(1)+'/5':'—'}</td><td>${z.fbN?(z.fbInstructorSum/z.fbN).toFixed(1)+'/5':'—'}</td><td>${z.fbN}</td></tr>`).join('');
 const totalStudents=rows.reduce((n,x)=>n+Number(x.students||0),0), totalFeedback=rows.reduce((n,x)=>n+Number(x.feedback_responses||0),0);
 const weighted=(field,countField)=>{let n=0,d=0;for(const x of rows){const c=Number(x[countField]||0),v=Number(x[field]);if(c&&Number.isFinite(v)){n+=v*c;d+=c;}}return d?(n/d).toFixed(1):'—';};
 const queryString=`instructor=${encodeURIComponent(instructor)}&course=${encodeURIComponent(course)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
 const filter=`<form method="get" class="card"><div class="grid"><label>Instructor<select name="instructor"><option value="">All instructors</option>${instructors.map(v=>`<option ${v===instructor?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Course<select name="course"><option value="">All courses</option>${courses.map(v=>`<option ${v===course?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>From<input type="date" name="from" value="${esc(from)}"></label><label>To<input type="date" name="to" value="${esc(to)}"></label></div><div class="toolbar"><button>Apply Filters</button><a class="btn light" href="/instructor/performance">Clear</a><button type="button" class="light" onclick="window.print()">Print / Save PDF</button></div></form>`;
 res.send(layout('Performance & Feedback',`<div class="no-print toolbar"><a class="btn light" href="/instructor/history">← Student Records</a><a class="btn light" href="/instructor/dashboard">Instructor Home</a></div><div class="hero"><div><div class="eyebrow">TRAINING RECORDS ANALYTICS</div><h1>Performance & Feedback</h1><p class="muted">Compare measured test results, completed activities, simulations, pre/post improvement, and student feedback by class and instructor.</p></div></div>${filter}<div class="grid"><div class="stat"><span>CLASSES</span><b>${rows.length}</b></div><div class="stat"><span>STUDENTS</span><b>${totalStudents}</b></div><div class="stat"><span>QUIZ AVG</span><b>${weighted('quiz_avg','quiz_students')}${weighted('quiz_avg','quiz_students')==='—'?'':'%'}</b></div><div class="stat"><span>ACTIVITY AVG</span><b>${weighted('activity_avg','activity_results')}${weighted('activity_avg','activity_results')==='—'?'':'%'}</b></div><div class="stat"><span>FEEDBACK</span><b>${weighted('feedback_overall','feedback_responses')}${weighted('feedback_overall','feedback_responses')==='—'?'':'/5'}</b></div><div class="stat"><span>FEEDBACK RESPONSES</span><b>${totalFeedback}</b></div></div><div class="card"><div class="section-title"><h2>Class Comparison</h2><span class="muted small">Filtered view · ${esc(queryString)}</span></div><div style="overflow:auto"><table><thead><tr><th>Class</th><th>Instructor</th><th>Students</th><th>Tests</th><th>All Activities</th><th>Simulations</th><th>Feedback</th><th>Pre/Post</th><th></th></tr></thead><tbody>${clsRows||'<tr><td colspan="9">No classes match these filters.</td></tr>'}</tbody></table></div></div><div class="card"><div class="section-title"><h2>Instructor Comparison</h2><span class="muted small">Actual measured results only; no automatic ranking.</span></div><div style="overflow:auto"><table><thead><tr><th>Instructor</th><th>Classes</th><th>Students</th><th>Test Avg</th><th>Activity Avg</th><th>Simulation Avg</th><th>Overall Feedback</th><th>Instructor Rating</th><th>Responses</th></tr></thead><tbody>${instRows||'<tr><td colspan="9">No instructor data for these filters.</td></tr>'}</tbody></table></div></div>`));
});

app.get('/instructor/performance/class/:id',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id])).rows[0]; if(!c)return res.status(404).send('Class not found');
 const acs=await allowedCourseSet(req.account); if(acs&&!acs.has(c.course))return res.status(403).send('Course access required');
 const students=(await pool.query('SELECT id,name,dealer FROM students WHERE class_id=$1 ORDER BY name',[c.id])).rows;
 const details=[];
 for(const st of students){
  const latestQuiz=(await pool.query("SELECT score FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC,id DESC LIMIT 1",[st.id])).rows[0];
  const all=(await pool.query('SELECT activity,score,completed_at FROM results WHERE student_id=$1 ORDER BY completed_at,id',[st.id])).rows;
  const sims=all.filter(x=>x.activity==='Failure Simulation');
  const avg=arr=>arr.length?Math.round(arr.reduce((n,x)=>n+Number(x.score||0),0)/arr.length):null;
  const hunt=[...all].reverse().find(x=>x.activity==='Scavenger Hunt'); const master=[...all].reverse().find(x=>x.activity==='Master Diagnostic Challenge');
  const fb=(await pool.query('SELECT * FROM training_feedback WHERE student_id=$1',[st.id])).rows[0]||null;
  details.push({st,quiz:latestQuiz?.score??null,activityAvg:avg(all),simAvg:avg(sims),simCount:sims.length,hunt:hunt?.score??null,master:master?.score??null,fb});
 }
 const drows=details.map(x=>`<tr><td><b>${esc(x.st.name)}</b><br><span class="small muted">${esc(x.st.dealer)}</span></td><td>${x.quiz===null?'—':x.quiz+'%'}</td><td>${x.activityAvg===null?'—':x.activityAvg+'%'}</td><td>${x.simAvg===null?'—':x.simAvg+'%'}${x.simCount?` <span class="small muted">(${x.simCount})</span>`:''}</td><td>${x.hunt===null?'—':x.hunt+'%'}</td><td>${x.master===null?'—':x.master+'%'}</td><td>${x.fb?`${x.fb.overall}/5 overall · ${x.fb.instructor}/5 instructor`:'—'}</td><td><a class="btn light" href="/instructor/student/${x.st.id}">Student Record</a></td></tr>`).join('');
 const fbs=details.filter(x=>x.fb).map(x=>x.fb), favg=k=>fbs.length?(fbs.reduce((n,x)=>n+Number(x[k]||0),0)/fbs.length).toFixed(1):'—';
 const comments=details.filter(x=>x.fb&&(x.fb.most_helpful||x.fb.improve||x.fb.comments)).map(x=>`<div class="card"><b>${esc(x.st.name)}</b><div class="grid"><div><b>Most Helpful</b><p>${esc(x.fb.most_helpful||'—')}</p></div><div><b>Improve</b><p>${esc(x.fb.improve||'—')}</p></div><div><b>Comments</b><p>${esc(x.fb.comments||'—')}</p></div></div></div>`).join('');
 res.send(layout('Class Performance',`<div class="no-print toolbar"><a class="btn light" href="/instructor/performance">← Performance & Feedback</a><a class="btn light" href="/instructor/class/${c.id}">Open Live Class</a><button onclick="window.print()">Print / Save PDF</button></div><div class="hero"><div><div class="eyebrow">CLASS PERFORMANCE REPORT</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · Class ${esc(c.code)} · Instructor: <b>${esc(c.instructor||'Unassigned')}</b></p></div></div><div class="grid"><div class="stat"><span>STUDENTS</span><b>${students.length}</b></div><div class="stat"><span>FEEDBACK RESPONSES</span><b>${fbs.length}</b></div><div class="stat"><span>OVERALL FEEDBACK</span><b>${favg('overall')}${fbs.length?'/5':''}</b></div><div class="stat"><span>INSTRUCTOR RATING</span><b>${favg('instructor')}${fbs.length?'/5':''}</b></div><div class="stat"><span>USEFULNESS</span><b>${favg('usefulness')}${fbs.length?'/5':''}</b></div><div class="stat"><span>HANDS-ON</span><b>${favg('hands_on')}${fbs.length?'/5':''}</b></div></div><div class="card"><div class="big">Student Results & Activities</div><div style="overflow:auto"><table><thead><tr><th>Student</th><th>Latest Test</th><th>Activity Avg</th><th>Simulation Avg</th><th>Scavenger Hunt</th><th>Master Challenge</th><th>Feedback</th><th></th></tr></thead><tbody>${drows||'<tr><td colspan="8">No students yet.</td></tr>'}</tbody></table></div></div><div class="card"><div class="big">Training Feedback Summary</div><div class="grid"><div class="stat"><span>OVERALL</span><b>${favg('overall')}</b></div><div class="stat"><span>INSTRUCTOR</span><b>${favg('instructor')}</b></div><div class="stat"><span>USEFULNESS</span><b>${favg('usefulness')}</b></div><div class="stat"><span>HANDS-ON</span><b>${favg('hands_on')}</b></div><div class="stat"><span>DIFFICULTY / PACE</span><b>${favg('difficulty')}</b></div></div></div><div><h2>Written Feedback</h2>${comments||'<div class="card muted">No written feedback submitted for this class.</div>'}</div>`));
});

app.get('/instructor/feedback',auth,async(req,res)=>{
 const q=await pool.query(`SELECT c.id,c.course,c.title,c.code,count(f.student_id)::int responses,round(avg(f.overall)::numeric,1) overall FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN training_feedback f ON f.student_id=s.id WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 60`,[req.account.company_id]);
 const acs=await allowedCourseSet(req.account); const visibleFeedback=acs?q.rows.filter(x=>acs.has(x.course)):q.rows; const rows=visibleFeedback.map(x=>`<tr><td><b>${esc(x.course)}</b><br><span class="small muted">${esc(x.title)}</span></td><td>${esc(x.code)}</td><td>${x.responses}</td><td>${x.overall||'—'}</td><td><a class="btn light" href="/instructor/class/${x.id}/feedback">View Feedback</a></td></tr>`).join('');
 res.send(layout('Training Feedback', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="big">Training Feedback</div><p class="muted">Student ratings and comments by class.</p><table><tr><th>Class</th><th>Code</th><th>Responses</th><th>Overall</th><th></th></tr>${rows||'<tr><td colspan="5">No classes yet.</td></tr>'}</table></div>`));
});
app.get('/instructor/class/:id/feedback',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const q=await pool.query(`SELECT f.*,s.name,s.dealer FROM training_feedback f JOIN students s ON s.id=f.student_id WHERE s.class_id=$1 ORDER BY f.submitted_at`,[c.id]);
 const avg=k=>q.rowCount?(q.rows.reduce((a,x)=>a+Number(x[k]),0)/q.rowCount).toFixed(1):'—';
 const comments=q.rows.map(x=>`<div class="card"><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.dealer)}</span><div class="grid" style="margin-top:10px"><div><b>Most Helpful</b><p>${esc(x.most_helpful||'—')}</p></div><div><b>Improve</b><p>${esc(x.improve||'—')}</p></div><div><b>Comments</b><p>${esc(x.comments||'—')}</p></div></div></div>`).join('');
 res.send(layout('Class Feedback', `<div class="no-print toolbar"><a class="btn light" href="/instructor/class/${c.id}">← Back to Class</a><button onclick="window.print()">Print Feedback Report</button></div><div class="hero"><div><div class="eyebrow">Training Evaluation</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · ${q.rowCount} responses</p></div></div><div class="grid"><div class="stat"><span>Overall Training</span><b>${avg('overall')}</b></div><div class="stat"><span>Instructor</span><b>${avg('instructor')}</b></div><div class="stat"><span>Usefulness</span><b>${avg('usefulness')}</b></div><div class="stat"><span>Hands-On</span><b>${avg('hands_on')}</b></div><div class="stat"><span>Difficulty / Pace</span><b>${avg('difficulty')}</b></div></div>${comments||'<div class="card">No feedback submitted yet.</div>'}`));
});

app.get('/instructor/student/:id',auth,async(req,res)=>{
 const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
 const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
 const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0; const skillRows=skills.rows.map(x=>`<label><input style="width:auto" type="checkbox" name="skill_${x.id}" ${x.signed_off?'checked':''}> ${esc(x.skill)}</label>`).join('');
 const resultRows=results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleString()}</td></tr>`).join('');
 const attemptHistory=await getQuizAttemptHistory(s.id);
 const attemptRows=attemptHistory.filter(a=>a.status==='completed').map((a,i)=>`<tr><td>${i+1}</td><td>${a.score}%</td><td>${a.correct_count}/${a.total_questions}</td><td>${new Date(a.completed_at).toLocaleString()}</td><td><a class="btn light" href="/instructor/student/${s.id}/quiz-attempt/${a.id}">Open Attempt</a></td></tr>`).join('');
 const latestAttempt=attemptHistory.find(a=>a.status==='completed');
 let quizReview='<div class="muted">No completed quiz attempt yet.</div>';
 if(latestAttempt){ const aRows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[latestAttempt.id])).rows; quizReview=renderAttemptReview(aRows.map(attemptRowToReviewItem),latestAttempt.score,false); }
 else { const quizResult=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResult){ const oldInfo=await repairQuizReviewData(s.id,quizResult.details||{}); quizReview=oldInfo.legacyIncomplete?'<div class="alert">Legacy attempt: the exact answers were not stored by the older version. New 2.0 attempts are permanent.</div>':renderAttemptReview(oldInfo.review,quizResult.score,false); } }
 const feedback=(await pool.query('SELECT * FROM training_feedback WHERE student_id=$1',[s.id])).rows[0];
 res.send(layout('Student Record', `<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${s.class_id}">Back to Class</a><a class="btn" href="/instructor/student/${s.id}/report" target="_blank">Printable Report</a><a class="btn alt" href="/instructor/student/${s.id}/certificate/edit">Edit Certificate</a></div><div class="card no-print" style="border-color:#e4b4b4"><div class="big danger">Delete Student</div><p class="muted">This permanently removes this student, their scores, skills, comments, and certificate record.</p><form method="post" action="/instructor/student/${s.id}/delete" onsubmit="return confirm('Permanently delete ${esc(s.name)} and all of this student’s results? This cannot be undone.')"><button class="danger">Delete Student Record</button></form></div><div class="card"><div class="big">${esc(s.name)}</div><p>${esc(s.dealer)} · ${esc(s.course)} · Class ${esc(s.code)}</p><div class="grid"><div class="stat"><span>Overall Average</span><b>${avg}%</b></div><div class="stat"><span>Passing Score</span><b>${s.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${s.hours}</b></div></div></div><div class="card"><div class="big">Activity Results</div><table><tr><th>Activity</th><th>Score</th><th>Completed</th></tr>${resultRows||'<tr><td colspan="3">No completed activities yet.</td></tr>'}</table></div><div class="card"><div class="big">Quiz Review — What the Student Missed</div>${quizReview}</div><div class="card"><div class="big">Quiz Attempt History</div><p class="muted">Every v5.6 quiz attempt is retained permanently.</p><div style="overflow:auto"><table><tr><th>Attempt</th><th>Score</th><th>Correct</th><th>Completed</th><th></th></tr>${attemptRows||'<tr><td colspan="5">No permanent v5.6 attempts yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Training Feedback</div>${feedback?`<p><b>Overall:</b> ${feedback.overall}/5 · <b>Instructor:</b> ${feedback.instructor}/5 · <b>Usefulness:</b> ${feedback.usefulness}/5 · <b>Hands-On:</b> ${feedback.hands_on}/5 · <b>Difficulty/Pace:</b> ${feedback.difficulty}/5</p><p><b>Most helpful:</b> ${esc(feedback.most_helpful||'—')}</p><p><b>Improve:</b> ${esc(feedback.improve||'—')}</p><p><b>Comments:</b> ${esc(feedback.comments||'—')}</p>`:'<p class="muted">No training feedback submitted yet.</p>'}</div><div class="card"><div class="big">Instructor Skills Signoff</div><form method="post" action="/instructor/student/${s.id}/save">${skillRows}<label>Instructor Comments<textarea name="comments" rows="5">${esc(notes.comments||'')}</textarea></label><label>Certification Status<select name="status"><option ${notes.certification_status==='Pending'?'selected':''}>Pending</option><option ${notes.certification_status==='Certified'?'selected':''}>Certified</option><option ${notes.certification_status==='Not Yet Certified'?'selected':''}>Not Yet Certified</option></select></label><button>Save Student Record</button></form></div>`));
});
app.get('/instructor/student/:id/quiz-attempt/:attemptId',auth,async(req,res)=>{
 const q=await pool.query(`SELECT a.*,s.name,s.dealer,c.course,c.code FROM quiz_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1 AND a.student_id=$2`,[req.params.attemptId,req.params.id]);
 const a=q.rows[0]; if(!a) return res.status(404).send('Quiz attempt not found');
 const rows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[a.id])).rows;
 const review=rows.map(attemptRowToReviewItem);
 res.send(layout('Quiz Attempt', `<div class="toolbar"><a class="btn light" href="/instructor/student/${a.student_id}">← Student Record</a></div><div class="card"><div class="eyebrow">Permanent Quiz Attempt #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.course)}</div><p>${esc(a.dealer)} · Class ${esc(a.code)} · Completed ${a.completed_at?new Date(a.completed_at).toLocaleString():'Not completed'}</p></div>${renderAttemptReview(review,a.score,true)}`));
});

app.post('/instructor/student/:id/save',auth,async(req,res)=>{
 const skills=await pool.query('SELECT id FROM skills WHERE student_id=$1',[req.params.id]); for(const x of skills.rows){ const on=!!req.body['skill_'+x.id]; await pool.query('UPDATE skills SET signed_off=$1,signed_by=$2,signed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$3',[on,'Instructor',x.id]); }
 const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[req.params.id]); const cert=(existing.rows[0]?.certificate_no)||certNo();
 await pool.query(`INSERT INTO instructor_notes(student_id,comments,certification_status,certificate_no) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET comments=excluded.comments,certification_status=excluded.certification_status,certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[req.params.id,req.body.comments||'',req.body.status||'Pending',cert]);
 res.redirect(`/instructor/student/${req.params.id}`);
});

app.post('/instructor/student/:id/delete',auth,async(req,res)=>{ const q=await pool.query('SELECT class_id,name FROM students WHERE id=$1',[req.params.id]); if(!q.rowCount) return res.status(404).send('Student not found'); const classId=q.rows[0].class_id; await pool.query('DELETE FROM students WHERE id=$1',[req.params.id]); res.send(layout('Student Deleted', `<div class="card center"><div class="big">Student Deleted</div><p>${esc(q.rows[0].name)} and all associated training records were removed.</p><a class="btn" href="/instructor/class/${classId}">Return to Class</a> <a class="btn light" href="/instructor/history">Student Records</a></div>`)); });

app.get('/instructor/student/:id/report',auth,async(req,res)=>{
 const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
 const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{}; const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0;
 const reportAttempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
 let missedRows='';
 if(reportAttempt){ const ar=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[reportAttempt.id])).rows.map(attemptRowToReviewItem); missedRows=ar.filter(x=>!x.is_correct).map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question)}</b><p><b>Student Answer:</b> ${esc(m.selected)}<br><b>Correct Answer:</b> ${esc(m.correct)}<br><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join(''); } else { const quizResultReport=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResultReport){ const reviewReport=await repairQuizReviewData(s.id,quizResultReport.details||{}); missedRows=reviewReport.missed.length?reviewReport.missed.map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question||'Question text was not retained')}</b><p><b>Student Answer:</b> ${esc(m.selected||'Previous selected answer was not recorded')}<br><b>Correct Answer:</b> ${esc(m.correct||'Correct answer could not be recovered')}<br><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join(''):'<div class="alert">Legacy attempt: no recoverable question snapshot was stored.</div>'; } }
 res.send(layout('Student Report', `<div class="report"><div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="center"><h1>${esc(brand('organization_name','Your Company'))} Record</h1><p>${esc(s.course)}</p></div><div class="card"><table><tr><th>${esc(brand('student_label','Student'))}</th><td>${esc(s.name)}</td><th>${esc(brand('organization_unit_label','Company / Location'))}</th><td>${esc(s.dealer)}</td></tr><tr><th>Instructor</th><td>${esc(s.instructor)}</td><th>Class Code</th><td>${esc(s.code)}</td></tr><tr><th>Course Hours</th><td>${s.hours}</td><th>Overall Average</th><td><b>${avg}%</b></td></tr><tr><th>Passing Score</th><td>${s.pass_score}%</td><th>Status</th><td><b>${esc(notes.certification_status|| (avg>=s.pass_score?'PASS':'REVIEW'))}</b></td></tr><tr><th>Certificate No.</th><td colspan="3">${esc(notes.certificate_no||'Pending')}</td></tr></table></div><div class="card"><h2>Activity Results</h2><table><tr><th>Activity</th><th>Score</th><th>Date</th></tr>${results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleDateString()}</td></tr>`).join('')}</table></div><div class="card"><h2>Quiz Review — Missed Questions</h2>${missedRows||'<p>No missed questions recorded.</p>'}</div><div class="card"><h2>Practical Skills</h2>${skills.rows.map(x=>`<p>☐ ${x.signed_off?'✓ ':''}${esc(x.skill)} ${x.signed_off?`— Verified by ${esc(x.signed_by||'Instructor')}`:''}</p>`).join('')}</div><div class="card"><h2>Instructor Comments</h2><p>${esc(notes.comments||'')}</p><div style="margin-top:50px;display:flex;gap:60px"><div style="flex:1;border-top:1px solid #000;padding-top:5px">${esc(brand('student_label','Student'))} Signature</div><div style="flex:1;border-top:1px solid #000;padding-top:5px">Instructor Signature</div></div></div></div>`, `<script>window.addEventListener('load',()=>{});</script>`));
});

function attemptRowToReviewItem(row){
 return {question:row.question_text||'',topic:row.topic||'',choices:Array.isArray(row.choices)?row.choices:[],selected_index:row.selected_index,answer_index:row.correct_index,selected:row.selected_answer||'No answer',correct:row.correct_answer||'',explanation:row.explanation||'Review this topic with your instructor.',is_correct:row.is_correct===true};
}
function renderAttemptReview(review=[],score=null,showAll=true){
 const missed=review.filter(x=>!x.is_correct), source=showAll?review:missed;
 const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} · Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question)}</p><p><b>Student Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct)}</p><p><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join('');
 return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Answer Review</div><p class="muted">Score: <b>${score===null?'—':score+'%'}</b> · Missed: <b>${missed.length}</b>. Every question is stored as a snapshot and remains available even if the quiz is edited later.</p>${rows||'<div class="success">No stored questions for this attempt.</div>'}</div>`;
}
async function getQuizAttemptHistory(studentId){
 return (await pool.query(`SELECT id,score,correct_count,total_questions,started_at,completed_at,status FROM quiz_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[studentId])).rows;
}

function formatCertDate(d){
 return new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
}
function quizReviewData(details={}){
 const review=Array.isArray(details.review)?details.review:[];
 let missed=Array.isArray(details.missed)?details.missed:[];
 if(!missed.length && review.length) missed=review.filter(x=>!x?.is_correct);
 const normalizedReview=review.length?review:(missed.length?missed.map(x=>({...x,is_correct:false})):[]);
 return {review:normalizedReview, missed};
}
async function repairQuizReviewData(studentId,details={}){
 const student=(await pool.query('SELECT class_id FROM students WHERE id=$1',[studentId])).rows[0];
 const classId=student?.class_id;
 const info=quizReviewData(details);

 // First use complete review objects already stored in the old result.
 const existing=[];
 for(const raw of info.review){
  if(typeof raw==='string'){
   existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
  }else if(raw && typeof raw==='object'){
   existing.push({
    question:String(raw.question||''), topic:String(raw.topic||''),
    selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),
    correct:String(raw.correct||raw.correct_answer||''),
    explanation:String(raw.explanation||''), is_correct:!!raw.is_correct
   });
  }
 }
 if(!existing.length && Array.isArray(details.missed)){
  for(const raw of details.missed){
   if(typeof raw==='string') existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
   else if(raw && typeof raw==='object') existing.push({question:String(raw.question||''),topic:String(raw.topic||''),selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),correct:String(raw.correct||raw.correct_answer||''),explanation:String(raw.explanation||''),is_correct:false});
  }
 }

 // Recover missing question/correct-answer text from the current class question bank when possible.
 if(classId && existing.length){
  const bank=(await pool.query('SELECT question,choices,answer_index,explanation,topic FROM quiz_questions WHERE class_id=$1',[classId])).rows;
  for(const item of existing){
   let match=null;
   if(item.question){
    const qnorm=item.question.trim().toLowerCase();
    match=bank.find(q=>String(q.question||'').trim().toLowerCase()===qnorm);
   }
   if(match){
    const choices=Array.isArray(match.choices)?match.choices:[];
    if(!item.correct) item.correct=choices[match.answer_index]||'';
    if(!item.explanation) item.explanation=match.explanation||'Review this topic with your instructor.';
    if(!item.topic) item.topic=match.topic||'';
   }
  }
  const useful=existing.filter(x=>x.question && x.correct);
  if(useful.length) return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:existing.some(x=>!x.question||!x.correct)};
 }

 // Older versions kept the latest per-question progress separately. Recover it when still available.
 const q=await pool.query(`SELECT qp.is_correct,qp.selected_answer,qq.question,qq.choices,qq.answer_index,qq.explanation,qq.topic FROM quiz_progress qp JOIN quiz_questions qq ON qq.id=qp.question_id WHERE qp.student_id=$1 ORDER BY qp.updated_at,qq.id`,[studentId]);
 if(q.rowCount){
  const review=q.rows.map(x=>({question:x.question||'',topic:x.topic||'',selected:Number.isInteger(x.selected_answer)?(x.choices?.[x.selected_answer]||'Previous selected answer was not recorded'):'Previous selected answer was not recorded',correct:x.choices?.[x.answer_index]||'',explanation:x.explanation||'Review this topic with your instructor.',is_correct:!!x.is_correct})).filter(x=>x.question&&x.correct);
  if(review.length) return {review,missed:review.filter(x=>!x.is_correct),legacyIncomplete:false};
 }

 // If old details contained a question string but it no longer exists in the bank, preserve the text and be explicit.
 if(existing.length){
  return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:true};
 }
 return {review:[],missed:[],legacyIncomplete:true};
}
function renderQuizReview(details={}, opts={}){
 const score=opts.score ?? null;
 const showAll=opts.showAll!==false;
 const {review, missed}=quizReviewData(details);
 const source=(showAll && review.length)?review:missed;
 const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question||'')}</p><p><b>Your Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct||'')}</p><p><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join('');
 return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Quiz Review</div><p class="muted">Questions missed: <b>${missed.length}</b>${score!==null?` · Score: <b>${score}%</b>`:''}. ${showAll?'All questions are shown below, with missed ones highlighted in red.':'Missed questions are shown below.'}</p>${rows||'<div class="success"><b>Perfect score.</b> You did not miss any questions.</div>'}</div>`;
}

function certAlign(v='center'){ const x=String(v||'center').toLowerCase(); return ['left','center','right'].includes(x)?x:'center'; }
function certOffset(v=0){ const n=Number(v); return Number.isFinite(n)?Math.max(-300,Math.min(300,n)):0; }
function certTransform(x=0,y=0){ return `translate(${certOffset(x)}px,${certOffset(y)}px)`; }
function importedInstructorPlaceholder(v=''){
 const x=String(v||'').trim().toLowerCase();
 return !x || x==='imported' || /^imported\s*5\.8/.test(x) || /^5\.8(?:\.1)?\s+content\s+pack/.test(x) || /^legacy(?:\s|$)/.test(x);
}
async function certificateIdentity(s={}){
 const companyId=Number(s.company_id)||Number((await pool.query('SELECT company_id FROM classes WHERE id=$1',[s.class_id])).rows[0]?.company_id)||0;
 let companyName='Your Company', settings={};
 if(companyId){
  const cq=await pool.query('SELECT name FROM companies WHERE id=$1',[companyId]); companyName=String(cq.rows[0]?.name||companyName);
  const sq=await pool.query('SELECT key,value FROM company_settings WHERE company_id=$1',[companyId]); settings=Object.fromEntries(sq.rows.map(r=>[r.key,String(r.value||'')]));
  if(/mahindra/i.test(companyName)){
   const defs={certificate_organization_name:'Mahindra Ag North America',certificate_manager_name:'Nazar Mohamed',certificate_manager_title:'National Aftersales Manager'};
   for(const [key,value] of Object.entries(defs)){
    if(!String(settings[key]||'').trim()){
     await pool.query(`INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=CASE WHEN btrim(company_settings.value)='' THEN excluded.value ELSE company_settings.value END`,[companyId,key,value]);
     settings[key]=value;
    }
   }
  }
 }
 let instructor=String(s.instructor||'').trim();
 if(importedInstructorPlaceholder(instructor) && companyId){
  let uq=null;
  if(s.created_by_user_id) uq=await pool.query('SELECT name FROM app_users WHERE id=$1 AND company_id=$2 AND active=true LIMIT 1',[s.created_by_user_id,companyId]);
  if(!uq?.rowCount) uq=await pool.query(`SELECT name FROM app_users WHERE company_id=$1 AND active=true ORDER BY CASE role WHEN 'company_admin' THEN 0 WHEN 'instructor' THEN 1 ELSE 2 END,created_at,id LIMIT 1`,[companyId]);
  instructor=String(uq?.rows?.[0]?.name||'').trim();
 }
 const organization=String(settings.certificate_organization_name||'').trim() || companyName;
 let managerName=String(settings.certificate_manager_name||'').trim();
 let managerTitle=String(settings.certificate_manager_title||'').trim() || 'Training Manager';
 if(/mahindra/i.test(companyName)){
  if(!managerName) managerName='Nazar Mohamed';
  if(!managerTitle || managerTitle==='Training Manager') managerTitle='National Aftersales Manager';
 }
 return {organization,instructor:instructor||String(s.instructor||'').trim(),instructorTitle:'Instructor',instructorOrg:organization,managerName,managerTitle,managerOrg:organization};
}

function certificateMarkup(s, cert, startDate, endDate, backHref='', opts={}){
 const backBtn=backHref?`<a class="btn light" href="${esc(backHref)}">Back</a>`:'';
 const v={
  organization:opts.organization||brand('organization_name','Your Company'),
  intro:opts.intro||'This is to certify that',
  name:opts.name||s.name,
  dealer:opts.dealer||s.dealer,
  success:opts.success||'has successfully completed',
  courseLabel:opts.courseLabel||'Technical Training on',
  course:opts.course||s.course,
  location:opts.location||brand('certificate_location',''),
  startDate:opts.startDate||startDate,
  endDate:opts.endDate||endDate,
  instructor:opts.instructor||s.instructor,
  instructorTitle:opts.instructorTitle||'Instructor',
  instructorOrg:opts.instructorOrg||brand('organization_name','Your Company'),
  managerName:opts.managerName||brand('certificate_manager_name',''),
  managerTitle:opts.managerTitle||brand('certificate_manager_title','Training Manager'),
  managerOrg:opts.managerOrg||brand('organization_name','Your Company'),
  certificateNo:opts.certificateNo||cert,
  titleAlign:certAlign(opts.titleAlign), titleX:certOffset(opts.titleX), titleY:certOffset(opts.titleY),
  introAlign:certAlign(opts.introAlign), introX:certOffset(opts.introX), introY:certOffset(opts.introY),
  nameAlign:certAlign(opts.nameAlign), nameX:certOffset(opts.nameX), nameY:certOffset(opts.nameY),
  dealerAlign:certAlign(opts.dealerAlign), dealerX:certOffset(opts.dealerX), dealerY:certOffset(opts.dealerY),
  successAlign:certAlign(opts.successAlign), successX:certOffset(opts.successX), successY:certOffset(opts.successY),
  courseLabelAlign:certAlign(opts.courseLabelAlign||'left'), courseLabelX:certOffset(opts.courseLabelX), courseLabelY:certOffset(opts.courseLabelY),
  courseAlign:certAlign(opts.courseAlign), courseX:certOffset(opts.courseX), courseY:certOffset(opts.courseY),
  locationAlign:certAlign(opts.locationAlign), locationX:certOffset(opts.locationX), locationY:certOffset(opts.locationY),
  datesAlign:certAlign(opts.datesAlign), datesX:certOffset(opts.datesX), datesY:certOffset(opts.datesY),
  instructorAlign:certAlign(opts.instructorAlign), instructorX:certOffset(opts.instructorX), instructorY:certOffset(opts.instructorY),
  managerAlign:certAlign(opts.managerAlign), managerX:certOffset(opts.managerX), managerY:certOffset(opts.managerY),
  certNoAlign:certAlign(opts.certNoAlign), certNoX:certOffset(opts.certNoX), certNoY:certOffset(opts.certNoY),
  logoX:certOffset(opts.logoX), logoY:certOffset(opts.logoY)
 };
 const editBtn=opts.editHref?`<a class="btn alt" href="${esc(opts.editHref)}">Edit Certificate</a>`:'';
 return {
  body:`<div class="no-print toolbar cert-toolbar"><button onclick="window.print()">Print / Save PDF</button>${editBtn}${backBtn}</div>
  <div class="cert-stage">
   <div class="training-cert">
    ${safeLogoUrl(brand('logo_url',''))?`<img class="cert-logo" style="transform:${certTransform(v.logoX,v.logoY)}" src="${esc(safeLogoUrl(brand('logo_url','')))}" alt="${esc(brand('organization_name','Company'))} logo">`:''}
    <div class="cert-title" style="text-align:${v.titleAlign};transform:${certTransform(v.titleX,v.titleY)}">${esc(v.organization)}</div>
    <div class="cert-intro" style="text-align:${v.introAlign};transform:${certTransform(v.introX,v.introY)}">${esc(v.intro)}</div>
    <div class="cert-name" style="text-align:${v.nameAlign};transform:${certTransform(v.nameX,v.nameY)}">${esc(v.name)}</div>
    <div class="cert-name-line"></div>
    <div class="cert-of">of</div>
    <div class="cert-dealer" style="text-align:${v.dealerAlign};transform:${certTransform(v.dealerX,v.dealerY)}">${esc(v.dealer)}</div>
    <div class="cert-dealer-line"></div>
    <div class="cert-success" style="text-align:${v.successAlign};transform:${certTransform(v.successX,v.successY)}">${esc(v.success)}</div>
    <div class="cert-course-label" style="text-align:${v.courseLabelAlign};transform:${certTransform(v.courseLabelX,v.courseLabelY)}">${esc(v.courseLabel)}</div>
    <div class="cert-course" style="text-align:${v.courseAlign};transform:${certTransform(v.courseX,v.courseY)}">${esc(v.course)}</div>
    <div class="cert-course-line"></div>
    <div class="cert-location" style="text-align:${v.locationAlign};transform:${certTransform(v.locationX,v.locationY)}">${esc(v.location)}</div>
    <div class="cert-dates" style="text-align:${v.datesAlign};transform:${certTransform(v.datesX,v.datesY)}"><span>From</span><span class="cert-date">${esc(v.startDate)}</span><span>to</span><span class="cert-date">${esc(v.endDate)}</span></div>

    <div class="sig-block instructor-signature-block" style="text-align:${v.instructorAlign};transform:${certTransform(v.instructorX,v.instructorY)}">
     <div class="typed-signature">${esc(v.instructor)}</div>
     <div class="sig-line"></div>
     <div class="sig-name">${esc(v.instructor)}</div>
     <div>${esc(v.instructorTitle)}</div>
     <div>${esc(v.instructorOrg)}</div>
    </div>

    <div class="sig-block manager-signature-block" style="text-align:${v.managerAlign};transform:${certTransform(v.managerX,v.managerY)}">
     <div class="typed-signature">${esc(v.managerName)}</div>
     <div class="sig-line"></div>
     <div class="sig-name">${esc(v.managerName)}</div>
     <div>${esc(v.managerTitle)}</div>
     <div>${esc(v.managerOrg)}</div>
    </div>

    <div class="cert-number" style="text-align:${v.certNoAlign};transform:${certTransform(v.certNoX,v.certNoY)}">Certificate No. ${esc(v.certificateNo)}</div>
   </div>
  </div>`,
  css:`<style>
   body{background:#ececec}
   .wrap{max-width:none!important;padding:18px!important}
   .cert-toolbar{max-width:1180px;margin:0 auto 10px}
   .cert-stage{width:100%;overflow:auto;display:flex;justify-content:center;align-items:flex-start}
   .training-cert{position:relative;width:1180px;height:912px;min-width:1180px;background:#fff;border:1px solid #d7d7d7;box-shadow:0 4px 18px rgba(0,0,0,.12);font-family:Georgia,'Times New Roman',serif;color:#111;overflow:hidden}
   .cert-logo{position:absolute;left:62px;top:30px;width:210px;height:auto;object-fit:contain}
   .cert-title{position:absolute;left:250px;right:120px;top:34px;text-align:center;font-size:42px;font-weight:700;line-height:1.05}
   .cert-intro{position:absolute;left:0;right:0;top:132px;text-align:center;font-style:italic;font-size:29px}
   .cert-name{position:absolute;left:170px;right:170px;top:188px;text-align:center;color:#0b43a0;font-size:45px;font-weight:700;line-height:1.05}
   .cert-name-line{position:absolute;left:150px;right:150px;top:246px;border-top:2px solid #222}
   .cert-of{position:absolute;left:64px;top:292px;font-style:italic;font-size:27px}
   .cert-dealer{position:absolute;left:145px;right:90px;top:276px;text-align:center;color:#0b43a0;font-size:35px;font-weight:700}
   .cert-dealer-line{position:absolute;left:150px;right:150px;top:326px;border-top:2px solid #222}
   .cert-success{position:absolute;left:0;right:0;top:360px;text-align:center;font-style:italic;font-size:29px}
   .cert-course-label{position:absolute;left:170px;top:430px;font-style:italic;font-size:27px}
   .cert-course{position:absolute;left:480px;right:170px;top:414px;text-align:center;color:#0b43a0;font-size:32px;font-weight:700;line-height:1.1}
   .cert-course-line{position:absolute;left:470px;right:150px;top:458px;border-top:2px solid #222}
   .cert-location{position:absolute;left:0;right:0;top:495px;text-align:center;font-style:italic;font-size:27px}
   .cert-dates{position:absolute;left:0;right:0;top:552px;display:flex;justify-content:center;align-items:flex-end;gap:16px;font-style:italic;font-size:25px}
   .cert-date{min-width:240px;text-align:center;color:#0b43a0;font-style:normal;font-weight:700;border-bottom:2px solid #222;padding:0 8px 4px}
   .sig-block{position:absolute;width:360px;height:150px;text-align:center;font-family:Arial,sans-serif;font-size:16px;line-height:1.15}
   .instructor-signature-block{left:115px;top:650px}
   .manager-signature-block{right:115px;top:650px}
   .typed-signature{height:64px;display:flex;align-items:flex-end;justify-content:center;font-family:'Segoe Script','Brush Script MT',cursive;font-size:34px;font-style:italic;line-height:1;margin:0 auto -8px;position:relative;z-index:2;background:transparent}
   .manager-signature{display:block;width:285px;height:74px;object-fit:contain;object-position:center;filter:none;margin:0 auto -18px;position:relative;z-index:2;background:transparent}
   .sig-line{border-top:2px solid #222;margin:0 auto 10px;width:330px;max-width:330px;position:relative;z-index:1}
   .sig-name{font-size:18px;font-weight:700}
   .cert-number{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-family:Arial,sans-serif;color:#444;font-size:14px;font-weight:600}
   @media(max-width:1215px){.cert-stage{justify-content:flex-start}}
   @media print{
    @page{size:11in 8.5in landscape;margin:.25in}
    html,body{width:11in;height:8.5in;margin:0!important;padding:0!important;background:#fff!important}
    .top,.no-print{display:none!important}
    .wrap{width:10.5in!important;height:8in!important;max-width:none!important;margin:0!important;padding:0!important}
    .cert-stage{display:block!important;width:10.5in!important;height:8in!important;overflow:hidden!important;margin:0!important;padding:0!important}
    .training-cert{width:10.5in!important;height:8in!important;min-width:0!important;margin:0!important;border:0!important;box-shadow:none!important;transform:none!important}
    .cert-logo{left:.42in;top:.22in;width:1.85in}
    .cert-title{left:2.2in;right:.75in;top:.27in;font-size:30pt}
    .cert-intro{top:1.15in;font-size:21pt}
    .cert-name{left:1.45in;right:1.45in;top:1.63in;font-size:32pt}
    .cert-name-line{left:1.3in;right:1.3in;top:2.15in}
    .cert-of{left:.5in;top:2.55in;font-size:20pt}
    .cert-dealer{left:1.25in;right:.75in;top:2.4in;font-size:25pt}
    .cert-dealer-line{left:1.3in;right:1.3in;top:2.85in}
    .cert-success{top:3.15in;font-size:21pt}
    .cert-course-label{left:1.45in;top:3.75in;font-size:19pt}
    .cert-course{left:4.25in;right:1.35in;top:3.6in;font-size:23pt}
    .cert-course-line{left:4.08in;right:1.3in;top:4.0in}
    .cert-location{top:4.32in;font-size:20pt}
    .cert-dates{top:4.85in;font-size:18pt;gap:.13in}
    .cert-date{min-width:2.05in;padding-bottom:.03in}
    .sig-block{width:3.25in;height:1.35in;font-size:11.5pt}
    .instructor-signature-block{left:.98in;top:5.58in}
    .manager-signature-block{right:.98in;top:5.58in}
    .typed-signature{height:.55in;font-size:24pt;margin:0 auto -.07in;position:relative;z-index:2;background:transparent}
    .manager-signature{width:2.55in;height:.68in;filter:none;margin:0 auto -.13in;position:relative;z-index:2;background:transparent}
    .sig-line{width:3.0in;max-width:3.0in;margin:0 auto .08in;position:relative;z-index:1}
    .sig-name{font-size:13pt}
    .cert-number{bottom:.08in;font-size:9.5pt;color:#444;font-weight:600}
   }
  </style>`
 };
}

app.get('/student/:id/certificate', async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const qr=await pool.query("SELECT score,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id]);
 if(!qr.rowCount) return res.status(403).send(layout('Certificate Not Available','<div class="card">Complete the test first.</div>'));
 const score=Number(qr.rows[0].score);
 if(score<s.pass_score) return res.status(403).send(layout('Certificate Not Available',`<div class="card"><div class="alert">A passing score of ${s.pass_score}% is required. Your latest score is ${score}%.</div></div>`));
 const cert=await ensureCertificate(s.id);
 const cq=(await pool.query('SELECT created_at,company_id,created_by_user_id FROM classes WHERE id=$1',[s.class_id])).rows[0];
 if(cq){s.company_id=s.company_id||cq.company_id;s.created_by_user_id=s.created_by_user_id||cq.created_by_user_id;}
 const startDate=formatCertDate(cq?.created_at||qr.rows[0].completed_at);
 const endDate=formatCertDate(qr.rows[0].completed_at);
 const identity=await certificateIdentity(s);
 const certView=certificateMarkup(s,cert,startDate,endDate,`/student/${s.id}?token=${encodeURIComponent(s.join_token)}`,identity);
 res.send(layout('My Certificate',certView.body,certView.css));
});

function certOverrideFromQuery(q={}){
 const keys=['organization','intro','name','dealer','success','courseLabel','course','location','startDate','endDate','instructor','instructorTitle','instructorOrg','managerName','managerTitle','managerOrg','certificateNo','titleAlign','titleX','titleY','introAlign','introX','introY','nameAlign','nameX','nameY','dealerAlign','dealerX','dealerY','successAlign','successX','successY','courseLabelAlign','courseLabelX','courseLabelY','courseAlign','courseX','courseY','locationAlign','locationX','locationY','datesAlign','datesX','datesY','instructorAlign','instructorX','instructorY','managerAlign','managerX','managerY','certNoAlign','certNoX','certNoY','logoX','logoY'];
 const out={}; for(const k of keys){ if(q[k]!==undefined && String(q[k]).trim()!=='') out[k]=String(q[k]).trim(); }
 return out;
}

app.get('/instructor/student/:id/certificate/edit',auth,async(req,res)=>{
 const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours,c.created_at,c.company_id,c.created_by_user_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]);
 const st=q.rows[0]; if(!st) return res.status(404).send('Student not found');
 const quiz=(await pool.query("SELECT completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[st.id])).rows[0];
 const cert=await ensureCertificate(st.id);
 const startDate=formatCertDate(st.created_at||quiz?.completed_at||new Date());
 const endDate=formatCertDate(quiz?.completed_at||new Date());
 const prior=certOverrideFromQuery(req.query);
 const identity=await certificateIdentity(st);
 const val=(name,fallback='')=>prior[name]!==undefined?prior[name]:fallback;
 const form=(name,label,value,wide=false)=>`<label>${label}${wide?`<textarea name="${name}" rows="2">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}">`}</label>`;
 const alignRow=(key,label,defaultAlign='center')=>`<div class="align-row"><div><b>${esc(label)}</b></div><label>Alignment<select name="${key}Align"><option value="left" ${val(key+'Align',defaultAlign)==='left'?'selected':''}>Left</option><option value="center" ${val(key+'Align',defaultAlign)==='center'?'selected':''}>Center</option><option value="right" ${val(key+'Align',defaultAlign)==='right'?'selected':''}>Right</option></select></label><label>Move Left / Right<input type="number" min="-300" max="300" step="1" name="${key}X" value="${esc(val(key+'X','0'))}"></label><label>Move Up / Down<input type="number" min="-300" max="300" step="1" name="${key}Y" value="${esc(val(key+'Y','0'))}"></label></div>`;
 const logoRow=`<div class="align-row"><div><b>Company Logo</b></div><div></div><label>Move Left / Right<input type="number" min="-300" max="300" step="1" name="logoX" value="${esc(val('logoX','0'))}"></label><label>Move Up / Down<input type="number" min="-300" max="300" step="1" name="logoY" value="${esc(val('logoY','0'))}"></label></div>`;
 res.send(layout('Edit Certificate', `<div class="toolbar"><a class="btn light" href="/instructor/student/${st.id}">← Student Record</a></div><form method="get" action="/instructor/student/${st.id}/certificate"><div class="card"><div class="eyebrow">CERTIFICATE EDITOR</div><div class="big">Edit Before Printing</div><p class="muted">Change the certificate wording and alignment here. These changes affect only this printable preview and do not change the permanent student or class record.</p><div class="grid">${form('organization','Certificate Header / Organization',val('organization',identity.organization))}${form('intro','Intro Wording',val('intro','This is to certify that'))}${form('name',brand('student_label','Student')+' Name',val('name',st.name))}${form('dealer',brand('organization_unit_label','Company / Location'),val('dealer',st.dealer))}${form('success','Completion Wording',val('success','has successfully completed'))}${form('courseLabel','Training Label',val('courseLabel','Technical Training on'))}${form('course','Course / Training Name',val('course',st.course))}${form('location','Location / Conducted At',val('location',brand('certificate_location','')))}${form('startDate','Start Date',val('startDate',startDate))}${form('endDate','End Date',val('endDate',endDate))}${form('instructor','Instructor Name',val('instructor',identity.instructor))}${form('instructorTitle','Instructor Title',val('instructorTitle',identity.instructorTitle))}${form('instructorOrg','Instructor Organization',val('instructorOrg',identity.instructorOrg))}${form('managerName','Manager Name',val('managerName',identity.managerName))}${form('managerTitle','Manager Title',val('managerTitle',identity.managerTitle))}${form('managerOrg','Manager Organization',val('managerOrg',identity.managerOrg))}${form('certificateNo','Certificate Number',val('certificateNo',cert))}</div></div><div class="card"><div class="eyebrow">ALIGNMENT & POSITION</div><div class="big">Move Certificate Elements</div><p class="muted">Alignment changes text within its area. Position values move the element in pixels: negative horizontal values move left, positive move right; negative vertical values move up, positive move down.</p><div class="align-table">${logoRow}${alignRow('title','Certificate Header')}${alignRow('intro','Intro Wording')}${alignRow('name',brand('student_label','Student')+' Name')}${alignRow('dealer',brand('organization_unit_label','Company / Location'))}${alignRow('success','Completion Wording')}${alignRow('courseLabel','Training Label','left')}${alignRow('course','Course Name')}${alignRow('location','Location')}${alignRow('dates','Dates')}${alignRow('instructor','Instructor Signature Block')}${alignRow('manager','Manager Signature Block')}${alignRow('certNo','Certificate Number')}</div><div class="alert" style="margin-top:14px"><b>Tip:</b> Start with small adjustments such as 10 or -10. Preview the certificate, then click Edit Certificate again to fine-tune it.</div></div><div class="toolbar"><button>Preview Edited Certificate</button><button type="reset" class="btn light">Reset Form</button></div></form>`, `<style>.align-table{display:grid;gap:9px}.align-row{display:grid;grid-template-columns:minmax(180px,1.4fr) repeat(3,minmax(130px,1fr));gap:10px;align-items:end;border:1px solid #ddd;border-radius:10px;padding:10px;background:#fafafa}.align-row label{margin:0;font-size:13px}.align-row input,.align-row select{margin-top:3px}@media(max-width:850px){.align-row{grid-template-columns:1fr 1fr}.align-row>div:first-child{grid-column:1/-1}}</style>`));
});

app.get('/instructor/student/:id/certificate',auth,async(req,res)=>{
 const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours,c.created_at,c.company_id,c.created_by_user_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]);
 const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
 const quiz=(await pool.query("SELECT completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id])).rows[0];
 const cert=await ensureCertificate(s.id);
 const startDate=formatCertDate(s.created_at||quiz?.completed_at||new Date());
 const endDate=formatCertDate(quiz?.completed_at||new Date());
 const overrides=certOverrideFromQuery(req.query); const editQs=new URLSearchParams(overrides).toString(); const identity=await certificateIdentity(s); const certView=certificateMarkup(s,cert,startDate,endDate,'',{...identity,...overrides,editHref:`/instructor/student/${s.id}/certificate/edit?${editQs}`});
 res.send(layout('Certificate',certView.body,certView.css));
});
app.get('/instructor/history',auth,async(req,res)=>{
 const term=(req.query.q||'').trim();
 const classParams=[req.account.company_id]; let classWhere='WHERE c.company_id=$1'; if(term){classParams.push('%'+term+'%'); classWhere+=' AND (s.name ILIKE $2 OR s.dealer ILIKE $2 OR c.course ILIKE $2)';}
 const classQ=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score,s.joined_at,'class'::text source FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id ${classWhere} GROUP BY s.id,c.course,c.code,s.joined_at ORDER BY s.joined_at DESC LIMIT 200`,classParams);
 const programParams=[req.account.company_id]; let programWhere='WHERE p.company_id=$1'; if(term){programParams.push('%'+term+'%'); programWhere+=' AND (ps.name ILIKE $2 OR ps.dealer ILIKE $2 OR p.title ILIKE $2)';}
 const programQ=await pool.query(`SELECT ps.id,ps.name,ps.dealer,p.title course,p.join_code code,COALESCE(round(avg(a.score) FILTER (WHERE a.status='completed')),0)::int avg_score,ps.joined_at,'program'::text source FROM program_students ps JOIN training_programs p ON p.id=ps.program_id LEFT JOIN program_test_attempts a ON a.student_id=ps.id ${programWhere} GROUP BY ps.id,p.title,p.join_code,ps.joined_at ORDER BY ps.joined_at DESC LIMIT 200`,programParams);
 const acs=await allowedCourseSet(req.account); let combined=[...classQ.rows,...programQ.rows].sort((a,b)=>new Date(b.joined_at)-new Date(a.joined_at)).slice(0,300); if(acs)combined=combined.filter(x=>x.source==='program'||acs.has(x.course));
 const rows=combined.map(x=>x.source==='program'?`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer||'')}</td><td>${esc(x.course)}<br><span class="pill open">Modular Program</span></td><td>${x.avg_score}%</td><td class="nowrap"><a class="btn light" href="/instructor/program-student/${x.id}">Open</a> <form method="post" action="/instructor/program-student/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(x.name)} and ALL Modular Program results?')"><button class="danger" style="padding:10px 12px">Delete</button></form></td></tr>`:`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer)}</td><td>${esc(x.course)}</td><td>${x.avg_score}%</td><td class="nowrap"><a class="btn light" href="/instructor/student/${x.id}">Open</a> <form method="post" action="/instructor/student/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(x.name)} and ALL associated results?')"><button class="danger" style="padding:10px 12px">Delete</button></form></td></tr>`).join('');
 res.send(layout('Student Records', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">Dashboard</a><a class="btn" href="/instructor/performance">Performance & Feedback</a></div><div class="card"><div class="big">Student Records</div><p class="muted">Live Class and Modular Program student records are stored and displayed together.</p><form method="get"><label>Search student, dealer, course, or program<input name="q" value="${esc(term)}"></label><button>Search</button></form><table><tr><th>${esc(brand('student_label','Student'))}</th><th>${esc(brand('organization_unit_label','Company / Location'))}</th><th>Course / Program</th><th>Average</th><th></th></tr>${rows||'<tr><td colspan="5">No student records yet.</td></tr>'}</table></div>`));
});

app.get('/instructor/program-student/:id',auth,async(req,res)=>{
 const st=(await pool.query(`SELECT ps.*,p.title program_title,p.company_id FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND p.company_id=$2`,[req.params.id,req.account.company_id])).rows[0]; if(!st)return res.status(404).send('Program student not found');
 const tests=(await pool.query(`SELECT a.*,m.title module_title,b.title bank_title FROM program_test_attempts a JOIN program_modules m ON m.id=a.module_id JOIN program_test_banks b ON b.id=a.bank_id WHERE a.student_id=$1 AND a.status='completed' ORDER BY a.completed_at DESC,a.id DESC`,[st.id])).rows;
 const progress=(await pool.query(`SELECT m.title,m.activity_type,mp.completed,mp.completed_at FROM program_modules m JOIN program_sections s ON s.id=m.section_id LEFT JOIN program_module_progress mp ON mp.module_id=m.id AND mp.student_id=$1 WHERE s.program_id=$2 AND m.active=true ORDER BY s.display_order,s.id,m.display_order,m.id`,[st.id,st.program_id])).rows;
 const avg=tests.length?Math.round(tests.reduce((n,a)=>n+Number(a.score||0),0)/tests.length):0; const completed=progress.filter(x=>x.completed).length;
 const testRows=tests.map(a=>`<tr><td><b>${esc(a.module_title)}</b><br><span class="small muted">${esc(a.test_mode||'Test')}</span></td><td>${a.score}%</td><td>${a.correct_count}/${a.total_questions}</td><td>${a.completed_at?new Date(a.completed_at).toLocaleString():''}</td></tr>`).join('');
 const progRows=progress.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.activity_type||'')}</td><td><span class="pill ${x.completed?'open':'closed'}">${x.completed?'Complete':'Open'}</span></td><td>${x.completed_at?new Date(x.completed_at).toLocaleString():''}</td></tr>`).join('');
 res.send(layout('Modular Program Student Record',`<div class="toolbar no-print"><a class="btn light" href="/instructor/history">← Student Records</a><a class="btn" target="_blank" href="/instructor/program-student/${st.id}/report">Print Report</a></div><div class="hero"><div><div class="eyebrow">MODULAR PROGRAM STUDENT RECORD</div><h1>${esc(st.name)}</h1><p>${esc(st.program_title)} · ${esc(st.dealer||'')}</p></div></div><div class="grid"><div class="stat"><span>TEST AVERAGE</span><b>${avg}%</b></div><div class="stat"><span>SCORED TESTS</span><b>${tests.length}</b></div><div class="stat"><span>MODULES COMPLETE</span><b>${completed}/${progress.length}</b></div></div><div class="card"><div class="big">Test Results</div><div style="overflow:auto"><table><tr><th>Module</th><th>Score</th><th>Correct</th><th>Completed</th></tr>${testRows||'<tr><td colspan="4">No completed tests yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Module Progress</div><div style="overflow:auto"><table><tr><th>Module</th><th>Type</th><th>Status</th><th>Completed</th></tr>${progRows||'<tr><td colspan="4">No modules found.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/program-student/:id/report',auth,async(req,res)=>{
 const st=(await pool.query(`SELECT ps.*,p.title program_title,p.company_id FROM program_students ps JOIN training_programs p ON p.id=ps.program_id WHERE ps.id=$1 AND p.company_id=$2`,[req.params.id,req.account.company_id])).rows[0]; if(!st)return res.status(404).send('Program student not found');
 const tests=(await pool.query(`SELECT a.*,m.title module_title FROM program_test_attempts a JOIN program_modules m ON m.id=a.module_id WHERE a.student_id=$1 AND a.status='completed' ORDER BY a.completed_at,a.id`,[st.id])).rows;
 const progress=(await pool.query(`SELECT m.title,m.activity_type,mp.completed,mp.completed_at FROM program_modules m JOIN program_sections s ON s.id=m.section_id LEFT JOIN program_module_progress mp ON mp.module_id=m.id AND mp.student_id=$1 WHERE s.program_id=$2 AND m.active=true ORDER BY s.display_order,s.id,m.display_order,m.id`,[st.id,st.program_id])).rows;
 const avg=tests.length?Math.round(tests.reduce((n,a)=>n+Number(a.score||0),0)/tests.length):0;
 res.send(layout('Training Record',`<div class="toolbar no-print"><button onclick="window.print()">Print</button><a class="btn light" href="/instructor/program-student/${st.id}">Back</a></div><div class="card"><div class="eyebrow">THE TRAINING HUB · MODULAR PROGRAM RECORD</div><div class="big">${esc(st.name)}</div><p><b>Program:</b> ${esc(st.program_title)}<br><b>${esc(brand('organization_unit_label','Company / Location'))}:</b> ${esc(st.dealer||'')}<br><b>Joined:</b> ${st.joined_at?new Date(st.joined_at).toLocaleString():''}</p><div class="grid"><div class="stat"><span>TEST AVERAGE</span><b>${avg}%</b></div><div class="stat"><span>TESTS COMPLETE</span><b>${tests.length}</b></div><div class="stat"><span>MODULES COMPLETE</span><b>${progress.filter(x=>x.completed).length}/${progress.length}</b></div></div></div><div class="card"><div class="big">Scored Assessments</div><table><tr><th>Module</th><th>Score</th><th>Correct</th><th>Date</th></tr>${tests.map(a=>`<tr><td>${esc(a.module_title)}</td><td>${a.score}%</td><td>${a.correct_count}/${a.total_questions}</td><td>${a.completed_at?new Date(a.completed_at).toLocaleString():''}</td></tr>`).join('')||'<tr><td colspan="4">No completed assessments.</td></tr>'}</table></div><div class="card"><div class="big">Module Completion</div><table><tr><th>Module</th><th>Activity</th><th>Status</th><th>Date</th></tr>${progress.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.activity_type||'')}</td><td>${x.completed?'Complete':'Open'}</td><td>${x.completed_at?new Date(x.completed_at).toLocaleString():''}</td></tr>`).join('')}</table></div>`));
});

app.post('/instructor/program-student/:id/delete',auth,async(req,res)=>{ await pool.query(`DELETE FROM program_students ps USING training_programs p WHERE ps.id=$1 AND p.id=ps.program_id AND p.company_id=$2`,[req.params.id,req.account.company_id]); res.redirect('/instructor/history'); });



function driveDirectUrl(raw=''){
 const u=String(raw||'').trim();
 const m=u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]+)/i);
 return m?`https://drive.google.com/uc?export=download&id=${m[1]}`:u;
}
function fmtTime(sec){ sec=Math.max(0,Number(sec)||0); const m=Math.floor(sec/60),s=Math.floor(sec%60); return `${m}:${String(s).padStart(2,'0')}`; }

app.get('/instructor/videos',auth,async(req,res)=>{
 const q=await pool.query(`SELECT c.id,c.course,c.title,c.code,c.active,count(v.id)::int videos FROM classes c LEFT JOIN training_videos v ON v.class_id=c.id WHERE c.company_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`,[req.account.company_id]);
 const acs=await allowedCourseSet(req.account); const visibleVideos=acs?q.rows.filter(c=>acs.has(c.course)):q.rows; const rows=visibleVideos.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="small muted">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td>${c.videos}</td><td><a class="btn" href="/instructor/videos/${c.id}">Manage Videos</a></td></tr>`).join('');
 res.send(layout('Interactive Videos', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="card"><div class="big">Interactive Video Training</div><p class="muted">Choose a class, add the company training video, and place editable quiz questions at exact timestamps.</p><div style="overflow:auto"><table><tr><th>Course</th><th>Code</th><th>Videos</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/videos/:cid',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.cid])).rows[0]; if(!c) return res.status(404).send('Class not found');
 const videos=await pool.query(`SELECT v.*,count(q.id)::int questions FROM training_videos v LEFT JOIN video_questions q ON q.video_id=v.id WHERE v.class_id=$1 GROUP BY v.id ORDER BY v.display_order,v.id`,[c.id]);
 const cards=[];
 for(const v of videos.rows){
  await ensureEmbeddedQuestionsForVideo(v);
  const qs=await pool.query('SELECT * FROM video_questions WHERE video_id=$1 ORDER BY timestamp_seconds,id',[v.id]);
  const qrows=qs.rows.map(q=>{ const ch=Array.isArray(q.choices)?q.choices:[]; const qm=Math.floor((Number(q.timestamp_seconds)||0)/60), qsx=Math.floor((Number(q.timestamp_seconds)||0)%60); return `<div class="q"><div class="section-title"><div><span class="pill">${fmtTime(q.timestamp_seconds)}</span> <b>${esc(q.question)}</b></div><details><summary class="btn light" style="cursor:pointer;display:inline-block">Edit Question / Time</summary><div class="card" style="margin-top:10px;padding:14px"><form method="post" action="/instructor/videos/${c.id}/question/${q.id}/edit"><div class="grid"><label>Trigger Minute<input type="number" name="minute" min="0" value="${qm}" required></label><label>Trigger Second<input type="number" name="second" min="0" max="59" value="${qsx}" required></label></div><label>Question<textarea name="question" required>${esc(q.question)}</textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" value="${esc(ch[i]||'')}" required></label>`).join('')}<label>Correct Answer<select name="answer">${['A','B','C','D'].map((x,i)=>`<option value="${i}" ${i===q.answer_index?'selected':''}>${x}</option>`).join('')}</select></label><label>Feedback / Explanation<textarea name="explanation" rows="3">${esc(q.explanation||'')}</textarea></label><div class="grid"><label>Parts Cannon Penalty<input type="number" min="0" name="penalty" value="${Math.max(0,Number(q.parts_cannon_penalty)||0)}"></label><label><input style="width:auto" type="checkbox" name="require_correct" value="1" ${q.require_correct?'checked':''}> Must answer correctly before video continues</label></div><p class="small muted">Saving an edit resets prior attempts for this question so students receive the updated version and trigger time.</p><button>Save Question Changes</button></form></div></details></div><div class="small muted" style="margin-top:6px">${ch.map((x,i)=>`${String.fromCharCode(65+i)}. ${esc(x)}${i===q.answer_index?' ✓':''}`).join(' · ')}</div><div class="small"><b>Retry:</b> ${q.require_correct?'Must answer correctly':'Continue after answer'} · <b>Parts Cannon:</b> ${q.parts_cannon_penalty||0}</div><form method="post" action="/instructor/videos/${c.id}/question/${q.id}/delete" style="margin-top:8px"><button class="danger" onclick="return confirm('Delete this video question?')">Delete Question</button></form></div>`; }).join('');
  cards.push(`<div class="card"><div class="section-title"><div><div class="eyebrow">Interactive Video</div><div class="big">${esc(v.title)}</div></div><span class="pill ${v.active?'open':'closed'}">${v.active?'Active':'Hidden'}</span></div><p class="small muted" style="word-break:break-all">${esc(v.source_url)}</p><div class="toolbar"><form method="post" action="/instructor/videos/${c.id}/video/${v.id}/toggle"><button class="btn light">${v.active?'Hide':'Show'} Video</button></form><form method="post" action="/instructor/videos/${c.id}/video/${v.id}/delete" onsubmit="return confirm('Delete this video and all of its in-video questions?')"><button class="danger">Delete Video</button></form></div><hr><div class="big" style="font-size:18px">Add In-Video Question</div><form method="post" action="/instructor/videos/${c.id}/video/${v.id}/question"><div class="grid"><label>Minute<input type="number" name="minute" min="0" value="0" required></label><label>Second<input type="number" name="second" min="0" max="59" value="0" required></label></div><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Feedback / Explanation<textarea name="explanation" rows="3"></textarea></label><div class="grid"><label>Parts Cannon Penalty<input type="number" min="0" name="penalty" value="0"></label><label><input style="width:auto" type="checkbox" name="require_correct" value="1" checked> Must answer correctly before video continues</label></div><button>Add Video Question</button></form>${qrows||'<p class="muted">No in-video questions yet.</p>'}</div>`);
 }
 res.send(layout('Video Manager', `<div class="toolbar"><a class="btn light" href="/instructor/videos">← All Classes</a><a class="btn light" href="/instructor/class/${c.id}">Open Class</a></div><div class="card"><div class="eyebrow">${esc(c.course)}</div><div class="big">Interactive Video Manager</div><p class="muted">Built-in course videos are preloaded from this deployment. You can also paste a Google Drive sharing link for additional MP4 training.</p><form method="post" action="/instructor/videos/${c.id}/video"><label>Video Title<input name="title" placeholder="Example: Module 1 — Introduction" required></label><label>Video Source<input name="source_url" placeholder="/videos/example.mp4 or https://drive.google.com/file/d/.../view" required></label><label>Display Order<input type="number" name="display_order" value="0"></label><button>Add Training Video</button></form></div>${cards.join('')||'<div class="card"><p>No videos have been added to this class yet.</p></div>'}`));
});
app.post('/instructor/videos/:cid/video',auth,async(req,res)=>{ const title=(req.body.title||'').trim(),url=(req.body.source_url||'').trim(); if(title&&url) await pool.query('INSERT INTO training_videos(class_id,title,source_url,display_order) VALUES($1,$2,$3,$4)',[req.params.cid,title,url,Number(req.body.display_order)||0]); res.redirect(`/instructor/videos/${req.params.cid}`); });
app.post('/instructor/videos/:cid/video/:vid/toggle',auth,async(req,res)=>{ await pool.query('UPDATE training_videos SET active=NOT active WHERE id=$1 AND class_id=$2',[req.params.vid,req.params.cid]); res.redirect(`/instructor/videos/${req.params.cid}`); });
app.post('/instructor/videos/:cid/video/:vid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM training_videos WHERE id=$1 AND class_id=$2',[req.params.vid,req.params.cid]); res.redirect(`/instructor/videos/${req.params.cid}`); });
app.post('/instructor/videos/:cid/video/:vid/question',auth,async(req,res)=>{ const t=(Math.max(0,Number(req.body.minute)||0)*60)+Math.max(0,Math.min(59,Number(req.body.second)||0)); await pool.query('INSERT INTO video_questions(video_id,timestamp_seconds,question,choices,answer_index,explanation,require_correct,parts_cannon_penalty) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[req.params.vid,t,(req.body.question||'').trim(),JSON.stringify([req.body.c0||'',req.body.c1||'',req.body.c2||'',req.body.c3||'']),Math.max(0,Math.min(3,Number(req.body.answer)||0)),req.body.explanation||'',!!req.body.require_correct,Math.max(0,Number(req.body.penalty)||0)]); res.redirect(`/instructor/videos/${req.params.cid}`); });
app.post('/instructor/videos/:cid/question/:qid/edit',auth,async(req,res)=>{ const t=(Math.max(0,Number(req.body.minute)||0)*60)+Math.max(0,Math.min(59,Number(req.body.second)||0)); const q=(await pool.query('SELECT q.id FROM video_questions q JOIN training_videos v ON v.id=q.video_id WHERE q.id=$1 AND v.class_id=$2',[req.params.qid,req.params.cid])).rows[0]; if(!q) return res.status(404).send('Video question not found'); await pool.query('UPDATE video_questions SET timestamp_seconds=$2,question=$3,choices=$4,answer_index=$5,explanation=$6,require_correct=$7,parts_cannon_penalty=$8 WHERE id=$1',[q.id,t,(req.body.question||'').trim(),JSON.stringify([req.body.c0||'',req.body.c1||'',req.body.c2||'',req.body.c3||'']),Math.max(0,Math.min(3,Number(req.body.answer)||0)),req.body.explanation||'',!!req.body.require_correct,Math.max(0,Number(req.body.penalty)||0)]); await pool.query('DELETE FROM video_question_attempts WHERE question_id=$1',[q.id]); res.redirect(`/instructor/videos/${req.params.cid}`); });
app.post('/instructor/videos/:cid/question/:qid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM video_questions WHERE id=$1 AND video_id IN (SELECT id FROM training_videos WHERE class_id=$2)',[req.params.qid,req.params.cid]); res.redirect(`/instructor/videos/${req.params.cid}`); });

app.get('/student/:id/video/:vid',async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
 const v=(await pool.query('SELECT * FROM training_videos WHERE id=$1 AND class_id=$2 AND active=true',[req.params.vid,s.class_id])).rows[0]; if(!v) return res.status(404).send('Video not found');
 await ensureEmbeddedQuestionsForVideo(v);
 const qs=await pool.query('SELECT * FROM video_questions WHERE video_id=$1 ORDER BY timestamp_seconds,id',[v.id]);
 const prog=(await pool.query('SELECT * FROM video_progress WHERE student_id=$1 AND video_id=$2',[s.id,v.id])).rows[0]||{};
 const attempts=await pool.query('SELECT question_id,correct,first_correct,attempts,parts_cannon FROM video_question_attempts WHERE student_id=$1 AND question_id=ANY($2::int[])',[s.id,qs.rows.map(x=>x.id)]);
 const attemptMap=Object.fromEntries(attempts.rows.map(x=>[x.question_id,x]));
 const data=qs.rows.map(q=>({id:q.id,time:q.timestamp_seconds,question:q.question,choices:q.choices,answer:q.answer_index,explanation:q.explanation||'',requireCorrect:q.require_correct,penalty:q.parts_cannon_penalty||0,done:!!attemptMap[q.id]?.correct||(!q.require_correct&&!!attemptMap[q.id]?.attempts)}));
 const src=driveDirectUrl(v.source_url);
 const extra=`<style>.video-shell{position:relative;background:#111;border-radius:14px;overflow:hidden}.video-shell video{display:block;width:100%;max-height:70vh;background:#000}.quiz-overlay{position:absolute;inset:0;background:rgba(0,0,0,.88);color:#fff;display:none;align-items:center;justify-content:center;padding:18px}.quiz-panel{width:min(720px,100%);background:#fff;color:#1d1d1d;border-radius:16px;padding:22px;max-height:90%;overflow:auto}#quizChoices button.video-answer{display:block!important;width:100%!important;text-align:left!important;margin:9px 0!important;background:#f2f2f2!important;color:#111!important;-webkit-text-fill-color:#111!important;border:1px solid #cfcfcf!important;border-radius:10px!important;padding:13px 15px!important;font-weight:750!important;opacity:1!important}#quizChoices button.video-answer:hover{background:#e4e4e4!important;color:#111!important;-webkit-text-fill-color:#111!important}#quizChoices button.video-answer.good{background:#dff3e4!important;color:#155d2d!important;-webkit-text-fill-color:#155d2d!important;border-color:#8fc99c!important}#quizChoices button.video-answer.bad{background:#fff0a8!important;color:#4f3a00!important;-webkit-text-fill-color:#4f3a00!important;border-color:#d6a800!important}.video-progressline{height:10px;background:#e5e5e5;border-radius:99px;overflow:hidden}.video-progressline span{display:block;height:100%;background:var(--red)}</style>`;
 res.send(layout(v.title, `<div class="toolbar"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">← Back to Training</a></div><div class="card"><div class="eyebrow">Interactive Video Training</div><div class="big">${esc(v.title)}</div><p class="muted">The video will pause when a question appears. Answer it to continue.</p><div class="video-progressline"><span id="vpBar" style="width:0%"></span></div><p class="small muted" id="vpText">Loading video…</p></div><div class="video-shell"><video id="trainingVideo" controls playsinline preload="metadata" src="${esc(src)}"></video><div class="quiz-overlay" id="quizOverlay"><div class="quiz-panel"><span class="pill" id="quizTime"></span><div class="big" id="quizQuestion" style="margin:12px 0"></div><div id="quizChoices"></div><div id="quizFeedback" style="margin-top:12px"></div><button type="button" id="continueBtn" style="display:none;margin-top:12px">Continue Video</button></div></div></div><div class="card"><div class="grid"><div class="stat"><span>Questions</span><b>${qs.rowCount}</b></div><div class="stat"><span>Saved Position</span><b>${fmtTime(prog.last_second||0)}</b></div><div class="stat"><span>Status</span><b>${prog.completed?'Complete':'In Progress'}</b></div></div><div class="toolbar" style="margin-top:12px"><span class="pill open" id="videoEngineStatus">Question engine starting…</span><button type="button" class="btn light" id="testNextQuestion">Test Next Question</button></div><div id="videoError" class="alert" style="display:none;margin-top:12px"><b>Video could not be played.</b><br>This training video file is not available from the deployed app. Confirm the complete 1.0 deployment, including public/videos, was uploaded and deployed.</div></div>`, extra+`<script>
document.addEventListener('DOMContentLoaded',()=>{
const video=document.getElementById('trainingVideo'),overlay=document.getElementById('quizOverlay'),qText=document.getElementById('quizQuestion'),choices=document.getElementById('quizChoices'),feedback=document.getElementById('quizFeedback'),continueBtn=document.getElementById('continueBtn'),timeBadge=document.getElementById('quizTime'),bar=document.getElementById('vpBar'),statusText=document.getElementById('vpText'),errorBox=document.getElementById('videoError');
const questions=${JSON.stringify(data)}.map(q=>({...q,time:Number(q.time)||0,done:!!q.done})).sort((a,b)=>a.time-b.time); let active=null,lastSave=0,lockedAt=null;
function ftime(n){n=Math.max(0,Math.floor(Number(n)||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')}
function nextPending(){return questions.find(q=>!q.done)}
function safeChoices(q){if(Array.isArray(q.choices))return q.choices;try{const x=JSON.parse(q.choices);return Array.isArray(x)?x:[]}catch(e){return []}}
async function post(payload){try{await fetch('/student/${s.id}/video/${v.id}/progress?token=${encodeURIComponent(s.join_token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}catch(e){}}
function updateEngineStatus(){const el=document.getElementById('videoEngineStatus');if(!el)return;const q=nextPending();el.textContent='Question engine active'+(q?' · Next '+ftime(q.time):' · All questions complete');}
function showQuestion(q){
 if(active||!q||q.done)return;
 active=q;lockedAt=Number(q.time)||0;
 try{video.pause();}catch(e){}
 try{video.currentTime=Math.max(0,lockedAt);}catch(e){}
 overlay.style.display='flex';overlay.style.zIndex='9999';
 qText.textContent=q.question;timeBadge.textContent='Question at '+ftime(q.time);feedback.innerHTML='';continueBtn.style.display='none';choices.innerHTML='';
 const opts=safeChoices(q);
 opts.forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.className='video-answer';b.textContent=String.fromCharCode(65+i)+'. '+label;b.addEventListener('click',()=>answer(q,i,b));choices.appendChild(b);});
 if(!opts.length){feedback.innerHTML='<div class="alert"><b>Question choices could not be loaded.</b></div>';}
 updateEngineStatus();
}
function checkQuestionTrigger(force=false){
 if(active||!questions.length)return;
 const q=nextPending();if(!q)return;
 const now=Number(video.currentTime)||0;
 if(force||now+0.40>=q.time)showQuestion(q);
 updateEngineStatus();
}
async function answer(q,index,btn){const correct=index===q.answer;[...choices.children].forEach(b=>b.disabled=true);btn.classList.add(correct?'good':'bad'); if(correct){feedback.innerHTML='<div class="success"><b>Correct.</b> '+(q.explanation||'Continue when ready.')+'</div>';q.done=true;continueBtn.style.display='inline-block';}else{feedback.innerHTML='<div class="alert"><b>Review that choice.</b> '+(q.explanation||'Try the question again.')+(q.penalty?' <b>Parts Cannon +'+q.penalty+'</b>':'')+'</div>';if(q.requireCorrect){setTimeout(()=>{[...choices.children].forEach(b=>{b.disabled=false;b.classList.remove('bad')})},700);}else{q.done=true;continueBtn.style.display='inline-block';}} await post({type:'answer',questionId:q.id,selectedIndex:index});}
continueBtn.addEventListener('click',()=>{overlay.style.display='none';active=null;lockedAt=null;updateEngineStatus();video.play().catch(()=>{});});
const testBtn=document.getElementById('testNextQuestion');if(testBtn)testBtn.addEventListener('click',()=>checkQuestionTrigger(true));
video.addEventListener('loadedmetadata',()=>{const saved=${Number(prog.last_second||0)};const pending=nextPending();let resume=saved;if(pending&&resume>pending.time)resume=Math.max(0,pending.time-0.5);if(resume>1&&resume<video.duration-2)video.currentTime=resume;statusText.textContent='Resume position '+ftime(resume)+' · '+questions.filter(q=>q.done).length+' of '+questions.length+' questions completed';updateEngineStatus();setTimeout(()=>checkQuestionTrigger(false),100);});
video.addEventListener('timeupdate',()=>{if(video.duration){bar.style.width=Math.min(100,(video.currentTime/video.duration)*100)+'%';statusText.textContent=ftime(video.currentTime)+' / '+ftime(video.duration)+' · '+questions.filter(q=>q.done).length+' of '+questions.length+' questions completed';}checkQuestionTrigger(false);if(Date.now()-lastSave>5000){lastSave=Date.now();post({type:'progress',second:video.currentTime});}});
video.addEventListener('play',()=>checkQuestionTrigger(false));
video.addEventListener('playing',()=>checkQuestionTrigger(false));
video.addEventListener('seeked',()=>checkQuestionTrigger(false));
video.addEventListener('ratechange',()=>checkQuestionTrigger(false));
video.addEventListener('seeking',()=>{const p=nextPending();if(p&&!active&&Number(video.currentTime)>p.time+0.5){try{video.currentTime=Math.max(0,p.time-0.25)}catch(e){};setTimeout(()=>checkQuestionTrigger(false),50);}});
// Fail-safe polling PLUS animation-frame checking. Either path can trigger the next question.
// 2.1.79: timeupdate + a light watchdog is enough for question timing and uses much less browser CPU than a per-frame loop.
const questionWatchdog=setInterval(()=>{if(!active&&!video.ended)checkQuestionTrigger(false);},250);
window.addEventListener('beforeunload',()=>{clearInterval(questionWatchdog);cancelAnimationFrame(rafId)});
window.addEventListener('error',e=>{const el=document.getElementById('videoEngineStatus');if(el){el.textContent='Question engine error: '+(e.message||'unknown');el.className='pill closed';}});
updateEngineStatus();
video.addEventListener('ended',async()=>{const pending=nextPending();if(pending){video.currentTime=Math.max(0,Number(pending.time));showQuestion(pending);return;}await post({type:'complete',second:video.duration||video.currentTime});statusText.textContent='Video complete';bar.style.width='100%';setTimeout(()=>location.href='/student/${s.id}?token=${encodeURIComponent(s.join_token)}',700);});
video.addEventListener('error',()=>{errorBox.style.display='block';statusText.textContent='Video source unavailable';});
});
</script>`));
});
app.post('/student/:id/video/:vid/progress',async(req,res)=>{
 const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).json({ok:false});
 const v=(await pool.query('SELECT * FROM training_videos WHERE id=$1 AND class_id=$2',[req.params.vid,s.class_id])).rows[0]; if(!v) return res.status(404).json({ok:false});
 if(req.body.type==='answer'){
  const q=(await pool.query('SELECT * FROM video_questions WHERE id=$1 AND video_id=$2',[Number(req.body.questionId),v.id])).rows[0]; if(!q) return res.status(404).json({ok:false});
  const selected=Number(req.body.selectedIndex),correct=selected===q.answer_index,penalty=correct?0:Math.max(0,Number(q.parts_cannon_penalty)||0);
  await pool.query(`INSERT INTO video_question_attempts(student_id,question_id,selected_index,correct,first_correct,attempts,parts_cannon,updated_at) VALUES($1,$2,$3,$4,$4,1,$5,now()) ON CONFLICT(student_id,question_id) DO UPDATE SET selected_index=$3,correct=$4,attempts=video_question_attempts.attempts+1,parts_cannon=video_question_attempts.parts_cannon+$5,updated_at=now()`,[s.id,q.id,selected,correct,penalty]);
 }
 const second=Math.max(0,Number(req.body.second)||0); await pool.query(`INSERT INTO video_progress(student_id,video_id,last_second,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(student_id,video_id) DO UPDATE SET last_second=GREATEST(video_progress.last_second,$3),updated_at=now()`,[s.id,v.id,second]);
 const total=Number((await pool.query('SELECT count(*)::int n FROM video_questions WHERE video_id=$1',[v.id])).rows[0].n); const a=(await pool.query(`SELECT count(*)::int answered,count(*) FILTER (WHERE first_correct)::int first_correct,coalesce(sum(parts_cannon),0)::int parts FROM video_question_attempts a JOIN video_questions q ON q.id=a.question_id WHERE a.student_id=$1 AND q.video_id=$2`,[s.id,v.id])).rows[0]; const score=total?Math.round(Number(a.first_correct)/total*100):100;
 const status=req.body.type==='complete'?'Finished':'Video'; await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Interactive Video',$2,$3,$4,$5,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Interactive Video',status=$2,progress=$3,total=$4,current_score=$5,updated_at=now()`,[s.id,status,Number(a.answered),total,score]);
 if(req.body.type==='complete'){
  await pool.query('UPDATE video_progress SET completed=true,score=$3,last_second=GREATEST(last_second,$4),updated_at=now() WHERE student_id=$1 AND video_id=$2',[s.id,v.id,score,second]);
  const activity=`Interactive Video — ${v.title}`; await pool.query('DELETE FROM results WHERE student_id=$1 AND activity=$2',[s.id,activity]); await pool.query('INSERT INTO results(student_id,activity,score,details) VALUES($1,$2,$3,$4)',[s.id,activity,score,JSON.stringify({video_id:v.id,title:v.title,questions:total,first_correct:Number(a.first_correct),parts_cannon:Number(a.parts)})]);
 }
 res.json({ok:true,score,answered:Number(a.answered),total,partsCannon:Number(a.parts)});
});


function companyAdminOnly(req,res,next){ if(!isCompanyAdminRole(req.account?.role)) return res.status(403).send(layout('Company Admin Required',`<div class="card"><div class="big">Company administrator access required</div><p>This area manages company accounts, branding, and permissions.</p><a class="btn" href="/instructor/dashboard">Return to Dashboard</a></div>`)); next(); }
async function companyStaffUser(companyId,userId){ const q=await pool.query('SELECT * FROM app_users WHERE id=$1 AND company_id=$2',[userId,companyId]); return q.rows[0]||null; }
app.get('/instructor/team',auth,companyAdminOnly,async(req,res)=>{
 const users=(await pool.query(`SELECT u.*,coalesce(string_agg(p.course_name, ', ' ORDER BY p.course_name),'') course_list FROM app_users u LEFT JOIN user_course_permissions p ON p.user_id=u.id WHERE u.company_id=$1 GROUP BY u.id ORDER BY CASE u.role WHEN 'company_admin' THEN 1 WHEN 'instructor' THEN 2 ELSE 3 END,u.name`,[req.account.company_id])).rows;
 const rows=users.map(u=>`<tr><td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.email)}</span></td><td>${esc(roleLabel(u.role))}</td><td>${u.all_courses?'<span class="pill open">All Courses</span>':esc(u.course_list||'No courses assigned')}</td><td><span class="pill ${u.active?'open':'closed'}">${u.active?'Active':'Disabled'}</span></td><td class="nowrap">${u.role!=='company_admin'?`<a class="btn light" href="/instructor/team/user/${u.id}/courses">Courses</a> <form method="post" action="/instructor/team/user/${u.id}/toggle" style="display:inline"><button class="btn light">${u.active?'Disable':'Enable'}</button></form>`:'<span class="muted small">Admin account</span>'}</td></tr>`).join('');
 res.send(layout('Team & Permissions',`<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a></div><div class="hero"><div><div class="eyebrow">COMPANY ADMINISTRATION</div><h1>Team & Permissions</h1><p class="muted">Create instructors and managers, then control which courses they can view, run, and edit.</p></div></div><div class="grid"><div class="card"><div class="big">Add Instructor</div><form method="post" action="/instructor/team/user"><input type="hidden" name="role" value="instructor"><label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Temporary Password<input type="password" name="password" minlength="8" required></label><button>Add Instructor</button></form></div><div class="card"><div class="big">Add Viewer / Manager</div><form method="post" action="/instructor/team/user"><input type="hidden" name="role" value="viewer"><label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Temporary Password<input type="password" name="password" minlength="8" required></label><button>Add Viewer</button></form><p class="small muted">Viewers can monitor records and reports but cannot change training content.</p></div></div><div class="card"><div class="big">Company Accounts</div><div style="overflow:auto"><table><tr><th>User</th><th>Role</th><th>Course Access</th><th>Status</th><th>Actions</th></tr>${rows||'<tr><td colspan="5">No company users yet.</td></tr>'}</table></div></div>`));
});
app.post('/instructor/team/user',auth,companyAdminOnly,async(req,res)=>{ try{ const u=await createCompanyUser(req.account.company_id,req.body,['instructor','viewer']); await auditEvent(req,'COMPANY_USER_CREATED',`${u.email} · ${u.role}`,'ok'); res.redirect('/instructor/team'); }catch(e){res.status(400).send(layout('User Not Created',`<div class="card"><div class="big">Could not create user</div><div class="alert">${esc(e.message)}</div><a class="btn" href="/instructor/team">Back</a></div>`));} });
app.post('/instructor/team/user/:id/toggle',auth,companyAdminOnly,async(req,res)=>{ const u=await companyStaffUser(req.account.company_id,req.params.id); if(!u||u.role==='company_admin')return res.status(404).send('User not found'); await pool.query('UPDATE app_users SET active=NOT active WHERE id=$1',[u.id]); await auditEvent(req,'COMPANY_USER_STATUS',`${u.email}`,'ok'); res.redirect('/instructor/team'); });
app.get('/instructor/team/user/:id/courses',auth,companyAdminOnly,async(req,res)=>{
 const u=await companyStaffUser(req.account.company_id,req.params.id); if(!u||u.role==='company_admin')return res.status(404).send('User not found'); const courses=(await pool.query('SELECT * FROM company_courses WHERE company_id=$1 AND active=true ORDER BY name',[req.account.company_id])).rows; const perms=new Map((await pool.query('SELECT * FROM user_course_permissions WHERE user_id=$1',[u.id])).rows.map(x=>[x.course_name,x]));
 res.send(layout('Course Permissions',`<div class="toolbar"><a class="btn light" href="/instructor/team">← Team & Permissions</a></div><div class="card"><div class="eyebrow">${esc(roleLabel(u.role))}</div><div class="big">${esc(u.name)} · Course Permissions</div><p>${esc(u.email)}</p><form method="post" action="/instructor/team/user/${u.id}/courses"><label><input type="checkbox" name="all_courses" value="1" style="width:auto" ${u.all_courses?'checked':''}> Access all current and future company courses</label><div class="card"><div class="big" style="font-size:18px">Specific Courses</div>${courses.map(c=>{const x=perms.get(c.name);return `<div class="grid" style="grid-template-columns:2fr 1fr 1fr;align-items:center;border-bottom:1px solid #eee;padding:8px 0"><b>${esc(c.name)}</b><label style="margin:0"><input type="checkbox" style="width:auto" name="view_${c.id}" value="1" ${x?.can_view?'checked':''}> View / Run</label><label style="margin:0"><input type="checkbox" style="width:auto" name="edit_${c.id}" value="1" ${x?.can_edit?'checked':''}> Edit</label></div>`}).join('')}</div><button>Save Permissions</button></form></div><div class="card"><div class="big">Reset Password</div><form method="post" action="/instructor/team/user/${u.id}/password"><label>New Temporary Password<input type="password" name="password" minlength="8" required></label><button>Reset Password</button></form></div>`));
});
app.post('/instructor/team/user/:id/courses',auth,companyAdminOnly,async(req,res)=>{ const u=await companyStaffUser(req.account.company_id,req.params.id); if(!u||u.role==='company_admin')return res.status(404).send('User not found'); const courses=(await pool.query('SELECT * FROM company_courses WHERE company_id=$1',[req.account.company_id])).rows; await pool.query('UPDATE app_users SET all_courses=$2 WHERE id=$1',[u.id,req.body.all_courses==='1']); await pool.query('DELETE FROM user_course_permissions WHERE user_id=$1',[u.id]); if(req.body.all_courses!=='1'){for(const c of courses){const view=req.body[`view_${c.id}`]==='1'||req.body[`edit_${c.id}`]==='1',edit=req.body[`edit_${c.id}`]==='1';if(view)await pool.query('INSERT INTO user_course_permissions(user_id,course_name,can_view,can_edit) VALUES($1,$2,$3,$4)',[u.id,c.name,view,edit]);}} await auditEvent(req,'COURSE_PERMISSIONS_UPDATED',u.email,'ok'); res.redirect(`/instructor/team/user/${u.id}/courses`); });
app.post('/instructor/team/user/:id/password',auth,companyAdminOnly,async(req,res)=>{ const u=await companyStaffUser(req.account.company_id,req.params.id); if(!u||u.role==='company_admin')return res.status(404).send('User not found'); const password=String(req.body.password||''); if(password.length<8)return res.status(400).send('Password must be at least 8 characters'); const ph=await hashPassword(password); await pool.query('UPDATE app_users SET password_salt=$2,password_hash=$3 WHERE id=$1',[u.id,ph.salt,ph.hash]); await auditEvent(req,'PASSWORD_RESET',u.email,'ok'); res.redirect(`/instructor/team/user/${u.id}/courses`); });

app.get('/instructor/admin',auth,companyAdminOnly,async(req,res)=>{
 const company=await companyById(req.account.company_id); if(!company)return res.status(404).send('Company not found'); await seedCompanyDefaults(company.id);
 const courses=await pool.query('SELECT * FROM company_courses WHERE company_id=$1 ORDER BY active DESC,name',[company.id]);
 const equipmentModels=await companyEquipmentModels(company.id,true);
 const settingsQ=await pool.query('SELECT key,value FROM company_settings WHERE company_id=$1',[company.id]); const settings={...BRAND_DEFAULTS,...Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]))}; settings.organization_name=company.name||settings.organization_name; settings.contact_email=company.contact_email||settings.contact_email; settings.contact_phone=company.contact_phone||settings.contact_phone; settings.website_url=company.website_url||settings.website_url;
 const courseRows=courses.rows.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Active':'Archived'}</span></td><td class="nowrap"><form method="post" action="/instructor/admin/course/${c.id}/toggle" style="display:inline"><button class="btn light">${c.active?'Archive':'Restore'}</button></form> <form method="post" action="/instructor/admin/course/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this course name from the catalog? Existing classes will not be deleted.')"><button class="danger">Delete</button></form></td></tr>`).join('');
 const equipmentRows=equipmentModels.map(m=>`<tr><td><form method="post" action="/instructor/admin/equipment/${m.id}/edit" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input name="name" value="${esc(m.name)}" required style="max-width:260px"><input name="display_order" type="number" value="${Number(m.display_order)||100}" style="max-width:100px"><button class="btn light">Save</button></form></td><td><span class="pill ${m.active?'open':'closed'}">${m.active?'Active':'Inactive'}</span></td><td class="nowrap"><form method="post" action="/instructor/admin/equipment/${m.id}/toggle" style="display:inline"><button class="btn light">${m.active?'Deactivate':'Activate'}</button></form> <form method="post" action="/instructor/admin/equipment/${m.id}/delete" style="display:inline" onsubmit="return confirm('Delete this equipment model from this company list? Existing class records will not be changed.')"><button class="danger">Delete</button></form></td></tr>`).join('');
 const f=(name,label,type='text')=>`<label>${esc(label)}<input type="${type}" name="${esc(name)}" value="${esc(settings[name]||'')}"></label>`;
 const dashDefs=[
  ['tests','Tests','Build and manage quiz questions.','📝',10],
  ['hunt','Scavenger Hunt','Choose equipment/stations, build hunt items, and print QR stations.','🔎',20],
  ['qrlabels','QR Label Center','View every scavenger-hunt QR label in one place, grouped by equipment model, and edit the matching hunt item.','🏷️',25],
  ['simulations','Simulation Library','Release diagnostic scenarios, choose hidden root causes, and review student diagnostic paths.','🛠️',30],
  ['master','Master Diagnostic Challenge','Build, edit, release, and score final practical diagnostic certification challenges.','🧠',40],
  ['prepost','Pre/Post Improvement','Compare starting knowledge to final test performance by class, student, and topic.','📈',50],
  ['videos','Interactive Videos','Add company training videos with editable timed questions, scoring, and penalty logic.','🎬',60],
  ['reports','Reports & Certificates','Print records and certificates for completed students.','🏆',70],
  ['feedback','Training Feedback','Review student ratings and comments.','★',80],
  ['programs','Modular Programs','Build multi-section training programs with modules and one program QR code.','🧩',90],
  ['team','Team & Permissions','Create instructors and managers, assign course access, and manage company accounts.','👥',100],
  ['admin','Admin & Content','Company branding, course catalog, wording, and training-system settings.','⚙️',110]
 ];
 if(await methodistDashEnabled(company.id))dashDefs.splice(9,0,['customdash','Dashboard','Open and manage company dashboards.','📊',76]);
 const dashRows=dashDefs.map(([id,defTitle,defDesc,defIcon,defOrder])=>{
   const prefix=`dash_${id}_`;
   const title=id==='programs'?(settings.program_tab_title||defTitle):(settings[prefix+'title']||defTitle);
   const description=id==='programs'?(settings.program_tab_description||defDesc):(settings[prefix+'description']||defDesc);
   const icon=id==='programs'?(settings.program_tab_icon||defIcon):(settings[prefix+'icon']||defIcon);
   const visible=id==='admin'?true:(id==='programs'?String(settings.program_tab_visible)!=='false':String(settings[prefix+'visible']??'true')!=='false');
   const order=Number(settings[prefix+'order']||defOrder)||defOrder;
   const color=safeHex(settings[prefix+'color']||settings.primary_color||'#c4141c',settings.primary_color||'#c4141c');
   return `<div class="card" style="border-top:6px solid ${esc(color)};margin:0"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="eyebrow">DASHBOARD TAB</div><div class="big">${esc(defTitle)}</div></div><div style="font-size:30px">${esc(icon)}</div></div><div class="grid"><label>Tab Name<input name="${prefix}title" value="${esc(title)}" required></label><label>Icon / Emoji<input name="${prefix}icon" value="${esc(icon)}"></label><label>Display Order<input type="number" name="${prefix}order" value="${order}"></label><label>Top Border Color<input type="color" name="${prefix}color" value="${esc(color)}"></label></div><label>Description<textarea name="${prefix}description" rows="2">${esc(description)}</textarea></label>${id==='admin'?'<div class="alert"><b>Always visible:</b> Admin & Content stays available to company administrators so the dashboard cannot be accidentally locked.</div>':`<label><input style="width:auto" type="checkbox" name="${prefix}visible" value="true" ${visible?'checked':''}> Show this tab on the dashboard</label>`}</div>`;
 }).join('');
 const dashboardTabsEditor=`<div class="card" style="border-top:6px solid var(--red)"><div class="section-title"><div><div class="eyebrow">COMPANY-SPECIFIC DASHBOARD</div><h2>Dashboard Tabs</h2><p class="muted">Rename, describe, reorder, recolor, show, or hide this company's dashboard cards. Changes affect only ${esc(company.name)}.</p></div></div><form method="post" action="/instructor/admin/dashboard-tabs"><div class="grid" style="align-items:stretch">${dashRows}</div><button style="margin-top:18px">Save Dashboard Tabs</button></form></div>`;
 res.send(layout('Admin Content Editor', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard">← Instructor Home</a><a class="btn light" href="/instructor/team">Team & Permissions</a></div><div class="hero"><div><div class="eyebrow">WHITE-LABEL COMPANY ADMIN · 2.0</div><h1>${esc(company.name)} · Company & Content Editor</h1><p class="muted">Customize this company without affecting any other company on the platform.</p></div></div><div class="card" style="border-top:6px solid var(--red)"><div class="big">Company Branding</div><form method="post" action="/instructor/admin/settings"><div class="grid">${f('app_name','Application Name')}${f('tagline','Header Tagline')}${f('organization_name','Company / Organization Name')}${f('logo_url','Logo URL or /public path')}${f('contact_email','Contact Email','email')}${f('contact_phone','Contact Phone')}${f('website_url','Website')}${f('copyright_holder','Copyright Holder')}${f('primary_color','Primary Color — hex, e.g. #c4141c')}${f('secondary_color','Header Color — hex')}${f('accent_color','Accent Color — hex')}${f('certificate_prefix','Certificate Number Prefix')}</div><label>Footer Text<input name="footer_text" value="${esc(settings.footer_text||'')}"></label><label>Instructor Home Message<textarea name="home_message" rows="3">${esc(settings.home_message||'')}</textarea></label><div class="big" style="margin-top:20px">Terminology</div><div class="grid">${f('student_label','Student / Learner Label')}${f('instructor_label','Instructor / Trainer Label')}${f('organization_unit_label','Company / Location Label')}${f('equipment_label','Equipment / Station Label')}</div><div class="big" style="margin-top:20px">Modular Programs Dashboard Tab</div><div class="grid">${f('program_tab_title','Tab Name')}${f('program_tab_icon','Tab Icon / Emoji')}</div><label>Tab Description<textarea name="program_tab_description" rows="3">${esc(settings.program_tab_description||'')}</textarea></label><label><input style="width:auto" type="checkbox" name="program_tab_visible" value="true" ${String(settings.program_tab_visible)!=='false'?'checked':''}> Show Modular Programs tab on dashboard</label><div class="big" style="margin-top:20px">Certificate Defaults</div><div class="grid">${f('certificate_title','Certificate Title')}${f('certificate_organization_name','Certificate Organization Name')}${f('certificate_location','Location / Conducted At')}${f('certificate_manager_name','Manager / Approver Name')}${f('certificate_manager_title','Manager / Approver Title')}</div><button>Save Company & Branding</button></form></div>${dashboardTabsEditor}<div class="grid"><div class="card"><div class="big">Add Course</div><form method="post" action="/instructor/admin/course"><label>Course Name<input name="name" placeholder="Example: New Product Service Training" required></label><button>Add Course</button></form><p class="small muted">New active courses immediately appear in Start Class and in instructor permission settings.</p></div><div class="card"><div class="big">Training Content</div><p>Instructors can build questions, scavenger hunts, simulations, videos, and student records only for courses you authorize.</p><a class="btn" href="/instructor/build-select">Open Test / Hunt Builder</a> <a class="btn light" href="/instructor/history">Manage Students</a></div></div><div class="card"><div class="section-title"><div><h2>Equipment Models</h2><p class="muted small">This list belongs only to ${esc(company.name)} and feeds Scavenger Hunts, Simulations, and Modular Program equipment selection.</p></div></div><div class="grid"><div><form method="post" action="/instructor/admin/equipment"><label>Add Equipment Model<input name="name" placeholder="Example: 4600" required></label><label>Display Order<input name="display_order" type="number" value="100"></label><button>Add Equipment Model</button></form></div><div class="alert"><b>Company-specific:</b> changes here do not affect any other customer company.</div></div><div style="overflow:auto;margin-top:12px"><table><tr><th>Model / Order</th><th>Status</th><th>Actions</th></tr>${equipmentRows||'<tr><td colspan="3">No equipment models yet.</td></tr>'}</table></div></div><div class="card"><div class="section-title"><h2>Course Catalog</h2><span class="muted small">This catalog belongs only to ${esc(company.name)}.</span></div><div style="overflow:auto;margin-top:12px"><table><tr><th>Course</th><th>Status</th><th>Actions</th></tr>${courseRows}</table></div></div>`));
});
app.post('/instructor/admin/settings',auth,companyAdminOnly,async(req,res)=>{
 const companyId=req.account.company_id; const keys=['app_name','tagline','home_message','certificate_title','copyright_holder','footer_text','logo_url','primary_color','secondary_color','accent_color','student_label','instructor_label','organization_unit_label','equipment_label','certificate_location','certificate_organization_name','certificate_manager_name','certificate_manager_title','certificate_prefix','program_tab_title','program_tab_description','program_tab_icon','program_tab_visible'];
 for(const key of keys){ let value=key==='program_tab_visible'?(req.body[key]==='true'?'true':'false'):String(req.body[key]||'').trim(); if(['primary_color','secondary_color','accent_color'].includes(key)) value=safeHex(value,BRAND_DEFAULTS[key]); await pool.query('INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value',[companyId,key,value]); }
 const org=String(req.body.organization_name||'').trim(); await pool.query('UPDATE companies SET name=COALESCE(NULLIF($2,\'\'),name),contact_email=$3,contact_phone=$4,website_url=$5 WHERE id=$1',[companyId,org,String(req.body.contact_email||'').trim(),String(req.body.contact_phone||'').trim(),String(req.body.website_url||'').trim()]); await auditEvent(req,'BRANDING_UPDATED','Company branding/settings updated','ok'); res.redirect('/instructor/admin');
});
app.post('/instructor/admin/dashboard-tabs',auth,companyAdminOnly,async(req,res)=>{
 const companyId=req.account.company_id;
 const defs={
  tests:['Tests','Build and manage quiz questions.','📝',10],hunt:['Scavenger Hunt','Choose equipment/stations, build hunt items, and print QR stations.','🔎',20],qrlabels:['QR Label Center','View every scavenger-hunt QR label in one place, grouped by equipment model, and edit the matching hunt item.','🏷️',25],simulations:['Simulation Library','Release diagnostic scenarios, choose hidden root causes, and review student diagnostic paths.','🛠️',30],master:['Master Diagnostic Challenge','Build, edit, release, and score final practical diagnostic certification challenges.','🧠',40],prepost:['Pre/Post Improvement','Compare starting knowledge to final test performance by class, student, and topic.','📈',50],videos:['Interactive Videos','Add company training videos with editable timed questions, scoring, and penalty logic.','🎬',60],reports:['Reports & Certificates','Print records and certificates for completed students.','🏆',70],feedback:['Training Feedback','Review student ratings and comments.','★',80],programs:['Modular Programs','Build multi-section training programs with modules and one program QR code.','🧩',90],team:['Team & Permissions','Create instructors and managers, assign course access, and manage company accounts.','👥',100],admin:['Admin & Content','Company branding, course catalog, wording, and training-system settings.','⚙️',110]
 };
 if(await methodistDashEnabled(companyId))defs.customdash=['Dashboard','Open and manage company dashboards.','📊',76];
 const primary=safeHex(brand('primary_color','#c4141c'),'#c4141c');
 for(const [id,[defTitle,defDesc,defIcon,defOrder]] of Object.entries(defs)){
  const prefix=`dash_${id}_`;
  const title=String(req.body[prefix+'title']||defTitle).trim()||defTitle;
  const description=String(req.body[prefix+'description']||defDesc).trim();
  const icon=String(req.body[prefix+'icon']||defIcon).trim()||defIcon;
  const order=String(Math.max(1,Math.min(9999,Number(req.body[prefix+'order'])||defOrder)));
  const color=safeHex(req.body[prefix+'color'],primary);
  const visible=id==='admin'?'true':(req.body[prefix+'visible']==='true'?'true':'false');
  const values={ [prefix+'title']:title,[prefix+'description']:description,[prefix+'icon']:icon,[prefix+'order']:order,[prefix+'color']:color,[prefix+'visible']:visible };
  for(const [key,value] of Object.entries(values)) await pool.query('INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value',[companyId,key,value]);
  if(id==='programs'){
   const compat={program_tab_title:title,program_tab_description:description,program_tab_icon:icon,program_tab_visible:visible};
   for(const [key,value] of Object.entries(compat)) await pool.query('INSERT INTO company_settings(company_id,key,value) VALUES($1,$2,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value',[companyId,key,value]);
  }
 }
 await auditEvent(req,'DASHBOARD_TABS_UPDATED','Company dashboard tab settings updated','ok');
 res.redirect('/instructor/admin');
});

app.post('/instructor/admin/equipment',auth,companyAdminOnly,async(req,res)=>{ const name=String(req.body.name||'').trim(); const order=Number(req.body.display_order)||100; if(name) await pool.query('INSERT INTO company_equipment_models(company_id,name,display_order,active) VALUES($1,$2,$3,true) ON CONFLICT(company_id,name) DO UPDATE SET active=true,display_order=EXCLUDED.display_order',[req.account.company_id,name,order]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/equipment/:id/edit',auth,companyAdminOnly,async(req,res)=>{ const name=String(req.body.name||'').trim(); const order=Number(req.body.display_order)||100; if(name) await pool.query('UPDATE company_equipment_models SET name=$3,display_order=$4 WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id,name,order]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/equipment/:id/toggle',auth,companyAdminOnly,async(req,res)=>{ await pool.query('UPDATE company_equipment_models SET active=NOT active WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/equipment/:id/delete',auth,companyAdminOnly,async(req,res)=>{ await pool.query('DELETE FROM company_equipment_models WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/course',auth,companyAdminOnly,async(req,res)=>{ const name=String(req.body.name||'').trim(); if(name) await pool.query('INSERT INTO company_courses(company_id,name,active) VALUES($1,$2,true) ON CONFLICT(company_id,name) DO UPDATE SET active=true',[req.account.company_id,name]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/course/:id/toggle',auth,companyAdminOnly,async(req,res)=>{ await pool.query('UPDATE company_courses SET active=NOT active WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id]); res.redirect('/instructor/admin'); });
app.post('/instructor/admin/course/:id/delete',auth,companyAdminOnly,async(req,res)=>{ await pool.query('DELETE FROM company_courses WHERE id=$1 AND company_id=$2',[req.params.id,req.account.company_id]); res.redirect('/instructor/admin'); });


startAutomaticBackupScheduler();
app.listen(port,'0.0.0.0',()=>console.log(`${APP_NAME} running on port ${port}`));

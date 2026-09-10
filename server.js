// Mahindra Training Hub v3.7 — Custom Tractor & Hunt Item Builder
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
:root{--red:#c4141c;--red2:#9f0f15;--black:#171717;--line:#dedede;--soft:#f5f5f5;--muted:#666;--green:#1f7a3b;--amber:#a55b00}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d;background:#f6f6f6}.top{background:var(--black);color:#fff;padding:18px 24px;border-bottom:5px solid var(--red);display:flex;align-items:center;justify-content:space-between}.top b{font-size:21px}.top span{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ddd}.wrap{max-width:1180px;margin:auto;padding:24px}.card{border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:18px}.home-card{display:block;text-decoration:none;color:#1d1d1d;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;min-height:150px;transition:.15s ease}.home-card:hover{border-color:#bbb;transform:translateY(-1px)}.home-card .icon{font-size:30px;margin-bottom:14px}.home-card .title{font-size:22px;font-weight:800}.home-card .desc{color:var(--muted);margin-top:8px;line-height:1.45}.hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.hero h1{margin:0;font-size:30px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}.btn,button{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;cursor:pointer}.btn:hover,button:hover{background:var(--red2)}.btn.alt{background:#333}.btn.light{background:#eee;color:#222}.btn.light:hover{background:#ddd}.btn.danger,button.danger{background:#a00000}.btn.danger:hover,button.danger:hover{background:#7d0000}.big{font-size:24px;font-weight:800}.muted{color:var(--muted)}.code{font-size:50px;font-weight:900;letter-spacing:6px}.stat{background:var(--soft);padding:16px;border-radius:14px}.stat b{display:block;font-size:28px;margin-top:4px}.stat span{font-size:13px;color:var(--muted);font-weight:700}.stat.green b{color:var(--green)}input,select,textarea{width:100%;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin-top:5px;background:#fff}label{font-weight:650;display:block;margin:12px 0}.q{padding:14px;border:1px solid #ddd;border-radius:10px;margin:12px 0}.q label{font-weight:400;margin:8px 0}.q input[type=radio]{width:auto;margin-right:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#fafafa}.pass{color:#0b6d2f;font-weight:800}.review{color:#a14500;font-weight:800}.danger{color:#a00000}.qr{max-width:300px;width:100%;height:auto}.center{text-align:center}.steps{font-size:18px;line-height:1.6}.pill{display:inline-block;background:#eee;padding:6px 10px;border-radius:99px;font-size:13px;font-weight:800}.pill.open{background:#e8f5ea;color:#1f6f38}.pill.closed{background:#f1f1f1;color:#555}.pill.joined{background:#eef3ff;color:#274d9c}.pill.results{background:#e8f5ea;color:#1f6f38}.pill.testing{background:#fff3cd;color:#805600}.pill.hunt{background:#f3e8ff;color:#6b2b91}.progressbar{height:10px;background:#ececec;border-radius:99px;overflow:hidden}.progressbar>span{display:block;height:100%;background:var(--red)}.rating{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.rating label{border:1px solid #ddd;border-radius:8px;padding:9px;text-align:center;font-weight:600}.rating input{width:auto;margin:0 4px 0 0}.feedback-good{border-left:5px solid var(--green)}.feedback-miss{border-left:5px solid var(--red)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.alert{padding:12px;border-radius:9px;background:#fff3cd;border:1px solid #ffe69c}.success{padding:12px;border-radius:9px;background:#e8f5ea;border:1px solid #b9dfc0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0}.join-box{background:#fff;border:2px solid #eee;border-radius:18px;padding:22px}.live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2f9e44;margin-right:7px}.small{font-size:13px}.nowrap{white-space:nowrap}@media(max-width:700px){.wrap{padding:14px}.top{padding:14px 16px}.top span{display:none}.code{font-size:38px}.hero h1{font-size:26px}.home-card{min-height:125px;padding:18px}th,td{padding:9px}.desktop-only{display:none}}@media print{.no-print,.top{display:none!important}.wrap{max-width:none;padding:0}.card{border:0}.report{font-size:12pt}body{background:#fff}}
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
// Tractor 1 — Electrical & CAN
['Tractor 1 · Station 1 — Battery','Locate the battery. With the key OFF, measure and enter the battery voltage. Enter the number only, for example 12.6.','12'],
['Tractor 1 · Station 2 — Main Power Protection','Locate the main fuse / fusible-link area supplying tractor electrical power. Enter the word FUSE after you physically identify it.','fuse'],
['Tractor 1 · Station 3 — ECU Power Protection','Using the fuse/relay information for this tractor, locate the fuse or relay that supplies ECU power. Enter ECU after you identify it.','ecu'],
['Tractor 1 · Station 4 — Diagnostic Connector','Locate the tractor diagnostic connector. Enter DIAGNOSTIC once every team member can point to the connector.','diagnostic'],
['Tractor 1 · Station 5 — CAN Network','With tractor power OFF and the network safe to measure, check resistance across CAN High and CAN Low. Enter the resistance in ohms.','60'],
// Tractor 2 — Fifty One Hundred Refresh: Find the New Changes
['Tractor 2 · Station 6 — Cluster & Operator-Presence Changes','This is the Fifty One Hundred Refresh comparison tractor. Find the modified instrument cluster, then find the operator-presence detector incorporated into the seat. Every team member must be able to point out both changes. Enter SEAT when complete.','seat'],
['Tractor 2 · Station 7 — Battery & Air-Cleaner Relocation','Compare the Refresh layout with the earlier Fifty One Hundred. Find the battery and the air cleaner. Both were relocated to the front-of-radiator area under/inside the hood. Verify both new locations, then enter FRONT.','front'],
['Tractor 2 · Station 8 — Engine Serviceability Changes','Find the relocated fuel-filter position and the accelerator-pedal-position sensor mounting. Discuss how the new locations improve protection or service access. Enter RELOCATED after every team member has identified both.','relocated'],
['Tractor 2 · Station 9 — Cooling, Exhaust & Pump-Area Changes','On the Refresh engine, locate as many of these changed items as your team can: modified water-pump area, changed crank pulley, integrated DOC/exhaust arrangement, revised oil-cooler location, and modified hydraulic-pump inlet-pipe location. The Verifier must confirm that the team found at least THREE. Enter THREE when complete.','three'],
['Tractor 2 · Station 10 — New Engine-Management Hardware','Locate the engine ECU and read the controller-family identification directly from the ECU label. Do not answer from memory. Enter the controller family shown on the Fifty One Hundred Refresh ECU label.','MD1CS162'],
// Tractor 3 — Hydraulics, PTO & Drivetrain
['Tractor 3 · Station 11 — Hydraulic Pump','Locate the main hydraulic pump. Enter PUMP after every team member can identify it.','pump'],
['Tractor 3 · Station 12 — Hydraulic Test Point','Locate the main hydraulic pressure test point identified in the service information. Enter TEST after you physically identify the correct test point.','test'],
['Tractor 3 · Station 13 — PTO Control','Locate the PTO control solenoid, valve, or actuator used on this tractor. Enter PTO after every team member can identify it.','pto'],
['Tractor 3 · Station 14 — Three-Point Control','Locate the primary three-point hitch control/valve components used on this tractor. Enter THREE POINT after your team identifies the system.','three'],
['Tractor 3 · Station 15 — Drivetrain Service Point','Using the service information, locate one specified drivetrain/transmission service or pressure-check point. Enter DRIVETRAIN after the team verifies the correct location.','drivetrain']
];


const HUNT_MODEL_SUGGESTIONS = [
  '4600','5100','6000','Fifty One Hundred Refresh','Fifty One Hundred','Six Thousand Series','Forty Six Hundred','Forty One Hundred','Thirty One Hundred','OJA 1100','OJA 2100','SU Series','ROXOR','1600 Series','2600 Series','4500 Series','Custom Tractor'
];
const HUNT_ITEM_LIBRARY = [
  {id:'battery',label:'Battery Location',task:'Locate the battery and have every team member identify its location. Enter BATTERY when complete.',expected:'battery'},
  {id:'air_cleaner',label:'Air Cleaner Location',task:'Locate the air cleaner assembly and identify how it is accessed for service. Enter AIR when complete.',expected:'air'},
  {id:'diagnostic_connector',label:'Diagnostic Connector',task:'Locate the tractor diagnostic connector and have every team member point to it. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
  {id:'ecu',label:'Engine ECU / Controller',task:'Locate the engine ECU/controller and read the controller identification from the label. Enter ECU when complete.',expected:'ecu'},
  {id:'fuse_box',label:'Fuse / Relay Center',task:'Locate the main fuse and relay center. Enter FUSE when every team member can identify it.',expected:'fuse'},
  {id:'main_ground',label:'Main Ground Point',task:'Locate a primary engine/chassis ground point identified in the service information. Enter GROUND when complete.',expected:'ground'},
  {id:'crank_sensor',label:'Crankshaft Position Sensor',task:'Locate the crankshaft-position sensor. Enter CRANK when every team member can identify it.',expected:'crank'},
  {id:'cam_sensor',label:'Cam / Phase Sensor',task:'Locate the cam/phase sensor. Enter CAM when every team member can identify it.',expected:'cam'},
  {id:'rail_sensor',label:'Fuel Rail Pressure Sensor',task:'Locate the fuel-rail pressure sensor and connector. Enter RAIL when complete.',expected:'rail'},
  {id:'fuel_filter',label:'Fuel Filter',task:'Locate the fuel-filter assembly and identify its service access. Enter FILTER when complete.',expected:'filter'},
  {id:'hydraulic_pump',label:'Hydraulic Pump',task:'Locate the main hydraulic pump. Enter PUMP when every team member can identify it.',expected:'pump'},
  {id:'hydraulic_test',label:'Hydraulic Pressure Test Point',task:'Using service information, locate the specified hydraulic pressure test point. Enter TEST when complete.',expected:'test'},
  {id:'pto_control',label:'PTO Control / Solenoid',task:'Locate the PTO control solenoid, valve, or actuator used on this tractor. Enter PTO when complete.',expected:'pto'},
  {id:'three_point',label:'Three-Point Control Components',task:'Locate the primary three-point hitch control or valve components. Enter THREE when complete.',expected:'three'},
  {id:'cluster',label:'Instrument Cluster',task:'Identify the instrument cluster and have the Verifier point out the major warning/indicator area. Enter CLUSTER when complete.',expected:'cluster'},
  {id:'seat_presence',label:'Operator-Presence Seat Detector',task:'Locate the operator-presence detector/switch incorporated into the seat system. Enter SEAT when complete.',expected:'seat'},
  {id:'refresh_battery_air',label:'Refresh Change — Battery & Air Cleaner Relocation',task:'Find the battery and air cleaner in their Refresh locations and discuss how those locations differ from the earlier tractor. Enter FRONT when complete.',expected:'front'},
  {id:'refresh_app',label:'Refresh Change — Accelerator Pedal Sensor Mounting',task:'Locate the accelerator-pedal-position sensor and identify the revised mounting location. Enter APP when complete.',expected:'app'},
  {id:'refresh_cooling',label:'Refresh Change — Water Pump / Crank Pulley',task:'Locate the modified water-pump area and changed crank pulley. Enter COOLING when both have been identified.',expected:'cooling'},
  {id:'refresh_exhaust',label:'Refresh Change — DOC / Exhaust Arrangement',task:'Locate the integrated DOC/exhaust arrangement and identify the changed service layout. Enter DOC when complete.',expected:'doc'},
  {id:'refresh_oil_cooler',label:'Refresh Change — Oil Cooler Location',task:'Locate the revised oil-cooler position. Enter COOLER when complete.',expected:'cooler'},
  {id:'refresh_hyd_inlet',label:'Refresh Change — Hydraulic Pump Inlet Pipe',task:'Locate the modified hydraulic-pump inlet-pipe area and identify the improved pump mounting-bolt access. Enter INLET when complete.',expected:'inlet'},
  {id:'refresh_egr',label:'Refresh Change — EGR Mounting',task:'Locate the EGR assembly and identify the revised mounting arrangement. Enter EGR when complete.',expected:'egr'},
  {id:'refresh_oil_fill',label:'Refresh Change — Engine Oil Fill Location',task:'Locate the revised engine-oil fill location. Enter OIL when complete.',expected:'oil'},

  // 4600 — model-specific scavenger-hunt items (added; no existing items removed)
  {id:'4600_operator_presence_switch',label:'4600 — Operator Presence Switch',task:'Locate the Operator Presence Switch on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_battery_cutoff_switch',label:'4600 — Battery Cut-off Switch',task:'Locate the Battery Cut-off Switch on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_boost_pressure_temp_sender',label:'4600 — Boost Pressure & Temp Sender',task:'Locate the Boost Pressure & Temp Sender on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_pto_switch',label:'4600 — PTO Switch',task:'Locate the PTO Switch on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_water_in_fuel_sensor',label:'4600 — Water in Fuel Sensor',task:'Locate the Water in Fuel Sensor on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_brake_switch',label:'4600 — Brake Switch',task:'Locate the Brake Switch on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_fuse_boxes',label:'4600 — Fuse Box(s)',task:'Locate the Fuse Box(s) on the 4600 and have every team member identify them. Enter FOUND when complete.',expected:'found'},
  {id:'4600_fmcu',label:'4600 — FMCU',task:'Locate the FMCU on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_ecu',label:'4600 — ECU',task:'Locate the ECU on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_diagnostic_port',label:'4600 — Diagnostic Port',task:'Locate the Diagnostic Port on the 4600 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'4600_transmission_drain_plugs',label:'4600 — Transmission Drain Plugs — 4 total',task:'Locate all 4 Transmission Drain Plugs on the 4600. The Verifier must confirm that every team member can identify all four plugs. Enter FOUR when all 4 have been located.',expected:'four'},

  // 5100 — model-specific scavenger-hunt items (added; no existing items removed)
  {id:'5100_cam_phase_sensor',label:'5100 — Cam Phase Sensor',task:'Locate the Cam Phase Sensor on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_oil_pressure_switch',label:'5100 — Oil Pressure Switch',task:'Locate the Oil Pressure Switch on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_ecu',label:'5100 — ECU',task:'Locate the ECU on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_diagnostic_port',label:'5100 — Diagnostic Port',task:'Locate the Diagnostic Port on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_battery',label:'5100 — Battery',task:'Locate the Battery on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_battery_cutoff_switch',label:'5100 — Battery Cut-off Switch',task:'Locate the Battery Cut-off Switch on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_fmcu',label:'5100 — FMCU',task:'Locate the FMCU on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_engine_oil_cooler',label:'5100 — Engine Oil Cooler',task:'Locate the Engine Oil Cooler on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'5100_accelerator_pedal_sensor',label:'5100 — Accelerator Pedal Sensor',task:'Locate the Accelerator Pedal Sensor on the 5100 and have every team member identify it. Enter FOUND when complete.',expected:'found'},

  // 6000 — model-specific scavenger-hunt items (added; no existing items removed)
  {id:'6000_auto_4wd_switch',label:'6000 — Auto 4WD Switch',task:'Locate the Auto 4WD Switch on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_fuse_boxes',label:'6000 — Fuse Box(s)',task:'Locate the Fuse Box(s) on the 6000 and have every team member identify them. Enter FOUND when complete.',expected:'found'},
  {id:'6000_diagnostic_port',label:'6000 — Diagnostic Port',task:'Locate the Diagnostic Port on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_speed_sensor',label:'6000 — Speed Sensor',task:'Locate the Speed Sensor on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_egr',label:'6000 — EGR',task:'Locate the EGR on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_rail_pressure_sensor',label:'6000 — Rail Pressure Sensor',task:'Locate the Rail Pressure Sensor on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_coolant_temp_sensor',label:'6000 — Coolant Temp Sensor',task:'Locate the Coolant Temp Sensor on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_fmcu',label:'6000 — FMCU',task:'Locate the FMCU on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_ecu',label:'6000 — ECU',task:'Locate the ECU on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'},
  {id:'6000_intentional_pto_switch',label:'6000 — Intentional PTO Switch',task:'Locate the Intentional PTO Switch on the 6000 and have every team member identify it. Enter FOUND when complete.',expected:'found'}
];


const HUNT_ROLES = [
  {name:'Navigator', duty:'Read the station task and use the service information to guide the team.'},
  {name:'Locator', duty:'Physically locate the requested component, connector, test point, or system.'},
  {name:'Tool Operator', duty:'Operate the DVOM, diagnostic laptop/interface, gauge, or other required tool.'},
  {name:'Recorder', duty:"Enter the team's verified answer or measurement into the Training Hub."},
  {name:'Verifier', duty:'Confirm every team member can identify the item and explain what was learned before moving on.'}
];
const HUNT_MAX_TRACTORS = 5;
const HUNT_TEAM_NAMES = ['RED TEAM','BLACK TEAM','GRAY TEAM','BLUE TEAM','GOLD TEAM'];
function huntTeamInfo(rosterIndex,tractorCount=3){
  tractorCount=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(tractorCount)||3));
  const teamIndex=rosterIndex%tractorCount;
  const memberSlot=Math.floor(rosterIndex/tractorCount)%HUNT_ROLES.length;
  const rotation=[]; for(let i=0;i<tractorCount;i++) rotation.push(((teamIndex+i)%tractorCount)+1);
  return {name:HUNT_TEAM_NAMES[teamIndex]||`TEAM ${teamIndex+1}`,teamIndex,memberSlot,start:`Tractor ${teamIndex+1}`,rotation};
}
function huntRoleForStation(memberSlot,stationNumber){
  return HUNT_ROLES[(memberSlot + Math.max(0,stationNumber-1)) % HUNT_ROLES.length];
}

async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS classes(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, course TEXT NOT NULL,
    instructor TEXT NOT NULL, pass_score INTEGER NOT NULL DEFAULT 80, hours NUMERIC(5,2) NOT NULL DEFAULT 8,
    join_token TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), active BOOLEAN DEFAULT TRUE
  )`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_tractor_count INTEGER NOT NULL DEFAULT 3`);
  await pool.query(`UPDATE classes SET hunt_tractor_count=3 WHERE hunt_tractor_count IS NULL OR hunt_tractor_count<1 OR hunt_tractor_count>5`);
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
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_no INTEGER`);
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_model TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS item_label TEXT DEFAULT ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_tractors(
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    tractor_no INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(class_id,tractor_no)
  )`);
  await pool.query(`UPDATE hunt_stations SET tractor_no=1 WHERE tractor_no IS NULL AND station_name LIKE 'Tractor 1%'`);
  await pool.query(`UPDATE hunt_stations SET tractor_no=2 WHERE tractor_no IS NULL AND station_name LIKE 'Tractor 2%'`);
  await pool.query(`UPDATE hunt_stations SET tractor_no=3 WHERE tractor_no IS NULL AND station_name LIKE 'Tractor 3%'`);
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
    is_correct BOOLEAN DEFAULT FALSE, updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(student_id,question_id)
  )`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS explanation TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS show_live_scores BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_feedback BOOLEAN DEFAULT TRUE`);

  await pool.query(`CREATE TABLE IF NOT EXISTS course_catalog(
    id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings(
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
  const defaults=['Fifty One Hundred Refresh','Six Thousand Series','OJA Series','SU Series','ROXOR','Electrical Fundamentals','CAN / J1939 Diagnostics','FES / GARUDA Diagnostics'];
  for (const name of defaults) await pool.query('INSERT INTO course_catalog(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[name]);
  const settings={home_message:'Start classes, build activities, watch technicians, and print training records.',certificate_title:'Certificate of Completion',organization_name:'Mahindra Technician Training'};
  for (const [key,value] of Object.entries(settings)) await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[key,value]);
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
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,updated_at) VALUES($1,'Joined','Joined',0,0,now()) ON CONFLICT(student_id) DO UPDATE SET updated_at=now()`,[student.id]);
  res.setHeader('Set-Cookie',`mth_student_${c.id}=${student.id}:${c.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  res.redirect(`/student/${student.id}?token=${encodeURIComponent(c.join_token)}`);
});

async function studentContext(id,token){
  const q=await pool.query(`SELECT s.*,c.course,c.code,c.instructor,c.join_token,c.pass_score,c.hours,c.hunt_tractor_count FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.join_token=$2`,[id,token]); return q.rows[0];
}
app.get('/student/:id', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const r=await pool.query('SELECT activity,score FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]);
  const done=new Set(r.rows.map(x=>x.activity));
  const feedback=(await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount>0;
  const allCore=['Module Quiz','Scavenger Hunt','Failure Simulation'].every(x=>done.has(x));
  res.send(layout('Technician Home', `<div class="card"><span class="pill">Class ${esc(s.code)}</span><div class="big">Welcome, ${esc(s.name)}</div><p>${esc(s.course)} · ${esc(s.dealer)}</p></div><div class="grid"><div class="card"><div class="big">Module Quiz</div><p>Knowledge test. Your instructor can watch your progress while you work.</p>${done.has('Module Quiz')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a>`}</div><div class="card"><div class="big">Custom Tractor Scavenger Hunt</div><p>Work through the tractor models and hunt items selected by your instructor. Scan each QR code and record your own progress.</p>${done.has('Scavenger Hunt')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">View Hunt Progress</a>`}</div><div class="card"><div class="big">Failure Simulation</div><p>Work through a crank/no-start diagnostic scenario.</p>${done.has('Failure Simulation')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Start Simulation</a>`}</div><div class="card"><div class="big">Training Feedback</div><p>Tell us what helped and what should be improved.</p>${feedback?'<div class="success">Feedback Submitted — Thank You</div>':allCore?`<a class="btn" href="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">Give Training Feedback</a>`:'<div class="muted">Available after the training activities are finished.</div>'}</div></div>`));
});

app.get('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  if(!q.rowCount){ for(const x of DEFAULT_QUIZ) await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[s.class_id,x[0],JSON.stringify(x[1]),x[2],'Review the correct diagnostic principle for this question.','General Diagnostics']); q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]); }
  await pool.query('DELETE FROM quiz_progress WHERE student_id=$1',[s.id]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',0,$2,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=0,total=$2,current_score=NULL,updated_at=now()`,[s.id,q.rowCount]);
  const ids=q.rows.map(x=>x.id).join(',');
  const qs=q.rows.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.question)}</b>${x.choices.map((c,j)=>`<label><input type="radio" name="q_${x.id}" value="${j}" required data-qid="${x.id}">${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div>`).join('');
  res.send(layout('Quiz', `<div class="card"><div class="big">${esc(s.course)} — Module Quiz</div><p class="muted">Your progress is shown on the instructor leaderboard while you work.</p><form id="quizForm" method="post" action="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="ids" value="${ids}">${qs}<button>Submit Quiz</button></form></div>`, `<script>const answered=new Set();document.querySelectorAll('input[type=radio][data-qid]').forEach(el=>el.addEventListener('change',async()=>{answered.add(el.dataset.qid);try{await fetch('/student/${s.id}/quiz-progress?token=${encodeURIComponent(s.join_token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qid:Number(el.dataset.qid),answer:Number(el.value),progress:answered.size,total:${q.rowCount}})});}catch(e){}}));</script>`));
});
app.post('/student/:id/quiz-progress', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).json({ok:false});
  const q=(await pool.query('SELECT answer_index FROM quiz_questions WHERE id=$1 AND class_id=$2',[Number(req.body.qid),s.class_id])).rows[0];
  const isCorrect=!!q && Number(req.body.answer)===q.answer_index;
  if(q) await pool.query(`INSERT INTO quiz_progress(student_id,question_id,is_correct,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(student_id,question_id) DO UPDATE SET is_correct=$3,updated_at=now()`,[s.id,Number(req.body.qid),isCorrect]);
  const agg=(await pool.query('SELECT count(*)::int answered,count(*) FILTER (WHERE is_correct)::int correct FROM quiz_progress WHERE student_id=$1',[s.id])).rows[0];
  const current=Number(agg.answered)?Math.round(Number(agg.correct)/Number(agg.answered)*100):null;
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=$2,total=$3,current_score=$4,updated_at=now()`,[s.id,Number(agg.answered),Math.max(0,Number(req.body.total)||0),current]);
  res.json({ok:true});
});
app.post('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const ids=(req.body.ids||'').split(',').map(Number).filter(Boolean); if(!ids.length) return res.status(400).send('No questions');
  const q=await pool.query('SELECT * FROM quiz_questions WHERE id=ANY($1::int[])',[ids]); let correct=0; const missed=[]; const review=[];
  for(const x of q.rows){ const a=Number(req.body['q_'+x.id]); const ok=a===x.answer_index; if(ok) correct++; const item={question:x.question,topic:x.topic||'',selected:x.choices[a]||'No answer',correct:x.choices[x.answer_index],explanation:x.explanation||'Review this topic with your instructor.',is_correct:ok}; review.push(item); if(!ok) missed.push(item); }
  const score=Math.round(correct/q.rowCount*100); await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Module Quiz',$2,$3)",[s.id,score,JSON.stringify({correct,total:q.rowCount,missed,review})]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Finished',$2,$2,$3,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Finished',progress=$2,total=$2,current_score=$3,updated_at=now()`,[s.id,q.rowCount,score]);
  const c=(await pool.query('SELECT student_feedback FROM classes WHERE id=$1',[s.class_id])).rows[0];
  const reviewHtml=c?.student_feedback ? `<div class="card"><div class="big">Quiz Review</div>${missed.length?missed.map((m,i)=>`<div class="q feedback-miss"><b>Missed Question ${i+1}</b><p><b>Question:</b> ${esc(m.question)}</p><p><b>Your Answer:</b> ${esc(m.selected)}</p><p><b>Correct Answer:</b> ${esc(m.correct)}</p><p><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join(''):'<div class="success">You did not miss any questions.</div>'}</div>`:'';
  res.send(layout('Quiz Complete', `<div class="card center"><div class="big">Quiz Complete</div><div class="code">${score}%</div><p>${correct} of ${q.rowCount} correct</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>${reviewHtml}`));
});

app.get('/student/:id/hunt', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[s.class_id]);
  const p=await pool.query('SELECT station_id,correct FROM hunt_progress WHERE student_id=$1',[s.id]); const completed=new Map(p.rows.map(x=>[x.station_id,x]));
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status='Hunt',progress=$2,total=$3,updated_at=now()`,[s.id,completed.size,q.rowCount]);
  const roster=(await pool.query('SELECT id FROM students WHERE class_id=$1 ORDER BY joined_at,id',[s.class_id])).rows;
  const rosterIndex=Math.max(0,roster.findIndex(x=>Number(x.id)===Number(s.id)));
  const tractorCount=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(s.hunt_tractor_count)||3));
  const team=huntTeamInfo(rosterIndex,tractorCount); const startingRole=huntRoleForStation(team.memberSlot,1);
  const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[s.class_id]);
  const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
  for(const x of q.rows) if(x.tractor_no && x.tractor_model && !models.has(Number(x.tractor_no))) models.set(Number(x.tractor_no),x.tractor_model);
  const tractorName=n=>models.get(n)||`Tractor ${n}`;
  const activeTractors=Array.from({length:tractorCount},(_,i)=>i+1);
  const rotation=team.rotation.map(n=>tractorName(n)).join(' → ');
  const grouped=activeTractors.map(n=>q.rows.filter(x=>Number(x.tractor_no)===n));
  const extras=q.rows.filter(x=>!activeTractors.includes(Number(x.tractor_no)));
  const groupHtml=grouped.map((rows,idx)=>{const n=idx+1; const body=rows.map(x=>{const stationNumber=q.rows.findIndex(y=>y.id===x.id)+1; return `<tr><td>Station ${stationNumber}</td><td><b>${esc(x.item_label||x.station_name)}</b></td><td>${completed.has(x.id)?'<span class="pill results">Complete</span>':'<span class="pill">Not Scanned</span>'}</td></tr>`}).join(''); return `<div class="card"><div class="section-title"><div><div class="eyebrow">Tractor ${n}</div><div class="big">${esc(tractorName(n))}</div></div><span class="pill">${rows.length} Station${rows.length===1?'':'s'}</span></div><div style="overflow:auto"><table><tr><th>#</th><th>Hunt Item</th><th>Status</th></tr>${body||'<tr><td colspan="3">No hunt items assigned to this tractor.</td></tr>'}</table></div></div>`}).join('');
  const extraHtml=extras.length?`<div class="card"><div class="big">Additional Stations</div>${extras.map(x=>`<p>${esc(x.item_label||x.station_name)}</p>`).join('')}</div>`:'';
  res.send(layout('Scavenger Hunt', `<div class="card"><div class="eyebrow">Hands-On Team Activity</div><div class="big">Custom Tractor Technician Scavenger Hunt</div><p>Your instructor selected the tractor models and the exact items your team will hunt for.</p><div class="grid"><div class="stat"><span>Your Team</span><b>${team.name}</b></div><div class="stat"><span>Start At</span><b>${esc(tractorName(team.rotation[0]))}</b></div><div class="stat"><span>Your First Role</span><b>${startingRole.name}</b></div><div class="stat"><span>Progress</span><b>${completed.size} / ${q.rowCount}</b><div class="progressbar"><span style="width:${q.rowCount?Math.round(completed.size/q.rowCount*100):0}%"></span></div></div></div><div class="alert"><b>Your tractor rotation:</b> ${esc(rotation)}<br><span class="small">Your role changes automatically at every station.</span></div><h3>Automatic Role Rotation</h3><p><b>Navigator</b> — reads the task/service information · <b>Locator</b> — finds the item · <b>Tool Operator</b> — uses the required tool · <b>Recorder</b> — enters the answer · <b>Verifier</b> — confirms everyone can identify/explain it.</p></div>${groupHtml}${extraHtml}<div class="card"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function readCookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]})); }
app.get('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.course,c.code,c.join_token,c.active,c.hunt_tractor_count FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||!station.active) return res.status(404).send(layout('Station Unavailable','<div class="card">This scavenger-hunt station is not available.</div>'));
  const cookie=readCookies(req)[`mth_student_${station.class_id}`]||''; const [studentId,token]=cookie.split(':'); let student=null;
  if(studentId&&token===station.join_token) student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[studentId,station.class_id])).rows[0];
  if(!student) return res.send(layout('Identify Technician', `<div class="card"><span class="pill">Class ${esc(station.code)}</span><div class="big">${esc(station.station_name)}</div><p>This phone is not signed into the class yet. Join the class first, then scan this station QR again.</p><a class="btn" href="/c/${esc(station.join_token)}">Join Class</a></div>`));
  const done=(await pool.query('SELECT * FROM hunt_progress WHERE student_id=$1 AND station_id=$2',[student.id,station.id])).rows[0];
  const roster=(await pool.query('SELECT id FROM students WHERE class_id=$1 ORDER BY joined_at,id',[station.class_id])).rows;
  const rosterIndex=Math.max(0,roster.findIndex(x=>Number(x.id)===Number(student.id)));
  const team=huntTeamInfo(rosterIndex,station.hunt_tractor_count);
  const stationOrder=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 ORDER BY id',[station.class_id])).rows;
  const stationNumber=Math.max(1,stationOrder.findIndex(x=>Number(x.id)===Number(station.id))+1);
  const role=huntRoleForStation(team.memberSlot,stationNumber);
  const nextRole=huntRoleForStation(team.memberSlot,stationNumber+1);
  res.send(layout(station.station_name, `<div class="card"><span class="pill">${team.name}</span><span class="pill hunt" style="margin-left:6px">Station ${stationNumber}</span><div class="big" style="margin-top:12px">${esc(station.station_name)}</div><div class="alert" style="margin-top:14px"><div class="eyebrow">YOUR ROLE AT THIS STATION</div><div class="big">${esc(role.name)}</div><p style="margin-bottom:0">${esc(role.duty)}</p></div><h3>Team Task</h3><p>${esc(station.task)}</p>${done?`<div class="success">Station already completed. Your answer: <b>${esc(done.answer)}</b><br><span class="small">At the next station, your role rotates to <b>${esc(nextRole.name)}</b>.</span></div><a class="btn light" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a>`:`<form method="post" action="/hunt-station/${station.class_id}/${station.id}"><input type="hidden" name="student_id" value="${student.id}"><input type="hidden" name="token" value="${esc(station.join_token)}"><label>Your Answer / Measurement<input name="answer" required autofocus></label><button>Submit Station</button></form><p class="small muted">When your team moves to the next station, your role automatically changes to <b>${esc(nextRole.name)}</b>.</p>`}</div>`));
});
app.post('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.join_token FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||req.body.token!==station.join_token) return res.status(403).send('Invalid station');
  const student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[req.body.student_id,station.class_id])).rows[0]; if(!student) return res.status(403).send('Student not found');
  const answer=(req.body.answer||'').trim(); const a=answer.toLowerCase(), e=station.expected.toLowerCase(); const correct=!!a&&(a.includes(e)||e.includes(a));
  await pool.query(`INSERT INTO hunt_progress(student_id,station_id,answer,correct,completed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,station_id) DO UPDATE SET answer=$3,correct=$4,completed_at=now()`,[student.id,station.id,answer,correct]);
  const total=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1',[station.class_id])).rows[0].n); const p=(await pool.query('SELECT count(*)::int done,count(*) FILTER (WHERE correct)::int correct FROM hunt_progress hp JOIN hunt_stations h ON h.id=hp.station_id WHERE hp.student_id=$1 AND h.class_id=$2',[student.id,station.class_id])).rows[0];
  const score=total?Math.round(Number(p.correct)/total*100):0; await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status=$5,progress=$2,total=$3,current_score=$4,updated_at=now()`,[student.id,Number(p.done),total,score,Number(p.done)>=total?'Finished':'Hunt']);
  if(Number(p.done)>=total){ await pool.query("DELETE FROM results WHERE student_id=$1 AND activity='Scavenger Hunt'",[student.id]); await pool.query(`INSERT INTO results(student_id,activity,score,details) VALUES($1,'Scavenger Hunt',$2,$3)`,[student.id,score,JSON.stringify({completed:Number(p.done),total})]); }
  res.send(layout('Station Complete', `<div class="card center"><div class="big">Station Complete</div><p>${esc(station.station_name)}</p><div class="success">Answer recorded.</div><p>${p.done} of ${total} stations complete.</p><a class="btn" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a></div>`));
});

app.get('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  res.send(layout('Failure Simulation', `<div class="card"><div class="big">Failure Simulation — Crank / No Start</div><div class="alert"><b>Complaint:</b> Tractor cranks normally but will not start. No smoke is seen from the exhaust.</div><form method="post" action="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}"><label>What should you verify first?<select name="first" required><option value="">Choose</option><option value="complaint">Verify the complaint and basic conditions</option><option value="injector">Replace injectors</option><option value="ecu">Replace ECU</option></select></label><label>No smoke during cranking most strongly suggests investigating:<select name="area" required><option value="">Choose</option><option value="fuel">Fuel delivery / injection command</option><option value="tires">Tire pressure</option><option value="pto">PTO clutch</option></select></label><label>Describe a measurement or data point you would use to prove the failure<textarea name="proof" rows="4" required></textarea></label><button>Complete Simulation</button></form></div>`));
});
app.post('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session'); let score=0;
  if(req.body.first==='complaint') score+=35; if(req.body.area==='fuel') score+=35; if((req.body.proof||'').trim().length>=10) score+=30;
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Failure Simulation',$2,$3)",[s.id,score,JSON.stringify({proof:req.body.proof||''})]); await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Finished',1,1,$2,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Finished',progress=1,total=1,current_score=$2,updated_at=now()`,[s.id,score]);
  res.send(layout('Simulation Complete', `<div class="card center"><div class="big">Simulation Complete</div><div class="code">${score}%</div><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  if((await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount) return res.send(layout('Feedback Complete',`<div class="card center"><div class="big">Thank You</div><p>Your training feedback has already been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
  const rating=(name,label)=>`<label>${label}<div class="rating">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${name}" value="${n}" required>${n}</label>`).join('')}</div><span class="small muted">1 = Low · 5 = Excellent</span></label>`;
  res.send(layout('Training Feedback', `<div class="card"><div class="big">Training Feedback</div><p>Your feedback helps improve future technician training.</p><form method="post" action="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">${rating('overall','Overall Training')}${rating('instructor','Instructor Effectiveness')}${rating('usefulness','Usefulness of the Material')}${rating('hands_on','Hands-On Activities')}${rating('difficulty','Difficulty Level / Pace')}<label>What was most helpful?<textarea name="most_helpful" rows="3"></textarea></label><label>What should be improved?<textarea name="improve" rows="3"></textarea></label><label>Other Comments<textarea name="comments" rows="3"></textarea></label><button>Submit Feedback</button></form></div>`));
});
app.post('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const nums=['overall','instructor','usefulness','hands_on','difficulty'].map(k=>Math.min(5,Math.max(1,Number(req.body[k])||1)));
  await pool.query(`INSERT INTO training_feedback(student_id,overall,instructor,usefulness,hands_on,difficulty,most_helpful,improve,comments,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(student_id) DO UPDATE SET overall=$2,instructor=$3,usefulness=$4,hands_on=$5,difficulty=$6,most_helpful=$7,improve=$8,comments=$9,submitted_at=now()`,[s.id,...nums,req.body.most_helpful||'',req.body.improve||'',req.body.comments||'']);
  res.send(layout('Thank You', `<div class="card center"><div class="big">Thank You</div><p>Your feedback has been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function pinForm(message=''){ return layout('Instructor Login', `<div class="card" style="max-width:500px;margin:auto"><div class="big">Instructor Access</div>${message?`<div class="alert">${esc(message)}</div>`:''}<form method="post" action="/instructor/login"><label>Instructor PIN<input type="password" name="pin" inputmode="numeric" required autofocus></label><button>Open Dashboard</button></form></div>`); }
app.get('/instructor',(req,res)=>res.send(pinForm()));
app.post('/instructor/login',(req,res)=>{ if(req.body.pin!==INSTRUCTOR_PIN) return res.send(pinForm('Incorrect PIN.')); res.redirect('/instructor/dashboard?pin='+encodeURIComponent(INSTRUCTOR_PIN)); });
function auth(req,res,next){ if((req.query.pin||req.body.pin)!==INSTRUCTOR_PIN) return res.status(403).send(pinForm('Instructor login required.')); next(); }

app.get('/instructor/dashboard',auth,async(req,res)=>{
  const classes=await pool.query(`SELECT c.*,count(distinct s.id)::int students,count(r.id)::int results FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN results r ON r.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 30`);
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const rows=classes.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td><span class="pill">${esc(c.code)}</span></td><td>${c.students}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td class="nowrap"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Class</a></td></tr>`).join('');
  const active=classes.rows.filter(c=>c.active).length; const students=classes.rows.reduce((a,c)=>a+c.students,0);
  res.send(layout('Instructor Dashboard', `<div class="hero"><div><div class="eyebrow">Instructor Home</div><h1>What do you want to do?</h1><p class="muted">${esc(settings.home_message||'Start classes, build activities, watch technicians, and print training records.')}</p></div></div><div class="home-grid"><a class="home-card" href="/instructor/new?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">▶</div><div class="title">Start Class</div><div class="desc">Choose a course and instantly create the technician QR code.</div></a><a class="home-card" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🧰</div><div class="title">Build Test / Hunt</div><div class="desc">Add quiz questions and scavenger-hunt stations to a class.</div></a><a class="home-card" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">👨‍🔧</div><div class="title">Student Records</div><div class="desc">Search technicians, open their records, and review scores.</div></a><a class="home-card" href="/instructor/reports?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🖨️</div><div class="title">Print Reports</div><div class="desc">Open printable individual training reports and certificates.</div></a><a class="home-card" href="/instructor/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">★</div><div class="title">Training Feedback</div><div class="desc">Review student ratings and comments after training.</div></a><a class="home-card" href="/instructor/settings?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">⚙️</div><div class="title">Settings</div><div class="desc">See instructor and class settings in one simple place.</div></a><a class="home-card" href="/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">✏️</div><div class="title">Admin Content Editor</div><div class="desc">Manage courses, website wording, questions, QR scavenger hunts, student records, and training feedback.</div></a></div><div class="grid" style="margin-top:18px"><div class="stat"><span>Open Classes</span><b>${active}</b></div><div class="stat"><span>Recent Students</span><b>${students}</b></div><div class="stat green"><span>Cloud Status</span><b>Online</b></div></div><div class="card"><div class="section-title"><h2>Recent Classes</h2><span class="muted small">Technicians can join from cellular or any internet connection.</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Class</th><th>Code</th><th>Students</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5">No classes yet. Click Start Class above.</td></tr>'}</tbody></table></div></div>`));
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
app.get('/instructor/new',auth,async(req,res)=>{ const cq=await pool.query('SELECT name FROM course_catalog WHERE active=true ORDER BY name'); const options=cq.rows.map(x=>`<option>${esc(x.name)}</option>`).join(''); res.send(layout('Start Class', `<div class="card"><div class="big">Start a Training Class</div><form method="post" action="/instructor/new"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Class Title<input name="title" placeholder="Example: September Dealer Training" required></label><label>Course<select name="course">${options}</select></label><label>Instructor Name<input name="instructor" required></label><div class="grid"><label>Passing Score<input type="number" name="pass_score" min="1" max="100" value="80"></label><label>Course Hours<input type="number" step="0.5" name="hours" min="0" value="8"></label></div><label><input style="width:auto" type="checkbox" name="student_feedback" value="1" checked> Show missed-question feedback to students after the quiz</label><label><input style="width:auto" type="checkbox" name="show_live_scores" value="1"> Show current scores on the live leaderboard</label><button>Create Class & QR Code</button></form></div>`)); });
app.post('/instructor/new',auth,async(req,res)=>{
  let code; for(let i=0;i<8;i++){ code=code6(); const e=await pool.query('SELECT 1 FROM classes WHERE code=$1',[code]); if(!e.rowCount) break; }
  const token=crypto.randomBytes(16).toString('hex');
  const q=await pool.query('INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,student_feedback,show_live_scores) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[code,req.body.title,req.body.course,req.body.instructor,Number(req.body.pass_score)||80,Number(req.body.hours)||0,token,req.body.student_feedback==='1',req.body.show_live_scores==='1']);
  res.redirect(`/instructor/class/${q.rows[0].id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/class/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const students=await pool.query(`SELECT s.*,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities,a.activity current_activity,a.status,a.progress,a.total,a.current_score FROM students s LEFT JOIN results r ON r.student_id=s.id LEFT JOIN activity_status a ON a.student_id=s.id WHERE s.class_id=$1 GROUP BY s.id,a.activity,a.status,a.progress,a.total,a.current_score ORDER BY s.name`,[c.id]);
  const origin=`${req.protocol}://${req.get('host')}`, joinUrl=`${origin}/c/${c.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:360,margin:1});
  const completed=students.rows.filter(s=>s.activities>0).length; const classAvg=completed?Math.round(students.rows.filter(s=>s.activities>0).reduce((a,s)=>a+s.avg_score,0)/completed):0;
  const rows=students.rows.map(s=>{const status=s.status||'Joined';const cls=status==='Testing'?'testing':status==='Hunt'?'hunt':s.activities?'results':'joined';const progress=s.total?`${s.progress||0}/${s.total}`:'—';const live=c.show_live_scores&&s.current_score!==null?`${s.current_score}%`:'Hidden';return `<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td><span class="pill ${cls}">${esc(status)}</span><br><span class="small muted">${esc(s.current_activity||'Joined')}</span></td><td>${progress}</td><td>${live}</td><td>${s.activities?s.avg_score+'%':'—'}</td><td><a class="btn light" href="/instructor/student/${s.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">View Student</a></td></tr>`}).join('');
  res.send(layout('Live Class', `<meta http-equiv="refresh" content="5"><div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a><a class="btn alt" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Test / Hunt</a><a class="btn" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Print Hunt QR Codes</a><a class="btn light" href="/instructor/class/${c.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Training Feedback</a></div><div class="hero" style="margin-top:14px"><div><div class="eyebrow"><span class="live-dot"></span>Live Class</div><h1>${esc(c.course)}</h1><p class="muted">${esc(c.title)} · Instructor ${esc(c.instructor)}</p></div><span class="pill ${c.active?'open':'closed'}">${c.active?'CLASS OPEN':'CLASS CLOSED'}</span></div><div class="grid" style="margin-top:14px"><div class="join-box center"><div class="eyebrow">Technician Join Code</div><div class="code">${esc(c.code)}</div><img class="qr" src="${qr}" alt="Technician class QR code"><p class="muted small">Technicians scan this QR code with any phone. Wi-Fi or cellular both work.</p><form class="no-print" method="post" action="/instructor/class/${c.id}/toggle"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="${c.active?'btn alt':'btn'}">${c.active?'Close Class':'Reopen Class'}</button></form></div><div><div class="grid"><div class="stat"><span>Students Joined</span><b>${students.rowCount}</b></div><div class="stat"><span>With Results</span><b>${completed}</b></div><div class="stat"><span>Class Average</span><b>${completed?classAvg+'%':'—'}</b></div></div><div class="card"><div class="section-title"><h2>Live Test / Hunt Leaderboard</h2><span class="muted small">Refreshes every 5 seconds · Live score ${c.show_live_scores?'ON':'HIDDEN'}</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Technician</th><th>Status</th><th>Progress</th><th>Live Score</th><th>Completed Avg.</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Waiting for technicians to join...</td></tr>'}</tbody></table></div></div></div></div>`));
});
app.post('/instructor/class/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE classes SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/class/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/builder/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const qs=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id]);
  const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
  const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[c.id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
  const qcards=qs.rows.map((q,i)=>`<div class="q"><b>${i+1}. ${esc(q.question)}</b>${q.topic?`<div class="small"><span class="pill">${esc(q.topic)}</span></div>`:''}<div class="small muted" style="margin-top:6px">${(q.choices||[]).map((x,j)=>`${String.fromCharCode(65+j)}. ${esc(x)}${j===q.answer_index?' ✓':''}`).join(' · ')}</div>${q.explanation?`<p class="small"><b>Feedback:</b> ${esc(q.explanation)}</p>`:''}<form method="post" action="/instructor/builder/${c.id}/question/${q.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this question?')">Delete Question</button></form></div>`).join('');
  const hcards=hs.rows.map((h,i)=>`<div class="q"><span class="pill">Tractor ${h.tractor_no||'—'}</span> <b>${esc(h.tractor_model||models.get(Number(h.tractor_no))||'')} — ${esc(h.item_label||h.station_name)}</b><div class="small muted">${esc(h.task)}</div><div class="small"><b>Expected:</b> ${esc(h.expected)}</div><form method="post" action="/instructor/builder/${c.id}/station/${h.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this hunt item?')">Delete Hunt Item</button></form></div>`).join('');
  const modelOptions=HUNT_MODEL_SUGGESTIONS.map(x=>`<option value="${esc(x)}">`).join('');
  const itemChecks=HUNT_ITEM_LIBRARY.map(x=>`<label style="font-weight:500;margin:6px 0"><input style="width:auto;margin-right:8px" type="checkbox" name="items" value="${esc(x.id)}">${esc(x.label)}</label>`).join('');
  const tractorCount=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(c.hunt_tractor_count)||3));
  const tractorNumbers=Array.from({length:tractorCount},(_,i)=>i+1);
  const tractorCards=tractorNumbers.map(n=>`<div class="card"><div class="eyebrow">Tractor ${n}</div><div class="big">${esc(models.get(n)||'Choose Model')}</div><form method="post" action="/instructor/builder/${c.id}/hunt/tractor/${n}/model"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Tractor Model<input list="hunt-models" name="model" value="${esc(models.get(n)||'')}" placeholder="Type or choose a model" required></label><button>Save Tractor ${n} Model</button></form><hr><form method="post" action="/instructor/builder/${c.id}/hunt/tractor/${n}/items"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><div class="big" style="font-size:18px">Choose Items Students Hunt</div><p class="small muted">Check as many items as you want for this tractor. You can mix common items and model-specific Refresh changes.</p><div style="max-height:350px;overflow:auto;border:1px solid #ddd;border-radius:10px;padding:10px">${itemChecks}</div><button style="margin-top:10px">Add Selected Items to Tractor ${n}</button></form></div>`).join('');
  const tractorSelectOptions=tractorNumbers.map(n=>`<option value="${n}">Tractor ${n}</option>`).join('');
  res.send(layout('Training Builder', `<datalist id="hunt-models">${modelOptions}</datalist><div class="toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" target="_blank" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Hunt QR Codes</a></div><div class="grid"><div class="card"><div class="big">Add Quiz Question</div><form method="post" action="/instructor/builder/${c.id}/question"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Topic / Module<input name="topic" placeholder="Example: CAN / J1939"></label><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3"></textarea></label><button>Add Question</button></form><p>${qs.rowCount} question(s) saved.</p>${qcards}</div><div class="card"><div class="big">Build Your Scavenger Hunt</div><p>First choose how many tractors you will use. Then choose the model and exact hunt items for each tractor.</p><form method="post" action="/instructor/builder/${c.id}/hunt/tractor-count"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>How Many Tractors Will You Use?<select name="tractor_count">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===tractorCount?'selected':''}>${n} Tractor${n===1?'':'s'}</option>`).join('')}</select></label><button>Save Number of Tractors</button></form><div class="alert" style="margin-top:12px"><b>Automatic setup:</b> The Hub will use ${tractorCount} tractor${tractorCount===1?'':'s'}, create ${tractorCount} team${tractorCount===1?'':'s'}, and build the rotation from those active tractors.<br><span class="small">With more than five students on a team, some team roles will be duplicated at the same station, but each student's role will still rotate automatically.</span></div><div class="alert"><b>Team roles remain automatic.</b> Navigator, Locator, Tool Operator, Recorder, and Verifier rotate at every station regardless of which models or hunt items you choose.</div><form method="post" action="/instructor/builder/${c.id}/hunt/clear" style="margin-top:12px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Clear all scavenger-hunt stations and current hunt progress for this class?')">Clear Hunt Stations</button></form></div></div><div class="grid">${tractorCards}</div><div class="card"><div class="big">Add a Custom Hunt Item</div><p class="small muted">Use this when the item you want is not in the checklist above.</p><form method="post" action="/instructor/builder/${c.id}/station"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Tractor<select name="tractor_no" required>${tractorSelectOptions}</select></label><label>Item Name<input name="name" placeholder="Example: New battery location" required></label><label>Technician Task<textarea name="task" required></textarea></label><label>Expected Answer / Verification<input name="expected" required></label><button>Add Custom Hunt Item</button></form></div><div class="card"><div class="section-title"><div class="big">Current Hunt</div><span class="pill">${hs.rowCount} items</span></div>${hcards||'<p>No hunt items yet. Choose tractor models and add items above.</p>'}</div>`));
});
app.post('/instructor/builder/:id/question',auth,async(req,res)=>{ await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer),req.body.explanation||'',req.body.topic||'']); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/hunt/tractor-count',auth,async(req,res)=>{
  const cid=Number(req.params.id), count=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(req.body.tractor_count)||3));
  const old=(await pool.query('SELECT hunt_tractor_count FROM classes WHERE id=$1',[cid])).rows[0];
  await pool.query('UPDATE classes SET hunt_tractor_count=$2 WHERE id=$1',[cid,count]);
  if(old && Number(old.hunt_tractor_count)!==count){
    const removed=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 AND COALESCE(tractor_no,999)>$2',[cid,count])).rows.map(x=>x.id);
    if(removed.length) await pool.query('DELETE FROM hunt_stations WHERE id=ANY($1::int[])',[removed]);
    await pool.query('DELETE FROM hunt_tractors WHERE class_id=$1 AND tractor_no>$2',[cid,count]);
    await pool.query(`DELETE FROM results WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);
    await pool.query(`UPDATE activity_status SET activity='Joined',status='Joined',progress=0,total=0,current_score=NULL,updated_at=now() WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);
  }
  res.redirect(`/instructor/builder/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});
app.post('/instructor/builder/:id/hunt/tractor/:slot/model',auth,async(req,res)=>{
  const cid=Number(req.params.id); const cfg=(await pool.query('SELECT hunt_tractor_count FROM classes WHERE id=$1',[cid])).rows[0]; const max=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(cfg?.hunt_tractor_count)||3)); const slot=Math.min(max,Math.max(1,Number(req.params.slot)||1)), model=(req.body.model||'').trim();
  await pool.query(`INSERT INTO hunt_tractors(class_id,tractor_no,model) VALUES($1,$2,$3) ON CONFLICT(class_id,tractor_no) DO UPDATE SET model=$3`,[cid,slot,model]);
  await pool.query('UPDATE hunt_stations SET tractor_model=$3 WHERE class_id=$1 AND tractor_no=$2',[cid,slot,model]);
  res.redirect(`/instructor/builder/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});
app.post('/instructor/builder/:id/hunt/tractor/:slot/items',auth,async(req,res)=>{
  const cid=Number(req.params.id); const cfg=(await pool.query('SELECT hunt_tractor_count FROM classes WHERE id=$1',[cid])).rows[0]; const max=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(cfg?.hunt_tractor_count)||3)); const slot=Math.min(max,Math.max(1,Number(req.params.slot)||1));
  const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0]; const model=mq?.model||`Tractor ${slot}`;
  let ids=req.body.items||[]; if(!Array.isArray(ids)) ids=[ids];
  for(const id of ids){ const item=HUNT_ITEM_LIBRARY.find(x=>x.id===id); if(!item) continue; const exists=await pool.query('SELECT 1 FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2 AND item_label=$3',[cid,slot,item.label]); if(exists.rowCount) continue; await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${item.label}`,item.task,item.expected,slot,model,item.label]); }
  res.redirect(`/instructor/builder/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});
app.post('/instructor/builder/:id/hunt/clear',auth,async(req,res)=>{
  const cid=Number(req.params.id); const stationIds=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1',[cid])).rows.map(x=>x.id);
  if(stationIds.length) await pool.query('DELETE FROM hunt_progress WHERE station_id=ANY($1::int[])',[stationIds]);
  await pool.query(`DELETE FROM results WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);
  await pool.query(`UPDATE activity_status SET activity='Joined',status='Joined',progress=0,total=0,current_score=NULL,updated_at=now() WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);
  await pool.query('DELETE FROM hunt_stations WHERE class_id=$1',[cid]);
  res.redirect(`/instructor/builder/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});
app.post('/instructor/builder/:id/station',auth,async(req,res)=>{
  const cid=Number(req.params.id); const cfg=(await pool.query('SELECT hunt_tractor_count FROM classes WHERE id=$1',[cid])).rows[0]; const max=Math.min(HUNT_MAX_TRACTORS,Math.max(1,Number(cfg?.hunt_tractor_count)||3)); const slot=Math.min(max,Math.max(1,Number(req.body.tractor_no)||1)); const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0]; const model=mq?.model||`Tractor ${slot}`;
  await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${req.body.name}`,req.body.task,req.body.expected,slot,model,req.body.name]);
  res.redirect(`/instructor/builder/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});
app.post('/instructor/builder/:id/question/:qid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM quiz_questions WHERE id=$1 AND class_id=$2',[req.params.qid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station/:sid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/class/:id/hunt-qr',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
  const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[c.id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
  const origin=`${req.protocol}://${req.get('host')}`; const cards=[];
  for(let i=0;i<hs.rows.length;i++){ const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:320,margin:1}); const n=Number(h.tractor_no)||0, model=h.tractor_model||models.get(n)||`Tractor ${n||''}`; cards.push(`<div class="card center hunt-card" style="break-inside:avoid"><div class="eyebrow">TRACTOR ${n||'—'} — ${esc(model)}</div><h2>Station ${i+1}</h2><h3>${esc(h.item_label||h.station_name)}</h3><img class="qr" src="${qr}" alt="QR code for ${esc(h.station_name)}"><p>${esc(h.task)}</p><p class="small muted">Class ${esc(c.code)} · ${esc(c.course)}</p></div>`); }
  const summary=[1,2,3].map(n=>`<b>Tractor ${n}:</b> ${esc(models.get(n)||'Model not set')}`).join(' &nbsp; · &nbsp; ');
  res.send(layout('Scavenger Hunt QR Codes', `<div class="no-print toolbar"><button onclick="window.print()">Print QR Station Sheets</button><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a></div><div class="center"><h1>${esc(c.course)} — Custom Tractor Scavenger Hunt</h1><p>${summary}</p><p>Place each QR sheet at the tractor/model shown on the card.</p></div><div class="grid">${cards.join('')||'<div class="card">No hunt items have been selected yet.</div>'}</div>`, `<style>@media print{.grid{grid-template-columns:1fr 1fr}.card{border:1px solid #999!important;padding:16px!important}.qr{max-width:220px}}</style>`));
});
app.get('/instructor/feedback',auth,async(req,res)=>{
  const q=await pool.query(`SELECT c.id,c.course,c.title,c.code,count(f.student_id)::int responses,round(avg(f.overall)::numeric,1) overall FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN training_feedback f ON f.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 60`);
  const rows=q.rows.map(x=>`<tr><td><b>${esc(x.course)}</b><br><span class="small muted">${esc(x.title)}</span></td><td>${esc(x.code)}</td><td>${x.responses}</td><td>${x.overall||'—'}</td><td><a class="btn light" href="/instructor/class/${x.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">View Feedback</a></td></tr>`).join('');
  res.send(layout('Training Feedback', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Training Feedback</div><p class="muted">Student ratings and comments by class.</p><table><tr><th>Class</th><th>Code</th><th>Responses</th><th>Overall</th><th></th></tr>${rows||'<tr><td colspan="5">No classes yet.</td></tr>'}</table></div>`));
});
app.get('/instructor/class/:id/feedback',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const q=await pool.query(`SELECT f.*,s.name,s.dealer FROM training_feedback f JOIN students s ON s.id=f.student_id WHERE s.class_id=$1 ORDER BY f.submitted_at`,[c.id]);
  const avg=k=>q.rowCount?(q.rows.reduce((a,x)=>a+Number(x[k]),0)/q.rowCount).toFixed(1):'—';
  const comments=q.rows.map(x=>`<div class="card"><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.dealer)}</span><div class="grid" style="margin-top:10px"><div><b>Most Helpful</b><p>${esc(x.most_helpful||'—')}</p></div><div><b>Improve</b><p>${esc(x.improve||'—')}</p></div><div><b>Comments</b><p>${esc(x.comments||'—')}</p></div></div></div>`).join('');
  res.send(layout('Class Feedback', `<div class="no-print toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Back to Class</a><button onclick="window.print()">Print Feedback Report</button></div><div class="hero"><div><div class="eyebrow">Training Evaluation</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · ${q.rowCount} responses</p></div></div><div class="grid"><div class="stat"><span>Overall Training</span><b>${avg('overall')}</b></div><div class="stat"><span>Instructor</span><b>${avg('instructor')}</b></div><div class="stat"><span>Usefulness</span><b>${avg('usefulness')}</b></div><div class="stat"><span>Hands-On</span><b>${avg('hands_on')}</b></div><div class="stat"><span>Difficulty / Pace</span><b>${avg('difficulty')}</b></div></div>${comments||'<div class="card">No feedback submitted yet.</div>'}`));
});

app.get('/instructor/student/:id',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0; const skillRows=skills.rows.map(x=>`<label><input style="width:auto" type="checkbox" name="skill_${x.id}" ${x.signed_off?'checked':''}> ${esc(x.skill)}</label>`).join('');
  const resultRows=results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleString()}</td></tr>`).join('');
  const quizResult=results.rows.find(x=>x.activity==='Module Quiz'); const missed=(quizResult?.details?.missed||[]); const quizReview=missed.length?missed.map((m,i)=>`<div class="q feedback-miss"><b>Missed ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question||m)}</p>${m.selected?`<p><b>Student Answer:</b> ${esc(m.selected)}</p><p><b>Correct Answer:</b> ${esc(m.correct)}</p><p><b>Explanation:</b> ${esc(m.explanation||'')}</p>`:''}</div>`).join(''):'<div class="success">No missed quiz questions recorded.</div>';
  const feedback=(await pool.query('SELECT * FROM training_feedback WHERE student_id=$1',[s.id])).rows[0];
  res.send(layout('Student Record', `<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${s.class_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Printable Report</a><a class="btn alt" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Certificate</a></div><div class="card no-print" style="border-color:#e4b4b4"><div class="big danger">Delete Student</div><p class="muted">This permanently removes this student, their scores, skills, comments, and certificate record.</p><form method="post" action="/instructor/student/${s.id}/delete" onsubmit="return confirm('Permanently delete ${esc(s.name)} and all of this student’s results? This cannot be undone.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete Student Record</button></form></div><div class="card"><div class="big">${esc(s.name)}</div><p>${esc(s.dealer)} · ${esc(s.course)} · Class ${esc(s.code)}</p><div class="grid"><div class="stat"><span>Overall Average</span><b>${avg}%</b></div><div class="stat"><span>Passing Score</span><b>${s.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${s.hours}</b></div></div></div><div class="card"><div class="big">Activity Results</div><table><tr><th>Activity</th><th>Score</th><th>Completed</th></tr>${resultRows||'<tr><td colspan="3">No completed activities yet.</td></tr>'}</table></div><div class="card"><div class="big">Quiz Review — What the Student Missed</div>${quizReview}</div><div class="card"><div class="big">Training Feedback</div>${feedback?`<p><b>Overall:</b> ${feedback.overall}/5 · <b>Instructor:</b> ${feedback.instructor}/5 · <b>Usefulness:</b> ${feedback.usefulness}/5 · <b>Hands-On:</b> ${feedback.hands_on}/5 · <b>Difficulty/Pace:</b> ${feedback.difficulty}/5</p><p><b>Most helpful:</b> ${esc(feedback.most_helpful||'—')}</p><p><b>Improve:</b> ${esc(feedback.improve||'—')}</p><p><b>Comments:</b> ${esc(feedback.comments||'—')}</p>`:'<p class="muted">No training feedback submitted yet.</p>'}</div><div class="card"><div class="big">Instructor Skills Signoff</div><form method="post" action="/instructor/student/${s.id}/save"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}">${skillRows}<label>Instructor Comments<textarea name="comments" rows="5">${esc(notes.comments||'')}</textarea></label><label>Certification Status<select name="status"><option ${notes.certification_status==='Pending'?'selected':''}>Pending</option><option ${notes.certification_status==='Certified'?'selected':''}>Certified</option><option ${notes.certification_status==='Not Yet Certified'?'selected':''}>Not Yet Certified</option></select></label><button>Save Student Record</button></form></div>`));
});
app.post('/instructor/student/:id/save',auth,async(req,res)=>{
  const skills=await pool.query('SELECT id FROM skills WHERE student_id=$1',[req.params.id]); for(const x of skills.rows){ const on=!!req.body['skill_'+x.id]; await pool.query('UPDATE skills SET signed_off=$1,signed_by=$2,signed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$3',[on,'Instructor',x.id]); }
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[req.params.id]); const cert=(existing.rows[0]?.certificate_no)||certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,comments,certification_status,certificate_no) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET comments=excluded.comments,certification_status=excluded.certification_status,certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[req.params.id,req.body.comments||'',req.body.status||'Pending',cert]);
  res.redirect(`/instructor/student/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.post('/instructor/student/:id/delete',auth,async(req,res)=>{ const q=await pool.query('SELECT class_id,name FROM students WHERE id=$1',[req.params.id]); if(!q.rowCount) return res.status(404).send('Student not found'); const classId=q.rows[0].class_id; await pool.query('DELETE FROM students WHERE id=$1',[req.params.id]); res.send(layout('Student Deleted', `<div class="card center"><div class="big">Student Deleted</div><p>${esc(q.rows[0].name)} and all associated training records were removed.</p><a class="btn" href="/instructor/class/${classId}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Return to Class</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Records</a></div>`)); });

app.get('/instructor/student/:id/report',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{}; const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0;
  const quizResultReport=results.rows.find(x=>x.activity==='Module Quiz'); const missedReport=quizResultReport?.details?.missed||[]; const missedRows=missedReport.map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question||m)}</b>${m.selected?`<p><b>Student Answer:</b> ${esc(m.selected)}<br><b>Correct Answer:</b> ${esc(m.correct)}<br><b>Explanation:</b> ${esc(m.explanation||'')}</p>`:''}</div>`).join('');
  res.send(layout('Student Report', `<div class="report"><div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="center"><h1>${esc((await pool.query("SELECT value FROM site_settings WHERE key='organization_name'")).rows[0]?.value||'Mahindra Technician Training')} Record</h1><p>${esc(s.course)}</p></div><div class="card"><table><tr><th>Technician</th><td>${esc(s.name)}</td><th>Dealer</th><td>${esc(s.dealer)}</td></tr><tr><th>Instructor</th><td>${esc(s.instructor)}</td><th>Class Code</th><td>${esc(s.code)}</td></tr><tr><th>Course Hours</th><td>${s.hours}</td><th>Overall Average</th><td><b>${avg}%</b></td></tr><tr><th>Passing Score</th><td>${s.pass_score}%</td><th>Status</th><td><b>${esc(notes.certification_status|| (avg>=s.pass_score?'PASS':'REVIEW'))}</b></td></tr><tr><th>Certificate No.</th><td colspan="3">${esc(notes.certificate_no||'Pending')}</td></tr></table></div><div class="card"><h2>Activity Results</h2><table><tr><th>Activity</th><th>Score</th><th>Date</th></tr>${results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleDateString()}</td></tr>`).join('')}</table></div><div class="card"><h2>Quiz Review — Missed Questions</h2>${missedRows||'<p>No missed questions recorded.</p>'}</div><div class="card"><h2>Practical Skills</h2>${skills.rows.map(x=>`<p>☐ ${x.signed_off?'✓ ':''}${esc(x.skill)} ${x.signed_off?`— Verified by ${esc(x.signed_by||'Instructor')}`:''}</p>`).join('')}</div><div class="card"><h2>Instructor Comments</h2><p>${esc(notes.comments||'')}</p><div style="margin-top:50px;display:flex;gap:60px"><div style="flex:1;border-top:1px solid #000;padding-top:5px">Technician Signature</div><div style="flex:1;border-top:1px solid #000;padding-top:5px">Instructor Signature</div></div></div></div>`, `<script>window.addEventListener('load',()=>{});</script>`));
});
app.get('/instructor/student/:id/certificate',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found'); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  res.send(layout('Certificate', `<div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div style="border:10px double #b5121b;padding:50px;text-align:center;min-height:650px"><h1 style="font-size:42px;margin-top:20px">${esc((await pool.query("SELECT value FROM site_settings WHERE key='certificate_title'")).rows[0]?.value||'Certificate of Completion')}</h1><p style="font-size:22px">This certifies that</p><div style="font-size:38px;font-weight:800;margin:35px">${esc(s.name)}</div><p style="font-size:22px">of ${esc(s.dealer)}</p><p style="font-size:20px;margin-top:35px">has completed</p><div style="font-size:30px;font-weight:800">${esc(s.course)}</div><p>${s.hours} training hours</p><p style="margin-top:40px">Certificate: <b>${esc(notes.certificate_no||'Pending Instructor Approval')}</b></p><div style="margin:70px auto 0;max-width:420px;border-top:1px solid #000;padding-top:8px">${esc(s.instructor)} — Instructor</div></div>`, `<style>@page{size:landscape;margin:.4in}</style>`));
});
app.get('/instructor/history',auth,async(req,res)=>{
  const term=(req.query.q||'').trim(); const params=[]; let where=''; if(term){params.push('%'+term+'%'); where='WHERE s.name ILIKE $1 OR s.dealer ILIKE $1 OR c.course ILIKE $1';}
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id ${where} GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`,params);
  res.send(layout('Student Records', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Dashboard</a></div><div class="card"><div class="big">Student Records</div><form method="get"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Search technician, dealer, or course<input name="q" value="${esc(term)}"></label><button>Search</button></form><table><tr><th>Technician</th><th>Dealer</th><th>Course</th><th>Average</th><th></th></tr>${q.rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer)}</td><td>${esc(x.course)}</td><td>${x.avg_score}%</td><td class="nowrap"><a class="btn light" href="/instructor/student/${x.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open</a> <form method="post" action="/instructor/student/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(x.name)} and ALL associated results?')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" style="padding:10px 12px">Delete</button></form></td></tr>`).join('')}</table></div>`));
});


app.get('/instructor/admin',auth,async(req,res)=>{
  const courses=await pool.query('SELECT * FROM course_catalog ORDER BY active DESC,name');
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const courseRows=courses.rows.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Active':'Archived'}</span></td><td class="nowrap"><form method="post" action="/instructor/admin/course/${c.id}/toggle" style="display:inline"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="btn light">${c.active?'Archive':'Restore'}</button></form> <form method="post" action="/instructor/admin/course/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this course name from the catalog? Existing classes will not be deleted.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete</button></form></td></tr>`).join('');
  res.send(layout('Admin Content Editor', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="hero"><div><div class="eyebrow">Admin</div><h1>Content Editor</h1><p class="muted">Change the training system from here instead of editing GitHub code.</p></div></div><div class="grid"><div class="card"><div class="big">Website Wording</div><form method="post" action="/instructor/admin/settings"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Instructor Home Message<textarea name="home_message" rows="3">${esc(settings.home_message||'')}</textarea></label><label>Organization / Report Name<input name="organization_name" value="${esc(settings.organization_name||'')}"></label><label>Certificate Title<input name="certificate_title" value="${esc(settings.certificate_title||'Certificate of Completion')}"></label><button>Save Website Content</button></form></div><div class="card"><div class="big">Add Course</div><form method="post" action="/instructor/admin/course"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Course Name<input name="name" placeholder="Example: 4600 Series Diagnostics" required></label><button>Add Course</button></form><p class="small muted">New active courses immediately appear in Start Class.</p></div></div><div class="card"><div class="section-title"><h2>Course Catalog</h2><span class="muted small">Archive hides a course without removing old class records.</span></div><div style="overflow:auto;margin-top:12px"><table><tr><th>Course</th><th>Status</th><th>Actions</th></tr>${courseRows}</table></div></div><div class="card"><div class="big">Training Content</div><p>Questions and scavenger-hunt stations are managed inside each class.</p><a class="btn" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Test / Hunt Builder</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Manage Students</a></div>`));
});
app.post('/instructor/admin/settings',auth,async(req,res)=>{ for(const key of ['home_message','organization_name','certificate_title']){ const value=(req.body[key]||'').trim(); await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]); } res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course',auth,async(req,res)=>{ const name=(req.body.name||'').trim(); if(name) await pool.query('INSERT INTO course_catalog(name,active) VALUES($1,true) ON CONFLICT(name) DO UPDATE SET active=true',[name]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE course_catalog SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM course_catalog WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.listen(port,'0.0.0.0',()=>console.log(`${APP_NAME} running on port ${port}`));

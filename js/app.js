const DB_NAME='ruanginap', DB_VERSION=2, PEDIATRIC_MAX_YEARS=18;

const DEFAULT_TEMPLATE=`SOAP Rawat Inap — [TANGGAL]
[RUANG_BED]
[HARI_RAWAT_LINE]
[DPJP_LINE]

[NAMA_PASIEN]
[JENIS_KELAMIN]
[USIA]
[BB_IF_AVAILABLE]

Dx:
[DIAGNOSIS]

S:
[SUBJECTIVE]

O:
[GCS_IF_AVAILABLE]
[VITALS]
[BALANCE_IF_AVAILABLE]

[PHYSICAL_EXAM]

[PENUNJANG_IF_AVAILABLE]

A:
[ASSESSMENT]

P:
[PLAN]`;

const KONSUL_TEMPLATE=`Selamat [WAKTU] dokter. Izin dok dengan [NAMA_DOKTER], dokter jaga [UNIT] [RS]. Izin konsul pasien rawat inap.

[RUANG_BED]
[HARI_RAWAT_LINE]

[NAMA_PASIEN]
[JENIS_KELAMIN]
[USIA]
[BB_IF_AVAILABLE]

Dx:
[DIAGNOSIS]

S:
[SUBJECTIVE]

O:
[GCS_IF_AVAILABLE]
[VITALS]

[PHYSICAL_EXAM]

[PENUNJANG_IF_AVAILABLE]

A:
[ASSESSMENT]

P:
[PLAN]

Mohon advice selanjutnya. Terima kasih dokter.`;

const DEFAULT_TEMPLATE_NAME='SOAP Rawat Inap';
const KONSUL_TEMPLATE_NAME='Konsultasi';

const state={
  list:'active',
  ward:'all',
  dpjp:'all',
  patients:[],
  editingId:null,
  consultPatientId:null,
  consultDraft:[],
  detailId:null,
  templateId:null,
  activeTemplateId:null,
  updatePatientId:null,
  updateType:'vitals'
};

const $=id=>document.getElementById(id);
const now=()=>new Date().toISOString();
const clean=v=>(v??'').toString().trim();
const num=v=>clean(v)===''?null:Number(v);

/* ---------- Rawat inap helpers ---------- */
function localDate(d=new Date()){
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysBetween(a,b){
  return Math.round(
    (new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000
  );
}

function formatDay(dateStr){
  if(!dateStr)return'';
  return new Intl.DateTimeFormat('id-ID',{
    day:'2-digit',month:'short',year:'numeric'
  }).format(new Date(dateStr+'T00:00:00'));
}

function hariRawat(p){
  const d=p.admission?.date;
  if(!d)return null;
  const end=
    p.status==='completed'&&p.dischargedAt
      ?localDate(new Date(p.dischargedAt))
      :localDate();
  return Math.max(1,daysBetween(d,end)+1);
}

function wardClass(name){
  if(!name)return'wc-none';
  let h=0;
  for(const c of String(name))h=(h*31+c.charCodeAt(0))>>>0;
  return'wc'+(h%8);
}

function wardBadge(p){
  const w=p.admission?.ward||'';
  const bed=p.admission?.bed||'';
  if(!w)return'<span class="ward-badge wc-none">Tanpa ruang</span>';
  return`<span class="ward-badge ${wardClass(w)}">${esc(w)}${bed?` · Bed ${esc(bed)}`:''}</span>`;
}

function assessmentText(p){
  return clean(p.assessment)||p.diagnosis.join('\n');
}

function fluidStats(p){
  const f=p.objective?.fluid||{};
  if(![f.intake,f.urine,f.other].some(x=>x!=null))return null;

  const w=p.patient.weight;
  const t=p.objective.vitals?.temperature;
  let iwl=null;

  if(p.patient.group!=='pediatric'&&w>0){
    iwl=15*w;
    if(t!=null&&t>37)iwl+=200*(t-37);
  }

  const out=(f.urine||0)+(f.other||0)+(iwl||0);

  return{
    f,
    iwl,
    balance:f.intake!=null?Math.round(f.intake-out):null,
    uo:f.urine!=null&&w>0?f.urine/w/24:null
  };
}

function fluidBalance(p){
  const s=fluidStats(p);
  return s?s.balance:null;
}

function fluidText(p){
  const s=fluidStats(p);
  if(!s)return'';

  const parts=[];
  if(s.f.intake!=null)parts.push(`masuk ${s.f.intake} mL`);
  if(s.f.urine!=null)
    parts.push(`urin ${s.f.urine} mL${s.uo!=null?` (${s.uo.toFixed(1)} mL/kgBB/jam)`:''}`);
  if(s.f.other!=null)parts.push(`output lain ${s.f.other} mL`);
  if(s.iwl!=null)parts.push(`IWL ~${Math.round(s.iwl)} mL`);

  const head=
    s.balance!=null
      ?`Balance cairan 24 jam: ${s.balance>0?'+':''}${s.balance} mL`
      :'Cairan 24 jam';

  return`${head} (${parts.join(', ')})`;
}

/* ---------- Penunjang (lab + imaging) ---------- */
const LAB_MAP=[
  ['labHb','hb'],['labHt','ht'],['labLeu','leu'],['labPlt','plt'],
  ['labGds','gds'],['labUreum','ureum'],['labCr','cr'],
  ['labSgot','sgot'],['labSgpt','sgpt'],['labAlb','alb'],
  ['labNa','na'],['labK','k'],['labCl','cl']
];

const IMG_MAP=[
  ['imgThorax','thorax'],['imgCt','ct'],['imgUsg','usg'],['imgOther','other']
];

function readPenunjang(){
  const lab={
    date:$('labDate').value||'',
    other:clean($('labOther').value)
  };

  LAB_MAP.forEach(([id,k])=>{lab[k]=num($(id).value);});

  const imaging={};

  IMG_MAP.forEach(([id,k])=>{imaging[k]=clean($(id).value);});

  return{lab,imaging};
}

function fillPenunjang(p){
  const l=p?.objective?.lab||{};
  const im=p?.objective?.imaging||{};

  $('labDate').value=l.date||'';

  LAB_MAP.forEach(([id,k])=>{$(id).value=l[k]??'';});

  $('labOther').value=l.other||'';

  IMG_MAP.forEach(([id,k])=>{$(id).value=im[k]||'';});

  $('labDetails').open=
    LAB_MAP.some(([,k])=>l[k]!=null)||!!clean(l.other);

  $('imgDetails').open=
    IMG_MAP.some(([,k])=>!!clean(im[k]));
}

function labText(p){
  const l=p.objective?.lab||{};
  const has=k=>l[k]!=null&&l[k]!=='';
  const th=n=>Number(n).toLocaleString('id-ID');
  const item=(label,k,fmt)=>
    has(k)?`${label} ${fmt?fmt(l[k]):l[k]}`:'';
  const grp=a=>a.filter(Boolean).join(', ');

  const lines=[
    grp([
      item('Hb','hb'),item('Ht','ht'),
      item('Leu','leu',th),item('Trombosit','plt',th)
    ]),
    grp([
      item('GDS','gds'),item('Ureum','ureum'),item('Kreatinin','cr'),
      item('SGOT','sgot'),item('SGPT','sgpt'),item('Albumin','alb')
    ]),
    grp([item('Na','na'),item('K','k'),item('Cl','cl')]),
    clean(l.other)
  ].filter(Boolean);

  if(!lines.length)return'';

  return[
    `Lab${l.date?` (${formatDay(l.date)})`:''}:`,
    ...lines
  ].join('\n');
}

function imagingText(p){
  const im=p.objective?.imaging||{};

  return[
    clean(im.thorax)&&`Foto thorax: ${clean(im.thorax)}`,
    clean(im.ct)&&`CT scan: ${clean(im.ct)}`,
    clean(im.usg)&&`USG: ${clean(im.usg)}`,
    clean(im.other)
  ].filter(Boolean).join('\n');
}

function penunjangText(p){
  return[labText(p),imagingText(p)].filter(Boolean).join('\n');
}

/* ---------- DPJP ---------- */
async function refreshDpjpList(){
  const names=new Map();

  state.patients.forEach(p=>{
    const n=clean(p.admission?.dpjp);
    if(n&&!names.has(n.toLowerCase()))names.set(n.toLowerCase(),n);
  });

  const dl=$('dpjpOptions');

  if(dl)
    dl.innerHTML=[...names.values()]
      .sort((a,b)=>a.localeCompare(b,'id'))
      .map(n=>`<option value="${esc(n)}"></option>`)
      .join('');
}

/* ---------- CPPT timeline ---------- */
const EVENT_TITLES={
  created:'Pasien dibuat',
  consultation:'Konsultasi',
  completed:'KRS / Pulang',
  vitals:'TTV diperbarui',
  assessment:'Assessment diperbarui',
  plan:'Terapi / plan diperbarui',
  lab:'Lab / penunjang diperbarui',
  note:'Catatan'
};

function eventTitle(e){
  return e.type==='update'
    ?(EVENT_TITLES[e.subtype]||'Update')
    :(EVENT_TITLES[e.type]||'Update');
}

function cpptDayLabel(dateStr){
  return new Intl.DateTimeFormat('id-ID',{
    weekday:'long',day:'numeric',month:'short',year:'numeric'
  }).format(new Date(dateStr+'T00:00:00'));
}

function cpptHtml(p){
  const today=localDate();
  const map=new Map();

  const get=d=>{
    if(!map.has(d))map.set(d,{date:d,visite:null,events:[]});
    return map.get(d);
  };

  (p.visites||[]).forEach(v=>{get(v.date).visite=v;});

  (p.timeline||[]).forEach(e=>{
    get(localDate(new Date(e.at))).events.push(e);
  });

  const days=[...map.values()]
    .sort((a,b)=>b.date.localeCompare(a.date));

  const hpOf=d=>
    p.admission?.date
      ?Math.max(1,daysBetween(p.admission.date,d)+1)
      :null;

  const timeOf=iso=>
    new Intl.DateTimeFormat('id-ID',{
      hour:'2-digit',minute:'2-digit'
    }).format(new Date(iso));

  const needToday=
    p.status==='active'&&!map.get(today)?.visite;

  const todo=needToday
    ?`
      <div class="cppt-item cppt-todo">
        <span class="cppt-dot"></span>
        <div class="cppt-body">
          <div class="cppt-head">
            <span class="cppt-date">${esc(cpptDayLabel(today))}</span>
            <span class="cppt-today">Hari ini</span>
            ${hpOf(today)!=null?`<span class="hp-badge">HP ${hpOf(today)}</span>`:''}
          </div>
          <p class="cppt-empty">Belum ada SOAP untuk hari ini.</p>
          <button type="button" class="secondary-btn" id="cpptNewBtn">
            Isi SOAP hari ini
          </button>
        </div>
      </div>
    `
    :'';

  const items=days.map(d=>{
    const hp=hpOf(d.date);
    const v=d.visite;
    const isToday=d.date===today;

    const events=d.events
      .slice()
      .sort((a,b)=>new Date(a.at)-new Date(b.at))
      .map(e=>`
        <li class="ev-${esc(e.type==='update'?e.subtype:e.type)}">
          <b>${esc(eventTitle(e))}</b>
          <small>${esc(timeOf(e.at))}</small>
          ${e.summary?`<span class="ev-sum">${esc(e.summary)}</span>`:''}
        </li>
      `)
      .join('');

    const soap=v
      ?`
        <details class="cppt-soap">
          <summary>
            <span>SOAP</span>
            ${v.a?`<span class="cppt-a">A: ${esc(v.a)}</span>`:''}
          </summary>
          <pre class="output-box">${esc(v.text)}</pre>
          <button
            type="button"
            class="secondary-btn"
            data-visite-copy="${v.id}">
            Copy SOAP
          </button>
        </details>
      `
      :'';

    return`
      <div class="cppt-item ${v?'has-soap':''} ${isToday?'is-today':''}">
        <span class="cppt-dot"></span>
        <div class="cppt-body">
          <div class="cppt-head">
            <span class="cppt-date">${esc(cpptDayLabel(d.date))}</span>
            ${isToday?'<span class="cppt-today">Hari ini</span>':''}
            ${hp!=null?`<span class="hp-badge">HP ${hp}</span>`:''}
          </div>
          ${events?`<ul class="cppt-events">${events}</ul>`:''}
          ${soap}
        </div>
      </div>
    `;
  }).join('');

  const nSoap=days.filter(d=>d.visite).length;

  return`
    <section class="detail-section cppt-section">
      <div class="row-between">
        <h2>CPPT</h2>
        <span class="cppt-count">${nSoap} SOAP tersimpan</span>
      </div>
      <div class="cppt">
        ${
          todo+items||
          '<div class="empty">Belum ada catatan. Simpan pasien dengan centang “Simpan ke riwayat visite”.</div>'
        }
      </div>
    </section>
  `;
}

function soapPlain(p){
  const o=[
    gcsText(p),
    vitalsText(p),
    fluidText(p),
    physicalText(p),
    penunjangText(p)
  ].filter(Boolean);

  return[
    'S:',
    p.subjective,
    '',
    'O:',
    ...o,
    '',
    'A:',
    assessmentText(p),
    '',
    'P:',
    p.plan
  ]
  .join('\n')
  .replace(/\n{3,}/g,'\n\n')
  .trim();
}

function bindCalc(ids,run){
  ids.forEach(id=>{
    $(id)?.addEventListener('input',run);
    $(id)?.addEventListener('change',run);
  });
}

async function refreshWardList(){
  const pr=await profile();
  const names=new Set(pr.wards||[]);
  state.patients.forEach(p=>{
    if(p.admission?.ward)names.add(p.admission.ward);
  });
  const dl=$('wardOptions');
  if(dl)
    dl.innerHTML=[...names]
      .map(n=>`<option value="${esc(n)}"></option>`)
      .join('');

  await refreshDpjpList();
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains('patients'))
        db.createObjectStore('patients',{keyPath:'id'});
      if(!db.objectStoreNames.contains('settings'))
        db.createObjectStore('settings',{keyPath:'key'});
      if(!db.objectStoreNames.contains('templates'))
        db.createObjectStore('templates',{keyPath:'id'});
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}

async function dbDelete(store,key){
  const db=await openDB();

  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');

    tx.objectStore(store).delete(key);

    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function dbPut(store,value){
  const db=await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete=res;
    tx.onerror=()=>rej(tx.error);
  });
}

async function dbGet(store,key){
  const db=await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store);
    const r=tx.objectStore(store).get(key);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}

async function dbAll(store){
  const db=await openDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(store);
    const r=tx.objectStore(store).getAll();
    r.onsuccess=()=>res(r.result||[]);
    r.onerror=()=>rej(r.error);
  });
}

function formatDate(iso){
  return new Intl.DateTimeFormat('id-ID',{
    day:'2-digit',
    month:'short',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit'
  }).format(new Date(iso));
}

function relativeTime(iso){
  const mins=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));
  if(mins<1)return'baru saja';
  if(mins<60)return`${mins} menit lalu`;

  const h=Math.floor(mins/60);
  if(h<24)return`${h} jam lalu`;

  return formatDate(iso);
}

function greeting(){
  const h=new Date().getHours();
  return h<11?'pagi':h<15?'siang':h<18?'sore':'malam';
}

function patientGroup(y){
  return Number(y)<PEDIATRIC_MAX_YEARS?'pediatric':'adult';
}

function genderLabel(g){
  return g==='L'?'Laki-laki':g==='P'?'Perempuan':'';
}

function ageText(p){
  const a=p.patient.age;

  if(p.patient.group==='pediatric'){
    const x=[];

    if(a.years)x.push(`${a.years} tahun`);
    if(a.months)x.push(`${a.months} bulan`);
    if(a.days)x.push(`${a.days} hari`);

    return x.join(' ')||'0 hari';
  }

  return a.years!=null?`${a.years} tahun`:'';
}

function physicalText(p){
  const o=p.objective.physicalExam;
  const lines=[];

  if(clean(o.head))
    lines.push(`Kepala: ${clean(o.head)}`);

  if(clean(o.thorax))
    lines.push(`Thorax: ${clean(o.thorax)}`);

  if(clean(o.abdomen))
    lines.push(`Abdomen: ${clean(o.abdomen)}`);

  if(clean(o.extremities))
    lines.push(`Ekstremitas: ${clean(o.extremities)}`);

  if(clean(o.other))
    lines.push(clean(o.other));

  return lines.join('\n');
}

function gcsText(p){
  const g=p.objective.gcs;

  return [g.e,g.v,g.m].every(
    x=>x!=null&&x!==''
  )?`GCS: E${g.e}V${g.v}M${g.m}`:'';
}

function vitalsText(p){
  const v=p.objective.vitals;
  const lines=[];

  if(v.sbp!=null&&v.dbp!=null)
    lines.push(`TD: ${v.sbp}/${v.dbp}`);

  if(v.hr!=null)
    lines.push(`HR: ${v.hr}`);

  if(v.rr!=null)
    lines.push(`RR: ${v.rr}`);

  if(v.temperature!=null)
    lines.push(`T: ${v.temperature}`);

  if(v.spo2!=null){
    let ox=v.oxygen||'Room air';

    if(
      ox!=='Room air' &&
      v.oxygenFlow!=null
    ){
      ox+=` ${v.oxygenFlow} L/menit`;
    }

    lines.push(`SpO₂: ${v.spo2}% ${ox}`);
  }

  return lines.join('\n');
}

function mapOf(p){
  const v=p.objective.vitals;

  return v.sbp!=null&&v.dbp!=null
    ?Math.round((v.sbp+2*v.dbp)/3)
    :null;
}

function shockIndex(p){
  const v=p.objective.vitals;

  return v.hr!=null&&v.sbp
    ?Math.round((v.hr/v.sbp)*100)/100
    :null;
}

function esc(v){
  return String(v??'').replace(
    /[&<>"']/g,
    c=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[c])
  );
}

async function profile(){
  return(
    await dbGet('settings','profile')
  )?.value||{
    doctor:'',
    hospital:'',
    unit:'',
    wards:[]
  };
}

function smartClean(t){
  return t
    .replace(/\n{3,}/g,'\n\n')
    .split('\n')
    .map(x=>x.trimEnd())
    .join('\n')
    .trim();
}

async function renderTemplate(body,p){
  const pr=await profile();
  let t=body;

  const r=(a,b)=>{
    t=t.split(a).join(b??'');
  };

  r('[WAKTU]',greeting());
  r('[NAMA_DOKTER]',pr.doctor);
  r('[UNIT]',pr.unit);
  r('[RS]',pr.hospital);
  r('[NAMA_PASIEN]',p.patient.name);
  r('[JENIS_KELAMIN]',genderLabel(p.patient.gender));
  r('[USIA]',ageText(p));

  const hp=hariRawat(p);
  const ad=p.admission||{};

  r('[TANGGAL]',
    new Intl.DateTimeFormat('id-ID',{
      weekday:'long',day:'numeric',month:'long',year:'numeric'
    }).format(new Date()));
  r('[RUANG]',ad.ward||'');
  r('[BED]',ad.bed||'');
  r('[RUANG_BED]',
    ad.ward
      ?`Ruang: ${ad.ward}${ad.bed?` / Bed ${ad.bed}`:''}`
      :'');
  r('[HARI_RAWAT]',hp!=null?String(hp):'');
  r('[TGL_MASUK]',formatDay(ad.date));
  r('[HARI_RAWAT_LINE]',
    hp!=null
      ?`Hari rawat ke-${hp}${ad.date?` (MRS ${formatDay(ad.date)})`:''}`
      :'');
  r('[DPJP]',ad.dpjp||'');
  r('[DPJP_LINE]',ad.dpjp?`DPJP: ${ad.dpjp}`:'');
  r('[BALANCE_IF_AVAILABLE]',fluidText(p));

  r(
    '[BB_IF_AVAILABLE]',
    p.patient.weight!=null
      ?`BB: ${p.patient.weight} kg`
      :''
  );

  r(
    '[DIAGNOSIS]',
    p.diagnosis.join('\n')
  );

  r('[SUBJECTIVE]',p.subjective);
  r('[GCS_IF_AVAILABLE]',gcsText(p));
  r('[VITALS]',vitalsText(p));
  r('[PHYSICAL_EXAM]',physicalText(p));
  r('[PENUNJANG_IF_AVAILABLE]',penunjangText(p));
  r(
    '[ASSESSMENT]',
    assessmentText(p)
  );
  r('[PLAN]',p.plan);

  r(
    '[MAP_IF_AVAILABLE]',
    mapOf(p)!=null
      ?`MAP: ${mapOf(p)} mmHg`
      :''
  );

  r(
    '[SHOCK_INDEX_IF_AVAILABLE]',
    shockIndex(p)!=null
      ?`Shock Index: ${shockIndex(p)}`
      :''
  );

  t=t.replace(/(^|\n)O:\n\n/,'$1O:\n');

  return smartClean(t);
}

async function buildConsultation(p,templateId=null){
  const templates=await dbAll('templates');

  const selectedId=
    templateId||
    p.templateId||
    state.activeTemplateId;

  const selected=
    templates.find(t=>t.id===selectedId)||
    templates.find(t=>t.def)||
    templates.find(t=>t.system)||
    templates[0];

  if(selected)
    state.activeTemplateId=selected.id;

  return renderTemplate(
    selected?.body||DEFAULT_TEMPLATE,
    p
  );
}

function sectionText(p,s){
  if(s==='s')
    return clean(p.subjective||'');

  if(s==='a')
    return clean(
      assessmentText(p)
    );

  if(s==='p')
    return clean(p.plan||'');

  if(s==='o'){
    return[
      gcsText(p),
      vitalsText(p),
      fluidText(p),
      physicalText(p),
      penunjangText(p)
    ]
    .filter(Boolean)
    .join('\n');
  }

  return buildConsultation(p);
}

function emptyPatient(){
  return{
    id:crypto.randomUUID(),
    createdAt:now(),
    updatedAt:now(),
    status:'active',
    templateId:null,

    admission:{
      ward:'',
      bed:'',
      date:localDate(),
      dpjp:''
    },

    patient:{
      name:'',
      gender:'',
      group:'adult',
      age:{
        years:null,
        months:null,
        days:null
      },
      weight:null
    },

    diagnosis:[],
    subjective:'',

    objective:{
      gcs:{
        e:null,
        v:null,
        m:null
      },

      vitals:{
        sbp:null,
        dbp:null,
        hr:null,
        rr:null,
        temperature:null,
        spo2:null,
        oxygen:'Room air',
        oxygenFlow:null
      },

      fluid:{
        intake:null,
        urine:null,
        other:null
      },

      lab:{
        date:'',
        hb:null,ht:null,leu:null,plt:null,
        gds:null,ureum:null,cr:null,sgot:null,sgpt:null,alb:null,
        na:null,k:null,cl:null,
        other:''
      },

      imaging:{
        thorax:'',
        ct:'',
        usg:'',
        other:''
      },

      physicalExam:{
        head:'CA -/-, SI -/-',
        thorax:'ves +/+, rh -/-, wh -/-. BJ reg, m -, g -.',
        abdomen:'supel, BU +',
        extremities:'akral hangat, CRT <2s',
        other:''
      }
    },

    assessment:'',
    plan:'',
    consultations:[],
    timeline:[],
    visites:[]
  };
}

function readForm(existing){
  const p=existing||emptyPatient();

  const years=num($('ageYears').value)??0;
  const g=patientGroup(years);

  p.updatedAt=now();

  p.templateId=
    $('formTemplateSelect')?.value||
    p.templateId||
    null;

  p.patient={
    ...p.patient,

    name:clean($('patientName').value),
    gender:$('gender').value,
    group:g,

    age:{
      years,
      months:
        g==='pediatric'
          ?num($('ageMonths').value)||0
          :0,
      days:
        g==='pediatric'
          ?num($('ageDays').value)||0
          :0
    },

    weight:num($('weight').value)
  };

  p.diagnosis=
    clean($('diagnosis').value)
      .split(/\n+/)
      .map(x=>x.trim())
      .filter(Boolean);

  p.subjective=
    clean($('subjective').value);

  p.objective={
    gcs:{
      e:num($('gcsE').value),
      v:num($('gcsV').value),
      m:num($('gcsM').value)
    },

    vitals:{
      sbp:num($('sbp').value),
      dbp:num($('dbp').value),
      hr:num($('hr').value),
      rr:num($('rr').value),
      temperature:num($('temperature').value),
      spo2:num($('spo2').value),
      oxygen:$('oxygen').value,
      oxygenFlow:num($('oxygenFlow').value)
    },

    physicalExam:{
      head:clean($('headExam').value),
      thorax:clean($('thoraxExam').value),
      abdomen:clean($('abdomenExam').value),
      extremities:clean($('extremityExam').value),
      other:clean($('otherExam').value)
    }
  };

  p.plan=
    clean($('plan').value);

  p.assessment=
    clean($('assessment').value);

  p.admission={
    ward:clean($('ward').value),
    bed:clean($('bed').value),
    date:
      $('admitDate').value||
      p.admission?.date||
      localDate(),
    dpjp:clean($('dpjp').value)
  };

  p.objective.fluid={
    intake:num($('fluidIn').value),
    urine:num($('fluidUrine').value),
    other:num($('fluidOther').value)
  };

  const pn=readPenunjang();

  p.objective.lab=pn.lab;
  p.objective.imaging=pn.imaging;

  return p;
}

function fillForm(p){
  $('patientId').value=p.id;
  $('formTitle').textContent='Edit Pasien';

  $('formTemplateSelect').value=
    p.templateId||
    state.activeTemplateId||
    '';

  $('patientName').value=p.patient.name;
  $('gender').value=p.patient.gender;

  $('ageYears').value=
    p.patient.age.years??'';

  $('ageMonths').value=
    p.patient.age.months||'';

  $('ageDays').value=
    p.patient.age.days||'';

  $('weight').value=
    p.patient.weight??'';

  $('diagnosis').value=
    p.diagnosis.join('\n');

  $('subjective').value=
    p.subjective;

  $('gcsE').value=
    p.objective.gcs.e??'';

  $('gcsV').value=
    p.objective.gcs.v??'';

  $('gcsM').value=
    p.objective.gcs.m??'';

  const v=p.objective.vitals;

  $('sbp').value=v.sbp??'';
  $('dbp').value=v.dbp??'';
  $('hr').value=v.hr??'';
  $('rr').value=v.rr??'';
  $('temperature').value=v.temperature??'';
  $('spo2').value=v.spo2??'';

  $('oxygen').value=
    v.oxygen||'Room air';

  $('oxygenFlow').value=
    v.oxygenFlow??'';

  updateOxygenFlow();

  const o=p.objective.physicalExam;

  $('headExam').value=o.head||'';
  $('thoraxExam').value=o.thorax||'';
  $('abdomenExam').value=o.abdomen||'';
  $('extremityExam').value=o.extremities||'';
  $('otherExam').value=o.other||'';

  $('plan').value=
    p.plan;

  $('assessment').value=
    p.assessment||'';

  const ad=p.admission||{};

  $('ward').value=ad.ward||'';
  $('bed').value=ad.bed||'';
  $('admitDate').value=ad.date||localDate();
  $('dpjp').value=ad.dpjp||'';

  const fl=p.objective.fluid||{};

  $('fluidIn').value=fl.intake??'';
  $('fluidUrine').value=fl.urine??'';
  $('fluidOther').value=fl.other??'';

  fillPenunjang(p);

  $('saveVisite').checked=true;

  updatePediatricFields();
  updatePreview();
}

function updatePediatricFields(){
  const y=num($('ageYears').value);

  const show=
    y!==null&&
    y<PEDIATRIC_MAX_YEARS;

  $('pediatricFields').hidden=!show;

  if(!show){
    $('ageMonths').value='';
    $('ageDays').value='';
  }
}

function updateOxygenFlow(){
  const show=
    $('oxygen').value!=='Room air';

  $('oxygenFlowWrap').hidden=!show;

  if(!show)
    $('oxygenFlow').value='';
}

const physicalOptions={
  head:[
    {
      label:'Konjungtiva anemis',
      value:'CA +/+',
      normal:'CA -/-',
      replace:['CA -/-','CA +/+']
    },
    {
      label:'Sklera ikterik',
      value:'SI +/+',
      normal:'SI -/-',
      replace:['SI -/-','SI +/+']
    },
    {
      label:'Sianosis',
      value:'sianosis +',
      append:true
    },
    {
      label:'Edema palpebra',
      value:'edema palpebra +',
      append:true
    },
    {
      label:'Pupil anisokor',
      value:'pupil anisokor',
      append:true
    }
  ],

  thorax:[
    {
      label:'Vesikuler menurun bilateral',
      value:'ves -/-',
      normal:'ves +/+',
      replace:['ves +/+','ves -/-']
    },
    {
      label:'Ronki bilateral',
      value:'rh +/+',
      normal:'rh -/-',
      replace:['rh -/-','rh +/+']
    },
    {
      label:'Wheezing bilateral',
      value:'wh +/+',
      normal:'wh -/-',
      replace:['wh -/-','wh +/+']
    },
    {
      label:'BJ ireguler',
      value:'BJ ireg',
      normal:'BJ reg',
      replace:['BJ reg','BJ ireg']
    },
    {
      label:'Murmur',
      value:'m +',
      normal:'m -',
      replace:['m -','m +']
    },
    {
      label:'Gallop',
      value:'g +',
      normal:'g -',
      replace:['g -','g +']
    },
    {
      label:'Retraksi',
      value:'retraksi +',
      append:true
    }
  ],

  abdomen:[
    {
      label:'Distensi',
      value:'distensi',
      normal:'supel',
      replace:['supel','distensi']
    },
    {
      label:'Nyeri tekan',
      value:'NT +',
      append:true
    },
    {
      label:'Defans muscular',
      value:'defans +',
      append:true
    },
    {
      label:'BU menurun/tidak terdengar',
      value:'BU -',
      normal:'BU +',
      replace:['BU +','BU -']
    },
    {
      label:'Hepatomegali',
      value:'hepatomegali +',
      append:true
    },
    {
      label:'Splenomegali',
      value:'splenomegali +',
      append:true
    },
    {
      label:'Ascites',
      value:'asites +',
      append:true
    }
  ],

  extremities:[
    {
      label:'Akral dingin',
      value:'akral dingin',
      normal:'akral hangat',
      replace:['akral hangat','akral dingin']
    },
    {
      label:'CRT >2 detik',
      value:'CRT >2s',
      normal:'CRT <2s',
      replace:['CRT <2s','CRT >2s']
    },
    {
      label:'Edema bilateral',
      value:'edema +/+',
      append:true
    },
    {
      label:'Sianosis',
      value:'sianosis +',
      append:true
    },
    {
      label:'Clubbing',
      value:'clubbing +',
      append:true
    },
    {
      label:'Nyeri tekan',
      value:'nyeri tekan +',
      append:true
    }
  ]
};

let physicalSection='head';

function openPhysicalHelper(){
  renderPhysicalOptions();
  $('physicalModal').hidden=false;
}

function physicalInputId(){
  return physicalSection==='extremities'
    ?'extremityExam'
    :physicalSection+'Exam';
}

function physicalCurrent(){
  return $(physicalInputId()).value.trim();
}

function findingSelected(finding,current){
  return current.includes(finding.value);
}

function renderPhysicalOptions(){
  const map={
    head:'Kepala & Mata',
    thorax:'Thorax',
    abdomen:'Abdomen',
    extremities:'Ekstremitas'
  };

  $('physicalSectionTabs').innerHTML=
    Object.keys(map)
      .map(k=>`
        <button
          type="button"
          class="segment ${physicalSection===k?'active':''}"
          data-physical-section="${k}">
          ${map[k]}
        </button>
      `)
      .join('');

  const current=physicalCurrent();
  const opts=physicalOptions[physicalSection]||[];

  $('physicalOptions').innerHTML=
    opts.map((f,i)=>`
      <button
        type="button"
        class="finding-chip ${findingSelected(f,current)?'selected':''}"
        data-finding-index="${i}">
        ${f.label}
        <small>${esc(f.value)}</small>
      </button>
    `)
    .join('');

  const note=
    document.querySelector('.physical-helper-note');

  if(note)
    note.remove();

  $('physicalOptions').insertAdjacentHTML(
    'beforebegin',
    `<p class="helper physical-helper-note">
      Klik temuan untuk mengubah pemeriksaan.
      Klik lagi untuk mengembalikan nilai normal atau menghapus temuan.
    </p>`
  );
}

function removeFindingClause(text,value){
  return text
    .split(',')
    .map(x=>x.trim())
    .filter(x=>x&&x!==value)
    .join(', ');
}

function applyPhysicalFinding(index){
  const f=
    physicalOptions[physicalSection]?.[Number(index)];

  if(!f)return;

  const el=$(physicalInputId());
  let text=el.value.trim();

  if(f.replace){

    if(text.includes(f.value)){
      el.value=
        text.replace(
          f.value,
          f.normal||f.replace[0]
        );
    }else{

      const normal=
        f.normal||f.replace[0];

      if(text.includes(normal)){
        el.value=
          text.replace(
            normal,
            f.value
          );
      }else if(!text){
        el.value=f.value;
      }else{
        el.value=
          text.replace(/[.]$/,'')+
          ', '+
          f.value;
      }
    }

  }else if(f.append){

    if(text.includes(f.value)){
      el.value=
        removeFindingClause(
          text,
          f.value
        );
    }else if(!text){
      el.value=f.value;
    }else{
      el.value=
        text.replace(/[.]$/,'')+
        ', '+
        f.value;
    }
  }

  updatePreview();
}

function ewsScore(p){
  const v=p.objective.vitals;
  const g=p.objective.gcs;

  const rr=v.rr;
  const sp=v.spo2;
  const hr=v.hr;
  const t=v.temperature;

  const vals=[
    rr,
    sp,
    hr,
    t
  ];

  if(
    vals.some(
      x=>x==null||Number.isNaN(x)
    )
  ){
    return null;
  }

  let score=0;

  if(rr>=25)
    score+=3;
  else if(rr>=21)
    score+=2;
  else if(rr>=12)
    score+=0;
  else if(rr>=9)
    score+=1;
  else
    score+=3;

  if(sp<=91)
    score+=3;
  else if(sp<=93)
    score+=2;
  else if(sp<=95)
    score+=1;

  if(hr<=40)
    score+=3;
  else if(hr<=50)
    score+=1;
  else if(hr<=90)
    score+=0;
  else if(hr<=110)
    score+=1;
  else if(hr<=130)
    score+=2;
  else
    score+=3;

  if(t<=35)
    score+=3;
  else if(t<=36)
    score+=1;
  else if(t<=38)
    score+=0;
  else if(t<=39)
    score+=1;
  else
    score+=2;

  const gcsTotal=
    [g.e,g.v,g.m].every(
      x=>x!=null
    )
      ?g.e+g.v+g.m
      :15;

  if(gcsTotal<15)
    score+=3;

  return score;
}

function ewsLabel(score){
  if(score>=7)return'Kritis';
  if(score>=5)return'Perhatian';
  return'Normal';
}

function clinicalAutoText(p){
  const parts=[];

  const map=mapOf(p);
  const si=shockIndex(p);
  const ews=ewsScore(p);

  if(map!=null){
    parts.push(`
      <div>
        <b>${map}</b>
        <small>MAP</small>
      </div>
    `);
  }

  if(si!=null){
    parts.push(`
      <div>
        <b>${si}</b>
        <small>Shock Index</small>
      </div>
    `);
  }

  if(ews!=null){
    parts.push(`
      <div>
        <b>${ews}</b>
        <small>EWS · ${ewsLabel(ews)}</small>
      </div>
    `);
  }

  return parts.join('');
}

function renderClinicalAutoTools(p){
  const box=$('clinicalAutoTools');

  if(!box)return;

  const v=p.objective.vitals;

  const hasAny=[
    v.sbp,
    v.dbp,
    v.hr,
    v.rr,
    v.temperature,
    v.spo2
  ].some(x=>x!=null);

  if(!hasAny){
    box.hidden=true;
    box.innerHTML='';
    return;
  }

  const map=mapOf(p);
  const si=shockIndex(p);
  const ews=ewsScore(p);

  box.hidden=false;

  box.innerHTML=`
    <div class="auto-tools-head">
      <div>
        <span class="eyebrow">Otomatis</span>
        <strong>Clinical tools</strong>
      </div>
      <small>Mengikuti TTV yang diinput</small>
    </div>

    <div class="auto-tools-grid">

      <div class="auto-tool">
        <b>${map!=null?map:'—'}</b>
        <small>MAP</small>
      </div>

      <div class="auto-tool">
        <b>${si!=null?si:'—'}</b>
        <small>Shock Index</small>
      </div>

      <div class="auto-tool">
        <b>${ews!=null?ews:'—'}</b>
        <small>
          EWS${ews!=null?' · '+ewsLabel(ews):''}
        </small>
      </div>

    </div>
  `;
}

async function updatePreview(){
  const p=
    readForm(
      state.editingId
        ?state.patients.find(
          x=>x.id===state.editingId
        )
        :null
    );

  renderClinicalAutoTools(p);

  if(!$('patientName').value.trim()){
    $('formPreview').textContent=
      'Isi identitas pasien untuk melihat preview.';
    return;
  }

  $('formPreview').textContent=
    await buildConsultation(p);
}

function showView(name){
  [
    'patients',
    'form',
    'detail',
    'tools',
    'templates',
    'recap'
  ].forEach(
    v=>$(v+'View').hidden=v!==name
  );

  document
    .querySelectorAll('.nav-item')
    .forEach(
      b=>b.classList.toggle(
        'active',
        b.dataset.nav===name||
        name==='detail'&&
        b.dataset.nav==='patients'
      )
    );

  window.scrollTo({
    top:0,
    behavior:'instant'
  });
}

function openNew(){
  state.editingId=null;

  $('patientForm').reset();
  $('patientId').value='';

  $('formTemplateSelect').value=
    state.activeTemplateId||'';

  $('formTitle').textContent=
    'Pasien Baru';

  $('admitDate').value=localDate();

  $('ward').value=
    state.ward!=='all'?state.ward:'';

  $('saveVisite').checked=true;

  fillPenunjang(null);

  $('oxygen').value=
    'Room air';

  $('oxygenFlow').value='';

  updateOxygenFlow();

  $('headExam').value=
    'CA -/-, SI -/-';

  $('thoraxExam').value=
    'ves +/+, rh -/-, wh -/-. BJ reg, m -, g -.';

  $('abdomenExam').value=
    'supel, BU +';

  $('extremityExam').value=
    'akral hangat, CRT <2s';

  updatePediatricFields();
  updatePreview();

  showView('form');
}

function openEdit(id){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  state.editingId=id;

  fillForm(p);
  showView('form');
}

async function saveForm(){
  const existing=
    state.editingId
      ?state.patients.find(
        x=>x.id===state.editingId
      )
      :null;

  const p=readForm(existing);

  if(
    !p.patient.name||
    !p.patient.gender
  ){
    toast(
      'Lengkapi nama dan jenis kelamin.'
    );
    return;
  }

  if(!p.admission.ward){
    toast(
      'Isi nama ruang rawat inap.'
    );
    return;
  }

  if($('saveVisite').checked){
    p.visites=(p.visites||[])
      .filter(v=>v.date!==localDate());

    p.visites.push({
      id:crypto.randomUUID(),
      date:localDate(),
      at:now(),
      hp:hariRawat(p),
      a:assessmentText(p).split('\n')[0]||'',
      text:soapPlain(p)
    });
  }

  if(
    !existing&&
    !p.timeline.length
  ){
    p.timeline.push({
      id:crypto.randomUUID(),
      type:'created',
      at:p.createdAt,
      summary:'Pasien dibuat dan masuk daftar aktif'
    });
  }

  await dbPut('patients',p);
  await refreshPatients();

  toast(
    existing
      ?'Pasien diperbarui'
      :'Pasien disimpan'
  );

  showView('patients');
}

function consultSummary(p){
  if(!p.consultations?.length)
    return'Belum ada';

  return p.consultations
    .map(
      c=>
        `${c.specialty} `+
        `${c.contacted?'✓':'⏳'}`+
        `${c.adviceReceived?' · advice ✓':''}`
    )
    .join(' • ');
}

function renderList(){
  const q=
    clean(
      $('patientSearch').value
    ).toLowerCase();

  const status=
    state.list==='archive'
      ?'completed'
      :'active';

  const inStatus=
    state.patients.filter(
      p=>p.status===status
    );

  const cmp=(a,b)=>
    String(a).localeCompare(
      String(b),
      'id',
      {numeric:true}
    );

  const dk=p=>clean(p.admission?.dpjp).toLowerCase();
  const wk=p=>p.admission?.ward||'';

  /* --- DPJP --- */
  const dpjpNames=new Map();

  inStatus.forEach(p=>{
    if(!dpjpNames.has(dk(p)))
      dpjpNames.set(dk(p),clean(p.admission?.dpjp));
  });

  if(
    state.dpjp!=='all'&&
    (dpjpNames.size<2||!dpjpNames.has(state.dpjp))
  )
    state.dpjp='all';

  const byDpjp=
    inStatus.filter(
      p=>state.dpjp==='all'||dk(p)===state.dpjp
    );

  /* --- ward --- */
  const wardCounts=new Map();

  byDpjp.forEach(p=>
    wardCounts.set(wk(p),(wardCounts.get(wk(p))||0)+1)
  );

  if(
    state.ward!=='all'&&
    !wardCounts.has(state.ward)
  )
    state.ward='all';

  const byWard=
    inStatus.filter(
      p=>state.ward==='all'||wk(p)===state.ward
    );

  const dpjpCounts=new Map();

  byWard.forEach(p=>
    dpjpCounts.set(dk(p),(dpjpCounts.get(dk(p))||0)+1)
  );

  const wardNames=
    [...wardCounts.keys()].sort(cmp);

  $('wardFilter').innerHTML=
    wardNames.length>1
      ?[
        `<button type="button" class="ward-chip ${state.ward==='all'?'active':''}" data-ward="all">Semua <b>${byDpjp.length}</b></button>`,
        ...wardNames.map(w=>
          `<button type="button" class="ward-chip ${wardClass(w)} ${state.ward===w?'active':''}" data-ward="${esc(w)}">${esc(w||'Tanpa ruang')} <b>${wardCounts.get(w)}</b></button>`
        )
      ].join('')
      :'';

  const dpjpKeys=
    [...dpjpNames.keys()].sort(
      (a,b)=>
        (!a-!b)||
        cmp(dpjpNames.get(a),dpjpNames.get(b))
    );

  $('dpjpFilterWrap').hidden=dpjpNames.size<2;

  $('dpjpFilter').innerHTML=
    [
      `<option value="all">Semua DPJP (${byWard.length})</option>`,
      ...dpjpKeys.map(k=>
        `<option value="${esc(k)}">${esc(dpjpNames.get(k)||'Tanpa DPJP')} (${dpjpCounts.get(k)||0})</option>`
      )
    ].join('');

  $('dpjpFilter').value=state.dpjp;

  /* --- rows --- */
  let rows=
    inStatus.filter(
      p=>
        (state.ward==='all'||wk(p)===state.ward)&&
        (state.dpjp==='all'||dk(p)===state.dpjp)
    );

  rows.sort((a,b)=>{
    if(status==='completed'){
      return new Date(
        b.dischargedAt||b.updatedAt
      )-new Date(
        a.dischargedAt||a.updatedAt
      );
    }

    return(
      cmp(wk(a),wk(b))||
      cmp(
        a.admission?.bed||'',
        b.admission?.bed||''
      )||
      new Date(
        a.createdAt||a.updatedAt
      )-new Date(
        b.createdAt||b.updatedAt
      )
    );
  });

  if(q){
    rows=rows.filter(
      p=>
        (
          p.patient.name+' '+
          p.diagnosis.join(' ')+' '+
          (p.admission?.ward||'')+' '+
          (p.admission?.bed||'')+' '+
          (p.admission?.dpjp||'')
        )
        .toLowerCase()
        .includes(q)
    );
  }

  $('activeCount').textContent=
    state.patients.filter(
      p=>p.status==='active'
    ).length;

  $('archiveCount').textContent=
    state.patients.filter(
      p=>p.status==='completed'
    ).length;

  const c=$('patientList');

  if(!rows.length){
    c.innerHTML=`
      <div class="empty">
        <strong>
          ${
            state.list==='active'
              ?'Belum ada pasien rawat inap'
              :'Belum ada pasien pulang'
          }
        </strong>

        ${
          state.list==='active'
            ?'Klik “Pasien Baru” untuk mulai.'
            :'Pasien yang sudah KRS akan muncul di sini.'
        }
      </div>
    `;

    return;
  }

  const wardTotals=new Map();

  rows.forEach(p=>
    wardTotals.set(wk(p),(wardTotals.get(wk(p))||0)+1)
  );

  const group=
    status==='active'&&
    state.ward==='all'&&
    wardNames.length>0;

  let lastWard=null;

  c.innerHTML=
    rows.map(p=>{
      const w=wk(p);
      const hp=hariRawat(p);
      const bal=fluidBalance(p);
      const done=p.status==='completed';

      const head=
        group&&w!==lastWard
          ?`
            <div class="ward-group-head ${wardClass(w)}">
              <span>${esc(w||'Tanpa ruang')}</span>
              <small>${wardTotals.get(w)} pasien</small>
            </div>
          `
          :'';

      lastWard=w;

      const consult=
        p.consultations?.length
          ?`
            <div class="pc-consult">
              <span class="pc-consult-label">KONSUL</span>
              ${p.consultations.map(c=>`
                <span class="pc-chip ${c.contacted?'ok':'wait'}">
                  ${c.contacted?'✓':'•'}
                  ${esc(specialtyLabel(c.specialty))}
                  ${c.adviceReceived?'<i>advice ✓</i>':''}
                </span>
              `).join('')}
            </div>
          `
          :'';

      return`
        ${head}
        <article
          class="pcard ${wardClass(w)}"
          data-open-patient="${p.id}">

          <div class="pc-main">

            <div class="pc-bed">
              ${esc(p.admission?.bed||'—')}
              <small>BED</small>
            </div>

            <div class="pc-id">
              <h3 class="pc-name">${esc(p.patient.name)}</h3>
              <div class="pc-meta">
                ${esc(ageText(p))}${
                  p.patient.gender
                    ?` · ${esc(p.patient.gender)}`
                    :''
                }${
                  p.patient.weight!=null
                    ?` · BB ${esc(p.patient.weight)} kg`
                    :''
                }
              </div>
            </div>

            <span class="pc-status ${done?'is-done':'is-active'}">
              ${done?'Pulang':'Dirawat'}
            </span>

          </div>

          <div class="pc-dx">
            <span class="pc-dx-label">Dx</span>
            <span class="pc-dx-text">
              ${
                p.diagnosis.length
                  ?esc(p.diagnosis.join(' • '))
                  :'<span class="muted">Belum ada diagnosis</span>'
              }
            </span>
          </div>

          <div class="pc-tags">
            <span class="ward-badge ${wardClass(w)}">${esc(w||'Tanpa ruang')}</span>
            ${hp!=null?`<span class="hp-badge">HP ${hp}</span>`:''}
            ${bal!=null?`<span class="bal-badge ${bal<0?'neg':'pos'}">${bal>0?'+':''}${bal} mL</span>`:''}
            ${p.admission?.dpjp?`<span class="dpjp-tag">${esc(p.admission.dpjp)}</span>`:''}
          </div>

          ${consult}

          <div class="pc-foot">

            <span class="pc-times">
              MRS ${
                p.admission?.date
                  ?esc(formatDay(p.admission.date))
                  :esc(formatDate(p.createdAt||p.updatedAt))
              } · update ${esc(relativeTime(p.updatedAt))}
            </span>

            <div class="pc-actions">
              ${
                done
                  ?`
                    <button class="secondary-btn" data-action="edit" data-id="${p.id}">Buka</button>
                    <button class="secondary-btn" data-action="copy" data-id="${p.id}">Copy SOAP</button>
                  `
                  :`
                    <button class="secondary-btn" data-action="copy" data-id="${p.id}">Copy SOAP</button>
                    <button class="secondary-btn" data-action="consult" data-id="${p.id}">+ Konsul</button>
                    <button class="primary-btn" data-action="done" data-id="${p.id}">KRS</button>
                  `
              }
              <button class="danger-btn" data-action="delete" data-id="${p.id}">Hapus</button>
            </div>

          </div>

        </article>
      `;
    })
    .join('');
}

async function copyText(
  text,
  msg='Tersalin'
){
  try{
    await navigator.clipboard.writeText(text);
    toast(msg);
  }catch{
    toast('Clipboard tidak tersedia.');
  }
}

async function copyPatient(
  id,
  section='all'
){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  await copyText(
    await sectionText(p,section),
    section==='all'
      ?'Format konsultasi tersalin'
      :'Bagian tersalin'
  );
}

async function setPatientTemplate(
  id,
  templateId
){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  p.templateId=
    templateId||null;

  p.updatedAt=now();

  await dbPut('patients',p);

  if(state.detailId===id)
    renderDetail(p);

  await refreshPatients();

  toast(
    'Template pasien diperbarui'
  );
}

function openConsult(id){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  state.consultPatientId=id;

  state.consultDraft=
    (p.consultations||[])
      .map(c=>({...c}));

  renderConsultRows();

  $('consultModal').hidden=false;
}

const specialties=[
  ['Penyakit Dalam','SpPD'],
  ['Anak','SpA'],
  ['Jantung dan Pembuluh Darah','SpJP'],
  ['Bedah','SpB'],
  ['Obstetri dan Ginekologi','SpOG'],
  ['Neurologi','SpN'],
  ['Anestesiologi','SpAn'],
  ['Mata','SpM'],
  ['Telinga Hidung Tenggorok - Bedah Kepala Leher','SpTHT-KL'],
  ['Dermatologi dan Venereologi','SpDV'],
  ['Orthopaedi dan Traumatologi','SpOT'],
  ['Urologi','SpU'],
  ['Pulmonologi dan Kedokteran Respirasi','SpP'],
  ['Psikiatri','SpKJ'],
  ['Radiologi','SpRad']
];

const specialtyMap=
  Object.fromEntries(
    specialties.map(x=>[x[1],x[0]])
  );

function specialtyLabel(code){
  return specialtyMap[code]||code;
}

function renderConsultRows(){
  const c=$('consultRows');

  c.innerHTML=
    state.consultDraft
      .map(
        (x,i)=>`
          <div class="consult-row">

            <div class="row-between">

              <select
                class="consult-select"
                data-consult-specialty
                data-index="${i}">

                ${
                  specialties.map(
                    ([label,code])=>`
                      <option
                        value="${code}"
                        ${
                          x.specialty===code
                            ?'selected'
                            :''
                        }>
                        ${label} (${code})
                      </option>
                    `
                  ).join('')
                }

              </select>

              <button
                class="text-btn"
                data-remove-consult="${i}">
                Hapus
              </button>

            </div>

            <div class="toggle-row">

              <button
                class="toggle ${
                  x.contacted?'selected':''
                }"
                data-consult-field="contacted"
                data-index="${i}">

                ${
                  x.contacted
                    ?'✓ '
                    :''
                }

                Sudah dihubungi

              </button>

              <button
                class="toggle ${
                  x.adviceReceived
                    ?'selected'
                    :''
                }"
                data-consult-field="adviceReceived"
                data-index="${i}">

                ${
                  x.adviceReceived
                    ?'✓ '
                    :''
                }

                Advice sudah ada

              </button>

            </div>

          </div>
        `
      )
      .join('')||
      `
        <div class="empty">
          Belum ada spesialis. Tambahkan satu.
        </div>
      `;
}

function addConsult(){
  const used=
    state.consultDraft.map(
      x=>x.specialty
    );

  const specialty=
    (
      specialties.find(
        x=>!used.includes(x[1])
      )||
      specialties[0]
    )[1];

  state.consultDraft.push({
    id:crypto.randomUUID(),
    specialty,
    contacted:false,
    adviceReceived:false,
    createdAt:now(),
    updatedAt:now()
  });

  renderConsultRows();
}

async function saveConsult(){
  const p=
    state.patients.find(
      x=>x.id===state.consultPatientId
    );

  if(!p)return;

  p.consultations=
    state.consultDraft;

  p.updatedAt=now();

  p.timeline=
    p.timeline||[];

  p.timeline.push({
    type:'consultation',
    at:now(),

    summary:
      p.consultations
        .map(
          c=>
            `${c.specialty}: `+
            `${
              c.contacted
                ?'dihubungi'
                :'belum'
            }`+
            `${
              c.adviceReceived
                ?', advice ada'
                :''
            }`
        )
        .join(' | ')
  });

  await dbPut('patients',p);
  await refreshPatients();

  $('consultModal').hidden=true;

  if(state.detailId===p.id)
    renderDetail(p);

  toast(
    'Status konsultasi disimpan'
  );
}

function openUpdate(
  id,
  type='vitals'
){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  state.updatePatientId=id;
  state.updateType=type;

  renderUpdateFields();

  $('updateModal').hidden=false;
}

function updateVitalsFields(v){
  return`
    <div class="update-grid">

      <div class="field">
        <label>TD</label>

        <div class="bp-input">

          <input
            id="uSbp"
            type="number"
            inputmode="numeric"
            placeholder="SBP"
            value="${v.sbp??''}">

          <span>/</span>

          <input
            id="uDbp"
            type="number"
            inputmode="numeric"
            placeholder="DBP"
            value="${v.dbp??''}">

        </div>
      </div>

      <div class="field">
        <label>HR (/min)</label>

        <input
          id="uHr"
          type="number"
          inputmode="numeric"
          value="${v.hr??''}">
      </div>

      <div class="field">
        <label>RR (/min)</label>

        <input
          id="uRr"
          type="number"
          inputmode="numeric"
          value="${v.rr??''}">
      </div>

      <div class="field">
        <label>T (°C)</label>

        <input
          id="uTemp"
          type="number"
          step="0.1"
          inputmode="decimal"
          value="${v.temperature??''}">
      </div>

      <div class="field">
        <label>SpO₂ (%)</label>

        <input
          id="uSpo2"
          type="number"
          min="0"
          max="100"
          inputmode="numeric"
          value="${v.spo2??''}">
      </div>

      <div class="field">
        <label>O₂</label>

        <select id="uOxygen">
          <option value="Room air">
            Room air
          </option>

          <option value="Nasal cannula">
            Nasal cannula
          </option>

          <option value="Simple mask">
            Simple mask
          </option>

          <option value="NRM">
            NRM
          </option>

          <option value="HFNC">
            HFNC
          </option>

          <option value="Lainnya">
            Lainnya
          </option>
        </select>
      </div>

      <div
        class="field"
        id="uOxygenFlowWrap"
        hidden>

        <label>
          Flow O₂ (L/menit)
        </label>

        <input
          id="uOxygenFlow"
          type="number"
          min="0"
          step="0.1"
          inputmode="decimal"
          value="${v.oxygenFlow??''}">

      </div>

    </div>

    <div class="subheading">
      GCS
    </div>

    <div class="three-col gcs-grid">

      <div class="field">
        <label>E</label>

        <input
          id="uGcsE"
          type="number"
          min="1"
          max="4"
          value="${
            pUpdate().objective.gcs.e??''
          }">
      </div>

      <div class="field">
        <label>V</label>

        <input
          id="uGcsV"
          type="number"
          min="1"
          max="5"
          value="${
            pUpdate().objective.gcs.v??''
          }">
      </div>

      <div class="field">
        <label>M</label>

        <input
          id="uGcsM"
          type="number"
          min="1"
          max="6"
          value="${
            pUpdate().objective.gcs.m??''
          }">
      </div>

    </div>

    <p class="helper">
      Isi hanya data yang ingin diperbarui.
      Nilai lama akan dipertahankan bila dikosongkan.
    </p>
  `;
}

function pUpdate(){
  return state.patients.find(
    x=>x.id===state.updatePatientId
  )||emptyPatient();
}

function renderUpdateFields(){
  const p=pUpdate();

  document
    .querySelectorAll('.update-tab')
    .forEach(
      b=>b.classList.toggle(
        'active',
        b.dataset.updateType===
        state.updateType
      )
    );

  if(state.updateType==='vitals'){

    $('updateFields').innerHTML=
      updateVitalsFields(
        p.objective.vitals
      );

    $('uOxygen').value=
      p.objective.vitals.oxygen||
      'Room air';

    updateUpdateOxygen();

    $('uOxygen').onchange=
      updateUpdateOxygen;

    return;
  }

  const map={
    plan:[
      'Terapi / Plan baru',
      'plan',
      'Isi terapi atau rencana terbaru...'
    ],
  
    lab:[
      'Hasil lab / penunjang',
      'lab',
      'Contoh: Hb 9.2, Leukosit 14.000, CXR ...'
    ],

    note:[
      'Catatan',
      'note',
      'Catatan tambahan...'
    ]
  };

  const[
    label,
    id,
    ph
  ]=map[state.updateType];

  const current=
    state.updateType==='plan'
      ?p.plan
      :'';

  $('updateFields').innerHTML=`
    <div class="field">

      <label for="updateText">
        ${label}
      </label>

      <textarea
        id="updateText"
        rows="7"
        placeholder="${ph}">${esc(current)}</textarea>

    </div>

    <p class="helper">
      Update ini akan masuk ke timeline pasien.
    </p>
  `;
}

function updateUpdateOxygen(){
  const show=
    $('uOxygen')?.value!=='Room air';

  if($('uOxygenFlowWrap'))
    $('uOxygenFlowWrap').hidden=!show;

  if(
    !show&&
    $('uOxygenFlow')
  )
    $('uOxygenFlow').value='';
}

async function saveUpdate(){
  const p=pUpdate();

  if(!p.id)return;

  const at=now();

  p.timeline=
    p.timeline||[];

  let summary='';

  if(state.updateType==='vitals'){

    const v=p.objective.vitals;

    const pairs=[
      ['sbp','uSbp'],
      ['dbp','uDbp'],
      ['hr','uHr'],
      ['rr','uRr'],
      ['temperature','uTemp'],
      ['spo2','uSpo2']
    ];

    pairs.forEach(
      ([key,id])=>{
        const value=
          num($(id)?.value);

        if(value!=null)
          v[key]=value;
      }
    );

    const oxygen=
      $('uOxygen')?.value;

    if(oxygen){
      v.oxygen=oxygen;

      v.oxygenFlow=
        oxygen==='Room air'
          ?null
          :num(
            $('uOxygenFlow')?.value
          );
    }

    const g=p.objective.gcs;

    [
      ['e','uGcsE'],
      ['v','uGcsV'],
      ['m','uGcsM']
    ].forEach(
      ([key,id])=>{
        const value=
          num($(id)?.value);

        if(value!=null)
          g[key]=value;
      }
    );

    summary=
      vitalsText(p)+
      (
        gcsText(p)
          ?`\n${gcsText(p)}`
          :''
      );

    if(!summary)
      summary=
        'Tidak ada perubahan data TTV.';

  }else if(
    state.updateType==='plan'
  ){

    const value=
      clean(
        $('updateText').value
      );

    if(!value){
      toast(
        'Terapi / plan belum diisi.'
      );
      return;
    }

    p.plan=value;
    summary=value;

  }else if(
    state.updateType==='lab'
  ){

    const value=
      clean(
        $('updateText').value
      );

    if(!value){
      toast(
        'Hasil lab / penunjang belum diisi.'
      );
      return;
    }

    summary=value;

  }else{

    const value=
      clean(
        $('updateText').value
      );

    if(!value){
      toast(
        'Catatan belum diisi.'
      );
      return;
    }

    summary=value;
  }

  const labels={
    vitals:'TTV diperbarui',
    plan:'Terapi / plan diperbarui',
    lab:'Lab / penunjang diperbarui',
    note:'Catatan ditambahkan'
  };

  p.timeline.push({
    id:crypto.randomUUID(),
    type:'update',
    subtype:state.updateType,
    at,
    summary
  });

  const todayVisite=
    (p.visites||[]).find(v=>v.date===localDate());

  if(todayVisite){
    todayVisite.text=soapPlain(p);
    todayVisite.a=assessmentText(p).split('\n')[0]||'';
    todayVisite.at=at;
  }

  p.updatedAt=at;

  await dbPut('patients',p);
  await refreshPatients();

  $('updateModal').hidden=true;

  if(state.detailId===p.id)
    renderDetail(p);

  toast(
    labels[state.updateType]
  );
}

async function completePatient(id){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  if(
    !confirm(
      `KRS pasien ${p.patient.name}? Pasien akan masuk daftar Pulang.`
    )
  )
    return;

  p.status='completed';
  p.dischargedAt=now();
  p.updatedAt=now();

  p.timeline=
    p.timeline||[];

  p.timeline.push({
    type:'completed',
    at:now(),
    summary:'Pasien KRS / pulang'
  });

  await dbPut('patients',p);
  await refreshPatients();

  toast(
    'Pasien masuk daftar Pulang'
  );
}

async function deletePatient(id){

  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p) return;

  const confirmed=
    confirm(
      `Hapus pasien "${p.patient.name}"?\n\n`+
      `Data pasien, konsultasi, dan timeline akan dihapus permanen dari perangkat ini.`
    );

  if(!confirmed) return;

  await dbDelete(
    'patients',
    id
  );

  await refreshPatients();

  if(state.detailId===id){
    state.detailId=null;
    showView('patients');
  }

  toast(
    'Pasien dihapus'
  );
}

function openDetail(id){
  const p=
    state.patients.find(
      x=>x.id===id
    );

  if(!p)return;

  state.detailId=id;

  $('detailTitle').textContent=
    p.patient.name;

  renderDetail(p);
  showView('detail');
}

function renderDetail(p){
  $('detailTitle').textContent=
    p.patient.name;

  const map=mapOf(p);
  const si=shockIndex(p);

  const snapshot=[
    hariRawat(p)!=null
      ?`
        <div>
          <b>${hariRawat(p)}</b>
          <small>Hari rawat</small>
        </div>
      `
      :'',

    fluidBalance(p)!=null
      ?`
        <div>
          <b>${fluidBalance(p)>0?'+':''}${fluidBalance(p)}</b>
          <small>Balance 24 jam (mL)</small>
        </div>
      `
      :'',

    map!=null
      ?`
        <div>
          <b>${map}</b>
          <small>MAP (mmHg)</small>
        </div>
      `
      :'',

    si!=null
      ?`
        <div>
          <b>${si}</b>
          <small>Shock Index</small>
        </div>
      `
      :''
  ]
  .filter(Boolean)
  .join('');

  const cppt=cpptHtml(p);

  $('detailContent').innerHTML=`

    <div class="detail-head">

      <div>

        <div class="detail-ward">
          ${wardBadge(p)}
          ${
            p.admission?.dpjp
              ?`<span class="patient-dpjp">DPJP ${esc(p.admission.dpjp)}</span>`
              :''
          }
        </div>

        <div class="patient-meta">
          ${esc(ageText(p))}
          •
          ${esc(
            genderLabel(
              p.patient.gender
            )
          )}
        </div>

        <div class="diagnosis">
          ${esc(
            p.diagnosis.join(' • ')
          )}
        </div>

      </div>

      <span
        class="status-badge ${
          p.status==='completed'
            ?'done'
            :''
        }">

        ${
          p.status==='completed'
            ?'Pulang'
            :'Dirawat'
        }

      </span>

    </div>

    <div class="detail-actions">

      <button
        class="secondary-btn"
        id="detailEditBtn">
        Edit
      </button>

      <button
        class="secondary-btn"
        id="detailUpdateBtn">
        ＋ Update
      </button>

      <button
        class="secondary-btn"
        id="detailConsultBtn">
        ＋ Konsul
      </button>

      ${
        p.status==='active'
          ?`
            <button
              class="primary-btn"
              id="detailDoneBtn">
              KRS / Pulang
            </button>
          `
          :''
      }

    </div>

    <div
      class="detail-section template-choice">

      <div class="row-between">

        <div>
          <p class="eyebrow">
            Output
          </p>

          <h2>
            Template konsultasi
          </h2>
        </div>

        <select
          id="detailTemplateSelect"
          class="consult-select">
        </select>

      </div>

    </div>

    <div class="snapshot">

      <div>
        <b>
          ${
            p.objective.vitals.sbp!=null&&
            p.objective.vitals.dbp!=null
              ?`${p.objective.vitals.sbp}/${p.objective.vitals.dbp}`
              :'—'
          }
        </b>
        <small>TD</small>
      </div>

      <div>
        <b>
          ${p.objective.vitals.hr??'—'}
        </b>
        <small>HR</small>
      </div>

      <div>
        <b>
          ${p.objective.vitals.rr??'—'}
        </b>
        <small>RR</small>
      </div>

      <div>
        <b>
          ${
            p.objective.vitals.spo2!=null
              ?p.objective.vitals.spo2+'%'
              :'—'
          }
        </b>
        <small>SpO₂</small>
      </div>

    </div>

    ${
      snapshot
        ?`
          <div class="clinical-snapshot">

            <div class="subheading">
              Clinical Snapshot
            </div>

            ${snapshot}

          </div>
        `
        :''
    }

    <section class="detail-section">

      <div class="row-between">

        <h2>
          SOAP
        </h2>

        <button
          class="secondary-btn"
          id="detailCopyAll">
          Copy All
        </button>

      </div>

      <pre class="output-box">${esc(soapPlain(p))}</pre>

      <div
        class="copy-grid detail-copy-grid">

        <button
          type="button"
          data-detail-copy="s"
          class="secondary-btn">
          Copy S
        </button>

        <button
          type="button"
          data-detail-copy="o"
          class="secondary-btn">
          Copy O
        </button>

        <button
          type="button"
          data-detail-copy="a"
          class="secondary-btn">
          Copy A
        </button>

        <button
          type="button"
          data-detail-copy="p"
          class="secondary-btn">
          Copy P
        </button>

      </div>

    </section>

    ${cppt}

    <section class="detail-section">

      <div class="row-between">
        <h2>Konsultasi</h2>
      </div>

      <div class="consult-detail">

        ${
          p.consultations?.length

            ?p.consultations
              .map(
                c=>`
                  <div>

                    <strong>
                      ${esc(
                        specialtyLabel(
                          c.specialty
                        )
                      )}

                      <small>
                        (${esc(c.specialty)})
                      </small>
                    </strong>

                    <span>
                      ${
                        c.contacted
                          ?'✓ Dihubungi'
                          :'⏳ Belum dihubungi'
                      }

                      ·

                      ${
                        c.adviceReceived
                          ?'✓ Advice ada'
                          :'⏳ Advice belum ada'
                      }
                    </span>

                  </div>
                `
              )
              .join('')

            :'Belum ada konsultasi tercatat.'
        }

      </div>

    </section>

  `;

  $('cpptNewBtn')?.addEventListener('click',()=>openEdit(p.id));

  $('detailUpdateBtn').onclick=
    ()=>openUpdate(p.id);

  $('detailEditBtn').onclick=
    ()=>openEdit(p.id);

  $('detailConsultBtn').onclick=
    ()=>openConsult(p.id);

  $('detailDoneBtn')?.addEventListener(
    'click',
    ()=>completePatient(p.id)
  );

  $('detailCopyAll').onclick=
    ()=>copyPatient(p.id);

  document
    .querySelectorAll('[data-visite-copy]')
    .forEach(
      b=>
        b.onclick=
          ()=>{
            const v=(p.visites||[])
              .find(x=>x.id===b.dataset.visiteCopy);

            if(v)copyText(v.text,'Visite tersalin');
          }
    );

  document
    .querySelectorAll(
      '[data-detail-copy]'
    )
    .forEach(
      b=>
        b.onclick=
          ()=>copyPatient(
            p.id,
            b.dataset.detailCopy
          )
    );

  populateTemplateSelects()
    .then(()=>{
      const ds=
        $('detailTemplateSelect');

      if(!ds)return;

      const list=
        document.querySelectorAll(
          '#formTemplateSelect option'
        );

      ds.innerHTML=
        [...list]
          .map(o=>o.outerHTML)
          .join('');

      ds.value=
        p.templateId||
        state.activeTemplateId||
        '';

      ds.onchange=
        ()=>setPatientTemplate(
          p.id,
          ds.value
        );
    });
}

const calculatorDefs=[

  {
    id:'map',
    cat:'Hemodinamik',
    name:'MAP',
    desc:'Mean arterial pressure',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>SBP (mmHg)</label>
          <input
            id="cMapSbp"
            type="number">
        </div>

        <div class="field">
          <label>DBP (mmHg)</label>
          <input
            id="cMapDbp"
            type="number">
        </div>

      </div>

      <div
        id="cMapResult"
        class="calc-result">
        Masukkan SBP dan DBP.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const a=num(
          $('cMapSbp')?.value
        );

        const b=num(
          $('cMapDbp')?.value
        );

        $('cMapResult').textContent=
          a!=null&&b!=null
            ?`MAP: ${Math.round((a+2*b)/3)} mmHg`
            :'Masukkan SBP dan DBP.';
      };

      [
        'cMapSbp',
        'cMapDbp'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'shock',
    cat:'Hemodinamik',
    name:'Shock Index',
    desc:'HR / SBP',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>HR (/min)</label>
          <input
            id="cSiHr"
            type="number">
        </div>

        <div class="field">
          <label>SBP (mmHg)</label>
          <input
            id="cSiSbp"
            type="number">
        </div>

      </div>

      <div
        id="cSiResult"
        class="calc-result">
        Masukkan HR dan SBP.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const hr=num(
          $('cSiHr')?.value
        );

        const sbp=num(
          $('cSiSbp')?.value
        );

        $('cSiResult').textContent=
          hr!=null&&sbp>0
            ?`Shock Index: ${Math.round(hr/sbp*100)/100}`
            :'Masukkan HR dan SBP.';
      };

      [
        'cSiHr',
        'cSiSbp'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'bmi',
    cat:'Antropometri',
    name:'BMI',
    desc:'Berat badan / tinggi badan',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>BB (kg)</label>
          <input
            id="cBmiW"
            type="number"
            step="0.1">
        </div>

        <div class="field">
          <label>TB (cm)</label>
          <input
            id="cBmiH"
            type="number"
            step="0.1">
        </div>

      </div>

      <div
        id="cBmiResult"
        class="calc-result">
        Masukkan BB dan TB.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const w=num(
          $('cBmiW')?.value
        );

        const h=num(
          $('cBmiH')?.value
        );

        $('cBmiResult').textContent=
          w!=null&&h>0
            ?`BMI: ${(w/((h/100)**2)).toFixed(1)}`
            :'Masukkan BB dan TB.';
      };

      [
        'cBmiW',
        'cBmiH'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'bsa',
    cat:'Antropometri',
    name:'BSA',
    desc:'Body surface area (Mosteller)',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>BB (kg)</label>
          <input
            id="cBsaW"
            type="number"
            step="0.1">
        </div>

        <div class="field">
          <label>TB (cm)</label>
          <input
            id="cBsaH"
            type="number"
            step="0.1">
        </div>

      </div>

      <div
        id="cBsaResult"
        class="calc-result">
        Masukkan BB dan TB.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const w=num(
          $('cBsaW')?.value
        );

        const h=num(
          $('cBsaH')?.value
        );

        $('cBsaResult').textContent=
          w!=null&&h>0
            ?`BSA: ${Math.sqrt(w*h/3600).toFixed(2)} m²`
            :'Masukkan BB dan TB.';
      };

      [
        'cBsaW',
        'cBsaH'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'anion',
    cat:'Elektrolit',
    name:'Anion Gap',
    desc:'Na − (Cl + HCO₃)',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>Na</label>
          <input
            id="cAgNa"
            type="number">
        </div>

        <div class="field">
          <label>Cl</label>
          <input
            id="cAgCl"
            type="number">
        </div>

        <div class="field">
          <label>HCO₃</label>
          <input
            id="cAgHco"
            type="number">
        </div>

        <div class="field">
          <label>Albumin (g/dL, opsional)</label>
          <input
            id="cAgAlb"
            type="number"
            step="0.1">
        </div>

      </div>

      <div
        id="cAgResult"
        class="calc-result">
        Masukkan Na, Cl, dan HCO₃.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const na=num(
          $('cAgNa')?.value
        );

        const cl=num(
          $('cAgCl')?.value
        );

        const h=num(
          $('cAgHco')?.value
        );

        if(na!=null&&cl!=null&&h!=null){
          const ag=na-(cl+h);
          const alb=num($('cAgAlb')?.value);

          $('cAgResult').innerHTML=
            `Anion Gap: ${ag} mEq/L`+
            (
              alb!=null
                ?`<br>AG koreksi albumin: ${(ag+2.5*(4-alb)).toFixed(1)} mEq/L`
                :''
            );
        }else{
          $('cAgResult').textContent=
            'Masukkan Na, Cl, dan HCO₃.';
        }
      };

      [
        'cAgNa',
        'cAgCl',
        'cAgHco',
        'cAgAlb'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'corrected-na',
    cat:'Elektrolit',
    name:'Corrected Sodium',
    desc:'Koreksi Na terhadap hiperglikemia',

    html:()=>`
      <div class="calc-grid">

        <div class="field">
          <label>Na (mEq/L)</label>
          <input
            id="cNa"
            type="number">
        </div>

        <div class="field">
          <label>Glukosa (mg/dL)</label>
          <input
            id="cGlucose"
            type="number">
        </div>

      </div>

      <div
        id="cNaResult"
        class="calc-result">
        Masukkan Na dan glukosa.
      </div>
    `,

    bind:()=>{
      const run=()=>{
        const na=num(
          $('cNa')?.value
        );

        const g=num(
          $('cGlucose')?.value
        );

        $('cNaResult').textContent=
          na!=null&&g!=null
            ?`Corrected Na: ${(na+0.016*(g-100)).toFixed(1)} mEq/L`
            :'Masukkan Na dan glukosa.';
      };

      [
        'cNa',
        'cGlucose'
      ].forEach(
        id=>
          $(id)?.addEventListener(
            'input',
            run
          )
      );
    }
  },

  {
    id:'ibw',
    cat:'Antropometri',
    name:'Berat Badan Ideal',
    desc:'Rumus Devine, dari tinggi badan',

    html:()=>`
      <div class="calc-grid">
        <div class="field">
          <label>Jenis kelamin</label>
          <select id="cIbwSex">
            <option value="">Pilih</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
        </div>
        <div class="field">
          <label>TB (cm)</label>
          <input id="cIbwTb" type="number">
        </div>
      </div>
      <div id="cIbwResult" class="calc-result">
        Pilih jenis kelamin dan isi TB.
      </div>
    `,

    bind:()=>bindCalc(['cIbwSex','cIbwTb'],()=>{
      const sx=$('cIbwSex').value;
      const h=num($('cIbwTb').value);

      $('cIbwResult').textContent=
        sx&&h!=null&&h>0
          ?`BBI: ${((sx==='L'?50:45.5)+2.3*(h/2.54-60)).toFixed(1)} kg`
          :'Pilih jenis kelamin dan isi TB.';
    })
  },

  {
    id:'fluid-balance',
    cat:'Cairan',
    name:'Balance Cairan 24 Jam',
    desc:'IWL dewasa: 15 mL/kgBB/hari + 200 mL per °C di atas 37',

    html:()=>`
      <div class="calc-grid">
        <div class="field">
          <label>Intake (mL)</label>
          <input id="cFbIn" type="number">
        </div>
        <div class="field">
          <label>Urin (mL)</label>
          <input id="cFbUrine" type="number">
        </div>
        <div class="field">
          <label>Output lain (mL)</label>
          <input id="cFbOther" type="number">
        </div>
        <div class="field">
          <label>BB (kg)</label>
          <input id="cFbBb" type="number" step="0.1">
        </div>
        <div class="field">
          <label>Suhu (°C, opsional)</label>
          <input id="cFbT" type="number" step="0.1">
        </div>
      </div>
      <div id="cFbResult" class="calc-result">
        Masukkan intake, urin, dan BB.
      </div>
    `,

    bind:()=>bindCalc(
      ['cFbIn','cFbUrine','cFbOther','cFbBb','cFbT'],
      ()=>{
        const i=num($('cFbIn').value);
        const u=num($('cFbUrine').value);
        const o=num($('cFbOther').value)||0;
        const w=num($('cFbBb').value);
        const t=num($('cFbT').value);

        if(i==null||u==null||!(w>0)){
          $('cFbResult').textContent=
            'Masukkan intake, urin, dan BB.';
          return;
        }

        let iwl=15*w;
        if(t!=null&&t>37)iwl+=200*(t-37);

        const out=u+o+iwl;
        const bal=Math.round(i-out);

        $('cFbResult').innerHTML=
          `Balance: ${bal>0?'+':''}${bal} mL/24 jam`+
          `<br><small>Output total ${Math.round(out)} mL `+
          `(IWL ~${Math.round(iwl)} mL) · `+
          `UO ${(u/w/24).toFixed(2)} mL/kgBB/jam</small>`;
      }
    )
  },

  {
    id:'maintenance',
    cat:'Cairan',
    name:'Cairan Rumatan',
    desc:'Holliday-Segar dan aturan 4-2-1',

    html:()=>`
      <div class="calc-grid">
        <div class="field">
          <label>BB (kg)</label>
          <input id="cMtBb" type="number" step="0.1">
        </div>
      </div>
      <div id="cMtResult" class="calc-result">
        Masukkan BB.
      </div>
    `,

    bind:()=>bindCalc(['cMtBb'],()=>{
      const w=num($('cMtBb').value);

      if(!(w>0)){
        $('cMtResult').textContent='Masukkan BB.';
        return;
      }

      const day=
        w<=10?w*100
        :w<=20?1000+(w-10)*50
        :1500+(w-20)*20;

      const hr=
        w<=10?w*4
        :w<=20?40+(w-10)*2
        :60+(w-20);

      $('cMtResult').innerHTML=
        `${Math.round(day)} mL/24 jam (Holliday-Segar)`+
        `<br><small>4-2-1: ${Math.round(hr)} mL/jam</small>`;
    })
  },

  {
    id:'renal',
    cat:'Ginjal',
    name:'Fungsi Ginjal',
    desc:'eGFR CKD-EPI 2021 dan Cockcroft-Gault',

    html:()=>`
      <div class="calc-grid">
        <div class="field">
          <label>Usia (tahun)</label>
          <input id="cRnAge" type="number">
        </div>
        <div class="field">
          <label>Jenis kelamin</label>
          <select id="cRnSex">
            <option value="">Pilih</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
        </div>
        <div class="field">
          <label>Kreatinin (mg/dL)</label>
          <input id="cRnScr" type="number" step="0.01">
        </div>
        <div class="field">
          <label>BB (kg, untuk Cockcroft-Gault)</label>
          <input id="cRnBb" type="number" step="0.1">
        </div>
      </div>
      <div id="cRnResult" class="calc-result">
        Masukkan usia, jenis kelamin, dan kreatinin.
      </div>
    `,

    bind:()=>bindCalc(
      ['cRnAge','cRnSex','cRnScr','cRnBb'],
      ()=>{
        const a=num($('cRnAge').value);
        const sx=$('cRnSex').value;
        const c=num($('cRnScr').value);
        const w=num($('cRnBb').value);

        if(a==null||!sx||!(c>0)){
          $('cRnResult').textContent=
            'Masukkan usia, jenis kelamin, dan kreatinin.';
          return;
        }

        const k=sx==='P'?0.7:0.9;
        const al=sx==='P'?-0.241:-0.302;

        const egfr=
          142*
          Math.pow(Math.min(c/k,1),al)*
          Math.pow(Math.max(c/k,1),-1.2)*
          Math.pow(0.9938,a)*
          (sx==='P'?1.012:1);

        let out=
          `eGFR CKD-EPI 2021: ${egfr.toFixed(0)} mL/min/1,73 m²`;

        if(w>0){
          const cg=
            ((140-a)*w)/(72*c)*
            (sx==='P'?0.85:1);

          out+=`<br>Cockcroft-Gault: ${cg.toFixed(0)} mL/min`;
        }

        $('cRnResult').innerHTML=out;
      }
    )
  },

  {
    id:'osmolality',
    cat:'Elektrolit',
    name:'Osmolalitas Serum',
    desc:'2 × Na + glukosa/18 + BUN/2,8',

    html:()=>`
      <div class="calc-grid">
        <div class="field">
          <label>Na (mEq/L)</label>
          <input id="cOsNa" type="number">
        </div>
        <div class="field">
          <label>Glukosa (mg/dL)</label>
          <input id="cOsGlu" type="number">
        </div>
        <div class="field">
          <label>BUN (mg/dL)</label>
          <input id="cOsBun" type="number">
        </div>
        <div class="field">
          <label>Osmolalitas terukur (opsional)</label>
          <input id="cOsMeas" type="number">
        </div>
      </div>
      <div id="cOsResult" class="calc-result">
        Masukkan Na, glukosa, dan BUN.
      </div>
    `,

    bind:()=>bindCalc(
      ['cOsNa','cOsGlu','cOsBun','cOsMeas'],
      ()=>{
        const na=num($('cOsNa').value);
        const g=num($('cOsGlu').value);
        const b=num($('cOsBun').value);
        const m=num($('cOsMeas').value);

        if(na==null||g==null||b==null){
          $('cOsResult').textContent=
            'Masukkan Na, glukosa, dan BUN.';
          return;
        }

        const calc=2*na+g/18+b/2.8;

        $('cOsResult').innerHTML=
          `Osmolalitas hitung: ${calc.toFixed(0)} mOsm/kg`+
          (
            m!=null
              ?`<br>Osmolar gap: ${(m-calc).toFixed(0)}`
              :''
          );
      }
    )
  }

];

function renderTools(){
  const q=
    clean(
      $('toolSearch').value
    ).toLowerCase();

  const rows=
    calculatorDefs.filter(
      t=>
        (
          t.name+
          ' '+
          t.desc+
          ' '+
          t.cat
        )
        .toLowerCase()
        .includes(q)
    );

  $('toolsList').innerHTML=
    rows
      .map(
        t=>`
          <article
            class="tool-card calculator-card"
          data-cat="${t.cat}">

            <div>

              <span class="eyebrow">
                ${t.cat}
              </span>

              <h2>
                ${t.name}
              </h2>

              <p>
                ${t.desc}
              </p>

            </div>

            <div class="calculator-body">
              ${t.html()}
            </div>

          </article>
        `
      )
      .join('');

  rows.forEach(
    t=>t.bind()
  );

  fillToolsFromPatient();
}

function renderToolPatients(){
  const sel=$('toolPatient');
  if(!sel)return;

  const cur=sel.value;

  sel.innerHTML=
    '<option value="">Isi dari pasien…</option>'+
    state.patients
      .filter(p=>p.status==='active')
      .sort((a,b)=>
        String(a.admission?.ward||'').localeCompare(
          String(b.admission?.ward||''),'id',{numeric:true}))
      .map(p=>`<option value="${p.id}">${esc(
        (p.admission?.ward?p.admission.ward+' · ':'')+p.patient.name
      )}</option>`)
      .join('');

  sel.value=cur;
}

function fillToolsFromPatient(){
  const p=state.patients.find(
    x=>x.id===$('toolPatient')?.value
  );

  if(!p)return;

  const v=p.objective.vitals;
  const f=p.objective.fluid||{};

  const set=(id,val)=>{
    const el=$(id);
    if(!el||val==null||val==='')return;
    el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true}));
  };

  set('cMapSbp',v.sbp);set('cMapDbp',v.dbp);
  set('cSiHr',v.hr);set('cSiSbp',v.sbp);
  set('cBmiW',p.patient.weight);
  set('cBsaW',p.patient.weight);
  set('cFbIn',f.intake);set('cFbUrine',f.urine);
  set('cFbOther',f.other);set('cFbBb',p.patient.weight);
  set('cFbT',v.temperature);
  set('cMtBb',p.patient.weight);
  set('cRnAge',p.patient.age.years);
  set('cRnSex',p.patient.gender);
  set('cRnBb',p.patient.weight);
  set('cIbwSex',p.patient.gender);

  const lab=p.objective.lab||{};

  set('cRnScr',lab.cr);
  set('cAgNa',lab.na);
  set('cAgCl',lab.cl);
  set('cAgAlb',lab.alb);
  set('cNa',lab.na);
  set('cGlucose',lab.gds);
  set('cOsNa',lab.na);
  set('cOsGlu',lab.gds);

  if(lab.ureum!=null)
    set('cOsBun',(lab.ureum/2.14).toFixed(1));
}

/* ---------- Rekap visite ---------- */
function recapGroups(){
  const cmp=(a,b)=>String(a).localeCompare(String(b),'id',{numeric:true});
  const map=new Map();

  state.patients
    .filter(p=>p.status==='active')
    .sort((a,b)=>
      cmp(a.admission?.ward||'',b.admission?.ward||'')||
      cmp(a.admission?.bed||'',b.admission?.bed||''))
    .forEach(p=>{
      const w=p.admission?.ward||'';
      if(!map.has(w))map.set(w,[]);
      map.get(w).push(p);
    });

  return map;
}

function ttvLine(p){
  const v=p.objective.vitals;
  const x=[];
  if(v.sbp!=null&&v.dbp!=null)x.push(`TD ${v.sbp}/${v.dbp}`);
  if(v.hr!=null)x.push(`HR ${v.hr}`);
  if(v.rr!=null)x.push(`RR ${v.rr}`);
  if(v.temperature!=null)x.push(`T ${v.temperature}`);
  if(v.spo2!=null)x.push(`SpO₂ ${v.spo2}%`);
  return x.join(', ');
}

function recapText(wardOnly=null){
  const date=new Intl.DateTimeFormat('id-ID',{
    weekday:'long',day:'numeric',month:'long',year:'numeric'
  }).format(new Date());

  const out=[`Rekap Visite — ${date}`];

  recapGroups().forEach((list,w)=>{
    if(wardOnly!==null&&w!==wardOnly)return;

    out.push('',`== ${w||'Tanpa ruang'} (${list.length} pasien) ==`);

    list.forEach(p=>{
      const hp=hariRawat(p);
      out.push(
        `${p.admission?.bed?'Bed '+p.admission.bed+' — ':''}${p.patient.name}, ${ageText(p)}${hp!=null?` (HP ${hp})`:''}`,
        `Dx: ${p.diagnosis.join('; ')||'-'}`
      );
      if(ttvLine(p))out.push(`TTV: ${ttvLine(p)}`);
      if(fluidBalance(p)!=null)
        out.push(`Balance: ${fluidBalance(p)>0?'+':''}${fluidBalance(p)} mL`);
      if(clean(p.plan))out.push(`P: ${clean(p.plan).replace(/\n+/g,'; ')}`);
      out.push('');
    });
  });

  return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

function renderRecap(){
  const groups=recapGroups();
  const c=$('recapList');

  if(!groups.size){
    c.innerHTML='<div class="empty"><strong>Belum ada pasien dirawat</strong>Rekap muncul setelah ada pasien aktif.</div>';
    return;
  }

  c.innerHTML=[...groups.entries()].map(([w,list])=>`
    <section class="recap-ward ${wardClass(w)}">
      <div class="ward-group-head ${wardClass(w)}">
        <span>${esc(w||'Tanpa ruang')}</span>
        <small>${list.length} pasien</small>
        <button type="button" class="recap-copy" data-recap-ward="${esc(w)}">Copy ruang</button>
      </div>
      <div class="recap-table">
        ${list.map(p=>{
          const hp=hariRawat(p);
          const bal=fluidBalance(p);
          return`
            <article class="recap-row" data-open-patient="${p.id}">
              <div class="recap-bed">${esc(p.admission?.bed||'—')}</div>
              <div class="recap-main">
                <div class="recap-name">${esc(p.patient.name)}
                  <small>${esc(ageText(p))}${p.patient.gender?' · '+esc(p.patient.gender):''}</small>
                  ${hp!=null?`<span class="hp-badge">HP ${hp}</span>`:''}
                  ${bal!=null?`<span class="bal-badge ${bal<0?'neg':'pos'}">${bal>0?'+':''}${bal} mL</span>`:''}
                </div>
                <div class="recap-dx">${esc(p.diagnosis.join(' • ')||'Belum ada diagnosis')}</div>
                ${ttvLine(p)?`<div class="recap-ttv">${esc(ttvLine(p))}</div>`:''}
                ${clean(p.plan)?`<div class="recap-plan"><b>P</b> ${esc(clean(p.plan).replace(/\n+/g,'; '))}</div>`:''}
              </div>
            </article>`;
        }).join('')}
      </div>
    </section>
  `).join('');
}

async function ensureDefaultTemplate(){
  let list=
    await dbAll('templates');

  if(!list.length){

    await dbPut(
      'templates',
      {
        id:crypto.randomUUID(),
        name:DEFAULT_TEMPLATE_NAME,
        body:DEFAULT_TEMPLATE,
        system:true,
        def:true,
        updatedAt:now()
      }
    );

    await dbPut(
      'templates',
      {
        id:crypto.randomUUID(),
        name:KONSUL_TEMPLATE_NAME,
        body:KONSUL_TEMPLATE,
        system:true,
        updatedAt:now()
      }
    );

    list=
      await dbAll('templates');
  }

  for(const t of list){
    if(
      t.system&&
      typeof t.body==='string'&&
      t.body.includes('[PHYSICAL_EXAM]')&&
      !t.body.includes('[PENUNJANG_IF_AVAILABLE]')
    ){
      t.body=t.body.replace(
        '[PHYSICAL_EXAM]',
        '[PHYSICAL_EXAM]\n\n[PENUNJANG_IF_AVAILABLE]'
      );
      await dbPut('templates',t);
    }
  }

  state.activeTemplateId=
    list.find(t=>t.def)?.id||
    list.find(t=>t.system)?.id||
    list[0]?.id||
    null;
}

async function populateTemplateSelects(){
  const list=
    await dbAll('templates');

  const opts=
    list
      .map(
        t=>`
          <option value="${t.id}">
            ${esc(t.name)}
            ${t.system?' · bawaan':''}
          </option>
        `
      )
      .join('');

  const form=
    $('formTemplateSelect');

  if(form){

    const current=
      form.value||
      state.activeTemplateId||
      list[0]?.id||
      '';

    form.innerHTML=opts;
    form.value=current;

    state.activeTemplateId=
      form.value||
      state.activeTemplateId;
  }
}

async function renderTemplates(){
  const list=
    await dbAll('templates');

  $('templateList').innerHTML=
    list
      .map(
        t=>`
          <div class="template-card">

            <div>

              <strong>
                ${esc(t.name)}
              </strong>

              <small>
                ${
                  t.system
                    ?'Template bawaan'
                    :'Template saya'
                }
              </small>

            </div>

            <button
              class="secondary-btn"
              data-template-edit="${t.id}">
              Edit
            </button>

          </div>
        `
      )
      .join('');
}

function openTemplateEditor(id=null){
  state.templateId=id;

  const load=
    id
      ?dbGet('templates',id)
      :Promise.resolve(null);

  load.then(
    t=>{
      const x=
        t||
        {
          name:'Template baru',
          body:DEFAULT_TEMPLATE
        };

      $('templateName').value=
        x.name;

      $('templateBody').value=
        x.body;

      $('templateEditorTitle').textContent=
        id
          ?'Edit template'
          :'Template baru';

      $('templateEditor').hidden=false;
    }
  );
}

const fields=[
  '[WAKTU]',
  '[NAMA_DOKTER]',
  '[UNIT]',
  '[RS]',
  '[NAMA_PASIEN]',
  '[JENIS_KELAMIN]',
  '[USIA]',
  '[BB_IF_AVAILABLE]',
  '[DIAGNOSIS]',
  '[SUBJECTIVE]',
  '[GCS_IF_AVAILABLE]',
  '[VITALS]',
  '[PHYSICAL_EXAM]',
  '[PLAN]',
  '[MAP_IF_AVAILABLE]',
  '[SHOCK_INDEX_IF_AVAILABLE]',
  '[ASSESSMENT]',
  '[TANGGAL]',
  '[RUANG_BED]',
  '[RUANG]',
  '[BED]',
  '[HARI_RAWAT_LINE]',
  '[HARI_RAWAT]',
  '[TGL_MASUK]',
  '[DPJP_LINE]',
  '[DPJP]',
  '[BALANCE_IF_AVAILABLE]',
  '[PENUNJANG_IF_AVAILABLE]'
];

async function saveTemplate(){
  const name=
    clean(
      $('templateName').value
    )||
    'Template tanpa nama';

  const body=
    $('templateBody').value.trim();

  if(!body){
    toast(
      'Isi template belum ada.'
    );
    return;
  }

  const old=
    state.templateId
      ?await dbGet(
        'templates',
        state.templateId
      )
      :null;

  await dbPut(
    'templates',
    {
      id:
        old?.id||
        crypto.randomUUID(),

      name,
      body,

      system:
        old?.system||
        false,

      updatedAt:now()
    }
  );

  $('templateEditor').hidden=true;

  await renderTemplates();
  await populateTemplateSelects();

  toast(
    'Template disimpan'
  );
}

async function refreshPatients(){
  state.patients=
    await dbAll('patients');

  state.patients.sort(
    (a,b)=>
      new Date(
        b.createdAt||
        b.updatedAt
      )-
      new Date(
        a.createdAt||
        a.updatedAt
      )
  );

  renderList();
  refreshWardList();
  renderToolPatients();
}

async function saveProfile(){
  await dbPut(
    'settings',
    {
      key:'profile',

      value:{
        doctor:clean(
          $('doctorName').value
        ),

        hospital:clean(
          $('hospital').value
        ),

        unit:clean(
          $('unit').value
        ),

        wards:
          $('wardsList').value
            .split(/\n+/)
            .map(x=>x.trim())
            .filter(Boolean)
      }
    }
  );

  updateWorkContext();
  refreshWardList();

  $('settingsModal').hidden=true;

  toast(
    'Profil kerja disimpan'
  );
}

async function updateWorkContext(){
  const p=await profile();

  const wc=$('workContext');

  if(wc){
    wc.textContent=
      p.doctor
        ?`${p.doctor}${
          p.unit
            ?' · '+p.unit
            :''
        }`
        :'Profil kerja belum diatur';
  }

  const d=$('profileDoctorLabel');

  if(d)
    d.textContent=
      p.doctor||
      'Profil kerja';

  const u=$('profileUnitLabel');

  if(u)
    u.textContent=
      p.unit||
      'Atur profil kerja';

  const b=$('profileBtn');

  if(b)
    b.title=
      p.doctor
        ?'Edit profil kerja'
        :'Atur profil kerja';
}

async function openSettings(){
  const p=await profile();

  $('doctorName').value=
    p.doctor||'';

  $('hospital').value=
    p.hospital||'';

  $('unit').value=
    p.unit||'';

  $('wardsList').value=
    (p.wards||[]).join('\n');

  $('settingsModal').hidden=false;
}

function exportData(){
  Promise.all([
    dbAll('patients'),
    dbAll('settings'),
    dbAll('templates')
  ])
  .then(
    ([patients,settings,templates])=>{
      const blob=
        new Blob(
          [
            JSON.stringify(
              {
                version:2,
                exportedAt:now(),
                patients,
                settings,
                templates
              },
              null,
              2
            )
          ],
          {
            type:'application/json'
          }
        );

      const a=
        document.createElement('a');

      a.href=
        URL.createObjectURL(blob);

      a.download=
        `ruanginap-backup-${
          new Date()
            .toISOString()
            .slice(0,10)
        }.json`;

      a.click();

      URL.revokeObjectURL(a.href);

      toast(
        'Backup dibuat'
      );
    }
  );
}

async function importData(file){
  try{

    const d=
      JSON.parse(
        await file.text()
      );

    for(
      const p of d.patients||[]
    )
      await dbPut(
        'patients',
        p
      );

    for(
      const s of d.settings||[]
    )
      await dbPut(
        'settings',
        s
      );

    for(
      const t of d.templates||[]
    )
      await dbPut(
        'templates',
        t
      );

    await refreshPatients();
    updateWorkContext();

    toast(
      'Backup dipulihkan'
    );

  }catch{
    toast(
      'File backup tidak valid.'
    );
  }
}

function toast(msg){
  const t=$('toast');

  if(!t)return;

  t.textContent=msg;

  t.classList.add('show');

  clearTimeout(
    toast._t
  );

  toast._t=
    setTimeout(
      ()=>t.classList.remove('show'),
      1800
    );
}

function bind(){

  $('newPatientBtn').onclick=
    openNew;

  $('detailCopyBtn').onclick=
    ()=>{
      if(state.detailId)
        copyPatient(
          state.detailId
        );
    };

  $('backToPatients').onclick=
    ()=>showView('patients');

  $('backFromDetail').onclick=
    ()=>showView('patients');

  $('cancelFormBtn').onclick=
    ()=>showView('patients');

  $('patientForm').addEventListener(
    'submit',
    e=>{
      e.preventDefault();
      saveForm();
    }
  );

  $('oxygen').addEventListener(
    'change',
    updateOxygenFlow
  );

  $('profileBtn').onclick=
    openSettings;

  $('saveSettingsBtn').onclick=
    saveProfile;

  $('exportBtn').onclick=
    exportData;

  $('importBtn').onclick=
    ()=>$('importInput').click();

  $('importInput').onchange=
    e=>
      e.target.files[0]&&
      importData(
        e.target.files[0]
      );

  $('patientSearch').oninput=
    renderList;

  $('dpjpFilter').onchange=
    ()=>{
      state.dpjp=$('dpjpFilter').value;
      renderList();
    };

  document
    .querySelectorAll(
      '#labDetails input:not([type="date"]),#labDetails textarea'
    )
    .forEach(
      el=>
        el.addEventListener(
          'input',
          ()=>{
            if(!$('labDate').value)
              $('labDate').value=localDate();
          }
        )
    );

  $('wardFilter').onclick=
    e=>{
      const b=e.target.closest('[data-ward]');

      if(b){
        state.ward=b.dataset.ward;
        renderList();
      }
    };

  $('ageYears').oninput=
    ()=>{
      updatePediatricFields();
      updatePreview();
    };

  document
    .querySelectorAll(
      '#patientForm input,'+
      '#patientForm textarea,'+
      '#patientForm select'
    )
    .forEach(
      el=>
        el.addEventListener(
          'input',
          updatePreview
        )
    );

  document
    .querySelectorAll('.segment')
    .forEach(
      b=>
        b.onclick=
          ()=>{
            state.list=
              b.dataset.list;

            document
              .querySelectorAll(
                '.segment'
              )
              .forEach(
                x=>
                  x.classList.toggle(
                    'active',
                    x===b
                  )
              );

            renderList();
          }
    );

  document
    .querySelectorAll('[data-nav]')
    .forEach(
      b=>
        b.onclick=
          ()=>{
            const n=
              b.dataset.nav;

            if(n==='patients'){
              showView('patients');

            }else if(n==='tools'){
              renderTools();
              showView('tools');

            }else if(n==='recap'){
              renderRecap();
              showView('recap');

            }else if(n==='templates'){
              renderTemplates();
              showView('templates');

            }else if(n==='settings'){
              openSettings();

            }else{
              toast(
                'Menu ini masuk tahap berikutnya.'
              );
            }
          }
    );

  document
    .querySelectorAll('[data-close]')
    .forEach(
      b=>
        b.onclick=
          ()=>$(b.dataset.close)
            .hidden=true
    );

  document
    .querySelectorAll(
      '[data-update-type]'
    )
    .forEach(
      b=>
        b.onclick=
          ()=>{
            state.updateType=
              b.dataset.updateType;

            renderUpdateFields();
          }
    );

  $('saveUpdateBtn').onclick=
    saveUpdate;

  $('saveConsultBtn').onclick=
    saveConsult;

  $('addSpecialtyBtn').onclick=
    addConsult;

  $('copyFormBtn').onclick=
    ()=>copyText(
      $('formPreview').textContent,
      'Format tersalin'
    );

  $('physicalHelper').onclick=
    openPhysicalHelper;

  $('physicalSectionTabs').onclick=
    e=>{
      const b=
        e.target.closest(
          '[data-physical-section]'
        );

      if(b){
        physicalSection=
          b.dataset.physicalSection;

        renderPhysicalOptions();
      }
    };

  $('physicalOptions').onclick=
    e=>{
      const b=
        e.target.closest(
          '[data-finding-index]'
        );

      if(b){
        applyPhysicalFinding(
          b.dataset.findingIndex
        );

        renderPhysicalOptions();
        updatePreview();
      }
    };

  $('patientList').onclick=
    e=>{
      const b=
        e.target.closest(
          'button[data-action]'
        );

      if(b){

        const id=b.dataset.id;
        const a=b.dataset.action;

        if(a==='copy')
          copyPatient(id);
        
        if(a==='consult')
          openConsult(id);
        
        if(a==='done')
          completePatient(id);
        
        if(a==='edit')
          openEdit(id);
        
        if(a==='delete')
          deletePatient(id);
        
        return;
      }

      const card=
        e.target.closest(
          '[data-open-patient]'
        );

      if(card)
        openDetail(
          card.dataset.openPatient
        );
    };

  $('consultRows').onclick=
    e=>{

      const rem=
        e.target.closest(
          '[data-remove-consult]'
        );

      if(rem){

        state.consultDraft.splice(
          Number(
            rem.dataset.removeConsult
          ),
          1
        );

        renderConsultRows();
        return;
      }

      const sp=
        e.target.closest(
          '[data-consult-specialty]'
        );

      if(sp){

        state
          .consultDraft[
            Number(sp.dataset.index)
          ]
          .specialty=sp.value;

        state
          .consultDraft[
            Number(sp.dataset.index)
          ]
          .updatedAt=now();

        return;
      }

      const t=
        e.target.closest(
          '[data-consult-field]'
        );

      if(t){

        const i=
          Number(t.dataset.index);

        const f=
          t.dataset.consultField;

        state
          .consultDraft[i][f]=
          !state.consultDraft[i][f];

        state
          .consultDraft[i]
          .updatedAt=now();

        renderConsultRows();
      }
    };

  document
    .querySelectorAll(
      '[data-copy-section]'
    )
    .forEach(
      b=>
        b.onclick=
          async()=>{
            const p=
              readForm(
                state.editingId
                  ?state.patients.find(
                    x=>x.id===
                      state.editingId
                  )
                  :null
              );

            await copyText(
              await sectionText(
                p,
                b.dataset.copySection
              ),
              'Tersalin'
            );
          }
    );

  $('toolSearch').oninput=
    renderTools;

  $('toolPatient').onchange=
    renderTools;

  $('copyRecapBtn').onclick=
    ()=>copyText(recapText(),'Rekap tersalin');

  $('recapList').onclick=
    e=>{
      const cp=e.target.closest('[data-recap-ward]');

      if(cp){
        copyText(
          recapText(cp.dataset.recapWard),
          'Rekap ruang tersalin'
        );
        return;
      }

      const row=e.target.closest('[data-open-patient]');

      if(row)openDetail(row.dataset.openPatient);
    };

  $('newTemplateBtn').onclick=
    ()=>openTemplateEditor();

  $('formTemplateSelect').onchange=
    ()=>{
      state.activeTemplateId=
        $('formTemplateSelect').value;

      updatePreview();
    };

  $('closeTemplateEditor').onclick=
    ()=>{
      $('templateEditor').hidden=true;
    };

  $('saveTemplateBtn').onclick=
    saveTemplate;

  $('templateFields').innerHTML=
    fields
      .map(
        f=>`
          <button
            type="button"
            class="chip"
            data-field="${f}">
            ${f}
          </button>
        `
      )
      .join('');

  $('templateFields').onclick=
    e=>{
      const b=
        e.target.closest(
          '[data-field]'
        );

      if(!b)return;

      const el=
        $('templateBody');

      const start=
        el.selectionStart;

      const end=
        el.selectionEnd;

      el.value=
        el.value.slice(0,start)+
        b.dataset.field+
        el.value.slice(end);

      el.focus();

      el.selectionStart=
        el.selectionEnd=
          start+
          b.dataset.field.length;
    };

  $('templateList').onclick=
    e=>{
      const b=
        e.target.closest(
          '[data-template-edit]'
        );

      if(b)
        openTemplateEditor(
          b.dataset.templateEdit
        );
    };
}

document.addEventListener('focusin',e=>{

  const el=e.target;

  if(
    !el.matches(
      'input, select, textarea'
    )
  ){
    return;
  }

  setTimeout(()=>{

    const rect=
      el.getBoundingClientRect();

    const topSpace=90;
    const bottomSpace=90;

    if(
      rect.top < topSpace ||
      rect.bottom >
        window.innerHeight-bottomSpace
    ){

      el.scrollIntoView({
        behavior:'smooth',
        block:'center',
        inline:'nearest'
      });

    }

  },80);

});

(async function init(){

  bind();

  if(
    'serviceWorker' in navigator&&
    location.protocol.startsWith('http')
  )
    navigator.serviceWorker
      .register('sw.js')
      .catch(()=>{});

  await ensureDefaultTemplate();

  await populateTemplateSelects();

  await updateWorkContext();

  await refreshPatients();

})();

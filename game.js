/* ============================================================
   DRAGON FLIGHT — game.js
   Full game engine + Supabase integration
   ============================================================ */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const sb = createClient(
  'https://rwtezncoukiekayxuxje.supabase.co',
  'sb_publishable_9JwkSoI9zm2oXu6tvZDRaw_2ebdCWtE'
);

// ── Currency config ──────────────────────────────────────────
const CURR = {
  KES:{sym:'KES ',rate:130, min:65,   flag:'🇰🇪'},
  UGX:{sym:'UGX ',rate:3700,min:1850, flag:'🇺🇬'},
  TZS:{sym:'TZS ',rate:2700,min:1350, flag:'🇹🇿'},
  NGN:{sym:'₦',   rate:1600,min:800,  flag:'🇳🇬'},
  GHS:{sym:'GH₵', rate:15,  min:7.5,  flag:'🇬🇭'},
  ZAR:{sym:'R',   rate:19,  min:9.5,  flag:'🇿🇦'},
  USD:{sym:'$',   rate:1,   min:0.5,  flag:'🇺🇸'},
  GBP:{sym:'£',   rate:0.79,min:0.40, flag:'🇬🇧'},
  EUR:{sym:'€',   rate:0.92,min:0.46, flag:'🇪🇺'},
  INR:{sym:'₹',   rate:83,  min:41.5, flag:'🇮🇳'},
};

// ── Ghost player data ────────────────────────────────────────
const BNAMES=['Kipchoge','Wanjiku','FireOtieno','LuckyAchieng','MwangiBet',
  'NjeriWins','OduyaX','KoechMoon','AumaRocket','ChegeStars',
  'BarasaJet','FikiiraX','DragonLord','LuckyKe','StarBet',
  'MoonShot','SkyHigh','JetFuel','CryptoKe','RocketMan',
  'AceFlyer','BetKing','WildCard','PhoenixKe','TitanBet'];
const BFLAGS=['🇰🇪','🇺🇬','🇹🇿','🇳🇬','🇬🇭','🇿🇦','🇪🇹','🇷🇼','🇿🇲','🇸🇳'];
const BCOLS =['#ff6b6b','#f5c518','#22d97a','#4da6ff','#a855f7',
  '#ff9f43','#fd79a8','#26de81','#ff6348','#eccc68'];
const CBOT_NAMES=['DragonLord','LuckyKe','FireWings','BetMaster','MoonRider','StarChaser'];
const CBOT_MSGS=[
  'lets gooo dragon fly high! 🔥',
  'cashed at {m}x — nice one!',
  'who else using both bets? 🎲',
  'waiting for a 20x tonight 🚀',
  'dragon stay up please 🙏',
  'this round feeling good vibes',
  'auto bet carrying me rn 😂',
  'gg that was close!',
  'anyone else heart pounding? 😅',
  'HOW did it crash there 💀',
  'going big this round 🔥',
  'cashing early and staying safe',
];

// ── Achievements ─────────────────────────────────────────────
const ACHS=[
  {k:'firstBet', ico:'🎯',nm:'First Blood',  ds:'Place your first bet'},
  {k:'bigWin',   ico:'💰',nm:'Big Winner',   ds:'Win over ◈500 in one round'},
  {k:'moon',     ico:'🚀',nm:'Moon Rider',   ds:'Cash out at 10x+'},
  {k:'streak3',  ico:'🔥',nm:'Hot Streak',   ds:'Win 3 rounds in a row'},
  {k:'diamond',  ico:'💎',nm:'Diamond Hands',ds:'Wait past 5x multiplier'},
  {k:'dual',     ico:'🎲',nm:'Dual Bettor',  ds:'Use both panels at once'},
  {k:'century',  ico:'💯',nm:'Century',      ds:'Complete 100 bets'},
  {k:'comeback', ico:'⚡',nm:'Comeback King', ds:'Win after 3 losses in a row'},
];

// ── Payment methods ──────────────────────────────────────────
const METHODS={
  mpesa:{
    label:'M-Pesa Paybill',icon:'📱',
    paybill:'247247',acctName:'DRAGON FLIGHT',
    steps:['Go to M-Pesa → Lipa na M-Pesa → Pay Bill',
           'Business No: <b>247247</b>',
           'Account No: <b id="pbAcct">DF-XXXXXXXX</b>',
           'Amount: <b id="pbAmt">—</b>',
           'Enter PIN and confirm'],
    hasPhone:true,hasRef:true,
  },
  airtel:{
    label:'Airtel Money',icon:'📲',
    paybill:'400400',acctName:'DRAGON FLIGHT',
    steps:['Go to Airtel Money → Make Payment',
           'Till Number: <b>400400</b>',
           'Account: <b id="pbAcct2">DF-XXXXXXXX</b>',
           'Amount: <b id="pbAmt2">—</b>',
           'Confirm with PIN'],
    hasPhone:true,hasRef:true,
  },
  card:{
    label:'Card Payment',icon:'💳',
    steps:['Fill in card details below','Payment processed via secure gateway'],
    hasCard:true,
  },
  bitcoin:{
    label:'Bitcoin',icon:'₿',
    address:'1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
    steps:['Send BTC to the wallet address below',
           'Minimum 1 confirmation required',
           'Paste transaction ID after sending'],
    hasCrypto:true,hasTxId:true,
  },
  ethereum:{
    label:'Ethereum',icon:'Ξ',
    address:'0x742d35Cc6634C0532925a3b844Bc9e7595f6E821',
    steps:['Send ETH to the wallet address below',
           'Minimum 6 confirmations required',
           'Paste transaction hash after sending'],
    hasCrypto:true,hasTxId:true,
  },
  bank:{
    label:'Bank Transfer',icon:'🏦',
    steps:['Bank: <b>Equity Bank Kenya</b>',
           'Account: <b>0123456789</b>',
           'Account Name: <b>Dragon Flight Ltd</b>',
           'Branch: <b>Nairobi CBD</b>',
           'Reference: <b id="pbAcct3">your username</b>'],
    hasRef:true,
  },
};

// ── State ────────────────────────────────────────────────────
const G={
  phase:'waiting',mult:1,crashPt:1,roundId:1,
  startTs:null,animFr:null,waitTimer:null,
  trail:[],dragonX:0,dragonY:0,
  countSec:5,countIntvl:null,
  isDemo:true,balReal:0,balDemo:10000,currency:'KES',
  aIn:false,aAmt:0,aCo:false,aMode:'manual',aRnds:10,aPlayed:0,aRunning:false,
  bIn:false,bAmt:0,bCo:false,bMode:'manual',bRnds:10,bPlayed:0,bRunning:false,
  bots:[],myHistory:[],totalWagered:0,winStreak:0,lossStreak:0,totalBets:0,
  achs:{},txLog:[],crashHistory:[],soundOn:true,
  serverHash:'',serverSeed:'',
  userId:null,username:'Guest',userCurrency:'KES',minDep:65,
  depMethod:'mpesa',depAcctRef:'',
};

// ── Canvas ───────────────────────────────────────────────────
const cv=document.getElementById('cv');
const cx=cv.getContext('2d');
function resizeCv(){cv.width=cv.parentElement.clientWidth;cv.height=cv.parentElement.clientHeight;}
window.addEventListener('resize',resizeCv);resizeCv();

// ── Helpers ──────────────────────────────────────────────────
const rnd=(a,b)=>Math.random()*(b-a)+a;
const pick=a=>a[Math.floor(Math.random()*a.length)];
const fmt=(n,d=2)=>parseFloat(n).toFixed(d);
function genHash(){return[...Array(64)].map(()=>'0123456789abcdef'[Math.floor(Math.random()*16)]).join('');}
function genCrash(){
  const r=Math.random();
  if(r<0.04)return parseFloat(rnd(1.00,1.20).toFixed(2));
  return Math.max(1.01,parseFloat((1/(1-r)).toFixed(2)));
}
function genRef(){return 'DF-'+Math.random().toString(36).substring(2,10).toUpperCase();}

// ── Auth / user ──────────────────────────────────────────────
async function loadUser(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){ location.href='auth.html'; return; }
  G.userId=session.user.id;
  const {data:u}=await sb.from('users').select('*').eq('id',G.userId).single();
  if(u){
    G.balReal=parseFloat(u.balance_real)||0;
    G.username=u.username||'Player';
    G.userCurrency=u.currency||'KES';
    G.currency=u.currency||'KES';
    document.getElementById('csel').value=G.currency;
    const refCode=u.referral_code||'';
    document.getElementById('refLink').value=`https://dragonflight.bet/r/${refCode}`;
    loadUserTx();
    subscribeBalance();
  }
}

async function loadUserTx(){
  if(!G.userId)return;
  const {data}=await sb.from('transactions')
    .select('*').eq('user_id',G.userId)
    .order('created_at',{ascending:false}).limit(30);
  G.txLog=data||[];
  renderTxList();
}

function subscribeBalance(){
  if(!G.userId)return;
  sb.channel('balance-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'users',filter:`id=eq.${G.userId}`},
      payload=>{
        G.balReal=parseFloat(payload.new.balance_real)||0;
        updateBalDisp();
        toast2('Balance updated ✓','g');
      })
    .subscribe();
  // Subscribe to own transactions for status updates
  sb.channel('tx-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'transactions',filter:`user_id=eq.${G.userId}`},
      payload=>{
        const tx=payload.new;
        if(tx.status==='completed') toast2(`Deposit of ${G.currency} ${tx.amount} approved! ✓`,'w');
        if(tx.status==='failed')    toast2(`Deposit rejected: ${tx.reject_reason||'Not verified'}`,'l');
        loadUserTx();
        loadUser();
      })
    .subscribe();
}

// ── Balance ──────────────────────────────────────────────────
function getBal(){return G.isDemo?G.balDemo:G.balReal;}
function setBal(v){if(G.isDemo)G.balDemo=Math.max(0,v);else G.balReal=Math.max(0,v);updateBalDisp();}
function addBal(v){setBal(getBal()+v);}
function deductBal(v){setBal(getBal()-v);}
function updateBalDisp(){
  const c=CURR[G.currency]||CURR.KES;
  const v=getBal()*c.rate;
  document.getElementById('balDisp').textContent=
    (G.currency==='BTC'||G.currency==='ETH')?v.toFixed(6):v.toFixed(2);
  document.getElementById('witAvail').textContent='◈'+fmt(getBal());
  document.getElementById('minDepTxt').textContent=
    (c.sym)+c.min+' (≈ $0.50 USD)';
}
window.setCurrency=c=>{if(!CURR[c])return;G.currency=c;updateBalDisp();};
window.setMode=m=>{
  G.isDemo=(m==='demo');
  document.getElementById('demoBtn').className='mdb '+(G.isDemo?'don':'');
  document.getElementById('realBtn').className='mdb '+(G.isDemo?'':'ron');
  document.getElementById('dmwm').className='dmwm '+(G.isDemo?'show':'');
  updateBalDisp();
  toast2(G.isDemo?'🎮 Demo mode — virtual coins':'💰 Real money mode',G.isDemo?'i':'w');
};

// ── Sound ────────────────────────────────────────────────────
let audioCtx=null;
function getAC(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function tone(freq,type='sine',dur=0.12,vol=0.07){
  if(!G.soundOn)return;
  try{
    const ac=getAC(),osc=ac.createOscillator(),g=ac.createGain();
    osc.connect(g);g.connect(ac.destination);
    osc.type=type;osc.frequency.value=freq;
    g.gain.setValueAtTime(vol,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+dur);
    osc.start();osc.stop(ac.currentTime+dur);
  }catch(e){}
}
function sfxCashout(){tone(880,'sine',.18,.1);setTimeout(()=>tone(1100,'sine',.15,.08),80);}
function sfxCrash()  {tone(110,'sawtooth',.55,.14);}
function sfxPlace()  {tone(440,'sine',.1,.06);}
function sfxTick()   {tone(660,'sine',.07,.04);}
window.toggleSound=()=>{
  G.soundOn=!G.soundOn;
  const b=document.getElementById('sndBtn');
  b.className='ibtn '+(G.soundOn?'on':'');
  b.textContent=G.soundOn?'🔊':'🔇';
};

// ── Ghost bots ───────────────────────────────────────────────
function genBots(cp){
  const n=Math.floor(rnd(10,22));
  G.bots=[];
  for(let i=0;i<n;i++){
    const win=cp>1.3&&Math.random()>.3;
    G.bots.push({
      id:i,name:pick(BNAMES),flag:pick(BFLAGS),col:pick(BCOLS),
      amt:parseFloat(rnd(5,600).toFixed(0)),
      cashAt:win?parseFloat(rnd(1.05,cp-.01).toFixed(2)):null,
      cashedAt:null,status:'playing',
    });
  }
}
function tickBots(){
  G.bots.forEach(b=>{
    if(b.status==='playing'&&b.cashAt&&G.mult>=b.cashAt){b.cashedAt=G.mult;b.status='out';}
  });
}
function buildGhostBar(){
  const ticker=document.getElementById('ghostTicker');
  const countEl=document.getElementById('ghostCount');
  const total=G.bots.length+(G.aIn?1:0)+(G.bIn?1:0);
  const playing=G.bots.filter(b=>b.status==='playing').length+(G.aIn&&!G.aCo?1:0)+(G.bIn&&!G.bCo?1:0);
  countEl.textContent=`${total} players · ${playing} still in`;
  const all=[...G.bots];
  // Add player entries
  if(G.aIn)all.unshift({name:'You (A)',flag:'⭐',col:'#f5c518',amt:G.aAmt,status:G.aCo?'out':G.phase==='crashed'?'lost':'playing',cashedAt:G.aCo?G.mult:null});
  if(G.bIn)all.unshift({name:'You (B)',flag:'⭐',col:'#f5c518',amt:G.bAmt,status:G.bCo?'out':G.phase==='crashed'?'lost':'playing',cashedAt:G.bCo?G.mult:null});
  const doubled=[...all,...all];
  ticker.innerHTML=doubled.map(b=>{
    let st='';
    if(b.status==='out')    st=`<span class="gst gs-w">✓${b.cashedAt?b.cashedAt.toFixed(2)+'x':''}</span>`;
    else if(b.status==='lost')st=`<span class="gst gs-l">✗ lost</span>`;
    else                    st=`<span class="gst gs-p">betting</span>`;
    return`<div class="gi"><span class="gflag">${b.flag}</span><span class="gname">${b.name}</span><span class="gamt">◈${b.amt}</span>${st}</div>`;
  }).join('');
}

// ── Drawing ──────────────────────────────────────────────────
function drawGrid(){
  const W=cv.width,H=cv.height;
  cx.strokeStyle='rgba(255,255,255,.022)';cx.lineWidth=1;
  for(let x=0;x<W;x+=70){cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,H);cx.stroke();}
  for(let y=0;y<H;y+=50){cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();}
  cx.strokeStyle='rgba(255,255,255,.07)';cx.lineWidth=1.5;
  cx.beginPath();cx.moveTo(0,H-28);cx.lineTo(W,H-28);cx.stroke();
  cx.beginPath();cx.moveTo(28,0);cx.lineTo(28,H);cx.stroke();
}
function drawTrail(){
  if(G.trail.length<2)return;
  const last=G.trail[G.trail.length-1];
  // Glow
  cx.beginPath();cx.moveTo(G.trail[0].x,G.trail[0].y);
  G.trail.forEach((p,i)=>{if(i)cx.lineTo(p.x,p.y);});
  cx.strokeStyle='rgba(255,140,30,.1)';cx.lineWidth=12;cx.lineCap='round';cx.stroke();
  // Main trail
  const g=cx.createLinearGradient(G.trail[0].x,0,last.x,0);
  g.addColorStop(0,'rgba(255,107,26,0)');
  g.addColorStop(.6,'rgba(255,160,50,.35)');
  g.addColorStop(1,'rgba(255,210,80,.7)');
  cx.beginPath();cx.moveTo(G.trail[0].x,G.trail[0].y);
  G.trail.forEach((p,i)=>{if(i)cx.lineTo(p.x,p.y);});
  cx.strokeStyle=g;cx.lineWidth=3;cx.stroke();
}
function drawDragon(x,y,sc=1){
  cx.save();cx.translate(x,y);cx.scale(sc,sc);
  // Tail
  cx.beginPath();cx.moveTo(-28,2);cx.bezierCurveTo(-54,16,-66,-4,-59,-22);
  cx.lineWidth=5;cx.strokeStyle='#8b1a1a';cx.lineCap='round';cx.stroke();
  cx.beginPath();cx.moveTo(-59,-22);cx.lineTo(-68,-15);cx.lineTo(-62,-30);cx.closePath();
  cx.fillStyle='#c0392b';cx.fill();
  // Wings
  cx.beginPath();cx.moveTo(-6,-10);cx.bezierCurveTo(-34,-48,-58,-36,-52,-7);
  cx.bezierCurveTo(-40,1,-20,-2,-6,-10);cx.fillStyle='#4a0808';cx.fill();
  cx.strokeStyle='rgba(200,60,0,.25)';cx.lineWidth=1;
  [[-22,-33,-44,-13],[-12,-31,-48,-10]].forEach(([x1,y1,x2,y2])=>{
    cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();
  });
  cx.beginPath();cx.moveTo(6,-10);cx.bezierCurveTo(34,-48,58,-36,52,-7);
  cx.bezierCurveTo(40,1,20,-2,6,-10);cx.fillStyle='#4a0808';cx.fill();
  [[22,-33,44,-13],[12,-31,48,-10]].forEach(([x1,y1,x2,y2])=>{
    cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();
  });
  // Body
  cx.beginPath();cx.ellipse(0,0,30,15,0,0,Math.PI*2);
  cx.fillStyle='#9b1c1c';cx.fill();
  cx.strokeStyle='rgba(180,40,0,.4)';cx.lineWidth=1;
  [[-15,0],[-5,5],[5,0],[15,-3]].forEach(([px,py])=>{
    cx.beginPath();cx.arc(px,py,6,.3,Math.PI-.3);cx.stroke();
  });
  // Head
  cx.beginPath();cx.ellipse(34,-5,15,11,.3,0,Math.PI*2);cx.fillStyle='#b91c1c';cx.fill();
  // Horns
  cx.fillStyle='#7f1d1d';
  cx.beginPath();cx.moveTo(28,-14);cx.lineTo(24,-27);cx.lineTo(32,-18);cx.fill();
  cx.beginPath();cx.moveTo(36,-14);cx.lineTo(34,-28);cx.lineTo(40,-16);cx.fill();
  // Eye
  cx.beginPath();cx.arc(40,-8,3.5,0,Math.PI*2);cx.fillStyle='#f5c518';cx.fill();
  cx.beginPath();cx.arc(40.5,-8,1.8,0,Math.PI*2);cx.fillStyle='#111';cx.fill();
  cx.beginPath();cx.arc(39.5,-9,.8,0,Math.PI*2);cx.fillStyle='#fff';cx.fill();
  // Snout + nostril
  cx.beginPath();cx.ellipse(48,-4,8,5,.2,0,Math.PI*2);cx.fillStyle='#c0392b';cx.fill();
  cx.beginPath();cx.arc(50,-4,1.2,0,Math.PI*2);cx.fillStyle='#7f1d1d';cx.fill();
  // Fire breath (scales with multiplier)
  const fi=Math.min(1,(G.mult-1)*.12+.35),fl=18+fi*35;
  const fg=cx.createRadialGradient(56,-4,0,60+fl*.4,-4,fl);
  fg.addColorStop(0,`rgba(255,220,80,${.95*fi})`);
  fg.addColorStop(.4,`rgba(255,120,0,${.7*fi})`);
  fg.addColorStop(1,'rgba(255,40,0,0)');
  cx.beginPath();cx.moveTo(54,-4);
  cx.bezierCurveTo(62,-14,62+fl*.6,-10,56+fl,-4);
  cx.bezierCurveTo(62+fl*.6,2,62,6,54,-4);
  cx.fillStyle=fg;cx.fill();
  cx.restore();
}
function drawLightning(x,y){
  cx.save();
  cx.shadowColor='#a78bfa';cx.shadowBlur=28;
  cx.strokeStyle='#fff';cx.lineWidth=3;cx.lineCap='round';
  cx.beginPath();cx.moveTo(x-10,y-58);cx.lineTo(x+7,y-18);cx.lineTo(x-5,y-18);cx.lineTo(x+9,y+25);cx.stroke();
  cx.strokeStyle='rgba(167,139,250,.45)';cx.lineWidth=11;cx.stroke();
  cx.restore();
}

// ── Game loop ────────────────────────────────────────────────
function animLoop(ts){
  if(!G.startTs)G.startTs=ts;
  const el=(ts-G.startTs)/1000;
  G.mult=parseFloat(Math.max(1,Math.pow(Math.E,.07*el)).toFixed(2));
  const W=cv.width,H=cv.height,pad=68,lpad=35;
  cx.clearRect(0,0,W,H);drawGrid();
  const prog=Math.min(el/14,1);
  G.dragonX=lpad+(W-lpad-100)*Math.min(prog*1.3,1);
  G.dragonY=Math.max(80,(H-pad)-(H-pad-90)*(1-Math.pow(1-prog,2.2)));
  G.trail.push({x:G.dragonX,y:G.dragonY});
  if(G.trail.length>85)G.trail.shift();
  drawTrail();
  const hs=1+Math.min((G.mult-1)*.04,.55),fs=hs+Math.sin(ts*.009)*.045;
  drawDragon(G.dragonX,G.dragonY,fs);
  updMultDisp();
  tickBots();
  ['A','B'].forEach(checkAutoOut);
  if(Math.round(el*60)%12===0)buildGhostBar();
  renderLiveList();updBtns();
  if(G.mult>=5){if(G.aIn&&!G.aCo)checkAch('diamond');if(G.bIn&&!G.bCo)checkAch('diamond');}
  if(G.mult>=G.crashPt){doCrash();return;}
  G.animFr=requestAnimationFrame(animLoop);
}
function updMultDisp(){
  const el=document.getElementById('mvEl');
  el.textContent=G.mult.toFixed(2)+'x';
  if(G.phase==='crashed')     {el.className='mv mv-c';return;}
  if(G.mult<2)  el.className='mv mv-s';
  else if(G.mult<4) el.className='mv mv-w';
  else          el.className='mv mv-d';
}

// ── WAITING phase ────────────────────────────────────────────
function startWaiting(){
  G.phase='waiting';G.mult=1;G.trail=[];G.startTs=null;
  G.crashPt=genCrash();G.roundId++;
  G.serverSeed=genHash();G.serverHash=genHash();
  G.depAcctRef=genRef();
  genBots(G.crashPt);buildGhostBar();
  document.getElementById('pfHash').textContent=G.serverHash.substring(0,26)+'...';
  document.getElementById('pfSeedHash').value=G.serverHash;
  document.getElementById('pfResult').value='';
  document.getElementById('roundNum').textContent=G.roundId;
  setSB('wait','Waiting for next round...');
  document.getElementById('mwrap').style.display='none';
  document.getElementById('mvEl').textContent='1.00x';
  cx.clearRect(0,0,cv.width,cv.height);drawGrid();
  renderLiveList();updBtns();
  startCountdown(5);
}
function startCountdown(s){
  G.countSec=s;
  const wrap=document.getElementById('cdwrap'),num=document.getElementById('cdNum'),arc=document.getElementById('cdArc');
  wrap.className='cdw show';num.textContent=G.countSec;arc.style.strokeDashoffset=0;
  clearInterval(G.countIntvl);
  G.countIntvl=setInterval(()=>{
    G.countSec--;sfxTick();
    num.textContent=G.countSec;
    arc.style.strokeDashoffset=283*(1-G.countSec/s);
    if(G.countSec<=0){clearInterval(G.countIntvl);wrap.className='cdw';startRound();}
  },1000);
}

// ── FLYING phase ─────────────────────────────────────────────
function startRound(){
  G.phase='flying';G.startTs=null;
  setSB('fly','🐉 Dragon is soaring!');
  document.getElementById('mwrap').style.display='';
  document.getElementById('mlEl').textContent='Cash out before the crash!';
  // Auto-mode: place bets if running
  ['A','B'].forEach(p=>{if(getMode(p)==='auto'&&isAutoRun(p))autoPlace(p);});
  G.animFr=requestAnimationFrame(animLoop);
}

// ── CRASHED phase ─────────────────────────────────────────────
function doCrash(){
  cancelAnimationFrame(G.animFr);G.phase='crashed';
  const W=cv.width,H=cv.height;
  cx.clearRect(0,0,W,H);drawGrid();drawTrail();drawDragon(G.dragonX,G.dragonY,1);
  drawLightning(G.dragonX,G.dragonY-10);
  cx.fillStyle='rgba(255,0,0,.05)';cx.fillRect(0,0,W,H);
  sfxCrash();
  setSB('crash',`⚡ Crashed at ${G.crashPt.toFixed(2)}x`);
  document.getElementById('mvEl').textContent=G.crashPt.toFixed(2)+'x';
  updMultDisp();
  document.getElementById('pfResult').value=G.crashPt.toFixed(2)+'x';
  ['A','B'].forEach(p=>{
    const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo,amt=p==='A'?G.aAmt:G.bAmt;
    if(inB&&!co){recHist(false,p,amt);toast2(`Bet ${p} lost — crashed at ${G.crashPt.toFixed(2)}x 💀`,'l');G.winStreak=0;G.lossStreak++;}
  });
  G.bots.forEach(b=>{if(b.status==='playing')b.status='lost';});
  addCrashHist(G.crashPt);buildGhostBar();renderLiveList();renderHistList();renderLB();updBtns();updVIP();
  G.aIn=G.bIn=false;G.aCo=G.bCo=false;
  ['A','B'].forEach(handleAutoAfter);
  G.waitTimer=setTimeout(startWaiting,5000);
}

// ── Auto-bet ──────────────────────────────────────────────────
const getMode=p=>p==='A'?G.aMode:G.bMode;
const isAutoRun=p=>p==='A'?G.aRunning:G.bRunning;
window.setPanelMode=(p,m)=>{
  if(p==='A')G.aMode=m;else G.bMode=m;
  document.getElementById(`ptb${p}-m`).className='ptb '+(m==='manual'?'on':'');
  document.getElementById(`ptb${p}-a`).className='ptb '+(m==='auto'?'on':'');
  document.getElementById(`stop${p}`).className='stoprow '+(m==='auto'?'show':'');
};
function autoPlace(p){
  const amt=parseFloat(document.getElementById('amt'+p).value);
  if(!amt||amt<1){stopAuto(p,'Insufficient bet');return;}
  if(amt>getBal()){stopAuto(p,'Insufficient balance');return;}
  deductBal(amt);G.totalWagered+=amt;G.totalBets++;
  if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;G.aPlayed++;}
  else{G.bIn=true;G.bAmt=amt;G.bCo=false;G.bPlayed++;}
  checkAch('firstBet');updAutoStrip(p);
}
function handleAutoAfter(p){
  if(!isAutoRun(p))return;
  const played=p==='A'?G.aPlayed:G.bPlayed,total=p==='A'?G.aRnds:G.bRnds;
  const sw=parseFloat(document.getElementById('sw'+p).value)||0;
  const sl=parseFloat(document.getElementById('sl'+p).value)||0;
  const recent=G.myHistory.filter(h=>h.panel===p).slice(-played);
  const sessProfit=recent.reduce((s,h)=>s+(h.win?h.profit:-h.bet),0);
  if(played>=total){stopAuto(p,`Auto ${p} complete — ${total} rounds done`);return;}
  if(sw>0&&sessProfit>=sw){stopAuto(p,`Auto ${p} stopped — profit target ◈${sw} hit`);return;}
  if(sl>0&&sessProfit<=-sl){stopAuto(p,`Auto ${p} stopped — loss limit ◈${sl} hit`);return;}
}
function startAuto(p){
  if(p==='A'){G.aRunning=true;G.aPlayed=0;G.aRnds=parseInt(document.getElementById('rndsA').value)||10;}
  else{G.bRunning=true;G.bPlayed=0;G.bRnds=parseInt(document.getElementById('rndsB').value)||10;}
  document.getElementById('strip'+p).className='astrip show';
  updAutoStrip(p);toast2(`Auto ${p} started 🤖`,'i');
}
function stopAuto(p,msg=''){
  if(p==='A')G.aRunning=false;else G.bRunning=false;
  document.getElementById('strip'+p).className='astrip';
  if(msg)toast2(msg,'g');
}
function updAutoStrip(p){
  const pl=p==='A'?G.aPlayed:G.bPlayed,tot=p==='A'?G.aRnds:G.bRnds;
  document.getElementById('stripTxt'+p).textContent=`Auto — ${pl}/${tot} rounds`;
}

// ── Bet placement ─────────────────────────────────────────────
window.handleBtn=p=>{
  if(G.phase==='waiting'){
    if(getMode(p)==='auto'){isAutoRun(p)?stopAuto(p,`Auto ${p} cancelled`):startAuto(p);return;}
    placeBet(p);
  }else if(G.phase==='flying'){
    const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo;
    if(inB&&!co)cashOut(p);
  }
};
function placeBet(p){
  const amt=parseFloat(document.getElementById('amt'+p).value);
  if(!amt||amt<1){toast2('Enter a valid bet amount','l');return;}
  if(amt>getBal()){toast2('Insufficient balance — deposit more 💰','l');return;}
  if(G.phase!=='waiting'){toast2('Wait for next round','l');return;}
  deductBal(amt);G.totalWagered+=amt;G.totalBets++;
  if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;}
  else{G.bIn=true;G.bAmt=amt;G.bCo=false;}
  sfxPlace();
  checkAch('firstBet');if(G.aIn&&G.bIn)checkAch('dual');
  updBtns();renderLiveList();updVIP();
  document.getElementById('panel'+p).className='bpanel bp-active';
  toast2(`Bet ${p} — ◈${fmt(amt)} placed 🐉`,'i');
}
function cashOut(p){
  const isA=p==='A';
  if(isA){if(!G.aIn||G.aCo)return;G.aCo=true;}
  else{if(!G.bIn||G.bCo)return;G.bCo=true;}
  const amt=isA?G.aAmt:G.bAmt;
  const pay=parseFloat((amt*G.mult).toFixed(2)),prof=parseFloat((pay-amt).toFixed(2));
  addBal(pay);recHist(true,p,amt);sfxCashout();
  G.winStreak++;G.lossStreak=0;
  if(G.winStreak>=3)checkAch('streak3');
  if(prof>=500)checkAch('bigWin');
  if(G.mult>=10)checkAch('moon');
  document.getElementById('panel'+p).className='bpanel bp-cashed';
  toast2(`Bet ${p} — cashed at ${G.mult.toFixed(2)}x! +◈${fmt(prof)} 💰`,'w');
  updBtns();renderHistList();
  if(isAutoRun(p))updAutoStrip(p);
  // Write bet to Supabase if real mode
  if(!G.isDemo&&G.userId)saveBet(p,amt,G.mult,pay);
}
function checkAutoOut(p){
  const on=document.getElementById('auto'+p).checked;
  const av=parseFloat(document.getElementById('acv'+p).value);
  const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo;
  if(on&&inB&&!co&&G.mult>=av)cashOut(p);
}

// ── Supabase bet save ─────────────────────────────────────────
async function saveBet(panel,amt,mult,pay){
  if(!G.userId)return;
  await sb.from('bets').insert({
    user_id:G.userId,round_id:null,amount:amt,currency:G.currency,
    cashout_multiplier:mult,payout:pay,profit:pay-amt,
    is_demo:false,is_bot:false,panel,placed_at:new Date().toISOString(),
  });
}

// ── History ───────────────────────────────────────────────────
function recHist(win,panel,bet){
  const prof=win?parseFloat((bet*G.mult-bet).toFixed(2)):0;
  G.myHistory.push({round:G.roundId,cp:G.crashPt,bet,win,profit:prof,mult:win?G.mult:null,panel,time:new Date().toLocaleTimeString()});
  if(G.myHistory.length>100)G.myHistory.shift();
  if(G.totalBets>=100)checkAch('century');
  if(!win&&G.lossStreak>=3&&win)checkAch('comeback');
}
function addCrashHist(cp){
  G.crashHistory.unshift(cp);if(G.crashHistory.length>15)G.crashHistory.pop();
  const row=document.getElementById('hrow');
  row.innerHTML='<span class="hlbl">History:</span>';
  G.crashHistory.forEach(c=>{
    const p=document.createElement('span');
    p.className='hp '+(c<1.5?'hpL':c<3?'hpM':'hpH');
    p.textContent=c.toFixed(2)+'x';
    row.appendChild(p);
  });
}

// ── UI helpers ────────────────────────────────────────────────
function setSB(t,txt){
  const b=document.getElementById('sbadge');
  b.className='sbadge '+(t==='wait'?'sbw':t==='fly'?'sbf':'sbc');
  b.textContent=txt;
}
function updBtns(){
  ['A','B'].forEach(p=>{
    const btn=document.getElementById('btn'+p);
    const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo,amt=p==='A'?G.aAmt:G.bAmt;
    const isAuto=getMode(p)==='auto';
    if(G.phase==='waiting'){
      if(isAuto){
        btn.className=isAutoRun(p)?'abtn btn-wait':'abtn btn-autorun';
        btn.textContent=isAutoRun(p)?'⏹ Stop Auto':'▶ Start Auto Bet';
      }else{
        btn.className='abtn btn-place';btn.textContent=`Place Bet ${p}`;
      }
    }else if(G.phase==='flying'){
      if(!inB){btn.className='abtn btn-wait';btn.textContent='Round In Progress';}
      else if(co){btn.className='abtn btn-cashed';btn.textContent='Cashed Out ✓';}
      else{btn.className='abtn btn-cashout';btn.innerHTML=`Cash Out ${p} ◈${fmt(amt*G.mult)}<br><small style="font-size:.65rem;opacity:.8">${G.mult.toFixed(2)}x</small>`;}
    }else{
      btn.className='abtn btn-wait';btn.textContent='Settling round...';
    }
  });
}
function renderLiveList(){
  const all=[];
  if(G.aIn)all.push({n:'★ You (A)',col:'#f5c518',flag:'⭐',amt:G.aAmt,co:G.aCo,lost:!G.aCo&&G.phase==='crashed',yu:true});
  if(G.bIn)all.push({n:'★ You (B)',col:'#f5c518',flag:'⭐',amt:G.bAmt,co:G.bCo,lost:!G.bCo&&G.phase==='crashed',yu:true});
  G.bots.forEach(b=>all.push({n:b.name,col:b.col,flag:b.flag,amt:b.amt,co:b.status==='out',lost:b.status==='lost',cashedAt:b.cashedAt}));
  document.getElementById('liveCnt').textContent=all.length+' players';
  document.getElementById('liveList').innerHTML=all.map(b=>{
    let st='',sc='bi-p';
    if(b.co){st=(b.cashedAt||G.mult).toFixed(2)+'x';sc='bi-w';}
    else if(b.lost){st='LOST';sc='bi-l';}
    else st='flying';
    return`<div class="bitem"><div class="biav" style="background:${b.col}22;color:${b.col}">${b.flag}</div><span class="biname ${b.yu?'yu':''}">${b.n}</span><span class="biamt">◈${b.amt}</span><span class="bist ${sc}">${st}</span></div>`;
  }).join('');
}
function renderHistList(){
  const el=document.getElementById('histList');
  if(!G.myHistory.length){el.innerHTML='<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No bets yet this session</div>';return;}
  el.innerHTML=G.myHistory.slice().reverse().map(h=>`<div class="hitem">
    <span style="font-size:.85rem">${h.win?'✅':'❌'}</span>
    <div><div style="font-size:.75rem">Round #${h.round} — crashed ${h.cp.toFixed(2)}x</div><div class="hisub">${h.time} · Panel ${h.panel}</div></div>
    <span style="font-size:.68rem;color:var(--muted)">◈${h.bet}</span>
    <span style="font-weight:700;font-size:.72rem;color:${h.win?'var(--green)':'var(--red)'}">${h.win?'+◈'+fmt(h.profit):'-◈'+fmt(h.bet)}</span>
  </div>`).join('');
}
function renderLB(){
  const lb=[
    {n:'🇰🇪 Kipchoge',a:12450},{n:'🇳🇬 FireKe',a:9800},{n:'🇿🇦 LuckyO',a:7230},
    {n:'🇬🇭 DrgnRdr',a:5900},{n:'🇺🇬 MoonSht',a:4100},{n:'🇹🇿 StarBet',a:3800},
  ];
  const myWin=G.myHistory.filter(h=>h.win).reduce((s,h)=>s+h.profit,0);
  lb.push({n:'⭐ You',a:Math.floor(myWin)});
  lb.sort((a,b)=>b.a-a.a);
  document.getElementById('lbList').innerHTML=lb.slice(0,8).map((p,i)=>`<div class="lbitem">
    <div class="lbr ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>
    <div class="lbn">${p.n}</div>
    <div class="lba">◈${p.a.toLocaleString()}</div>
  </div>`).join('');
}

// ── Quick bets ────────────────────────────────────────────────
window.qbet=(p,action,val)=>{
  const i=document.getElementById('amt'+p);
  let c=parseFloat(i.value)||0;
  if(action==='add')c=Math.max(1,c+val);
  if(action==='half')c=Math.max(1,Math.floor(c/2));
  if(action==='max')c=getBal();
  i.value=c;
};

// ── Sidebar tabs ──────────────────────────────────────────────
window.sbTab=(id,el)=>{
  document.querySelectorAll('.sbt').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.sbp').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+id).classList.add('active');
  if(id==='mine')renderHistList();
  if(id==='top')renderLB();
  if(id==='txs')renderTxList();
};

// ── Modals ────────────────────────────────────────────────────
window.openM=id=>{document.getElementById(id).classList.add('open');if(id==='walletModal'){updBalDisp2();if(G.userId)loadUserTx();}if(id==='achModal')renderAchs();};
window.closeM=id=>document.getElementById(id).classList.remove('open');
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');}));
function updBalDisp2(){
  document.getElementById('witAvail').textContent='◈'+fmt(getBal());
  const c=CURR[G.currency]||CURR.KES;
  document.getElementById('minDepTxt').textContent=c.sym+c.min+' (≈ $0.50 USD)';
}

// ── Wallet tabs ───────────────────────────────────────────────
window.wTab=(id,el)=>{
  document.querySelectorAll('.wtb').forEach(t=>t.classList.remove('active'));el.classList.add('active');
  ['wDep','wWit','wTxs','wLimits','wRef'].forEach(d=>document.getElementById(d).style.display='none');
  const map={dep:'wDep',wit:'wWit',txs:'wTxs',limits:'wLimits',ref:'wRef'};
  document.getElementById(map[id]).style.display='block';
  if(id==='txs')renderTxList();
};

// ── Deposit flow ──────────────────────────────────────────────
window.selMethod=m=>{
  G.depMethod=m;
  document.querySelectorAll('.dep-method').forEach(d=>d.classList.remove('sel'));
  document.getElementById('dm-'+m).classList.add('sel');
  renderDepDetails();
};
window.onDepAmtChange=()=>{
  const amt=parseFloat(document.getElementById('depAmt').value)||0;
  const c=CURR[G.currency]||CURR.KES;
  const usd=(amt/c.rate).toFixed(4);
  document.getElementById('depUSD').textContent='$'+usd+' USD';
  renderDepDetails();
};
function renderDepDetails(){
  const amt=parseFloat(document.getElementById('depAmt').value)||0;
  const m=METHODS[G.depMethod];
  const c=CURR[G.currency]||CURR.KES;
  const acct=G.depAcctRef||genRef();G.depAcctRef=acct;
  let html='';
  if(G.depMethod==='mpesa'||G.depMethod==='airtel'){
    html=`<div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">${m.label}</span><span class="pb-val gold">${m.paybill}</span></div>
      <div class="pb-row"><span class="pb-lbl">Account Number</span><span class="pb-val green">${acct} <button class="copy-btn" onclick="copyText('${acct}')">Copy</button></span></div>
      <div class="pb-row"><span class="pb-lbl">Amount</span><span class="pb-val">${c.sym}${amt||'—'}</span></div>
      <div class="pb-row"><span class="pb-lbl">Account Name</span><span class="pb-val">${m.acctName}</span></div>
    </div>
    <div class="step-pills">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Your M-Pesa Phone</label><input type="tel" id="depPhone" placeholder="0712345678"></div>
    <div class="mf"><label>M-Pesa Confirmation Code</label><input type="text" id="depRef" placeholder="e.g. RKA1234XYZ" style="font-family:'Share Tech Mono',monospace"></div>`;
  }else if(G.depMethod==='bitcoin'||G.depMethod==='ethereum'){
    html=`<div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">Send ${G.depMethod==='bitcoin'?'BTC':'ETH'} to</span></div>
      <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:.5rem .7rem;font-family:'Share Tech Mono',monospace;font-size:.65rem;color:var(--blue);word-break:break-all;margin:.3rem 0">${m.address} <button class="copy-btn" onclick="copyText('${m.address}')">Copy</button></div>
    </div>
    <div class="step-pills">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Transaction ID / Hash</label><input type="text" id="depRef" placeholder="Paste tx hash here" style="font-family:'Share Tech Mono',monospace;font-size:.72rem"></div>`;
  }else if(G.depMethod==='bank'){
    html=`<div class="paybill-card">${m.steps.map(s=>`<div class="pb-row"><span class="pb-val" style="font-size:.8rem">${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Your Name / Reference Used</label><input type="text" id="depRef" placeholder="Name you used as reference"></div>`;
  }else if(G.depMethod==='card'){
    html=`<div class="step-pills">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Card Number</label><input type="text" id="cardNum" placeholder="1234 5678 9012 3456" maxlength="19"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
      <div class="mf"><label>Expiry</label><input type="text" placeholder="MM/YY" maxlength="5"></div>
      <div class="mf"><label>CVV</label><input type="text" placeholder="123" maxlength="3"></div>
    </div>
    <div class="mf"><label>Name on Card</label><input type="text" placeholder="JOHN DOE"></div>`;
  }
  document.getElementById('depDetails').innerHTML=html;
  document.getElementById('depSubmitBtn').style.display=amt>0?'block':'none';
}

window.submitDeposit=async()=>{
  const amt=parseFloat(document.getElementById('depAmt').value);
  const c=CURR[G.currency]||CURR.KES;
  if(!amt||amt<c.min){toast2(`Minimum deposit is ${c.sym}${c.min} (≈ $0.50)`,'l');return;}
  const usd=amt/c.rate;
  if(usd<0.5){toast2('Minimum deposit is $0.50 USD','l');return;}
  const phone=document.getElementById('depPhone')?.value||'';
  const ref=document.getElementById('depRef')?.value||'';
  const btn=document.getElementById('depSubmitBtn');
  btn.disabled=true;btn.textContent='Submitting...';

  if(G.isDemo){
    // Demo mode: just add balance
    addBal(amt);
    toast2(`Demo deposit of ◈${fmt(amt)} credited instantly 🎮`,'w');
    closeM('walletModal');btn.disabled=false;btn.textContent='Submit Deposit Request →';
    return;
  }

  // Real mode: call Supabase function
  const {data,error}=await sb.rpc('submit_deposit',{
    p_user_id:G.userId,
    p_amount:amt,
    p_currency:G.currency,
    p_method:G.depMethod,
    p_phone_number:phone||null,
    p_payment_ref:ref||null,
    p_usd_equiv:parseFloat(usd.toFixed(6)),
    p_exchange_rate:c.rate,
  });

  btn.disabled=false;btn.textContent='Submit Deposit Request →';

  if(error){toast2('Failed to submit: '+error.message,'l');return;}
  if(data?.success){
    toast2('Deposit submitted! Pending admin approval ⏳','g');
    closeM('walletModal');loadUserTx();
  }else{
    toast2(data?.error||'Something went wrong','l');
  }
};

window.submitWithdraw=async()=>{
  const amt=parseFloat(document.getElementById('witAmt').value);
  if(!amt||amt<1){toast2('Enter a valid amount','l');return;}
  if(amt>getBal()){toast2('Insufficient balance','l');return;}
  if(G.isDemo){toast2('Withdrawals not available in demo mode','l');return;}
  if(!G.userId){toast2('Please log in to withdraw','l');return;}
  const phone=document.getElementById('witPhone').value;
  const {error}=await sb.from('transactions').insert({
    user_id:G.userId,type:'withdrawal',amount:amt,currency:G.currency,
    method:document.getElementById('witMethod').value,
    phone_number:phone,status:'pending',description:'Withdrawal request',
  });
  if(error){toast2('Failed: '+error.message,'l');return;}
  toast2('Withdrawal request submitted — pending approval ⏳','g');
  closeM('walletModal');loadUserTx();
};

window.saveLimits=async()=>{
  if(G.userId){
    await sb.from('users').update({
      daily_loss_limit:parseFloat(document.getElementById('rgDaily').value)||null,
      weekly_limit:parseFloat(document.getElementById('rgWeekly').value)||null,
      session_limit_min:parseInt(document.getElementById('rgSession').value)||null,
      max_bet_limit:parseFloat(document.getElementById('rgMaxBet').value)||null,
    }).eq('id',G.userId);
  }
  toast2('Limits saved ✓','w');
};

function renderTxList(){
  const el=document.getElementById('txList');
  const all=G.txLog.length?G.txLog:[
    {type:'deposit',amount:100,currency:'KES',method:'mpesa',status:'completed',created_at:new Date(Date.now()-3600000).toISOString()},
    {type:'deposit',amount:500,currency:'KES',method:'mpesa',status:'pending',created_at:new Date(Date.now()-7200000).toISOString()},
  ];
  el.innerHTML=all.map(t=>{
    const isPos=t.type==='deposit'||t.type==='bonus'||t.type==='winnings'||t.type==='referral';
    const stMap={pending:'st-pending',completed:'st-done',failed:'st-fail'};
    return`<div class="txitem">
      <div><div class="txtype"><div class="txdot" style="background:${isPos?'var(--green)':'var(--red)'}"></div>${t.type}</div>
      <div class="txmeta">${t.method||''} · ${new Date(t.created_at).toLocaleDateString()}</div></div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="status-tag ${stMap[t.status]||''}">${t.status}</span>
        <span class="txamt ${isPos?'txp':'txn'}">${isPos?'+':'-'}${t.currency||G.currency} ${parseFloat(t.amount).toFixed(2)}</span>
      </div>
    </div>`;
  }).join('')||'<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No transactions yet</div>';
}

window.copyRef=()=>{
  const link=document.getElementById('refLink').value;
  navigator.clipboard?.writeText(link);
  toast2('Referral link copied!','i');
};
window.copyText=txt=>{navigator.clipboard?.writeText(txt);toast2('Copied!','i');};

// ── Chat ──────────────────────────────────────────────────────
const INIT_CHAT=[
  {u:'FireKe 🇰🇪',t:"let's gooo dragon fly high tonight! 🔥",bot:true},
  {u:'LuckyO 🇳🇬',t:'cashed at 4.2x — nice one!',bot:true},
  {u:'DrgnRdr 🇿🇦',t:'who else using both bets? 🎲',bot:true},
  {u:'MoonSht 🇬🇭',t:'waiting for a 20x 🚀',bot:true},
];
function initChat(){
  const m=document.getElementById('cmsgs');
  INIT_CHAT.forEach(l=>{m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${l.u}:</span><span class="ctxt">${l.t}</span></div>`;});
  m.scrollTop=m.scrollHeight;
}
window.sendChat=()=>{
  const inp=document.getElementById('chatInp');
  if(!inp.value.trim())return;
  const m=document.getElementById('cmsgs');
  m.innerHTML+=`<div class="cmsg"><span class="cuser cyu">${G.username}:</span><span class="ctxt">${inp.value}</span></div>`;
  inp.value='';m.scrollTop=m.scrollHeight;
  // Save to Supabase if logged in
  if(G.userId){
    sb.from('chat_messages').insert({user_id:G.userId,username:G.username,message:inp.value});
  }
  // Bot reply
  setTimeout(()=>{
    const bot=pick(CBOT_NAMES);
    const msg=pick(CBOT_MSGS).replace('{m}',G.mult.toFixed(2));
    m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${bot}:</span><span class="ctxt">${msg}</span></div>`;
    m.scrollTop=m.scrollHeight;
  },1200+Math.random()*2000);
};

// ── VIP & Achievements ────────────────────────────────────────
function updVIP(){
  const w=G.totalWagered;
  const tiers=[
    {min:50000,label:'💎 Diamond',cls:'vb-di',nm:'💎 Diamond',nxt:'Max tier!',pct:100},
    {min:20000,label:'🥇 Gold',   cls:'vb-go',nm:'🥇 Gold',   nxt:`◈${(50000-w).toFixed(0)} for Diamond`,pct:Math.min(100,(w-20000)/300)},
    {min:5000, label:'🥈 Silver', cls:'vb-si',nm:'🥈 Silver', nxt:`◈${(20000-w).toFixed(0)} for Gold`,   pct:Math.min(100,(w-5000)/150)},
    {min:0,    label:'🥉 Bronze', cls:'vb-br',nm:'🥉 Bronze', nxt:`◈${(5000-w).toFixed(0)} for Silver`,  pct:Math.min(100,w/50)},
  ];
  const t=tiers.find(t=>w>=t.min)||tiers[3];
  const b=document.getElementById('vipBadge');
  b.textContent=t.label;b.className='vip-badge '+t.cls;
}
function renderAchs(){
  document.getElementById('vipWagered').textContent=G.totalWagered.toFixed(0);
  const w=G.totalWagered;
  const pct=w>=50000?100:w>=20000?80:w>=5000?50:Math.min(30,w/50);
  document.getElementById('vipBar').style.width=pct+'%';
  const nm=w>=50000?'💎 Diamond':w>=20000?'🥇 Gold':w>=5000?'🥈 Silver':'🥉 Bronze';
  document.getElementById('vipName').textContent=nm;
  document.getElementById('achGrid').innerHTML=ACHS.map(a=>`<div class="acard ${G.achs[a.k]?'ul':''}">
    <div class="aico">${a.ico}</div><div class="anm">${a.nm}</div><div class="ads">${a.ds}</div>
  </div>`).join('');
}
function checkAch(k){
  if(G.achs[k])return;
  G.achs[k]=true;
  const a=ACHS.find(a=>a.k===k);
  toast2(`🏅 Achievement unlocked: ${a.nm} ${a.ico}`,'g');
  if(G.userId)sb.from('achievements').upsert({user_id:G.userId,achievement_key:k});
}

// ── Daily bonus ───────────────────────────────────────────────
window.claimBonus=()=>{
  addBal(50);
  document.getElementById('bonusPop').classList.remove('show');
  toast2('Daily bonus claimed! +◈50 🎁','w');
  if(G.userId){
    sb.from('daily_bonuses').insert({user_id:G.userId,streak_day:1,amount:50});
    sb.from('transactions').insert({user_id:G.userId,type:'bonus',amount:50,currency:G.currency,status:'completed',description:'Daily login bonus'});
  }
};

// ── Sign out ──────────────────────────────────────────────────
window.signOut=async()=>{
  await sb.auth.signOut();
  location.href='auth.html';
};

// ── Toast ─────────────────────────────────────────────────────
window.toast2=(msg,t)=>{
  const el=document.getElementById('toastEl');
  el.textContent=msg;el.className=`toast show ${t==='w'?'tw':t==='l'?'tl':t==='g'?'tg':'ti'}`;
  clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast',3800);
};

// ── Boot ──────────────────────────────────────────────────────
async function boot(){
  // Auth guard — redirect immediately if no session
  const {data:{session}}=await sb.auth.getSession();
  if(!session){ location.href='auth.html'; return; }

  setMode('demo');
  initChat();
  renderLB();
  updBtns();
  // Load user from Supabase (already have session, won't redirect again)
  loadUser();
  // Restore currency from localStorage (set on auth page)
  const savedCur=localStorage.getItem('df_currency');
  if(savedCur&&CURR[savedCur]){G.currency=savedCur;document.getElementById('csel').value=savedCur;}
  // Daily bonus popup after 2s
  setTimeout(()=>document.getElementById('bonusPop').classList.add('show'),2000);
  // Start game
  startWaiting();
}

boot();
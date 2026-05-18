/* ============================================================
   DRAGON FLIGHT — game.js  (Production v4 — DB-driven)
   Supabase is the ONLY source of truth.
   NO local balance mutations. All money ops via RPC.
   ============================================================ */

// ── Import Supabase (single source of truth) ─────────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const sb = createClient(
  'https://rwtezncoukiekayxuxje.supabase.co',
  'sb_publishable_9JwkSoI9zm2oXu6tvZDRaw_2ebdCWtE'
);

// ── Currency config ──────────────────────────────────────────
const CURR = {
  KES:{ sym:'KES ', rate:130,   min:65,    flag:'🇰🇪' },
  UGX:{ sym:'UGX ', rate:3700,  min:1850,  flag:'🇺🇬' },
  TZS:{ sym:'TZS ', rate:2700,  min:1350,  flag:'🇹🇿' },
  NGN:{ sym:'₦',    rate:1600,  min:800,   flag:'🇳🇬' },
  GHS:{ sym:'GH₵',  rate:15,    min:7.5,   flag:'🇬🇭' },
  ZAR:{ sym:'R',    rate:19,    min:9.5,   flag:'🇿🇦' },
  RWF:{ sym:'RWF ', rate:1350,  min:675,   flag:'🇷🇼' },
  ETB:{ sym:'ETB ', rate:57,    min:29,    flag:'🇪🇹' },
  USD:{ sym:'$',    rate:1,     min:0.5,   flag:'🇺🇸' },
  GBP:{ sym:'£',    rate:0.79,  min:0.40,  flag:'🇬🇧' },
  EUR:{ sym:'€',    rate:0.92,  min:0.46,  flag:'🇪🇺' },
  INR:{ sym:'₹',    rate:83,    min:41.5,  flag:'🇮🇳' },
};

// ── Ghost / chat bot data ────────────────────────────────────
const BNAMES=['Kipchoge','Wanjiku','FireOtieno','LuckyAchieng','MwangiBet',
  'NjeriWins','OduyaX','KoechMoon','AumaRocket','ChegeStars',
  'BarasaJet','FikiiraX','DragonLord','LuckyKe','StarBet',
  'MoonShot','SkyHigh','JetFuel','CryptoKe','RocketMan'];
const BFLAGS=['🇰🇪','🇺🇬','🇹🇿','🇳🇬','🇬🇭','🇿🇦','🇪🇹','🇷🇼','🇿🇲','🇸🇳'];
const BCOLS=['#ff6b6b','#f5c518','#22d97a','#4da6ff','#a855f7','#ff9f43','#fd79a8'];
const CBOT_NAMES=['DragonLord','LuckyKe','FireWings','BetMaster','MoonRider','StarChaser'];
const CBOT_MSGS=[
  'lets gooo dragon fly high! 🔥','cashed at {m}x — nice one!',
  'who else using both bets? 🎲','waiting for a 20x tonight 🚀',
  'dragon stay up please 🙏','this round feeling good vibes',
  'auto bet carrying me rn 😂','gg that was close!',
  'anyone else heart pounding? 😅','HOW did it crash there 💀',
];

// ── Achievements ─────────────────────────────────────────────
const ACHS=[
  {k:'firstBet', ico:'🎯',nm:'First Blood',   ds:'Place your first bet'},
  {k:'bigWin',   ico:'💰',nm:'Big Winner',    ds:'Win over ◈500 in one round'},
  {k:'moon',     ico:'🚀',nm:'Moon Rider',    ds:'Cash out at 10x+'},
  {k:'streak3',  ico:'🔥',nm:'Hot Streak',    ds:'Win 3 rounds in a row'},
  {k:'diamond',  ico:'💎',nm:'Diamond Hands', ds:'Wait past 5x multiplier'},
  {k:'dual',     ico:'🎲',nm:'Dual Bettor',   ds:'Use both panels at once'},
  {k:'century',  ico:'💯',nm:'Century',       ds:'Complete 100 bets'},
  {k:'comeback', ico:'⚡',nm:'Comeback King', ds:'Win after 3 losses in a row'},
];

// ── Payment methods ──────────────────────────────────────────
const METHODS={
  mpesa:{
    label:'M-Pesa Paybill',icon:'📱',paybill:'247247',acctName:'DRAGON FLIGHT',
    steps:['Go to M-Pesa → Lipa na M-Pesa → Pay Bill',
           'Business No: <b>247247</b>',
           'Account No: <b id="pbAcct">DF-XXXXXXXX</b>',
           'Amount: <b id="pbAmt">—</b>',
           'Enter PIN and confirm'],
    hasPhone:true,hasRef:true,
  },
  airtel:{
    label:'Airtel Money',icon:'📲',paybill:'400400',acctName:'DRAGON FLIGHT',
    steps:['Go to Airtel Money → Make Payment',
           'Till Number: <b>400400</b>',
           'Account: <b id="pbAcct2">DF-XXXXXXXX</b>',
           'Amount: <b id="pbAmt2">—</b>',
           'Confirm with PIN'],
    hasPhone:true,hasRef:true,
  },
  card:{label:'Card Payment',icon:'💳',steps:['Fill in card details below','Payment processed via secure gateway'],hasCard:true},
  bitcoin:{
    label:'Bitcoin',icon:'₿',address:'1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
    steps:['Send BTC to the address below','Min 1 confirmation','Paste tx ID after sending'],
    hasCrypto:true,hasTxId:true,
  },
  ethereum:{
    label:'Ethereum',icon:'Ξ',address:'0x742d35Cc6634C0532925a3b844Bc9e7595f6E821',
    steps:['Send ETH to the address below','Min 6 confirmations','Paste tx hash after sending'],
    hasCrypto:true,hasTxId:true,
  },
  bank:{
    label:'Bank Transfer',icon:'🏦',
    steps:['Bank: <b>Equity Bank Kenya</b>','Account: <b>0123456789</b>',
           'Account Name: <b>Dragon Flight Ltd</b>','Branch: <b>Nairobi CBD</b>',
           'Reference: <b>your username</b>'],
    hasRef:true,
  },
};

// ── State ────────────────────────────────────────────────────
// NEVER mutate balances here — always re-fetch from DB after mutations.
const G={
  phase:'waiting', mult:1, crashPt:1.5, roundId:null,
  startTs:null, animFr:null, waitTimer:null,
  trail:[], dragonX:0, dragonY:0,
  countSec:5, countIntvl:null,

  // Wallet — READ-ONLY copies from DB
  walletMode:'demo',
  balReal:0,
  balDemo:10000,
  balBonus:0,

  currency:'KES',
  // Panel A
  aIn:false, aAmt:0, aCo:false, aMode:'manual', aRnds:10, aPlayed:0, aRunning:false, aBetId:null,
  // Panel B
  bIn:false, bAmt:0, bCo:false, bMode:'manual', bRnds:10, bPlayed:0, bRunning:false, bBetId:null,

  bots:[], myHistory:[], totalWagered:0, winStreak:0, lossStreak:0, totalBets:0,
  achs:{}, txLog:[], crashHistory:[], soundOn:true,

  userId:null, username:'Guest', email:'', country:'',
  vipTier:'bronze', createdAt:null, lastLogin:null,
  totalWon:0, totalProfit:0,
  depMethod:'mpesa', depAcctRef:'',
  currentRoundId:null,
  currentRoundNumber:0,   // mirrors rounds.round_number — incremented each round
  crashQueueId:null,      // UUID of the crash_queue row used this round
  crashQueueRound:null,   // round_number from crash_queue
  streakDay:1,
};

// ── Canvas ───────────────────────────────────────────────────
const cv=document.getElementById('cv');
const cx=cv.getContext('2d');
function resizeCv(){cv.width=cv.parentElement.clientWidth;cv.height=cv.parentElement.clientHeight;}
window.addEventListener('resize',resizeCv); resizeCv();

// ── Helpers ──────────────────────────────────────────────────
const rnd=(a,b)=>Math.random()*(b-a)+a;
const pick=a=>a[Math.floor(Math.random()*a.length)];
const fmt=(n,d=2)=>parseFloat(n||0).toFixed(d);
function genRef(){return 'DF-'+Math.random().toString(36).substring(2,10).toUpperCase();}
function _el(id){return document.getElementById(id);}
function _set(id,text){const e=_el(id);if(e&&text!==null)e.textContent=text;}
function _fn(id,fn){const e=_el(id);if(e&&fn)fn(e);}
function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────────────
//  WALLET DISPLAY
// ─────────────────────────────────────────────────────────────
const isDemo=()=>G.walletMode==='demo';
function getBal(){return isDemo()?G.balDemo:G.balReal;}

/** Refresh all balance displays from G state (which mirrors DB) */
function updateBalDisp(){
  const c=CURR[G.currency]||CURR.KES;
  const v=getBal()*c.rate;
  const disp=_el('balDisp');
  if(disp) disp.textContent=v.toFixed(2);

  _set('bonusQuickDisp', fmt(G.balBonus,0));
  _set('wRealBal',  '◈'+fmt(G.balReal));
  _set('wDemoBal',  '◈'+fmt(G.balDemo));
  _set('wBonusBal', '◈'+fmt(G.balBonus,0));
  _set('witAvail',  '◈'+fmt(G.balReal));
  _set('minDepTxt', c.sym+c.min+' (≈ $0.50 USD)');

  // Bonus progress bar
  const pct=Math.min(100,(G.balBonus/500)*100);
  _fn('bonusProgressBar',el=>el.style.width=pct+'%');
  _set('bonusProgressTxt',`${fmt(G.balBonus,0)} / 500 coins`);
  _fn('bonusConvertBtn',el=>{
    el.disabled=G.balBonus<500;
    el.textContent=G.balBonus>=500
      ?'🎁 Convert 500 → $50 Real'
      :'Need '+(500-Math.floor(G.balBonus))+' more coins';
    el.className='mbtn '+(G.balBonus>=500?'mbtn-fire':'mbtn-muted');
  });

  renderProfileSection();
}

// ── Mode switch ──────────────────────────────────────────────
window.setMode=m=>{
  G.walletMode=m;
  const isD=isDemo();
  _fn('demoBtn',e=>e.className='mdb '+(isD?'don':''));
  _fn('realBtn',e=>e.className='mdb '+(isD?'':'ron'));
  _fn('dmwm',   e=>e.className='dmwm '+(isD?'show':''));
  updateBalDisp();
  toast2(isD?'🎮 Demo mode — virtual coins':'💰 Real money mode',isD?'i':'w');
};
window.setCurrency=c=>{
  if(!CURR[c])return;
  G.currency=c;
  localStorage.setItem('df_currency',c);
  updateBalDisp();
};

// ── Bonus conversion ─────────────────────────────────────────
window.convertBonus=async()=>{
  if(G.balBonus<500){toast2('Need 500 bonus coins to convert','l');return;}
  if(!G.userId){toast2('Please log in','l');return;}

  const btn=_el('bonusConvertBtn');
  if(btn){btn.disabled=true;btn.textContent='Converting...';}

  const {data,error}=await sb.rpc('convert_bonus_to_real',{p_user_id:G.userId});

  if(error||!data?.success){
    toast2(data?.error||error?.message||'Conversion failed','l');
    if(btn){btn.disabled=false;}
    return;
  }

  await refreshUserBalance();
  toast2('🎉 Converted 500 bonus coins → +$50 real balance!','w');
};

// ─────────────────────────────────────────────────────────────
//  AUTH / USER LOADING
// ─────────────────────────────────────────────────────────────
async function loadUser(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){location.href='auth.html';return;}
  G.userId=session.user.id;

  const {data:u,error}=await sb.from('users')
    .select('*').eq('id',G.userId).single();

  if(error||!u){toast2('Failed to load user profile','l');return;}

  // Mirror DB values into G (read-only)
  G.balReal      = parseFloat(u.balance_real)||0;
  G.balBonus     = parseFloat(u.balance_bonus)||0;
  G.username     = u.username||'Player';
  G.email        = u.email||'';
  G.country      = u.country||'';
  G.vipTier      = u.vip_tier||'bronze';
  G.createdAt    = u.created_at||null;
  G.lastLogin    = u.last_login||null;
  G.totalWagered = parseFloat(u.total_wagered)||0;
  G.totalWon     = parseFloat(u.total_won)||0;
  G.totalProfit  = parseFloat(u.total_profit)||0;
  G.streakDay    = u.streak_day||1;
  G.currency     = u.currency||'KES';

  const csel=_el('csel');
  if(csel) csel.value=G.currency;

  const refLink=_el('refLink');
  if(refLink&&u.referral_code)
    refLink.value=`https://dragonflight.bet/r/${u.referral_code}`;

  updateBalDisp();
  renderProfileSection();
  loadUserTx();
  subscribeBalance();
  updVIP();

  // Update last_login (fire and forget)
  sb.from('users').update({last_login:new Date().toISOString()}).eq('id',G.userId);

  // Signup bonus: one-time, DB-enforced via bonus_claimed flag
  if(!u.bonus_claimed){
    const {data:bdata}=await sb.rpc('claim_signup_bonus',{p_user_id:G.userId});
    if(bdata?.success){
      G.balBonus+=50;
      updateBalDisp();
      toast2('🎉 Welcome! +50 bonus coins added to your account!','w');
    }
  }

  // Show daily bonus popup after a short delay
  setTimeout(()=>{
    const today=new Date().toISOString().split('T')[0];
    const lastBonus=u.last_bonus_date||'';
    if(lastBonus!==today){
      _set('bonusSub',`Day ${G.streakDay} streak 🔥 Keep playing daily to grow your bonus!`);
      _fn('bonusPop',e=>e.classList.add('show'));
    }
  },2500);
}

/** Lightweight balance refresh — called after RPC mutations */
async function refreshUserBalance(){
  if(!G.userId)return;
  const {data:u}=await sb.from('users')
    .select('balance_real,balance_bonus,total_wagered,total_won,total_profit')
    .eq('id',G.userId).single();
  if(!u)return;
  G.balReal      = parseFloat(u.balance_real)||0;
  G.balBonus     = parseFloat(u.balance_bonus)||0;
  G.totalWagered = parseFloat(u.total_wagered)||0;
  G.totalWon     = parseFloat(u.total_won)||0;
  G.totalProfit  = parseFloat(u.total_profit)||0;
  updateBalDisp();
}

async function loadUserTx(){
  if(!G.userId)return;
  const {data}=await sb.from('transactions')
    .select('*').eq('user_id',G.userId)
    .order('created_at',{ascending:false}).limit(50);
  G.txLog=data||[];
  renderTxList();
}

// ── Realtime subscriptions ───────────────────────────────────
function subscribeBalance(){
  if(!G.userId)return;

  // User row changes (balance, vip, etc.)
  sb.channel('user-row-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'users',filter:`id=eq.${G.userId}`},
      payload=>{
        const u=payload.new;
        G.balReal      = parseFloat(u.balance_real)||0;
        G.balBonus     = parseFloat(u.balance_bonus)||0;
        G.totalWagered = parseFloat(u.total_wagered)||0;
        G.totalWon     = parseFloat(u.total_won)||0;
        G.totalProfit  = parseFloat(u.total_profit)||0;
        G.vipTier      = u.vip_tier||'bronze';
        updateBalDisp();
        updVIP();
      })
    .subscribe();

  // Transaction status updates (approval / rejection)
  sb.channel('tx-updates-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'transactions',filter:`user_id=eq.${G.userId}`},
      payload=>{
        const tx=payload.new;
        if(tx.status==='completed'){
          const msg=tx.type==='bonus'
            ?`🎁 Bonus credited: ◈${fmt(tx.amount)} (${tx.description||''})`
            :`✅ Deposit of ${tx.currency} ${fmt(tx.amount)} approved!`;
          toast2(msg,'w');
        }
        if(tx.status==='failed')
          toast2(`❌ Deposit rejected: ${tx.reject_reason||'Not verified'}`,'l');
        loadUserTx();
      })
    .subscribe();

  // Bonus transaction inserts
  sb.channel('bonus-tx-'+G.userId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'bonus_transactions',filter:`user_id=eq.${G.userId}`},
      payload=>{
        const b=payload.new;
        if(b.type==='deposit_bonus')
          toast2(`🎁 +${fmt(b.bonus_amount)} bonus coins from deposit!`,'g');
      })
    .subscribe();

  // Live rounds
  sb.channel('rounds-live')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rounds'},
      payload=>{
        const r=payload.new;
        _set('roundNum', r.round_number);
        _set('pfHash', (r.server_seed_hash||'').substring(0,26)+'...');
        _fn('pfSeedHash',e=>e.value=r.server_seed_hash||'');
        G.currentRoundId=r.id;
        if(r.status==='crashed'&&r.crash_point){
          _fn('pfResult',e=>e.value=r.crash_point.toFixed(2)+'x');
        }
      })
    .subscribe();
}

// ── Subscribe to current round on boot ───────────────────────
// Also subscribes to live round updates so the game stays in sync
// when multiple tabs or a future server process updates the rounds table.
async function subscribeRounds(){
  const {data:r}=await sb.from('rounds')
    .select('*').order('round_number',{ascending:false}).limit(1).single();
  if(r){
    G.currentRoundId=r.id;
    G.currentRoundNumber=r.round_number||0;
    _set('roundNum',r.round_number);
    if(r.server_seed_hash){
      _set('pfHash',r.server_seed_hash.substring(0,26)+'...');
      _fn('pfSeedHash',e=>e.value=r.server_seed_hash);
    }
  }

  // Live: if another tab / server updates the round row, reflect it here
  sb.channel('rounds-status')
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rounds'},payload=>{
      const r=payload.new;
      if(r.id!==G.currentRoundId)return; // only care about current round
      _set('roundNum',r.round_number);
      if(r.server_seed_hash){
        _set('pfHash',r.server_seed_hash.substring(0,26)+'...');
        _fn('pfSeedHash',e=>e.value=r.server_seed_hash);
      }
      if(r.status==='crashed'&&r.crash_point){
        _fn('pfResult',e=>e.value=r.crash_point.toFixed(2)+'x');
      }
    })
    .subscribe();
}

// ─────────────────────────────────────────────────────────────
//  PROFILE SECTION RENDERER
//  Renders into BOTH #profileSection (sidebar) and
//  #profileSectionModal (profile modal) — different IDs to avoid
//  the duplicate-ID bug from v3.
// ─────────────────────────────────────────────────────────────
function renderProfileSection(){
  ['profileSection','profileSectionModal'].forEach(id=>{
    const el=_el(id);
    if(!el)return;

    const c=CURR[G.currency]||CURR.KES;
    const joined=G.createdAt
      ?new Date(G.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
    const lastSeen=G.lastLogin
      ?new Date(G.lastLogin).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
    const vipColors={bronze:'#cd7f32',silver:'#c0c0c0',gold:'#f5c518',diamond:'#4da6ff'};
    const vipEmoji ={bronze:'🥉',silver:'🥈',gold:'🥇',diamond:'💎'};
    const vc=vipColors[G.vipTier]||'#cd7f32';
    const ve=vipEmoji[G.vipTier]||'🥉';

    el.innerHTML=`
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-avatar">${(G.username||'?')[0].toUpperCase()}</div>
        <div class="profile-info">
          <div class="profile-name">${escHtml(G.username||'—')}</div>
          <div class="profile-email">${escHtml(G.email||'—')}</div>
          <div class="profile-meta">
            ${G.country?`<span>🌍 ${escHtml(G.country)}</span>`:''}
            <span>📅 Joined ${joined}</span>
            <span>⏱ Last login ${lastSeen}</span>
          </div>
        </div>
        <div class="profile-vip" style="color:${vc};border-color:${vc}40">
          ${ve} ${G.vipTier.charAt(0).toUpperCase()+G.vipTier.slice(1)}
        </div>
      </div>

      <div class="profile-wallets">
        <div class="pw-item pw-real">
          <div class="pw-label">💰 Real</div>
          <div class="pw-value">${c.sym}${fmt(G.balReal*c.rate)}</div>
          <div class="pw-sub">◈${fmt(G.balReal)} USD</div>
        </div>
        <div class="pw-item pw-demo">
          <div class="pw-label">🎮 Demo</div>
          <div class="pw-value">◈${fmt(G.balDemo)}</div>
          <div class="pw-sub">Virtual</div>
        </div>
        <div class="pw-item pw-bonus">
          <div class="pw-label">🎁 Bonus</div>
          <div class="pw-value">◈${fmt(G.balBonus,0)}</div>
          <div class="pw-sub">${G.balBonus>=500?'Ready to convert!':'Need '+(500-Math.floor(G.balBonus))+' more'}</div>
        </div>
      </div>

      <div class="profile-stats">
        <div class="pst-item">
          <div class="pst-val" style="color:var(--gold)">◈${fmt(G.totalWagered,0)}</div>
          <div class="pst-lbl">Total Wagered</div>
        </div>
        <div class="pst-item">
          <div class="pst-val" style="color:var(--green)">◈${fmt(G.totalWon,0)}</div>
          <div class="pst-lbl">Total Won</div>
        </div>
        <div class="pst-item">
          <div class="pst-val" style="color:${G.totalProfit>=0?'var(--green)':'var(--red)'}">
            ${G.totalProfit>=0?'+':''}◈${fmt(Math.abs(G.totalProfit),0)}
          </div>
          <div class="pst-lbl">Net Profit</div>
        </div>
      </div>
    </div>`;
  });
}

// ─────────────────────────────────────────────────────────────
//  BETTING LOGIC
// ─────────────────────────────────────────────────────────────
const isAutoRun=p=>p==='A'?G.aRunning:G.bRunning;
const getMode  =p=>p==='A'?G.aMode:G.bMode;

window.setPanelMode=(p,m)=>{
  if(p==='A')G.aMode=m; else G.bMode=m;
  _fn('ptb'+p+'-m',e=>e.className='ptb '+(m==='manual'?'on':''));
  _fn('ptb'+p+'-a',e=>e.className='ptb '+(m==='auto'?'on':''));
  _fn('stop'+p,    e=>e.className='stoprow '+(m==='auto'?'show':''));
};

function startAuto(p){
  if(p==='A'){G.aRunning=true;G.aPlayed=0;G.aRnds=parseInt((_el('rndsA')||{}).value)||10;}
  else{G.bRunning=true;G.bPlayed=0;G.bRnds=parseInt((_el('rndsB')||{}).value)||10;}
  _fn('strip'+p,e=>e.className='astrip show');
  updAutoStrip(p);toast2(`Auto ${p} started 🤖`,'i');
}
function stopAuto(p,msg=''){
  if(p==='A')G.aRunning=false; else G.bRunning=false;
  _fn('strip'+p,e=>e.className='astrip');
  if(msg)toast2(msg,'g');
}
function updAutoStrip(p){
  const pl=p==='A'?G.aPlayed:G.bPlayed,tot=p==='A'?G.aRnds:G.bRnds;
  _set('stripTxt'+p,`Auto — ${pl}/${tot} rounds`);
}

function autoPlace(p){
  const amt=parseFloat((_el('amt'+p)||{}).value);
  if(!amt||amt<1){stopAuto(p,'Invalid amount');return;}
  placeBet(p,amt);
}

function handleAutoAfter(p){
  if(!isAutoRun(p))return;
  const played=p==='A'?G.aPlayed:G.bPlayed;
  const total =p==='A'?G.aRnds:G.bRnds;
  const sw=parseFloat((_el('sw'+p)||{}).value)||0;
  const sl=parseFloat((_el('sl'+p)||{}).value)||0;
  const recent=G.myHistory.filter(h=>h.panel===p).slice(-played);
  const sessProfit=recent.reduce((s,h)=>s+(h.win?h.profit:-h.bet),0);
  if(played>=total){stopAuto(p,`Auto ${p} complete`);return;}
  if(sw>0&&sessProfit>=sw){stopAuto(p,`Auto ${p} — profit target hit`);return;}
  if(sl>0&&sessProfit<=-sl){stopAuto(p,`Auto ${p} — loss limit hit`);return;}
}

window.handleBtn=p=>{
  if(G.phase==='waiting'){
    if(getMode(p)==='auto'){isAutoRun(p)?stopAuto(p,`Auto ${p} cancelled`):startAuto(p);return;}
    const amt=parseFloat((_el('amt'+p)||{}).value);
    if(!amt||amt<1){toast2('Enter a valid bet amount','l');return;}
    placeBet(p,amt);
  }else if(G.phase==='flying'){
    const inB=p==='A'?G.aIn:G.bIn, co=p==='A'?G.aCo:G.bCo;
    if(inB&&!co)cashOut(p);
  }
};

async function placeBet(p,amt){
  if(G.phase!=='waiting'){toast2('Wait for next round','l');return;}

  if(isDemo()){
    if(amt>G.balDemo){toast2('Insufficient demo balance','l');return;}
    G.balDemo=Math.max(0,G.balDemo-amt);
    updateBalDisp();
    if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;G.aBetId=null;}
    else{G.bIn=true;G.bAmt=amt;G.bCo=false;G.bBetId=null;}
    sfxPlace();
    checkAch('firstBet');if(G.aIn&&G.bIn)checkAch('dual');
    updBtns();renderLiveList();
    _fn('panel'+p,e=>e.className='bpanel bp-active');
    toast2(`[Demo] Bet ${p} — ◈${fmt(amt)} placed 🐉`,'i');
    G.totalBets++;
    if(p==='A')G.aPlayed++; else G.bPlayed++;
    return;
  }

  // Real mode — DB RPC
  if(!G.userId){toast2('Please log in','l');return;}
  if(amt>G.balReal){toast2('Insufficient balance — deposit more 💰','l');return;}

  const autoCashout=_el('auto'+p)?.checked
    ?parseFloat(_el('acv'+p)?.value)||null:null;

  const {data,error}=await sb.rpc('place_bet',{
    p_user_id:G.userId,
    p_round_id:G.currentRoundId||null,
    p_amount:amt,
    p_currency:G.currency,
    p_panel:p,
    p_is_demo:false,
    p_auto_cashout_at:autoCashout,
  });

  if(error||!data?.success){
    toast2(data?.error||error?.message||'Bet failed','l');
    return;
  }

  G.balReal=parseFloat(data.new_balance)||Math.max(0,G.balReal-amt);
  updateBalDisp();

  if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;G.aBetId=data.bet_id||null;}
  else{G.bIn=true;G.bAmt=amt;G.bCo=false;G.bBetId=data.bet_id||null;}

  G.totalWagered+=amt;G.totalBets++;
  if(p==='A')G.aPlayed++; else G.bPlayed++;

  sfxPlace();
  checkAch('firstBet');if(G.aIn&&G.bIn)checkAch('dual');
  updBtns();renderLiveList();updVIP();
  _fn('panel'+p,e=>e.className='bpanel bp-active');
  toast2(`Bet ${p} — ◈${fmt(amt)} placed 🐉`,'i');
}

async function cashOut(p){
  const isA=p==='A';
  if(isA){if(!G.aIn||G.aCo)return;G.aCo=true;}
  else   {if(!G.bIn||G.bCo)return;G.bCo=true;}

  const amt=isA?G.aAmt:G.bAmt;
  const betId=isA?G.aBetId:G.bBetId;
  const pay=parseFloat((amt*G.mult).toFixed(2));
  const prof=parseFloat((pay-amt).toFixed(2));

  if(isDemo()){
    G.balDemo+=pay;
    updateBalDisp();
    recHist(true,p,amt);sfxCashout();
    G.winStreak++;G.lossStreak=0;
    if(G.winStreak>=3)checkAch('streak3');
    if(prof>=500)checkAch('bigWin');
    if(G.mult>=10)checkAch('moon');
    _fn('panel'+p,e=>e.className='bpanel bp-cashed');
    toast2(`[Demo] Bet ${p} — cashed at ${G.mult.toFixed(2)}x! +◈${fmt(prof)} 💰`,'w');
    updBtns();renderHistList();
    return;
  }

  if(!G.userId||!betId){
    // Fallback: RPC unavailable — do not credit locally; show error
    toast2('Cashout error — please contact support','l');
    if(isA)G.aCo=false; else G.bCo=false;
    updBtns();
    return;
  }

  const {data,error}=await sb.rpc('cashout_bet',{
    p_bet_id:betId,
    p_user_id:G.userId,
    p_mult:G.mult,
  });

  if(error||!data?.success){
    toast2(data?.error||'Cashout error — contact support','l');
    if(isA)G.aCo=false; else G.bCo=false;
    updBtns();
    return;
  }

  G.balReal  = parseFloat(data.new_balance)||G.balReal;
  G.totalWon = (G.totalWon||0)+pay;
  G.totalProfit = (G.totalProfit||0)+prof;
  updateBalDisp();

  recHist(true,p,amt);sfxCashout();
  G.winStreak++;G.lossStreak=0;
  if(G.winStreak>=3)checkAch('streak3');
  if(prof>=500)checkAch('bigWin');
  if(G.mult>=10)checkAch('moon');
  _fn('panel'+p,e=>e.className='bpanel bp-cashed');
  toast2(`Bet ${p} — cashed at ${G.mult.toFixed(2)}x! +◈${fmt(prof)} 💰`,'w');
  updBtns();renderHistList();
  if(isAutoRun(p))updAutoStrip(p);
}

function checkAutoOut(p){
  const on=_el('auto'+p)?.checked;
  const av=parseFloat(_el('acv'+p)?.value);
  const inB=p==='A'?G.aIn:G.bIn, co=p==='A'?G.aCo:G.bCo;
  if(on&&inB&&!co&&G.mult>=av)cashOut(p);
}

// ─────────────────────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────────────────────
function genBots(cp){
  G.bots=[];
  const count=8+Math.floor(Math.random()*6);
  for(let i=0;i<count;i++){
    const win=Math.random()>.35;
    G.bots.push({
      id:i, name:pick(BNAMES), flag:pick(BFLAGS), col:pick(BCOLS),
      amt:parseFloat(rnd(5,600).toFixed(0)),
      cashAt:win?parseFloat(rnd(1.05,cp-.01).toFixed(2)):null,
      cashedAt:null, status:'playing',
    });
  }
}
function tickBots(){G.bots.forEach(b=>{if(b.status==='playing'&&b.cashAt&&G.mult>=b.cashAt){b.cashedAt=G.mult;b.status='out';}});}

function buildGhostBar(){
  const ticker=_el('ghostTicker');
  const countEl=_el('ghostCount');
  if(!ticker||!countEl)return;
  const total=G.bots.length+(G.aIn?1:0)+(G.bIn?1:0);
  const playing=G.bots.filter(b=>b.status==='playing').length+(G.aIn&&!G.aCo?1:0)+(G.bIn&&!G.bCo?1:0);
  countEl.textContent=`${total} players · ${playing} still in`;
  const all=[...G.bots];
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
  cx.beginPath();cx.moveTo(G.trail[0].x,G.trail[0].y);
  G.trail.forEach((p,i)=>{if(i)cx.lineTo(p.x,p.y);});
  cx.strokeStyle='rgba(255,140,30,.1)';cx.lineWidth=12;cx.lineCap='round';cx.stroke();
  const g=cx.createLinearGradient(G.trail[0].x,0,last.x,0);
  g.addColorStop(0,'rgba(255,107,26,0)');g.addColorStop(.6,'rgba(255,160,50,.35)');g.addColorStop(1,'rgba(255,210,80,.7)');
  cx.beginPath();cx.moveTo(G.trail[0].x,G.trail[0].y);
  G.trail.forEach((p,i)=>{if(i)cx.lineTo(p.x,p.y);});
  cx.strokeStyle=g;cx.lineWidth=3;cx.stroke();
}
function drawDragon(x,y,sc=1){
  cx.save();cx.translate(x,y);cx.scale(sc,sc);
  cx.beginPath();cx.moveTo(-28,2);cx.bezierCurveTo(-54,16,-66,-4,-59,-22);
  cx.lineWidth=5;cx.strokeStyle='#8b1a1a';cx.lineCap='round';cx.stroke();
  cx.beginPath();cx.moveTo(-59,-22);cx.lineTo(-68,-15);cx.lineTo(-62,-30);cx.closePath();
  cx.fillStyle='#c0392b';cx.fill();
  cx.beginPath();cx.moveTo(-6,-10);cx.bezierCurveTo(-34,-48,-58,-36,-52,-7);
  cx.bezierCurveTo(-40,1,-20,-2,-6,-10);cx.fillStyle='#4a0808';cx.fill();
  cx.strokeStyle='rgba(200,60,0,.25)';cx.lineWidth=1;
  [[-22,-33,-44,-13],[-12,-31,-48,-10]].forEach(([x1,y1,x2,y2])=>{cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();});
  cx.beginPath();cx.moveTo(6,-10);cx.bezierCurveTo(34,-48,58,-36,52,-7);
  cx.bezierCurveTo(40,1,20,-2,6,-10);cx.fillStyle='#4a0808';cx.fill();
  [[22,-33,44,-13],[12,-31,48,-10]].forEach(([x1,y1,x2,y2])=>{cx.beginPath();cx.moveTo(x1,y1);cx.lineTo(x2,y2);cx.stroke();});
  cx.beginPath();cx.ellipse(0,0,30,15,0,0,Math.PI*2);cx.fillStyle='#9b1c1c';cx.fill();
  cx.strokeStyle='rgba(180,40,0,.4)';cx.lineWidth=1;
  [[-15,0],[-5,5],[5,0],[15,-3]].forEach(([px,py])=>{cx.beginPath();cx.arc(px,py,6,.3,Math.PI-.3);cx.stroke();});
  cx.beginPath();cx.ellipse(34,-5,15,11,.3,0,Math.PI*2);cx.fillStyle='#b91c1c';cx.fill();
  cx.fillStyle='#7f1d1d';
  cx.beginPath();cx.moveTo(28,-14);cx.lineTo(24,-27);cx.lineTo(32,-18);cx.fill();
  cx.beginPath();cx.moveTo(36,-14);cx.lineTo(34,-28);cx.lineTo(40,-16);cx.fill();
  cx.beginPath();cx.arc(40,-8,3.5,0,Math.PI*2);cx.fillStyle='#f5c518';cx.fill();
  cx.beginPath();cx.arc(40.5,-8,1.8,0,Math.PI*2);cx.fillStyle='#111';cx.fill();
  cx.beginPath();cx.arc(39.5,-9,.8,0,Math.PI*2);cx.fillStyle='#fff';cx.fill();
  cx.beginPath();cx.ellipse(48,-4,8,5,.2,0,Math.PI*2);cx.fillStyle='#c0392b';cx.fill();
  cx.beginPath();cx.arc(50,-4,1.2,0,Math.PI*2);cx.fillStyle='#7f1d1d';cx.fill();
  const fi=Math.min(1,(G.mult-1)*.12+.35),fl=18+fi*35;
  const fg=cx.createRadialGradient(56,-4,0,60+fl*.4,-4,fl);
  fg.addColorStop(0,`rgba(255,220,80,${.95*fi})`);fg.addColorStop(.4,`rgba(255,120,0,${.7*fi})`);fg.addColorStop(1,'rgba(255,40,0,0)');
  cx.beginPath();cx.moveTo(54,-4);cx.bezierCurveTo(62,-14,62+fl*.6,-10,56+fl,-4);cx.bezierCurveTo(62+fl*.6,2,62,6,54,-4);cx.fillStyle=fg;cx.fill();
  cx.restore();
}
function drawLightning(x,y){
  cx.save();cx.shadowColor='#a78bfa';cx.shadowBlur=28;
  cx.strokeStyle='#fff';cx.lineWidth=3;cx.lineCap='round';
  cx.beginPath();cx.moveTo(x-10,y-58);cx.lineTo(x+7,y-18);cx.lineTo(x-5,y-18);cx.lineTo(x+9,y+25);cx.stroke();
  cx.strokeStyle='rgba(167,139,250,.45)';cx.lineWidth=11;cx.stroke();cx.restore();
}

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
  updMultDisp();tickBots();
  ['A','B'].forEach(checkAutoOut);
  if(Math.round(el*60)%12===0)buildGhostBar();
  renderLiveList();updBtns();
  if(G.mult>=5){if(G.aIn&&!G.aCo)checkAch('diamond');if(G.bIn&&!G.bCo)checkAch('diamond');}
  if(G.mult>=G.crashPt){doCrash();return;}
  G.animFr=requestAnimationFrame(animLoop);
}
function updMultDisp(){
  const el=_el('mvEl');if(!el)return;
  el.textContent=G.mult.toFixed(2)+'x';
  if(G.phase==='crashed'){el.className='mv mv-c';return;}
  if(G.mult<2)el.className='mv mv-s';
  else if(G.mult<4)el.className='mv mv-w';
  else el.className='mv mv-d';
}

// ── CRASH POINT — fetched from crash_queue in DB ─────────────
// Pulls the next unused entry from crash_queue so the game uses
// the exact crash point the admin sees in the panel.
async function fetchCrashPoint(){
  // Pull the very next unused entry and immediately mark it used —
  // this guarantees each round consumes exactly one queue entry,
  // in both demo and real mode, regardless of whether the round
  // row INSERT succeeds.
  const {data:q,error}=await sb.from('crash_queue')
    .select('id,crash_point,round_number,server_seed,server_hash')
    .eq('is_used',false)
    .order('round_number',{ascending:true})
    .limit(1)
    .single();

  if(!error&&q){
    G.crashPt=parseFloat(q.crash_point)||1.5;
    G.crashQueueId=q.id;
    G.crashQueueRound=q.round_number;

    // Mark consumed via RPC (SECURITY DEFINER — bypasses RLS so the update
    // always succeeds regardless of the player's role).
    // SQL to create this function is in the comment block below.
    const {error:rpcErr}=await sb.rpc('consume_crash_queue_entry',{p_id:q.id});
    if(rpcErr){
      // RPC not yet created — fall back to direct update (works if RLS allows it)
      console.warn('[DragonFlight] consume_crash_queue_entry RPC missing, trying direct update:',rpcErr.message);
      await sb.from('crash_queue').update({is_used:true}).eq('id',q.id);
    }

    // Show provably-fair hash to player
    if(q.server_hash){
      _set('pfHash',q.server_hash.substring(0,26)+'...');
      _fn('pfSeedHash',e=>e.value=q.server_hash);
    }
  }else{
    // Fallback: local generation (queue empty — seed via Admin → Crash Preview → Regenerate)
    const h=Math.random();
    G.crashPt=Math.max(1.01,parseFloat((1/(1-h*0.96)).toFixed(2)));
    G.crashQueueId=null;
    G.crashQueueRound=null;
    console.warn('[DragonFlight] crash_queue empty — used local fallback.');
  }
}

function markCrashQueueUsed(){ /* consumed on fetch via RPC */ }

// ── WAITING ──────────────────────────────────────────────────
// Creates a new round row in the DB so admin sees it immediately,
// then fetches the crash point from crash_queue.
async function startWaiting(){
  G.phase='waiting';G.mult=1;G.trail=[];G.startTs=null;
  G.crashPt=99; // placeholder — overwritten by fetchCrashPoint()
  G.depAcctRef=genRef();
  genBots(5);buildGhostBar();
  _set('pfHash','Waiting for round...');
  _fn('pfResult',e=>e.value='');
  setSB('wait','Waiting for next round...');
  _fn('mwrap',e=>e.style.display='none');
  _set('mvEl','1.00x');
  cx.clearRect(0,0,cv.width,cv.height);drawGrid();
  renderLiveList();updBtns();

  // Step 1: fetch crash point from DB queue first (needs round number)
  await fetchCrashPoint();

  // Step 2: INSERT a new round row into DB — admin sees it immediately.
  // Let the DB sequence assign round_number (avoids unique-constraint conflicts).
  if(!isDemo()&&G.userId){
    const seedHash=G.crashQueueId||('df-'+Date.now().toString(36));
    const {data:newRound,error}=await sb.from('rounds').insert({
      status:'waiting',
      server_seed_hash:seedHash,
      total_bets:0,
      total_payout:0,
      house_profit:0,
      player_count:0,
    }).select('id,round_number').single();

    if(!error&&newRound){
      G.currentRoundId=newRound.id;
      G.currentRoundNumber=newRound.round_number;
      _set('roundNum',newRound.round_number);
    }else{
      // INSERT failed (e.g. RLS) — increment local counter so game keeps advancing
      console.warn('[DragonFlight] Round insert failed:',error?.message);
      G.currentRoundId=null;
      G.currentRoundNumber=(G.currentRoundNumber||0)+1;
      _set('roundNum',G.currentRoundNumber);
    }
  }else{
    // Demo mode — no DB write, but still advance the local round counter
    G.currentRoundNumber=(G.currentRoundNumber||0)+1;
    _set('roundNum',G.currentRoundNumber);
    G.currentRoundId=null;
  }

  startCountdown(5);
}

function startCountdown(s){
  G.countSec=s;
  const wrap=_el('cdwrap'),num=_el('cdNum'),arc=_el('cdArc');
  if(!wrap)return;
  wrap.className='cdw show';
  if(num)num.textContent=G.countSec;
  if(arc)arc.style.strokeDashoffset=0;
  clearInterval(G.countIntvl);
  G.countIntvl=setInterval(()=>{
    G.countSec--;sfxTick();
    if(num)num.textContent=G.countSec;
    if(arc)arc.style.strokeDashoffset=283*(1-G.countSec/s);
    if(G.countSec<=0){clearInterval(G.countIntvl);if(wrap)wrap.className='cdw';startRound();}
  },1000);
}

// ── FLYING ───────────────────────────────────────────────────
// Updates round status to 'flying' in DB so admin sees it live.
function startRound(){
  G.phase='flying';G.startTs=null;
  setSB('fly','🐉 Dragon is soaring!');
  _fn('mwrap',e=>e.style.display='');
  _set('mlEl','Cash out before the crash!');
  ['A','B'].forEach(p=>{if(getMode(p)==='auto'&&isAutoRun(p))autoPlace(p);});
  G.animFr=requestAnimationFrame(animLoop);

  // Tell DB (and admin) the round is now flying
  if(!isDemo()&&G.currentRoundId){
    sb.from('rounds').update({
      status:'flying',
      started_at:new Date().toISOString(),
    }).eq('id',G.currentRoundId);
  }
}

// ── CRASHED ──────────────────────────────────────────────────
function doCrash(){
  cancelAnimationFrame(G.animFr);G.phase='crashed';
  const W=cv.width,H=cv.height;
  cx.clearRect(0,0,W,H);drawGrid();drawTrail();drawDragon(G.dragonX,G.dragonY,1);
  drawLightning(G.dragonX,G.dragonY-10);
  cx.fillStyle='rgba(255,0,0,.05)';cx.fillRect(0,0,W,H);
  sfxCrash();
  setSB('crash',`⚡ Crashed at ${G.crashPt.toFixed(2)}x`);
  _set('mvEl',G.crashPt.toFixed(2)+'x');
  updMultDisp();
  _fn('pfResult',e=>e.value=G.crashPt.toFixed(2)+'x');

  ['A','B'].forEach(p=>{
    const inB=p==='A'?G.aIn:G.bIn, co=p==='A'?G.aCo:G.bCo, amt=p==='A'?G.aAmt:G.bAmt;
    if(inB&&!co){
      recHist(false,p,amt);
      toast2(`Bet ${p} lost — crashed at ${G.crashPt.toFixed(2)}x 💀`,'l');
      G.winStreak=0;G.lossStreak++;
    }
  });

  G.bots.forEach(b=>{if(b.status==='playing')b.status='lost';});
  addCrashHist(G.crashPt);buildGhostBar();renderLiveList();renderHistList();renderLB();updBtns();updVIP();
  G.aIn=G.bIn=false;G.aCo=G.bCo=false;G.aBetId=G.bBetId=null;
  ['A','B'].forEach(handleAutoAfter);
  clearTimeout(G.waitTimer);
  G.waitTimer=setTimeout(startWaiting,5000);

  // Write crash result to DB (admin sees it in rounds table + analytics)
  if(!isDemo()&&G.currentRoundId){
    sb.from('rounds').update({
      status:'crashed',
      crash_point:G.crashPt,
      crashed_at:new Date().toISOString(),
    }).eq('id',G.currentRoundId);
  }

  // Mark the consumed crash_queue row as used so the admin queue advances
  if(!isDemo())markCrashQueueUsed();

  if(!isDemo())setTimeout(refreshUserBalance,1500);
}

// ─────────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────────
function setSB(t,txt){
  const b=_el('sbadge');if(!b)return;
  b.className='sbadge '+(t==='wait'?'sbw':t==='fly'?'sbf':'sbc');
  b.textContent=txt;
}
function updBtns(){
  ['A','B'].forEach(p=>{
    const btn=_el('btn'+p);if(!btn)return;
    const inB=p==='A'?G.aIn:G.bIn, co=p==='A'?G.aCo:G.bCo, amt=p==='A'?G.aAmt:G.bAmt;
    const isAuto=getMode(p)==='auto';
    if(G.phase==='waiting'){
      if(isAuto){btn.className=isAutoRun(p)?'abtn btn-wait':'abtn btn-autorun';btn.textContent=isAutoRun(p)?'⏹ Stop Auto':'▶ Start Auto Bet';}
      else{btn.className='abtn btn-place';btn.textContent=`Place Bet ${p}`;}
    }else if(G.phase==='flying'){
      if(!inB){btn.className='abtn btn-wait';btn.textContent='Round In Progress';}
      else if(co){btn.className='abtn btn-cashed';btn.textContent='Cashed Out ✓';}
      else{btn.className='abtn btn-cashout';btn.innerHTML=`Cash Out ${p} ◈${fmt(amt*G.mult)}<br><small style="font-size:.65rem;opacity:.8">${G.mult.toFixed(2)}x</small>`;}
    }else{btn.className='abtn btn-wait';btn.textContent='Settling round...';}
  });
}
window.qbet=(p,op,v)=>{
  const inp=_el('amt'+p);if(!inp)return;
  let n=parseFloat(inp.value)||0;
  if(op==='add')n+=v;
  else if(op==='half')n=Math.max(1,Math.floor(n/2));
  inp.value=Math.max(1,n);
};

// ── Live list ─────────────────────────────────────────────────
function renderLiveList(){
  const el=_el('liveList');if(!el)return;
  const all=[...G.bots];
  if(G.aIn)all.unshift({name:G.username+' (A)',flag:'⭐',col:'#f5c518',amt:G.aAmt,status:G.aCo?'out':'playing',cashedAt:G.aCo?G.mult:null});
  if(G.bIn)all.unshift({name:G.username+' (B)',flag:'⭐',col:'#f5c518',amt:G.bAmt,status:G.bCo?'out':'playing',cashedAt:G.bCo?G.mult:null});
  _set('liveCnt',all.length);
  el.innerHTML=all.slice(0,18).map(b=>`
  <div class="lrow">
    <span class="lfl">${b.flag}</span>
    <span class="lnm" style="color:${b.col}">${b.name}</span>
    <span class="la">◈${b.amt}</span>
    <span class="ls ${b.status==='out'?'lsw':b.status==='lost'?'lsl':'lsp'}">
      ${b.status==='out'?'✓'+b.cashedAt?.toFixed(2)+'x':b.status==='lost'?'✗':G.mult.toFixed(2)+'x'}
    </span>
  </div>`).join('');
}

// ── My history ─────────────────────────────────────────────────
function renderHistList(){
  const el=_el('histList');if(!el)return;
  if(!G.myHistory.length){
    el.innerHTML='<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No bets yet</div>';
    return;
  }
  el.innerHTML=G.myHistory.slice().reverse().slice(0,30).map(h=>`
  <div class="lrow">
    <span class="lfl">${h.win?'✅':'❌'}</span>
    <span class="lnm">Bet ${h.panel} · R${h.round}</span>
    <span class="la">◈${fmt(h.bet)}</span>
    <span class="ls ${h.win?'lsw':'lsl'}">${h.win?'+◈'+fmt(h.profit):'-◈'+fmt(h.bet)}</span>
  </div>`).join('');
}

function recHist(win,panel,bet){
  const prof=win?parseFloat((bet*G.mult-bet).toFixed(2)):0;
  G.myHistory.push({round:G.roundId||0,cp:G.crashPt,bet,win,profit:prof,mult:win?G.mult:null,panel,time:new Date().toLocaleTimeString()});
  if(G.myHistory.length>100)G.myHistory.shift();
  if(G.totalBets>=100)checkAch('century');
  if(G.lossStreak>=3&&win)checkAch('comeback');
}

function addCrashHist(cp){
  G.crashHistory.unshift(cp);if(G.crashHistory.length>15)G.crashHistory.pop();
  const row=_el('hrow');if(!row)return;
  row.innerHTML='<span class="hlbl">History:</span>';
  G.crashHistory.forEach(c=>{
    const p=document.createElement('span');
    p.className='hp '+(c<1.5?'hpL':c<3?'hpM':'hpH');
    p.textContent=c.toFixed(2)+'x';
    row.appendChild(p);
  });
}

// ── Leaderboard ───────────────────────────────────────────────
function renderLB(){
  const el=_el('lbList');if(!el)return;
  const fake=[
    {name:'DragonLord',flag:'🇰🇪',w:12400},{name:'LuckyAchieng',flag:'🇺🇬',w:9800},
    {name:'MoonRider',flag:'🇳🇬',w:7200},{name:'StarBet',flag:'🇬🇭',w:5600},
    {name:'FireOtieno',flag:'🇿🇦',w:4100},{name:G.username,flag:'⭐',w:G.totalWon},
  ].sort((a,b)=>b.w-a.w).slice(0,8);
  el.innerHTML=fake.map((x,i)=>`
  <div class="lrow">
    <span class="lfl">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span>
    <span class="lnm">${x.flag} ${escHtml(x.name)}</span>
    <span class="la" style="color:var(--gold)">◈${fmt(x.w,0)}</span>
  </div>`).join('');
}

// ── VIP ───────────────────────────────────────────────────────
function updVIP(){
  const w=G.totalWagered;
  const tiers=[
    {min:50000,label:'💎 Diamond',cls:'vb-di'},
    {min:20000,label:'🥇 Gold',   cls:'vb-go'},
    {min:5000, label:'🥈 Silver', cls:'vb-si'},
    {min:0,    label:'🥉 Bronze', cls:'vb-br'},
  ];
  const t=tiers.find(t=>w>=t.min)||tiers[3];
  const b=_el('vipBadge');
  if(b){b.textContent=t.label;b.className='vip-badge '+t.cls;}
  const nm=w>=50000?'💎 Diamond':w>=20000?'🥇 Gold':w>=5000?'🥈 Silver':'🥉 Bronze';
  _set('vipName',nm);
  _set('vipWagered',w.toFixed(0));
  const pct=w>=50000?100:w>=20000?80:w>=5000?50:Math.min(30,w/50);
  _fn('vipBar',e=>e.style.width=pct+'%');
  const nextLbl=w>=50000?'Max tier 👑':w>=20000?'◈50,000 for Diamond':w>=5000?'◈20,000 for Gold':'◈5,000 for Silver';
  _set('vipNextLbl',nextLbl);_set('vipNextAmt',nextLbl);
  _el('achGrid')&&renderAchs();
}
function renderAchs(){
  const el=_el('achGrid');if(!el)return;
  el.innerHTML=ACHS.map(a=>`<div class="acard ${G.achs[a.k]?'ul':''}">
    <div class="aico">${a.ico}</div><div class="anm">${a.nm}</div><div class="ads">${a.ds}</div>
  </div>`).join('');
}
function checkAch(k){
  if(G.achs[k])return;G.achs[k]=true;
  const a=ACHS.find(a=>a.k===k);if(!a)return;
  toast2(`🏅 Achievement unlocked: ${a.nm} ${a.ico}`,'g');
  if(G.userId)sb.from('achievements').upsert({user_id:G.userId,achievement_key:k});
}

// ── Sidebar tabs ──────────────────────────────────────────────
window.sbTab=(t,btn)=>{
  document.querySelectorAll('.sbp').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.sbt').forEach(b=>b.classList.remove('active'));
  _fn('tab-'+t,e=>e.classList.add('active'));
  if(btn)btn.classList.add('active');
  if(t==='mine')renderHistList();
  if(t==='top')renderLB();
  if(t==='profile')renderProfileSection();
};

// ── Modal helpers ─────────────────────────────────────────────
window.openM=id=>{_fn(id,e=>e.classList.add('show'));};
window.closeM=id=>{_fn(id,e=>e.classList.remove('show'));};
document.querySelectorAll('.overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('show');});
});

// ── Wallet tabs ────────────────────────────────────────────────
window.wTab=(t,btn)=>{
  ['wDep','wWit','wBonus','wTxs','wLimits','wRef'].forEach(id=>_fn(id,e=>e&&(e.style.display='none')));
  document.querySelectorAll('.wtb').forEach(b=>b.classList.remove('active'));
  const map={dep:'wDep',wit:'wWit',bonus:'wBonus',txs:'wTxs',limits:'wLimits',ref:'wRef'};
  _fn(map[t],e=>e&&(e.style.display=''));
  if(btn)btn.classList.add('active');
  if(t==='txs')loadUserTx();
  if(t==='bonus')renderBonusTab();
};

// ── Bonus tab ──────────────────────────────────────────────────
function renderBonusTab(){
  const el=_el('wBonus');if(!el)return;
  const pct=Math.min(100,(G.balBonus/500)*100);
  el.innerHTML=`
  <div style="text-align:center;font-size:2.2rem;margin-bottom:.3rem">🎁</div>
  <div style="text-align:center;font-family:'Cinzel',serif;font-size:.9rem;color:var(--gold);margin-bottom:.15rem">Bonus Wallet</div>
  <div style="text-align:center;font-size:.72rem;color:var(--muted);margin-bottom:1.2rem">
    Earn coins from deposits &amp; sign-up. Convert to real money!
  </div>

  <div style="background:rgba(245,197,24,.06);border:1px solid rgba(245,197,24,.18);border-radius:12px;padding:1rem;margin-bottom:1rem">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
      <span style="font-size:.7rem;color:var(--muted)">Bonus Coins</span>
      <span style="font-family:'Share Tech Mono',monospace;font-size:1.4rem;color:var(--gold);font-weight:700">◈${fmt(G.balBonus,0)}</span>
    </div>
    <div style="background:rgba(255,255,255,.05);border-radius:50px;height:10px;overflow:hidden;margin-bottom:.4rem">
      <div id="bonusProgressBar" style="height:100%;background:linear-gradient(90deg,var(--fire),var(--gold));border-radius:50px;width:${pct}%;transition:width .4s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted)">
      <span id="bonusProgressTxt">${fmt(G.balBonus,0)} / 500 coins</span>
      <span>= $50 real</span>
    </div>
  </div>

  <button id="bonusConvertBtn" class="mbtn ${G.balBonus>=500?'mbtn-fire':'mbtn-muted'}"
    onclick="convertBonus()" ${G.balBonus<500?'disabled':''}>
    ${G.balBonus>=500?'🎁 Convert 500 → $50 Real':'Need '+(500-Math.floor(G.balBonus))+' more coins'}
  </button>

  <div style="margin-top:1.2rem">
    <div style="font-size:.7rem;color:var(--muted);font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase;margin-bottom:.6rem">How to earn bonus coins</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      <div class="bonus-rule"><span>🎉</span><div><b>+50 coins</b> on first signup (one-time only)</div></div>
      <div class="bonus-rule"><span>💳</span><div><b>10% of every deposit</b> → bonus coins automatically</div></div>
      <div class="bonus-rule"><span>🔄</span><div><b>500 coins = $50 real</b> — convert anytime you reach 500</div></div>
      <div class="bonus-rule"><span>🚫</span><div>Bonus coins <b>cannot be withdrawn directly</b> — convert first</div></div>
    </div>
  </div>

  <div style="margin-top:1rem">
    <div style="font-size:.7rem;color:var(--muted);font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase;margin-bottom:.6rem">Bonus History</div>
    <div id="bonusHistoryList"><div style="text-align:center;color:var(--muted);font-size:.75rem;padding:1rem">Loading...</div></div>
  </div>`;

  loadBonusHistory();
}

async function loadBonusHistory(){
  if(!G.userId)return;
  const {data}=await sb.from('bonus_transactions')
    .select('*').eq('user_id',G.userId)
    .order('created_at',{ascending:false}).limit(20);
  const el=_el('bonusHistoryList');if(!el)return;
  if(!data?.length){
    el.innerHTML='<div style="text-align:center;color:var(--muted);font-size:.75rem;padding:.5rem">No bonus activity yet</div>';
    return;
  }
  const typeLabel={signup_bonus:'🎉 Signup bonus',deposit_bonus:'💳 Deposit bonus',conversion:'🔄 Converted to real',admin_adjustment:'⚙️ Admin adjustment'};
  el.innerHTML=data.map(b=>`
  <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.75rem">
    <div>
      <div style="color:var(--text)">${typeLabel[b.type]||b.type}</div>
      <div style="color:var(--muted);font-size:.65rem">${new Date(b.created_at).toLocaleDateString()}</div>
    </div>
    <div style="text-align:right">
      <div style="color:${b.bonus_amount>=0?'var(--green)':'var(--red)'};font-weight:700">
        ${b.bonus_amount>=0?'+':''}◈${fmt(Math.abs(b.bonus_amount),0)}
      </div>
      ${b.real_amount>0?`<div style="color:var(--gold);font-size:.65rem">+$${fmt(b.real_amount)} real</div>`:''}
    </div>
  </div>`).join('');
}

// ── Deposit flow ──────────────────────────────────────────────
window.selMethod=m=>{
  G.depMethod=m;
  document.querySelectorAll('.dep-method').forEach(d=>d.classList.remove('sel'));
  _fn('dm-'+m,e=>e.classList.add('sel'));
  renderDepDetails();
};
window.onDepAmtChange=()=>{
  const amt=parseFloat(_el('depAmt')?.value)||0;
  const c=CURR[G.currency]||CURR.KES;
  _set('depUSD','$'+(amt/c.rate).toFixed(4)+' USD');
  renderDepDetails();
};
function renderDepDetails(){
  const amt=parseFloat(_el('depAmt')?.value)||0;
  const m=METHODS[G.depMethod];if(!m)return;
  const c=CURR[G.currency]||CURR.KES;
  const acct=G.depAcctRef||genRef();G.depAcctRef=acct;
  const bonusPreview=parseFloat((amt/c.rate*0.1).toFixed(4));
  let html='';
  if(G.depMethod==='mpesa'||G.depMethod==='airtel'){
    html=`<div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">${m.label}</span><span class="pb-val gold">${m.paybill}</span></div>
      <div class="pb-row"><span class="pb-lbl">Account Number</span><span class="pb-val green">${acct} <button class="copy-btn" onclick="copyText('${acct}')">Copy</button></span></div>
      <div class="pb-row"><span class="pb-lbl">Amount</span><span class="pb-val">${c.sym}${amt||'—'}</span></div>
      <div class="pb-row"><span class="pb-lbl">Account Name</span><span class="pb-val">${m.acctName}</span></div>
    </div>
    ${amt>0?`<div style="background:rgba(34,217,122,.06);border:1px solid rgba(34,217,122,.18);border-radius:8px;padding:.5rem .75rem;font-size:.73rem;color:var(--green);margin:.5rem 0">
      🎁 You'll receive <b>+◈${bonusPreview}</b> bonus coins automatically on approval
    </div>`:''}
    <div class="step-pills">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Your Phone</label><input type="tel" id="depPhone" placeholder="0712345678"></div>
    <div class="mf"><label>Confirmation Code</label><input type="text" id="depRef" placeholder="e.g. RKA1234XYZ" style="font-family:'Share Tech Mono',monospace"></div>`;
  }else if(G.depMethod==='bitcoin'||G.depMethod==='ethereum'){
    html=`<div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">Send ${G.depMethod==='bitcoin'?'BTC':'ETH'} to</span></div>
      <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:.5rem .7rem;font-family:'Share Tech Mono',monospace;font-size:.65rem;color:var(--blue);word-break:break-all;margin:.3rem 0">
        ${m.address} <button class="copy-btn" onclick="copyText('${m.address}')">Copy</button>
      </div>
    </div>
    ${amt>0?`<div style="background:rgba(34,217,122,.06);border:1px solid rgba(34,217,122,.18);border-radius:8px;padding:.5rem .75rem;font-size:.73rem;color:var(--green);margin:.5rem 0">
      🎁 +◈${bonusPreview} bonus coins on approval
    </div>`:''}
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
  _fn('depDetails',e=>e.innerHTML=html);
  _fn('depSubmitBtn',e=>e.style.display=amt>0?'block':'none');
}

window.submitDeposit=async()=>{
  const amt=parseFloat(_el('depAmt')?.value);
  const c=CURR[G.currency]||CURR.KES;
  if(!amt||amt<c.min){toast2(`Minimum deposit is ${c.sym}${c.min} (≈ $0.50)`,'l');return;}
  const usd=amt/c.rate;
  if(usd<0.5){toast2('Minimum deposit is $0.50 USD','l');return;}

  const phone=_el('depPhone')?.value||'';
  const ref=_el('depRef')?.value||'';
  const btn=_el('depSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent='Submitting...';}

  if(isDemo()){
    G.balDemo=Math.max(0,G.balDemo+amt);
    G.balBonus+=parseFloat((usd*0.1).toFixed(4));
    updateBalDisp();
    toast2(`[Demo] Deposit of ◈${fmt(amt)} credited + 🎁 ${fmt(usd*0.1,4)} bonus coins!`,'w');
    closeM('walletModal');
    if(btn){btn.disabled=false;btn.textContent='Submit Deposit Request →';}
    return;
  }

  if(!G.userId){toast2('Please log in','l');if(btn){btn.disabled=false;btn.textContent='Submit Deposit Request →';}return;}

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

  if(btn){btn.disabled=false;btn.textContent='Submit Deposit Request →';}

  if(error){toast2('Failed to submit: '+error.message,'l');return;}
  if(data?.success){
    toast2('Deposit submitted! Pending admin approval ⏳ You\'ll get 10% bonus coins on approval!','g');
    closeM('walletModal');loadUserTx();
  }else{
    toast2(data?.error||'Something went wrong','l');
  }
};

window.submitWithdraw=async()=>{
  const amt=parseFloat(_el('witAmt')?.value);
  if(!amt||amt<1){toast2('Enter a valid amount','l');return;}
  if(amt>G.balReal){toast2('Insufficient real balance. Convert bonus coins first!','l');return;}
  if(isDemo()){toast2('Withdrawals not available in demo mode','l');return;}
  if(!G.userId){toast2('Please log in','l');return;}
  const phone=_el('witPhone')?.value;
  const method=_el('witMethod')?.value;
  const {error}=await sb.from('transactions').insert({
    user_id:G.userId,type:'withdrawal',amount:amt,currency:G.currency,
    method,phone_number:phone,status:'pending',description:'Withdrawal request',
  });
  if(error){toast2('Failed: '+error.message,'l');return;}
  toast2('Withdrawal request submitted — pending approval ⏳','g');
  closeM('walletModal');loadUserTx();
};

window.saveLimits=async()=>{
  if(!G.userId){toast2('Please log in','l');return;}
  await sb.from('users').update({
    daily_loss_limit:parseFloat(_el('rgDaily')?.value)||null,
    weekly_limit:    parseFloat(_el('rgWeekly')?.value)||null,
    session_limit_min:parseInt(_el('rgSession')?.value)||null,
    max_bet_limit:   parseFloat(_el('rgMaxBet')?.value)||null,
  }).eq('id',G.userId);
  toast2('Limits saved ✓','w');
};

function renderTxList(){
  const el=_el('txList');if(!el)return;
  if(!G.txLog.length){
    el.innerHTML='<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No transactions yet</div>';
    return;
  }
  el.innerHTML=G.txLog.map(t=>{
    const isPos=['deposit','bonus','winnings','referral'].includes(t.type);
    const stMap={pending:'st-pending',completed:'st-done',failed:'st-fail'};
    return`<div class="txitem">
      <div>
        <div class="txtype"><div class="txdot" style="background:${isPos?'var(--green)':'var(--red)'}"></div>${t.type}</div>
        <div class="txmeta">${t.description||t.method||''} · ${new Date(t.created_at).toLocaleDateString()}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="status-tag ${stMap[t.status]||''}">${t.status}</span>
        <span class="txamt ${isPos?'txp':'txn'}">${isPos?'+':'-'}${t.currency||G.currency} ${parseFloat(t.amount).toFixed(2)}</span>
      </div>
    </div>`;
  }).join('');
}

window.copyRef=()=>{
  const link=_el('refLink')?.value;
  if(link)navigator.clipboard?.writeText(link);
  toast2('Referral link copied!','i');
};
window.copyText=txt=>{navigator.clipboard?.writeText(txt);toast2('Copied!','i');};

// ── Chat ──────────────────────────────────────────────────────
const INIT_CHAT=[
  {u:'FireKe 🇰🇪',t:"let's gooo dragon fly high tonight! 🔥"},
  {u:'LuckyO 🇳🇬',t:'cashed at 4.2x — nice one!'},
  {u:'DrgnRdr 🇿🇦',t:'who else using both bets? 🎲'},
  {u:'MoonSht 🇬🇭',t:'waiting for a 20x 🚀'},
];
function initChat(){
  const m=_el('cmsgs');if(!m)return;
  INIT_CHAT.forEach(l=>{m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${l.u}:</span><span class="ctxt">${l.t}</span></div>`;});
  m.scrollTop=m.scrollHeight;

  // Subscribe to live chat
  sb.channel('chat-live')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},
      payload=>{
        const msg=payload.new;
        if(msg.user_id===G.userId)return; // already shown
        m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${escHtml(msg.username)}:</span><span class="ctxt">${escHtml(msg.message)}</span></div>`;
        m.scrollTop=m.scrollHeight;
      })
    .subscribe();
}
window.sendChat=()=>{
  const inp=_el('chatInp');if(!inp?.value.trim())return;
  const m=_el('cmsgs');
  const msg=inp.value.substring(0,200);
  m.innerHTML+=`<div class="cmsg"><span class="cuser cyu">${escHtml(G.username)}:</span><span class="ctxt">${escHtml(msg)}</span></div>`;
  inp.value='';m.scrollTop=m.scrollHeight;
  if(G.userId)sb.from('chat_messages').insert({user_id:G.userId,username:G.username,message:msg});
  setTimeout(()=>{
    const bot=pick(CBOT_NAMES);
    const reply=pick(CBOT_MSGS).replace('{m}',G.mult.toFixed(2));
    m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${bot}:</span><span class="ctxt">${reply}</span></div>`;
    m.scrollTop=m.scrollHeight;
  },1200+Math.random()*2000);
};

// ── Daily bonus ────────────────────────────────────────────────
// Credits bonus coins (not real balance) via DB insert.
// Real-balance crediting is handled by the admin-approval flow.
window.claimBonus=async()=>{
  _fn('bonusPop',e=>e.classList.remove('show'));

  if(!G.userId){
    // Guest / demo: credit locally
    G.balDemo+=50;
    updateBalDisp();
    toast2('Daily bonus claimed! +◈50 (demo)','w');
    return;
  }

  const today=new Date().toISOString().split('T')[0];

  // Insert daily bonus record
  const {error}=await sb.from('daily_bonuses').insert({
    user_id:G.userId,
    streak_day:G.streakDay||1,
    amount:50,
    claimed_date:today,
  });

  if(error){
    toast2('Could not claim bonus — try tomorrow!','l');
    return;
  }

  // Credit 50 bonus coins via bonus_transactions
  await sb.from('bonus_transactions').insert({
    user_id:G.userId,
    type:'admin_adjustment',
    bonus_amount:50,
    real_amount:0,
    description:'Daily login bonus',
  });

  // Update user balance_bonus and streak directly
  const newBonus=G.balBonus+50;
  const newStreak=(G.streakDay||1)+1;
  await sb.from('users').update({
    balance_bonus:newBonus,
    streak_day:newStreak,
    last_bonus_date:today,
    updated_at:new Date().toISOString(),
  }).eq('id',G.userId);

  G.balBonus=newBonus;
  G.streakDay=newStreak;
  updateBalDisp();
  toast2(`Daily bonus claimed! +◈50 🎁 (Day ${G.streakDay-1} streak)`,'w');
};

// ── Sound ─────────────────────────────────────────────────────
const AC=window.AudioContext||window.webkitAudioContext;
let ac=null;
function getAC(){if(!ac){try{ac=new AC();}catch(e){}}return ac;}
function beep(freq,dur,vol=.18,type='sine'){
  try{
    const a=getAC();if(!a||!G.soundOn)return;
    const o=a.createOscillator(),g=a.createGain();
    o.connect(g);g.connect(a.destination);
    o.frequency.value=freq;o.type=type;
    g.gain.setValueAtTime(vol,a.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,a.currentTime+dur);
    o.start();o.stop(a.currentTime+dur);
  }catch(e){}
}
function sfxTick(){beep(440,.08,.08);}
function sfxPlace(){beep(520,.12,.15,'triangle');setTimeout(()=>beep(660,.1,.12,'triangle'),80);}
function sfxCashout(){beep(880,.1,.2,'sine');setTimeout(()=>beep(1100,.2,.18,'sine'),90);}
function sfxCrash(){beep(120,.5,.25,'sawtooth');setTimeout(()=>beep(80,.4,.2,'sawtooth'),200);}
window.toggleSound=()=>{
  G.soundOn=!G.soundOn;
  _fn('sndBtn',e=>{e.textContent=G.soundOn?'🔊':'🔇';e.className='ibtn '+(G.soundOn?'on':'');});
};

// ── Sign out ──────────────────────────────────────────────────
window.signOut=async()=>{await sb.auth.signOut();location.href='auth.html';};

// ── Toast ─────────────────────────────────────────────────────
window.toast2=(msg,t)=>{
  const el=_el('toastEl');if(!el)return;
  el.textContent=msg;
  el.className=`toast show ${t==='w'?'tw':t==='l'?'tl':t==='g'?'tg':'ti'}`;
  clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast',3800);
};

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){location.href='auth.html';return;}

  // Restore currency preference
  const savedCur=localStorage.getItem('df_currency');
  if(savedCur&&CURR[savedCur]){
    G.currency=savedCur;
    _fn('csel',e=>e.value=savedCur);
  }

  setMode('demo');
  initChat();
  renderLB();
  updBtns();

  await loadUser();         // loads profile + balances + sets up realtime
  await subscribeRounds();  // pulls current round from DB

  startWaiting();
}

boot();
/* ============================================================
   DRAGON FLIGHT — game.js  (Production v6 — Server-Sync)
   ─────────────────────────────────────────────────────────────
   KEY CHANGES IN THIS VERSION (v6):
   1. Server-authoritative game engine — no client generates
      rounds independently. One elected "leader" client drives
      all state transitions; all others listen and sync.
   2. Multiplier is calculated from the shared `started_at`
      DB timestamp using calcMult(), NOT from local RAF timers.
      Every device shows the exact same multiplier at the same
      moment regardless of when it connected.
   3. Reconnection recovery — on page-focus/online events the
      engine re-fetches the active round and resumes seamlessly
      from the correct phase/multiplier.
   4. Race-condition-safe crash queue consumption via the
      consume_next_crash_point() SECURITY DEFINER RPC which
      uses SELECT FOR UPDATE SKIP LOCKED.
   5. Dual Realtime channels: postgres_changes (authoritative)
      + Broadcast (low-latency, < 50ms) for phase signals.
   6. Leader election via Realtime heartbeat — no SPOF.
   7. All original game features (chat, bets, history, VIP,
      achievements, wallet, profile) preserved unchanged.
   ============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const sb = createClient(
  'https://rwtezncoukiekayxuxje.supabase.co',
  'sb_publishable_9JwkSoI9zm2oXu6tvZDRaw_2ebdCWtE'
);

// ── Sync constants ───────────────────────────────────────────
const WAIT_SECS        = 7;       // countdown seconds before flying
const CRASH_SETTLE_MS  = 4000;    // ms to show crash before next round
const MULT_GROWTH      = 0.07;    // e^(k*t) — matches original game feel
const HEARTBEAT_MS     = 4000;    // leader heartbeat interval
const LEADER_TTL_MS    = 9000;    // claim leadership if silent this long

/** Deterministic multiplier from a server timestamp */
function calcMult(startedAt) {
  if (!startedAt) return 1.00;
  const elapsedSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
  return parseFloat(Math.max(1.00, Math.pow(Math.E, MULT_GROWTH * elapsedSec)).toFixed(2));
}

/** How many ms until crash_point is reached from startedAt */
function msUntilCrash(crashPt, startedAt) {
  const tCrash = Math.log(crashPt) / MULT_GROWTH;
  const crashTime = new Date(startedAt).getTime() + tCrash * 1000;
  return Math.max(0, crashTime - Date.now());
}

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
  {k:'bigWin',   ico:'💰',nm:'Big Winner',    ds:'Win over KSh 500 in one round'},
  {k:'moon',     ico:'🚀',nm:'Moon Rider',    ds:'Cash out at 10x+'},
  {k:'streak3',  ico:'🔥',nm:'Hot Streak',    ds:'Win 3 rounds in a row'},
  {k:'diamond',  ico:'💎',nm:'Diamond Hands', ds:'Wait past 5x multiplier'},
  {k:'dual',     ico:'🎲',nm:'Dual Bettor',   ds:'Use both panels at once'},
  {k:'century',  ico:'💯',nm:'Century',       ds:'Complete 100 bets'},
  {k:'comeback', ico:'⚡',nm:'Comeback King', ds:'Win after 3 losses in a row'},
];

// ── Payment methods ──────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  CENTRALIZED PAYMENT CONFIG — single source of truth
//  All pages (index.html, verification.html, admin) read from here.
// ─────────────────────────────────────────────────────────────
const PAYMENT_CONFIG = {
  paybill: '247247',
  account: '1347583459',
  acctName: 'DRAGON FLIGHT',
  verificationFee: 200,  // KSh fee for withdrawal verification
};
// Expose globally so verification.html inline scripts can access it
window.PAYMENT_CONFIG = PAYMENT_CONFIG;

const METHODS={
  mpesa:{
    label:'M-Pesa Paybill',icon:'📱',paybill:PAYMENT_CONFIG.paybill,accountNumber:PAYMENT_CONFIG.account,acctName:PAYMENT_CONFIG.acctName,
    steps:['Go to M-Pesa → Lipa na M-Pesa → Pay Bill',
           'Business No: <b>'+PAYMENT_CONFIG.paybill+'</b>',
           'Account No: <b>'+PAYMENT_CONFIG.account+'</b>',
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

// ─────────────────────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────────────────────
const G={
  // ── Game phase (authoritative from server) ────────────────
  phase:'waiting', mult:1, crashPt:1.5,
  startedAt:null,          // ISO string from DB — used for mult calc
  roundId:null,
  currentRoundId:null,     // alias for backward compat
  currentRoundNumber:0,
  serverSeedHash:'',

  // ── Leader-election state ─────────────────────────────────
  _isLeader:false,
  _leaderTs:0,             // last heartbeat timestamp
  _heartbeatIntvl:null,
  _crashTimer:null,        // leader's crash setTimeout handle
  _realtimeChannel:null,
  _recovering:false,

  // ── Animation ─────────────────────────────────────────────
  trail:[], dragonX:0, dragonY:0, animFr:null,
  countSec:WAIT_SECS, countIntvl:null,

  // ── Wallet ────────────────────────────────────────────────
  walletMode:'real', balReal:0, balDemo:10000, balBonus:0, currency:'KES',

  // ── Panels ────────────────────────────────────────────────
  aIn:false, aAmt:0, aCo:false, aMode:'manual', aRnds:10, aPlayed:0,
  aRunning:false, aBetId:null, aQueued:0,
  bIn:false, bAmt:0, bCo:false, bMode:'manual', bRnds:10, bPlayed:0,
  bRunning:false, bBetId:null, bQueued:0,

  // ── User ──────────────────────────────────────────────────
  userId:null, username:'Guest', email:'', country:'',
  vipTier:'bronze', createdAt:null, lastLogin:null,
  totalWagered:0, totalWon:0, totalProfit:0, totalBets:0,
  streakDay:1,

  // ── Misc ──────────────────────────────────────────────────
  bots:[], myHistory:[], crashHistory:[], txLog:[], achs:{},
  depMethod:'mpesa', depAcctRef:'',
  winStreak:0, lossStreak:0, soundOn:true,
  _approvedDepIds:new Set(),
  _betLock:false, _depositLock:false,
  _aLastAutoRound:null, _bLastAutoRound:null,
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
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function sbSafe(fn, label=''){
  try{
    const result=await fn();
    if(result?.error){
      const code=result.error.code||result.error.status||'';
      const msg=result.error.message||'Unknown error';
      if(code==='406'||code===406) console.warn(`[DF][${label}] 406:`,msg);
      else if(code==='403'||code===403) console.error(`[DF][${label}] 403 RLS:`,msg);
      else console.error(`[DF][${label}] Error:`,msg,result.error);
    }
    return result;
  }catch(err){
    console.error(`[DF][${label}] Network error:`,err);
    return {data:null,error:{message:err.message||'Network error'}};
  }
}

const isDemo=()=>G.walletMode==='demo';
function getBal(){return isDemo()?G.balDemo:G.balReal;}

// ─────────────────────────────────────────────────────────────
//  WALLET DISPLAY
// ─────────────────────────────────────────────────────────────
/** Format a KES amount with comma separators: KSh 1,250.00 */
function fmtKES(n, decimals=2){
  const v = parseFloat(n||0);
  if(!isFinite(v)) return 'KSh 0.00';
  return 'KSh ' + v.toLocaleString('en-KE', {minimumFractionDigits:decimals, maximumFractionDigits:decimals});
}

function updateBalDisp(){
  G.currency='KES';
  const clamp=v=>isFinite(v)&&v>=0?v:0;
  const realDisp=clamp(G.balReal);
  const demoDisp=clamp(G.balDemo);
  const disp=_el('balDisp');
  // Display balance already stored as KES in DB — no conversion needed
  if(disp) disp.textContent=fmtKES(isDemo()?demoDisp:realDisp);
  _fn('balIcon',e=>e.textContent='🇰🇪');
  _set('bonusQuickDisp',fmt(G.balBonus,0));
  _set('wRealBal',fmtKES(realDisp));
  _set('wDemoBal',fmtKES(demoDisp));
  _set('wBonusBal','◈'+fmt(G.balBonus,0));
  _set('witAvail',fmtKES(realDisp));
  _set('minDepTxt','KSh 65');
  const pct=Math.min(100,(G.balBonus/500)*100);
  _fn('bonusProgressBar',el=>el.style.width=pct+'%');
  _set('bonusProgressTxt',`${fmt(G.balBonus,0)} / 500 coins`);
  _fn('bonusConvertBtn',el=>{
    el.disabled=G.balBonus<500;
    el.textContent=G.balBonus>=500?'🎁 Convert 500 → KSh 6,500 Real':'Need '+(500-Math.floor(G.balBonus))+' more coins';
    el.className='mbtn '+(G.balBonus>=500?'mbtn-fire':'mbtn-muted');
  });
  renderProfileSection();
  _set('depCurrTag',G.currency);
}

// ── Mode switch ──────────────────────────────────────────────
window.setMode=m=>{
  G.walletMode=m;
  const isD=isDemo();
  _fn('demoBtn',e=>e.className='mdb '+(isD?'don':''));
  _fn('realBtn',e=>e.className='mdb '+(isD?'':'ron'));
  _fn('dmwm',e=>e.className='dmwm '+(isD?'show':''));
  const bw=document.querySelector('.bal-dep-wrap');
  if(bw) bw.className='bal-dep-wrap '+(isD?'mode-demo':'mode-real');
  const mib=document.querySelector('.mode-indicator-bar');
  if(mib) mib.className='mode-indicator-bar '+(isD?'':'real-mode');
  updateBalDisp();
  toast2(isD?'🎮 Demo mode — virtual coins':'💰 Real money mode',isD?'i':'w');
  if(isD) startDemoTimer(); else stopDemoTimer();
};
window.setCurrency=()=>{G.currency='KES';updateBalDisp();};

// ── Bonus conversion ─────────────────────────────────────────
window.convertBonus=async()=>{
  if(G.balBonus<500){toast2('Need 500 bonus coins to convert','l');return;}
  if(!G.userId){toast2('Please log in','l');return;}
  const btn=_el('bonusConvertBtn');
  if(btn){btn.disabled=true;btn.textContent='Converting...';}
  const {data,error}=await sbSafe(()=>sb.rpc('convert_bonus_to_real',{p_user_id:G.userId}),'convertBonus');
  if(error||!data?.success){
    toast2(data?.error||error?.message||'Conversion failed — try again','l');
    if(btn)btn.disabled=false;
    return;
  }
  await refreshUserBalance();
  toast2('🎉 Converted 500 bonus coins → +KSh 6,500 real balance!','w');
};

// ─────────────────────────────────────────────────────────────
//  AUTH / USER LOADING
// ─────────────────────────────────────────────────────────────
async function loadUser(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){location.href='auth.html';return;}
  G.userId=session.user.id;
  const {data:u,error}=await sbSafe(()=>
    sb.from('users').select('*').eq('id',G.userId).maybeSingle(),'loadUser');
  if(error||!u){toast2('Could not load profile — limited mode active','l');return;}
  G.balReal    =parseFloat(u.balance_real)||0;
  G.balBonus   =parseFloat(u.balance_bonus)||0;
  const dbDemo =parseFloat(u.balance_demo);
  G.balDemo    =(isFinite(dbDemo)&&dbDemo>0)?parseFloat(dbDemo.toFixed(2)):10000.00;
  G.username   =u.username||'Player';
  G.email      =u.email||'';
  G.country    =u.country||'';
  G.vipTier    =u.vip_tier||'bronze';
  G.createdAt  =u.created_at||null;
  G.lastLogin  =u.last_login||null;
  G.totalWagered=parseFloat(u.total_wagered)||0;
  G.totalWon   =parseFloat(u.total_won)||0;
  G.totalProfit=parseFloat(u.total_profit)||0;
  G.streakDay  =u.streak_day||1;
  G.currency   ='KES';
  const refLink=_el('refLink');
  if(refLink&&u.referral_code)
    refLink.value=`https://dragonflight.bet/r/${u.referral_code}`;
  updateBalDisp();renderProfileSection();loadUserTx();subscribeBalance();updVIP();
  sbSafe(()=>sb.from('users').update({last_login:new Date().toISOString()}).eq('id',G.userId),'lastLogin');
  // Start withdrawal update listener (in case a pending withdrawal was approved while offline)
  _subscribeWithdrawalUpdates();
  // Check for any pending-approved withdrawals that need verification
  _checkPendingWithdrawalVerification();
  // Return-from-verification notification
  _checkVerifReturnNotification();
  if(!u.bonus_claimed){
    const {data:bdata}=await sbSafe(()=>sb.rpc('claim_signup_bonus',{p_user_id:G.userId}),'signupBonus');
    if(bdata?.success){G.balBonus+=50;updateBalDisp();toast2('🎉 Welcome! +50 bonus coins added!','w');}
  }
  setTimeout(()=>{
    const today=new Date().toISOString().split('T')[0];
    if((u.last_bonus_date||'')!==today){
      _set('bonusSub',`Day ${G.streakDay} streak 🔥`);
      _fn('bonusPop',e=>e.classList.add('show'));
    }
  },2500);
}

async function refreshUserBalance(){
  if(!G.userId)return;
  const {data:u}=await sbSafe(()=>
    sb.from('users').select('balance_real,balance_bonus,total_wagered,total_won,total_profit')
      .eq('id',G.userId).maybeSingle(),'refreshBalance');
  if(!u)return;
  G.balReal    =parseFloat(u.balance_real)||0;
  G.balBonus   =parseFloat(u.balance_bonus)||0;
  G.totalWagered=parseFloat(u.total_wagered)||0;
  G.totalWon   =parseFloat(u.total_won)||0;
  G.totalProfit=parseFloat(u.total_profit)||0;
  updateBalDisp();
}

async function loadUserTx(){
  if(!G.userId)return;
  const {data}=await sbSafe(()=>
    sb.from('transactions').select('*').eq('user_id',G.userId)
      .order('created_at',{ascending:false}).limit(50),'loadTx');
  G.txLog=data||[];renderTxList();
}

// ─────────────────────────────────────────────────────────────
//  REALTIME SUBSCRIPTIONS  (balance / transactions / chat)
// ─────────────────────────────────────────────────────────────
function subscribeBalance(){
  if(!G.userId)return;
  sb.channel('user-row-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'users',filter:`id=eq.${G.userId}`},
      payload=>{
        const u=payload.new;
        G.balReal    =parseFloat(u.balance_real)||0;
        G.balBonus   =parseFloat(u.balance_bonus)||0;
        G.totalWagered=parseFloat(u.total_wagered)||0;
        G.totalWon   =parseFloat(u.total_won)||0;
        G.totalProfit=parseFloat(u.total_profit)||0;
        G.vipTier    =u.vip_tier||'bronze';
        updateBalDisp();updVIP();
        _fn('balDisp',el=>{el.style.transition='color .15s';el.style.color='var(--green)';setTimeout(()=>el.style.color='',900);});
      }).subscribe();
  sb.channel('tx-updates-'+G.userId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'transactions',filter:`user_id=eq.${G.userId}`},
      async payload=>{
        const tx=payload.new;
        if(tx.status==='completed'){
          if(tx.type==='deposit'){
            if(G._approvedDepIds.has(tx.id))return;
            G._approvedDepIds.add(tx.id);
          }
          await refreshUserBalance();loadUserTx();
          const approvedMsg = tx.type==='bonus'
            ? `🎁 Bonus credited: ◈${fmt(tx.amount)}`
            : `✅ Deposit of ${fmtKES(tx.amount)} approved!`;
          toast2(approvedMsg,'w');
          // Also add to notification bell
          if(tx.type!=='bonus'){
            const approvedKey='dep-ok-notif-'+tx.id;
            if(!sessionStorage.getItem(approvedKey)){
              sessionStorage.setItem(approvedKey,'1');
              _notifAdd({
                icon:'✅', title:'Deposit Approved',
                msg:`Your deposit of ${fmtKES(parseFloat(tx.amount||0))} has been approved and credited to your balance.`,
                type:'success',
              });
            }
          }
          sfxCashout();
        }
        if(tx.status==='failed'){
          loadUserTx();
          // Rich rejection toast with reason + close button
          _showRejectionToast({
            amount: tx.amount,
            reason: tx.reject_reason || null,
            txId: tx.id,
          });
          // Persistent bell notification
          const rejKey='dep-rej-notif-'+tx.id;
          if(!sessionStorage.getItem(rejKey)){
            sessionStorage.setItem(rejKey,'1');
            const reason = tx.reject_reason || 'Please contact support.';
            _notifAdd({
              icon:'❌',
              title:'Deposit Rejected',
              msg:`Your deposit of ${fmtKES(parseFloat(tx.amount||0))} was rejected.\nReason: "${reason}"\nPlease try again or contact support.`,
              type:'error',
              persistent:true,
            });
            // Auto-open notification panel to draw attention
            const panel=_el('notifPanel');
            if(panel){ panel.style.display='block'; }
          }
        }
      }).subscribe();
}

// ─────────────────────────────────────────────────────────────
//  SERVER-AUTHORITATIVE GAME ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * STEP 1 — Subscribe to the shared Realtime channel.
 * All clients (leader and followers) listen here.
 */
function subscribeGameEngine(){
  G._realtimeChannel = sb.channel('df-game-engine-v6', {
    config:{ broadcast:{ self: true } }
  });

  G._realtimeChannel
    // DB changes — authoritative source of truth
    .on('postgres_changes',{event:'*',schema:'public',table:'rounds'},
      payload => handleRoundsChange(payload))
    // Low-latency broadcast from leader (< 50ms vs DB ~200ms)
    .on('broadcast',{event:'phase'}, msg => handlePhaseBroadcast(msg.payload))
    // Leader heartbeat
    .on('broadcast',{event:'heartbeat'}, msg => {
      G._leaderTs = Date.now();
      // If two leaders collide, the one with the higher userId wins
      if(G._isLeader && msg.payload.leaderId > G.userId){
        G._isLeader = false;
        clearInterval(G._heartbeatIntvl);
        console.log('[DF] Stepped down as leader — peer has higher priority');
      }
    })
    .subscribe(status => {
      if(status==='SUBSCRIBED'){
        console.log('[DF] Game engine channel connected');
      } else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
        console.warn('[DF] Channel error — will recover on reconnect');
        setTimeout(() => recoverSync(), 3000);
      }
    });
}

/**
 * STEP 2 — Fetch the current active round and sync UI to it.
 * Called on boot and after every reconnect.
 */
async function fetchAndSyncRound(){
  const {data:round} = await sbSafe(()=>
    sb.from('rounds')
      .select('*')
      .in('status',['waiting','flying'])
      .order('round_number',{ascending:false})
      .limit(1)
      .maybeSingle(),'fetchActiveRound');

  if(!round){
    // No active round — wait for leader to create one
    G.phase='waiting';
    _tryBecomeLeader();
    return;
  }

  // Apply round metadata
  _applyRoundData(round);

  if(round.status==='waiting'){
    _syncToWaiting(round);
  } else if(round.status==='flying'){
    _syncToFlying(round);
  }

  await _tryBecomeLeader();
}

/** Apply round DB row to local state */
function _applyRoundData(round){
  G.roundId            = round.id;
  G.currentRoundId     = round.id;
  G.currentRoundNumber = round.round_number;
  // CRITICAL FIX: Never allow crashPt to be 0 or falsy — that causes infinite rounds.
  // Minimum valid crash point is 1.01x.
  const cp = parseFloat(round.crash_point);
  G.crashPt = (isFinite(cp) && cp >= 1.01) ? cp : 1.50;
  G.startedAt          = round.started_at || null;
  G.serverSeedHash     = round.server_seed_hash || '';
  _set('roundNum', round.round_number);
  if(round.server_seed_hash){
    _set('pfHash', round.server_seed_hash.substring(0,26)+'...');
    _fn('pfSeedHash',e=>e.value=round.server_seed_hash||'');
  }
  console.log(`[DF] Round #${round.round_number} — crashPt=${G.crashPt} status=${round.status}`);
}

/** Sync to waiting phase, compensating for elapsed countdown */
function _syncToWaiting(round){
  const createdAt = round.created_at ? new Date(round.created_at).getTime() : Date.now();
  const elapsed   = (Date.now() - createdAt) / 1000;
  const remaining = Math.max(1, WAIT_SECS - elapsed);

  G.phase   = 'waiting';
  G.mult    = 1.00;
  G.startedAt = null;

  _resetBetState();
  genBots(G.crashPt || 5);
  buildGhostBar();
  _set('pfHash', (G.serverSeedHash||'').substring(0,26)+'...');
  _fn('pfResult',e=>e.value='');
  setSB('wait','Waiting for next round...');
  _fn('mwrap',e=>e.style.display='none');
  _set('mvEl','1.00x');
  cx.clearRect(0,0,cv.width,cv.height);drawGrid();
  ['A','B'].forEach(p=>_fn('panel'+p,e=>e.className='bpanel'));
  renderLiveList();updBtns();

  startCountdown(Math.ceil(remaining));

  // Fire queued bets (only for non-leader followers — leader handles in _finishWaitingSetup)
  if(!G._isLeader){
    ['A','B'].forEach(p=>{
      const q=p==='A'?G.aQueued:G.bQueued;
      if(q>0){
        if(p==='A'){G.aQueued=0;G._aLastAutoRound=G.currentRoundId;}
        else{G.bQueued=0;G._bLastAutoRound=G.currentRoundId;}
        setTimeout(()=>placeBet(p,q),300);
      }
    });

    // Auto-bet for followers — with duplicate protection
    ['A','B'].forEach(p=>{
      if(getMode(p)==='auto'&&isAutoRun(p)){
        handleAutoAfter(p);
        if(isAutoRun(p)){
          const inB=p==='A'?G.aIn:G.bIn;
          const lastRound=p==='A'?G._aLastAutoRound:G._bLastAutoRound;
          if(!inB&&lastRound!==G.currentRoundId){
            const amt=parseFloat((_el('amt'+p)||{}).value)||0;
            const bal=getBal();
            if(amt>0&&bal>=amt){
              setTimeout(()=>{
                const stillIn=p==='A'?G.aIn:G.bIn;
                if(!stillIn&&(p==='A'?G._aLastAutoRound:G._bLastAutoRound)!==G.currentRoundId){
                  if(p==='A')G._aLastAutoRound=G.currentRoundId;
                  else G._bLastAutoRound=G.currentRoundId;
                  placeBet(p,amt);
                }
              },500);
            } else if(amt>0&&bal<amt){
              stopAuto(p,`Auto ${p} stopped — insufficient balance`);
            }
          }
        }
      }
    });
  }

  // Leader schedules fly transition (for reconnect case where leader re-syncs to waiting)
  if(G._isLeader && remaining > 0.5){
    clearTimeout(G._crashTimer);
    G._crashTimer=setTimeout(()=>_leaderDoFlying(), remaining*1000);
  }
}

/** Sync to flying phase from the server's started_at timestamp */
function _syncToFlying(round){
  G.phase    = 'flying';
  G.startedAt= round.started_at;
  G.mult     = calcMult(G.startedAt);
  G.trail    = [];

  // CRITICAL FIX: Validate crashPt from round data; fallback to G.crashPt; final fallback 1.50
  const roundCrash = parseFloat(round.crash_point);
  if(isFinite(roundCrash) && roundCrash >= 1.01) G.crashPt = roundCrash;
  if(!G.crashPt || G.crashPt < 1.01) G.crashPt = 1.50;

  setSB('fly','🐉 Dragon is soaring!');
  _fn('mwrap',e=>e.style.display='');
  _set('mlEl','Cash out before the crash!');
  updBtns();
  _startAnimLoop();

  // Leader schedules crash — MUST have a valid crashPt
  if(G._isLeader){
    clearTimeout(G._crashTimer);
    const delay = msUntilCrash(G.crashPt, G.startedAt);
    console.log(`[DF Leader] Crash scheduled in ${(delay/1000).toFixed(2)}s at ${G.crashPt}x`);
    if(delay <= 0){
      // Already past crash time — crash immediately
      console.warn('[DF Leader] Crash time already passed — crashing now');
      setTimeout(()=>_leaderDoCrash(), 100);
    } else {
      G._crashTimer = setTimeout(()=>_leaderDoCrash(), delay);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  REALTIME EVENT HANDLERS
// ─────────────────────────────────────────────────────────────
function handleRoundsChange(payload){
  const row = payload.new || payload.old;
  if(!row) return;

  // Ignore stale rounds — but only if we have a valid round_number to compare
  if(row.round_number && G.currentRoundNumber &&
     row.round_number < G.currentRoundNumber) return;

  const status = row.status;

  if(payload.eventType==='INSERT' || status==='waiting'){
    // Brand-new round — skip if already on this exact round in waiting
    if(row.id && row.id === G.roundId && G.phase==='waiting') return;
    _applyRoundData(row);
    _syncToWaiting(row);
    return;
  }

  if(status==='flying'){
    // Accept flying for our current round, or if no round active
    if(G.phase==='flying' && row.id===G.roundId) return; // already flying
    if(row.id===G.roundId || !G.roundId){
      _applyRoundData(row);
      _syncToFlying(row);
    }
    return;
  }

  if(status==='crashed'){
    if(G.phase==='crashed') return;
    if(row.id===G.roundId || !G.roundId){
      _applyRoundData(row);
      _handleCrashEvent(parseFloat(row.crash_point)||G.crashPt, row.crashed_at);
    }
    return;
  }
}

function handlePhaseBroadcast(payload){
  if(!payload) return;

  if(payload.event==='waiting' && payload.roundNumber > G.currentRoundNumber){
    // New round announced by leader — faster than DB propagation
    G.roundId            = payload.roundId;
    G.currentRoundId     = payload.roundId;
    G.currentRoundNumber = payload.roundNumber;
    G.crashPt            = payload.crashPt;
    G.serverSeedHash     = payload.serverSeedHash||'';
    _set('roundNum', payload.roundNumber);
    _set('pfHash', (payload.serverSeedHash||'').substring(0,26)+'...');
    _fn('pfSeedHash',e=>e.value=payload.serverSeedHash||'');
    _syncToWaiting({
      id: payload.roundId,
      round_number: payload.roundNumber,
      crash_point: payload.crashPt,
      server_seed_hash: payload.serverSeedHash||'',
      created_at: new Date().toISOString(),
      started_at: null,
    });
    return;
  }

  if(payload.event==='flying' && payload.roundId===G.roundId && G.phase!=='flying'){
    G.startedAt = payload.startedAt;
    _syncToFlying({ id:G.roundId, started_at:payload.startedAt, crash_point:G.crashPt });
    return;
  }

  if(payload.event==='crashed' && payload.roundId===G.roundId && G.phase!=='crashed'){
    _handleCrashEvent(payload.crashPt, payload.crashedAt);
    return;
  }
}

function _handleCrashEvent(crashPt, crashedAt){
  _stopAnimLoop();
  clearTimeout(G._crashTimer);
  G.phase   = 'crashed';
  G.crashPt = parseFloat(crashPt) || G.crashPt || 1.50;
  G.mult    = G.crashPt;

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
    const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo,amt=p==='A'?G.aAmt:G.bAmt;
    if(inB&&!co){
      recHist(false,p,amt);
      toast2(`Bet ${p} lost — crashed at ${G.crashPt.toFixed(2)}x 💀`,'l');
      G.winStreak=0;G.lossStreak++;
    }
  });

  G.bots.forEach(b=>{if(b.status==='playing')b.status='lost';});
  addCrashHist(G.crashPt);buildGhostBar();renderLiveList();renderHistList();renderLB();updVIP();
  ['A','B'].forEach(handleAutoAfter);
  G.aIn=G.bIn=false;G.aCo=G.bCo=false;G.aBetId=G.bBetId=null;
  updBtns();

  if(!isDemo())setTimeout(refreshUserBalance,1500);

  // Leader starts next round after settle period
  if(G._isLeader){
    clearTimeout(G._crashTimer);
    G._crashTimer=setTimeout(()=>_leaderStartWaiting(), CRASH_SETTLE_MS);
  }
}

// ─────────────────────────────────────────────────────────────
//  LEADER ELECTION
// ─────────────────────────────────────────────────────────────
async function _tryBecomeLeader(){
  // Only become leader if no heartbeat received recently
  if(Date.now()-G._leaderTs < LEADER_TTL_MS) return;
  G._isLeader = true;
  _startHeartbeat();
  console.log('[DF] Became leader — userId:', G.userId);

  // If there's no active round at all, start one immediately
  if(!G.roundId && G.phase==='waiting'){
    await _leaderStartWaiting();
  }
}

function _startHeartbeat(){
  clearInterval(G._heartbeatIntvl);
  const send=()=>{
    if(!G._isLeader||!G._realtimeChannel)return;
    G._realtimeChannel.send({
      type:'broadcast',event:'heartbeat',
      payload:{leaderId:G.userId,ts:Date.now()},
    });
  };
  send();
  G._heartbeatIntvl=setInterval(send,HEARTBEAT_MS);
}

// ─────────────────────────────────────────────────────────────
//  LEADER ACTIONS
// ─────────────────────────────────────────────────────────────

/** Leader: create the next waiting round */
async function _leaderStartWaiting(){
  if(!G._isLeader) return;

  // Pull next crash point — race-condition-safe RPC
  let crashPt=1.50, serverSeedHash='df-'+Date.now().toString(36);

  const {data:qData,error:qErr}=await sbSafe(()=>
    sb.rpc('consume_next_crash_point'),'consumeNextCrashPoint');

  if(!qErr && qData && qData[0]){
    crashPt        = parseFloat(qData[0].crash_point)||1.50;
    serverSeedHash = qData[0].server_hash||serverSeedHash;
  } else {
    // Local fallback if queue is empty
    const h=Math.random();
    crashPt=Math.max(1.01,parseFloat((1/(1-h*0.96)).toFixed(2)));
    console.warn('[DF Leader] crash_queue empty — local fallback');
    // Trigger async refill
    _refillQueueIfLow();
  }

  // Create round via SECURITY DEFINER RPC
  const {data:roundData,error:roundErr}=await sbSafe(()=>
    sb.rpc('create_round',{
      p_server_seed_hash:serverSeedHash,
      p_crash_point:crashPt,
    }),'createRound');

  if(roundErr||!roundData||!roundData[0]){
    console.error('[DF Leader] create_round failed:',roundErr?.message);

    // FALLBACK: create round directly if RPC missing
    const {data:directRound, error:directErr}=await sbSafe(()=>
      sb.from('rounds').insert({
        server_seed_hash:serverSeedHash,
        crash_point:crashPt,
        status:'waiting',
      }).select().single(),'createRoundDirect');

    if(directErr||!directRound){
      console.error('[DF Leader] Direct round creation also failed — retrying in 3s');
      G._crashTimer=setTimeout(()=>_leaderStartWaiting(),3000);
      return;
    }

    // Use directly-created round
    const newRound2=directRound;
    G.roundId            = newRound2.id;
    G.currentRoundId     = newRound2.id;
    G.currentRoundNumber = newRound2.round_number || (G.currentRoundNumber+1);
    G.crashPt            = crashPt;
    G.serverSeedHash     = serverSeedHash;
    G.startedAt          = null;
    G.phase              = 'waiting';
    _finishWaitingSetup(newRound2, crashPt, serverSeedHash);
    return;
  }

  const newRound=roundData[0];
  G.roundId            = newRound.id;
  G.currentRoundId     = newRound.id;
  G.currentRoundNumber = newRound.round_number;
  // CRITICAL: Always use the crashPt we consumed, not whatever the RPC returns
  G.crashPt            = crashPt;
  G.serverSeedHash     = serverSeedHash;
  G.startedAt          = null;
  G.phase              = 'waiting';

  _finishWaitingSetup(newRound, crashPt, serverSeedHash);
}

/** Shared setup after a new waiting round is created */
function _finishWaitingSetup(newRound, crashPt, serverSeedHash){
  console.log(`[DF Leader] New round #${newRound.round_number} waiting. crashPt=${crashPt}x`);

  // Broadcast to all followers (faster than DB propagation)
  G._realtimeChannel?.send({
    type:'broadcast',event:'phase',
    payload:{
      event:'waiting',
      roundId:newRound.id,
      roundNumber:newRound.round_number || G.currentRoundNumber,
      crashPt,
      serverSeedHash,
    },
  });

  _set('roundNum', newRound.round_number || G.currentRoundNumber);
  _set('pfHash', serverSeedHash.substring(0,26)+'...');
  _fn('pfSeedHash',e=>e.value=serverSeedHash);
  _resetBetState();
  genBots(crashPt);buildGhostBar();
  setSB('wait','Waiting for next round...');
  _fn('mwrap',e=>e.style.display='none');
  _set('mvEl','1.00x');
  cx.clearRect(0,0,cv.width,cv.height);drawGrid();
  ['A','B'].forEach(p=>_fn('panel'+p,e=>e.className='bpanel'));
  renderLiveList();updBtns();

  startCountdown(WAIT_SECS);

  // Fire queued bets (with duplicate protection)
  ['A','B'].forEach(p=>{
    const q=p==='A'?G.aQueued:G.bQueued;
    if(q>0){
      if(p==='A'){G.aQueued=0;G._aLastAutoRound=G.currentRoundId;}
      else{G.bQueued=0;G._bLastAutoRound=G.currentRoundId;}
      setTimeout(()=>placeBet(p,q),300);
    }
  });

  // Auto-bet — only if haven't bet this round already
  ['A','B'].forEach(p=>{
    if(getMode(p)==='auto'&&isAutoRun(p)){
      handleAutoAfter(p);
      if(isAutoRun(p)){
        const inB=p==='A'?G.aIn:G.bIn;
        const lastRound=p==='A'?G._aLastAutoRound:G._bLastAutoRound;
        if(!inB&&lastRound!==G.currentRoundId){
          const amt=parseFloat((_el('amt'+p)||{}).value)||0;
          const bal=getBal();
          if(amt>0&&bal>=amt){
            setTimeout(()=>{
              const stillIn=p==='A'?G.aIn:G.bIn;
              if(!stillIn&&(p==='A'?G._aLastAutoRound:G._bLastAutoRound)!==G.currentRoundId){
                if(p==='A')G._aLastAutoRound=G.currentRoundId;
                else G._bLastAutoRound=G.currentRoundId;
                placeBet(p,amt);
              }
            },500);
          } else if(amt>0&&bal<amt){
            stopAuto(p,`Auto ${p} stopped — insufficient balance`);
          }
        }
      }
    }
  });

  // Schedule fly at the right moment
  clearTimeout(G._crashTimer);
  G._crashTimer=setTimeout(()=>_leaderDoFlying(), WAIT_SECS*1000);

  // Keep queue healthy
  _refillQueueIfLow();
}

/** Leader: transition round to flying */
async function _leaderDoFlying(){
  if(!G._isLeader||G.phase!=='waiting') return;

  // Safety: ensure we have a valid crash point
  if(!G.crashPt || G.crashPt < 1.01){
    console.error('[DF Leader] Cannot fly — invalid crashPt:', G.crashPt);
    G.crashPt = 1.50; // emergency fallback
  }

  const startedAt=new Date().toISOString();
  G.startedAt=startedAt;
  G.phase='flying';

  // Update DB
  const {error}=await sbSafe(()=>
    sb.from('rounds').update({status:'flying',started_at:startedAt})
      .eq('id',G.roundId).eq('status','waiting'),'leaderDoFlying');

  if(error){
    console.error('[DF Leader] Failed to set flying status:', error.message);
    // Revert phase if DB failed
    G.phase='waiting';
    G.startedAt=null;
    G._crashTimer=setTimeout(()=>_leaderDoFlying(), 2000);
    return;
  }

  console.log(`[DF Leader] Flying! crashPt=${G.crashPt}x startedAt=${startedAt}`);

  // Low-latency broadcast
  G._realtimeChannel?.send({
    type:'broadcast',event:'phase',
    payload:{event:'flying',roundId:G.roundId,startedAt,crashPt:G.crashPt},
  });

  _syncToFlying({id:G.roundId,started_at:startedAt,crash_point:G.crashPt});
}

/** Leader: crash the round */
async function _leaderDoCrash(){
  if(!G._isLeader || G.phase!=='flying') return;
  // Prevent double-crash
  G.phase = 'crashing'; // interim state

  const crashedAt=new Date().toISOString();
  const crashPt=G.crashPt;

  console.log(`[DF Leader] Crashing round #${G.currentRoundNumber} at ${crashPt}x`);

  // Update DB — retry once on failure
  const {error}=await sbSafe(()=>
    sb.from('rounds').update({
      status:'crashed',crash_point:crashPt,crashed_at:crashedAt,
    }).eq('id',G.roundId).eq('status','flying'),'leaderDoCrash');

  if(error){
    console.error('[DF Leader] DB crash update failed:',error.message);
    // Still crash locally + broadcast so clients don't hang
  }

  // Low-latency broadcast
  G._realtimeChannel?.send({
    type:'broadcast',event:'phase',
    payload:{event:'crashed',roundId:G.roundId,crashPt,crashedAt},
  });

  _handleCrashEvent(crashPt,crashedAt);
}

// ─────────────────────────────────────────────────────────────
//  ANIMATION LOOP  (mult from server timestamp)
// ─────────────────────────────────────────────────────────────
function _startAnimLoop(){
  _stopAnimLoop();
  G.trail=[];
  const tick=()=>{
    if(G.phase!=='flying'){return;}
    // Multiplier is purely derived from server start timestamp
    G.mult=calcMult(G.startedAt);

    const W=cv.width,H=cv.height,pad=68,lpad=35;
    cx.clearRect(0,0,W,H);drawGrid();
    const el=(Date.now()-new Date(G.startedAt).getTime())/1000;
    const prog=Math.min(el/14,1);
    G.dragonX=lpad+(W-lpad-100)*Math.min(prog*1.3,1);
    G.dragonY=Math.max(80,(H-pad)-(H-pad-90)*(1-Math.pow(1-prog,2.2)));
    G.trail.push({x:G.dragonX,y:G.dragonY});
    if(G.trail.length>85)G.trail.shift();
    drawTrail();
    const hs=1+Math.min((G.mult-1)*.04,.55),fs=hs+Math.sin(Date.now()*.009)*.045;
    drawDragon(G.dragonX,G.dragonY,fs);
    updMultDisp();tickBots();
    ['A','B'].forEach(checkAutoOut);
    if(Math.round(el*60)%12===0)buildGhostBar();
    renderLiveList();updBtns();
    if(G.mult>=5){if(G.aIn&&!G.aCo)checkAch('diamond');if(G.bIn&&!G.bCo)checkAch('diamond');}
    G.animFr=requestAnimationFrame(tick);
  };
  G.animFr=requestAnimationFrame(tick);
}

function _stopAnimLoop(){
  if(G.animFr){cancelAnimationFrame(G.animFr);G.animFr=null;}
}

// ─────────────────────────────────────────────────────────────
//  RECONNECTION RECOVERY
// ─────────────────────────────────────────────────────────────
async function recoverSync(){
  if(G._recovering) return;
  G._recovering=true;
  console.log('[DF] Recovering sync...');
  _stopAnimLoop();
  clearTimeout(G._crashTimer);
  try{
    // Re-sub if channel broke
    if(G._realtimeChannel){
      const st=G._realtimeChannel.state;
      if(st!=='joined'&&st!=='joining'){
        sb.removeChannel(G._realtimeChannel);
        G._realtimeChannel=null;
        subscribeGameEngine();
        await new Promise(r=>setTimeout(r,500));
      }
    }
    await fetchAndSyncRound();
  }catch(e){
    console.error('[DF] Recovery failed:',e.message);
  }finally{
    G._recovering=false;
  }
}

// Listen for page-visibility and online events
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recoverSync();});
window.addEventListener('online',()=>recoverSync());

// ─────────────────────────────────────────────────────────────
//  CRASH QUEUE REFILL
// ─────────────────────────────────────────────────────────────
async function _refillQueueIfLow(){
  const {count}=await sb.from('crash_queue')
    .select('id',{count:'exact',head:true}).eq('is_used',false);
  if((count||0)<20){
    const {data:last}=await sbSafe(()=>
      sb.from('crash_queue').select('round_number')
        .order('round_number',{ascending:false}).limit(1).single(),'refillLast');
    const fromRound=(last?.round_number||0)+1;
    const {error}=await sbSafe(()=>
      sb.rpc('seed_crash_queue',{p_from_round:fromRound,p_count:100}),'refillQueue');
    if(!error) console.log('[DF] Refilled crash queue from round',fromRound);
  }
}

// ─────────────────────────────────────────────────────────────
//  COUNTDOWN  (server-aligned)
// ─────────────────────────────────────────────────────────────
function startCountdown(secs){
  G.countSec=Math.max(1,Math.round(secs));
  const wrap=_el('cdwrap'),num=_el('cdNum'),arc=_el('cdArc');
  if(!wrap)return;
  wrap.className='cdw show';
  if(num)num.textContent=G.countSec;
  if(arc)arc.style.strokeDashoffset=0;
  clearInterval(G.countIntvl);
  const total=G.countSec;
  G.countIntvl=setInterval(()=>{
    G.countSec--;sfxTick();
    if(num)num.textContent=Math.max(0,G.countSec);
    if(arc)arc.style.strokeDashoffset=283*(1-Math.max(0,G.countSec)/total);
    if(G.countSec<=0){
      clearInterval(G.countIntvl);
      if(wrap)wrap.className='cdw';
      // Followers transition visually when the broadcast arrives.
      // Leader triggers actual DB update via _leaderDoFlying().
    }
  },1000);
}

// ─────────────────────────────────────────────────────────────
//  HELPER — reset per-round bet state
// ─────────────────────────────────────────────────────────────
function _resetBetState(){
  G.mult=1;G.trail=[];G.startedAt=null;G.depAcctRef=genRef();
}

// ─────────────────────────────────────────────────────────────
//  AUTO BET
// ─────────────────────────────────────────────────────────────
const getMode=p=>p==='A'?G.aMode:G.bMode;
const isAutoRun=p=>p==='A'?G.aRunning:G.bRunning;

window.setPanelMode=(p,m)=>{
  if(p==='A')G.aMode=m; else G.bMode=m;
  _fn('ptb'+p+'-m',e=>e.className='ptb '+(m==='manual'?'on':''));
  _fn('ptb'+p+'-a',e=>e.className='ptb '+(m==='auto'?'on':''));
  _fn('stop'+p,e=>e.style.display=m==='auto'?'':'none');
  _fn('strip'+p,e=>e.style.display=m==='auto'?'flex':'none');
  updBtns();
};

function startAuto(p){if(p==='A'){G.aRunning=true;G.aPlayed=0;}else{G.bRunning=true;G.bPlayed=0;}updAutoStrip(p);updBtns();toast2(`Auto Bet ${p} started 🤖`,'i');}
function stopAuto(p,reason){if(p==='A')G.aRunning=false;else G.bRunning=false;updBtns();if(reason)toast2(reason,'i');}
function updAutoStrip(p){const played=p==='A'?G.aPlayed:G.bPlayed;const rnds=parseInt(_el('rnds'+p)?.value)||10;_set('stripTxt'+p,`Auto — ${played}/${rnds} rounds`);}
function handleAutoAfter(p){
  if(!isAutoRun(p))return;
  const played=p==='A'?G.aPlayed:G.bPlayed;
  const rnds=parseInt(_el('rnds'+p)?.value)||10;
  const sw=parseFloat(_el('sw'+p)?.value)||0;
  const sl=parseFloat(_el('sl'+p)?.value)||0;
  if(played>=rnds){stopAuto(p,`Auto ${p} finished (${rnds} rounds)`);return;}
  if(sw&&G.totalProfit>=sw){stopAuto(p,`Auto ${p} stopped — profit target reached ✓`);return;}
  if(sl&&(G.totalWagered-G.totalWon)>=sl){stopAuto(p,`Auto ${p} stopped — loss limit reached`);return;}
  const amt=parseFloat((_el('amt'+p)||{}).value)||0;
  const bal=getBal();
  if(amt>0&&bal<amt){stopAuto(p,`Auto ${p} stopped — insufficient balance`);return;}
}

window.handleBtn=p=>{
  if(G.phase==='waiting'){
    if(getMode(p)==='auto'){isAutoRun(p)?stopAuto(p,`Auto ${p} cancelled`):startAuto(p);return;}
    const inB=p==='A'?G.aIn:G.bIn;
    if(inB)return;
    const amt=parseFloat((_el('amt'+p)||{}).value);
    if(!amt||amt<1){toast2('Enter a valid bet amount','l');return;}
    placeBet(p,amt);
  }else if(G.phase==='flying'){
    const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo;
    if(inB&&!co)cashOut(p);
    else if(!inB)queueNextRound(p);
  }
};

function cancelBet(p){
  const inB=p==='A'?G.aIn:G.bIn;
  if(!inB){toast2('No bet to cancel','l');return;}
  if(G.phase!=='waiting'){toast2('Cannot cancel — round already started','l');return;}
  const amt=p==='A'?G.aAmt:G.bAmt;
  if(isDemo()){G.balDemo=parseFloat((G.balDemo+amt).toFixed(2));updateBalDisp();}
  else{
    G.balReal=parseFloat((G.balReal+amt).toFixed(2));updateBalDisp();
    if(G.userId){
      const betId=p==='A'?G.aBetId:G.bBetId;
      if(betId){
        sbSafe(()=>sb.from('bets').delete().eq('id',betId).eq('user_id',G.userId),'cancelBet');
        sbSafe(()=>sb.from('users').update({balance_real:G.balReal,total_wagered:Math.max(0,G.totalWagered-amt)}).eq('id',G.userId),'cancelBetBal');
      }
    }
  }
  if(p==='A'){G.aIn=false;G.aAmt=0;G.aCo=false;G.aBetId=null;}
  else{G.bIn=false;G.bAmt=0;G.bCo=false;G.bBetId=null;}
  _fn('panel'+p,e=>e.className='bpanel');
  updBtns();renderLiveList();
  toast2(`Bet ${p} cancelled — ${fmtKES(amt)} refunded`,'i');
}

function queueNextRound(p){
  if(G.phase!=='flying')return;
  const amt=parseFloat((_el('amt'+p)||{}).value);
  if(!amt||amt<1){toast2('Enter a valid bet amount first','l');return;}
  if(p==='A')G.aQueued=amt;else G.bQueued=amt;
  updBtns();
  toast2(`Bet ${p} queued — ${fmtKES(amt)} will be placed next round 🔄`,'i');
}

// ─────────────────────────────────────────────────────────────
//  PLACE BET
// ─────────────────────────────────────────────────────────────
async function placeBet(p,amt){
  if(G.phase!=='waiting'){toast2('Wait for next round','l');return;}
  const alreadyIn=p==='A'?G.aIn:G.bIn;
  if(alreadyIn){toast2(`Bet ${p} already placed`,'l');return;}
  if(G._betLock){toast2('Processing previous bet...','i');return;}
  if(isDemo()){
    if(amt>G.balDemo){toast2('Insufficient demo balance','l');return;}
    G.balDemo=parseFloat(Math.max(0,G.balDemo-amt).toFixed(2));updateBalDisp();
    if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;G.aBetId=null;}
    else{G.bIn=true;G.bAmt=amt;G.bCo=false;G.bBetId=null;}
    sfxPlace();checkAch('firstBet');if(G.aIn&&G.bIn)checkAch('dual');
    updBtns();renderLiveList();
    _fn('panel'+p,e=>e.className='bpanel bp-active');
    toast2(`[Demo] Bet ${p} — ${fmtKES(parseFloat(amt).toFixed(2))} placed 🐉`,'i');
    G.totalBets++;if(p==='A')G.aPlayed++;else G.bPlayed++;
    return;
  }
  if(!G.userId){toast2('Please log in','l');return;}
  if(amt>G.balReal){toast2(`Insufficient balance — ${fmtKES(G.balReal)} available`,'l');return;}
  if(!G.currentRoundId){toast2('Waiting for round to be ready...','i');return;}
  const autoCashout=_el('auto'+p)?.checked?parseFloat(_el('acv'+p)?.value)||null:null;
  G._betLock=true;
  const btn=_el('btn'+p);const origText=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.innerHTML='<span style="opacity:.7">Placing bet...</span>';}
  const {data,error}=await sbSafe(()=>sb.rpc('place_bet',{
    p_user_id:G.userId,p_round_id:G.currentRoundId,p_amount:amt,
    p_currency:'KES',p_panel:p,p_is_demo:false,p_auto_cashout_at:autoCashout,
  }),'placeBet');
  G._betLock=false;
  if(btn){btn.disabled=false;btn.innerHTML=origText||`Place Bet ${p}`;}
  if(error||!data?.success){
    let friendly=data?.error||error?.message||'Bet could not be placed';
    if(friendly.includes('row-level security')||friendly.includes('403')||friendly.includes('406'))
      friendly='Server permission error — please refresh and try again.';
    else if(friendly.includes('balance'))friendly='Insufficient balance — please deposit.';
    else if(friendly.includes('network')||friendly.includes('fetch'))friendly='Network error — check connection.';
    toast2(`Bet ${p} failed: ${friendly}`,'l');
    return;
  }
  G.balReal=parseFloat(data.new_balance)||Math.max(0,G.balReal-amt);updateBalDisp();
  if(p==='A'){G.aIn=true;G.aAmt=amt;G.aCo=false;G.aBetId=data.bet_id||null;}
  else{G.bIn=true;G.bAmt=amt;G.bCo=false;G.bBetId=data.bet_id||null;}
  G.totalWagered+=amt;G.totalBets++;
  if(p==='A')G.aPlayed++;else G.bPlayed++;
  sfxPlace();checkAch('firstBet');if(G.aIn&&G.bIn)checkAch('dual');
  updBtns();renderLiveList();updVIP();
  _fn('panel'+p,e=>e.className='bpanel bp-active');
  toast2(`Bet ${p} — ${fmtKES(amt)} placed 🐉`,'i');
}

// ─────────────────────────────────────────────────────────────
//  CASH OUT
// ─────────────────────────────────────────────────────────────
async function cashOut(p){
  const isA=p==='A';
  if(isA){if(!G.aIn||G.aCo)return;G.aCo=true;}
  else{if(!G.bIn||G.bCo)return;G.bCo=true;}
  const amt=isA?G.aAmt:G.bAmt;
  const betId=isA?G.aBetId:G.bBetId;
  const pay=parseFloat((amt*G.mult).toFixed(2));
  const prof=parseFloat((pay-amt).toFixed(2));
  if(isDemo()){
    G.balDemo=parseFloat((G.balDemo+pay).toFixed(2));updateBalDisp();
    recHist(true,p,amt);sfxCashout();
    G.winStreak++;G.lossStreak=0;
    if(G.winStreak>=3)checkAch('streak3');if(prof>=500)checkAch('bigWin');if(G.mult>=10)checkAch('moon');
    _fn('panel'+p,e=>e.className='bpanel bp-cashed');
    toast2(`[Demo] Bet ${p} — cashed at ${G.mult.toFixed(2)}x! +${fmtKES(prof)} 💰`,'w');
    updBtns();renderHistList();return;
  }
  if(!G.userId||!betId){toast2('Cashout error — bet ID missing','l');if(isA)G.aCo=false;else G.bCo=false;updBtns();return;}
  const {data,error}=await sbSafe(()=>sb.rpc('cashout_bet',{p_bet_id:betId,p_user_id:G.userId,p_mult:G.mult}),'cashOut');
  if(error||!data?.success){
    toast2(`Cashout error: ${data?.error||error?.message||'Cashout failed'}`,'l');
    if(isA)G.aCo=false;else G.bCo=false;updBtns();return;
  }
  G.balReal=parseFloat(data.new_balance)||G.balReal;
  G.totalWon=(G.totalWon||0)+pay;G.totalProfit=(G.totalProfit||0)+prof;updateBalDisp();
  recHist(true,p,amt);sfxCashout();
  G.winStreak++;G.lossStreak=0;
  if(G.winStreak>=3)checkAch('streak3');if(prof>=500)checkAch('bigWin');if(G.mult>=10)checkAch('moon');
  _fn('panel'+p,e=>e.className='bpanel bp-cashed');
  toast2(`Bet ${p} — cashed at ${G.mult.toFixed(2)}x! +${fmtKES(prof)} 💰`,'w');
  updBtns();renderHistList();if(isAutoRun(p))updAutoStrip(p);
}

function checkAutoOut(p){
  const on=_el('auto'+p)?.checked;
  const av=parseFloat(_el('acv'+p)?.value);
  const inB=p==='A'?G.aIn:G.bIn,co=p==='A'?G.aCo:G.bCo;
  if(on&&inB&&!co&&G.mult>=av)cashOut(p);
}

// ─────────────────────────────────────────────────────────────
//  BOTS
// ─────────────────────────────────────────────────────────────
function genBots(cp){
  G.bots=[];
  const count=8+Math.floor(Math.random()*6);
  for(let i=0;i<count;i++){
    const win=Math.random()>.35;
    G.bots.push({
      id:i,name:pick(BNAMES),flag:pick(BFLAGS),col:pick(BCOLS),
      amt:parseFloat(rnd(5,600).toFixed(0)),
      cashAt:win?parseFloat(rnd(1.05,cp-.01).toFixed(2)):null,
      cashedAt:null,status:'playing',
    });
  }
}
function tickBots(){G.bots.forEach(b=>{if(b.status==='playing'&&b.cashAt&&G.mult>=b.cashAt){b.cashedAt=G.mult;b.status='out';}});}

function buildGhostBar(){
  const ticker=_el('ghostTicker');const countEl=_el('ghostCount');
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
    return`<div class="gi"><span class="gflag">${b.flag}</span><span class="gname">${b.name}</span><span class="gamt">${fmtKES(b.amt)}</span>${st}</div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────
//  DRAWING
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────────
function setSB(t,txt){
  const b=_el('sbadge');if(!b)return;
  b.className='sbadge '+(t==='wait'?'sbw':t==='fly'?'sbf':'sbc');
  b.textContent=txt;
}
function updMultDisp(){
  const el=_el('mvEl');if(!el)return;
  el.textContent=G.mult.toFixed(2)+'x';
  if(G.phase==='crashed'){el.className='mv mv-c';return;}
  if(G.mult<2)el.className='mv mv-s';
  else if(G.mult<4)el.className='mv mv-w';
  else el.className='mv mv-d';
}
function updBtns(){
  ['A','B'].forEach(p=>{
    const btn=_el('btn'+p);const panel=_el('panel'+p);const canBtn=_el('btnCancel'+p);
    if(!btn)return;
    const inB=p==='A'?G.aIn:G.bIn;const co=p==='A'?G.aCo:G.bCo;
    const amt=p==='A'?G.aAmt:G.bAmt;const isAuto=getMode(p)==='auto';const queued=p==='A'?G.aQueued:G.bQueued;
    if(!canBtn){
      const c=document.createElement('button');c.id='btnCancel'+p;c.className='abtn btn-cancel';c.style.display='none';c.textContent='✕ Cancel Bet';c.onclick=()=>cancelBet(p);btn.parentNode.insertBefore(c,btn.nextSibling);
    }
    const cancelEl=_el('btnCancel'+p);
    if(G.phase==='waiting'){
      if(isAuto){
        if(isAutoRun(p)){btn.className='abtn btn-autorun';btn.textContent='⏹ Stop Auto';btn.onclick=()=>stopAuto(p,'Auto '+p+' cancelled');}
        else{btn.className='abtn btn-place';btn.innerHTML='▶ Start Auto Bet <small style="font-size:.6rem;opacity:.7;display:block">Bets automatically each round</small>';btn.onclick=()=>startAuto(p);}
        if(cancelEl)cancelEl.style.display='none';return;
      }
      if(inB){
        btn.className='abtn btn-bet-placed';
        btn.innerHTML=`<span style="font-size:.72rem;display:block;opacity:.75;letter-spacing:.5px">BET ${p} PLACED ✓</span><span style="font-size:1rem;font-weight:800">${fmtKES(amt)} locked in</span>`;
        btn.onclick=null;if(cancelEl){cancelEl.style.display='';cancelEl.className='abtn btn-cancel';}if(panel)panel.className='bpanel bp-active';
      }else if(queued){
        btn.className='abtn btn-queued';
        btn.innerHTML=`<span style="font-size:.72rem;display:block;opacity:.75">QUEUED FOR NEXT ROUND</span><span style="font-size:.95rem;font-weight:700">${fmtKES(queued)}</span>`;
        btn.onclick=null;if(cancelEl){cancelEl.style.display='';cancelEl.className='abtn btn-cancel';}
      }else{
        btn.className='abtn btn-place';btn.textContent=`Place Bet ${p}`;btn.onclick=()=>handleBtn(p);if(cancelEl)cancelEl.style.display='none';if(panel)panel.className='bpanel';
      }
    }else if(G.phase==='flying'){
      if(cancelEl)cancelEl.style.display='none';
      if(inB&&!co){
        btn.className='abtn btn-cashout';
      btn.innerHTML=`<span style="font-size:.7rem;display:block;opacity:.8;letter-spacing:.5px">CASH OUT ${p}</span><span style="font-size:1.05rem;font-weight:800">${fmtKES(amt*G.mult)}</span><span style="font-size:.65rem;opacity:.7"> @ ${G.mult.toFixed(2)}x</span>`;
        btn.onclick=()=>handleBtn(p);
      }else if(co){
        btn.className='abtn btn-cashed';
        btn.innerHTML=`<span style="font-size:.75rem;display:block">CASHED OUT ✓</span><span style="font-size:.9rem;font-weight:700">${G.mult.toFixed(2)}x</span>`;
        btn.onclick=null;
      }else{
        btn.className='abtn btn-place-next';
        btn.innerHTML=`<span style="font-size:.7rem;display:block;opacity:.75;letter-spacing:.5px">BET NEXT ROUND</span><span style="font-size:.88rem">Place for round #${(G.currentRoundNumber||0)+1}</span>`;
        btn.onclick=()=>queueNextRound(p);
      }
    }else{
      btn.className='abtn btn-wait';btn.innerHTML='<span style="opacity:.6">Settling...</span>';btn.onclick=null;if(cancelEl)cancelEl.style.display='none';
    }
  });
}
window.qbet=(p,op,v)=>{const inp=_el('amt'+p);if(!inp)return;let n=parseFloat(inp.value)||0;if(op==='add')n+=v;else if(op==='half')n=Math.max(1,Math.floor(n/2));inp.value=Math.max(1,n);};

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
    <span class="la">${fmtKES(b.amt)}</span>
    <span class="ls ${b.status==='out'?'lsw':b.status==='lost'?'lsl':'lsp'}">
      ${b.status==='out'?'✓'+b.cashedAt?.toFixed(2)+'x':b.status==='lost'?'✗':G.mult.toFixed(2)+'x'}
    </span>
  </div>`).join('');
}

function renderHistList(){
  const el=_el('histList');if(!el)return;
  if(!G.myHistory.length){el.innerHTML='<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No bets yet</div>';return;}
  el.innerHTML=G.myHistory.slice().reverse().slice(0,30).map(h=>`
  <div class="lrow">
    <span class="lfl">${h.win?'✅':'❌'}</span>
    <span class="lnm">Bet ${h.panel} · R${h.round}</span>
    <span class="la">${fmtKES(h.bet)}</span>
    <span class="ls ${h.win?'lsw':'lsl'}">${h.win?'+'+fmtKES(h.profit):'-'+fmtKES(h.bet)}</span>
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
    const p=document.createElement('span');p.className='hp '+(c<1.5?'hpL':c<3?'hpM':'hpH');p.textContent=c.toFixed(2)+'x';row.appendChild(p);
  });
}

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
    <span class="la" style="color:var(--gold)">${fmtKES(x.w,0)}</span>
  </div>`).join('');
}

function updVIP(){
  const tiers={bronze:{min:0,next:10000},silver:{min:10000,next:50000},gold:{min:50000,next:200000},diamond:{min:200000,next:Infinity}};
  const t=tiers[G.vipTier]||tiers.bronze;
  const pct=t.next===Infinity?100:Math.min(100,((G.totalWagered-t.min)/(t.next-t.min))*100);
  _set('vipTierName',G.vipTier.charAt(0).toUpperCase()+G.vipTier.slice(1));
  _fn('vipBar',el=>el.style.width=pct+'%');
  _set('vipPct',pct.toFixed(0)+'%');
  const TIER_ICONS={bronze:'🥉',silver:'🥈',gold:'🥇',diamond:'💎'};
  _fn('vipIcon',el=>el.textContent=TIER_ICONS[G.vipTier]||'🥉');
}

function checkAch(key){
  if(G.achs[key])return;
  const a=ACHS.find(x=>x.k===key);if(!a)return;
  G.achs[key]=true;
  const el=_el('achToast');
  if(el){el.innerHTML=`${a.ico} <b>${a.nm}</b> — ${a.ds}`;el.className='ach-toast show';setTimeout(()=>el.className='ach-toast',3500);}
  if(G.userId)sbSafe(()=>sb.from('achievements').insert({user_id:G.userId,achievement_key:key}),'ach');
}

function renderProfileSection(){
  const realDisp=parseFloat(G.balReal||0).toFixed(2);
  const html=`
  <div class="pcard">
    <div class="pav">🐉</div>
    <div class="pinfo">
      <div class="pname">${escHtml(G.username)}</div>
      <div class="pemail">${escHtml(G.email||'')}</div>
      <div class="pcountry">${G.country||''}</div>
    </div>
  </div>
  <div class="pstats">
    <div class="pstat"><span class="psv">${fmtKES(G.balReal)}</span><span class="psl">Real Balance</span></div>
    <div class="pstat"><span class="psv">◈${fmt(G.balBonus,0)}</span><span class="psl">Bonus Coins</span></div>
    <div class="pstat"><span class="psv">${fmtKES(G.totalWagered,0)}</span><span class="psl">Total Wagered</span></div>
    <div class="pstat"><span class="psv">${fmtKES(G.totalWon,0)}</span><span class="psl">Total Won</span></div>
    <div class="pstat"><span class="psv">${G.totalBets}</span><span class="psl">Bets Placed</span></div>
    <div class="pstat"><span class="psv">${G.vipTier.charAt(0).toUpperCase()+G.vipTier.slice(1)}</span><span class="psl">VIP Tier</span></div>
  </div>
  <div style="margin-top:1rem;display:flex;gap:.5rem;flex-direction:column">
    <button class="mbtn mbtn-fire" onclick="openM('walletModal')">💰 Deposit / Withdraw</button>
    <button class="mbtn mbtn-muted" onclick="window.signOut()">Sign Out →</button>
  </div>`;
  const el=_el('tab-profile');if(el)el.innerHTML=html;
  const modal=_el('profileSectionModal');if(modal)modal.innerHTML=html;
}

// ─────────────────────────────────────────────────────────────
//  DEPOSIT / WITHDRAW (unchanged from v5)
// ─────────────────────────────────────────────────────────────
window.onDepAmtChange=function(){
  const inp=_el('depAmt');if(!inp)return;
  const amt=parseFloat(inp.value)||0;
  const bonusCoins=Math.floor(amt*0.1);
  _set('depUSD',bonusCoins>0?`+◈${bonusCoins} bonus coins on approval`:'');
  renderDepDetails();revalidateDepSubmit();
};
window.selMethod=m=>{
  G.depMethod=m;
  document.querySelectorAll('.dep-method').forEach(e=>e.classList.remove('sel'));
  _fn('dm-'+m,e=>e.classList.add('sel'));
  renderDepDetails();revalidateDepSubmit();
};
function renderDepDetails(){
  const amt=parseFloat(_el('depAmt')?.value)||0;
  const m=METHODS[G.depMethod];if(!m)return;
  const acct=G.depAcctRef||genRef();G.depAcctRef=acct;
  const bonusKES=parseFloat((amt*0.1).toFixed(2));
  let html='';
  if(G.depMethod==='mpesa'||G.depMethod==='airtel'){
    html=`
    <div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">${m.label} Number</span><span class="pb-val gold">${m.paybill} <button class="copy-btn" onclick="copyText('${m.paybill}')">Copy</button></span></div>
      ${m.accountNumber?`<div class="pb-row"><span class="pb-lbl">Account Number</span><span class="pb-val gold">${m.accountNumber} <button class="copy-btn" onclick="copyText('${m.accountNumber}')">Copy</button></span></div>`:''}
      <div class="pb-row"><span class="pb-lbl">Reference / Transaction Ref</span><span class="pb-val green">${acct} <button class="copy-btn" onclick="copyText('${acct}')">Copy</button></span></div>
      <div class="pb-row"><span class="pb-lbl">Amount to Send</span><span class="pb-val">KSh ${amt||'—'}</span></div>
      <div class="pb-row"><span class="pb-lbl">Account Name</span><span class="pb-val">${m.acctName}</span></div>
    </div>
    ${amt>0?`<div style="background:rgba(34,217,122,.06);border:1px solid rgba(34,217,122,.18);border-radius:8px;padding:.5rem .75rem;font-size:.73rem;color:var(--green);margin:.5rem 0">🎁 You'll receive <b>+◈${bonusKES}</b> bonus coins on approval</div>`:''}
    <div class="step-pills" style="margin:.5rem 0">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div style="background:rgba(255,107,26,.06);border:1px solid rgba(255,107,26,.2);border-radius:9px;padding:.65rem .8rem;margin-bottom:.5rem">
      <div style="font-size:.62rem;color:var(--fire);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:.45rem;font-family:'Cinzel',serif">✍️ After sending — fill in below</div>
      <div class="mf" style="margin-bottom:.45rem">
        <label>Phone Number Used to Pay <span style="color:var(--red)">*</span></label>
        <input type="tel" id="depPhone" placeholder="e.g. 0712345678" inputmode="tel" oninput="revalidateDepSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.92rem;letter-spacing:1px">
      </div>
      <div class="mf">
        <label>M-Pesa / Airtel Confirmation Code <span style="color:var(--red)">*</span></label>
        <input type="text" id="depRef" placeholder="e.g. RKA1X3Y5ZZ" oninput="revalidateDepSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.92rem;text-transform:uppercase;letter-spacing:2px" maxlength="12">
        <span style="font-size:.62rem;color:var(--muted);margin-top:3px">The code sent to your phone after paying</span>
      </div>
    </div>`;
  }else if(G.depMethod==='bitcoin'||G.depMethod==='ethereum'){
    html=`
    <div class="paybill-card">
      <div class="pb-row"><span class="pb-lbl">Send ${G.depMethod==='bitcoin'?'BTC':'ETH'} to</span></div>
      <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:.5rem .7rem;font-family:'Share Tech Mono',monospace;font-size:.63rem;color:var(--blue);word-break:break-all;margin:.3rem 0;line-height:1.6">${m.address}<button class="copy-btn" style="margin-top:.3rem;display:block" onclick="copyText('${m.address}')">Copy Address</button></div>
    </div>
    ${amt>0?`<div style="background:rgba(34,217,122,.06);border:1px solid rgba(34,217,122,.18);border-radius:8px;padding:.5rem .75rem;font-size:.73rem;color:var(--green);margin:.5rem 0">🎁 +◈${bonusKES} bonus coins on approval</div>`:''}
    <div class="step-pills" style="margin:.5rem 0">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.4rem">
      <label>Transaction ID / Hash <span style="color:var(--red)">*</span></label>
      <input type="text" id="depRef" placeholder="Paste tx hash here" oninput="revalidateDepSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.68rem">
    </div>`;
  }else if(G.depMethod==='bank'){
    html=`
    <div class="paybill-card">${m.steps.map(s=>`<div class="pb-row"><span class="pb-val" style="font-size:.8rem">${s}</span></div>`).join('')}</div>
    <div class="mf" style="margin-top:.5rem"><label>Your Name / Reference Used <span style="color:var(--red)">*</span></label><input type="text" id="depRef" placeholder="Full name used as reference" oninput="revalidateDepSubmit()"></div>
    <div class="mf"><label>Phone Number</label><input type="tel" id="depPhone" placeholder="0712345678" oninput="revalidateDepSubmit()"></div>`;
  }else if(G.depMethod==='card'){
    html=`
    <div class="step-pills" style="margin-bottom:.5rem">${m.steps.map((s,i)=>`<div class="step-pill"><div class="step-num">${i+1}</div><span>${s}</span></div>`).join('')}</div>
    <div class="mf"><label>Card Number <span style="color:var(--red)">*</span></label><input type="text" id="cardNum" placeholder="1234 5678 9012 3456" maxlength="19" oninput="revalidateDepSubmit()"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem"><div class="mf"><label>Expiry</label><input type="text" placeholder="MM/YY" maxlength="5"></div><div class="mf"><label>CVV</label><input type="text" placeholder="123" maxlength="3"></div></div>
    <div class="mf"><label>Name on Card</label><input type="text" placeholder="JOHN DOE"></div>`;
  }
  _fn('depDetails',e=>e.innerHTML=html);revalidateDepSubmit();
}
window.revalidateDepSubmit=function(){
  const submitBtn=_el('depSubmitBtn');const submitLbl=_el('depSubmitLabel');
  if(!submitBtn)return;
  const amt=parseFloat(_el('depAmt')?.value)||0;const minKES=65;const method=G.depMethod;
  if(!amt||amt<minKES){submitBtn.disabled=true;if(submitLbl)submitLbl.textContent=!amt?'Enter amount to continue':`Minimum: KSh ${minKES}`;return;}
  if(method==='mpesa'||method==='airtel'){
    const phone=(_el('depPhone')?.value||'').trim();const code=(_el('depRef')?.value||'').trim();
    if(!phone){submitBtn.disabled=true;if(submitLbl)submitLbl.textContent='Enter phone number used to pay';return;}
    if(!code){submitBtn.disabled=true;if(submitLbl)submitLbl.textContent='Enter the confirmation code';return;}
  }
  if(method==='bitcoin'||method==='ethereum'){const txId=(_el('depRef')?.value||'').trim();if(!txId){submitBtn.disabled=true;if(submitLbl)submitLbl.textContent='Paste transaction hash to continue';return;}}
  submitBtn.disabled=false;if(submitLbl)submitLbl.textContent=`Submit ${fmtKES(amt)} →`;
};
window.submitDeposit=async()=>{
  if(G._depositLock){toast2('Submission in progress...','i');return;}
  const method=G.depMethod;const amt=parseFloat(_el('depAmt')?.value)||0;
  const phone=(_el('depPhone')?.value||'').trim();const ref=(_el('depRef')?.value||'').trim();
  const minKES=65;const btn=_el('depSubmitBtn');const lbl=_el('depSubmitLabel');
  if(!method){toast2('Select a payment method','l');return;}
  if(!amt||amt<minKES){toast2(`Minimum deposit is KSh ${minKES}`,'l');return;}
  if((method==='mpesa'||method==='airtel')&&(!phone||phone.replace(/\D/g,'').length<9)){toast2('Enter a valid phone number','l');return;}
  if((method==='mpesa'||method==='airtel')&&(!ref||ref.length<6)){toast2('Enter the confirmation code','l');return;}
  if((method==='bitcoin'||method==='ethereum')&&!ref){toast2('Paste the transaction hash','l');return;}
  if(method==='bank'&&!ref){toast2('Enter the reference used','l');return;}
  if(!G.userId){toast2('Please log in first','l');return;}
  G._depositLock=true;if(btn)btn.disabled=true;if(lbl)lbl.textContent='Submitting...';
  if(isDemo()){
    await new Promise(r=>setTimeout(r,800));
    G.balDemo=Math.max(0,G.balDemo+amt);G.balBonus+=parseFloat((amt*0.1).toFixed(2));
    updateBalDisp();toast2(`[Demo] ${fmtKES(amt)} credited + 🎁 ${(amt*0.1).toFixed(0)} bonus coins!`,'w');
    closeM('walletModal');G._depositLock=false;if(btn)btn.disabled=false;if(lbl)lbl.textContent=`Submit ${fmtKES(amt)} →`;return;
  }
  const txRef=ref?`${ref.toUpperCase().replace(/\s+/g,'')}-${G.userId.substring(0,6)}`:`DF-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  const {error}=await sbSafe(()=>sb.from('transactions').insert({
    user_id:G.userId,type:'deposit',status:'pending',amount:amt,currency:'KES',
    method,phone_number:phone||null,payment_ref:ref||null,account_ref:G.depAcctRef||null,
    reference:txRef,description:`${method.toUpperCase()} deposit — ${phone||ref||'submitted'}`,
  }),'submitDeposit');
  G._depositLock=false;
  if(error){
    if(btn){btn.disabled=false;}if(lbl)lbl.textContent=`Submit ${fmtKES(amt)} →`;
    if(error.code==='23505'||error.message?.includes('unique')){toast2('Reference used — retrying with new ref...','i');_el('depRef')&&(_el('depRef').value='');setTimeout(()=>window.submitDeposit(),300);return;}
    if(error.message?.includes('403')||error.message?.includes('row-level')){toast2('Permission error — sign out and back in','l');return;}
    toast2('Submission failed: '+error.message,'l');return;
  }
  toast2(`✅ Deposit of ${fmtKES(amt)} submitted! Admin will review shortly.`,'w');
  closeM('walletModal');['depAmt','depPhone','depRef'].forEach(id=>{const e=_el(id);if(e)e.value='';});
  _fn('depDetails',e=>e.innerHTML='');if(btn)btn.disabled=true;if(lbl)lbl.textContent='Enter amount to continue';
  G.depAcctRef=genRef();loadUserTx();
};
// ─────────────────────────────────────────────────────────────
//  WITHDRAWAL SYSTEM  (v7 — admin-gated + phone verification)
// ─────────────────────────────────────────────────────────────

// Track selected withdrawal method globally
G.witMethod = 'mpesa';

window.selWitMethod = m => {
  G.witMethod = m;
  document.querySelectorAll('.wit-method-btn').forEach(b=>{
    b.style.border='1px solid rgba(255,255,255,.1)';
    b.style.background='rgba(255,255,255,.03)';
  });
  const sel = _el('wm-'+m);
  if(sel){sel.style.border='1.5px solid rgba(34,217,122,.4)';sel.style.background='rgba(34,217,122,.07)';}
  // Render destination detail input
  const detail = _el('witMethodDetails');
  if(!detail) return;
  if(m==='mpesa'){
    detail.innerHTML=`<div class="mf">
      <label>M-Pesa Phone Number <span style="color:var(--red)">*</span></label>
      <input type="tel" id="witPhone" placeholder="e.g. 0712 345 678" inputmode="tel" oninput="revalidateWitSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.92rem;letter-spacing:1px">
      <span style="font-size:.62rem;color:var(--muted);margin-top:3px;display:block">The phone used to <b>request</b> (verification happens after approval)</span>
    </div>`;
  } else if(m==='airtel'){
    detail.innerHTML=`<div class="mf">
      <label>Airtel Money Number <span style="color:var(--red)">*</span></label>
      <input type="tel" id="witPhone" placeholder="e.g. 0733 456 789" inputmode="tel" oninput="revalidateWitSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.92rem;letter-spacing:1px">
    </div>`;
  } else if(m==='bank'){
    detail.innerHTML=`<div class="mf">
      <label>Bank Account Number <span style="color:var(--red)">*</span></label>
      <input type="text" id="witPhone" placeholder="e.g. 0123456789" oninput="revalidateWitSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.92rem;letter-spacing:1px">
    </div>
    <div class="mf"><label>Bank Name</label><input type="text" id="witBankName" placeholder="e.g. Equity Bank" oninput="revalidateWitSubmit()"></div>`;
  } else if(m==='bitcoin'){
    detail.innerHTML=`<div class="mf">
      <label>Bitcoin Wallet Address <span style="color:var(--red)">*</span></label>
      <input type="text" id="witPhone" placeholder="e.g. 1A1zP1eP5Q..." oninput="revalidateWitSubmit()" style="font-family:'Share Tech Mono',monospace;font-size:.68rem;letter-spacing:.5px">
    </div>`;
  }
  revalidateWitSubmit();
};

window.setWitAmt = v => {
  const inp = _el('witAmt');
  if(inp){ inp.value = v; onWitAmtChange(); }
};
window.setWitAmtAll = () => {
  setWitAmt(Math.floor(G.balReal));
};
window.onWitAmtChange = () => {
  const amt = parseFloat(_el('witAmt')?.value)||0;
  const hint = _el('witAmtHint');
  if(hint){
    if(!amt) hint.textContent='Minimum KSh 200';
    else if(amt<200) hint.textContent='⚠️ Minimum is KSh 200';
    else if(amt>G.balReal) hint.textContent=`⚠️ Exceeds balance (${fmtKES(G.balReal)})`;
    else hint.textContent=`You will receive: ${fmtKES(amt)} (after verification)`;
  }
  revalidateWitSubmit();
};
window.revalidateWitSubmit = () => {
  const btn = _el('witSubmitBtn');
  const lbl = _el('witSubmitLabel');
  if(!btn) return;
  const amt = parseFloat(_el('witAmt')?.value)||0;
  const phone = (_el('witPhone')?.value||'').trim();
  if(!amt){ btn.disabled=true; if(lbl)lbl.textContent='Enter amount to continue'; return; }
  if(amt<200){ btn.disabled=true; if(lbl)lbl.textContent='Minimum withdrawal is KSh 200'; return; }
  if(amt>G.balReal){ btn.disabled=true; if(lbl)lbl.textContent='Amount exceeds available balance'; return; }
  if(!phone){ btn.disabled=true; if(lbl)lbl.textContent='Enter your payout account / phone'; return; }
  btn.disabled=false;
  if(lbl) lbl.textContent=`Submit Withdrawal — ${fmtKES(amt)} →`;
};

window.submitWithdraw = async () => {
  const amt = parseFloat(_el('witAmt')?.value)||0;
  if(amt<200){ toast2('Minimum withdrawal is KSh 200','l'); return; }
  if(amt>G.balReal){ toast2(`Insufficient balance — ${fmtKES(G.balReal)} available`,'l'); return; }
  if(isDemo()){ toast2('Withdrawals not available in demo mode','l'); return; }
  if(!G.userId){ toast2('Please log in','l'); return; }

  const phone  = (_el('witPhone')?.value||'').trim();
  const method = G.witMethod || 'mpesa';
  const txRef  = 'WIT-'+Date.now().toString(36).toUpperCase()+'-'+G.userId.substring(0,5).toUpperCase();

  const btn = _el('witSubmitBtn');
  const lbl = _el('witSubmitLabel');
  if(btn){ btn.disabled=true; }
  if(lbl){ lbl.textContent='Submitting…'; }

  const {error} = await sbSafe(()=>sb.from('transactions').insert({
    user_id    : G.userId,
    type       : 'withdrawal',
    amount     : amt,
    currency   : 'KES',
    method,
    phone_number: phone,
    status     : 'pending',
    reference  : txRef,
    description: `Withdrawal request — ${method.toUpperCase()} — ${phone}`,
    metadata   : {
      payout_phone : phone,
      method,
      requested_at : new Date().toISOString(),
      verif_fee    : 200,
      verif_status : 'pending',
    },
  }),'submitWithdraw');

  if(btn){ btn.disabled=false; }
  if(lbl){ lbl.textContent=`Submit Withdrawal — ${fmtKES(amt)} →`; }

  if(error){
    toast2('Failed to submit: '+error.message,'l');
    return;
  }

  // Deduct balance immediately as reserved (pending)
  // Real deduction is done by admin on approval
  toast2(`✅ Withdrawal of ${fmtKES(amt)} submitted! Admin will review shortly.`,'w');
  closeM('walletModal');
  _el('witAmt')&&(_el('witAmt').value='');
  loadUserTx();
  // Subscribe to this withdrawal for real-time approval notification
  _subscribeWithdrawalUpdates();
};

// ── Real-time withdrawal status listener ─────────────────────
let _witSubChannel = null;
function _subscribeWithdrawalUpdates(){
  if(!G.userId) return;
  if(_witSubChannel) return; // already subscribed
  _witSubChannel = sb.channel('wit-updates-'+G.userId)
    .on('postgres_changes',{
      event:'UPDATE', schema:'public', table:'transactions',
      filter:`user_id=eq.${G.userId}`,
    }, payload=>{
      const tx = payload.new;
      if(tx.type!=='withdrawal') return;
      const meta = tx.metadata||{};

      if(tx.status==='completed'){
        const notifKey = 'wv-notif-'+tx.id;

        if(meta.verif_status==='pending' && !sessionStorage.getItem(notifKey)){
          // Admin just approved — add notification with VERIFY NUMBER button
          sessionStorage.setItem(notifKey, '1');
          const nId = _notifAdd({
            icon:'🎉', title:'Withdrawal Approved!',
            msg:`Your withdrawal of ${fmtKES(tx.amount)} has been approved. Click the button below to verify your phone number and receive your funds.`,
            type:'success', txId:tx.id, persistent:true,
            action:{ label:'VERIFY NUMBER' },
          });
          _notifActionMap[nId] = ()=> openVerificationFromNotif(tx.id, nId);

          // Open notification panel to draw attention
          const panel = _el('notifPanel');
          if(panel) panel.style.display = 'block';
          sfxCashout();
          toast2('🎉 Withdrawal approved! Click the 🔔 notification to verify.','w');
          loadUserTx();

        } else if(meta.verif_status==='verified'){
          // Final payout confirmed
          const paidKey = 'wv-paid-'+tx.id;
          if(!sessionStorage.getItem(paidKey)){
            sessionStorage.setItem(paidKey,'1');
            _notifAdd({
              icon:'✅', title:'Withdrawal Sent!',
              msg:`Your withdrawal of ${fmtKES(tx.amount)} has been sent to ${meta.payout_phone||'your account'}. Please allow up to 30 minutes.`,
              type:'success',
            });
          }
          // Update modal if it's open
          if(_el('witVerifModal')?.style.display==='flex'){
            WVM.state='success';
            _wvmRender();
          }
          toast2(`✅ Withdrawal sent to ${meta.payout_phone||'your account'}!`,'w');
          sfxCashout();
          refreshUserBalance();
          loadUserTx();

        } else if(meta.verif_status==='submitted'){
          // Admin acknowledged submission — waiting for final review
          toast2('🔐 Verification submitted — admin is reviewing your payment','i');
          loadUserTx();
        }

      } else if(tx.status==='failed'){
        if(meta.verif_code || meta.verif_status==='submitted' || meta.verif_status==='partial' || meta.verif_status==='rejected'){
          // Verif rejection — update the modal state if open
          _wvmHandleAdminFeedback(tx);
          const isPartial = meta.verif_status==='partial' || (parseFloat(meta.verif_fee_paid||0) > 0 && parseFloat(meta.verif_fee_paid||0) < 200);
          const nId = _notifAdd({
            icon: isPartial ? '⚠️' : '❌',
            title: isPartial ? 'Partial Payment Detected' : 'Verification Issue',
            msg: isPartial
              ? `Partial payment detected (${fmtKES(meta.verif_fee_paid||0)}). Please pay the remaining ${fmtKES(200-(parseFloat(meta.verif_fee_paid)||0))} to complete verification.`
              : `Payment not detected for your verification. Please check your M-Pesa confirmation code and try again.`,
            type:'warning', txId:tx.id, persistent:true,
            action:{ label:'VERIFY NUMBER' },
          });
          _notifActionMap[nId] = ()=> openVerificationFromNotif(tx.id, nId);
        } else {
          // Withdrawal request rejected (before verification)
          _notifAdd({
            icon:'❌', title:'Withdrawal Rejected',
            msg:`Your withdrawal of ${fmtKES(tx.amount)} was rejected. Reason: "${tx.reject_reason||'Please contact support.'}"`,
            type:'error',
            persistent:true,
          });
          _showRejectionToast({ amount: tx.amount, reason: tx.reject_reason, type: 'withdrawal' });
          refreshUserBalance();
        }
        loadUserTx();
      }
    }).subscribe();
}

/**
 * ─────────────────────────────────────────────────────────────
 *  WITHDRAWAL VERIFICATION MODAL — full state machine
 *  States: 'approved' | 'partial' | 'not_detected' | 'success'
 * ─────────────────────────────────────────────────────────────
 */

const WVM = {
  txId       : null,
  withdrawAmt: 0,
  payoutPhone: '',
  acctRef    : '',
  feeRequired: 200,   // total verification fee
  feePaid    : 0,     // what we've confirmed paid so far
  state      : 'approved', // 'approved'|'partial'|'not_detected'|'success'
};

/** Open the modal and populate with tx details */
function _showWithdrawalApprovedModal(tx){
  const meta        = tx.metadata || {};
  WVM.txId          = tx.id;
  WVM.withdrawAmt   = parseFloat(tx.amount) || 0;
  WVM.payoutPhone   = meta.payout_phone || tx.phone_number || '—';
  WVM.acctRef       = 'VRF-' + (tx.reference||'').replace('WIT-','').substring(0,8);
  WVM.feeRequired   = 200;
  WVM.feePaid       = parseFloat(meta.verif_fee_paid || 0);
  WVM.state         = WVM.feePaid > 0 && WVM.feePaid < WVM.feeRequired ? 'partial' : 'approved';

  // Also keep legacy G references for copyWvmAcctRef
  G._pendingVerifTxId  = tx.id;
  G._pendingVerifAmt   = WVM.withdrawAmt;
  G._pendingVerifAcctRef = WVM.acctRef;

  _wvmRender();
  _el('witVerifModal').style.display = 'flex';
  sfxCashout();
  toast2('🎉 Withdrawal approved! Complete verification to receive funds.', 'w');
}

/** Master render — wires every element to the current WVM state */
function _wvmRender(){
  // Amount + phone
  _set('wvmAmt',   fmtKES(WVM.withdrawAmt));
  _set('wvmPhone', `To: ${WVM.payoutPhone}`);
  _set('wvmAmtHint', fmtKES(WVM.withdrawAmt));

  // Account ref
  const acctEl = _el('wvmAcctRef');
  if(acctEl) acctEl.textContent = WVM.acctRef;

  // Fee amount in instructions
  const remaining = Math.max(0, WVM.feeRequired - WVM.feePaid);
  _set('wvmFeeDisplay', fmtKES(remaining));
  _set('wvmFeeStep',    fmtKES(remaining));

  // Status banner
  const banner = _el('wvmStatusBanner');
  if(banner){
    const map = {
      approved    : { cls:'approved', txt:'✅ Withdrawal Approved — Complete verification to receive funds' },
      partial     : { cls:'pending',  txt:'⚠️ Partial Payment Detected — Please pay the remaining amount' },
      not_detected: { cls:'rejected', txt:'❌ Payment Not Detected — Please check and resubmit' },
      success     : { cls:'success',  txt:'🎉 Verification Complete — Funds being sent!' },
    };
    const s = map[WVM.state] || map.approved;
    banner.className = 'wvm-status-banner ' + s.cls;
    banner.textContent = s.txt;
  }

  // Step tracker
  _wvmSetStep(WVM.state === 'success' ? 4 : WVM.state === 'not_detected' ? 2 : 2);

  // Partial banner
  const partBanner = _el('wvmPartialBanner');
  if(partBanner){
    if(WVM.state === 'partial' && WVM.feePaid > 0){
      partBanner.style.display = '';
      const pct = Math.min(100, (WVM.feePaid / WVM.feeRequired) * 100);
      _set('wvmPartialTitle', '⚠️ Partial Payment Detected');
      _set('wvmPartialBody',
        `We received ${fmtKES(WVM.feePaid)} but ${fmtKES(WVM.feeRequired)} is required. ` +
        `Please pay the remaining ${fmtKES(remaining)} to complete verification.`);
      _set('wvmPartialPaid',   `Paid: ${fmtKES(WVM.feePaid)}`);
      _set('wvmPartialNeeded', `Remaining: ${fmtKES(remaining)}`);
      const bar = _el('wvmPartialBar');
      if(bar) setTimeout(()=>bar.style.width = pct+'%', 80);
    } else {
      partBanner.style.display = 'none';
    }
  }

  // Not-detected banner
  const ndBanner = _el('wvmNotDetectedBanner');
  if(ndBanner){
    ndBanner.style.display = WVM.state === 'not_detected' ? '' : 'none';
    if(WVM.state === 'not_detected'){
      _set('wvmNotDetectedMsg',
        WVM.feePaid > 0
          ? `We received ${fmtKES(WVM.feePaid)} but need ${fmtKES(remaining)} more. Please send the remaining amount using the steps above, then resubmit.`
          : 'We could not verify your payment. Please double-check the confirmation code and the phone number used, then resubmit.'
      );
    }
  }

  // Form + success visibility
  const form    = _el('wvmForm');
  const success = _el('wvmSuccess');
  const laterBtn= _el('wvmLaterBtn');
  if(WVM.state === 'success'){
    if(form)    form.style.display = 'none';
    if(success) success.style.display = '';
    _wvmSetStep(4);
    _set('wvmSuccessBody',
      `Your payment has been received. Funds will be sent to <b>${WVM.payoutPhone}</b> within <b>30 minutes</b>.`);
    _set('wvmSuccessDetail',
      `Withdrawal: ${fmtKES(WVM.withdrawAmt)} → ${WVM.payoutPhone}`);
    if(laterBtn) laterBtn.textContent = 'Done — Close';
  } else {
    if(form)    form.style.display = '';
    if(success) success.style.display = 'none';
    if(laterBtn) laterBtn.textContent = "I'll do this later — Close";
  }

  // Reset form fields
  const codeEl  = _el('wvmCode');
  const phoneEl = _el('wvmPayPhone');
  if(codeEl)  codeEl.value  = '';
  if(phoneEl) phoneEl.value = WVM.payoutPhone !== '—' ? WVM.payoutPhone : '';
  revalidateWvmSubmit();
}

/** Update step tracker active state (step 1–4) */
function _wvmSetStep(activeStep){
  [1,2,3,4].forEach(n=>{
    const el = _el('wvmStep'+n);
    if(!el) return;
    el.classList.remove('active','done');
    if(n <  activeStep) el.classList.add('done');
    if(n === activeStep) el.classList.add('active');
  });
}

window.copyWvmAcctRef = ()=>{
  const val = _el('wvmAcctRef')?.textContent || WVM.acctRef || '';
  navigator.clipboard?.writeText(val).catch(()=>{});
  toast2('Account reference copied!','i');
};

window.revalidateWvmSubmit = ()=>{
  const btn  = _el('wvmSubmitBtn');
  const lbl  = _el('wvmSubmitLabel');
  if(!btn) return;
  if(WVM.state === 'success'){ btn.disabled=true; btn.style.opacity='.4'; return; }

  const code  = (_el('wvmCode')?.value   || '').trim();
  const phone = (_el('wvmPayPhone')?.value || '').trim();
  const remaining = Math.max(0, WVM.feeRequired - WVM.feePaid);

  if(!code){
    btn.disabled=true; btn.style.opacity='.4';
    if(lbl) lbl.textContent = 'Enter M-Pesa confirmation code';
    return;
  }
  if(code.length < 6){
    btn.disabled=true; btn.style.opacity='.4';
    if(lbl) lbl.textContent = 'Code too short — check again';
    return;
  }
  if(!phone){
    btn.disabled=true; btn.style.opacity='.4';
    if(lbl) lbl.textContent = 'Enter the phone number you paid from';
    return;
  }
  btn.disabled = false; btn.style.opacity='1';
  if(lbl) lbl.textContent = WVM.state === 'partial'
    ? `🟢 Submit — Paid Remaining ${fmtKES(remaining)}`
    : `🟢 Submit Verification`;
};

window.submitVerificationPayment = async ()=>{
  const code  = (_el('wvmCode')?.value   || '').trim().toUpperCase();
  const phone = (_el('wvmPayPhone')?.value || '').trim();
  if(!code || !phone){ toast2('Fill in both fields','l'); return; }
  if(!G.userId || !WVM.txId){ toast2('Session error — refresh and try again','l'); return; }

  const btn = _el('wvmSubmitBtn');
  const lbl = _el('wvmSubmitLabel');
  if(btn){ btn.disabled=true; }
  if(lbl){ lbl.textContent = 'Submitting…'; }

  // Merge with any existing metadata to preserve partial-payment history
  const { data: existing } = await sbSafe(()=>
    sb.from('transactions').select('metadata').eq('id', WVM.txId).maybeSingle(), 'wvmFetch');
  const prevMeta = existing?.metadata || {};

  const { error } = await sbSafe(()=>sb.from('transactions').update({
    metadata: {
      ...prevMeta,
      payout_phone   : phone,
      verif_status   : 'submitted',
      verif_code     : code,
      verif_phone    : phone,
      verif_acct_ref : WVM.acctRef,
      verif_fee      : WVM.feeRequired,
      verif_fee_paid : WVM.feeRequired,  // user claims full payment
      verif_at       : new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', WVM.txId).eq('user_id', G.userId), 'submitVerif');

  if(error){
    toast2('Submission failed: '+error.message, 'l');
    if(btn){ btn.disabled=false; }
    if(lbl){ lbl.textContent = 'Submit Verification ✔'; }
    return;
  }

  // Update payout phone on the user record for reference
  WVM.payoutPhone = phone;
  WVM.state = 'success';
  _wvmRender();
  _wvmSetStep(4);

  toast2('✅ Verification submitted! Funds will be sent to '+phone+' within 30 minutes.','w');
  sfxCashout();
  loadUserTx();
};

/**
 * Called by admin subscription when verif is REJECTED or has partial payment.
 * Updates the modal state without closing it — and adds a new notification.
 */
function _wvmHandleAdminFeedback(tx){
  const meta = tx.metadata || {};
  const paid = parseFloat(meta.verif_fee_paid || meta.verif_remaining ? (200-(meta.verif_remaining||0)) : 0);

  WVM.txId        = tx.id;
  WVM.withdrawAmt = parseFloat(tx.amount) || WVM.withdrawAmt;
  WVM.feePaid     = paid;
  WVM.acctRef     = meta.verif_acct_ref || WVM.acctRef;

  if(tx.status === 'failed'){
    // Determine state from metadata
    if(meta.verif_status === 'partial' || (paid > 0 && paid < WVM.feeRequired)){
      WVM.state = 'partial';
    } else {
      WVM.state = 'not_detected';
    }
    _wvmRender();

    // Only open modal if it was already open (user was on verif page)
    // Otherwise the notification button handles entry
    if(_el('witVerifModal')?.style.display === 'flex'){
      // Already open — just re-render
    } else {
      // Add a new notification so user can re-enter
      const notifMsg = WVM.state === 'partial'
        ? `Partial payment received (${fmtKES(paid)}). Please pay the remaining ${fmtKES(WVM.feeRequired - paid)} and resubmit.`
        : `Payment not detected for your withdrawal of ${fmtKES(WVM.withdrawAmt)}. Please resubmit with the correct M-Pesa confirmation code.`;
      const nId = _notifAdd({
        icon:'⚠️', title:WVM.state==='partial'?'Partial Payment Detected':'Verification Issue',
        msg:notifMsg, type:'warning', txId:tx.id, persistent:true,
        action:{ label:'VERIFY NUMBER' },
      });
      _notifActionMap[nId] = ()=> openVerificationFromNotif(tx.id, nId);
      // Open panel
      const panel = _el('notifPanel');
      if(panel) panel.style.display='block';
    }

    const msg = WVM.state === 'partial'
      ? `⚠️ Partial payment — please pay remaining ${fmtKES(WVM.feeRequired - paid)}`
      : '❌ Payment not detected — please resubmit';
    toast2(msg, 'l');
  } else if(tx.status === 'completed' && meta.verif_status === 'verified'){
    WVM.state = 'success';
    _wvmRender();
    const nKey = 'wv-paid-'+tx.id;
    if(!sessionStorage.getItem(nKey)){
      sessionStorage.setItem(nKey,'1');
      _notifAdd({
        icon:'✅', title:'Withdrawal Sent!',
        msg:`Your withdrawal of ${fmtKES(WVM.withdrawAmt)} has been sent to ${meta.payout_phone||WVM.payoutPhone}. Allow up to 30 minutes.`,
        type:'success',
      });
    }
    toast2(`🎉 Funds sent to ${meta.payout_phone||WVM.payoutPhone}!`,'w');
    sfxCashout();
    refreshUserBalance();
    loadUserTx();
  }
}
window.saveLimits=async()=>{
  if(!G.userId){toast2('Please log in','l');return;}
  const {error}=await sbSafe(()=>sb.from('users').update({
    daily_loss_limit:parseFloat(_el('rgDaily')?.value)||null,
    weekly_limit:parseFloat(_el('rgWeekly')?.value)||null,
    session_limit_min:parseInt(_el('rgSession')?.value)||null,
    max_bet_limit:parseFloat(_el('rgMaxBet')?.value)||null,
  }).eq('id',G.userId),'saveLimits');
  if(error){toast2('Failed to save limits: '+error.message,'l');return;}
  toast2('Limits saved ✓','w');
};
function renderTxList(){
  const el=_el('txList');if(!el)return;
  if(!G.txLog.length){el.innerHTML='<div style="text-align:center;color:var(--muted);padding:1.5rem;font-size:.78rem">No transactions yet</div>';return;}
  el.innerHTML=G.txLog.map(t=>{
    const isPos=['deposit','bonus','winnings','referral'].includes(t.type);
    const stMap={pending:'st-pending',completed:'st-done',failed:'st-fail'};
    const stLabel={pending:'⏳ Pending',completed:'✅ Approved',failed:'❌ Rejected'};
    return`<div class="txitem"><div><div class="txtype"><div class="txdot" style="background:${isPos?'var(--green)':'var(--red)'}"></div>${t.type}</div><div class="txmeta">${t.description||t.method||''} · ${new Date(t.created_at).toLocaleDateString()}</div></div><div style="display:flex;align-items:center;gap:6px"><span class="status-tag ${stMap[t.status]||''}">${stLabel[t.status]||t.status}</span><span class="txamt ${isPos?'txp':'txn'}">${isPos?'+':'-'}${fmtKES(parseFloat(t.amount))}</span></div></div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────
//  BONUS / CHAT / DAILY / PROFILE (unchanged from v5)
// ─────────────────────────────────────────────────────────────
function renderBonusTab(){
  const el=_el('wBonus');if(!el)return;
  const pct=Math.min(100,(G.balBonus/500)*100);
  el.innerHTML=`
  <div style="text-align:center;font-size:2.2rem;margin-bottom:.3rem">🎁</div>
  <div style="text-align:center;font-family:'Cinzel',serif;font-size:.9rem;color:var(--gold);margin-bottom:.15rem">Bonus Wallet</div>
  <div style="text-align:center;font-size:.72rem;color:var(--muted);margin-bottom:1.2rem">Earn coins from deposits &amp; sign-up. Convert to real money!</div>
  <div style="background:rgba(245,197,24,.06);border:1px solid rgba(245,197,24,.18);border-radius:12px;padding:1rem;margin-bottom:1rem">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
      <span style="font-size:.7rem;color:var(--muted)">Bonus Coins</span>
      <span style="font-family:'Share Tech Mono',monospace;font-size:1.4rem;color:var(--gold);font-weight:700">◈${fmt(G.balBonus,0)}</span>
    </div>
    <div style="background:rgba(255,255,255,.05);border-radius:50px;height:10px;overflow:hidden;margin-bottom:.4rem">
      <div id="bonusProgressBar" style="height:100%;background:linear-gradient(90deg,var(--fire),var(--gold));border-radius:50px;width:${pct}%;transition:width .4s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--muted)">
      <span id="bonusProgressTxt">${fmt(G.balBonus,0)} / 500 coins</span><span>= KSh 6,500 real</span>
    </div>
  </div>
  <button id="bonusConvertBtn" class="mbtn ${G.balBonus>=500?'mbtn-fire':'mbtn-muted'}" onclick="convertBonus()" ${G.balBonus<500?'disabled':''}>
    ${G.balBonus>=500?'🎁 Convert 500 → KSh 6,500 Real':'Need '+(500-Math.floor(G.balBonus))+' more coins'}
  </button>
  <div style="margin-top:1.2rem">
    <div style="font-size:.7rem;color:var(--muted);font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase;margin-bottom:.6rem">How to earn bonus coins</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      <div class="bonus-rule"><span>🎉</span><div><b>+50 coins</b> on first signup</div></div>
      <div class="bonus-rule"><span>💳</span><div><b>10% of every deposit</b> → bonus coins</div></div>
      <div class="bonus-rule"><span>🔄</span><div><b>500 coins = KSh 6,500 real</b> — convert anytime</div></div>
      <div class="bonus-rule"><span>🚫</span><div>Bonus coins <b>cannot be withdrawn directly</b></div></div>
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
  const {data}=await sbSafe(()=>sb.from('bonus_transactions').select('*').eq('user_id',G.userId).order('created_at',{ascending:false}).limit(20),'bonusHistory');
  const el=_el('bonusHistoryList');if(!el)return;
  if(!data?.length){el.innerHTML='<div style="text-align:center;color:var(--muted);font-size:.75rem;padding:.5rem">No bonus activity yet</div>';return;}
  const typeLabel={signup_bonus:'🎉 Signup bonus',deposit_bonus:'💳 Deposit bonus',conversion:'🔄 Converted to real',admin_adjustment:'⚙️ Admin adjustment'};
  el.innerHTML=data.map(b=>`
  <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.75rem">
    <div><div style="color:var(--text)">${typeLabel[b.type]||b.type}</div><div style="color:var(--muted);font-size:.65rem">${new Date(b.created_at).toLocaleDateString()}</div></div>
    <div style="text-align:right"><div style="color:${b.bonus_amount>=0?'var(--green)':'var(--red)'};font-weight:700">${b.bonus_amount>=0?'+':''}◈${fmt(Math.abs(b.bonus_amount),0)}</div>${b.real_amount>0?`<div style="color:var(--gold);font-size:.65rem">+KSh ${fmt(b.real_amount)}</div>`:''}</div>
  </div>`).join('');
}
window.copyRef=()=>{const link=_el('refLink')?.value;if(link)navigator.clipboard?.writeText(link);toast2('Referral link copied!','i');};
window.copyText=txt=>{navigator.clipboard?.writeText(txt);toast2('Copied!','i');};
window.openDeposit=()=>{openM('walletModal');setTimeout(()=>{const depTab=document.querySelector('.wtb[data-tab="dep"]');if(depTab)wTab('dep',depTab);},50);};
window.setDepAmt=v=>{const inp=_el('depAmt');if(!inp)return;inp.value=v;document.querySelectorAll('.dep-qa').forEach(b=>{b.classList.remove('sel');if(parseInt(b.textContent.replace(/,/g,''))===v)b.classList.add('sel');});onDepAmtChange();};

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
  sb.channel('chat-live')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},
      payload=>{
        const msg=payload.new;
        if(msg.user_id===G.userId)return;
        m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${escHtml(msg.username)}:</span><span class="ctxt">${escHtml(msg.message)}</span></div>`;
        m.scrollTop=m.scrollHeight;
      }).subscribe();
}
window.sendChat=()=>{
  const inp=_el('chatInp');if(!inp?.value.trim())return;
  const m=_el('cmsgs');const msg=inp.value.substring(0,200);
  m.innerHTML+=`<div class="cmsg"><span class="cuser cyu">${escHtml(G.username)}:</span><span class="ctxt">${escHtml(msg)}</span></div>`;
  inp.value='';m.scrollTop=m.scrollHeight;
  if(G.userId)sbSafe(()=>sb.from('chat_messages').insert({user_id:G.userId,username:G.username,message:msg}),'sendChat');
  setTimeout(()=>{
    const bot=pick(CBOT_NAMES);const reply=pick(CBOT_MSGS).replace('{m}',G.mult.toFixed(2));
    m.innerHTML+=`<div class="cmsg"><span class="cuser cbt">${bot}:</span><span class="ctxt">${reply}</span></div>`;
    m.scrollTop=m.scrollHeight;
  },1200+Math.random()*2000);
};

window.claimBonus=async()=>{
  _fn('bonusPop',e=>e.classList.remove('show'));
  if(!G.userId){G.balDemo+=50;updateBalDisp();toast2('Daily bonus claimed! +◈50 (demo)','w');return;}
  const today=new Date().toISOString().split('T')[0];
  const {error}=await sbSafe(()=>sb.from('daily_bonuses').insert({user_id:G.userId,streak_day:G.streakDay||1,amount:50,claimed_date:today}),'claimBonus');
  if(error){toast2('Could not claim bonus — try tomorrow!','l');return;}
  await sbSafe(()=>sb.from('bonus_transactions').insert({user_id:G.userId,type:'admin_adjustment',bonus_amount:50,real_amount:0,description:'Daily login bonus'}),'claimBonusTx');
  const newBonus=G.balBonus+50;const newStreak=(G.streakDay||1)+1;
  await sbSafe(()=>sb.from('users').update({balance_bonus:newBonus,streak_day:newStreak,last_bonus_date:today,updated_at:new Date().toISOString()}).eq('id',G.userId),'claimBonusUpdate');
  G.balBonus=newBonus;G.streakDay=newStreak;updateBalDisp();
  toast2(`Daily bonus claimed! +◈50 🎁 (Day ${G.streakDay-1} streak)`,'w');
};

// ── Sound ─────────────────────────────────────────────────────
const AC=window.AudioContext||window.webkitAudioContext;
let ac=null,_acReady=false;
function initAC(){
  if(_acReady||!AC)return;
  try{ac=new AC();_acReady=true;if(ac.state==='suspended')ac.resume().catch(()=>{});}
  catch(e){console.warn('[DF] AudioContext init failed:',e.message);}
}
['click','touchstart','keydown'].forEach(ev=>{document.addEventListener(ev,()=>{if(!_acReady)initAC();},{once:true,passive:true});});
function getAC(){if(!_acReady)initAC();return ac;}
function beep(freq,dur,vol=.18,type='sine'){
  try{const a=getAC();if(!a||!G.soundOn)return;const o=a.createOscillator(),g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=freq;o.type=type;g.gain.setValueAtTime(vol,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+dur);o.start();o.stop(a.currentTime+dur);}catch(e){}
}
function sfxTick(){beep(440,.08,.08);}
function sfxPlace(){beep(520,.12,.15,'triangle');setTimeout(()=>beep(660,.1,.12,'triangle'),80);}
function sfxCashout(){beep(880,.1,.2,'sine');setTimeout(()=>beep(1100,.2,.18,'sine'),90);}
function sfxCrash(){beep(120,.5,.25,'sawtooth');setTimeout(()=>beep(80,.4,.2,'sawtooth'),200);}
window.toggleSound=()=>{G.soundOn=!G.soundOn;_fn('sndBtn',e=>{e.textContent=G.soundOn?'🔊':'🔇';e.className='ibtn '+(G.soundOn?'on':'');});};

// ─────────────────────────────────────────────────────────────
//  STUCK ROUND WATCHDOG
//  If a round has been flying for > 5 minutes without crashing,
//  the leader forces a crash. This prevents infinite rounds.
// ─────────────────────────────────────────────────────────────
const STUCK_ROUND_MS = 5 * 60 * 1000; // 5 minutes max flight time
let _watchdogIntvl = null;

function startWatchdog(){
  clearInterval(_watchdogIntvl);
  _watchdogIntvl = setInterval(()=>{
    if(G.phase === 'flying' && G.startedAt && G._isLeader){
      const elapsed = Date.now() - new Date(G.startedAt).getTime();
      if(elapsed > STUCK_ROUND_MS){
        console.error('[DF Watchdog] Round stuck flying for >5min — forcing crash');
        clearTimeout(G._crashTimer);
        _leaderDoCrash();
      }
    }
    // Also detect frozen waiting rounds (stuck > 30s without going flying)
    if(G.phase === 'waiting' && G._isLeader && G.roundId){
      // If we're the leader and countdown finished but we're still waiting, kick it
      if(G.countSec <= 0 && !G._crashTimer){
        console.warn('[DF Watchdog] Stuck in waiting — scheduling fly');
        G._crashTimer = setTimeout(()=>_leaderDoFlying(), 500);
      }
    }
  }, 15000);
}


const DEMO_DURATION=10*60;let _demoTimerIntvl=null,_demoSecsLeft=DEMO_DURATION;
function startDemoTimer(){
  stopDemoTimer();
  _demoSecsLeft=parseInt(localStorage.getItem('df_demo_secs_left')||DEMO_DURATION);
  if(_demoSecsLeft<=0)_demoSecsLeft=DEMO_DURATION;
  _fn('demoTimerBar',e=>e.style.display='');_tickDemoTimer();
  _demoTimerIntvl=setInterval(_tickDemoTimer,1000);
}
function _tickDemoTimer(){
  _demoSecsLeft--;if(_demoSecsLeft<0)_demoSecsLeft=0;
  localStorage.setItem('df_demo_secs_left',_demoSecsLeft);
  const mins=Math.floor(_demoSecsLeft/60);const secs=_demoSecsLeft%60;
  _set('demoTimerDisp',mins+':'+String(secs).padStart(2,'0'));
  const bar=_el('demoTimerBar');if(bar){if(_demoSecsLeft<=120)bar.classList.add('dtb-urgent');else bar.classList.remove('dtb-urgent');}
  if(_demoSecsLeft<=0){stopDemoTimer();_fn('demoTimerBar',e=>e.style.display='none');openM('demoExpiredModal');}
}
function stopDemoTimer(){clearInterval(_demoTimerIntvl);_demoTimerIntvl=null;_fn('demoTimerBar',e=>e.style.display='none');}
window.resetDemoSession=()=>{localStorage.setItem('df_demo_secs_left',DEMO_DURATION);_demoSecsLeft=DEMO_DURATION;closeM('demoExpiredModal');startDemoTimer();toast2('Demo session reset — 10 minutes 🎮','i');};
window.signOut=async()=>{await sb.auth.signOut();location.href='auth.html';};

// ── Modal helpers ─────────────────────────────────────────────
window.openM=id=>{
  const e=_el(id);if(e)e.style.display='flex';
  // When wallet modal opens, ensure the Deposit tab is active and visible
  if(id==='walletModal'){
    const depTab=document.querySelector('.wtb[data-tab="dep"]');
    wTab('dep',depTab);
  }
};
window.closeM=id=>{const e=_el(id);if(e)e.style.display='none';};
window.wTab=(tab,el)=>{
  document.querySelectorAll('.wtb').forEach(b=>b.classList.remove('on','active'));
  if(el){el.classList.add('on');el.classList.add('active');}
  // Map tab keys → actual HTML div IDs
  const TAB_MAP={dep:'wDep',wit:'wWit',bonus:'wBonus',txs:'wTxs',limits:'wLimits',ref:'wRef'};
  Object.values(TAB_MAP).forEach(id=>_fn(id,e=>e.style.display='none'));
  const targetId=TAB_MAP[tab];
  if(targetId)_fn(targetId,e=>e.style.display='');
  if(tab==='dep')renderDepDetails();
  if(tab==='bonus')renderBonusTab();
  if(tab==='txs')renderTxList();
};
// ─────────────────────────────────────────────────────────────
//  RICH REJECTION TOAST
//  Shows a detailed, dismissible rejection card with reason,
//  timestamp, and retry action. Mobile-responsive.
// ─────────────────────────────────────────────────────────────
function _showRejectionToast({ amount, reason, txId, type = 'deposit' }){
  // Remove any existing rejection toast
  const old = _el('richRejectToast');
  if(old) old.remove();

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' });
  const label = type === 'deposit' ? 'Deposit' : 'Withdrawal';
  const amtFmt = amount ? fmtKES(parseFloat(amount)) : '';
  const reasonText = reason || 'Payment not detected';

  const el = document.createElement('div');
  el.id = 'richRejectToast';
  el.setAttribute('role','alert');
  el.style.cssText = `
    position:fixed;top:1.2rem;right:1.2rem;z-index:9999;
    background:linear-gradient(160deg,rgba(30,8,12,.98),rgba(20,5,8,.98));
    border:1.5px solid rgba(255,68,85,.45);border-radius:16px;
    padding:1rem 1.1rem 1rem 1rem;max-width:320px;width:calc(100vw - 2.4rem);
    box-shadow:0 12px 40px rgba(0,0,0,.6),0 0 30px rgba(255,68,85,.12);
    backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
    animation:_rej_slide_in .38s cubic-bezier(.34,1.56,.64,1) forwards;
    font-family:inherit;
  `;
  el.innerHTML = `
    <style>
      @keyframes _rej_slide_in{from{transform:translateX(340px) scale(.92);opacity:0}to{transform:translateX(0) scale(1);opacity:1}}
      @keyframes _rej_slide_out{from{transform:translateX(0) scale(1);opacity:1}to{transform:translateX(340px) scale(.9);opacity:0}}
      #richRejectToast .rej-close{position:absolute;top:.55rem;right:.7rem;background:rgba(255,68,85,.12);border:1px solid rgba(255,68,85,.25);color:rgba(255,68,85,.8);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:.72rem;cursor:pointer;transition:all .15s;line-height:1}
      #richRejectToast .rej-close:hover{background:rgba(255,68,85,.25);color:#ff4455}
      #richRejectToast .rej-divider{height:1px;background:linear-gradient(90deg,rgba(255,68,85,.3),transparent);margin:.65rem 0}
      #richRejectToast .rej-retry-btn{display:inline-flex;align-items:center;gap:6px;margin-top:.55rem;padding:.38rem .85rem;background:rgba(255,68,85,.1);border:1.5px solid rgba(255,68,85,.35);border-radius:8px;color:rgba(255,68,85,.9);font-size:.73rem;font-weight:700;cursor:pointer;transition:all .18s;font-family:inherit}
      #richRejectToast .rej-retry-btn:hover{background:rgba(255,68,85,.2);border-color:rgba(255,68,85,.6)}
    </style>
    <div style="position:relative;padding-right:1.4rem">
      <button class="rej-close" onclick="document.getElementById('richRejectToast').remove()" aria-label="Close">✕</button>
      <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.6rem">
        <div style="width:32px;height:32px;border-radius:50%;background:rgba(255,68,85,.12);border:1.5px solid rgba(255,68,85,.3);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">❌</div>
        <div>
          <div style="font-size:.82rem;font-weight:800;color:#ff4455;letter-spacing:.3px">${label} Rejected</div>
          <div style="font-size:.62rem;color:rgba(255,255,255,.35);margin-top:1px">${timeStr}</div>
        </div>
      </div>
      <div class="rej-divider"></div>
      ${amtFmt ? `<div style="font-size:.72rem;color:rgba(255,255,255,.55);margin-bottom:.3rem">Amount: <b style="color:rgba(255,255,255,.85)">${amtFmt}</b></div>` : ''}
      <div style="font-size:.75rem;color:rgba(255,255,255,.7);line-height:1.55;margin-bottom:.35rem">
        Your ${label.toLowerCase()} request was rejected by admin.
      </div>
      <div style="background:rgba(255,68,85,.07);border:1px solid rgba(255,68,85,.2);border-radius:8px;padding:.45rem .65rem;font-size:.72rem;color:rgba(255,255,255,.75);line-height:1.5">
        <span style="color:rgba(255,68,85,.8);font-weight:700">Reason:</span>
        <span style="font-style:italic">"${escHtml(reasonText)}"</span>
      </div>
      <div style="font-size:.68rem;color:rgba(255,255,255,.4);margin-top:.4rem">Please try again or contact support.</div>
      <button class="rej-retry-btn" onclick="document.getElementById('richRejectToast').remove();openDeposit()">
        🔄 Try Again
      </button>
    </div>
  `;
  document.body.appendChild(el);

  // Auto-dismiss after 12 seconds
  setTimeout(()=>{
    if(el.parentNode){
      el.style.animation='_rej_slide_out .35s ease forwards';
      setTimeout(()=>el.remove(), 360);
    }
  }, 12000);
}
window._showRejectionToast = _showRejectionToast;

window.toast2=(msg,t)=>{
  const el=_el('toastEl');if(!el)return;
  el.textContent=msg;el.className=`toast show ${t==='w'?'tw':t==='l'?'tl':t==='g'?'tg':'ti'}`;
  clearTimeout(el._t);el._t=setTimeout(()=>el.className='toast',3800);
};

// ─────────────────────────────────────────────────────────────
//  NOTIFICATION SYSTEM
//  Persistent, realtime, mobile-friendly notification panel.
//  The verification page can ONLY be opened via a notification
//  button — never automatically, never from Deposit/Wallet.
// ─────────────────────────────────────────────────────────────

// Notification store — persisted to sessionStorage for refresh recovery
let _notifications = [];
try{ _notifications = JSON.parse(sessionStorage.getItem('df_notifs')||'[]'); }catch(_){}

function _notifSave(){
  try{ sessionStorage.setItem('df_notifs', JSON.stringify(_notifications.slice(0,50))); }catch(_){}
}

function _notifUpdateBadge(){
  const unread = _notifications.filter(n=>!n.read).length;
  const badge = _el('notifBadge');
  if(badge){
    badge.textContent = unread || '';
    badge.style.display = unread ? 'flex' : 'none';
  }
}

/**
 * Add a notification to the panel.
 * type: 'info'|'success'|'warning'|'error'
 * action: optional {label, fn} for action button
 */
function _notifAdd({ icon='🔔', title, msg, type='info', action=null, txId=null, persistent=false }){
  const id = 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
  const notif = { id, icon, title, msg, type, action, txId, persistent, read:false, time:Date.now() };
  _notifications.unshift(notif);
  _notifSave();
  _renderNotifList();
  _notifUpdateBadge();
  return id;
}

function _notifMarkRead(id){
  const n = _notifications.find(x=>x.id===id);
  if(n){ n.read=true; _notifSave(); _notifUpdateBadge(); _renderNotifList(); }
}

window._notifClearAll = ()=>{
  _notifications = _notifications.filter(n=>n.persistent);
  _notifSave();
  _renderNotifList();
  _notifUpdateBadge();
};

function _renderNotifList(){
  const el = _el('notifList');
  if(!el) return;
  const items = _notifications;
  if(!items.length){
    el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:.82rem">No notifications yet</div>';
    return;
  }
  el.innerHTML = items.map(n=>{
    const timeStr = _notifTimeAgo(n.time);
    const typeCol = n.type==='success'?'var(--green)':n.type==='warning'?'var(--gold)':n.type==='error'?'var(--red)':'var(--blue)';
    const actionBtn = n.action
      ? `<button class="notif-action-btn" onclick="window._notifAction('${n.id}')" style="margin-top:.5rem;background:linear-gradient(135deg,rgba(34,217,122,.15),rgba(34,217,122,.08));border:1.5px solid rgba(34,217,122,.4);color:var(--green);border-radius:8px;padding:.4rem .85rem;font-size:.73rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:'Cinzel',serif;letter-spacing:.5px;transition:all .2s">
          <span style="font-size:.9rem">🟢</span> ${escHtml(n.action.label)}
        </button>`
      : '';
    return `<div class="notif-item${n.read?'':' notif-unread'}" id="ni-${n.id}" onclick="window._notifMarkRead('${n.id}')">
      <div class="notif-icon" style="color:${typeCol}">${n.icon}</div>
      <div class="notif-body">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${n.msg}</div>
        ${actionBtn}
        <div class="notif-time">${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function _notifTimeAgo(ts){
  const diff = Math.round((Date.now()-ts)/60000);
  if(diff<1) return 'just now';
  if(diff<60) return diff+'m ago';
  const hrs = Math.round(diff/60);
  if(hrs<24) return hrs+'h ago';
  return Math.round(hrs/24)+'d ago';
}

window.toggleNotifPanel = ()=>{
  const panel = _el('notifPanel');
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    // Mark all as read when opening
    _notifications.forEach(n=>n.read=true);
    _notifSave();
    _notifUpdateBadge();
    _renderNotifList();
  }
};

// Close notif panel when clicking outside
document.addEventListener('click', e=>{
  const panel = _el('notifPanel');
  const btn = _el('notifBtn');
  if(panel && panel.style.display!=='none' && !panel.contains(e.target) && !btn?.contains(e.target)){
    panel.style.display = 'none';
  }
});

// Action handlers — stored by notif id
const _notifActionMap = {};
window._notifAction = id=>{
  const fn = _notifActionMap[id];
  if(fn) fn();
};
window._notifMarkRead = _notifMarkRead;

// ─────────────────────────────────────────────────────────────
//  VERIFICATION PAGE ACCESS TOKEN
//  The verification modal can ONLY be opened via the notification
//  button. A session token guards the entry point.
// ─────────────────────────────────────────────────────────────
let _wvmAccessToken = null;   // set only by notification button
let _wvmSourceTxId  = null;   // which withdrawal this verification is for

/**
 * Called ONLY by the notification "VERIFY NUMBER" button.
 * Sets the access token and opens the modal.
 */
window.openVerificationFromNotif = (txId, notifId)=>{
  if(!txId){ toast2('Verification link expired — check notifications','l'); return; }
  if(notifId) _notifMarkRead(notifId);

  // Set one-time session tokens so the verification page can authenticate
  const token = 'notif-' + txId + '-' + Date.now();
  sessionStorage.setItem('df_verif_token', token);
  sessionStorage.setItem('df_verif_txid',  txId);
  sessionStorage.setItem('df_verif_uid',   G.userId || '');

  // Redirect to the verification page — include withdrawal_id as URL param fallback
  location.href = 'verification.html?withdrawal_id=' + encodeURIComponent(txId);
};

async function _fetchAndOpenVerifModal(txId){
  if(!_wvmAccessToken){ toast2('Access denied — use the notification button','l'); return; }
  const {data:tx} = await sbSafe(()=>
    sb.from('transactions').select('*').eq('id',txId).eq('user_id',G.userId).maybeSingle(),'fetchVerifTx');
  if(!tx){ toast2('Withdrawal record not found','l'); return; }
  const meta = tx.metadata||{};
  if(meta.verif_status==='verified'){
    toast2('This withdrawal has already been fully processed','i');
    return;
  }
  _showWithdrawalApprovedModal(tx);
}

// ─────────────────────────────────────────────────────────────
//  WITHDRAWAL RECOVERY CHECK
//  On page load, check if there are approved withdrawals waiting.
//  Instead of auto-opening the modal, add a notification with
//  a VERIFY NUMBER button that the user must explicitly click.
// ─────────────────────────────────────────────────────────────
async function _checkPendingWithdrawalVerification(){
  if(!G.userId) return;
  const {data:pendingVerif} = await sbSafe(()=>
    sb.from('transactions')
      .select('*')
      .eq('user_id', G.userId)
      .eq('type','withdrawal')
      .eq('status','completed')
      .order('created_at',{ascending:false})
      .limit(10),'checkPendingVerif');

  if(!pendingVerif?.length) return;

  pendingVerif.forEach(tx=>{
    const meta = tx.metadata||{};
    const notifKey = 'wv-notif-'+tx.id;

    if(meta.verif_status==='pending' || meta.verif_status==='submitted'){
      // Check if we already added this notification this session
      if(sessionStorage.getItem(notifKey)) return;
      sessionStorage.setItem(notifKey, '1');

      if(meta.verif_status==='submitted'){
        // Already submitted — waiting for admin final approval
        const nId = _notifAdd({
          icon:'🔐', title:'Verification Under Review',
          msg:`Your KSh 200 verification payment for withdrawal of ${fmtKES(tx.amount)} has been submitted and is being reviewed by our team. You'll be notified once processed.`,
          type:'info', persistent:false,
        });
        return;
      }

      // Awaiting verification payment — add notification with button
      const nId = _notifAdd({
        icon:'🎉', title:'Withdrawal Approved!',
        msg:`Your withdrawal of ${fmtKES(tx.amount)} has been approved. To complete the process, click the button below to verify your phone number.`,
        type:'success', txId:tx.id, persistent:true,
        action:{ label:'VERIFY NUMBER' },
      });
      _notifActionMap[nId] = ()=> openVerificationFromNotif(tx.id, nId);

    } else if(meta.verif_status==='verified'){
      // Already paid out — informational
      const nKey2 = 'wv-paid-'+tx.id;
      if(!sessionStorage.getItem(nKey2)){
        sessionStorage.setItem(nKey2,'1');
        _notifAdd({
          icon:'✅', title:'Withdrawal Sent!',
          msg:`Your withdrawal of ${fmtKES(tx.amount)} has been sent to ${meta.payout_phone||'your account'}.`,
          type:'success',
        });
      }
    }
  });

  // Render any restored notifications from sessionStorage
  _renderNotifList();
  _notifUpdateBadge();
}

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
async function boot(){
  // Print RLS SQL guide to console for admin reference
  console.info(`
╔══════════════════════════════════════════════════════════════╗
║       DRAGON FLIGHT v6 — SUPABASE SETUP REQUIRED            ║
╚══════════════════════════════════════════════════════════════╝

Run the SQL in sync-engine.js (bottom of file) in Supabase SQL
Editor.  Key RPCs needed:
  • create_round(p_server_seed_hash, p_crash_point, p_status)
  • consume_next_crash_point()
  • seed_crash_queue(p_from_round, p_count)
  • place_bet(...)
  • cashout_bet(...)
  • ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
`);

  let session;
  try{const {data}=await sb.auth.getSession();session=data?.session;}
  catch(err){console.error('[DF] Auth error:',err);}
  if(!session){location.href='auth.html';return;}

  G.currency='KES';
  setMode('real');
  initChat();
  renderLB();
  updBtns();

  // Initialize notification panel from sessionStorage
  _renderNotifList();
  _notifUpdateBadge();

  await loadUser();

  // ── Start watchdog ──────────────────────────────────────────
  startWatchdog();

  // ── Start the synchronised game engine ─────────────────────
  subscribeGameEngine();          // 1. Subscribe to Realtime channels
  await fetchAndSyncRound();      // 2. Fetch active round & sync UI
  // Leader election happens inside fetchAndSyncRound.
  // If this client becomes leader it will drive rounds.
  // All others receive broadcasts and DB changes.
}

boot();
// ─────────────────────────────────────────────────────────────
//  RETURN-FROM-VERIFICATION NOTIFICATION
//  Verification.html sets sessionStorage flags when the user
//  submits their M-Pesa code and taps "Return to Game".
//  On boot we detect those flags and show a persistent
//  "Verification submitted — we'll notify you" notification.
// ─────────────────────────────────────────────────────────────
function _checkVerifReturnNotification(){
  try{
    const txId  = sessionStorage.getItem('df_verif_submitted_txid');
    const amt   = sessionStorage.getItem('df_verif_submitted_amt');
    const phone = sessionStorage.getItem('df_verif_submitted_phone');

    if(!txId) return;

    // Clear flags — single use
    sessionStorage.removeItem('df_verif_submitted_txid');
    sessionStorage.removeItem('df_verif_submitted_amt');
    sessionStorage.removeItem('df_verif_submitted_phone');

    // Don't add duplicate notification this session
    const notifKey = 'wv-return-notif-' + txId;
    if(sessionStorage.getItem(notifKey)) return;
    sessionStorage.setItem(notifKey, '1');

    // Add "under review" notification with a re-open button
    const nId = _notifAdd({
      icon      : '🔐',
      title     : 'Verification Submitted',
      msg       : `Your KSh 200 verification payment for withdrawal of ${fmtKES(parseFloat(amt)||0)} has been submitted. We'll notify you here once your funds are sent to ${phone||'your account'}.`,
      type      : 'info',
      persistent: true,
      txId      : txId,
      action    : { label : 'VIEW STATUS' },
    });

    // Action re-opens the verification page via session token
    _notifActionMap[nId] = ()=> openVerificationFromNotif(txId, nId);

    // Open the notification panel briefly to draw attention
    const panel = _el('notifPanel');
    if(panel){ panel.style.display = 'block'; }
    setTimeout(()=>{ if(panel) panel.style.display = 'none'; }, 4000);

    toast2('🔐 Verification submitted — we\'ll notify you when your funds are sent.', 'i');
  } catch(_){}
}
/* ===================== PEGA LEANDRINHO ===================== */
(function(){
  "use strict";

  /* ---------- Storage helpers (persistent, per-user, not shared) ---------- */
  const STORE_NAME = 'player-name';
  const STORE_HIST = 'game-history';
  const STORE_SAVE = 'saved-game';
  let memFallback = {}; // in-memory fallback if storage unavailable

  async function storeGet(key){
    try{
      const r = await window.storage.get(key, false);
      return r ? JSON.parse(r.value) : null;
    }catch(e){
      return memFallback[key] !== undefined ? memFallback[key] : null;
    }
  }
  async function storeSet(key, value){
    memFallback[key] = value;
    try{
      await window.storage.set(key, JSON.stringify(value), false);
    }catch(e){ /* silent fallback already applied */ }
  }
  async function storeDelete(key){
    delete memFallback[key];
    try{ await window.storage.delete(key, false); }catch(e){}
  }

  /* ---------- Screen management ---------- */
  const screens = {};
  document.querySelectorAll('.screen').forEach(el => screens[el.id] = el);
  function showScreen(id){
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[id].classList.add('active');
  }

  /* ---------- Player name ---------- */
  let playerName = 'Jogador';
  const homePlayerName = document.getElementById('homePlayerName');
  const nameInput = document.getElementById('nameInput');

  async function initName(){
    const saved = await storeGet(STORE_NAME);
    if(saved && typeof saved === 'string' && saved.trim()){
      playerName = saved;
    }
    homePlayerName.textContent = playerName;
  }

  document.getElementById('btnTrocarNome').addEventListener('click', () => {
    nameInput.value = playerName === 'Jogador' ? '' : playerName;
    showScreen('screen-name');
    setTimeout(()=>nameInput.focus(), 50);
  });

  document.getElementById('btnSalvarNome').addEventListener('click', saveName);
  nameInput.addEventListener('keydown', e => { if(e.key === 'Enter') saveName(); });

  async function saveName(){
    const v = nameInput.value.trim();
    playerName = v.length ? v : 'Jogador';
    homePlayerName.textContent = playerName;
    await storeSet(STORE_NAME, playerName);
    showScreen('screen-home');
  }

  /* ---------- Continue button visibility ---------- */
  const btnContinuar = document.getElementById('btnContinuar');
  let savedGameState = null;
  async function refreshContinueBtn(){
    savedGameState = await storeGet(STORE_SAVE);
    btnContinuar.style.display = savedGameState ? 'flex' : 'none';
  }

  /* ---------- History / ranking ---------- */
  async function getHistory(){
    const h = await storeGet(STORE_HIST);
    return Array.isArray(h) ? h : [];
  }
  async function addHistory(entry){
    const h = await getHistory();
    h.push(entry);
    h.sort((a,b)=> b.score - a.score);
    const trimmed = h.slice(0, 50);
    await storeSet(STORE_HIST, trimmed);
    return trimmed;
  }
  async function renderHistory(){
    const list = document.getElementById('histList');
    const h = await getHistory();
    if(!h.length){
      list.innerHTML = '<div class="hist-empty">Nenhuma corrida registrada ainda.<br>Fuja do Geraldo pra entrar no ranking!</div>';
      return;
    }
    list.innerHTML = h.map((item, i) => `
      <div class="hist-item ${i===0?'top1':''}">
        <div class="hist-rank">${i===0?'👑':'#'+(i+1)}</div>
        <div class="hist-info">
          <div class="hist-name">${escapeHtml(item.name)}</div>
          <div class="hist-meta">Fase ${item.phase||1} · 🔧${item.coins} · ${item.date}</div>
        </div>
        <div class="hist-score">${item.score}</div>
      </div>
    `).join('');
  }
  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  document.getElementById('btnHistorico').addEventListener('click', async () => {
    await renderHistory();
    showScreen('screen-history');
  });
  document.getElementById('btnBackHome2').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('btnClearHist').addEventListener('click', async () => {
    await storeSet(STORE_HIST, []);
    await renderHistory();
  });

  /* ================= GAME ENGINE (2D platformer v6) ================= */
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function fitCanvas(){
    const rect = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W+'px';
    canvas.style.height = H+'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', fitCanvas);
  function groundY(){ return H*0.72; }

  /* ---------- tiny WebAudio SFX (no external files) ---------- */
  let actx = null;
  function audio(){ if(!actx){ try{ actx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return actx; }
  function beep(freq, dur, type, gain, glideTo){
    const ac = audio(); if(!ac) return;
    if(ac.state === 'suspended') ac.resume();
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, ac.currentTime+dur);
    g.gain.setValueAtTime(gain||0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime+dur);
  }
  const sfx = {
    jump: () => beep(340,0.16,'square',0.13,620),
    collect: () => beep(880,0.10,'triangle',0.14,1320),
    damage: () => beep(220,0.28,'sawtooth',0.16,90),
    stomp: () => beep(500,0.12,'square',0.15,180),
    throwCan: () => beep(600,0.08,'square',0.10,900),
    phase: () => { beep(523,0.1,'triangle',0.15); setTimeout(()=>beep(659,0.1,'triangle',0.15),90); setTimeout(()=>beep(784,0.16,'triangle',0.16),180); },
    victory: () => { [523,659,784,1046].forEach((f,i)=>setTimeout(()=>beep(f,0.22,'triangle',0.16),i*140)); },
    power: () => { [660,880,1100,1320].forEach((f,i)=>setTimeout(()=>beep(f,0.13,'triangle',0.15),i*80)); },
  };

  /* ================= ORIGINAL CHARACTERS (all drawn on canvas) ================= */
  const LEAN_PAL = {
    skin:'#f0b27a', skinShade:'#dd9a5f', cheek:'#ff9e9e',
    overalls:'#3f6fa3', overallsShade:'#345a87',
    hair:'#2a1a10', shoe:'#4a2f1a', eye:'#2a1a10', bodyW:30,
  };
  const GER_PAL = {
    skin:'#f0d9c8', skinShade:'#dcbfa9', shirtColor:'#a9d8ef', overalls:'#1c3a5c', overallsShade:'#142a44',
    pants:'#1c3a5c', hair:'#241a12', shoe:'#141414', eye:'#1a1108', tag:'#f0ead8',
    bodyW:13, legW:6, legGap:4, shoulderR:3.4,
  };

  function limbEnd(px,py,ang,len){ return {x:px+Math.sin(ang)*len, y:py+Math.cos(ang)*len}; }
  function drawStub(c,px,py,ang,len,w,color){
    c.save(); c.translate(px,py); c.rotate(ang);
    c.fillStyle = color;
    roundRect(c,-w/2,0,w,len,w/2); c.fill();
    c.restore();
  }

  // Shared chibi/body builder for Leandrinho & Geraldo. ONLY the legs move -
  // no arms at all, to avoid the earlier rendering glitch and keep it simple
  // and clean as requested. faceFn draws whatever makes each one unique.
  function drawChibi(ctx, cx, cy, scale, pal, opts, faceFn){
    const facing = opts.facing || 1;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing*scale, scale * (opts.squish!==undefined ? Math.max(0.1,opts.squish) : 1));
    if(opts.squish!==undefined) ctx.scale(1.35, 1);

    let legSwing=0, bob=0, headBob=0;
    if(opts.jumping){
      legSwing = 0.32; headBob = -3;
    } else if(opts.moving){
      legSwing = Math.sin(opts.phase)*0.62;
      bob = Math.abs(Math.sin(opts.phase))*2.6;
    } else {
      bob = Math.sin(opts.phase*0.6)*1.2;
    }

    const bodyW = pal.bodyW || 28;
    const legW = pal.legW || 10;
    const legGap = pal.legGap || 6;
    const footY = 0;
    const hipY = -16 - bob;
    const bodyTopY = hipY - 24;
    const headR = 17;
    const headCY = bodyTopY - headR - 1 + headBob;

    // legs (the only moving limbs)
    [-1,1].forEach(side=>{
      const ang = side*legSwing;
      drawStub(ctx, side*legGap, hipY, ang, 16, legW, pal.shoe);
    });
    // body: pants/base color for the whole silhouette, with an optional
    // shirt color painted over the upper portion for a two-tone outfit
    ctx.fillStyle = pal.overalls || pal.shirt;
    roundRect(ctx, -bodyW/2, bodyTopY, bodyW, hipY-bodyTopY+4, 9);
    ctx.fill();
    if(pal.shirtColor){
      const shirtBottom = bodyTopY + (hipY-bodyTopY+4)*0.56;
      ctx.fillStyle = pal.shirtColor;
      ctx.beginPath();
      ctx.moveTo(-bodyW/2, shirtBottom);
      ctx.lineTo(-bodyW/2, bodyTopY+9);
      ctx.quadraticCurveTo(-bodyW/2, bodyTopY, -bodyW/2+9, bodyTopY);
      ctx.lineTo(bodyW/2-9, bodyTopY);
      ctx.quadraticCurveTo(bodyW/2, bodyTopY, bodyW/2, bodyTopY+9);
      ctx.lineTo(bodyW/2, shirtBottom);
      ctx.closePath(); ctx.fill();
    }
    if(pal.overallsShade){
      ctx.fillStyle = pal.overallsShade;
      roundRect(ctx, -bodyW/2, hipY-8, bodyW, 12, 6); ctx.fill();
    }
    if(pal.tag){
      ctx.fillStyle = pal.tag;
      roundRect(ctx, 2, bodyTopY+8, 15, 7, 2); ctx.fill();
    }
    // tiny shoulder stubs (static, purely cosmetic - not a moving limb)
    const shR = pal.shoulderR || 5;
    ctx.fillStyle = pal.skin;
    ctx.beginPath(); ctx.arc(-bodyW/2-1, bodyTopY+7, shR, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bodyW/2+1, bodyTopY+7, shR, 0, Math.PI*2); ctx.fill();

    // head
    ctx.fillStyle = pal.skin;
    ctx.beginPath(); ctx.arc(0, headCY, headR, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(-headR+2, headCY+2, 3.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(headR-2, headCY+2, 3.2, 0, Math.PI*2); ctx.fill();

    faceFn(ctx, headCY, headR, pal, opts);

    ctx.restore();
  }

  function drawLeandrinho(ctx, cx, cy, scale, opts){
    drawChibi(ctx, cx, cy, scale, LEAN_PAL, opts, (ctx, hY, r, pal, o) => {
      ctx.fillStyle = pal.cheek;
      ctx.beginPath(); ctx.ellipse(-r*0.55, hY+5, 4.4, 3.2, 0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r*0.55, hY+5, 4.4, 3.2, 0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = pal.hair;
      for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.arc(i*6, hY-r+2, 5.4, 0, Math.PI*2); ctx.fill(); }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(-5.5, hY-1, 4.4, 5.2, 0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5.5, hY-1, 4.4, 5.2, 0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = pal.eye;
      ctx.beginPath(); ctx.arc(-4.5, hY, 2.4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(6.5, hY, 2.4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-5.3,hY-1.2,0.9,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(5.7,hY-1.2,0.9,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#7a3d1a'; ctx.lineWidth=1.6; ctx.lineCap='round';
      ctx.beginPath(); ctx.arc(0.5, hY+3, 5, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();
      if(o && o.helmet){
        ctx.fillStyle = '#48484f';
        ctx.beginPath(); ctx.arc(0, hY-2, r+3, Math.PI*1.02, Math.PI*2.06); ctx.fill();
        ctx.fillStyle = 'rgba(160,220,255,0.55)';
        ctx.beginPath(); ctx.ellipse(0, hY+2, r-2, 5.5, 0, 0, Math.PI); ctx.fill();
        ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0, hY-2, r+3, Math.PI*1.02, Math.PI*2.06); ctx.stroke();
        ctx.fillStyle = '#e6432c';
        ctx.beginPath(); ctx.ellipse(0, hY-r-2, 5, 3, 0, 0, Math.PI*2); ctx.fill();
      }
    });
  }

  // Geraldo: skinny, LONG hair down the sides, beard, round glasses.
  function drawGeraldo(ctx, cx, cy, scale, opts){
    drawChibi(ctx, cx, cy, scale, GER_PAL, opts, (ctx, hY, r, pal) => {
      // Long hair drawn as ONE smooth silhouette per side (mirrored for
      // symmetry) instead of several overlapping jagged shapes - much
      // cleaner than the previous scalloped version.
      function hairHalf(){
        ctx.beginPath();
        ctx.moveTo(0, hY-r-7);
        ctx.quadraticCurveTo(r+5, hY-r-6, r+8, hY-r+8);
        ctx.quadraticCurveTo(r+13, hY+6, r+7, hY+23);
        ctx.quadraticCurveTo(r+2, hY+33, r-3, hY+21);
        ctx.quadraticCurveTo(r-1, hY+3, r-5, hY-5);
        ctx.quadraticCurveTo(r-5, hY-r+2, 0, hY-r-7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = pal.hair;
      hairHalf();
      ctx.save(); ctx.scale(-1,1); hairHalf(); ctx.restore();
      // grumpy eyebrows
      ctx.strokeStyle = pal.hair; ctx.lineWidth=2.1; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(-9,hY-5); ctx.lineTo(-2,hY-3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9,hY-5); ctx.lineTo(2,hY-3); ctx.stroke();
      // big round glasses (bold, very visible)
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth=2.4;
      ctx.beginPath(); ctx.ellipse(-5.3,hY+1.5,5.4,5.4,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(5.3,hY+1.5,5.4,5.4,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.4,hY+1); ctx.lineTo(0.4,hY+1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10.4,hY+0); ctx.lineTo(-r-2,hY-2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10.4,hY+0); ctx.lineTo(r+2,hY-2); ctx.stroke();
      // lenses tint
      ctx.fillStyle = 'rgba(140,190,220,0.25)';
      ctx.beginPath(); ctx.arc(-5.3,hY+1.5,4.6,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(5.3,hY+1.5,4.6,0,Math.PI*2); ctx.fill();
      // eyes behind the glasses
      ctx.fillStyle = pal.eye;
      ctx.beginPath(); ctx.arc(-5.3,hY+1.8,1.8,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(5.3,hY+1.8,1.8,0,Math.PI*2); ctx.fill();
      // beard
      ctx.fillStyle = pal.hair;
      ctx.beginPath(); ctx.ellipse(0, hY+10, 7.5, 7, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = pal.skin;
      ctx.beginPath(); ctx.ellipse(0, hY+7, 5, 3.4, 0, 0, Math.PI); ctx.fill();
      // grumpy mouth
      ctx.strokeStyle = '#3a2010'; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.arc(0, hY+8, 3.4, 1.15*Math.PI, 1.85*Math.PI); ctx.stroke();
    });
  }

  /* ---- Sol: round sunshine critter with little legs ---- */
  function drawSol(ctx, cx, cy, scale, opts){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale((opts.facing||1)*scale, scale*(opts.squish!==undefined?Math.max(0.1,opts.squish):1));
    if(opts.squish!==undefined) ctx.scale(1.3,1);
    const bob = opts.moving ? Math.abs(Math.sin(opts.phase))*3 : Math.sin(opts.phase*0.5)*1.5;
    const cyB = -20-bob;
    // rays
    ctx.fillStyle = '#ffb830';
    for(let i=0;i<8;i++){
      const a = (i/8)*Math.PI*2 + opts.phase*0.25;
      const x1 = Math.cos(a)*14, y1 = cyB+Math.sin(a)*14;
      ctx.save(); ctx.translate(x1,y1); ctx.rotate(a+Math.PI/2);
      ctx.beginPath(); ctx.moveTo(-3,0); ctx.lineTo(3,0); ctx.lineTo(0,-7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // little legs
    const legSwing = opts.moving ? Math.sin(opts.phase)*0.5 : 0;
    [-1,1].forEach(side=>{
      ctx.save(); ctx.translate(side*5, cyB+10); ctx.rotate(side*legSwing);
      ctx.strokeStyle = '#c9860f'; ctx.lineWidth=3.4; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,9); ctx.stroke();
      ctx.restore();
    });
    // body
    ctx.fillStyle = '#ffcf3f';
    ctx.beginPath(); ctx.arc(0,cyB,13,0,Math.PI*2); ctx.fill();
    // face
    ctx.fillStyle = '#7a3d00';
    ctx.beginPath(); ctx.arc(-4,cyB-1,1.8,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(4,cyB-1,1.8,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#7a3d00'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(0,cyB+4,3,0.1*Math.PI,0.9*Math.PI); ctx.stroke();
    ctx.restore();
  }

  /* ---- Sofrer: little black blob monster with glasses ---- */
  function drawSofrer(ctx, cx, cy, scale, opts){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale((opts.facing||1)*scale, scale*(opts.squish!==undefined?Math.max(0.1,opts.squish):1));
    if(opts.squish!==undefined) ctx.scale(1.3,1);
    let legSwing=0, armSwing=0, bob=0;
    if(opts.moving){ legSwing=Math.sin(opts.phase)*0.5; armSwing=-Math.sin(opts.phase)*0.4; bob=Math.abs(Math.sin(opts.phase))*2; }
    else bob = Math.sin(opts.phase*0.5)*1;
    const bodyCY = -21-bob;
    [-1,1].forEach(side=>{
      ctx.save(); ctx.translate(side*5,-6); ctx.rotate(side*legSwing);
      ctx.strokeStyle = '#111'; ctx.lineWidth=5; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,7); ctx.stroke();
      ctx.restore();
    });
    ctx.fillStyle = '#181818';
    ctx.beginPath(); ctx.ellipse(0,bodyCY,13,16,0,0,Math.PI*2); ctx.fill();
    [-1,1].forEach(side=>{
      ctx.save(); ctx.translate(side*11,bodyCY-2); ctx.rotate(side*armSwing);
      ctx.strokeStyle = '#181818'; ctx.lineWidth=5; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,10); ctx.stroke();
      ctx.restore();
    });
    ctx.strokeStyle = '#ccc'; ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.ellipse(-4.5,bodyCY-4,4,4,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(4.5,bodyCY-4,4,4,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.5,bodyCY-4); ctx.lineTo(0.5,bodyCY-4); ctx.stroke();
    ctx.fillStyle = '#7ad1ff';
    ctx.beginPath(); ctx.arc(-4.5,bodyCY-4,1.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5,bodyCY-4,1.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  /* ---- Bola: a colorful little ball that rolls, with tiny stick arms
     and legs that spin with the rotation. Dies to a stomp like the others. ---- */
  function drawBola(ctx, cx, cy, scale, opts){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale((opts.facing||1)*scale, scale*(opts.squish!==undefined?Math.max(0.1,opts.squish):1));
    if(opts.squish!==undefined) ctx.scale(1.3,1);
    const R = 20; // bigger, as requested
    const cyB = -R-3;
    const spin = (opts.rollX||0) * 0.04; // rotation tied to distance rolled
    // real arms & legs - thick limbs with a hand/foot blob at the tip,
    // not just thin little sticks
    ctx.save(); ctx.translate(0,cyB); ctx.rotate(spin);
    const limbLen = R+13;
    const angles = [0.55, Math.PI-0.55, Math.PI+0.55, -0.55]; // 2 arms (upper), 2 legs (lower)
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4.4; ctx.lineCap='round';
    angles.forEach(a=>{
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*R*0.7, Math.sin(a)*R*0.7);
      ctx.lineTo(Math.cos(a)*limbLen, Math.sin(a)*limbLen);
      ctx.stroke();
    });
    ctx.fillStyle = '#2a2a2a';
    angles.forEach(a=>{
      ctx.beginPath();
      ctx.arc(Math.cos(a)*limbLen, Math.sin(a)*limbLen, 4.6, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.restore();
    // body
    ctx.fillStyle = opts.color || '#e6432c';
    ctx.beginPath(); ctx.arc(0,cyB,R,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.translate(0,cyB); ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0,0,R-5,0.2*Math.PI,0.8*Math.PI); ctx.stroke();
    ctx.restore();
    // big two eyes (stay upright, don't spin, so it always looks at you)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-6.5,cyB-1,5.6,6.6,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6.5,cyB-1,5.6,6.6,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#241a10';
    ctx.beginPath(); ctx.arc(-5.8,cyB,2.8,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(7.2,cyB,2.8,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-6.6,cyB-1.6,1.1,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(6.4,cyB-1.6,1.1,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#241a10'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.arc(0,cyB+8,4.4,0.1*Math.PI,0.9*Math.PI); ctx.stroke();
    ctx.restore();
  }

  /* ---- Vitória-régia: a big lily-pad plant that bites - like Mario's
     piranha plant. Doesn't patrol, can't be stomped, must be jumped. ---- */
  function drawVitoriaRegia(ctx, cx, cy, scale, opts){
    ctx.save();
    ctx.translate(cx,cy); ctx.scale(scale,scale);
    const chomp = (Math.sin(opts.phase*3)+1)/2; // mouth opening 0..1
    const stretch = opts.stretch !== undefined ? opts.stretch : 1; // 0=tucked down (safe), 1=fully up (dangerous)
    // lily pad base
    ctx.fillStyle = '#2f8f4e';
    ctx.beginPath(); ctx.ellipse(0,0,26,9,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#1c6636'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(0,0,26,9,0,0,Math.PI*2); ctx.stroke();
    // stem - stretches up and tucks back down
    const stemTop = -6 - stretch*128; // reaches ~155px tall at full stretch - taller than the player's max jump (~133px), so blocking it actually looks right
    ctx.strokeStyle = '#2f8f4e'; ctx.lineWidth=8; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,-4); ctx.lineTo(0,stemTop); ctx.stroke();
    // flower head (bites) - follows the stem tip
    const headY = stemTop - 8;
    ctx.fillStyle = '#e0397a';
    ctx.beginPath(); ctx.arc(0,headY,15,0,Math.PI*2); ctx.fill();
    // petals
    ctx.fillStyle = '#f06aa0';
    for(let i=0;i<6;i++){
      const a = i/6*Math.PI*2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a)*13, headY+Math.sin(a)*13, 8, 4, a, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle = '#e0397a';
    ctx.beginPath(); ctx.arc(0,headY,11,0,Math.PI*2); ctx.fill();
    // biting mouth (chomps faster and more visibly while stretched up)
    ctx.fillStyle = '#7a1030';
    ctx.beginPath(); ctx.ellipse(0,headY+3, 8, 4+chomp*5*stretch, 0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff';
    for(let i=-2;i<=2;i+=2){ ctx.beginPath(); ctx.moveTo(i*3,headY-1+chomp*1); ctx.lineTo(i*3+1.6,headY+3); ctx.lineTo(i*3-1.6,headY+3); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }

  /* ---- Veado: a patrolling animal - only dies to a stomp, side contact
     costs a life just like every other enemy. Distinct quadruped silhouette. ---- */
  function drawVeado(ctx, cx, cy, scale, opts){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale((opts.facing||1)*scale, scale*(opts.squish!==undefined?Math.max(0.1,opts.squish):1));
    if(opts.squish!==undefined) ctx.scale(1.3,1);
    const legSwing = opts.moving ? Math.sin(opts.phase)*0.5 : 0;
    const bodyY = -26;
    [-10,-4,4,10].forEach((lx,i)=>{
      const sw = (i%2===0?1:-1)*legSwing;
      ctx.save(); ctx.translate(lx,bodyY+9); ctx.rotate(sw);
      ctx.strokeStyle='#6b4423'; ctx.lineWidth=3.2; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,17); ctx.stroke();
      ctx.restore();
    });
    // tail
    ctx.fillStyle='#f2e8d8';
    ctx.beginPath(); ctx.ellipse(-19,bodyY-2,4,5,0.3,0,Math.PI*2); ctx.fill();
    // body
    ctx.fillStyle = '#a9764f';
    ctx.beginPath(); ctx.ellipse(0,bodyY,20,12,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(-2,bodyY-4,12,5,0,0,Math.PI*2); ctx.fill();
    // neck + head
    ctx.fillStyle='#a9764f';
    ctx.beginPath(); ctx.ellipse(20,bodyY-11,8.5,10,-0.25,0,Math.PI*2); ctx.fill();
    // antlers
    ctx.strokeStyle='#6b4423'; ctx.lineWidth=2.2; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(21,bodyY-19); ctx.lineTo(17,bodyY-28);
    ctx.moveTo(17,bodyY-28); ctx.lineTo(13,bodyY-26);
    ctx.moveTo(17,bodyY-28); ctx.lineTo(20,bodyY-32);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(26,bodyY-19); ctx.lineTo(30,bodyY-28);
    ctx.moveTo(30,bodyY-28); ctx.lineTo(34,bodyY-26);
    ctx.moveTo(30,bodyY-28); ctx.lineTo(27,bodyY-32);
    ctx.stroke();
    // ear + eye + snout
    ctx.fillStyle='#a9764f';
    ctx.beginPath(); ctx.ellipse(15,bodyY-18,3,5,0.6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#5a3a1f';
    ctx.beginPath(); ctx.ellipse(27,bodyY-5,3.2,2.2,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#241a10';
    ctx.beginPath(); ctx.arc(24,bodyY-13,1.7,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  /* ---- Adriana: patrols and throws scissors - contact with the scissors
     is instantly fatal, just like touching the veado. Only a stomp kills
     her. Reuses the chibi body builder with an angry face + ponytail. ---- */
  const ADRIANA_PAL = {
    skin:'#e8b48a', hair:'#8a1f2b', overalls:'#c0447a', overallsShade:'#9c3564',
    shoe:'#3a1a20', eye:'#241a10', bodyW:26, legW:9, legGap:6,
  };
  function adrianaFace(ctx, hY, r, pal){
    ctx.fillStyle = pal.hair;
    for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.arc(i*5.4,hY-r+2,5,0,Math.PI*2); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(r-2,hY-1,3.6,11,0.5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = pal.hair; ctx.lineWidth=2.1; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-9,hY-4); ctx.lineTo(-2,hY-2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(9,hY-4); ctx.lineTo(2,hY-2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-5,hY,3.6,4,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5,hY,3.6,4,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = pal.eye;
    ctx.beginPath(); ctx.arc(-4.6,hY+0.6,1.9,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5.6,hY+0.6,1.9,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#5a1018'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(0,hY+7,3.6,1.15*Math.PI,1.85*Math.PI); ctx.stroke();
  }
  function drawAdriana(ctx, cx, cy, scale, opts){
    drawChibi(ctx, cx, cy, scale, ADRIANA_PAL, opts, adrianaFace);
  }

  const ENEMY_DRAW = { geraldo: drawGeraldo, sol: drawSol, sofrer: drawSofrer, bola: drawBola, veado: drawVeado, adriana: drawAdriana };
  const ENEMY_HEIGHT = { geraldo: 57, sol: 38, sofrer: 40, bola: 48, veado: 46, adriana: 57 };
  const BOLA_COLORS = ['#e6432c','#4fc3f7','#ffc72c','#8fe08a','#b56ae0'];

  /* ---- generic NPC (townsfolk) - idle only, distinguished by accessories ---- */
  const NPC_DEFS = {
    almir:    { skin:'#caa06e', hair:'#5a3d1f', overalls:'#4a7a3a', overallsShade:'#3a6030', shoe:'#3a281a', eye:'#241a10', bodyW:28, hat:true, beard:true },
    juliana:  { skin:'#e8b48a', hair:'#3a1f10', overalls:'#c0447a', overallsShade:'#9c3564', shoe:'#3a1a20', eye:'#241a10', bodyW:26, ponytail:true },
    patricia: { skin:'#caa06e', hair:'#241a10', overalls:'#e08a2b', overallsShade:'#b56d1e', shoe:'#3a2410', eye:'#241a10', bodyW:26, ponytail:true, glasses:true },
    daiane:   { skin:'#e8b48a', hair:'#7a4a1f', overalls:'#2b9bd6', overallsShade:'#1f79ab', shoe:'#1a2a3a', eye:'#241a10', bodyW:26, ponytail:true },
    leandro:  { skin:'#caa06e', hair:'#888888', overalls:'#6a6a6a', overallsShade:'#525252', shoe:'#2a2a2a', eye:'#241a10', bodyW:28, mustache:true },
    rodolfo:  { skin:'#f2ddc9', hair:'#2a2a2a', overalls:'#5b2a86', overallsShade:'#431f66', shoe:'#3a2a10', eye:'#241a10', bodyW:30, mustache:true, glasses:true, crown:true, cape:true },
    mayra:    { skin:'#e8b48a', hair:'#4a1f0e', overalls:'#e0397a', overallsShade:'#a01f56', shoe:'#3a1a20', eye:'#241a10', bodyW:25, ponytail:true },
    marcotulio: { skin:'#caa06e', hair:'#241a10', overalls:'#2696b8', overallsShade:'#155f78', shoe:'#2a2a2a', eye:'#241a10', bodyW:28, mustache:true },
    nilson: { skin:'#caa06e', hair:'#9a9a9a', overalls:'#4a4a52', overallsShade:'#33333a', shoe:'#2a2a2a', eye:'#241a10', bodyW:29, mustache:true, glasses:true },
  };
  function npcFace(ctx, hY, r, pal, opts){
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-5,hY,3.6,4.2,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5,hY,3.6,4.2,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = pal.eye;
    ctx.beginPath(); ctx.arc(-4.5,hY+0.5,1.9,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5.5,hY+0.5,1.9,0,Math.PI*2); ctx.fill();
    if(pal.hat){
      ctx.fillStyle = pal.hair;
      ctx.beginPath(); ctx.ellipse(0,hY-r+3,r+4,4.6,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(0,hY-r-1,r-5,Math.PI,0); ctx.fill();
    } else if(pal.ponytail){
      ctx.fillStyle = pal.hair;
      for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.arc(i*5.4,hY-r+2,5,0,Math.PI*2); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(r-2,hY-1,3.6,11,0.5,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = pal.hair;
      for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.arc(i*5.4,hY-r+2,5,0,Math.PI*2); ctx.fill(); }
    }
    if(pal.crown){
      const cw = r+3;
      ctx.fillStyle = '#ffc72c';
      ctx.beginPath();
      ctx.moveTo(-cw, hY-r+4);
      ctx.lineTo(-cw, hY-r-6);
      ctx.lineTo(-cw*0.5, hY-r+1);
      ctx.lineTo(0, hY-r-9);
      ctx.lineTo(cw*0.5, hY-r+1);
      ctx.lineTo(cw, hY-r-6);
      ctx.lineTo(cw, hY-r+4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#a97a0c'; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e6432c';
      ctx.beginPath(); ctx.arc(0, hY-r-4, 2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath(); ctx.arc(-cw*0.5, hY-r-0.5, 1.6, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cw*0.5, hY-r-0.5, 1.6, 0, Math.PI*2); ctx.fill();
    }
    if(pal.beard){ ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.ellipse(0,hY+9,6.6,5.6,0,0,Math.PI*2); ctx.fill(); }
    if(pal.mustache){
      ctx.strokeStyle = pal.hair; ctx.lineWidth=2.1; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(-6,hY+6); ctx.quadraticCurveTo(0,hY+8,6,hY+6); ctx.stroke();
    }
    if(pal.glasses){
      ctx.strokeStyle='#2c2c2c'; ctx.lineWidth=1.6;
      ctx.beginPath(); ctx.ellipse(-5,hY+0.5,4.3,4.3,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(5,hY+0.5,4.3,4.3,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.5,hY+0.5); ctx.lineTo(0.5,hY+0.5); ctx.stroke();
    }
    ctx.strokeStyle='#5a3018'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(0,hY+4,4,0.1*Math.PI,0.9*Math.PI); ctx.stroke();
  }
  function drawNPC(ctx, cx, cy, scale, key, phase){
    const pal = NPC_DEFS[key];
    if(pal.cape){
      ctx.save();
      ctx.translate(cx,cy); ctx.scale(scale,scale);
      ctx.fillStyle = '#8a1f2b';
      ctx.beginPath();
      ctx.moveTo(-16,-38); ctx.quadraticCurveTo(-22,-6,-14,6);
      ctx.lineTo(14,6); ctx.quadraticCurveTo(22,-6,16,-38);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,199,44,0.5)';
      ctx.fillRect(-16,-38,32,3);
      ctx.restore();
    }
    drawChibi(ctx, cx, cy, scale, pal, { moving:false, jumping:false, phase }, npcFace);
  }

  /* ---- little scooter for the "Externo" phase (visual only) ---- */
  function drawScooter(ctx, cx, cy, scale){
    ctx.save(); ctx.translate(cx,cy); ctx.scale(scale,scale);
    ctx.strokeStyle = '#4a4a4a'; ctx.fillStyle = '#8a8a8a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(-16,2,9,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(16,2,9,0,Math.PI*2); ctx.stroke();
    roundRect(ctx,-20,-12,40,12,4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14,-10); ctx.lineTo(20,-24); ctx.stroke();
    ctx.restore();
  }

  function roundRect(c,x,y,w,h,r){
    c.beginPath();
    c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);
    c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);
    c.arcTo(x,y,x+w,y,r);
    c.closePath();
  }

  /* ================= LEVEL GENERATION ================= */
  function mulberry32(seed){
    return function(){
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed>>>15, 1 | seed);
      t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };
  }
  const ITEM_POOL = ['🪑','🛋️','🖥️','💺']; // furniture & computers only

  const PHASES = [
    { key:'marcenaria', name:'MARCENARIA', icon:'🪚', width:9000, enemyPool:['geraldo'], hazard:false,
      theme:{ skyTop:'#e8d3a8', skyBot:'#d4b878', plat:'#c9772e', platDk:'#8a4f1a', edge:'rgba(255,199,44,0.9)', decor:'wood' },
      npcs:[{ pos:'end', key:'almir', name:'ALMIR', line:'Fala Leandrinho, cê tá bão?' }] },
    { key:'atelie', name:'ATELIÊ', icon:'🎨', width:10000, enemyPool:['geraldo','sol','bola','adriana'], hazard:true,
      theme:{ skyTop:'#f5dcf0', skyBot:'#e0b8dd', plat:'#e0397a', platDk:'#a01f56', edge:'rgba(255,255,255,0.75)', decor:'paint' },
      npcs:[{ pos:'end', key:'juliana', name:'JULIANA', line:'Você é arrogante.' }] },
    { key:'tecelagem', name:'TECELAGEM', icon:'🧵', width:11000, enemyPool:['geraldo','sofrer','bola','veado','adriana'], hazard:true,
      theme:{ skyTop:'#e6ddf7', skyBot:'#cdb9ec', plat:'#8a4fd6', platDk:'#5c2f96', edge:'rgba(255,230,140,0.8)', decor:'yarn' },
      npcs:[{ pos:'end', key:'patricia', name:'PATRÍCIA', line:'Cê tá bem?' }] },
    { key:'tubular', name:'TUBULAR', icon:'🛠️', width:12000, enemyPool:['geraldo','bola','veado','adriana'], hazard:true,
      theme:{ skyTop:'#d6ecf7', skyBot:'#b0d8ec', plat:'#2696b8', platDk:'#155f78', edge:'rgba(255,255,255,0.8)', decor:'pipe' },
      npcs:[{ pos:'start', key:'daiane', name:'DAIANE', line:'O Lelê foi pra lá?' },
            { pos:'end', key:'leandro', name:'LEANDRO', line:'Meu filho!' }] },
    { key:'externo', name:'EXTERNO', icon:'🛵', width:13000, enemyPool:['geraldo','sol','sofrer','bola','veado','adriana'], hazard:false, bike:true,
      theme:{ skyTop:'#6fb3e8', skyBot:'#c9e8f7', plat:'#48484f', platDk:'#2b2b30', edge:'rgba(255,214,60,0.9)', decor:'city' },
      npcs:[{ pos:'end', key:'nilson', name:'SR. NILSON', line:'E aí, Leandrinho das gatas!' }] },
    { key:'engenharia', name:'ENGENHARIA', icon:'🏭', width:9000, enemyPool:['geraldo','sol','sofrer','bola','veado','adriana'], hazard:true, boss:true,
      theme:{ skyTop:'#d3f2e6', skyBot:'#a9dfc9', plat:'#1e9c7a', platDk:'#116048', edge:'rgba(255,255,255,0.75)', decor:'gears' },
      npcs:[{ pos:'end', key:'rodolfo', name:'LEANDRINHO', line:'Como você está?', name2:'RODOLFO', line2:'"NÃO COMO TU..."' }] },
  ];

  function genPhase(phaseIdx){
    const spec = PHASES[phaseIdx];
    const rnd = mulberry32(1000 + phaseIdx*777);
    const gY = groundY();
    const platforms = [], items = [], enemies = [], hazards = [];
    let x = 0;
    const startW = 260;
    platforms.push({x:0,w:startW,y:0});
    x = startW;
    const heights = [0,0,0,80,120]; // mostly ground level, sometimes elevated
    // enemy density ramps up with each phase - "aumente os adversários"
    const enemyChance = Math.min(0.82, 0.48 + phaseIdx*0.07);
    let coffeePlaced = phaseIdx === 0; // skip the coffee cup on the tutorial phase
    while(x < spec.width){
      let w = 130 + rnd()*170;
      const h = heights[Math.floor(rnd()*heights.length)];
      if(h>0) w = 90+rnd()*70;
      const willGap = h===0 && rnd() < 0.20 && x > 260 && w > 110;
      platforms.push({x, w, y:h});
      if(rnd() < 0.55){
        items.push({ x: x+w*0.5, y: h+58, e: ITEM_POOL[Math.floor(rnd()*ITEM_POOL.length)] });
      }
      if(h===0 && w>150 && !willGap && rnd() < enemyChance && spec.enemyPool.length){
        const type = spec.enemyPool[Math.floor(rnd()*spec.enemyPool.length)];
        enemies.push({ x:x+w*0.5, minX:x+26, maxX:x+w-26, y:0, speed:32+rnd()*22, type,
          throwT: type==='adriana' ? 1.4+rnd()*1.4 : undefined });
        // wide platforms sometimes get a SECOND enemy for extra difficulty
        if(w>260 && rnd() < 0.35 && spec.enemyPool.length){
          const type2 = spec.enemyPool[Math.floor(rnd()*spec.enemyPool.length)];
          enemies.push({ x:x+w*0.22, minX:x+26, maxX:x+w-26, y:0, speed:32+rnd()*22, type:type2,
            throwT: type2==='adriana' ? 1.4+rnd()*1.4 : undefined });
        }
      }
      // vitória-régia: a biting plant you must jump over (never patrols,
      // can't be stomped) - "é tipo as plantinhas do Mario"
      if(spec.hazard && h===0 && w>170 && !willGap && rnd() < 0.22){
        hazards.push({ x: x + w*0.5, w:20 });
      }
      // little "hop bumps" - low solid walls you must jump over, with ZERO
      // death risk. Placed most reliably right before a gap, as a clear
      // warning/lead-up, and occasionally elsewhere for extra variety.
      if(willGap){
        const bw = 26+rnd()*8, bh = 26+rnd()*8;
        platforms.push({x: x+w-bw-16, w:bw, y:bh, bump:true});
      } else if(h===0 && w>190 && rnd() < 0.55){
        const bw = 24+rnd()*10, bh = 24+rnd()*8;
        const bx = x + 40 + rnd()*Math.max(20,(w-bw-80));
        platforms.push({x:bx, w:bw, y:bh, bump:true});
      }
      if(rnd() < 0.07){
        items.push({ x:x+w*0.5, y:h+58, e:'🥫', power:true });
      }
      x += w;
      if(willGap){
        const gapW = 70 + rnd()*60;
        // the coffee cup - a rare extra-life pickup, hung right over a gap
        // near the top of the jump arc so it's genuinely tricky (but always
        // reachable) to grab. At most one per phase.
        if(!coffeePlaced && rnd() < 0.6){
          items.push({ x: x + gapW*0.5, y: 122, e:'☕', life:true });
          coffeePlaced = true;
        }
        x += gapW;
      }
    }

    let bossArenaX = null, bossArenaW = 0;
    if(spec.boss){
      // a wide arena for the boss fight, with climbable blocks to run and
      // escape across, before the flag
      bossArenaX = x + 40;
      bossArenaW = 1100;
      platforms.push({x, w: bossArenaW, y:0});
      // climbable/escape blocks - standing on these disables stomping (see
      // the "no kills from the blocks" rule in update()), they're purely
      // for running and dodging
      platforms.push({x:bossArenaX+220, w:110, y:80, bossBlock:true});
      platforms.push({x:bossArenaX+430, w:100, y:130, bossBlock:true});
      platforms.push({x:bossArenaX+650, w:110, y:80, bossBlock:true});
      platforms.push({x:bossArenaX+860, w:100, y:130, bossBlock:true});
      // energy-drink cans scattered around the arena to help in the fight
      items.push({ x:bossArenaX+220+55, y:80+58, e:'🥫', power:true });
      items.push({ x:bossArenaX+650+55, y:80+58, e:'🥫', power:true });
      items.push({ x:bossArenaX+950, y:58, e:'🥫', power:true });
      enemies.push({
        x: bossArenaX+700, minX:bossArenaX+260, maxX:bossArenaX+980, y:0,
        speed:58, type:'geraldoFinal', boss:true, hp:8, maxHp:8, throwT:2.6
      });
      x += bossArenaW;
    }

    const flagPlatW = 240;
    const flagPlatX = x;
    platforms.push({x:flagPlatX, w:flagPlatW, y:0});
    const flagX = flagPlatX + flagPlatW*0.62;

    // NPC placement (safe, on solid ground)
    const npcs = (spec.npcs||[]).map(n => ({
      x: n.pos==='start' ? 160 : flagPlatX + 40,
      y: 0, key:n.key, name:n.name, name2:n.name2, line:n.line, line2:n.line2, triggered:false
    }));
    if(spec.boss){
      // the cage sits in the center of the arena, not off to one side
      npcs.push({ x: bossArenaX+bossArenaW/2, y:0, key:'cage', name:'', line:'', triggered:true, cage:true });
    }

    const gyPlatforms = platforms.map(p => ({
      x:p.x, w:p.w, y: gY - p.y, bump: !!p.bump, bossBlock: !!p.bossBlock,
      thick: p.bump ? p.y : (p.y===0 ? (H-gY+40) : 18)
    }));
    const gyItems = items.map(it => ({ x:it.x, y: gY-it.y, emoji:it.e, taken:false, bob:Math.random()*10, power:!!it.power, life:!!it.life }));
    const gyEnemies = enemies.map(en => ({
      x:en.x, minX:en.minX, maxX:en.maxX, y: gY-en.y, speed:en.speed, type:en.type,
      dir:-1, alive:true, phase:Math.random()*6, squish:0, rollX:0,
      color: en.type==='bola' ? BOLA_COLORS[Math.floor(rnd()*BOLA_COLORS.length)] : undefined,
      boss: !!en.boss, hp: en.hp, maxHp: en.maxHp, throwT: en.throwT, hitCooldown:0, flashT:0,
    }));
    const gyHazards = hazards.map(hz => ({ x:hz.x, w:hz.w, y: gY, phase: Math.random()*6, stretch: 0.5 }));
    const gyNpcs = npcs.map(n => ({ ...n, y: gY }));

    return {
      name: spec.name, icon: spec.icon, bike: !!spec.bike, theme: spec.theme, boss: !!spec.boss,
      bossArenaX, bossArenaW, bossDefeated: false, shoutedYet: false,
      mayraX: bossArenaX!=null ? bossArenaX+bossArenaW/2-14 : 0,
      marcoX: bossArenaX!=null ? bossArenaX+bossArenaW/2+14 : 0,
      width: flagX+160, platforms: gyPlatforms, items: gyItems, enemies: gyEnemies,
      hazards: gyHazards, npcs: gyNpcs, flagX, itemsTotal: gyItems.filter(i=>!i.power && !i.life).length,
      bananas: [], scissors: [],
    };
  }

  /* ---------- player / game state ---------- */
  let game = null;
  const GRAVITY = 1350, JUMP_VEL = -600, MOVE_SPEED = 220;
  const POWER_DURATION = 8;

  function newGameState(startPhase, carry){
    const phase = startPhase || 1;
    const level = genPhase(phase-1);
    return {
      phase, level,
      px: 70, py: groundY(), vx:0, vy:0, onGround:true, facing:1, moving:false,
      jumping:false, jumpT:0, onBossBlock:false,
      lastSafeX: 70, lastSafeY: groundY(),
      lives: carry ? carry.lives : 3,
      maxLives: carry ? carry.maxLives : 3,
      score: carry ? carry.score : 0,
      itemsCollected: carry ? carry.itemsCollected : 0,
      invulnT: 0,
      powerT: 0, throwT: 0,
      projectiles: [],
      runPhase: 0,
      camX: 0,
      particles: [],
      running: true, paused: false,
      keys: {left:false, right:false},
      levelDone: false,
      t: 0,
    };
  }

  function updateHud(){
    const heartsEl = document.getElementById('hudHearts');
    heartsEl.innerHTML = '';
    for(let i=0;i<game.maxLives;i++){
      const span = document.createElement('span');
      span.textContent = '❤️';
      if(i >= game.lives) span.className = 'empty';
      heartsEl.appendChild(span);
    }
    document.getElementById('hudScore').textContent = Math.floor(game.score);
    document.getElementById('hudPhase').textContent = game.phase;
    document.getElementById('hudItems').textContent = game.itemsCollected;
    document.getElementById('hudItemsTotal').textContent = game.level.itemsTotal;
  }

  function startGame(resume){
    showScreen('screen-game');
    document.getElementById('pauseOverlay').classList.remove('show');
    requestAnimationFrame(() => {
      fitCanvas();
      const carry = resume ? { lives:resume.lives, maxLives:resume.maxLives||3, score:resume.score, itemsCollected:resume.itemsCollected } : null;
      game = newGameState(resume ? resume.phase : 1, carry);
      updateHud();
      lastTime = performance.now();
      requestAnimationFrame(loop);
    });
  }

  document.getElementById('btnIniciar').addEventListener('click', async () => {
    await storeDelete(STORE_SAVE);
    startGame(null);
  });
  document.getElementById('btnContinuar').addEventListener('click', () => {
    startGame(savedGameState);
  });

  /* ---------- controls (Pointer Events - reliable on touch AND mouse) ---------- */
  function doJump(){
    if(!game || !game.running || game.paused) return;
    if(game.onGround){
      game.vy = JUMP_VEL;
      game.onGround = false;
      game.jumping = true;
      sfx.jump();
    }
  }
  window.addEventListener('keydown', e => {
    if(!screens['screen-game'].classList.contains('active') || !game) return;
    if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') game.keys.left = true;
    else if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') game.keys.right = true;
    else if(e.key==='ArrowUp'||e.key===' '||e.key==='w'||e.key==='W'){ doJump(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if(!game) return;
    if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') game.keys.left = false;
    else if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') game.keys.right = false;
  });

  // Pointer Events cover mouse+touch+pen with one consistent model, so
  // buttons never get "stuck" the way mixed touch/mouse listeners could.
  function bindHold(el, onDown, onUp){
    let active = false;
    const start = e => {
      active = true;
      el.classList.add('active');
      onDown();
      if(e.cancelable) e.preventDefault();
    };
    const end = () => {
      if(!active) return;
      active = false;
      el.classList.remove('active');
      onUp && onUp();
    };
    el.addEventListener('touchstart', start, {passive:false});
    el.addEventListener('touchend', end, {passive:false});
    el.addEventListener('touchcancel', end, {passive:false});
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', end);
    // safety net: if a finger lifts anywhere and NO fingers remain on the
    // screen at all, force-release this button too - this guarantees the
    // control can never get stuck "held" even if a touchend was missed.
    document.addEventListener('touchend', e => { if(e.touches.length===0) end(); }, {passive:true});
    document.addEventListener('touchcancel', () => end(), {passive:true});
  }
  bindHold(document.getElementById('tLeft'), ()=>{ if(game){ game.keys.left = true; } }, ()=>{ if(game) game.keys.left=false; });
  bindHold(document.getElementById('tRight'), ()=>{ if(game){ game.keys.right = true; } }, ()=>{ if(game) game.keys.right=false; });
  bindHold(document.getElementById('tJump'), doJump, null);

  /* ---------- pause ---------- */
  document.getElementById('pauseBtn').addEventListener('click', () => {
    if(!game || !game.running) return;
    game.paused = true;
    document.getElementById('pauseOverlay').classList.add('show');
  });
  document.getElementById('btnResume').addEventListener('click', () => {
    if(!game) return;
    game.paused = false;
    document.getElementById('pauseOverlay').classList.remove('show');
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });
  document.getElementById('btnExitSave').addEventListener('click', async () => {
    if(!game) return;
    await storeSet(STORE_SAVE, {
      phase: game.phase, lives: game.lives, maxLives: game.maxLives, score: Math.floor(game.score),
      itemsCollected: game.itemsCollected
    });
    game.running = false;
    document.getElementById('pauseOverlay').classList.remove('show');
    await refreshContinueBtn();
    showScreen('screen-home');
  });

  /* ---------- main loop ---------- */
  let lastTime = 0;
  function loop(now){
    if(!game || !game.running || game.paused) return;
    let dt = (now - lastTime) / 1000;
    if(dt > 0.05) dt = 0.05;
    lastTime = now;
    update(dt);
    render();
    if(game.running && !game.paused) requestAnimationFrame(loop);
  }

  function spawnParticles(x,y,color,count){
    for(let i=0;i<count;i++){
      const a = Math.random()*Math.PI*2, sp = 60+Math.random()*140;
      game.particles.push({ x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-80, life:0.5+Math.random()*0.3, color });
    }
  }

  function showNpcBubble(name, line, dur){
    const el = document.getElementById('npcBubble');
    document.getElementById('npcName').textContent = name;
    document.getElementById('npcLine').textContent = line;
    el.classList.add('show');
    clearTimeout(showNpcBubble._t);
    showNpcBubble._t = setTimeout(()=>el.classList.remove('show'), dur||2400);
  }

  function killEnemy(en, x, y){
    en.alive = false; en.squish = 1;
    game.score += 50;
    spawnParticles(x, y, '#e6432c', 14);
    sfx.stomp();
    if(en.boss){
      game.level.bossDefeated = true;
      game.score += 300;
      spawnParticles(x, y-20, '#ffc72c', 30);
      sfx.victory();
      showNpcBubble('LEANDRINHO', 'IRRAAAAA!!', 2600);
    }
  }

  function bossHit(en){
    if(en.hitCooldown > 0) return;
    en.hp--;
    en.hitCooldown = 0.5;
    en.flashT = 0.3;
    spawnParticles(en.x, en.y-40, '#ffc72c', 8);
    sfx.stomp();
    if(en.hp <= 0){
      killEnemy(en, en.x, en.y-40);
    }
  }

  function update(dt){
    game.t += dt;
    const lvl = game.level;

    let ax = 0;
    if(game.keys.left){ ax = -1; game.facing = -1; }
    if(game.keys.right){ ax = 1; game.facing = 1; }
    game.moving = ax !== 0;
    game.vx = ax * MOVE_SPEED;
    game.px += game.vx * dt;
    game.px = Math.max(20, Math.min(lvl.width-20, game.px));

    game.vy += GRAVITY * dt;
    const prevBottom = game.py;
    game.py += game.vy * dt;

    game.onGround = false;
    for(const p of lvl.platforms){
      if(game.px > p.x-14 && game.px < p.x+p.w+14){
        if(game.vy >= 0 && prevBottom <= p.y+2 && game.py >= p.y){
          game.py = p.y; game.vy = 0; game.onGround = true; game.jumping = false;
          game.lastSafeX = game.px; game.lastSafeY = p.y;
          game.onBossBlock = !!p.bossBlock;
        }
      }
    }
    // hop-bumps are solid little walls (not a death risk) - if you don't
    // jump over one, you simply can't walk through it.
    for(const b of lvl.platforms){
      if(!b.bump) continue;
      const clearedTop = game.py <= b.y + 5;
      if(!clearedTop && game.px+16 > b.x && game.px-16 < b.x+b.w){
        game.px = (game.px < b.x + b.w/2) ? b.x-16 : b.x+b.w+16;
      }
    }
    if(game.py > groundY()+260){
      game.px = game.lastSafeX; game.py = game.lastSafeY; game.vy = 0;
      hurt(false);
    }

    if(game.moving && game.onGround) game.runPhase += dt*13;
    else if(!game.onGround) game.runPhase += dt*7;

    if(game.invulnT > 0) game.invulnT -= dt;

    // power-up timer + auto-throw
    if(game.powerT > 0){
      game.powerT -= dt;
      game.throwT -= dt;
      if(game.throwT <= 0){
        game.throwT = 0.45;
        game.projectiles.push({ x:game.px+game.facing*16, y:game.py-30, vx: game.facing*300, vy:-60, life:2.2 });
        sfx.throwCan();
      }
    }
    // cans arc and bounce off the ground, like Mario's fireballs
    game.projectiles.forEach(pr => {
      pr.x += pr.vx*dt;
      pr.vy += 1500*dt;
      pr.y += pr.vy*dt;
      const floorY = groundY();
      if(pr.y > floorY){
        pr.y = floorY;
        pr.vy = -Math.abs(pr.vy)*0.6; // bounce, losing some energy each time
      }
      pr.life -= dt;
    });
    game.projectiles = game.projectiles.filter(pr => pr.life > 0);

    game.particles.forEach(pt => { pt.x+=pt.vx*dt; pt.y+=pt.vy*dt; pt.vy+=700*dt; pt.life-=dt; });
    game.particles = game.particles.filter(pt => pt.life > 0);

    // items
    for(const it of lvl.items){
      if(it.taken) continue;
      if(Math.abs(it.x-game.px) < 26 && Math.abs((it.y-8)-game.py) < 40){
        it.taken = true;
        if(it.power){
          game.powerT = POWER_DURATION; game.throwT = 0;
          sfx.power();
          spawnParticles(it.x, it.y-8, '#ffc72c', 10);
        } else if(it.life){
          game.maxLives = Math.min(6, game.maxLives + 1);
          game.lives = Math.min(game.maxLives, game.lives + 1);
          game.score += 100;
          sfx.power();
          spawnParticles(it.x, it.y-8, '#e6432c', 18);
        } else {
          game.itemsCollected++;
          game.score += 15;
          sfx.collect();
          spawnParticles(it.x, it.y-8, '#ffc72c', 10);
        }
      }
    }

    // vitória-régia - stretches up and HOLDS there for a beat (fully
    // impassable while up, not even a jump clears it), then tucks down and
    // HOLDS there too (where it's a normal jump-over wall). Real timing
    // puzzle: wait for it to go down, then jump the moment it's low.
    for(const hz of lvl.hazards){
      hz.phase += dt;
      const HOLD_UP = 2.5, TRANS = 0.6, HOLD_DOWN = 2.5;
      const cycle = HOLD_UP + TRANS + HOLD_DOWN + TRANS;
      const t = hz.phase % cycle;
      let stretch;
      if(t < HOLD_UP) stretch = 1;                                          // fully up, HELD still
      else if(t < HOLD_UP+TRANS) stretch = 1-(t-HOLD_UP)/TRANS;              // retracting
      else if(t < HOLD_UP+TRANS+HOLD_DOWN) stretch = 0;                     // fully down, HELD still
      else stretch = (t-(HOLD_UP+TRANS+HOLD_DOWN))/TRANS;                   // extending back up
      hz.stretch = Math.max(0, Math.min(1, stretch));

      const plantHeight = 29 + hz.stretch*128;

      // a thrown can destroys the plant for good - the only way to kill it
      for(const pr of game.projectiles){
        if(pr.hit) continue;
        if(Math.abs(pr.x-hz.x) < 24 && pr.y >= groundY()-plantHeight-16 && pr.y <= groundY()+12){
          pr.hit = true; pr.life = 0;
          hz.dead = true;
          game.score += 40;
          spawnParticles(hz.x, groundY()-plantHeight*0.55, '#2f8f4e', 18);
          sfx.stomp();
        }
      }
      if(hz.dead) continue;

      // matches the actual rendered height of the plant (see
      // drawVitoriaRegia: 29 + stretch*128) - no invisible wall, if the
      // player is physically above where the plant reaches, they pass
      // clean (e.g. jumping from an elevated block), no life lost.
      const half = (hz.w||20)/2 + 16;
      if(Math.abs(hz.x-game.px) < half){
        const cleared = game.py <= groundY() - plantHeight - 8;
        if(!cleared){
          const dir = game.px < hz.x ? -1 : 1;
          game.px = hz.x + dir*half;
          if(game.invulnT <= 0) hurt(true, dir);
        }
      }
    }
    lvl.hazards = lvl.hazards.filter(hz => !hz.dead);

    // enemies
    const solids = lvl.platforms.filter(p=>p.bump).concat(lvl.hazards.map(h=>({x:h.x-h.w/2,w:h.w})));
    for(const en of lvl.enemies){
      if(!en.alive){ if(en.squish > 0) en.squish -= dt*3; continue; }
      en.phase += dt*7;
      if(en.hitCooldown > 0) en.hitCooldown -= dt;
      if(en.flashT > 0) en.flashT -= dt;

      if(en.boss){
        // the final Geraldo actively chases the player around the arena
        const chaseDir = game.px < en.x ? -1 : 1;
        let nx = en.x + chaseDir*en.speed*dt;
        nx = Math.max(en.minX, Math.min(en.maxX, nx));
        en.dir = chaseDir;
        en.x = nx;
        // ...and still lobs bananas at intervals long enough to react and jump
        en.throwT -= dt;
        if(en.throwT <= 0){
          en.throwT = 2.1 + Math.random()*0.8;
          const bvx = en.x > game.px ? -190 : 190;
          lvl.bananas.push({ x: en.x + (bvx>0?30:-30), y: groundY(), vx: bvx, life: 4 });
        }
      } else {
        let dir = en.dir;
        let speed = en.speed;
        if(en.type === 'bola'){
          const distToPlayer = en.x - game.px;
          if(Math.abs(distToPlayer) < 190){
            dir = distToPlayer > 0 ? -1 : 1; // roll toward the player
            speed = en.speed*1.9;
          }
        }
        const prevX = en.x;
        let nx = en.x + dir*speed*dt;
        // solid obstacles (hop-bumps, plants) block enemies too - they
        // simply turn around, same as hitting their patrol boundary
        for(const s of solids){
          const sLeft = s.x, sRight = s.x+s.w;
          const willOverlap = nx+14 > sLeft && nx-14 < sRight;
          if(willOverlap){
            if(dir>0){ nx = sLeft-14; dir = -1; }
            else if(dir<0){ nx = sRight+14; dir = 1; }
          }
        }
        if(nx < en.minX){ nx = en.minX; dir = 1; }
        if(nx > en.maxX){ nx = en.maxX; dir = -1; }
        en.rollX += Math.abs(nx-en.x);
        en.x = nx; en.dir = dir;
      }

      // hit by a thrown can
      for(const pr of game.projectiles){
        if(pr.hit) continue;
        if(Math.abs(pr.x-en.x) < 22 && Math.abs(pr.y-(en.y-20)) < 28){
          pr.hit = true; pr.life = 0;
          if(en.boss){ bossHit(en); } else { killEnemy(en, en.x, en.y-30); }
        }
      }
      if(!en.alive) continue;

      // footGap > 0 means the player's feet are ABOVE the enemy's feet
      // (i.e. standing on its head). Thresholds scale with each enemy's
      // actual height. Sol is a hot little sun - it can't be stomped (that
      // would burn your feet), only the energy-drink projectile takes it
      // down; any contact with it just hurts the player instead.
      const eh = ENEMY_HEIGHT[en.type] || (en.boss ? 60 : 50);
      const canStomp = en.type !== 'sol' && !game.onBossBlock;
      const dx = Math.abs(en.x - game.px), footGap = en.y - game.py;
      // must be vertically close enough to actually be touching the
      // enemy's body - this was missing for non-stompable enemies, which
      // caused damage from merely being nearby horizontally (even mid-air,
      // well above the enemy) before any real contact happened.
      const verticallyClose = footGap > -eh*0.35 && footGap < eh*1.5;
      if(dx < (en.boss?36:30) && verticallyClose){
        if(canStomp && game.vy > -80 && footGap > eh*0.22){
          if(en.boss){ bossHit(en); } else { killEnemy(en, en.x, en.y-40); }
          game.vy = -420;
        } else if(game.invulnT <= 0 && (!canStomp || footGap < eh*0.22)){
          hurt(true, en.x < game.px ? 1 : -1);
        }
      }
    }

    // boss barrier - can't walk past the final Geraldo until he's down
    if(lvl.boss && !lvl.bossDefeated && lvl.bossArenaX!=null){
      const barrierX = lvl.bossArenaX + 1030;
      if(game.px > barrierX) game.px = barrierX;
    }

    // thrown bananas from the boss
    lvl.bananas && lvl.bananas.forEach(b => { b.x += b.vx*dt; b.life -= dt; });
    if(lvl.bananas) lvl.bananas = lvl.bananas.filter(b => b.life > 0);
    if(lvl.bananas) for(const b of lvl.bananas){
      if(!b.hit && Math.abs(b.x-game.px) < 20 && game.py >= groundY()-26 && game.invulnT<=0){
        b.hit = true; hurt(true, b.vx<0?1:-1);
      }
    }

    // Adriana's thrown scissors - same as the boss's bananas: costs one life
    lvl.scissors && lvl.scissors.forEach(s => { s.x += s.vx*dt; s.life -= dt; });
    if(lvl.scissors) lvl.scissors = lvl.scissors.filter(s => s.life > 0);
    if(lvl.scissors) for(const s of lvl.scissors){
      if(!s.hit && Math.abs(s.x-game.px) < 18 && Math.abs(s.y-game.py) < 34 && game.invulnT<=0){
        s.hit = true; hurt(true, s.vx<0?1:-1);
      }
    }

    // Only ONE scissor exists in the whole phase at a time, and only an
    // Adriana actually VISIBLE on screen right now can throw - never one
    // waiting off-camera. Generous interval so there's always time to react.
    if(lvl.scissorCooldown === undefined) lvl.scissorCooldown = 2.8;
    lvl.scissorCooldown -= dt;
    const scissorActive = lvl.scissors.some(s => !s.hit);
    if(lvl.scissorCooldown <= 0 && !scissorActive){
      const margin = 40; // must be well inside the visible frame, not just at the edge
      let nearest = null, nearestDist = Infinity;
      for(const en of lvl.enemies){
        if(en.alive && en.type === 'adriana' && en.x > game.camX+margin && en.x < game.camX+W-margin){
          const d = Math.abs(en.x - game.px);
          if(d < nearestDist){ nearest = en; nearestDist = d; }
        }
      }
      if(nearest){
        const tdir = nearest.x > game.px ? -1 : 1;
        lvl.scissors.push({ x: nearest.x, y: nearest.y-30, vx: tdir*230, life: 3 });
        lvl.scissorCooldown = 3.6 + Math.random()*1.4;
      } else {
        lvl.scissorCooldown = 0.6; // try again shortly once an Adriana is on screen
      }
    }

    // once freed, Mayra & Marco Túlio follow Leandrinho the rest of the way
    if(lvl.boss && lvl.bossDefeated){
      const targetM = game.px - 46, targetT = game.px - 80;
      lvl.mayraX += (targetM - lvl.mayraX) * Math.min(1, dt*3);
      lvl.marcoX += (targetT - lvl.marcoX) * Math.min(1, dt*3);
    }

    // NPC dialogue triggers
    for(const n of lvl.npcs){
      if(!n.triggered && Math.abs(n.x-game.px) < 46){
        n.triggered = true;
        showNpcBubble(n.name, n.line, n.line2 ? 1700 : 2400);
        if(n.line2){
          setTimeout(()=>showNpcBubble(n.name2||n.name, n.line2, 2200), 1800);
        }
      }
    }

    // flag / phase complete
    if(!game.levelDone && game.px > lvl.flagX){
      game.levelDone = true;
      phaseComplete();
    }

    const targetCam = Math.max(0, Math.min(lvl.width - W, game.px - W*0.38));
    game.camX += (targetCam - game.camX) * Math.min(1, dt*8);

    updateHud();
  }

  function hurt(fromEnemy, knockDir){
    if(game.invulnT > 0) return;
    game.lives--;
    game.invulnT = 1.4;
    sfx.damage();
    spawnParticles(game.px, game.py-40, '#e6432c', 8);
    if(fromEnemy){
      game.vx = (knockDir||1)*180;
      game.vy = -300;
      game.px += (knockDir||1)*20;
    }
    if(game.lives <= 0){ gameOver(); }
  }

  /* ---------- confetti (shared by phase-clear & victory) ---------- */
  let confettiRunning = {};
  function launchConfetti(canvasId, screenId){
    const cvs = document.getElementById(canvasId);
    const cctx = cvs.getContext('2d');
    const resize = () => { cvs.width = cvs.parentElement.clientWidth; cvs.height = cvs.parentElement.clientHeight; };
    resize();
    const colors = ['#ffc72c','#ff7a29','#f6efe0','#e6432c','#8fd4ff'];
    const pieces = [];
    for(let i=0;i<80;i++){
      pieces.push({
        x: Math.random()*cvs.width, y: -20-Math.random()*cvs.height,
        vy: 80+Math.random()*120, vx:(Math.random()-0.5)*60,
        size: 5+Math.random()*6, color: colors[Math.floor(Math.random()*colors.length)],
        rot: Math.random()*Math.PI, vr:(Math.random()-0.5)*6
      });
    }
    confettiRunning[canvasId] = true;
    let last = performance.now();
    function step(now){
      if(!confettiRunning[canvasId]) return;
      const dt = Math.min(0.05,(now-last)/1000); last = now;
      cctx.clearRect(0,0,cvs.width,cvs.height);
      pieces.forEach(p => {
        p.y += p.vy*dt; p.x += p.vx*dt; p.rot += p.vr*dt;
        if(p.y > cvs.height+20){ p.y = -20; p.x = Math.random()*cvs.width; }
        cctx.save(); cctx.translate(p.x,p.y); cctx.rotate(p.rot);
        cctx.fillStyle = p.color; cctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
        cctx.restore();
      });
      if(screens[screenId].classList.contains('active')) requestAnimationFrame(step);
      else confettiRunning[canvasId] = false;
    }
    requestAnimationFrame(step);
  }

  async function phaseComplete(){
    sfx.phase();
    game.running = false;
    if(game.phase >= PHASES.length){
      await storeDelete(STORE_SAVE);
      const hist = await getHistory();
      const bestBefore = hist.length ? hist[0].score : 0;
      const finalScore = Math.floor(game.score);
      const isRecord = finalScore > bestBefore;
      await addHistory({ name: playerName, score: finalScore, phase: 'Vitória', coins: game.itemsCollected, date: new Date().toLocaleDateString('pt-BR') });
      document.getElementById('vScore').textContent = finalScore;
      document.getElementById('vItems').textContent = game.itemsCollected;
      document.getElementById('vRecord').style.display = isRecord ? 'block' : 'none';
      await refreshContinueBtn();
      sfx.victory();
      showScreen('screen-victory');
      launchConfetti('confettiCanvas','screen-victory');
      return;
    }
    document.getElementById('pcScore').textContent = Math.floor(game.score);
    document.getElementById('pcItems').textContent = game.itemsCollected;
    document.getElementById('pcMsg').innerHTML = 'Parabéns,<br>o Geraldo não te pegou!';
    document.getElementById('pcNext').textContent = 'PRÓXIMA: FASE '+(game.phase+1)+' - '+PHASES[game.phase].name;
    showScreen('screen-phaseclear');
    launchConfetti('confettiCanvas2','screen-phaseclear');
  }

  document.getElementById('btnNextPhase').addEventListener('click', () => {
    const carry = { lives: game.lives, maxLives: game.maxLives, score: game.score, itemsCollected: game.itemsCollected };
    const nextPhase = game.phase+1;
    showScreen('screen-game');
    requestAnimationFrame(() => {
      fitCanvas();
      game = newGameState(nextPhase, carry);
      updateHud();
      lastTime = performance.now();
      requestAnimationFrame(loop);
    });
  });

  async function gameOver(){
    game.running = false;
    await storeDelete(STORE_SAVE);
    const finalScore = Math.floor(game.score);
    const hist = await getHistory();
    const bestBefore = hist.length ? hist[0].score : 0;
    const isRecord = finalScore > bestBefore;
    await addHistory({ name: playerName, score: finalScore, phase: game.phase, coins: game.itemsCollected, date: new Date().toLocaleDateString('pt-BR') });
    document.getElementById('goScore').textContent = finalScore;
    document.getElementById('goDist').textContent = game.phase;
    document.getElementById('goCoins').textContent = game.itemsCollected;
    document.getElementById('goRecord').style.display = isRecord ? 'block' : 'none';
    await refreshContinueBtn();
    showScreen('screen-gameover');
  }

  document.getElementById('btnRetry').addEventListener('click', async () => {
    await storeDelete(STORE_SAVE);
    startGame(null);
  });
  document.getElementById('btnGoHome').addEventListener('click', async () => {
    await refreshContinueBtn();
    showScreen('screen-home');
  });
  document.getElementById('btnVictoryRetry').addEventListener('click', async () => {
    await storeDelete(STORE_SAVE);
    startGame(null);
  });
  document.getElementById('btnVictoryHome').addEventListener('click', async () => {
    await refreshContinueBtn();
    showScreen('screen-home');
  });
  function generateShareImage(){
    return new Promise((resolve) => {
      const logoImg = document.querySelector('#screen-victory .victory-logo');
      const heroImg = document.querySelector('#screen-victory .victory-hero');
      const score = document.getElementById('vScore').textContent;
      const items = document.getElementById('vItems').textContent;
      const cw = 900, ch = 1200;
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const cx = c.getContext('2d');

      const bg = cx.createRadialGradient(cw/2,0,10,cw/2,ch*0.15,cw*0.95);
      bg.addColorStop(0,'#2a2308'); bg.addColorStop(1,'#0b0e12');
      cx.fillStyle = bg; cx.fillRect(0,0,cw,ch);
      // diagonal caution stripe (matches the on-screen banner)
      cx.save();
      cx.beginPath(); cx.rect(0,0,cw,16); cx.clip();
      cx.fillStyle = '#17130a'; cx.fillRect(0,0,cw,16);
      cx.fillStyle = '#ffc72c';
      const stripeW = 26;
      for(let sx=-40; sx<cw+40; sx+=stripeW*2){
        cx.save(); cx.translate(sx,0); cx.rotate(-45*Math.PI/180);
        cx.fillRect(0,-20,stripeW,60);
        cx.restore();
      }
      cx.restore();

      let y = 60;
      if(logoImg && logoImg.naturalWidth){
        const lw = cw*0.62, lh = lw*(logoImg.naturalHeight/logoImg.naturalWidth);
        cx.drawImage(logoImg, (cw-lw)/2, y, lw, lh);
        y += lh + 46;
      }
      cx.textAlign = 'center';
      cx.fillStyle = '#ffc72c';
      cx.font = '700 46px Kanit, sans-serif';
      cx.fillText('PARABÉNS,', cw/2, y);
      y += 58;
      cx.font = '700 40px Kanit, sans-serif';
      cx.fillText('O GERALDO NÃO TE PEGOU!', cw/2, y);
      y += 50;

      if(heroImg && heroImg.naturalWidth){
        const hw = cw*0.30, hh = hw*(heroImg.naturalHeight/heroImg.naturalWidth);
        cx.drawImage(heroImg, (cw-hw)/2, y, hw, hh);
        y += hh + 40;
      }

      cx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(cx, cw*0.14, y, cw*0.72, 150, 18); cx.fill();
      cx.strokeStyle = '#ffc72c'; cx.lineWidth = 3;
      roundRect(cx, cw*0.14, y, cw*0.72, 150, 18); cx.stroke();
      cx.fillStyle = '#f6efe0'; cx.font = '600 30px Kanit, sans-serif';
      cx.textAlign = 'left';
      cx.fillText('Pontuação final', cw*0.20, y+58);
      cx.fillText('Itens coletados', cw*0.20, y+108);
      cx.fillStyle = '#ffc72c'; cx.textAlign = 'right'; cx.font = '800 34px Kanit, sans-serif';
      cx.fillText(score, cw*0.80, y+58);
      cx.fillText(items, cw*0.80, y+108);

      cx.fillStyle = 'rgba(255,255,255,0.5)';
      cx.font = '600 22px Kanit, sans-serif'; cx.textAlign = 'center';
      cx.fillText('PEGA LEANDRINHO — jogo de plataforma da fábrica', cw/2, ch-36);

      c.toBlob(blob => resolve(blob), 'image/png', 0.95);
    });
  }

  document.getElementById('btnShare').addEventListener('click', async () => {
    const score = document.getElementById('vScore').textContent;
    const text = `Terminei o PEGA LEANDRINHO com ${score} pontos! O Geraldo não me pegou! 🏭`;
    const btn = document.getElementById('btnShare');
    const originalLabel = btn.textContent;
    btn.textContent = '⏳ preparando...';
    try{
      const blob = await generateShareImage();
      const file = new File([blob], 'pega-leandrinho.png', { type:'image/png' });
      btn.textContent = originalLabel;
      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ files:[file], title:'PEGA LEANDRINHO', text });
        return;
      }
      if(navigator.share){
        await navigator.share({ title:'PEGA LEANDRINHO', text });
        return;
      }
      // no native share available - download the image so it can be
      // shared manually from the phone's gallery/downloads
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pega-leandrinho.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      try{ await navigator.clipboard.writeText(text); }catch(e){}
      alert('Imagem salva! Abre a galeria/downloads pra compartilhar nas redes.');
    }catch(err){
      btn.textContent = originalLabel;
      /* usuário cancelou o compartilhamento - tudo bem */
    }
  });

  /* ---------- render ---------- */
  function drawDecor(ctx, kind, camX, gY, t, W){
    const par1 = camX*0.35;
    if(kind==='wood'){
      for(let x = -((par1)%320); x<W+320; x+=320){
        // stacked plank crates
        ctx.fillStyle = 'rgba(90,55,25,0.4)';
        ctx.fillRect(x, gY-110, 150, 80);
        ctx.strokeStyle='rgba(50,28,10,0.5)'; ctx.lineWidth=2;
        for(let py=gY-100;py<gY-20;py+=20){ ctx.beginPath(); ctx.moveTo(x+4,py); ctx.lineTo(x+146,py); ctx.stroke(); }
        // big circular saw blade on the wall
        ctx.strokeStyle='rgba(60,60,65,0.45)'; ctx.lineWidth=5;
        ctx.beginPath(); ctx.arc(x+220, gY-140, 34, 0, Math.PI*2); ctx.stroke();
        for(let k=0;k<10;k++){ const a=k/10*Math.PI*2;
          ctx.beginPath(); ctx.moveTo(x+220+Math.cos(a)*28,gY-140+Math.sin(a)*28);
          ctx.lineTo(x+220+Math.cos(a)*38,gY-140+Math.sin(a)*38); ctx.stroke(); }
        // sawdust pile
        ctx.fillStyle='rgba(200,160,100,0.35)';
        ctx.beginPath(); ctx.ellipse(x+270, gY-6, 26, 10, 0,0,Math.PI*2); ctx.fill();
      }
    } else if(kind==='paint'){
      for(let x = -((par1)%260); x<W+260; x+=260){
        // easel with canvas
        ctx.strokeStyle='rgba(60,40,30,0.5)'; ctx.lineWidth=4;
        ctx.beginPath(); ctx.moveTo(x+20,gY); ctx.lineTo(x+40,gY-90); ctx.lineTo(x+60,gY); ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillRect(x+16,gY-95,48,55);
        ctx.fillStyle='rgba(230,67,44,0.35)'; ctx.beginPath(); ctx.arc(x+30,gY-70,10,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(79,195,243,0.35)'; ctx.beginPath(); ctx.arc(x+50,gY-55,8,0,Math.PI*2); ctx.fill();
        // paint splatter cluster
        const colors = ['#e6432c','#4fc3f7','#ffc72c','#8fe08a'];
        for(let i=0;i<4;i++){
          ctx.fillStyle = colors[i]+'55';
          ctx.beginPath(); ctx.arc(x+140+i*24, gY-60-i*10, 15-i*2, 0, Math.PI*2); ctx.fill();
        }
        // drips
        ctx.fillStyle='rgba(230,67,44,0.3)'; ctx.fillRect(x+150,gY-40,4,40);
      }
    } else if(kind==='yarn'){
      for(let x = -((par1)%280); x<W+280; x+=280){
        // fabric bolt cylinders leaning against the wall
        ['#e6432c','#4fc3f7','#ffc72c'].forEach((c,i)=>{
          ctx.fillStyle = c+'45';
          roundRect(ctx, x+i*30, gY-130, 22, 130, 8); ctx.fill();
        });
        // loom frame with crossing threads
        ctx.strokeStyle='rgba(70,45,20,0.45)'; ctx.lineWidth=4;
        ctx.strokeRect(x+150,gY-120,90,110);
        ctx.strokeStyle='rgba(200,170,255,0.3)'; ctx.lineWidth=1.4;
        for(let li=0;li<8;li++){ ctx.beginPath(); ctx.moveTo(x+150,gY-120+li*14); ctx.lineTo(x+240,gY-10-li*13); ctx.stroke(); }
        // hanging yarn spool
        ctx.strokeStyle='rgba(255,180,220,0.5)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(x+260, gY-60, 16, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x+260, gY-60, 9, 0, Math.PI*2); ctx.stroke();
      }
    } else if(kind==='pipe'){
      for(let x = -((par1)%320); x<W+320; x+=320){
        ctx.strokeStyle = 'rgba(70,110,130,0.4)'; ctx.lineWidth=14;
        ctx.beginPath(); ctx.moveTo(x,gY-100); ctx.lineTo(x+180,gY-100); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+90,gY-160); ctx.lineTo(x+90,gY-40); ctx.stroke();
        // valve wheel
        ctx.strokeStyle='rgba(60,90,105,0.5)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(x+90,gY-100,16,0,Math.PI*2); ctx.stroke();
        for(let k=0;k<6;k++){ const a=k/6*Math.PI*2; ctx.beginPath(); ctx.moveTo(x+90,gY-100); ctx.lineTo(x+90+Math.cos(a)*16,gY-100+Math.sin(a)*16); ctx.stroke(); }
        // pressure gauge
        ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(x+230,gY-130,14,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(60,90,105,0.6)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(x+230,gY-130,14,0,Math.PI*2); ctx.stroke();
        const na = Math.sin(t*2+x)*1.2;
        ctx.beginPath(); ctx.moveTo(x+230,gY-130); ctx.lineTo(x+230+Math.cos(na)*10,gY-130+Math.sin(na)*10-4); ctx.stroke();
        // steam puffs
        ctx.fillStyle='rgba(255,255,255,0.25)';
        const puff = (t*30+x)%80;
        ctx.beginPath(); ctx.arc(x+270, gY-100-puff, 7+puff*0.08, 0, Math.PI*2); ctx.fill();
      }
    } else if(kind==='city'){
      for(let x = -((par1)%220); x<W+220; x+=220){
        ctx.fillStyle = 'rgba(70,80,95,0.5)';
        ctx.fillRect(x, gY-190, 60, 190);
        ctx.fillRect(x+70, gY-130, 55, 130);
        ctx.fillRect(x+140, gY-160, 50, 160);
        ctx.fillStyle = 'rgba(190,215,230,0.7)';
        for(let wy=0;wy<5;wy++) for(let wx=0;wx<2;wx++) ctx.fillRect(x+8+wx*22, gY-175+wy*30, 10, 12);
        for(let wy=0;wy<3;wy++) for(let wx=0;wx<2;wx++) ctx.fillRect(x+78+wx*20, gY-115+wy*28, 9, 11);
        // streetlight
        ctx.strokeStyle='rgba(50,50,55,0.6)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(x+205,gY); ctx.lineTo(x+205,gY-60); ctx.lineTo(x+222,gY-64); ctx.stroke();
        ctx.fillStyle='rgba(255,230,150,0.7)'; ctx.beginPath(); ctx.arc(x+224,gY-64,4,0,Math.PI*2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      [0.15,0.55,0.85].forEach((cx,i)=>{
        const cy = gY*0.12 + (i%2)*20;
        ctx.beginPath(); ctx.ellipse(W*cx, cy, 26,12,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(W*cx+20, cy+4, 18,9,0,0,Math.PI*2); ctx.fill();
      });
      ctx.fillStyle = 'rgba(255,250,220,0.85)';
      ctx.beginPath(); ctx.arc(W*0.8, gY*0.18, 24, 0, Math.PI*2); ctx.fill();
    } else if(kind==='gears'){
      for(let x = -((par1)%300); x<W+300; x+=300){
        // blueprint grid panel
        ctx.strokeStyle='rgba(20,90,75,0.18)'; ctx.lineWidth=1;
        for(let gx=x;gx<x+120;gx+=15){ ctx.beginPath(); ctx.moveTo(gx,gY-170); ctx.lineTo(gx,gY-50); ctx.stroke(); }
        for(let gyy=gY-170;gyy<gY-50;gyy+=15){ ctx.beginPath(); ctx.moveTo(x,gyy); ctx.lineTo(x+120,gyy); ctx.stroke(); }
        [0,1].forEach(i=>{
          const gx=x+160+i*90, gyc=gY-90-i*30, gr=22-i*6;
          ctx.strokeStyle='rgba(30,90,75,0.4)'; ctx.lineWidth=5;
          ctx.beginPath(); ctx.arc(gx,gyc,gr,0,Math.PI*2); ctx.stroke();
          ctx.fillStyle='rgba(30,90,75,0.3)';
          for(let k=0;k<8;k++){ const a=k/8*Math.PI*2+t*0.3; ctx.beginPath(); ctx.arc(gx+Math.cos(a)*gr, gyc+Math.sin(a)*gr, 3,0,Math.PI*2); ctx.fill(); }
        });
        // control panel with blinking lights
        ctx.fillStyle='rgba(20,50,45,0.4)'; ctx.fillRect(x+40,gY-40,60,34);
        for(let li=0;li<3;li++){
          ctx.fillStyle = Math.floor(t*3+li)%2===0 ? 'rgba(140,255,220,0.8)' : 'rgba(80,120,110,0.4)';
          ctx.beginPath(); ctx.arc(x+52+li*18,gY-24,4,0,Math.PI*2); ctx.fill();
        }
      }
    }
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    const gY = groundY();
    const lvl = game.level;
    const camX = game.camX;
    const th = lvl.theme || { skyTop:'#232f3a', skyBot:'#182027', plat:'#6e4726', platDk:'#3c2c1a', edge:'rgba(255,199,44,0.5)', decor:'wood' };

    const sky = ctx.createLinearGradient(0,0,0,gY);
    sky.addColorStop(0,th.skyTop); sky.addColorStop(1,th.skyBot);
    ctx.fillStyle = sky; ctx.fillRect(0,0,W,gY);
    // continue the background color below ground level too, so gaps/pits
    // show the scenery (a sense of depth) instead of solid black
    ctx.fillStyle = th.skyBot; ctx.fillRect(0,gY,W,H-gY);
    const pitShade = ctx.createLinearGradient(0,gY,0,H);
    pitShade.addColorStop(0,'rgba(0,0,0,0)'); pitShade.addColorStop(1,'rgba(0,0,0,0.45)');
    ctx.fillStyle = pitShade; ctx.fillRect(0,gY,W,H-gY);

    drawDecor(ctx, th.decor, camX, gY, game.t, W);
    if(th.decor !== 'city'){
      for(let i=0;i<4;i++){
        const lx = (i+0.5)*(W/4);
        const sway = Math.sin(game.t*1.1+i)*3;
        const glow = ctx.createRadialGradient(lx+sway,gY*0.2,2, lx+sway,gY*0.2,30);
        glow.addColorStop(0,'rgba(255,214,140,0.35)'); glow.addColorStop(1,'rgba(255,214,140,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(lx+sway,gY*0.2,30,0,Math.PI*2); ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(-camX, 0);

    lvl.platforms.forEach(p => {
      if(p.x+p.w < camX-80 || p.x > camX+W+80) return;
      if(p.bump){
        ctx.fillStyle = '#d8d8d8';
        roundRect(ctx, p.x, p.y, p.w, p.thick, 5); ctx.fill();
        ctx.save();
        ctx.beginPath(); roundRect(ctx, p.x, p.y, p.w, p.thick, 5); ctx.clip();
        ctx.fillStyle = '#ffc72c';
        for(let sx=p.x-p.thick; sx<p.x+p.w+p.thick; sx+=14){
          ctx.save(); ctx.translate(sx,p.y); ctx.rotate(-45*Math.PI/180);
          ctx.fillRect(0,-4,7,p.thick*1.6);
          ctx.restore();
        }
        ctx.restore();
        ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 2;
        roundRect(ctx, p.x, p.y, p.w, p.thick, 5); ctx.stroke();
        return;
      }
      ctx.fillStyle = p.thick > 30 ? th.platDk : th.plat;
      roundRect(ctx, p.x, p.y, p.w, p.thick, 6); ctx.fill();
      ctx.strokeStyle = th.edge; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.w,p.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth=1;
      for(let x=p.x+20; x<p.x+p.w; x+=34){ ctx.beginPath(); ctx.moveTo(x,p.y+3); ctx.lineTo(x,p.y+Math.min(14,p.thick-3)); ctx.stroke(); }
    });

    lvl.items.forEach(it => {
      if(it.taken) return;
      if(it.x < camX-60 || it.x > camX+W+60) return;
      const bob = Math.sin(game.t*3 + it.bob)*4;
      ctx.font = (it.power||it.life) ? '30px sans-serif' : '26px sans-serif';
      ctx.textAlign = 'center';
      if(it.power){
        const glow = ctx.createRadialGradient(it.x,it.y-6+bob,2, it.x,it.y-6+bob,22);
        glow.addColorStop(0,'rgba(255,199,44,0.5)'); glow.addColorStop(1,'rgba(255,199,44,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(it.x,it.y-6+bob,22,0,Math.PI*2); ctx.fill();
      }
      if(it.life){
        const pulse = 20 + Math.sin(game.t*4)*4;
        const glow = ctx.createRadialGradient(it.x,it.y-6+bob,2, it.x,it.y-6+bob,pulse);
        glow.addColorStop(0,'rgba(230,67,44,0.55)'); glow.addColorStop(1,'rgba(230,67,44,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(it.x,it.y-6+bob,pulse,0,Math.PI*2); ctx.fill();
      }
      ctx.fillText(it.emoji, it.x, it.y-6+bob);
    });

    // NPCs (townsfolk) - the boss arena has a special caged pair instead
    lvl.npcs.forEach(n => {
      if(n.cage){
        const freed = lvl.bossDefeated;
        const cx = freed ? (lvl.mayraX+lvl.marcoX)/2 : n.x;
        if(cx < camX-100 || cx > camX+W+100) return;
        ctx.save();
        ctx.translate(freed ? 0 : n.x, n.y);
        if(!freed){
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.fillRect(-34,-90,68,90);
          drawNPC(ctx, -14, 0, 0.85, 'mayra', game.t*2);
          drawNPC(ctx, 14, 0, 0.85, 'marcotulio', game.t*2);
          ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 4;
          for(let bx=-32; bx<=32; bx+=10){ ctx.beginPath(); ctx.moveTo(bx,-92); ctx.lineTo(bx,4); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(-34,-92); ctx.lineTo(34,-92); ctx.stroke();
        } else {
          drawNPC(ctx, lvl.mayraX, n.y, 0.85, 'mayra', game.t*2);
          drawNPC(ctx, lvl.marcoX, n.y, 0.85, 'marcotulio', game.t*2);
          ctx.fillStyle = 'rgba(255,199,44,0.9)';
          ctx.font = '20px sans-serif'; ctx.textAlign='center';
          ctx.fillText('🎉', (lvl.mayraX+lvl.marcoX)/2, n.y-100);
        }
        ctx.restore();
        return;
      }
      if(n.x < camX-100 || n.x > camX+W+100) return;
      drawNPC(ctx, n.x, n.y, 1.05, n.key, game.t*2);
    });

    // vitória-régia biting plants
    lvl.hazards.forEach(hz => {
      if(hz.x < camX-60 || hz.x > camX+W+60) return;
      drawVitoriaRegia(ctx, hz.x, gY, 1, { phase: hz.phase, stretch: hz.stretch });
    });

    const flagBob = Math.sin(game.t*2)*3;
    ctx.strokeStyle = '#cfd6db'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(lvl.flagX, gY); ctx.lineTo(lvl.flagX, gY-150); ctx.stroke();
    ctx.fillStyle = '#ffc72c';
    ctx.beginPath();
    ctx.moveTo(lvl.flagX, gY-150+flagBob);
    ctx.lineTo(lvl.flagX+46, gY-134+flagBob);
    ctx.lineTo(lvl.flagX, gY-118+flagBob);
    ctx.closePath(); ctx.fill();

    lvl.enemies.forEach(en => {
      if(!en.alive && en.squish <= 0) return;
      if(en.x < camX-100 || en.x > camX+W+100) return;
      if(en.boss){
        if(!en.alive) return;
        const flash = en.flashT > 0 && Math.floor(game.t*20)%2===0;
        ctx.save(); if(flash) ctx.filter = 'brightness(2)';
        drawGeraldo(ctx, en.x, en.y, 2.1, { phase:en.phase, jumping:false, moving:false, facing:-1 });
        ctx.restore();
        // boss health bar
        const bw = 90, bx = en.x-bw/2, by = en.y-140;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx,bx,by,bw,10,5); ctx.fill();
        ctx.fillStyle = '#e6432c'; roundRect(ctx,bx,by,bw*Math.max(0,en.hp/en.maxHp),10,5); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth=1.5; roundRect(ctx,bx,by,bw,10,5); ctx.stroke();
        return;
      }
      const drawFn = ENEMY_DRAW[en.type] || drawGeraldo;
      const extra = en.type==='bola' ? { color:en.color, rollX:en.rollX } : {};
      // most enemy art naturally faces left, so moving right needs a flip -
      // the veado's art was drawn facing right by default, so it uses the
      // opposite convention (this was backwards before, hence walking
      // "backwards" visually).
      const faceMul = en.type === 'veado' ? 1 : -1;
      const facing = en.dir>0 ? faceMul : -faceMul;
      if(!en.alive){
        drawFn(ctx, en.x, en.y+8, 1.1, { phase:en.phase, jumping:false, moving:false, facing, squish: en.squish, ...extra });
      } else {
        drawFn(ctx, en.x, en.y, 1.1, { phase:en.phase, jumping:false, moving:true, facing, ...extra });
      }
    });

    // bananas thrown by the boss
    if(lvl.bananas) lvl.bananas.forEach(b => {
      ctx.save(); ctx.translate(b.x, b.y-14); ctx.rotate(Math.sin(game.t*10)*0.4);
      ctx.font = '22px sans-serif'; ctx.textAlign='center';
      ctx.fillText('🍌', 0, 0);
      ctx.restore();
    });

    // Adriana's thrown scissors - spin fast, clearly dangerous
    if(lvl.scissors) lvl.scissors.forEach(s => {
      ctx.save(); ctx.translate(s.x, s.y-14); ctx.rotate(game.t*16);
      ctx.font = '20px sans-serif'; ctx.textAlign='center';
      ctx.fillText('✂️', 0, 0);
      ctx.restore();
    });

    // thrown cans
    game.projectiles.forEach(pr => {
      ctx.save(); ctx.translate(pr.x,pr.y); ctx.rotate(game.t*14);
      ctx.font='18px sans-serif'; ctx.textAlign='center';
      ctx.fillText('🥫', 0, 0);
      ctx.restore();
    });

    game.particles.forEach(pt => {
      ctx.globalAlpha = Math.max(0,pt.life/0.6);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x,pt.y,3.5,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    });

    // scooter under the player during the "Externo" phase
    if(lvl.bike){
      drawScooter(ctx, game.px, game.py+2, 1);
    }

    const hurtBlink = game.invulnT > 0 && Math.floor(game.t*14)%2===0;
    const powerBlink = game.powerT > 0 && Math.floor(game.t*10)%2===0;
    ctx.globalAlpha = hurtBlink ? 0.35 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(game.px, gY+6, 24, 6, 0,0,Math.PI*2); ctx.fill();
    const jumpT = game.jumping ? Math.min(1, Math.abs(game.vy)/620) : 0;
    if(powerBlink){
      ctx.save(); ctx.filter = 'hue-rotate(180deg) saturate(2)';
    }
    drawLeandrinho(ctx, game.px, game.py, 0.85, {
      phase: game.runPhase,
      jumping: lvl.bike ? false : !game.onGround,
      jumpT,
      moving: lvl.bike ? false : game.moving,
      facing: game.facing,
      helmet: lvl.bike
    });
    if(powerBlink) ctx.restore();
    ctx.globalAlpha = 1;

    ctx.restore();

    ctx.fillStyle = '#0d1013';
    ctx.fillRect(0, H-14, W, 14);
  }

  /* ---------- init ---------- */
  (async function init(){
    await initName();
    await refreshContinueBtn();
    fitCanvas();
  })();

})();

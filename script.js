const TOTAL = 20;
const A = {};
let cur = -1;
let timerSec = 15 * 60, timerInt = null;

// Check if we are returning from a successful payment
if (window.location.search.includes('success=true')) {
  setTimeout(() => {
    document.getElementById('scrW').classList.remove('on');
    document.getElementById('topbar').classList.remove('vis');
    document.getElementById('botbar').style.display = 'none';
    show('Success');
  }, 100);
}

const topbar = document.getElementById('topbar');
const mainBtn = document.getElementById('mainBtn');
const botbar = document.getElementById('botbar');
const offerBar = document.getElementById('offerBar');

// Segbar
const segbar = document.getElementById('segbar');
for (let i = 0; i < TOTAL; i++) { const s = document.createElement('div'); s.className = 'seg'; s.id = 's' + i; segbar.appendChild(s); }

function updSegs(q) {
  // Legacy segbar (hidden, kept for JS compatibility)
  for (let i = 0; i < TOTAL; i++) { const s = document.getElementById('s' + i); if (s) s.className = 'seg' + (i < q ? ' done' : i === q ? ' cur' : ''); }
  // New premium progress bar
  const pf = document.getElementById('progFill');
  const pl = document.getElementById('progLabel');
  if (pf) pf.style.width = ((q + 1) / TOTAL * 100).toFixed(1) + '%';
  if (pl) pl.textContent = (q + 1) + ' / ' + TOTAL;
}

const SCREENS = ['scrW', 'scr0', 'scr1', 'scr2', 'scr3', 'scr4', 'scr5', 'scr6', 'scr7', 'scr8', 'scr9', 'scr10', 'scr11', 'scr12', 'scr13', 'scr14', 'scr15', 'scr16', 'scr17', 'scr18', 'scr19', 'scrEmail', 'scrL', 'scrF', 'scrSuccess', 'scrTestLoading'];

function show(idx) {
  SCREENS.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('on'); });
  const map = { '-1': 'scrW', 20: 'scrEmail', 21: 'scrL', 22: 'scrF', 'Success': 'scrSuccess', 'TestLoading': 'scrTestLoading' };
  const targetId = map[idx] !== undefined ? map[idx] : 'scr' + idx;
  const target = document.getElementById(targetId);
  if (target) target.classList.add('on');
  
  cur = idx;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (idx === -1) {
    topbar.classList.remove('vis'); offerBar.classList.remove('vis');
    mainBtn.textContent = 'CONTINUE'; mainBtn.disabled = false;
    botbar.style.display = 'block';
  } else if (idx >= 0 && idx < TOTAL) {
    topbar.classList.add('vis'); offerBar.classList.remove('vis');
    updSegs(idx); refreshBtn(idx);
    botbar.style.display = 'block';
  } else if (idx === 20) {
    topbar.classList.add('vis'); offerBar.classList.remove('vis');
    const pf = document.getElementById('progFill');
    if (pf) pf.style.width = '100%';
    const pl = document.getElementById('progLabel');
    if (pl) pl.textContent = '20 / 20';
    refreshBtn(20);
    botbar.style.display = 'block';
  } else if (idx === 21 || idx === 'TestLoading') {
    topbar.classList.remove('vis'); offerBar.classList.remove('vis');
    botbar.style.display = 'none';
    if (idx === 21) startLoading();
  } else if (idx === 22) {
    topbar.classList.remove('vis'); offerBar.classList.add('vis');
    botbar.style.display = 'none';
    buildPlanGoal(); startTimer();
    setTimeout(initSlider, 600);
  } else if (idx === 'Success') {
    topbar.classList.remove('vis'); offerBar.classList.remove('vis');
    botbar.style.display = 'none';
  }
}

function refreshBtn(q) {
  if (q === 5 || q === 6 || q === 7) { mainBtn.disabled = false; }
  else if (q === 4) { mainBtn.disabled = !(Array.isArray(A[4]) && A[4].length > 0); }
  else if (q === 20) {
    const email = document.getElementById('inpEmail').value;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    mainBtn.disabled = !re.test(email);
    mainBtn.textContent = 'GET RESULTS';
  }
  else { mainBtn.disabled = A[q] === undefined; }
  if (q < TOTAL) mainBtn.textContent = q < TOTAL - 1 ? 'NEXT STEP' : 'SEE RESULTS';
}

function handleMain() {
  if (mainBtn.disabled) return;
  if (cur === -1) { show(0); return; }
  
  // Prevent double-taps/click-throughs
  mainBtn.disabled = true;
  
  setTimeout(() => {
    if (cur >= 0 && cur < TOTAL) {
      if (cur === 5) A[5] = document.getElementById('inpW').value + ' ' + document.getElementById('uW').textContent;
      if (cur === 6) { A[6] = document.getElementById('inpH').value + ' ' + document.getElementById('uH').textContent; calcBMI(); }
      if (cur === 10) {
        const wrap = document.getElementById('allergyWrap');
        if (wrap && wrap.style.display === 'block') {
          A[10] = document.getElementById('allergyInput').value.trim() || 'Has allergies but not specified';
        } else {
          A[10] = 'No allergies';
        }
      }
      show(cur + 1);
    } else if (cur === 20) {
      A['email'] = document.getElementById('inpEmail').value;
      show(21);
    }
  }, 150); // Small delay to prevent ghost clicks on the next screen
}

function goBack() { if (cur > 0) show(cur - 1); else if (cur === 0) show(-1); }

function pickCard(c, q) { c.closest('.pgrid').querySelectorAll('.pcard').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); A[q] = c.dataset.v; refreshBtn(q); }
function pickIcon(c, q) { const p = c.closest('.igrid') || c.closest('.cgrid'); p.querySelectorAll('.icard, .ccard').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); A[q] = c.dataset.v; refreshBtn(q); }
function pickList(b, q) { b.closest('.lopts').querySelectorAll('.lopt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); A[q] = b.dataset.v; refreshBtn(q); }

function pickAllergy(b, type) {
  b.closest('.lopts').querySelectorAll('.lopt').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
  const wrap = document.getElementById('allergyWrap');
  const inp = document.getElementById('allergyInput');
  if (type === 'yes') {
    wrap.style.display = 'block';
    A[10] = inp.value.trim() ? inp.value.trim() : undefined;
    inp.focus();
  } else {
    wrap.style.display = 'none';
    A[10] = 'No allergies';
  }
  refreshBtn(10);
}

function checkAllergyInput() {
  const inp = document.getElementById('allergyInput');
  A[10] = inp.value.trim() ? inp.value.trim() : undefined;
  refreshBtn(10);
}

function togChk(w, q, event) {
  if (event) event.stopPropagation();
  w.classList.toggle('sel'); 
  const btn = w.querySelector('.lopt');
  if (btn) btn.classList.toggle('sel');
  
  if (!A[q]) A[q] = [];
  const v = btn ? btn.dataset.v : '';
  const i = A[q].indexOf(v);
  if (i === -1) A[q].push(v); else A[q].splice(i, 1);
  refreshBtn(q);
}

function calcBMI() {
  const wStr = A[5] || '65 kg', hStr = A[6] || '170 cm';
  let w = parseFloat(wStr); if (wStr.includes('lbs')) w *= 0.453592;
  let h = parseFloat(hStr); if (hStr.includes('ft')) h *= 30.48;
  const bmi = w / ((h / 100) * (h / 100));
  const val = bmi.toFixed(1);

  const m = document.getElementById('bmiMarker');
  const t = document.getElementById('bmiValText');
  if (t) t.textContent = "You - " + val;

  let pct = ((bmi - 15) / (40 - 15)) * 100;
  pct = Math.max(0, Math.min(100, pct));
  if (m) {
    m.style.transition = 'none';
    m.style.left = '0%';
    setTimeout(() => {
      m.style.transition = 'left 1.5s cubic-bezier(0.25, 1, 0.5, 1)';
      m.style.left = pct + '%';
    }, 50);
  }

  const wb = document.getElementById('bmiWarningBox');
  const wi = document.getElementById('bmiWarningIco');
  const wt = document.getElementById('bmiWarningTtl');
  const wx = document.getElementById('bmiWarningTxt');

  if (bmi < 18.5) {
    wb.className = 'bmi-box'; wi.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    wt.textContent = 'Underweight Risks:'; wx.textContent = 'Weakened immune system, fragile bones, feeling tired.';
  } else if (bmi <= 25) {
    wb.className = 'bmi-box good'; wi.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    wt.textContent = 'Healthy BMI!'; wx.textContent = 'Your weight is in the normal range. Great job!';
  } else {
    wb.className = 'bmi-box'; wi.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    wt.textContent = 'Unhealthy BMI Risks:'; wx.textContent = 'Hormonal imbalances, risk of cardiovascular disease, joint pain.';
  }

  document.getElementById('bmiBodyType').textContent = A[3] || 'Not specified';
  document.getElementById('bmiLifestyle').textContent = A[8] || 'Not specified';
}

function stepN(t, d) { const i = document.getElementById(t === 'w' ? 'inpW' : 'inpH'); i.value = Math.min(parseInt(i.max), Math.max(parseInt(i.min), (parseInt(i.value) || 0) + d)); }
function setU(t, u, btn) { btn.closest('.utog').querySelectorAll('.ubtn').forEach(b => b.classList.remove('on')); btn.classList.add('on'); document.getElementById(t === 'w' ? 'uW' : 'uH').textContent = t === 'w' ? (u === 'kg' ? 'kg' : 'lbs') : (u === 'cm' ? 'cm' : 'ft'); }

function startLoading() {
  [{ f: 'lf0', p: 'lp0', c: 'lc0', d: 0, du: 3000 }, { f: 'lf1', p: 'lp1', c: 'lc1', d: 2000, du: 3500 }, { f: 'lf2', p: 'lp2', c: 'lc2', d: 4500, du: 3000 }, { f: 'lf3', p: 'lp3', c: 'lc3', d: 6500, du: 2500 }]
    .forEach(s => setTimeout(() => animBar(s.f, s.p, s.du, () => { document.getElementById(s.c).innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10B981; font-size: 20px;"></i>'; }), s.d));
  setTimeout(() => show(22), 9500);
}

function animBar(fid, pid, dur, cb) {
  const f = document.getElementById(fid), p = document.getElementById(pid), t0 = performance.now();
  (function r(ts) {
    let rawPct = Math.min((ts - t0) / dur, 1);
    // easeInOutCubic: starts slow, speeds up, then "thinks" a lot at the end
    let pct = rawPct < 0.5 ? 4 * rawPct * rawPct * rawPct : 1 - Math.pow(-2 * rawPct + 2, 3) / 2;
    const v = Math.round(pct * 100);
    f.style.width = v + '%';
    p.textContent = v + '%';
    if (rawPct < 1) requestAnimationFrame(r); else if (cb) cb();
  })(performance.now());
}

function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function startTimer() {
  timerSec = 15 * 60;
  if (timerInt) clearInterval(timerInt);
  timerInt = setInterval(() => {
    if (timerSec > 0) timerSec--; else timerSec = 15 * 60;
    const s = fmt(timerSec);
    document.getElementById('timerTop').textContent = s;
    document.getElementById('timerMain').textContent = s;
  }, 1000);
}

function buildPlanGoal() {
  const g = A[2] || 'getting in shape', w = A[5] || '—';
  const mg = document.getElementById('planMetaGoal');
  const mw = document.getElementById('planMetaWeight');
  if (mg) mg.textContent = g;
  if (mw) mw.textContent = w;
  // legacy
  const pg = document.getElementById('planGoalTxt');
  if (pg) pg.textContent = `Goal: ${g} · Weight: ${w}`;

  // Dynamic Plan Description
  const prs = document.getElementById('planReadySub');
  if (prs) {
    let age = A[1] ? A[1].replace(' years', '') : 'your age';
    let targetTxt = A[4] && A[4].length > 0 ? A[4].join(' and ').toLowerCase() : 'whole body';
    let txt = `Based on your answers, we designed a custom ${A[3] ? A[3].toLowerCase() : ''} body plan for a ${age} year old. `;
    if (g === 'Lose Weight') txt += `This program focuses on burning fat to drop from ${w} to your ideal weight, specifically targeting your ${targetTxt}.`;
    else if (g === 'Tone My Body') txt += `This program focuses on building lean muscle tone and shaping your ${targetTxt} without bulking up.`;
    else if (g === 'Build Muscle') txt += `This program features a high-protein diet and targeted workouts to increase muscle mass in your ${targetTxt}.`;
    else txt += `This program will improve your overall fitness, energy levels, and tone your ${targetTxt}.`;
    prs.textContent = txt;
  }
}

function togFaq(q) {
  const item = q.closest('.faq-item'), open = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!open) item.classList.add('open');
}

function scrollToPay() {
  const p = document.getElementById('payTarget');
  if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  // Update links with quiz data
  const data = encodeURIComponent(JSON.stringify(A));
  const links = document.querySelectorAll('.lemonsqueezy-button');
  links.forEach(link => {
    const baseUrl = link.getAttribute('href').split('?')[0];
    link.setAttribute('href', `${baseUrl}?checkout[custom][data]=${data}&checkout[email]=${A.email || ''}`);
  });
}

// Auto-scroll slider + desktop drag support
let sliderInterval;
function initSlider() {
  const slider = document.getElementById('autoSlider');
  if (!slider) return;

  // Auto-scroll
  let scrollPos = 0;
  if (sliderInterval) clearInterval(sliderInterval);
  sliderInterval = setInterval(() => {
    scrollPos += slider.offsetWidth;
    if (scrollPos >= slider.scrollWidth - 1) scrollPos = 0;
    slider.scrollTo({ left: scrollPos, behavior: 'smooth' });
  }, 3800);

  // Desktop drag-to-scroll
  let isDragging = false, startX, startScrollLeft;
  slider.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.pageX - slider.offsetLeft;
    startScrollLeft = slider.scrollLeft;
    clearInterval(sliderInterval);
    slider.style.cursor = 'grabbing';
  });
  slider.addEventListener('mouseleave', () => { isDragging = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mouseup', () => { isDragging = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mousemove', e => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - slider.offsetLeft;
    slider.scrollLeft = startScrollLeft - (x - startX);
  });
}

async function generatePlanWithClaude() {
  const prompt = `You are an expert nutritionist and fitness coach. Generate a personalized 7-day diet and workout plan based on the following client data:
Gender: ${A[0]}
Age: ${A[1]}
Main Goal: ${A[2]}
Body Type: ${A[3]}
Target Areas: ${A[4] ? A[4].join(', ') : 'None'}
Weight: ${A[5]}
Height: ${A[6]}
Activity Level: ${A[8]}
Water Intake: ${A[9]}
Allergies/Food Intolerances: ${A[10]}
Sleep Habits: ${A[11]}
Stress Levels: ${A[12]}
Late Night Cravings: ${A[13]}
Joint Pain: ${A[14]}
Meals per Day: ${A[15]}
Energy Drops: ${A[16]}
Fast Food Frequency: ${A[17]}
Vegetable Intake: ${A[18]}
Typical Day: ${A[19]}

Please provide the output in a clean HTML format suitable for displaying in a web app.`;

  console.log("Sending request to Claude API...");

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: prompt })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("API Error:", err);
      alert("API Request Failed! See console for details. (Check CORS or API Key)");
      return;
    }

    const data = await response.json();
    console.log("Claude Response:", data);
    alert("Plan generated successfully! Check console for the response.");
  } catch (e) {
    console.error("Fetch Error:", e);
    alert("Failed to connect to the API. This is likely due to browser CORS policies. You need a backend proxy.");
  }
}

function doBuy() {
  alert('Payment successful! Generating your personal plan with AI...');
  generatePlanWithClaude();
}
async function testEmailDelivery() {
  const email = A.email || prompt("Please enter email to receive the test plan:");
  const name = prompt("Please enter your name for the test:", "Customer") || "Customer";
  if (!email) return;
  
  // Show loading screen
  show("TestLoading"); 
  
  try {
    const response = await fetch('/api/webhook', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-event-name': 'order_created',
        'x-test-mode': 'true' 
      },
      body: JSON.stringify({
        data: {
          attributes: {
            user_email: email,
            user_name: name,
            custom_data: {
              data: JSON.stringify(A)
            }
          }
        }
      })
    });
    
    const result = await response.json();
    if (response.ok) {
      show('Success');
    } else {
      alert("❌ Test failed: " + (result.error || "Unknown error"));
    }
  } catch (e) {
    alert("❌ Error connecting to backend: " + e.message);
  }
}

A[5] = '65 kg'; A[6] = '170 cm';
show(-1);

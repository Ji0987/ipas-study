// 與內容無關的介面效果：背景粒子、捲動進度、提示訊息、彈窗、側欄、彩帶

export function initCanvas() {
  const c = document.getElementById('cvs'), ctx = c.getContext('2d');
  let W, H, pts;
  const resize = () => {
    W = c.width = innerWidth; H = c.height = innerHeight;
    pts = Array.from({ length: 50 }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .2, vy: (Math.random() - .5) * .2, r: Math.random() * 1.4 + .5 }));
  };
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(79,155,255,.4)'; ctx.fill();
    });
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 100) {
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
        ctx.strokeStyle = `rgba(79,155,255,${.15 * (1 - d / 100)})`; ctx.lineWidth = .6; ctx.stroke();
      }
    }
    requestAnimationFrame(draw);
  };
  window.addEventListener('resize', resize); resize(); draw();
}

export function initScrollProgress() {
  window.addEventListener('scroll', () => {
    const s = scrollY, t = document.documentElement.scrollHeight - innerHeight;
    document.getElementById('top-prog').style.width = (t > 0 ? s / t * 100 : 0) + '%';
    document.getElementById('btt').classList.toggle('show', s > 300);
  }, { passive: true });
}

export function showToast(msg, icon = '✓') {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  document.getElementById('tw').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

export function copyFm(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent; btn.textContent = '已複製 ✓'; btn.classList.add('copied');
    showToast('公式已複製', '📋');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  });
}

export function escHTML(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function closeModal(id) { document.getElementById(id)?.classList.remove('on'); }
export function openKeys() { document.getElementById('keys-overlay').classList.add('on'); }
export function openCheat() { document.getElementById('cheat-overlay').classList.add('on'); }

export function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('mob-overlay');
  const hb = document.getElementById('hamburger');
  const open = sb.classList.toggle('open');
  ov.classList.toggle('on', open);
  hb.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mob-overlay').classList.remove('on');
  document.getElementById('hamburger').classList.remove('open');
  document.body.style.overflow = '';
}

export function fireConfetti() {
  const colors = ['#4f9bff', '#ffd166', '#06d6a0', '#ef476f', '#c084fc'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div'); el.className = 'cf';
    el.style.cssText = `left:${Math.random() * 100}vw;top:-10px;background:${colors[~~(Math.random() * colors.length)]};width:${Math.random() * 10 + 5}px;height:${Math.random() * 10 + 5}px;border-radius:${Math.random() > .5 ? '50%' : '3px'};animation-delay:${Math.random() * .9}s;animation-duration:${Math.random() * 1.5 + 1.8}s`;
    document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
  }
}

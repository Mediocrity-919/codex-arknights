export function installBoot() {
  const dialog = document.querySelector('#boot-dialog'), canvas = document.querySelector('#boot-canvas');
  const caption = document.querySelector('#boot-caption'), copy = document.querySelector('.boot-copy');
  let frame = 0, start = 0, ending = false, previousFocus;
  function close() { cancelAnimationFrame(frame); ending = false; dialog.close(); previousFocus?.focus(); }
  function draw(now) {
    if (!dialog.open) return;
    const elapsed = (now - start) / 1000, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rect = canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio || 1, 3);
    const w = Math.round(rect.width * scale), h = Math.round(rect.height * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const cx = rect.width / 2, cy = rect.height / 2, r = Math.min(rect.height * .42, rect.width * .32);
    ctx.lineWidth = .7; ctx.strokeStyle = '#6696a548';
    const angle = reduced ? .3 : elapsed * .17;
    const project = (lat, lon) => { const x = Math.cos(lat) * Math.cos(lon + angle), z = Math.cos(lat) * Math.sin(lon + angle), y = Math.sin(lat); return [cx + x * r, cy + (y * .94 + z * .33) * r]; };
    for (let latitude = -75; latitude <= 75; latitude += 15) {
      ctx.beginPath(); for (let step = 0; step <= 90; step++) { const [x,y] = project(latitude * Math.PI/180, step * Math.PI/45); step ? ctx.lineTo(x,y) : ctx.moveTo(x,y); } ctx.stroke();
    }
    for (let longitude = 0; longitude < 360; longitude += 20) {
      ctx.beginPath(); for (let step = 0; step <= 60; step++) { const [x,y] = project(-Math.PI/2 + step * Math.PI/60, longitude * Math.PI/180); step ? ctx.lineTo(x,y) : ctx.moveTo(x,y); } ctx.stroke();
    }
    ctx.strokeStyle = '#326d8640'; ctx.beginPath(); ctx.moveTo(35,cy);ctx.lineTo(cx-r-20,cy);ctx.moveTo(cx+r+20,cy);ctx.lineTo(rect.width-35,cy);ctx.stroke();
    caption.textContent = elapsed < 1.2 ? '开始唤醒' : elapsed < 2.4 ? '让灵感，进入视野' : '准备好，开始工作';
    if (elapsed > (reduced ? 1 : 3.4)) { close(); return; }
    if (elapsed > 2.9 && !ending) { ending = true; copy.classList.add('exit'); }
    frame = requestAnimationFrame(draw);
  }
  document.querySelector('#boot-play').addEventListener('click', () => { previousFocus = document.activeElement; copy.classList.remove('exit'); ending = false; dialog.showModal(); start = performance.now(); frame = requestAnimationFrame(draw); });
  document.querySelector('#boot-skip').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => cancelAnimationFrame(frame));
}

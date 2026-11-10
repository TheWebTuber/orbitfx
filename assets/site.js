(() => {
  const toggle=document.querySelector('.menu-toggle');
  const nav=document.getElementById('nav-links');
  toggle?.addEventListener('click',()=>{const opened=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!opened));nav.classList.toggle('is-open',!opened);});
  nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('is-open');toggle?.setAttribute('aria-expanded','false');}));
  const scene=document.getElementById('preview-scene');
  if(!scene)return;
  document.querySelectorAll('.look-btn').forEach(btn=>btn.addEventListener('click',()=>{
    scene.dataset.look=btn.dataset.look;
    document.querySelectorAll('.look-btn').forEach(other=>{const active=other===btn;other.classList.toggle('is-active',active);other.setAttribute('aria-pressed',String(active));});
  }));
  const pause=document.getElementById('pause-preview');
  pause?.addEventListener('click',()=>{const paused=scene.classList.toggle('is-paused');pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label',paused?'Resume preview animation':'Pause preview animation');});
  const burst=document.getElementById('burst-preview');
  burst?.addEventListener('click',()=>{
    const colors=['#f8b4da','#8de8e4','#d5adff','#f9e5a5'];
    for(let i=0;i<28;i++){
      const piece=document.createElement('i');piece.className='confetti-piece';
      const theta=2*Math.PI*i/28;
      const distance=75+Math.random()*170;
      piece.style.setProperty('--tx', `${Math.cos(theta)*distance}px`);
      piece.style.setProperty('--ty', `${Math.sin(theta)*distance+65}px`);
      piece.style.setProperty('--r', `${Math.random()*850-425}deg`);
      piece.style.setProperty('--dur', `${1+Math.random()*.8}s`);
      piece.style.setProperty('--color',colors[i%colors.length]);
      scene.appendChild(piece);
      piece.addEventListener('animationend',()=>piece.remove(),{once:true});
    }
  });
})();

/* OrbitFX Studio beta v3. Plain JavaScript; no build step.
 * Sections: project validation, storage, scene rendering, layers, video, output.
 * VDO.Ninja is receive-only. Webcam permission is requested only by Connect.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ART = 'cards/memoria card no bg.png';
  const MAX_BYTES = 24 * 1024 * 1024;
  const controls = [...document.querySelectorAll('[data-setting]')];
  const DEFAULTS = Object.fromEntries(controls.map(el => [el.id, el.type === 'checkbox' ? false : el.type === 'range' ? Number(el.defaultValue) : el.value]));
  DEFAULTS.keyEnabled = true;
  Object.assign(DEFAULTS, { source: 'demo', streamID: 'your-stream-id' });
  let project = freshProject();
  let selectedLayer = null;
  let selectedSlot = 0;
  let cards = [], particles = [], layerNodes = [];
  let phase = 0, cardSpin = 0, clock = 0, previousTime = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let burst = [];
  let ready = false;
  let saveTimer;
  let database;
  let saveQueue = Promise.resolve();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pmog-studio-pro-v2') : null;
  const id = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function freshProject() { return { version: 3, slots: Array.from({length:36},slotDefaults), settings: {...DEFAULTS}, cards: [{id:'original', name:'Original memory card', src:ART}], layers: [] }; }
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const safeImage = value => typeof value === 'string' && (value === ART || /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) && value.length < 7 * 1024 * 1024;
  const text = (value, length, fallback='') => typeof value === 'string' ? value.slice(0,length) : fallback;
  function validateProject(raw) {
    if (!raw || ![2,3].includes(raw.version) || !raw.settings || !Array.isArray(raw.cards) || !Array.isArray(raw.layers)) throw Error('Choose a Studio Pro project JSON file.');
    if (raw.cards.length > 24 || raw.layers.length > 30 || JSON.stringify(raw).length > MAX_BYTES) throw Error('Project is too large (24 MB, 24 card designs, or 30 layers maximum).');
    const clean = freshProject();
    for (const el of controls) {
      const value = raw.settings[el.id];
      if (el.type === 'range') clean.settings[el.id] = clamp(value, Number(el.min), Number(el.max), DEFAULTS[el.id]);
      else if (el.type === 'checkbox') clean.settings[el.id] = typeof value === 'boolean' ? value : DEFAULTS[el.id];
      else if (el.type === 'color') clean.settings[el.id] = color(value,DEFAULTS[el.id]);
      else if ([...el.options].some(option => option.value === value)) clean.settings[el.id] = value;
    }
    clean.settings.source = ['vdo','camera','demo','none'].includes(raw.settings.source) ? raw.settings.source : 'vdo';
    clean.settings.streamID = /^[a-z0-9_-]{1,128}$/i.test(raw.settings.streamID) ? raw.settings.streamID : 'your-stream-id';
    clean.cards = raw.cards.map(card => {
      if (!card || !safeImage(card.src)) throw Error('Project contains an unsupported card image.');
      return {id:id(),name:text(card.name,80,'Card image'),src:card.src};
    });
    clean.layers = raw.layers.map(layer => {
      if (!layer || !['image','text'].includes(layer.type) || (layer.type === 'image' && !safeImage(layer.src))) throw Error('Project contains an unsupported layer.');
      return { id:id(), type:layer.type, name:text(layer.name,60,'Layer'), src:layer.type==='image'?layer.src:undefined,
        text:text(layer.text,300,'Your text'), color:color(layer.color,'#ffffff'), x:clamp(layer.x,0,100,50),y:clamp(layer.y,0,100,50),
        size:clamp(layer.size,2,80,20),z:clamp(layer.z,-700,500,0),rotation:clamp(layer.rotation,-180,180,0),opacity:clamp(layer.opacity,0,100,100),
        depth:layer.depth==='back'?'back':'front', animation:['float','spin','pulse'].includes(layer.animation)?layer.animation:'none',visible:layer.visible!==false };
    });
    clean.slots = Array.from({length:36},(_,i)=>validateSlot(raw.slots?.[i]));
    return clean;
  }
  function notice(message) { $('status').textContent = message; }

  // Local persistence uses IndexedDB, so uploaded images are not limited to localStorage.
  function openDatabase() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('pmog-studio-pro',1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Storage is blocked'));
    });
  }
  function readSaved() {
    return new Promise((resolve,reject) => {
      const request = database.transaction('projects').objectStore('projects').get('autosave');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function persist(snapshot) {
    return new Promise((resolve,reject) => {
      if (!database) return reject(Error('No storage'));
      const tx = database.transaction('projects','readwrite');
      tx.objectStore('projects').put(snapshot,'autosave');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function changed() {
    if (!ready) return;
    $('save-status').textContent = 'Saving locally…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snapshot = copy(project);
      saveQueue = saveQueue.catch(()=>{}).then(()=>persist(snapshot)).then(() => {
        $('save-status').textContent = 'Saved in this browser';
      }).catch(() => { $('save-status').textContent = 'Autosave unavailable — download your project to keep it.'; });
      channel?.postMessage(snapshot);
    },300);
  }
  channel?.addEventListener('message', event => {
    if (!document.body.classList.contains('clean') || document.body.dataset.output === 'true') return;
    try { project = validateProject(event.data); selectedLayer = null; renderAll(); } catch { /* Ignore incompatible preview messages. */ }
  });

  // Scene and effects. Filters are applied to individual objects, never the 3D parent.

  // Custom key uses absolute RGB distance. Composite against SourceGraphic
  // preserves the input alpha: transparent PNGs never acquire a matte.
  function updateKeyFilter(filter,mode,keyColor,tolerance,threshold,softness){
    const signature=[mode,keyColor,tolerance,threshold,softness].join('|');
    if(filter.dataset.keySignature===signature)return;filter.dataset.keySignature=signature;
    filter.replaceChildren();
    const add=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);filter.append(el);};
    const rgb='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ';
    if(mode==='custom'){
      add('feFlood',{'flood-color':keyColor,'flood-opacity':1,result:'key-color'});
      add('feBlend',{in:'SourceGraphic',in2:'key-color',mode:'difference',result:'distance'});
      const gain=100/(3*softness),offset=-tolerance/softness;
      add('feColorMatrix',{in:'distance',type:'matrix',values:rgb+[gain,gain,gain,0,offset].join(' '),result:'keep-mask'});
      add('feComposite',{in:'SourceGraphic',in2:'keep-mask',operator:'in'});
    }else{
      const g=100/softness,o=-threshold/softness;
      add('feColorMatrix',{in:'SourceGraphic',type:'matrix',result:'over-red',values:rgb+(mode==='blue'?[-g,0,g,0,o]:[-g,g,0,0,o]).join(' ')});
      add('feColorMatrix',{in:'SourceGraphic',type:'matrix',result:'over-other',values:rgb+(mode==='blue'?[0,-g,g,0,o]:[0,g,-g,0,o]).join(' ')});
      add('feComposite',{in:'over-red',in2:'over-other',operator:'in',result:'remove-mask'});
      add('feComposite',{in:'SourceGraphic',in2:'remove-mask',operator:'out'});
    }
  }

  function applySettings() {
    const s = project.settings;
    for (const el of controls) {
      if (el.type === 'checkbox') el.checked = s[el.id]; else el.value = s[el.id];
      if (el.type === 'range') document.querySelector(`output[for="${el.id}"]`).value = `${el.value}${el.dataset.unit}`;
    }
    $('source').value = s.source; $('stream-id').value = s.streamID;
    $('stream-label').hidden = s.source !== 'vdo';
    $('stage').style.background = s.backgroundMode === 'transparent' ? 'transparent' : s.backgroundMode === 'gradient' ? `radial-gradient(ellipse at 50% 40%,${s.secondary},${s.background} 75%)` : s.background;
    document.documentElement.style.setProperty('--accent',s.accent);
    $('model-plane').style.cssText = `width:${s.modelSize}vw;height:${s.modelSize}vh;left:${s.modelX}vw;top:${s.modelY}vh;transform:translate(-50%,-50%) translateZ(${s.modelZ}px) scaleX(${s.mirror?-1:1}) scaleY(${s.flipVertical?-1:1});filter:hue-rotate(${s.hue}deg) saturate(${s.saturation}%) brightness(${s.brightness}%) drop-shadow(0 0 ${s.modelGlow}px ${s.modelGlow?s.modelGlowColor:'transparent'})`;
    $('model-key').style.filter = s.keyEnabled ? 'url(#studio-green-key)' : 'none';
    updateKeyFilter($('studio-green-key'),s.modelKeyMode,s.modelKeyColor,s.modelTolerance,s.threshold,s.softness);
    drawWheel();
    $('portal-effect').hidden = !s.portal; $('scanlines-effect').hidden = !s.scanlines; $('letterbox-effect').hidden = !s.letterbox;
    cards.forEach((card,i)=>styleCard(card,i));
  }
  // Numbered card slots retain their settings when the orbit count changes.
  function slotDefaults(){return {type:'library',src:'',name:'',visible:true,size:100,x:0,y:0,z:0,rotation:0,face:false,key:'off',keyColor:'#ffffff',tolerance:12,flipX:false,flipY:false,threshold:6,softness:8,glow:0,glowColor:'#aa88ff'};}
  function mediaURL(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
  function validateSlot(raw){
    const s=slotDefaults();if(!raw)return s;
    s.type=['library','image','video','vdo','web'].includes(raw.type)?raw.type:'library';
    s.keyColor=color(raw.keyColor,'#ffffff');s.tolerance=clamp(raw.tolerance,0,100,12);s.flipX=raw.flipX===true;s.flipY=raw.flipY===true;
    s.name=text(raw.name,60);s.visible=raw.visible!==false;s.face=raw.face===true;
    s.key=['green','blue','custom'].includes(raw.key)&&s.type!=='web'?raw.key:'off';s.glowColor=color(raw.glowColor,s.glowColor);
    for(const [key,min,max] of [['size',20,300],['x',-1000,1000],['y',-700,700],['z',-700,500],['rotation',-180,180],['threshold',0,50],['softness',1,40],['glow',0,40]])s[key]=clamp(raw[key],min,max,s[key]);
    if(s.type==='vdo'){s.src=raw.src?parseStream(raw.src):'';}
    else if(s.type!=='library'&&raw.src){
      const data=s.type==='image'?safeImage(raw.src):s.type==='video'&&typeof raw.src==='string'&&raw.src.length<17*1024*1024&&/^data:video\/(mp4|webm);base64,[a-z0-9+/=]+$/i.test(raw.src);
      if(!data&&!mediaURL(raw.src))throw Error('A card has an unsupported media link.');s.src=raw.src;
    }
    return s;
  }
  function disposeCard(card){card.disposed=true;card.client?.disconnect().catch(()=>{});card.querySelectorAll('video').forEach(v=>{v.pause();v.srcObject?.getTracks().forEach(t=>t.stop());v.srcObject=null;v.removeAttribute('src');v.load();});card.keyFilter?.remove();card.remove();}
  function styleCard(card,i){
    const slot=project.slots[i],s=project.settings;
    card.hidden=!slot.visible;card.style.width=`${s.cardSize*slot.size/100}vw`;
    card.style.filter=`drop-shadow(0 0 ${slot.glow||s.cardGlow}px ${slot.glow?slot.glowColor:s.cardGlow?s.accent:'transparent'})`;
    card.querySelector('.card-number').hidden=!$('show-numbers').checked;
    const media=card.querySelector('.card-media');media.style.filter=slot.key!=='off'&&slot.type!=='web'?`url(#card-key-${i})`:'none';
    media.style.transform=`scale(${slot.flipX?-1:1},${slot.flipY?-1:1})`;
    updateKeyFilter(card.keyFilter,slot.key,slot.keyColor,slot.tolerance,slot.threshold,slot.softness);
  }

  function buildCard(i){
    const slot=project.slots[i],card=document.createElement('div');card.className='orbit-card';card.dataset.slot=i+1;
    const media=document.createElement('div');media.className='card-media';const number=document.createElement('span');number.className='card-number';number.textContent=i+1;card.append(media,number);
    const filter=$('studio-green-key').cloneNode(true);filter.id=`card-key-${i}`;delete filter.dataset.keySignature;filter.classList.add('card-filter');filter.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));$('studio-green-key').parentNode.append(filter);card.keyFilter=filter;
    const src=slot.type==='library'?project.cards[i%Math.max(1,project.cards.length)]?.src:slot.src;
    if(src){
      const el=document.createElement(slot.type==='web'?'iframe':['video','vdo'].includes(slot.type)?'video':'img');
      if(el.tagName==='IFRAME'){
        el.title=slot.name||`Web card ${i+1}`;el.sandbox='allow-scripts allow-same-origin';el.allow='autoplay';el.referrerPolicy='no-referrer';el.src=src;
      }else if(el.tagName==='VIDEO'){
        el.muted=true;el.autoplay=true;el.playsInline=true;el.loop=slot.type==='video';
        if(slot.type==='video'){el.src=src;el.play().catch(()=>{});}
        else connectCard(card,el,src,i);
      }else{el.alt=slot.name||`Card ${i+1}`;el.src=src;}
      el.addEventListener('error',()=>{notice(`Card ${i+1} could not load. Check its URL or upload the file.`);});media.append(el);
    }
    $('world').append(card);styleCard(card,i);return card;
  }
  async function connectCard(card,video,stream,i){
    try{
      await loadSDK();if(card.disposed)return;
      const receiver=new VDONinjaSDK({salt:'vdo.ninja',debug:false});card.client=receiver;
      receiver.addEventListener('track',event=>{if(card.disposed||event.detail.track.kind!=='video')return;video.srcObject=new MediaStream([event.detail.track]);video.play().catch(()=>notice(`Click Use this link to retry card ${i+1}.`));});
      receiver.addEventListener('peerDisconnected',()=>{video.srcObject=null;});
      await receiver.connect();if(card.disposed){await receiver.disconnect();return;}
      await receiver.view(stream,{audio:false,video:true,downloads:false,allowresources:false});
    }catch{if(!card.disposed)notice(`Card ${i+1}: live connection failed. Check that its sender is live and use the link again.`);}
  }
  function renderCards(){
    cards.forEach(disposeCard);cards=[];
    for(let i=0;i<project.settings.cardCount;i++)cards.push(buildCard(i));
  }
  function refreshSlot(i){if(cards[i]){disposeCard(cards[i]);cards[i]=buildCard(i);}renderSlotEditor();changed();}
  function renderSlotEditor(){
    const count=project.settings.cardCount;selectedSlot=Math.min(selectedSlot,Math.max(0,count-1));
    $('slot-grid').replaceChildren();
    for(let i=0;i<count;i++){const button=document.createElement('button');button.textContent=i+1;button.setAttribute('aria-label',`Edit card ${i+1}`);button.setAttribute('aria-pressed',String(i===selectedSlot));button.onclick=()=>{selectedSlot=i;renderSlotEditor();};$('slot-grid').append(button);}
    $('slot-editor').hidden=!count;if(!count){$('slot-grid').textContent='Increase Number of cards in Scene to add cards.';return;}
    const slot=project.slots[selectedSlot];$('slot-title').textContent=`Card ${selectedSlot+1}`;
    for(const key of ['name','type','visible','size','x','y','z','rotation','face','key','keyColor','tolerance','flipX','flipY','threshold','softness','glow','glowColor']){
      const el=$('slot-'+key);if(el.type==='checkbox')el.checked=slot[key];else el.value=slot[key];
      if(el.type==='range')document.querySelector(`output[for="slot-${key}"]`).value=slot[key];
    }
    $('slot-url').value=slot.src.startsWith('data:')?'':slot.src;
    $('slot-url').disabled=slot.type==='library';$('slot-apply').disabled=slot.type==='library';$('slot-key').disabled=slot.type==='web';
    $('slot-media-status').textContent=slot.type==='library'?'Uses the shared library. Upload below to replace just this card.':slot.src.startsWith('data:')?'Uploaded file included in project saves.':slot.src?'Linked media: requires its source to remain available.':'Choose a link or upload a file.';
  }
  for(const key of ['name','visible','size','x','y','z','rotation','face','key','keyColor','tolerance','flipX','flipY','threshold','softness','glow','glowColor'])$('slot-'+key).addEventListener('input',event=>{
    const slot=project.slots[selectedSlot],el=event.target;slot[key]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value;
    if(el.type==='range')document.querySelector(`output[for="slot-${key}"]`).value=el.value;
    if(cards[selectedSlot])styleCard(cards[selectedSlot],selectedSlot);changed();
  });
  $('slot-type').onchange=event=>{const slot=project.slots[selectedSlot];slot.type=event.target.value;slot.src='';if(slot.type==='web')slot.key='off';refreshSlot(selectedSlot);};
  $('slot-apply').onclick=()=>{
    try{const slot=project.slots[selectedSlot],value=$('slot-url').value.trim();const src=slot.type==='vdo'?parseStream(value):mediaURL(value);if(!src)throw Error('Use an http:// or https:// media URL.');slot.src=src;refreshSlot(selectedSlot);notice(`Card ${selectedSlot+1} link applied. Webpages must permit embedding.`);}catch(error){notice(error.message);}
  };
  $('slot-upload').onchange=async event=>{
    const file=event.target.files[0],index=selectedSlot;event.target.value='';if(!file)return;
    try{
      const movie=['video/mp4','video/webm'].includes(file.type);if(!movie&&!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Upload PNG, JPG, WebP, GIF, MP4, or WebM.');
      if(file.size>(movie?12:4)*1024*1024)throw Error(movie?'Movies can be up to 12 MB. Use a direct URL for a larger movie.':'Images can be up to 4 MB.');
      const src=await readDataURL(file);
      if(!movie){const image=new Image();image.src=src;await image.decode();if(image.naturalWidth*image.naturalHeight>24e6)throw Error('Resize the image below 24 megapixels.');}
      if(JSON.stringify(project).length-project.slots[index].src.length+src.length>MAX_BYTES)throw Error('Project limit is 24 MB. Remove large uploads or use media URLs.');
      Object.assign(project.slots[index],{type:movie?'video':'image',src,name:file.name.slice(0,60)});refreshSlot(index);notice(`Uploaded ${file.name} to card ${index+1}.`);
    }catch(error){notice(error.message);}
  };
  $('slot-reset').onclick=()=>{project.slots[selectedSlot]=slotDefaults();refreshSlot(selectedSlot);};
  $('show-numbers').onchange=()=>cards.forEach(styleCard);

  function renderCardLibrary() {
    $('card-library').replaceChildren();
    for (const card of project.cards) {
      const row=document.createElement('div');row.className='asset-row';
      const image=document.createElement('img'); image.src=card.src;image.alt='';
      const name=document.createElement('span');name.textContent=card.name;
      const remove=document.createElement('button');remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${card.name}`);
      remove.onclick=()=>{project.cards=project.cards.filter(c=>c.id!==card.id);renderCardLibrary();renderCards();applySettings();changed();};
      row.append(image,name,remove);$('card-library').appendChild(row);
    }
    if (!project.cards.length) $('card-library').textContent='No card images. Add one to bring the orbit back.';
  }
  function seed(index) { const value=Math.sin(index*127.1+311.7)*43758.5453; return value-Math.floor(value); }
  function renderParticles() {
    $('particles').replaceChildren(); particles=[]; burst=[];
    if (project.settings.particleType==='none') return;
    for(let i=0;i<project.settings.particleAmount;i++) {
      const el=document.createElement('span');el.className='particle';
      const type=project.settings.particleType;
      const size=type==='hearts'?16:3+seed(i+4)*6;
      el.style.cssText=`width:${size}px;height:${size}px;background:${type==='hearts'?'transparent':type==='confetti'?`hsl(${seed(i+2)*360} 90% 70%)`:project.settings.accent};border-radius:${['snow','stars','embers'].includes(type)?'50%':'1px'};color:${project.settings.accent};font-size:18px;line-height:1;`;
      if(type==='hearts') el.textContent='♥';
      $('particles').appendChild(el);particles.push({el,x:seed(i),y:seed(i+100),speed:.5+seed(i+40),size});
    }
  }
  function confettiBurst() {
    if (paused) { notice('Resume motion to play the confetti burst.'); return; }
    burst.forEach(p=>p.el.remove());burst=[];
    for(let i=0;i<65;i++) {
      const el=document.createElement('span');el.className='particle';el.style.background=`hsl(${i*37%360} 90% 65%)`;
      $('particles').appendChild(el);burst.push({el,start:clock,vx:(seed(i)-.5)*1.1,vy:-.5-seed(i+1)*.6});
    }
  }
  function updatePause() { $('pause').textContent=paused?'Resume motion':'Pause motion';$('pause').setAttribute('aria-pressed',String(paused)); }
  function animate(time) {
    const dt=previousTime?Math.min((time-previousTime)/1000,.05):0;previousTime=time;
    const s=project.settings;
    if(!paused) {clock+=dt;phase=(phase+dt*s.speed)%360;cardSpin=(cardSpin+dt*s.spin)%360;}
    const w=innerWidth,h=innerHeight,r=w*.43*s.radius/100,depth=Math.min(w*.30,440)*s.depth/100,tilt=s.tilt*Math.PI/180;
    cards.forEach((card,i)=>{
      const slot=project.slots[i];
      const angle=s.orbitMotion==='swing'?Math.sin(phase*Math.PI/180)*100:phase;
      const a=(angle+i*360/cards.length)*Math.PI/180;
      let y=Math.cos(a)*Math.sin(tilt)*Math.min(r,h*.65);
      if(s.orbitStyle==='helix') y+=(i/(Math.max(1,cards.length-1))-.5)*h*.55;
      if(s.orbitStyle==='wave') y+=Math.sin(a*3+clock)*h*.12;
      const roll=s.orbitRoll*Math.PI/180, orbitX=Math.sin(a)*r;
      const rotatedX=orbitX*Math.cos(roll)-y*Math.sin(roll),rotatedY=orbitX*Math.sin(roll)+y*Math.cos(roll);
      const horizontal=(s.orbitX+Math.sin(clock*s.swaySpeed/25)*s.sway)*w/100;
      card.style.transform=`translate3d(${rotatedX+horizontal+slot.x}px,${rotatedY+s.orbitY*h/100+slot.y}px,${Math.cos(a)*depth+slot.z}px) translate(-50%,-50%) rotateY(${slot.face?0:cardSpin+i*30}deg) rotateZ(${slot.rotation+(slot.face?0:Math.sin(a)*9)}deg)`;
    });
    $('portal-effect').style.transform=`translate(-50%,-50%) rotate(${clock*9}deg)`;
    const speed=s.particleSpeed/160;
    particles.forEach((p,i)=>{
      const direction=s.particleType==='embers'?-1:1;
      const y=((p.y+clock*speed*p.speed*.12*direction)%1+1)%1;
      const x=(p.x+Math.sin(clock*.4+i)*.025)*w;
      p.el.style.transform=`translate(${x}px,${y*h}px) rotate(${s.particleType==='confetti'?clock*(i%2?40:-40):0}deg)`;
      p.el.style.opacity=s.particleType==='stars'?String(.4+.35*Math.sin(clock*.6+i)):'.8';
    });
    burst=burst.filter(p=>{const age=clock-p.start;if(age>3){p.el.remove();return false;}p.el.style.transform=`translate(${w*(.5+p.vx*age)}px,${h*(.75+p.vy*age+.4*age*age)}px) rotate(${age*300}deg)`;p.el.style.opacity=String(Math.max(0,1-age/3));return true;});
    layerNodes.forEach(({el,layer})=>{
      const float=layer.animation==='float'?Math.sin(clock*1.5)*12:0;
      const rotation=layer.rotation+(layer.animation==='spin'?clock*25:0);
      const scale=layer.animation==='pulse'?1+Math.sin(clock*1.5)*.045:1;
      el.style.transform=`translate(-50%,calc(-50% + ${float}px)) translateZ(${layer.z||0}px) rotate(${rotation}deg) scale(${scale})`;
    });
    requestAnimationFrame(animate);
  }


  // HSV wheel: a real hue/saturation wheel, plus brightness and keyboard controls.
  function rgbToHSV(hex) {
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const [r,g,b]=rgb,max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
    let hue=0;
    if(d)hue=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60;
    return [hue,max?d/max:0,max];
  }
  function hsvRGB(h,s,v) {
    const f=n=>{const k=(n+h/60)%6;return Math.round(255*v*(1-s*Math.max(0,Math.min(k,4-k,1))));};
    return [f(5),f(3),f(1)];
  }
  function setWheel(h,s,v) {
    project.settings.background='#'+hsvRGB((h+360)%360,Math.max(0,Math.min(1,s)),v).map(n=>n.toString(16).padStart(2,'0')).join('');
    if(project.settings.backgroundMode==='transparent')project.settings.backgroundMode='solid';
    applySettings();changed();
  }
  function drawWheel() {
    const canvas=$('color-wheel'),ctx=canvas.getContext('2d');
    const [h,s,v]=rgbToHSV(project.settings.background),size=canvas.width,center=size/2,radius=center-5;
    const pixels=ctx.createImageData(size,size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dx=x-center,dy=y-center,sat=Math.hypot(dx,dy)/radius;if(sat>1)continue;
      const hue=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
      const rgb=hsvRGB(hue,sat,v),i=(y*size+x)*4;
      pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);ctx.beginPath();ctx.arc(center+Math.cos(h*Math.PI/180)*s*radius,center+Math.sin(h*Math.PI/180)*s*radius,6,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#111';ctx.lineWidth=1;ctx.stroke();
    $('wheel-value').value=Math.round(v*100);$('wheel-hex').value=project.settings.background;
    canvas.setAttribute('aria-valuenow',String(Math.round(h)));canvas.setAttribute('aria-valuetext',project.settings.background);
  }
  function wheelPointer(event) {
    const rect=$('color-wheel').getBoundingClientRect(),dx=(event.clientX-rect.left)/rect.width*220-110,dy=(event.clientY-rect.top)/rect.height*220-110;
    const [, ,v]=rgbToHSV(project.settings.background);
    setWheel(Math.atan2(dy,dx)*180/Math.PI,Math.hypot(dx,dy)/105,v||1);
  }
  $('color-wheel').onpointerdown=event=>{$('color-wheel').setPointerCapture(event.pointerId);wheelPointer(event);};
  $('color-wheel').onpointermove=event=>{if($('color-wheel').hasPointerCapture(event.pointerId))wheelPointer(event);};
  $('color-wheel').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const [h,s,v]=rgbToHSV(project.settings.background);setWheel(h+(event.key==='ArrowLeft'?-5:event.key==='ArrowRight'?5:0),s+(event.key==='ArrowUp'?.05:event.key==='ArrowDown'?-.05:0),v||1);};
  $('wheel-value').oninput=event=>{const [h,s]=rgbToHSV(project.settings.background);setWheel(h,s,Number(event.target.value)/100);};

  // Assets and layer editing. User content is assigned with textContent, never HTML.
  function renderLayers() {
    $('overlay-back').replaceChildren();$('overlay-front').replaceChildren();layerNodes=[];
    for(const layer of project.layers) {
      const el=document.createElement('div');el.className='scene-layer';el.hidden=!layer.visible;
      el.style.cssText=`left:${layer.x}%;top:${layer.y}%;width:${layer.size}vw;opacity:${layer.opacity/100};color:${layer.color};font-size:${layer.size/5}vw;`;
      if(layer.type==='image'){const image=document.createElement('img');image.src=layer.src;image.alt=layer.name;el.appendChild(image);}else el.textContent=layer.text;
      $(layer.depth==='back'?'overlay-back':'overlay-front').appendChild(el);layerNodes.push({el,layer});
    }
  }
  function renderLayerList() {
    $('layer-list').replaceChildren();$('layer-count').textContent=`${project.layers.length}/30`;
    project.layers.forEach(layer=>{
      const row=document.createElement('div');row.className='layer-row';const button=document.createElement('button');
      button.textContent=`${layer.visible?'':'Hidden · '}${layer.name}`;button.classList.toggle('selected',layer.id===selectedLayer);
      button.setAttribute('aria-pressed',String(layer.id===selectedLayer));button.onclick=()=>{selectedLayer=layer.id;renderLayerList();renderLayerEditor();};
      row.appendChild(button);$('layer-list').appendChild(row);
    });
    if(!project.layers.length)$('layer-list').textContent='Your scene is ready for its first extra.';
  }
  const selected=()=>project.layers.find(layer=>layer.id===selectedLayer);
  function renderLayerEditor() {
    const layer=selected();$('layer-editor').hidden=!layer;if(!layer)return;
    $('layer-name').value=layer.name;$('layer-text').value=layer.text||'';$('layer-color').value=layer.color;
    $('layer-text-label').hidden=layer.type!=='text';$('layer-color-label').hidden=layer.type!=='text';
    for(const key of ['x','y','size','rotation','opacity','z']){const el=$('layer-'+key);el.value=layer[key];document.querySelector(`output[for="layer-${key}"]`).value=`${el.value}${el.dataset.unit}`;}
    $('layer-depth').value=layer.depth;$('layer-animation').value=layer.animation;$('layer-visible').checked=layer.visible;
  }
  function addLayer(extra) {
    if(project.layers.length>=30){notice('Maximum 30 layers. Remove a layer first.');return;}
    const layer={id:id(),type:'text',name:'Text',text:'Your text',color:'#ffffff',x:50,y:75,size:24,z:0,rotation:0,opacity:100,depth:'front',animation:'none',visible:true,...extra};
    project.layers.push(layer);selectedLayer=layer.id;renderLayers();renderLayerList();renderLayerEditor();changed();
  }
  $('add-text').onclick=()=>addLayer({});
  document.querySelectorAll('[data-sticker]').forEach(button=>button.onclick=()=>addLayer({name:`Sticker ${button.dataset.sticker}`,text:button.dataset.sticker,size:30,x:75,y:25}));
  for(const key of ['name','text','color','x','y','size','rotation','opacity','z','depth','animation','visible']) {
    $('layer-'+key).addEventListener('input',event=>{
      const layer=selected();if(!layer)return;
      layer[key]=event.target.type==='range'?Number(event.target.value):event.target.type==='checkbox'?event.target.checked:event.target.value;
      if(event.target.type==='range')document.querySelector(`output[for="layer-${key}"]`).value=`${event.target.value}${event.target.dataset.unit}`;
      renderLayers();if(key==='name'||key==='visible')renderLayerList();changed();
    });
  }
  $('delete-layer').onclick=()=>{project.layers=project.layers.filter(l=>l.id!==selectedLayer);selectedLayer=null;renderLayers();renderLayerList();renderLayerEditor();changed();};
  $('duplicate-layer').onclick=()=>{const layer=selected();if(layer)addLayer({...copy(layer),id:id(),name:layer.name.slice(0,50)+' copy',x:Math.min(100,layer.x+3)});};
  $('raise-layer').onclick=()=>{const index=project.layers.findIndex(l=>l.id===selectedLayer);if(index>=0&&index<project.layers.length-1){[project.layers[index],project.layers[index+1]]=[project.layers[index+1],project.layers[index]];renderLayers();renderLayerList();changed();}};
  const readDataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read file.'));reader.readAsDataURL(file);});
  async function upload(event,kind) {
    const files=[...event.target.files];event.target.value='';let count=0;
    for(const file of files) {
      try {
        if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>4*1024*1024)throw Error('Use PNG, JPG, WebP, or GIF images up to 4 MB each.');
        if((kind==='card'&&project.cards.length>=24)||(kind==='layer'&&project.layers.length>=30))throw Error('The scene has reached its asset limit.');
        const src=await readDataURL(file);if(JSON.stringify(project).length+src.length>MAX_BYTES)throw Error('Project limit is 24 MB. Remove some images first.');
        const image=new Image();image.src=src;await image.decode();
        if(image.naturalWidth*image.naturalHeight>24e6)throw Error('Resize this image below 24 megapixels first.');
        if(kind==='card')project.cards.push({id:id(),name:file.name.slice(0,80),src});
        else addLayer({type:'image',name:file.name.slice(0,60),src,text:'',size:22,x:70,y:40});
        count++;
      }catch(error){notice(error.message);break;}
    }
    if(kind==='card'){renderCards();renderCardLibrary();applySettings();changed();}
    if(count)notice(`Added ${count} image${count===1?'':'s'}. Saved locally; include them in your next project export.`);
  }
  $('card-upload').onchange=event=>upload(event,'card');$('overlay-upload').onchange=event=>upload(event,'layer');

  // Presets change atmosphere, not the user's content.
  const effectKeys=['backgroundMode','background','secondary','particleType','particleAmount','particleSpeed','portal','scanlines','letterbox','accent','cardGlow','modelGlow','hue','saturation','brightness'];
  const presets={classic:{},arcane:{backgroundMode:'gradient',background:'#090518',secondary:'#3b155b',particleType:'embers',portal:true,cardGlow:8,accent:'#c09aff'},cosmic:{backgroundMode:'gradient',background:'#020718',secondary:'#1c2855',particleType:'stars',particleAmount:85,cardGlow:5,accent:'#a6cfff'},celebrate:{background:'#21113d',particleType:'confetti',particleAmount:70,accent:'#ff9bc8'},snow:{backgroundMode:'gradient',background:'#061a30',secondary:'#245a73',particleType:'snow',particleAmount:65,accent:'#ffffff'},clean:{backgroundMode:'transparent',particleType:'none',portal:false,cardGlow:0,modelGlow:0}};
  function preset(name){effectKeys.forEach(key=>project.settings[key]=DEFAULTS[key]);Object.assign(project.settings,presets[name]);applySettings();renderParticles();changed();notice('Look applied. Your images and layers are unchanged.');}
  document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>preset(button.dataset.preset));
  $('reset-effects').onclick=()=>preset('classic');$('confetti-burst').onclick=confettiBurst;
  controls.forEach(el=>el.addEventListener('input',()=>{
    project.settings[el.id]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value;
    if(el.id==='background' && project.settings.backgroundMode==='transparent')project.settings.backgroundMode='solid';
    if(el.id==='cardCount'){renderCards();renderSlotEditor();}
    if(['particleType','particleAmount','accent'].includes(el.id))renderParticles();
    applySettings();changed();
  }));
  function renderAll(){renderCards();renderSlotEditor();renderCardLibrary();renderLayers();renderLayerList();renderLayerEditor();renderParticles();applySettings();updatePause();}

  // Video lifecycle: one active source; changing source stops previous tracks.
  const video=$('model-feed');let client=null,sourceToken=0,demoTimer=null,sdkPromise=null,waitTimer=null;
  function loadSDK(){
    if(window.VDONinjaSDK)return Promise.resolve();if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='vendor/vdoninja-sdk.js';script.dataset.sdk='true';
      const timeout=setTimeout(()=>{script.remove();reject(Error('The video library did not load.'));},15000);
      script.onload=()=>{clearTimeout(timeout);window.VDONinjaSDK?resolve():reject(Error('Video library unavailable.'));};
      script.onerror=()=>{clearTimeout(timeout);script.remove();reject(Error('Video library missing. Keep the vendor folder beside content.html.'));};
      document.head.appendChild(script);
    }).catch(error=>{sdkPromise=null;throw error;});return sdkPromise;
  }
  function clearVideo(){video.style.visibility='hidden';video.pause();video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;video.load();}
  async function stopSource(){
    sourceToken++;clearTimeout(waitTimer);clearInterval(demoTimer);demoTimer=null;clearVideo();
    const old=client;client=null;$('connect').disabled=false;
    if(old)try{await old.disconnect();}catch{}
  }
  function attachStream(stream,token){
    if(token!==sourceToken){stream.getTracks().forEach(t=>t.stop());return;}
    video.srcObject=stream;video.muted=true;
    for(const track of stream.getVideoTracks()){
      track.addEventListener('mute',()=>{if(token===sourceToken){video.style.visibility='hidden';notice('Video paused. Waiting for your source…');}});
      track.addEventListener('unmute',()=>{if(token===sourceToken)video.style.visibility='visible';});
      track.addEventListener('ended',()=>{if(token===sourceToken){clearVideo();notice('Video source ended. Click Connect source to retry.');}});
    }
    video.play().catch(()=>notice('Playback needs a click. Click Connect source again.'));
  }
  function parseStream(value){
    let result=value.trim();
    if(result.startsWith('https://')){const url=new URL(result);if(url.hostname!=='vdo.ninja')throw Error('Use a vdo.ninja view link.');result=url.searchParams.get('view')||'';}
    if(!/^[a-z0-9_-]{1,128}$/i.test(result))throw Error('Enter a valid VDO.Ninja stream ID or view link.');return result;
  }
  async function connectSource(){
    if($('connect').disabled)return;
    try{project.settings.streamID=parseStream($('stream-id').value);}catch(error){notice(error.message);return;}
    await stopSource();const token=sourceToken;$('connect').disabled=true;changed();
    const source=project.settings.source;
    try{
      if(source==='none'){notice('Model hidden. Your scene is still running.');return;}
      notice('Connecting video source…');
      if(source==='camera'){
        if(!navigator.mediaDevices?.getUserMedia)throw Error('Webcam access needs HTTPS or localhost in a supported browser.');
        attachStream(await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false}),token);
      }else if(source==='demo'){
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');let frame=0;
        const draw=()=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,960,540);ctx.fillStyle='#ffccad';ctx.beginPath();ctx.arc(480+Math.sin(frame/35)*25,180,70,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ede6ff';ctx.fillRect(365,245,230,295);ctx.fillStyle='#151522';ctx.fillRect(445+Math.sin(frame/35)*25,165,12,12);ctx.fillRect(510+Math.sin(frame/35)*25,165,12,12);ctx.font='22px sans-serif';ctx.fillText('KEY TEST',423,340);frame++;};
        draw();if(!canvas.captureStream)throw Error('Test video is unavailable in this browser.');attachStream(canvas.captureStream(30),token);demoTimer=setInterval(draw,33);
      }else{
        await loadSDK();if(token!==sourceToken)return;
        const next=new VDONinjaSDK({salt:'vdo.ninja',debug:false});client=next;
        next.addEventListener('track',event=>{if(token===sourceToken&&event.detail.track.kind==='video')attachStream(new MediaStream([event.detail.track]),token);});
        next.addEventListener('peerDisconnected',()=>{if(token===sourceToken){clearVideo();notice('Sender disconnected. Waiting for reconnection…');}});
        waitTimer=setTimeout(()=>{if(token===sourceToken&&!video.videoWidth)notice('Waiting for the sender. Check that your VDO.Ninja model is live.');},15000);
        await next.connect();if(token!==sourceToken)return;
        await next.view(project.settings.streamID,{audio:false,video:true,downloads:false,allowresources:false});
      }
    }catch(error){if(token===sourceToken){clearTimeout(waitTimer);notice(error.name==='NotAllowedError'?'Camera permission was not granted. Choose another source or allow it in your browser.':error.message||'Could not connect. Please retry.');}}
    finally{if(token===sourceToken)$('connect').disabled=false;}
  }
  video.addEventListener('playing',()=>{clearTimeout(waitTimer);video.style.visibility='visible';notice(project.settings.source==='demo'?'Green-screen test playing · not your live feed':'Receiving video · audio muted');});
  $('connect').onclick=connectSource;$('stop-source').onclick=async()=>{await stopSource();notice('Video stopped. Click Connect source when ready.');};
  $('source').onchange=async event=>{project.settings.source=event.target.value;applySettings();changed();await stopSource();notice('Source selected. Click Connect source to start it.');};

  // Portable projects and clean-output HTML carry uploaded images across browsers.
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function portableProject(){
    const result=copy(project);
    if(result.cards.some(card=>card.src===ART)){
      const response=await fetch(ART);if(!response.ok)throw Error('Original card image missing. Restore the cards folder or remove that card.');
      const data=await readDataURL(await response.blob());result.cards.forEach(card=>{if(card.src===ART)card.src=data;});
    }
    if(JSON.stringify(result).length>MAX_BYTES)throw Error('Export exceeds 24 MB. Remove or resize a few images.');
    return result;
  }
  $('export-project').onclick=async()=>{try{download('studio-project.json',JSON.stringify(await portableProject()),'application/json');notice('Project downloaded, including your uploaded images.');}catch(error){notice(error.message+' Use the localhost launcher if opened as a file.');}};
  $('import-project').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>MAX_BYTES)throw Error('Project must be below 24 MB.');
      const next=validateProject(JSON.parse(await file.text()));await stopSource();project=next;selectedLayer=null;renderAll();changed();
      notice('Project loaded. Click Connect source to start its video.');
    }catch(error){notice(error instanceof SyntaxError?'This file is not valid project JSON.':error.message);}
  };
  $('export-output').onclick=async()=>{
    try{
      const portable=await portableProject();const doc=document.documentElement.cloneNode(true);
      doc.querySelectorAll('.orbit-card,.particle,.scene-layer,.card-filter,script[data-sdk]').forEach(el=>el.remove());
      const body=doc.querySelector('body');body.classList.add('clean');body.dataset.output='true';
      doc.querySelector('#panel').removeAttribute('inert');
      doc.querySelector('#embedded-project').textContent=JSON.stringify(portable).replace(/</g,'\\u003c');
      download('scene-output.html','<!doctype html>\n'+doc.outerHTML,'text/html');
      notice('Save scene-output.html beside content.html, then use its URL in OBS.');
    }catch(error){notice(error.message+' Use the localhost launcher if opened as a file.');}
  };
  $('download-guide').onclick=()=>{const a=document.createElement('a');a.href='OBS-GUIDE.txt';a.download='OBS-GUIDE.txt';a.click();};
  $('copy-link').onclick=async()=>{
    const url=new URL(location.href);url.searchParams.set('clean','1');url.searchParams.delete('demo');
    try{await navigator.clipboard.writeText(url.href);notice('Clean URL copied. Export a clean OBS scene to include custom images and settings.');}catch{notice('Copy this address: '+url.href);}
  };
  $('clean-preview').onclick=()=>{const url=new URL(location.href);url.searchParams.set('clean','1');const win=window.open(url.href,'_blank');if(win)win.opener=null;else notice('Allow popups to open the clean preview.');};
  function cleanMode(value){document.body.classList.toggle('clean',value);$('panel').inert=value;if(!value)$('hide-ui').focus();}
  $('hide-ui').onclick=()=>cleanMode(true);
  $('pause').onclick=()=>{paused=!paused;updatePause();};
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey||event.repeat||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable)return;
    if(event.key.toLowerCase()==='h'){event.preventDefault();cleanMode(!document.body.classList.contains('clean'));}
    else if(event.code==='Space'&&event.target.tagName!=='BUTTON'){event.preventDefault();paused=!paused;updatePause();}
    else if(event.key.toLowerCase()==='b'){event.preventDefault();confettiBurst();}
  });
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notice('Use your browser’s full-screen command (usually F11).');}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
  document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
    document.querySelectorAll('[data-tab]').forEach(tab=>tab.setAttribute('aria-pressed',String(tab===button)));
    document.querySelectorAll('[data-section]').forEach(section=>section.hidden=section.dataset.section!==button.dataset.tab);
    $('panel').scrollTop=0;
  });
  window.addEventListener('pagehide',()=>{stopSource();cards.forEach(disposeCard);channel?.close();});
  async function initialize(){
    let embedded=null;try{embedded=JSON.parse($('embedded-project').textContent);}catch{}
    try{database=await openDatabase();if(!embedded){const saved=await readSaved();if(saved)project=validateProject(saved);}}catch{$('save-status').textContent='Storage unavailable. Download projects to keep your work.';}
    if(embedded)try{project=validateProject(embedded);}catch(error){notice(error.message);}
    const params=new URLSearchParams(location.search);if(params.get('demo')==='1')project.settings.source='demo';
    renderAll();ready=true;
    cleanMode(params.get('clean')==='1'||document.body.dataset.output==='true');
    requestAnimationFrame(animate);
    if(project.settings.source==='camera')notice('Webcam selected. Click Connect source to grant camera access.');
    else connectSource();
  }
  initialize();
})();

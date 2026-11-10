(function(){
'use strict';
const $=s=>document.querySelector(s);
const LS={store:'azq.store',hist:'azq.history',counter:'azq.counter',draft:'azq.draft'};
const DEF_STORE={sellerName:'',storeName:'AutoZone loja 7626',storePhone:'',storeCnpj:'',storeAddress:''};
const brl=v=>(Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\u00a0/g,' ');
const num=v=>{if(typeof v==='number')return v;v=String(v||'').trim().replace(/[R$\s]/g,'');if(v.includes(','))v=v.replace(/\./g,'').replace(',','.');const n=parseFloat(v);return isFinite(n)?n:0;};
const load=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const pad=n=>String(n).padStart(4,'0');
const todayISO=(add=0)=>{const d=new Date();d.setDate(d.getDate()+add);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtDate=iso=>{if(!iso)return '';const [y,m,d]=iso.slice(0,10).split('-');return `${d}/${m}/${y}`};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2200)};

const newItem=()=>({sku:'',desc:'',brand:'',avail:'estoque',qty:1,gross:'',net:'',disc:'',lastEdit:'net'});
const r2=n=>Math.round((Number(n)||0)*100)/100;
const fmtIn=n=>r2(n).toFixed(2).replace('.',',');
const fmtPct=d=>(Math.round((Number(d)||0)*100)/100).toLocaleString('pt-BR',{maximumFractionDigits:2});
function normItem(it){
  if(it&&it.price!==undefined&&it.gross===undefined){const pr=num(it.price),d=Math.min(100,Math.max(0,num(it.disc)));it.gross=it.price;it.net=d?fmtIn(pr*(1-d/100)):'';it.disc=d?fmtPct(d):'';it.lastEdit=d?'disc':'net';delete it.price}
  return Object.assign(newItem(),it);
}
function normQuote(x){if(x&&Array.isArray(x.items))x.items=x.items.map(normItem);if(x){x.vehicle=Object.assign({make:'',model:'',year:'',plate:'',engine:''},x.vehicle||{})}return x}
function nextNumber(){return load(LS.counter,0)+1}
function blankQuote(){return{id:null,number:nextNumber(),createdAt:todayISO(),client:{name:'',phone:''},vehicle:{make:'',model:'',year:'',plate:'',engine:''},notes:'',items:[newItem()],discType:'pct',discValue:''}}

let store=Object.assign({},DEF_STORE,load(LS.store,{}));
let q=normQuote(load(LS.draft,null))||blankQuote();
(function migrateHist(){const h=load(LS.hist,[]);if(h.some(x=>x.items&&x.items.some(i=>i.price!==undefined&&i.gross===undefined))){save(LS.hist,h.map(normQuote))}})();

const qNum=n=>'7626-'+pad(n);
const PAY_TEXT='Cartão de débito, Cartão de crédito, Pix ou Dinheiro';
function parcelas(total){
  const cents=Math.round((Number(total)||0)*100);
  const max=Math.max(1,Math.min(10,Math.floor(cents/5000)));
  const opts=[];for(let n=1;n<=max;n++){const base=Math.floor(cents/n),rest=cents-base*n;opts.push({n,value:base/100,first:(base+rest)/100,exact:rest===0})}
  return{max,opts,best:opts[max-1]};
}
function parcText(total){const b=parcelas(total).best;return `Cartão de crédito em até ${b.n}x de ${brl(b.value)} sem juros`+(b.exact?'':` (1ª parcela de ${brl(b.first)})`)}
const validText=qq=>`Orçamento válido somente para ${fmtDate(qq.createdAt)} (data de emissão)`;
function calc(qq=q){
  let sub=0,itemDisc=0;
  const lines=qq.items.map(it=>{it=normItem(it);const qty=Math.max(0,num(it.qty)),g=num(it.gross),n=String(it.net??'').trim()===''?g:Math.max(0,num(it.net)),d=g>0?Math.max(0,(g-n)/g*100):0;const gross=r2(qty*g),net=r2(qty*n);sub+=gross;itemDisc+=gross-net;return{...it,qty,g,n,d,gross,net,pr:g}});
  const afterItems=sub-itemDisc;
  let g=num(qq.discValue);g=qq.discType==='pct'?afterItems*Math.min(100,Math.max(0,g))/100:Math.min(afterItems,Math.max(0,g));
  return{lines,sub,itemDisc,globalDisc:g,disc:itemDisc+g,total:Math.max(0,afterItems-g)};
}

/* ---------- form binding ---------- */
const storeFields=['sellerName','storeName','storePhone','storeCnpj','storeAddress'];
const qFields={clientName:['client','name'],clientPhone:['client','phone'],vehMake:['vehicle','make'],vehModel:['vehicle','model'],vehYear:['vehicle','year'],vehEngine:['vehicle','engine'],vehPlate:['vehicle','plate'],notes:['notes'],discType:['discType'],discValue:['discValue']};
const getP=(o,p)=>p.length===1?o[p[0]]:o[p[0]][p[1]];
const setP=(o,p,v)=>{if(p.length===1)o[p[0]]=v;else o[p[0]][p[1]]=v};

function fillForm(){
  storeFields.forEach(f=>$('#'+f).value=store[f]||'');
  Object.entries(qFields).forEach(([id,p])=>$('#'+id).value=getP(q,p)??'');
  $('#quoteNumber').textContent='Nº '+qNum(q.number);
  $('#quoteDate').textContent=fmtDate(q.createdAt);
  renderItems();refresh();updStoreHint();
  if(!store.sellerName)$('#lojaCard').open=true;
}
storeFields.forEach(f=>$('#'+f).addEventListener('input',e=>{store[f]=e.target.value;storeDirty(true);refresh()}));
function storeDirty(d){const b=$('#saveStore');if(d){b.textContent='Salvar vendedor e loja';b.classList.remove('ok');$('#storeStatus').textContent='Alterações ainda não salvas.'}updStoreHint()}
function updStoreHint(){const sv=load(LS.store,null);$('#storeHint').textContent=sv&&sv.sellerName?('Vendedor: '+sv.sellerName):'toque para preencher'}
$('#saveStore').addEventListener('click',()=>{store=Object.fromEntries(storeFields.map(f=>[f,$('#'+f).value.trim()]));save(LS.store,store);storeFields.forEach(f=>$('#'+f).value=store[f]);const b=$('#saveStore');b.textContent='Salvo ✓';b.classList.add('ok');$('#storeStatus').textContent='Salvo neste aparelho. Da próxima vez já aparece preenchido.';updStoreHint();refresh();toast('Vendedor e loja salvos')});
Object.entries(qFields).forEach(([id,p])=>$('#'+id).addEventListener('input',e=>{let v=e.target.value;if(id==='vehPlate')v=v.toUpperCase();setP(q,p,v);refresh()}));
$('#discType').addEventListener('change',e=>{q.discType=e.target.value;refresh()});

function renderItems(){
  const box=$('#items');
  box.innerHTML=q.items.map((it,i)=>`
  <div class="item" data-i="${i}">
    <div class="item-head"><strong>Item ${i+1}</strong>${q.items.length>1?`<button type="button" class="rm" data-rm="${i}" aria-label="Remover item ${i+1}">Remover</button>`:''}</div>
    <div class="grid">
      <label>SKU / código<input data-f="sku" value="${esc(it.sku)}" inputmode="numeric" placeholder="Ex.: 100105260"></label>
      <label class="g2">Descrição<input data-f="desc" value="${esc(it.desc)}" placeholder="Ex.: Pastilha de freio dianteira"></label>
      <label>Marca<input data-f="brand" value="${esc(it.brand)}" placeholder="Ex.: Bosch"></label>
      <label>Disponibilidade<select data-f="avail"><option value="estoque"${it.avail==='estoque'?' selected':''}>Em estoque</option><option value="encomenda"${it.avail==='encomenda'?' selected':''}>Encomenda</option></select></label>
      <label>Qtd<input data-f="qty" value="${esc(it.qty)}" inputmode="numeric" type="number" min="1" step="1"></label>
      <label>Preço bruto (un.)<input data-f="gross" value="${esc(it.gross)}" inputmode="decimal" placeholder="0,00"></label>
      <label>Preço líquido (un.)<input data-f="net" value="${esc(it.net)}" inputmode="decimal" placeholder="= bruto"></label>
      <label>Desconto %<input data-f="disc" value="${esc(it.disc)}" inputmode="decimal" placeholder="0"></label>
    </div>
    <div class="item-price" data-pr="${i}"></div>
    <div class="item-sub">Subtotal: <strong data-sub="${i}">R$ 0,00</strong></div>
  </div>`).join('');
}
$('#items').addEventListener('input',e=>{const f=e.target.dataset.f;if(!f)return;const box=e.target.closest('.item'),i=+box.dataset.i,it=q.items[i]=normItem(q.items[i]);it[f]=e.target.value;
  const g=num(it.gross),setIn=(k,v)=>{it[k]=v;const el=box.querySelector(`[data-f="${k}"]`);if(el)el.value=v};
  if(f==='net'){it.lastEdit='net';setIn('disc',String(it.net).trim()===''||!g?'':fmtPct(Math.max(0,(g-num(it.net))/g*100)))}
  else if(f==='disc'){it.lastEdit='disc';const d=Math.min(100,Math.max(0,num(it.disc)));setIn('net',String(it.disc).trim()===''?'':fmtIn(g*(1-d/100)))}
  else if(f==='gross'){if(it.lastEdit==='disc'&&String(it.disc).trim()!==''){setIn('net',fmtIn(g*(1-Math.min(100,num(it.disc))/100)))}else if(String(it.net).trim()!==''){setIn('disc',g?fmtPct(Math.max(0,(g-num(it.net))/g*100)):'')}}
  refresh()});
$('#items').addEventListener('change',e=>{const f=e.target.dataset.f;if(f==='avail'){const i=+e.target.closest('.item').dataset.i;q.items[i].avail=e.target.value;refresh()}});
$('#items').addEventListener('click',e=>{const r=e.target.dataset.rm;if(r==null)return;q.items.splice(+r,1);renderItems();refresh()});
$('#addItem').addEventListener('click',()=>{q.items.push(newItem());renderItems();refresh();const last=$('#items .item:last-child input');last&&last.focus()});

function refresh(){
  const c=calc();
  c.lines.forEach((l,i)=>{const el=document.querySelector(`[data-sub="${i}"]`);if(el)el.textContent=brl(l.net);const pe=document.querySelector(`[data-pr="${i}"]`);if(pe)pe.innerHTML=l.g?(l.d>0.004?`De <s>${brl(l.g)}</s> por <b>${brl(l.n)}</b> <span class="off">${fmtPct(l.d)}% de desconto</span>`:`Preço: <b>${brl(l.n)}</b> <span class="off zero">0% de desconto</span>`):''});
  $('#tSub').textContent=brl(c.sub);$('#tDisc').textContent=c.disc>0.004?'- '+brl(c.disc)+' ('+fmtPct(c.sub?c.disc/c.sub*100:0)+'%)':brl(0);$('#tTotal').textContent=brl(c.total);
  const P=parcelas(c.total);
  $('#parcMain').textContent=c.total>0?'Em até '+P.best.n+'x de '+brl(P.best.value)+' sem juros'+(P.best.exact?'':' (1ª de '+brl(P.best.first)+')'):'Adicione itens para ver as parcelas';
  $('#parcList').innerHTML=c.total>0?P.opts.map(o=>`<span>${o.n}x <b>${brl(o.value)}</b>${o.exact?'':` <small>(1ª ${brl(o.first)})</small>`}</span>`).join(''):'';
  $('#validadeTxt').textContent=validText(q);
  $('#quoteText').value=buildText();
  save(LS.draft,q);
}

/* ---------- texto ---------- */
function engineStr(v){const e=String(v.engine||'').trim();return e&&!String(v.model||'').toLowerCase().includes(e.toLowerCase())?e:''}
function vehicleStr(qq=q){const v=qq.vehicle||{};return [v.make,v.model,engineStr(v),v.year].filter(s=>String(s||'').trim()).join(' ')+(v.plate?` (placa ${v.plate})`:'')}
function firstName(n){return String(n||'').trim().split(/\s+/)[0]||''}
function hello(){const h=new Date().getHours();return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'}
function buildText(qq=q){
  const c=calc(qq),fn=firstName(qq.client.name),veh=vehicleStr(qq).trim();
  const seller=firstName(store.sellerName),loja=store.storeName||'AutoZone';
  const L=[];
  L.push(`${hello()}${fn?', '+fn:''}! Tudo bem?`);
  L.push(`${seller?`Aqui é o ${seller}, da ${loja}. `:`Aqui é da ${loja}. `}Segue o orçamento que você pediu${veh?` para o ${veh}`:''}:`);
  L.push('');
  L.push(`*Orçamento nº ${qNum(qq.number)}*`);
  c.lines.filter(l=>l.desc||l.g).forEach((l,i)=>{
    const name=[l.desc||'Item',l.brand].filter(Boolean).join(' – ');
    L.push(`${i+1}. ${name}${l.sku?` (cód. ${l.sku})`:''}${l.avail==='encomenda'?' · sob encomenda':''}`);
    L.push(l.d>0.004?`   ${l.qty}x de ${brl(l.g)} por ${brl(l.n)} (${fmtPct(l.d)}% off) = ${brl(l.net)}`:`   ${l.qty}x ${brl(l.n)} = ${brl(l.net)}`);
  });
  L.push('');
  const eco=c.sub-c.total;
  if(eco>0.004){L.push(`Total bruto: ${brl(c.sub)}`);if(c.globalDisc>0.004)L.push(`Desconto adicional: - ${brl(c.globalDisc)}`);L.push(`*Total líquido: ${brl(c.total)}*`);L.push(`Você economiza ${brl(eco)} (${fmtPct(eco/c.sub*100)}%)! 🎉`)}
  else L.push(`*Total: ${brl(c.total)}*`);
  L.push('',`Formas de pagamento: ${PAY_TEXT}.`);
  L.push(`${parcText(c.total)}.`);
  L.push('',`${validText(qq)}.`);
  if(qq.notes)L.push('',`Obs.: ${qq.notes}`);
  L.push('','Qualquer dúvida, é só me chamar. Se quiser, já separo as peças pra você! 🧡');
  return L.join('\n');
}
$('#copyText').addEventListener('click',async()=>{
  const t=$('#quoteText').value,b=$('#copyText');
  let ok=false;
  try{await navigator.clipboard.writeText(t);ok=true}catch(e){const ta=$('#quoteText');ta.removeAttribute('readonly');ta.select();ta.setSelectionRange(0,t.length);try{ok=document.execCommand('copy')}catch(_){}ta.setAttribute('readonly','');window.getSelection&&window.getSelection().removeAllRanges()}
  b.textContent=ok?'Copiado ✓':'Não deu pra copiar, segure no texto';b.classList.toggle('ok',ok);
  clearTimeout(b._h);b._h=setTimeout(()=>{b.textContent='Copiar texto';b.classList.remove('ok')},2000);
});

/* ---------- histórico ---------- */
function persist(silent){
  const hist=load(LS.hist,[]);
  if(!q.id){q.id=uid();save(LS.counter,Math.max(load(LS.counter,0),q.number))}
  q.updatedAt=new Date().toISOString();q.total=calc().total;
  const i=hist.findIndex(h=>h.id===q.id);const copy=JSON.parse(JSON.stringify(q));
  if(i>=0)hist[i]=copy;else hist.unshift(copy);
  save(LS.hist,hist);save(LS.draft,q);renderHist();
  if(!silent)toast('Orçamento '+qNum(q.number)+' salvo');
}
$('#btnSave').addEventListener('click',()=>persist(false));
$('#btnNew').addEventListener('click',()=>{if(q.items.some(i=>i.desc||i.gross)&&!q.id&&!confirm('Começar um novo? O orçamento atual não foi salvo.'))return;q=blankQuote();fillForm();window.scrollTo(0,0)});
function renderHist(){
  const hist=load(LS.hist,[]);$('#histCount').textContent=hist.length;
  const s=($('#histSearch').value||'').toLowerCase();
  const list=hist.filter(h=>!s||[h.client.name,vehicleStr(h),qNum(h.number),h.client.phone].join(' ').toLowerCase().includes(s));
  $('#histList').innerHTML=list.length?list.map(h=>`
    <div class="hist"><div class="hist-top"><div><strong>${qNum(h.number)}</strong> · ${esc(h.client.name||'Sem nome')}<br><small>${esc(vehicleStr(h)||'Veículo não informado')} · ${fmtDate(h.createdAt)} · ${h.items.length} ${h.items.length===1?'item':'itens'}</small></div><strong>${brl(h.total)}</strong></div>
    <div class="hist-btns"><button type="button" data-open="${h.id}">Abrir</button><button type="button" data-dup="${h.id}">Duplicar</button><button type="button" data-pdf="${h.id}">PDF</button><button type="button" class="del" data-del="${h.id}" aria-label="Excluir">✕</button></div></div>`).join(''):'<p class="empty">Nenhum orçamento salvo ainda.</p>';
}
$('#histSearch').addEventListener('input',renderHist);
$('#histList').addEventListener('click',async e=>{
  const d=e.target.dataset,hist=load(LS.hist,[]);const id=d.open||d.dup||d.pdf||d.del;if(!id)return;
  const h=hist.find(x=>x.id===id);if(!h)return;
  if(d.del){if(!confirm('Excluir o orçamento '+qNum(h.number)+'?'))return;save(LS.hist,hist.filter(x=>x.id!==id));renderHist();return}
  if(d.pdf){await makePdf(h);return}
  q=normQuote(JSON.parse(JSON.stringify(h)));
  if(d.dup){q.id=null;q.number=nextNumber();q.createdAt=todayISO();toast('Cópia criada: '+qNum(q.number))}
  fillForm();show('novo');window.scrollTo(0,0);
});

/* ---------- tabs ---------- */
function show(v){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));$('#view-novo').classList.toggle('hidden',v!=='novo');$('#view-historico').classList.toggle('hidden',v!=='historico');if(v==='historico')renderHist()}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>show(t.dataset.view)));

/* ---------- PDF ---------- */
let logoData=null;
async function getLogo(){
  if(logoData)return logoData;
  const r=await fetch('logo-autozone.png');const b=await r.blob();
  logoData=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b)});
  return logoData;
}
async function buildPdf(qq){
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14,R=W-M,c=calc(qq),OR=[245,128,37],RED=[213,43,30];
  const logo=await getLogo();const lw=110,lh=lw*113/955;
  doc.addImage(logo,'PNG',(W-lw)/2,10,lw,lh,'azlogo','FAST');
  let y=10+lh+5;
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(90);
  const storeLine=[store.storeName,store.storeAddress].filter(Boolean).join(' · ');
  const storeLine2=[store.storePhone?'Telefone: '+store.storePhone:'',store.storeCnpj?'CNPJ: '+store.storeCnpj:''].filter(Boolean).join(' · ');
  if(storeLine){doc.text(doc.splitTextToSize(storeLine,R-M),W/2,y,{align:'center'});y+=4.2}
  if(storeLine2){doc.text(storeLine2,W/2,y,{align:'center'});y+=4.2}
  y+=1;doc.setDrawColor(...OR);doc.setLineWidth(1.2);doc.line(M,y,R,y);y+=8;
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(...RED);doc.text('ORÇAMENTO',M,y);
  doc.setFontSize(10);doc.setTextColor(40);doc.text('Nº '+qNum(qq.number),R,y-3,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Data de emissão: '+fmtDate(qq.createdAt)+'   ·   Válido somente nesta data',R,y+2,{align:'right'});
  y+=7;
  // info box
  const info=[['Cliente',qq.client.name],['Telefone',qq.client.phone],['Veículo',[qq.vehicle.make,qq.vehicle.model,qq.vehicle.year].filter(Boolean).join(' ')],['Motorização',qq.vehicle.engine],['Placa',qq.vehicle.plate],['Vendedor',store.sellerName]].filter(x=>String(x[1]||'').trim());
  if(info.length){
    const rows=Math.ceil(info.length/2),bh=rows*6+4;
    doc.setFillColor(255,246,236);doc.setDrawColor(240,215,190);doc.setLineWidth(.3);doc.roundedRect(M,y,R-M,bh,2,2,'FD');
    info.forEach((it,i)=>{const col=i%2,row=Math.floor(i/2),x=M+4+col*((R-M)/2),yy=y+6+row*6;doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(120,70,30);doc.text(it[0]+':',x,yy);const lo=Math.max(19,doc.getTextWidth(it[0]+':')+2);doc.setFont('helvetica','normal');doc.setTextColor(30);doc.text(doc.splitTextToSize(String(it[1]),(R-M)/2-7-lo)[0],x+lo,yy)});
    y+=bh+6;
  }
  // table
  const cols=[{h:'Qtd',w:11,a:'center'},{h:'Descrição',w:71},{h:'Preço bruto',w:25,a:'right'},{h:'Preço líquido',w:26,a:'right'},{h:'Desc. %',w:17,a:'right'},{h:'Subtotal',w:32,a:'right'}];
  let xs=[];let x=M;cols.forEach(cl=>{xs.push(x);x+=cl.w});
  const header=()=>{doc.setFillColor(...RED);doc.rect(M,y,R-M,7,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(255);cols.forEach((cl,i)=>{const tx=cl.a==='right'?xs[i]+cl.w-1.5:cl.a==='center'?xs[i]+cl.w/2:xs[i]+1.5;doc.text(cl.h,tx,y+4.8,{align:cl.a||'left'})});y+=7};
  header();
  const pageBreak=h=>{if(y+h>280){doc.addPage();y=16;header()}};
  c.lines.filter(l=>l.desc||l.g||l.sku).forEach((l,i)=>{
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    const desc=doc.splitTextToSize(l.desc||'—',cols[1].w-3);
    doc.setFontSize(7.2);const meta=doc.splitTextToSize([l.brand,l.sku?'Cód. '+l.sku:'',l.avail==='encomenda'?'Encomenda':''].filter(Boolean).join(' · '),cols[1].w-3);const hasMeta=meta.length&&meta[0];
    const h=Math.max(7,desc.length*3.8+(hasMeta?meta.length*3.2:0)+3);pageBreak(h);
    if(i%2){doc.setFillColor(250,247,244);doc.rect(M,y,R-M,h,'F')}
    const vals=[String(l.qty),null,brl(l.g),brl(l.n),l.d>0.004?fmtPct(l.d)+'%':'0%',brl(l.net)];
    vals.forEach((v,j)=>{if(v===null)return;const cl=cols[j];const tx=cl.a==='right'?xs[j]+cl.w-1.5:cl.a==='center'?xs[j]+cl.w/2:xs[j]+1.5;doc.setFont('helvetica',j===5||j===3?'bold':'normal');doc.setFontSize(8.5);doc.setTextColor(...(j===4&&l.d>0.004?[30,130,60]:j===2&&l.d>0.004?[120,120,120]:[30,30,30]));doc.text(v,tx,y+4.6,{align:cl.a||'left'})});
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(30);doc.text(desc,xs[1]+1.5,y+4.6);
    if(hasMeta){doc.setFontSize(7.2);doc.setTextColor(120);doc.text(meta,xs[1]+1.5,y+4.6+desc.length*3.8-0.6)}
    y+=h;doc.setDrawColor(225);doc.setLineWidth(.2);doc.line(M,y,R,y);
  });
  // totals
  pageBreak(30);y+=6;const lx=R-78;
  const tl=(a,b,big,col)=>{doc.setFont('helvetica',big?'bold':'normal');doc.setFontSize(big?12:9.5);doc.setTextColor(...(col||(big?RED:[40,40,40])));doc.text(a,lx,y);doc.text(b,R,y,{align:'right'});y+=big?8:5.5};
  const eco=c.sub-c.total;
  tl('Total bruto',brl(c.sub));
  if(c.globalDisc>0.004)tl('Desconto adicional','- '+brl(c.globalDisc));
  if(eco>0.004)tl('Economia','- '+brl(eco)+' ('+fmtPct(eco/c.sub*100)+'%)',false,[30,130,60]);
  doc.setDrawColor(...OR);doc.setLineWidth(.8);doc.line(lx,y-2.5,R,y-2.5);y+=3;
  tl('TOTAL LÍQUIDO',brl(c.total),true);
  // conditions
  const cond=[];cond.push(['Formas de pagamento',PAY_TEXT+'.\n'+parcText(c.total)+'.']);cond.push(['Validade',validText(qq)+'. Preços e estoque sujeitos a alteração após essa data.']);if(qq.notes)cond.push(['Observações',qq.notes]);
  y+=2;
  cond.forEach(([t,v])=>{const lines=doc.splitTextToSize(v,R-M);pageBreak(lines.length*4.5+7);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(120,70,30);doc.text(t,M,y);y+=4.5;doc.setFont('helvetica','normal');doc.setTextColor(40);doc.text(lines,M,y);y+=lines.length*4.5+3});
  // footer
  const pages=doc.getNumberOfPages();
  for(let p=1;p<=pages;p++){doc.setPage(p);doc.setDrawColor(...OR);doc.setLineWidth(.6);doc.line(M,286,R,286);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(120);doc.text((store.storeName||'AutoZone')+' · Orçamento '+qNum(qq.number),M,290);doc.text('Página '+p+' de '+pages,R,290,{align:'right'})}
  return doc;
}
function fileName(qq){const n=(qq.client.name||'').trim().split(/\s+/)[0]||'';return `Orcamento-${qNum(qq.number)}${n?'-'+n.normalize('NFD').replace(/[^\w]/g,''):''}.pdf`}
async function makePdf(qq){
  try{
    const doc=await buildPdf(qq);const blob=doc.output('blob');const name=fileName(qq);
    window.__lastPdf={name,size:blob.size,dataUri:doc.output('datauristring')};
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast('PDF gerado: '+name);
  }catch(e){console.error(e);toast('Não foi possível gerar o PDF')}
}
$('#btnPdf').addEventListener('click',async()=>{
  const c=calc();if(!c.lines.some(l=>l.desc||l.g)){toast('Adicione pelo menos um item');return}
  persist(true);await makePdf(q);
});

/* ---------- busca por placa ---------- */
const PLATE_RE=/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const normPlate=v=>String(v||'').toUpperCase().replace(/[\s\-.]/g,'');
function plateMsg(m,kind){const el=$('#plateMsg');el.textContent=m||'';el.className='hint full plate-msg'+(kind?' '+kind:'')}
const PLATE_ERR={invalid_plate:'Placa inválida. Use o formato ABC1234 ou ABC1D23.',not_configured:'A busca por placa ainda não foi configurada. Preencha os dados do veículo manualmente.',not_found:'Não encontramos essa placa. Confira a digitação ou preencha manualmente.',rate_limited:'Muitas buscas seguidas. Aguarde um minuto e tente de novo.',provider_error:'O serviço de placas não respondeu agora. Tente de novo em instantes ou preencha manualmente.',network:'Sem conexão com o serviço de placas. Verifique a internet ou preencha manualmente.'};
async function searchPlate(){
  const btn=$('#plateSearch'),inp=$('#vehPlate'),pl=normPlate(inp.value);
  inp.value=pl;q.vehicle.plate=pl;refresh();
  if(!PLATE_RE.test(pl)){plateMsg(PLATE_ERR.invalid_plate,'err');inp.focus();return}
  btn.disabled=true;btn.textContent='Buscando…';plateMsg('Buscando dados do veículo…');
  try{
    let r,j=null;
    try{r=await fetch('/api/placa?p='+encodeURIComponent(pl),{headers:{Accept:'application/json'},cache:'no-store'})}catch(e){plateMsg(PLATE_ERR.network,'err');return}
    try{j=await r.json()}catch(e){j=null}
    if(!r.ok||!j||j.code){const code=(j&&j.code)||(r.status===404?'not_found':r.status===429?'rate_limited':r.status===503?'not_configured':r.status===400?'invalid_plate':'provider_error');plateMsg(PLATE_ERR[code]||PLATE_ERR.provider_error,'err');return}
    const eng=[j.motorizacao,j.combustivel].map(s=>String(s||'').trim()).filter(Boolean).join(' ');
    const map=[['vehMake',j.marca],['vehModel',j.modelo],['vehYear',j.ano],['vehEngine',eng]];
    let n=0;map.forEach(([id,v])=>{v=String(v||'').trim();if(!v)return;$('#'+id).value=v;setP(q,qFields[id],v);n++});
    refresh();
    plateMsg(n?'Dados preenchidos pela placa. Confira e ajuste se precisar.':PLATE_ERR.not_found,n?'ok':'err');
  }finally{btn.disabled=false;btn.textContent='Buscar'}
}
$('#plateSearch').addEventListener('click',searchPlate);
$('#vehPlate').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchPlate()}});
$('#vehPlate').addEventListener('input',()=>plateMsg(''));

fillForm();renderHist();
})();

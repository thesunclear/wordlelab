/* ===== Utilities & State ===== */
const byId=id=>document.getElementById(id);
const ALPHA=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
const state={
	all:[], filtered:[], search:'',
	searchTester:null,
	globalInclude:new Set(), globalExclude:new Set(),
	pos:Array.from({length:5},()=>({include:new Set(),exclude:new Set()})),
	activePos:0,
	base2309:[], base3200:[], base14855:[],
	cancel:false
};


/* ===== Theme ===== */
(function(){
	const s=localStorage.getItem('wf-theme');
	if(s==='light')document.body.classList.add('light');
	updateThemeBtn(); byId('modeToggle').onclick=toggleTheme;
})();
function toggleTheme(){
	document.body.classList.toggle('light');
	localStorage.setItem('wf-theme',document.body.classList.contains('light')?'light':'dark');
	updateThemeBtn();
}
function updateThemeBtn(){
	byId('modeToggle').textContent=document.body.classList.contains('light')?'🌙 Dark':'☀️ Light';
}

/* ===== CSV parsing & loading ===== */
function parseWordsFromCsvText(t){
	const lines=t.split(/\r?\n/);const words=[];const seen=new Set();
	for(const raw of lines){
		const line=raw.trim();
		if(!line) continue;
		const cells=line.split(/,|\s+/);
		for(let c of cells){
			c=(c||'').trim().toLowerCase();
			if(/^[a-z]{5}$/.test(c)&&!seen.has(c)){
				seen.add(c);
				words.push(c);
			}
		}
	}
	return words;
}
async function fetchCsv(name){
	const res=await fetch(`./${name}`,{cache:'no-store'});
	if(!res.ok) throw new Error('fetch failed: '+name);
	return parseWordsFromCsvText(await res.text());
}
async function loadCsvFile(name){
	try{
		lockUI(true);
		const words=await fetchCsv(name);
		loadWordsFromArray(words);
	} catch(e) {
		alert('Error loading '+name+': '+e.message);
	}
	finally{
		lockUI(false);
	}
}

let currentMode = 'basic'; 

// === Basic / Advanced filter mode toggle ===
function setFilterMode(mode) {
	const advPanel  = byId('advPanel');   // Advanced-mode container
	const basicPanel = byId('basicPanel');  // Basic-mode container
	const btn       = byId('filterModeToggle');
	if (!advPanel || !basicPanel || !btn) return;
	// Show warning toast when switching to Basic Mode
	if (currentMode === 'adv' && mode === 'basic') {
		showToast("Some advanced filters may not be reflected in Basic Mode.", "warn");
		// showToast("Switching to Basic Mode may hide some advanced filters.", "warn");
	}
	if (mode === 'adv') {
		// Show Advanced panel, hide Basic panel
		advPanel.style.display  = '';
		basicPanel.style.display = 'none';
		btn.textContent = 'Basic Mode';
		btn.title       = 'Click to switch to Basic Mode';
	} else {
		// Default: Basic mode
		advPanel.style.display  = 'none';
		basicPanel.style.display = '';
		btn.textContent = 'Advanced Mode';
		btn.title       = 'Click to switch to Advanced Mode';
	}
	currentMode = mode;
	// Optional: remember in localStorage
	// localStorage.setItem('wf-filter-mode', mode);
}

function initFilterModeToggle() {
	const btn = byId('filterModeToggle');
	if (!btn) return;
	// Initial mode: Basic (you can change to 'adv' if you want)
	setFilterMode('basic');
	btn.addEventListener('click', () => {
		const advPanel = byId('advPanel');
		const isAdvVisible =
		advPanel && advPanel.style.display !== 'none';
		// Toggle between 'basic' and 'adv'
		setFilterMode(isAdvVisible ? 'basic' : 'adv');
	});
}

/* ===== Notifications ===== */
function toast(msg, ms=1800){
	let el = document.getElementById('toast');
	if(!el){
		el = document.createElement('div');
		el.id = 'toast';
		document.body.appendChild(el);
	}
	el.textContent = msg;
	el.classList.add('show');
	clearTimeout(el._t);
	el._t = setTimeout(()=>el.classList.remove('show'), ms);
}


/* ===== Toast API (global) ===== */
(function(){
	const MAX_TOASTS = 5;
	// const TOAST_DURATION = 2200;
	let _toastContainer = null;

	function getToastContainer(){
		if (_toastContainer) return _toastContainer;
		let el = document.getElementById('toastContainer');
		if (!el){
			el = document.createElement('div');
			el.id = 'toastContainer';
			document.body.appendChild(el);
		}
		_toastContainer = el;
		return el;
	}

	function removeOldestIfNeeded(container){
		while (container.children.length >= MAX_TOASTS){
			container.lastElementChild?.remove();
		}
	}

	window.clearToasts = function(){
		const c = getToastContainer();
		c.innerHTML = '';
	};

	// Toast durations by type (in ms)
	const TOAST_DURATIONS = {
		info:    2200,
		success: 2200,
		warn:    3600,
		error:   4000
	};

	// Fallback remover in case transition doesn't fire
	function safeRemoveLater(node, delay) {
		setTimeout(() => {
			if (node && node.parentNode) {
				node.remove();
			}
		}, delay);
	}

	window.showToast = function (message, type = 'info') {
		try {
			const container = getToastContainer();
			removeOldestIfNeeded(container);
			const t = document.createElement('div');
			t.className = `toast ${type}`;
			const span = document.createElement('span');
			span.textContent = message;
			t.appendChild(span);
			// With flex-direction: column-reverse, newest toast "visually" appears at the bottom
			container.appendChild(t);
			// Ensure we have a sane duration
			const base = TOAST_DURATIONS[type] ?? TOAST_DURATIONS.info;
			const duration = Math.max(800, base); // safety floor
			// One frame later → trigger fade-in
			requestAnimationFrame(() => t.classList.add('show'));
			// After some time → start fade-out
			setTimeout(() => {
				t.classList.add('hide');
			}, duration - 200);
			// Remove after opacity transition ends
			t.addEventListener('transitionend', (e) => {
				if (e.propertyName === 'opacity' && t.classList.contains('hide')) {
					if (t.parentNode) t.remove();
				}
			});
			// Hard fallback: remove even if transitionend never fires
			safeRemoveLater(t, duration + 1000);
		} catch (err) {
			console.error('showToast error:', err);
		}
	};
})();

/* ===== Keyboards & Tabs ===== */
function buildKeyboard(container, kind) {
	container.innerHTML = '';
	for (const ch of ALPHA) {
		const d = document.createElement('div');
		d.className = 'k';
		d.textContent = ch;
		d.dataset.ch = ch.toLowerCase();
		d.onclick = () => {
			const letter = d.dataset.ch;
			if (kind === 'gInc') {
				const wasExcluded     = state.globalExclude.has(letter); // global excluded before toggle?
				// Global Include: normal toggle between globalInclude / globalExclude 
				toggle(state.globalInclude, state.globalExclude, letter);
					if (wasExcluded) {
						showToast(`"${letter.toUpperCase()}" was removed from Global Exclude.`, "error");
					}
			} else if (kind === 'gExc') {
				// Global Exclude:
				// 1) Remember previous state (was it already excluded?)
				const wasExcluded = state.globalExclude.has(letter);
				const wasIncluded = state.globalInclude.has(letter);
				// 2) Normal toggle between globalExclude / globalInclude
				toggle(state.globalExclude, state.globalInclude, letter);
				// 3) If it just became "excluded" now, remove from ALL position includes
				const isNowExcluded = state.globalExclude.has(letter);
				if (!wasExcluded && isNowExcluded) {
					let cleared = false;
					for (const pos of state.pos) {
						if (pos.include.delete(letter)) cleared = true;
					}
					if (cleared || wasIncluded) {
						showToast(`"${letter.toUpperCase()}" was removed from all Global and Position Includes.`, "error");
					}
				}
			} else if (kind === 'pInc') {
				// pInc: this position must be this letter (only one allowed)
				const slot = state.pos[state.activePos];
				if (slot.include.size === 1 && slot.include.has(letter)) {
					// Same letter clicked again → turn this pInc OFF
					slot.include.clear();
				} else {
					// Turn this position's pInc ON for this letter
					slot.include.clear();
					slot.include.add(letter);
					// Make sure this position is NOT pExc for the same letter
					if (slot.exclude.delete(letter)) {
						showToast(`"${letter.toUpperCase()}" was removed from Position Exclude (Position ${state.activePos + 1}).`, "error");
					}
					if (state.globalExclude.delete(letter)) {
						showToast(`"${letter.toUpperCase()}" was removed from Global Exclude.`, "error");
					}
				}	
				/* if (!wasIncluded && isNowIncluded) {
					const msgs = [];
					// Show toast if we actually cleared a same-position Yellow
					if (hadYellow) {
						// pos.exclude.delete(letter);
						msgs.push(`"${letter.toUpperCase()}" was cleared from Position ${state.activePos + 1} Exclude`);
					}
					// Resolve global Gray conflict and toast (only if it existed before)
					if (hadGray) {
						state.globalExclude.delete(letter);
						msgs.push(`"${letter.toUpperCase()}" was cleared from Global Exclude`);
					}
					// (We intentionally do NOT auto-add to globalInclude)
					if (msgs.length) toast(msgs.join(' · '));
				} */
			} else if(kind === 'pExc') {
				// pExc (Position Exclude) – normal per-position toggle
				const slot = state.pos[state.activePos];
				const wasIncluded = slot.include.has(letter);
				toggle(slot.exclude, slot.include, letter);
				if (wasIncluded) {
					showToast(`"${letter.toUpperCase()}" was removed from Position Include (Position ${state.activePos + 1}).`, "error");
				}
			} else if (kind === 'basicGreen') {
				// Green: this position must be this letter (only one allowed)
				const slot = state.pos[state.activePos];
				if (slot.include.size === 1 && slot.include.has(letter)) {
					// Same letter clicked again → turn this green OFF
					slot.include.clear();
					//  Check if this letter is used anywhere else (as Green or Yellow)
					let stillUsed = false;
					for (let i = 0; i < 5; i++) {
						if (state.pos[i].include.has(letter) || state.pos[i].exclude.has(letter)) {
							stillUsed = true;
							break;
						}
					}
					if (!stillUsed) {
						// If nowhere else, also remove from globalInclude
						state.globalInclude.delete(letter);
					}
				} else {
					// Turn this position's green ON for this letter
					state.globalInclude.add(letter); // globalInclude ON when green active
					slot.include.clear();
					slot.include.add(letter);
					// Make sure this position is NOT yellow for the same letter
					if (slot.exclude.delete(letter)) {
						showToast(`"${letter.toUpperCase()}" was removed from Yellow Letter (Position ${state.activePos + 1}).`, "error");
					}
					if (state.globalExclude.delete(letter)) {
						showToast(`"${letter.toUpperCase()}" was removed from Gray Letter.`, "error");
					}
				}
			} else if (kind === 'basicYellow') {
				// Yellow: letter appears somewhere, but NOT at this position
				const slot = state.pos[state.activePos];
				const wasIncluded = slot.include.has(letter);
				const wasExcluded     = state.globalExclude.has(letter);
				if (slot.exclude.has(letter)) {
					// Toggle this yellow OFF on this position
					slot.exclude.delete(letter);
					// If this letter is no longer used on ANY position, relax globalInclude
					let stillUsed = false;
					for (let i = 0; i < 5; i++) {
						if (state.pos[i].include.has(letter) || state.pos[i].exclude.has(letter)) {
							stillUsed = true;
							break;
						}
					}
					if (!stillUsed) {
						state.globalInclude.delete(letter);
					}
				} else {
					// Turn yellow ON on this position
					slot.exclude.add(letter);
					// Make sure it is NOT green on this same position
					if (wasIncluded) {
						slot.include.delete(letter);
						showToast(`"${letter.toUpperCase()}" was removed from Green Letter (Position ${state.activePos + 1}).`, "error");
					}
					if (wasExcluded) {
						state.globalExclude.delete(letter);
						showToast(`"${letter.toUpperCase()}" was removed from Gray Letter.`, "error");
					}
					// Letter exists somewhere, so keep it out of globalExclude
					state.globalInclude.add(letter);
				}
			} else if (kind === 'basicGray') {
				// Gray: letter is nowhere in the word → flip globalExclude/globalInclude
				const letter = d.dataset.ch;
				const wasExcluded = state.globalExclude.has(letter);
				// Toggle: add to globalExclude (and remove from globalInclude), or the reverse
				toggle(state.globalExclude, state.globalInclude, letter);
				const isNowExcluded = state.globalExclude.has(letter);
				// Only when we just turned the letter GRAY (excluded) do we clear per-position flags
				let cleared = false;
				if (isNowExcluded) {
					for (let i = 0; i < 5; i++) {
						const a = state.pos[i].include.delete(letter); // green at pos i
						const b = state.pos[i].exclude.delete(letter); // yellow at pos i
						if (a || b) cleared = true;
					}
				}
				// Show toast ONLY if gray just cleared something from Green/Yellow
				if (isNowExcluded && cleared) {
					showToast(`"${letter.toUpperCase()}" was removed from all Green and Yellow Letters.`, "error");
				}
			}
			// Re-render keyboards and apply new filters
			refresh();
			apply();
		};
		container.appendChild(d);
	}
}

function toggle(primary,secondary,ch){
	if(primary.has(ch)) primary.delete(ch);
	else {
		primary.add(ch);
		secondary.delete(ch);
	}
}
function refresh(){
	const gI=byId('gInc').children, gE=byId('gExc').children, pI=byId('pInc').children, pE=byId('pExc').children;
	for(const e of gI) e.classList.toggle('inc',state.globalInclude.has(e.dataset.ch));
	for(const e of gE) e.classList.toggle('exc',state.globalExclude.has(e.dataset.ch));
	for(const e of pI) e.classList.toggle('inc',state.pos[state.activePos].include.has(e.dataset.ch));
	for(const e of pE) e.classList.toggle('exc',state.pos[state.activePos].exclude.has(e.dataset.ch));
	// === Basic mode keyboards (if present) ===
	const gK = byId('greenKeys')?.children  || [];
	const yK = byId('yellowKeys')?.children || [];
	const gr = byId('grayKeys')?.children   || [];
	const slot = state.pos[state.activePos];
	// Green: behave like Position Include
	for(const e of gK){
		e.classList.toggle('inc', slot.include.has(e.dataset.ch));
		e.classList.remove('exc'); 
	}
	// Yellow: behave like Position Exclude
	for(const e of yK){
		e.classList.toggle('exc', slot.exclude.has(e.dataset.ch));
		e.classList.remove('inc');
	}
	// Gray: behave like Global Exclude
	for(const e of gr){
		e.classList.toggle('exc', state.globalExclude.has(e.dataset.ch));
		e.classList.remove('inc');
	}
	/* for(const t of byId('tabs').children) t.classList.toggle('active',Number(t.dataset.idx)===state.activePos); */
	// Tabs in both Advanced & Basic panels
	for (const tabsId of ['advTabs', 'basicTabs']) {
		const tabs = byId(tabsId);
		if (!tabs) continue;
		for (const t of tabs.children) {
			t.classList.toggle('active', Number(t.dataset.idx) === state.activePos);
		}
	}
}

// Animate the position panel when user switches Pos 1–5
function animatePosPanelOnTabChange() {
	const advPanel = byId('advPanel');
	const basicPanel = byId('basicPanel');
	const isAdvVisible = advPanel && advPanel.style.display !== 'none';
	const panels = [];
	if (isAdvVisible) {
		// Advanced Mode: animate Position Include / Position Exclude cards
		const pIncGrid = byId('pInc');
		const pExcGrid = byId('pExc');
		const pIncCard = pIncGrid ? pIncGrid.closest('.card') : null;
		const pExcCard = pExcGrid ? pExcGrid.closest('.card') : null;
		if (pIncCard) panels.push(pIncCard);
		if (pExcCard) panels.push(pExcCard);
	} else {
		// Basic Mode: animate Green / Yellow cards
		const gGrid = byId('greenKeys');
		const yGrid = byId('yellowKeys');
		const gCard = gGrid ? gGrid.closest('.card') : null;
		const yCard = yGrid ? yGrid.closest('.card') : null;
		if (gCard) panels.push(gCard);
		if (yCard) panels.push(yCard);
	}
	// Apply the CSS animation class briefly
	panels.forEach(panel => {
		panel.classList.remove('tab-flash');  // reset if already applied
		void panel.offsetWidth;              // force reflow to restart animation
		panel.classList.add('tab-flash');
		// Clean up the class after animation ends
		setTimeout(() => {
			panel.classList.remove('tab-flash');
		}, 220); // slightly longer than CSS animation duration
	});
}

let lastActivePos = 0;  // remember previous tab index for swipe direction

function renderTabs() {
	const containers = [
	byId('advTabs'),
	byId('basicTabs')
	].filter(Boolean);  
	for (const tabs of containers) {
		tabs.innerHTML = '';
		for (let i = 0; i < 5; i++) {
			const b = document.createElement('button');
			b.className = 'tab' + (i === state.activePos ? ' active' : '');
			b.innerHTML = '<span class="label">Pos </span><span class="num">' + (i + 1) + '</span>';
			b.dataset.idx = i;
			b.onclick = () => {
				// determine swipe direction BEFORE updating activePos
				const newIdx = i;
				const oldIdx = state.activePos;
				const dir = (newIdx > oldIdx) ? 'right' :
				            (newIdx < oldIdx) ? 'left' : null;
				lastActivePos = oldIdx;
				state.activePos = newIdx;
				// if (state.activePos === i) return;  // clicking same tab: do nothing
				// state.activePos = i;
				refresh();
				if (dir) {
					flashPosPanels(dir);
				}
				// animatePosPanelOnTabChange();
			};
			tabs.appendChild(b);
		}
	}
}

function flashPosPanels(direction) {
	const basicCardGreen = byId('basicPosCardGreen');
	const basicCardYellow = byId('basicPosCardYellow');
	const advCardInc  = byId('advPosCardInc');
	const advCardExc  = byId('advPosCardExc');
	const clsLeft  = 'tab-swipe-left';
	const clsRight = 'tab-swipe-right';
	const cls = (direction === 'right') ? clsRight : clsLeft;
	[basicCardGreen, basicCardYellow, advCardInc, advCardExc].forEach(panel => {
		if (!panel) return;
		// remove any previous animation classes
		panel.classList.remove(clsLeft, clsRight);
		// force reflow so animation can restart
		void panel.offsetWidth;
		// add new class
		panel.classList.add(cls);
		// clean up class after animation ends
		setTimeout(() => {
			panel.classList.remove(clsLeft, clsRight);
		}, 260); // a bit bigger than animation duration
	});
}


/* ===== Search expression ===== */
function sanitizeClassContent(s){
	const x=s.toLowerCase().replace(/\s+/g,'');
	if(!/^[a-z\-\^]*$/.test(x)) return null;
	return x;
}
function escapeRe(s){
	return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}
function buildRegexFromMiniPattern(q){
	let reStr='';
	for(let i=0;i<q.length;i++){
		const ch=q[i];
		if(ch==='*'){
			let j=i;
			while(j<q.length&&q[j]==='*') j++;
			reStr+='[a-z]*';
			i=j-1;
		} else if(ch==='?'){
			reStr+='[a-z]';
		} else if(ch==='['){
			let j=i+1;
			while(j<q.length&&q[j]!==']') j++;
			if(j<q.length){
				const s=q.slice(i+1,j);
				const ok=sanitizeClassContent(s);
				if(ok!==null){
					reStr+=`[${ok}]`;
					i=j;
				} else reStr+='\\[';
			} else reStr+='\\[';
		} else if(ch===' '){
			/* ignore */
		} else if(/[a-z]/.test(ch)){
			reStr+=ch;
		} else reStr+=escapeRe(ch);
	}
	return new RegExp(reStr);
}
function tokenize(expr){
	const s=(expr||'').toLowerCase();
	const out=[];
	let i=0;
	const isOp=c=>c==='|'||c==='&';
	while(i<s.length){
		const c=s[i];
		if(c===' '){
			i++;
			continue;
		}
		if(c==='('||c===')'||isOp(c)){
			out.push({type:c});
			i++;
			continue;
		}
		let buf='';
		while(i<s.length){
			const ch=s[i];
			if(ch==='('||ch===')'||isOp(ch)||ch===' ') break;
			if(ch==='['){
				let j=i+1;
				while(j<s.length&&s[j]!==']') j++;
				if(j<s.length){
					buf+=s.slice(i,j+1);
					i=j+1;
					continue;
				} else {
					buf+='[';
					i++;
					continue;
				}
			}
			buf+=ch; i++;
		} out.push({
			type:'pat',value:buf
		});
	} return out;
}
function toRPN(tokens){
	const out=[], st=[];
	const prec=t=>t.type==='&'?2:(t.type==='|'?1:0);
	const isOp=t=>t.type==='|'||t.type==='&';
	for(const t of tokens){
		if(t.type==='pat') out.push(t);
		else if(isOp(t)){
			while(st.length){
				const top=st[st.length-1];
				if(isOp(top)&&prec(top)>=prec(t)) out.push(st.pop());
				else break;
			}
			st.push(t);
		} else if(t.type==='(') st.push(t);
		else if(t.type===')'){
			while(st.length&&st[st.length-1].type!=='(') out.push(st.pop());
			if(st.length&&st[st.length-1].type==='(') st.pop();
		}
	}
	while(st.length){
		const x=st.pop();
		if(x.type!=='('&&x.type!==')') out.push(x); 
	} return out;
}
function buildTesterFromRPN(rpn){
	const st=[]; 
	for(const t of rpn){
		if(t.type==='pat'){
			const re=buildRegexFromMiniPattern(t.value);
			st.push(w=>re.test(w));
		} else if(t.type==='&'||t.type==='|'){
			const b=st.pop(), a=st.pop();
			if(!a||!b) return null;
			st.push(t.type==='&'?(w)=>a(w)&&b(w):(w)=>a(w)||b(w));
		}
	}
	return st.length===1?st[0]:null;
}
function buildSearchTester(expr){
	const toks=tokenize(expr);
	if(!toks.some(t=>t.type==='pat')) return null;
	const rpn=toRPN(toks);
	const tester=buildTesterFromRPN(rpn);
	return tester||null;
}

/* ===== Filter & list ===== */
function apply(){
	const out=[];
	const gi=state.globalInclude, ge=state.globalExclude;
	const tester=state.searchTester;
	WORDS: for(const w of state.all){
		if(tester && !tester(w)) continue;
		for(const ch of ge) if(w.includes(ch)) continue WORDS;
		for(const ch of gi) if(!w.includes(ch)) continue WORDS;
		for(let i=0;i<5;i++){
			const need=state.pos[i].include, ban=state.pos[i].exclude, c=w[i];
			if(need.size>0 && !need.has(c)) continue WORDS;
			if(ban.has(c)) continue WORDS;
		}
		out.push(w);
	}
	state.filtered=out;
	renderList();
}
function renderList(){
	const ul=byId('words');
	ul.innerHTML='';
	for(const w of state.filtered){
		const li=document.createElement('li');
		li.textContent=w.toUpperCase();
		ul.appendChild(li);
	}
	byId('count').textContent=state.filtered.length;
}
function loadWordsFromArray(a){
	const seen=new Set();
	state.all=a.filter(w=>/^[a-z]{5}$/.test(w)&&!seen.has(w)&&seen.add(w)).sort();
	apply();
}

/* ===== Wordle feedback ===== */
function pattern(guess, answer){
	const g=[...guess], a=[...answer];
	const res=Array(5).fill('0');
	const cnt={};
	for(let i=0;i<5;i++){
		if(a[i]===g[i]){
			res[i]='2';
		} else {
			cnt[a[i]]=(cnt[a[i]]||0)+1;
		}
	}
	for(let i=0;i<5;i++){
		if(res[i]==='2') continue;
		const ch=g[i];
		if(cnt[ch]>0){
			res[i]='1';
			cnt[ch]--;
		}
	}
	return res.join('');
}
function partitionByPattern(S, guess){
	const map=new Map();
	for(const ans of S){
		const p=pattern(guess, ans);
		let arr=map.get(p);
		if(!arr){
			arr=[];
			map.set(p,arr);
		}
		arr.push(ans);
	}
	return map;
}
function entropyAndExpectedSize(S, guess){
	const parts=partitionByPattern(S, guess);
	const n=S.length;
	let H=0, exp=0, maxb=0;
	for(const arr of parts.values()){
		const p=arr.length/n;
		H += -p*Math.log2(p);
		exp += p*arr.length;
		if(arr.length>maxb) maxb=arr.length;
	}
	return {
		entropy:H, expected:exp, maxBucket:maxb
	};
}

/* ===== External pools (lazy load) ===== */
async function ensurePoolLoaded(which){
	if(which==='2309' && !state.base2309.length){
		state.base2309 = await fetchCsv('wordle_solutions_2309.csv');
	}
	if(which==='3200' && !state.base3200.length){
		state.base3200 = await fetchCsv('wordle_solutions_3200.csv');
	}
	if(which==='14855'&& !state.base14855.length){
		state.base14855= await fetchCsv('wordle_solutions_14855.csv');
	}
}
async function getExternalPool(){
	const sel=byId('poolSelect').value;
	if(sel==='current') return state.all;        // current loaded list
	await ensurePoolLoaded(sel);
	if(sel==='2309')  return state.base2309.length? state.base2309 : state.all;
	if(sel==='3200')  return state.base3200.length? state.base3200 : state.all;
	if(sel==='14855') return state.base14855.length? state.base14855: state.all;
	return state.all;
}

/* ===== Recommenders ===== */
let uiLocked = false; // when true, block keyboard shortcuts during calculation
function lockUI(yes){
	uiLocked = yes;
	/* 1) Buttons: disable everything except Stop */
	document.querySelectorAll('.btn').forEach(b => {
		if (b.id !== 'stopBtn') b.disabled = yes; // Disable all buttons except the Stop button
	});
	const stop = byId('stopBtn');
	if (stop) stop.disabled = !yes;  // Stop stays enabled during calculation
	/* 2) Inputs/toggles to freeze while computing */
	['wordListSelect','hardMode','maxCand','maxPool','deepEstepThreshold','poolSelect','deepSearch','analyzeInput'].forEach(id=>{
		const el = byId(id);
		if (!el) return;
		el.disabled = yes;
	});
	/* 3) Mouse clicks off for the letter keyboards only */
	['gInc','gExc','pInc','pExc','greenKeys','yellowKeys','grayKeys'].forEach(id=>{
		const el = byId(id);
		if (el) el.classList.toggle('locked', yes);
	});
	// 4) When unlocking the UI, re-apply Hard Mode rules
	if (!yes && typeof syncModeControls === 'function') {
		syncModeControls();
	}
}
function setProgress(p){
	byId('pbar').style.width = Math.max(0,Math.min(100,p))+'%';
}
function resetSuggestions(){
	byId('suggestTable').innerHTML='';
	byId('suggestStatus').textContent='';
	setProgress(0);
	state.cancel=false;
	lastSuggestRows = []; // Clear previous results
	const inputs = document.querySelectorAll('input[type="number"]');
	inputs.forEach(input => {
		input.value = input.defaultValue; // Reset to the original value
	});
	byId('suggestStatus').textContent = 'Results have been reset.'; // Provide feedback to the user
}

/* Build a capped guess pool: top-K from S + top-N from external (by cheap pre-score) */
async function buildGuessPoolCapped(S) {
	const hard = byId('hardMode').checked;
	const n = S.length;
	/* Hard Mode On: Search Cands Thr by Entropy */
	if (hard) {
		const candsThr = Math.max(1, Number(byId('maxCand').value) || n);
		const scoredS = [];
		let count = 0; // 1
		for (const g of S) {
			if (state.cancel) {
				// If user pressed Stop while ranking, break early
				break;
			}
			const met = entropyAndExpectedSize(S, g);
			scoredS.push({
				g, score: met.entropy, expected: met.expected
			});
			// Let the event loop breathe every 50 items
			if (++count % 50 === 0) {
				await new Promise(r => setTimeout(r, 0));
			}
		}
		scoredS.sort((a, b) => (b.score - a.score) || (a.expected - b.expected));
		const topS = scoredS.slice(0, Math.min(candsThr, scoredS.length)).map(x => x.g);
		return topS;
	}
	/* Hard Mode Off */
	const ext = await getExternalPool();
	if (!ext || ext.length === 0) {
		console.warn("No external pool found, proceeding with only filtered candidates.");
	}
	const K = Math.max(1, Number(byId('maxCand').value) || S.length); // Candidates threshold
	const N = Math.max(0, Number(byId('maxPool').value) || 0);        // Pool threshold
	/* Cheap metric: entropy + tie-break by expected size */
	function cheapScoreFor(word, set) {
		const met = entropyAndExpectedSize(set, word);
		return {
			score: met.entropy, expected: met.expected
		};
	}
	/* ===== Rank S by cheap score, keep top-K ===== */
	const scoredS = [];
	let countS = 0;
	for (const g of S) {
		if (state.cancel) break;
		const { score, expected } = cheapScoreFor(g, S);
		scoredS.push({ 
			g, score, expected 
		});
		if (++countS % 50 === 0) {
			await new Promise(r => setTimeout(r, 0));
		}
	}
	scoredS.sort((a, b) => (b.score - a.score) || (a.expected - b.expected));
	const topS = scoredS.slice(0, Math.min(K, scoredS.length)).map(x => x.g);
	/* ===== Rank external by cheap score against S, keep top-N ===== */
	const baseSet = new Set(S);
	const scoredExt = [];
	if (N > 0) {
		let countE = 0;
		for (const g of ext) {
			if (state.cancel) break;
			if (baseSet.has(g)) continue;
			const { score, expected } = cheapScoreFor(g, S);
			scoredExt.push({
				g, score, expected
			});
			if (++countE % 50 === 0) {
				await new Promise(r => setTimeout(r, 0));
			}
		}
		scoredExt.sort((a, b) => (b.score - a.score) || (a.expected - b.expected));
	}
	const topExt = (N > 0) ? scoredExt.slice(0, Math.min(N, scoredExt.length)).map(x => x.g) : [];
	return [...topS, ...topExt]; // Final capped pool = top-K from S + top-N from external	  
}

/* One-lookahead E[steps] using the local partitionByPattern(S, guess) */
function EstepsOneLookaheadLocal(S, g) {
	const n = S.length;
	const parts = partitionByPattern(S, g);
	let est = 0;
	for (const [pat, arr] of parts.entries()) {
		const p = arr.length / n;
		if (pat === '22222') {
			est += p * 1; // Solved now: takes 1 step (this guess)
		} else {
			/* Choose best next guess g2 inside arr, then approximate the leaf */
			let best = Infinity;
			for (const g2 of arr) {
				const parts2 = partitionByPattern(arr, g2);
				let e2 = 0;
				for (const [pat2, arr2] of parts2.entries()) {
					const p2 = arr2.length / arr.length;
					if (pat2 === '22222') {
						e2 += p2 * 1; // solved next step
					} else {
						const expLeaf = (arr2.length === 1) ? 1 : 2; // tiny leaf heuristic
						e2 += p2 * (1 + expLeaf); // 1 for taking g2, plus leaf
					}
				}
				if (e2 < best) best = e2;
			}
			est += p * (1 + best); // 1 for taking g now, plus best subtree
		}
	}
	return est;
}
/* Deeper E[steps] with an extra lookahead level:
   - Level 1: g (the candidate we are evaluating now)
   - Level 2: choose best g2 inside each bucket after g
   - Level 3: choose best g3 inside each bucket after g2
   - Level 4: choose best g4 inside each bucket after g3
   - Then approximate the remaining leaf.

   Cost model:
   - Every actual guess (g, g2, g3, …) contributes +1 turn.
   - The “leaf” buckets add a small extra cost depending on size.
*/
function EstepsOneLookaheadLocalDeep(S, g) {
  const n = S.length;
  const parts1 = partitionByPattern(S, g);
  let est = 0;

  for (const [pat1, arr1] of parts1.entries()) {
    const p1 = arr1.length / n;

    if (pat1 === '22222') {
      // Solved immediately with g
      est += p1 * 1;
      continue;
    }

    // Choose best second guess g2 inside this bucket
    let bestE2 = Infinity;

    for (const g2 of arr1) {
      const parts2 = partitionByPattern(arr1, g2);
      let e2 = 0;

      for (const [pat2, arr2] of parts2.entries()) {
        const p2 = arr2.length / arr1.length;

        if (pat2 === '22222') {
          // Solved by g2
          e2 += p2 * 1;
          continue;
        }

        // Choose best second guess g3 inside this bucket
        let bestE3 = Infinity;

        for (const g3 of arr2) {
          const parts3 = partitionByPattern(arr2, g3);
          let e3 = 0;
          
          for (const [pat3, arr3] of parts3.entries()) {
            const p3 = arr3.length / arr2.length;
            
            if (pat3 === '22222') {
              // Solved by g3
              e3 += p3 * 1;
              continue;
            }
            
            // For this child bucket arr3, choose best g4
            let bestE4 = Infinity;

            for (const g4 of arr3) {
              const parts4 = partitionByPattern(arr3, g4);
              let e4 = 0;

              for (const [pat4, arr4] of parts4.entries()) {
                const p4 = arr4.length / arr3.length;

                if (pat4 === '22222') {
                  // Solved by g4
                  e4 += p4 * 1;
                } else {
                  // Leaf after g4: approximate remaining cost
                  const leafSize = arr4.length;
                  const expLeaf = (leafSize === 1) ? 1 : 2;
                  // 1 for using g4, plus expected remaining steps in that tiny leaf
                  e4 += p4 * (1 + expLeaf);
                }
              }

              if (e4 < bestE4) bestE4 = e4;
            }

            e3 += p3 * (1 + bestE4);
          }
          
          if (e3 < bestE3) bestE3 = e3;

        }

        e2 += p2 * (1 + bestE3);
      }

      if (e2 < bestE2) bestE2 = e2;
    }

    // 1 for using g, plus best subtree under that bucket
    est += p1 * (1 + bestE2);
  }

  return est;
}

/* ===== Suggest Next ===== */
async function suggestNext() {
	const S = [...state.filtered];
	const n = S.length;
	const tb = byId('suggestTable');
	const status = byId('suggestStatus');
	tb.innerHTML = '';
	setProgress(0);
	state.cancel = false;
	if (n === 0) {
		status.textContent = 'No candidates.';
		return;
	}
	lockUI(true);
	try {
		// Give the UI a moment so Stop becomes clickable immediately
		await new Promise(r => setTimeout(r, 0));
		// 1) Build capped pool (this now respects state.cancel)
		const pool = await buildGuessPoolCapped(S);
		// If user pressed Stop while building the pool
		if (state.cancel || !pool || pool.length === 0) {
			status.textContent = 'Stopped before evaluating candidates.';
			return;
		}
		const total = pool.length;
		const hard = byId('hardMode').checked;
		// Read Deep Limit from UI
		const deepThrInput = byId('deepEstepThreshold');
		const deepThr = deepThrInput ? Math.max(0, Number(deepThrInput.value) || 0) : 0;
		const useDeep = (deepThr > 0 && n <= deepThr);
		// 2) Status text
		if (hard) {
			// In hard mode, pool already reflects top Cands Thr from filtered candidates
			// status.textContent = `Evaluating top ${total} words (from filtered candidates)...`;
			// const maxCandv = Math.max(1, Math.min(Number(byId('candsThreshold').value) || n, n));
			status.textContent = useDeep
				? `Evaluating top ${total} words (deeper E[steps] calculation) ...`
				: `Evaluating top ${total} words (from filtered candidates) ...`;
		} else {
			// status.textContent = `Evaluating top ${total} words (from the top-ranked candidates and external guess pool)...`;
			status.textContent = useDeep
				? `Evaluating top ${total} words (deeper E[steps] calculation) ...`
				: `Evaluating top ${total} words (from filtered candidates and external pool) ...`;
		}
		// 3) Heavy evaluation loop (E[steps], entropy, etc.)
		const rows = [];
		let evaluated = 0;
			for (let i = 0; i < total; i++) {
			if (state.cancel) {
				status.textContent += ' (stopped)';
				break;
			}
			const g = pool[i];
			// Exact expected steps (one-lookahead)
			// const exp = EstepsOneLookaheadLocal(S, g);
			// Choose between normal 2-step and deep 4-step E[steps]
			const exp = useDeep
				? EstepsOneLookaheadLocalDeep(S, g)
				: EstepsOneLookaheadLocal(S, g);
			const met = entropyAndExpectedSize(S, g);
			rows.push({
				word: g,
				esteps: exp,
				entropy: met.entropy,
				expected: met.expected,
				maxBucket: met.maxBucket
			});
			evaluated++;
			// Update progress and yield occasionally
			if ((i & 3) === 0) {
				setProgress(100 * evaluated / total);
				await new Promise(r => setTimeout(r, 0));
			}
		}
		// 4) Sort rows by E[steps] first (then entropy, then E[cands])
		rows.sort(
			(a, b) =>
				(a.esteps - b.esteps) ||
				(b.entropy - a.entropy) ||
				(a.expected - b.expected)
			);
		// 5) Render results (even if stopped mid-way, show what we have)
		lastSuggestRows = rows;
		lastSuggestLabel = 'by Estimated E[steps]';
		renderSuggestRows(rows, lastSuggestLabel);
		// Finishes at 100% only when Stop is not pressed
		if (!state.cancel) {
			setProgress(100);
		}
	} finally {
		// UI unlock is always
		lockUI(false);
	}
}

function renderSuggestRows(rows, label){
	const tb=byId('suggestTable'); 
	const status=byId('suggestStatus');
	status.textContent = `Top 10 Words ${label}`;
	tb.innerHTML='';
	for(const r of rows.slice(0,10)){
		const tr=document.createElement('tr');
		tr.innerHTML = `
			<td class="mono">${r.word.toUpperCase()}</td>
			<td>${isFinite(r.esteps)? r.esteps.toFixed(3) : '—'}</td>
			<td>${r.entropy?.toFixed(3) ?? '—'}</td>
			<td>${r.expected?.toFixed(1) ?? '—'}</td>
			<td>${r.maxBucket ?? '—'}</td>
			`;
		tb.appendChild(tr);
	}
}

/* ===== Single-direction sorting for the suggestion table ===== */
let lastSuggestRows = [];
let lastSuggestLabel = "";
function sortRowsOneWay(rows, key) {
	const copy = rows.slice();
	const num = (v) => (typeof v === "number" ? v : Number(v));
	copy.sort((a, b) => {
		if (key === "esteps") {
			return num(a.esteps) - num(b.esteps);                // ASC
		} else if (key === "entropy") {
			return num(b.entropy) - num(a.entropy);               // DESC
		} else if (key === "expected") {
			return num(a.expected) - num(b.expected);             // ASC
		} else if (key === "maxBucket") {
			return num(a.maxBucket) - num(b.maxBucket);           // ASC
		}
		return 0;
	});
	return copy;
}
function resortSuggestTableBy(key) {
	if (!lastSuggestRows.length) return;
	const sorted = sortRowsOneWay(lastSuggestRows, key); // Sort rows based on the selected key (E[steps], entropy, etc.)
	const nice =
		key === "esteps" ? "Estimated E[steps]" :
		key === "entropy" ? "Entropy" :
		key === "expected" ? "E[cands]" :
		key === "maxBucket" ? "Max Bucket" : key;
	renderSuggestRows(sorted, `by ${nice}`);
}

/* ===== Mode wiring (Hard ↔ Pool) ===== */
function syncModeControls(){
	const hard = byId('hardMode').checked;
	byId('poolSelect').disabled = hard;
	byId('modeNote').textContent = hard
		? 'Hard Mode ON'
		: 'Hard Mode OFF';
}

/* ===== Wire events ===== */
function wire(){
	buildKeyboard(byId('gInc'),'gInc');
	buildKeyboard(byId('gExc'),'gExc');
	buildKeyboard(byId('pInc'),'pInc');
	buildKeyboard(byId('pExc'),'pExc');
	buildKeyboard(byId('greenKeys'),  'basicGreen');
	buildKeyboard(byId('yellowKeys'), 'basicYellow');
	buildKeyboard(byId('grayKeys'),   'basicGray');
	renderTabs();
	refresh();
	// init Basic/Advanced filter mode toggle
	initFilterModeToggle();	
	byId('searchBox').oninput=e=>{
		state.search=e.target.value;
		state.searchTester=buildSearchTester(state.search);
		apply();
	};
	byId('clearAll').onclick=()=>{
		showToast("All filters have been cleared.", "info");
		state.globalInclude.clear();
		state.globalExclude.clear();
		for(let i=0;i<5;i++){
			state.pos[i].include.clear();
			state.pos[i].exclude.clear();
		}
		state.search='';
		state.searchTester=null;
		byId('searchBox').value='';
		refresh();
		apply();
	};
	/* ===== Word List Dropdown Menu Style ===== */
	const fileInput   = byId('fileInput');
	const wordSelect  = byId('wordListSelect');
	if (fileInput) {
		fileInput.onchange = async () => {
			const file = fileInput.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				const words = parseWordsFromCsvText(text);
				if (!words.length) throw new Error('empty');
				loadWordsFromArray(words);
			} catch (e) {
				alert('Load failed: ' + e.message);
			} finally {
				fileInput.value = '';
			}
		};
	}
	if (wordSelect) {
		wordSelect.onchange = async () => {
			const v = wordSelect.value;
			try {
				if (v === 'wl2309') {
					await loadCsvFile('wordle_solutions_2309.csv');
				} else if (v === 'wl3200') {
					await loadCsvFile('wordle_solutions_3200.csv');
				} else if (v === 'wl14855') {
					await loadCsvFile('wordle_solutions_14855.csv');
					showToast(`Note: The 14,855-word list contains all valid guessable words (not necessarily answers). Recommendations may take longer to compute.`, "warn");
				} else if (v === 'custom') {
					if (fileInput) fileInput.click();
				}
			} catch (e) {
				console.error(e);
			}
		};
	}
	const btnNext = byId('suggestNext');
	if (btnNext) btnNext.onclick = () => suggestNext();
	byId('resetSuggest').onclick=()=>{
		resetSuggestions();
		showToast("All suggestion results have been cleared.", "info");
	};
	byId('stopBtn').onclick=()=>{
		state.cancel=true;
		byId('suggestStatus').textContent+=' (stopping…)';
		showToast("Computation stopped. Partial results are shown.", "warn");
	};
	byId('hardMode').onchange=syncModeControls;
	// byId('poolSelect').onchange=()=>{};
	// byId('wordListSelect').onchange=()=>{};
	syncModeControls();
}



/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', async function(){
	wire();
	// Disable Stop button at startup
	const stop = byId('stopBtn');
	if (stop) stop.disabled = true;
	try{
		const base = await fetchCsv('wordle_solutions_2309.csv');
		state.base2309 = base.slice();
		loadWordsFromArray(base);
		const sel = byId('wordListSelect');
		if (sel) sel.value = 'wl2309';   // sync UI with default
	} catch(e) {
		console.error(e);
	}
});

document.addEventListener("DOMContentLoaded", function() {
  // Helper to toggle both content visibility and header "open" class
  function attachToggle(headerId, contentId) {
    const header  = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (!header || !content) return;

    header.addEventListener("click", function () {
      const isHidden = (content.style.display === "none" || content.style.display === "");
      // Toggle display
      content.style.display = isHidden ? "block" : "none";
      // Toggle arrow (▶ / ▼)
      header.classList.toggle("open", isHidden);
    });
  }

  // Attach to each section
  attachToggle("wordListsToggle",   "wordListsContent");
  attachToggle("recommenderToggle", "recommenderContent");
  attachToggle("analyzerHelpToggle",  "analyzerHelpContent");
  attachToggle("searchHelpToggle",  "searchHelpContent");
  attachToggle("disclaimerToggle",  "disclaimerContent");
});

document.addEventListener("DOMContentLoaded", () => {
	const hSteps   = document.getElementById("sort-steps");
	const hEntropy = document.getElementById("sort-entropy");
	const hCands   = document.getElementById("sort-cands");
	const hBucket  = document.getElementById("sort-bucket");
	if (hSteps)   hSteps.addEventListener("click",   () => resortSuggestTableBy("esteps"));
	if (hEntropy) hEntropy.addEventListener("click", () => resortSuggestTableBy("entropy"));
	if (hCands)   hCands.addEventListener("click",   () => resortSuggestTableBy("expected"));
	if (hBucket)  hBucket.addEventListener("click",  () => resortSuggestTableBy("maxBucket"));
});

/* ===== Analyze Word Logic ===== */
(function(){
	function getCandidates(){
		try{
			if (window.state && Array.isArray(window.state.filtered) && window.state.filtered.length){
				return window.state.filtered.slice();
			}
			if (window.state && Array.isArray(window.state.all) && window.state.all.length){
				return window.state.all.slice();
			}
		} catch(e) {}
		var lis = Array.from(document.querySelectorAll('#words li'));
		if(lis.length) return lis.map(li=>li.textContent.trim().toLowerCase()).filter(w=>/^[a-z]{5}$/.test(w));
		return [];
	}
	function entropyOf(guess, set){
		const map = partitionByPattern(set, guess);
		const N = set.length;
		let H = 0;
		let maxb = 0;
		let expSize = 0;
		for(const arr of map.values()){
			const m = arr.length;
			const p = m / N;
			maxb = Math.max(maxb, m);
			if(p>0){
				H += -p * Math.log2(p);
			}
			expSize += m*m / N;
		}
		return {
			entropy:H, expected:expSize, maxBucket:maxb, buckets:map
		};
	}

/* Deeper E[steps] with an extra lookahead level:
   - Level 1: g (the candidate we are evaluating now)
   - Level 2: choose best g2 inside each bucket after g
   - Level 3: choose best g3 inside each bucket after g2
   - Level 4: choose best g4 inside each bucket after g3
   - Then approximate the remaining leaf.

   Cost model:
   - Every actual guess (g, g2, g3, …) contributes +1 turn.
   - The “leaf” buckets add a small extra cost depending on size.
*/
function EstepsOneLookaheadDeep(S, g) {
  const n = S.length;
  const parts1 = partitionByPattern(S, g);
  let est = 0;

  for (const [pat1, arr1] of parts1.entries()) {
    const p1 = arr1.length / n;

    if (pat1 === '22222') {
      // Solved immediately with g
      est += p1 * 1;
      continue;
    }

    // Choose best second guess g2 inside this bucket
    let bestE2 = Infinity;

    for (const g2 of arr1) {
      const parts2 = partitionByPattern(arr1, g2);
      let e2 = 0;

      for (const [pat2, arr2] of parts2.entries()) {
        const p2 = arr2.length / arr1.length;

        if (pat2 === '22222') {
          // Solved by g2
          e2 += p2 * 1;
          continue;
        }

        // Choose best second guess g3 inside this bucket
        let bestE3 = Infinity;

        for (const g3 of arr2) {
          const parts3 = partitionByPattern(arr2, g3);
          let e3 = 0;
          
          for (const [pat3, arr3] of parts3.entries()) {
            const p3 = arr3.length / arr2.length;
            
            if (pat3 === '22222') {
              // Solved by g3
              e3 += p3 * 1;
              continue;
            }
            
            // For this child bucket arr3, choose best g4
            let bestE4 = Infinity;

            for (const g4 of arr3) {
              const parts4 = partitionByPattern(arr3, g4);
              let e4 = 0;

              for (const [pat4, arr4] of parts4.entries()) {
                const p4 = arr4.length / arr3.length;

                if (pat4 === '22222') {
                  // Solved by g4
                  e4 += p4 * 1;
                } else {
                  // Leaf after g4: approximate remaining cost
                  const leafSize = arr4.length;
                  const expLeaf = (leafSize === 1) ? 1 : 2;
                  // 1 for using g4, plus expected remaining steps in that tiny leaf
                  e4 += p4 * (1 + expLeaf);
                }
              }

              if (e4 < bestE4) bestE4 = e4;
            }

            e3 += p3 * (1 + bestE4);
          }
          
          if (e3 < bestE3) bestE3 = e3;

        }

        e2 += p2 * (1 + bestE3);
      }

      if (e2 < bestE2) bestE2 = e2;
    }

    // 1 for using g, plus best subtree under that bucket
    est += p1 * (1 + bestE2);
  }

  return est;
}

	function EstepsOneLookahead(guess, set){
		const part = partitionByPattern(set, guess);
		const N = set.length;
		let est = 0;
		for (const [pat, subset] of part.entries()){
			const m = subset.length;
			const p = m/N;
			if (pat === '22222'){
				est += p * 1;  // exact hit: 1 step (this guess)
			} else {
				let best = Infinity;
				for (const g2 of subset){
					const part2 = partitionByPattern(subset, g2);
					let e2 = 0;
					for (const [pat2, subset2] of part2.entries()){
						const m2 = subset2.length;
						const p2 = m2/subset.length;
						if (pat2 === '22222') {
							e2 += p2 * 1;
						} else {
							const expLeaf = (m2===1) ? 1 : 2;
							e2 += p2 * (1 + expLeaf);
						}
					}
					if (e2 < best) best = e2;
				}
				est += p * (1 + best);
			}
		}
		return est;
	}
	function analyzeWord(word, set){
		word = (word||'').toLowerCase();
		if(!/^[a-z]{5}$/.test(word)) {
			return {
				error:'Please enter a 5-letter word (A–Z).'
			};
		}
		if(!set || !set.length) {
			return {
				error:'No candidates loaded.'
			};
		}
		const deepAnalyze = byId('deepSearch').checked;
		const fast = entropyOf(word, set);
		let esteps = null;
		try {
			if (deepAnalyze) {
				esteps = EstepsOneLookaheadDeep(set, word);
			} else {
				esteps = EstepsOneLookahead(word, set);
			}
		} catch(e) {
			esteps = null;
		}
		return {
			word, esteps, entropy:fast.entropy, expected:fast.expected, maxBucket:fast.maxBucket
		};
	}
	function renderAnalyzeRow(result){
		const tbody = document.getElementById('analyzeTable');
		if(!tbody) return;
		tbody.innerHTML = '';
		if(result.error){
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.colSpan = 5;
			td.textContent = result.error;
			tr.appendChild(td);
			tbody.appendChild(tr);
			return;
		}
		const tr = document.createElement('tr');
		const fmt = (x)=> (x==null? '—' : (Math.round(x*1000)/1000));
		const cells = [
			result.word.toUpperCase(),
			(result.esteps==null? '—' : fmt(result.esteps)),
			fmt(result.entropy),
			fmt(result.expected),
			String(result.maxBucket)
		];
		for(const v of cells){
			const td=document.createElement('td');
			td.textContent=v;
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}
	function onAnalyze(){
		const set = getCandidates();
		const val = (document.getElementById('analyzeInput').value||'').trim();
		renderAnalyzeRow(analyzeWord(val, set));
	}
	document.addEventListener('DOMContentLoaded', function(){
		const btn = document.getElementById('analyzeBtn');
		const ipt = document.getElementById('analyzeInput');
		if(btn) btn.addEventListener('click', onAnalyze);
		if(ipt){
			['keydown','keypress','keyup'].forEach(ev=>ipt.addEventListener(ev, e=>e.stopPropagation()));
			ipt.addEventListener('keydown', (e)=>{ if(e.key==='Enter') onAnalyze(); });
		}
	});
})();
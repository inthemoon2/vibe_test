/* 관리자 화면 v2 탭: 조 구성 · 발표 기록 · 세특
 * admin.js 가 PJ.adminV2.show / click / change / leave 를 부른다.
 */
(function () {
  const { esc, $, $$, toast } = PJ;
  const V = {
    ctx: null, main: null, tab: '',
    form: { cls: '', data: null, draft: null, sel: '', timer: null, editRoles: '' },
    pres: { tid: '', round: 1, data: null, teams: null, segs: [], cur: { seg: '발표', who: '(미지정)' }, interim: '', dirty: false, rec: null, listening: false, saveTimer: null, saving: null, lastSave: '' },
    set: { cls: '', tid: '', data: null },
  };
  const call = function (a, p) { return V.ctx.call(a, p); };
  const guard = function (fn) { return V.ctx.guard(fn); };
  const busy = function (btn, on, txt) { if (!btn) return; if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.textContent = txt || '처리 중…'; } else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; } };
  const nl = function (t) { return esc(t).replace(/\n/g, '<br>'); };

  /* ---- 공통: AI에 보내는 내용 미리보기 ---- */
  function showPreview(pv) {
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = '<div class="modal-in card" role="dialog" aria-modal="true" aria-label="AI에 보내는 내용"><div class="row"><h2 class="grow" style="margin:0">AI에 보내는 내용</h2><button class="btn sm ghost" data-close>닫기</button></div>' +
      '<p class="small muted">학생 이름과 학번은 <b>학생01</b> 같은 코드로 바뀌어 보내지고, 결과가 돌아오면 서버에서 실명으로 되돌립니다. 아래 내용에 실명이 남아 있다면(인식 오류로 이름이 달리 적힌 경우 등) 기록에서 고친 뒤 보내세요.</p>' +
      '<h3>지시문</h3><pre class="code">' + esc(pv.system) + '</pre><h3>자료</h3><pre class="code">' + esc(pv.user) + '</pre></div>';
    document.body.appendChild(box);
    const close = function () { box.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc_);
    box.addEventListener('click', function (e) { if (e.target === box || e.target.closest('[data-close]')) close(); });
    $('[data-close]', box).focus();
  }
  function aiNote(ready) {
    return ready === false ? '<div class="banner warn small">AI 키가 아직 설정되지 않았어요. Apps Script 스크립트 속성에 <code>GEMINI_API_KEY</code>(무료, Google AI Studio에서 발급)를 넣어야 AI 초안을 만들 수 있어요. (README 참고)</div>' : '';
  }

  /* ════════════════ 조 구성 ════════════════ */
  const STEP_NAMES = [['', '관심 분야 입력'], ['마감', '조 편성(AI 안 + 교사 조정)'], ['공개', '학생 역할 선택'], ['확정', '조 확정']];

  async function formLoad() {
    const d = await call('formation', { cls: V.form.cls });
    V.form.data = d; V.form.cls = d.cls;
    V.form.draft = d.draft ? JSON.parse(JSON.stringify(d.draft)) : null;
  }
  function formHtml() {
    const d = V.form.data;
    if (!d.classes.length) return '<div class="card"><h2>조 구성</h2><p>먼저 "명단 · 비밀번호" 탭에서 반별 명단을 올려 주세요.</p><button class="btn" data-t2="roster">명단 올리러 가기</button></div>';
    const at = STEP_NAMES.findIndex(function (s) { return s[0] === d.stage; });
    let h = '<div class="card"><div class="row"><h2 class="grow" style="margin:0">조 구성</h2><select id="fcls" style="width:auto" aria-label="반 선택">' + d.classes.map(function (c) { return '<option value="' + esc(c.cls) + '"' + (c.cls === d.cls ? ' selected' : '') + '>' + esc(c.cls) + '반 · ' + esc(d.stages[c.stage] || '') + '</option>'; }).join('') + '</select><button class="btn ghost sm" data-fa="refresh">새로고침</button></div>' +
      '<ol class="steps" style="margin-top:12px">' + STEP_NAMES.map(function (s, i) { return '<li class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + esc(s[1]) + '</li>'; }).join('') + '</ol></div>';
    if (d.stage === '') h += formInterestHtml();
    else if (d.stage === '마감') h += formDraftHtml();
    else h += formTeamsHtml();
    return h;
  }
  function formInterestHtml() {
    const d = V.form.data, n = d.students.length, done = d.students.filter(function (s) { return s.interest; }).length, pw = d.students.filter(function (s) { return s.hasPw; }).length;
    return '<div class="card"><h2>① 관심 분야 입력 현황</h2><p>학생 ' + n + '명 중 <b>' + done + '명</b>이 관심 분야를 썼어요. (비밀번호 설정 ' + pw + '명) · 10초마다 자동으로 갱신돼요.</p>' +
      '<div class="bar' + (done === n ? ' full' : '') + '" style="max-width:420px"><i style="width:' + (n ? Math.round(done / n * 100) : 0) + '%"></i></div>' +
      '<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>학번</th><th>이름</th><th>진로 · 관심 분야</th><th>입력 시각</th></tr></thead><tbody>' + d.students.map(function (s) {
        return '<tr><td>' + esc(s.sid) + '</td><td>' + esc(s.name) + (s.hasPw ? '' : ' <span class="badge">미접속</span>') + '</td><td>' + (s.interest ? esc(s.interest) : '<span class="muted">아직 안 씀</span>') + '</td><td class="small muted">' + esc(s.interestAt || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p style="margin-top:12px"><button class="btn" data-fa="close">입력 마감하고 조 편성으로</button> <span class="small muted">마감하면 학생은 관심 분야를 고칠 수 없어요(편성 전에는 다시 열 수 있어요). 쓰지 않은 학생도 편성에 포함돼요.</span></p></div>';
  }
  function unplaced() {
    const d = V.form.data, dr = V.form.draft, used = {};
    (dr ? dr.groups : []).forEach(function (g) { g.sids.forEach(function (x) { used[x] = 1; }); });
    return d.students.filter(function (s) { return !used[s.sid]; }).map(function (s) { return s.sid; });
  }
  function stuBy(sid) { return V.form.data.students.filter(function (s) { return s.sid === sid; })[0] || { name: sid, interest: '' }; }
  function chip(sid) {
    const s = stuBy(sid), dr = V.form.draft, unclear = dr && (dr.unclear || []).indexOf(sid) >= 0;
    return '<div class="fchip' + (V.form.sel === sid ? ' sel' : '') + (unclear ? ' unclear' : '') + '" draggable="true" data-sid="' + esc(sid) + '" tabindex="0" title="' + esc(s.interest || '관심 분야 없음') + '"><b>' + esc(s.name) + '</b>' + (unclear ? ' <span class="badge warn" title="관심 분야가 분명하지 않아요">불명확</span>' : '') + '<div class="small muted">' + esc(s.interest || '(입력 없음)') + '</div></div>';
  }
  function formDraftHtml() {
    const d = V.form.data, dr = V.form.draft, left = unplaced();
    let h = '<div class="card"><h2>② 조 편성안</h2>' + aiNote(d.aiReady) +
      '<div class="row"><button class="btn" data-fa="ai">' + (dr ? 'AI 편성안 다시 만들기' : 'AI 조 편성안 만들기') + '</button><button class="btn ghost" data-fa="aipv">AI에 보내는 내용 보기</button>' + (dr ? '' : '<button class="btn ghost" data-fa="manual">직접 편성하기</button>') + '<button class="btn ghost sm" data-fa="reopen">관심 분야 입력 다시 열기</button></div>' +
      '<p class="small muted">AI는 관심 분야가 비슷한 학생끼리 묶고 한 조를 최대 ' + d.teamMax + '명으로 맞춰요(학생 ' + d.students.length + '명 → ' + Math.ceil(d.students.length / d.teamMax) + '개 조). 결과를 보고 학생 카드를 <b>끌어다 다른 묶음에 놓거나</b>, 카드를 누른 뒤 옮길 묶음의 빈 곳을 눌러 옮기세요. 묶음 이름은 조의 "분야"가 돼요. 바꾸면 바로 저장됩니다.</p></div>';
    if (!dr) return h;
    h += '<div class="fboard">' + dr.groups.map(function (g, i) {
      const over = g.sids.length > d.teamMax;
      return '<div class="fgroup' + (over ? ' over-cap' : '') + '" data-gi="' + i + '"><div class="fgroup-h"><input type="text" class="gname" data-gi="' + i + '" value="' + esc(g.name) + '" maxlength="40" aria-label="' + (i + 1) + '번 묶음 이름"><span class="badge' + (over ? ' bad' : g.sids.length === d.teamMax ? ' ok' : '') + '">' + g.sids.length + '/' + d.teamMax + '</span>' + (g.sids.length ? '' : '<button class="btn sm ghost" data-fa="delg" data-gi="' + i + '" aria-label="빈 묶음 지우기">×</button>') + '</div>' +
        '<div class="fgroup-b">' + g.sids.map(chip).join('') + '</div></div>';
    }).join('') +
      '<div class="fgroup unplaced" data-gi="-1"><div class="fgroup-h"><b>아직 배치 안 됨</b><span class="badge' + (left.length ? ' warn' : '') + '">' + left.length + '</span></div><div class="fgroup-b">' + left.map(chip).join('') + '</div></div></div>' +
      '<div class="card"><div class="row"><button class="btn ghost" data-fa="addg">+ 묶음 추가</button><span class="grow"></span><span class="small muted">' + esc(dr.by || '') + ' · ' + esc(dr.at || '') + '</span><button class="btn" data-fa="publish"' + (left.length ? ' disabled title="모든 학생을 배치해야 공개할 수 있어요"' : '') + '>학생에게 공개</button></div>' +
      '<p class="small muted">공개하면 묶음마다 조가 만들어지고, 학생 화면이 자기 조의 역할 고르기 화면으로 바뀌어요. 공개 뒤에도 학생을 다른 조로 옮길 수 있어요.</p></div>';
    return h;
  }
  function formTeamsHtml() {
    const d = V.form.data, confirmed = d.stage === '확정';
    const opts = function (cur) { return d.teams.map(function (t) { return '<option value="' + esc(t.tid) + '"' + (t.tid === cur ? ' selected' : '') + '>' + esc(t.no) + '조 · ' + esc(t.field) + ' (' + t.members.length + '명)</option>'; }).join(''); };
    let h = '<div class="card"><h2>' + (confirmed ? '④ 확정된 조' : '③ 학생 역할 선택 현황') + '</h2>' +
      (confirmed ? '<p>조가 확정되어 활동지가 열렸어요. 학생은 역할을 바꿀 수 없고, 선생님이 아래에서 역할을 고치거나 학생을 다른 조로 옮길 수 있어요.</p>'
        : '<p>학생들이 자기 이름을 역할 칸에 끌어다 놓고 있어요. 10초마다 갱신돼요. 규칙: 데이터 엔지니어 최대 ' + d.roleCap['데이터 엔지니어'] + '명, 나머지 역할 1명, 한 사람 최대 ' + d.maxRoles + '개.</p><p><button class="btn" data-fa="confirm">조 확정하고 활동지 열기</button> <span class="small muted">빈 역할이 있어도 확정할 수 있어요. 확정 뒤에는 학생이 역할을 바꿀 수 없어요.</span></p>') +
      '<p class="small muted">학생 이동: 이름 옆 선택 상자에서 옮길 조를 고르세요. 옮긴 학생의 역할은 비워지고, "나의 기여" 같은 개인 기록은 학생을 따라가요. 조가 함께 쓴 내용은 원래 조에 남아요.</p></div>';
    h += '<div class="fteams">' + d.teams.map(function (t) {
      return '<div class="card"><h3>' + esc(t.no) + '조 · ' + esc(t.field) + ' <span class="badge">' + t.members.length + '/' + d.teamMax + '명</span></h3>' +
        (t.noLeader ? '<div class="banner bad small"><b>팀장(프로젝트 매니저)이 없어요.</b> 팀장이 정해질 때까지 이 조는 최종 제출을 할 수 없어요. 아래 "역할 고치기"로 지정해 주세요.</div>' : '') +
        (t.emptyRoles.length ? '<p class="small"><span class="badge warn">빈 역할</span> ' + t.emptyRoles.map(esc).join(', ') + '</p>' : '<p class="small"><span class="badge ok">모든 역할이 채워짐</span></p>') +
        (t.noRole.length ? '<p class="small"><span class="badge warn">역할 없음</span> ' + t.noRole.map(esc).join(', ') + '</p>' : '') +
        '<table class="tbl"><tbody>' + t.members.map(function (m) {
          const editing = V.form.editRoles === m.sid;
          return '<tr><td style="width:30%"><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.sid) + '</div></td><td>' +
            (editing ? '<div class="opts">' + d.roles.map(function (r) { return '<label><input type="checkbox" class="rolechk" value="' + esc(r) + '"' + (m.roles.indexOf(r) >= 0 ? ' checked' : '') + '>' + esc(r) + '</label>'; }).join('') + '</div><button class="btn sm" data-fa="saveroles" data-sid="' + esc(m.sid) + '">역할 저장</button> <button class="btn sm ghost" data-fa="cancelroles">취소</button>'
              : (m.roles.length ? m.roles.map(function (r) { return '<span class="chip">' + esc(r) + '</span>'; }).join(' ') : '<span class="muted small">역할 미정</span>') + ' <button class="btn sm ghost" data-fa="editroles" data-sid="' + esc(m.sid) + '">역할 고치기</button>') +
            '</td><td style="width:28%"><select class="mvsel" data-sid="' + esc(m.sid) + '" data-nm="' + esc(m.name) + '" aria-label="' + esc(m.name) + ' 조 옮기기">' + opts(t.tid) + '</select></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('') + '</div>';
    return h;
  }
  function formRender() { V.main.innerHTML = formHtml(); bindFormDnd(); }
  async function saveDraft() {
    const dr = V.form.draft;
    V.form.data = await call('saveGroups', { cls: V.form.cls, groups: dr.groups.map(function (g) { return { name: g.name, sids: g.sids }; }) });
    V.form.draft = JSON.parse(JSON.stringify(V.form.data.draft));
  }
  function moveChip(sid, gi) {
    const dr = V.form.draft;
    dr.groups.forEach(function (g) { g.sids = g.sids.filter(function (x) { return x !== sid; }); });
    if (gi >= 0) {
      const g = dr.groups[gi];
      if (g.sids.length >= V.form.data.teamMax) { toast('한 조는 최대 ' + V.form.data.teamMax + '명이에요. 먼저 다른 학생을 빼 주세요.', 'err'); return formLoad().then(formRender); }
      g.sids.push(sid);
    }
    V.form.sel = '';
    formRender();
    return guard(saveDraft)().then(formRender);
  }
  function bindFormDnd() {
    let dragSid = '';
    $$('.fchip', V.main).forEach(function (c) {
      c.addEventListener('dragstart', function (e) { dragSid = c.dataset.sid; e.dataTransfer.setData('text/plain', dragSid); e.dataTransfer.effectAllowed = 'move'; V.form.dragging = true; });
      c.addEventListener('dragend', function () { V.form.dragging = false; $$('.fgroup', V.main).forEach(function (g) { g.classList.remove('over'); }); });
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); V.form.sel = V.form.sel === c.dataset.sid ? '' : c.dataset.sid; formRender(); const n = $('.fchip[data-sid="' + V.form.sel + '"]', V.main); if (n) n.focus(); } });
    });
    $$('.fgroup', V.main).forEach(function (g) {
      g.addEventListener('dragover', function (e) { if (dragSid) { e.preventDefault(); g.classList.add('over'); } });
      g.addEventListener('dragleave', function () { g.classList.remove('over'); });
      g.addEventListener('drop', function (e) { e.preventDefault(); g.classList.remove('over'); const s = dragSid; dragSid = ''; if (s) moveChip(s, Number(g.dataset.gi)); });
    });
  }
  function startFormTimer() {
    clearInterval(V.form.timer);
    V.form.timer = setInterval(async function () {
      if (V.tab !== 'form' || document.hidden || V.form.dragging) return;
      const st = V.form.data && V.form.data.stage;
      if (st !== '' && st !== '공개') return;
      const ae = document.activeElement; if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.id !== 'fcls') return;
      if (V.form.editRoles) return;
      try { const y = window.scrollY; await formLoad(); if (V.tab === 'form') { formRender(); window.scrollTo(0, y); } } catch (e) { /* 다음에 */ }
    }, 10000);
  }
  function formClick(e) {
    const b = e.target.closest('[data-fa]');
    const chipEl = e.target.closest('.fchip');
    if (!b && chipEl) { V.form.sel = V.form.sel === chipEl.dataset.sid ? '' : chipEl.dataset.sid; formRender(); return true; }
    if (!b) {
      const g = e.target.closest('.fgroup');
      if (g && V.form.sel && !e.target.closest('input')) { moveChip(V.form.sel, Number(g.dataset.gi)); return true; }
      return false;
    }
    const a = b.dataset.fa, cls = V.form.cls;
    const run = function (fn) { guard(async function () { busy(b, true); try { await fn(); } finally { busy(b, false); } formRender(); })(); return true; };
    if (a === 'refresh') return run(formLoad);
    if (a === 'close') { if (!confirm(cls + '반의 관심 분야 입력을 마감할까요?')) return true; return run(async function () { V.form.data = await call('closeInterest', { cls: cls, closed: true }); V.form.draft = null; }); }
    if (a === 'reopen') { if (!confirm('관심 분야 입력을 다시 열까요? 만들어 둔 편성안은 그대로 남아요.')) return true; return run(async function () { V.form.data = await call('closeInterest', { cls: cls, closed: false }); }); }
    if (a === 'aipv') return run(async function () { const r = await call('aiGroup', { cls: cls, preview: true }); showPreview(r.preview); });
    if (a === 'ai') { if (V.form.draft && !confirm('지금 편성안을 버리고 AI로 새로 만들까요?')) return true; return run(async function () { busy(b, true, 'AI가 편성 중… (최대 1분)'); await (async function () { V.form.data = await call('aiGroup', { cls: cls }); V.form.draft = JSON.parse(JSON.stringify(V.form.data.draft)); })(); toast('AI 편성안을 만들었어요. 확인하고 고쳐 주세요.', 'ok'); }); }
    if (a === 'manual') return run(async function () { const k = Math.max(1, Math.ceil(V.form.data.students.length / V.form.data.teamMax)); V.form.draft = { groups: Array.from({ length: k }, function (_, i) { return { name: '분야 ' + (i + 1), sids: [] }; }), unclear: [] }; await saveDraft(); });
    if (a === 'addg') return run(async function () { V.form.draft.groups.push({ name: '분야 ' + (V.form.draft.groups.length + 1), sids: [] }); await saveDraft(); });
    if (a === 'delg') return run(async function () { V.form.draft.groups.splice(Number(b.dataset.gi), 1); await saveDraft(); });
    if (a === 'publish') { if (!confirm(V.form.draft.groups.length + '개 조로 학생에게 공개할까요?\n공개하면 편성안은 더 고칠 수 없고, 이후에는 학생 이동으로 조정해요.')) return true; return run(async function () { V.form.data = await call('publishGroups', { cls: cls }); toast('공개했어요. 학생들이 역할을 고를 수 있어요.', 'ok'); }); }
    if (a === 'confirm') {
      const t = V.form.data.teams, empty = t.filter(function (x) { return x.emptyRoles.length || x.noRole.length; }).length, noLeaderTeams = t.filter(function (x) { return x.noLeader; }).map(function (x) { return x.no + '조'; });
      if (!confirm(cls + '반 ' + t.length + '개 조를 확정할까요?' + (empty ? '\n(빈 역할이나 역할 없는 학생이 있는 조가 ' + empty + '개 있어요)' : '') + (noLeaderTeams.length ? '\n팀장이 없는 조(' + noLeaderTeams.join(', ') + ')는 팀장을 지정할 때까지 최종 제출을 할 수 없어요.' : '') + '\n확정하면 학생 활동지가 열리고 학생은 역할을 바꿀 수 없어요.')) return true;
      return run(async function () { V.form.data = await call('confirmTeams', { cls: cls }); toast('조를 확정했어요.', 'ok'); });
    }
    if (a === 'editroles') { V.form.editRoles = b.dataset.sid; formRender(); return true; }
    if (a === 'cancelroles') { V.form.editRoles = ''; formRender(); return true; }
    if (a === 'saveroles') { const roles = $$('.rolechk:checked', b.closest('td')).map(function (i) { return i.value; }); return run(async function () { V.form.data = await call('setRoles', { sid: b.dataset.sid, roles: roles }); V.form.editRoles = ''; toast('역할을 저장했어요', 'ok'); }); }
    return false;
  }
  function formChange(e) {
    if (e.target.id === 'fcls') { V.form.cls = e.target.value; V.form.sel = ''; V.form.editRoles = ''; guard(async function () { await formLoad(); formRender(); })(); return true; }
    if (e.target.classList.contains('gname')) { V.form.draft.groups[Number(e.target.dataset.gi)].name = e.target.value; guard(async function () { await saveDraft(); toast('묶음 이름 저장', 'ok'); })(); return true; }
    if (e.target.classList.contains('mvsel')) {
      const sel = e.target, to = sel.value, nm = sel.dataset.nm, t = V.form.data.teams.filter(function (x) { return x.tid === to; })[0];
      if (!confirm(nm + ' 학생을 ' + t.no + '조(' + t.field + ')로 옮길까요?\n역할은 비워지고, 개인 기록은 학생을 따라가요.')) { formRender(); return true; }
      guard(async function () { V.form.data = await call('moveStudent', { sid: sel.dataset.sid, toTid: to }); toast(nm + ' 학생을 옮겼어요', 'ok'); })().then(formRender);
      return true;
    }
    return false;
  }

  /* ════════════════ 발표 기록 ════════════════ */
  const P = V.pres;
  async function presLoad() {
    const ov = await call('adminOverview', {});
    P.teams = ov.teams.filter(function (t) { return t.status !== '조구성'; });
    if (P.tid && !P.teams.some(function (t) { return t.tid === P.tid; })) P.tid = '';
    if (P.tid) await presTeamLoad();
  }
  async function presTeamLoad() {
    P.data = await call('presTeam', { tid: P.tid });
    const r = P.data.rec[String(P.round)];
    P.segs = r ? r.segments.slice() : [];
    P.dirty = false; P.lastSave = r ? r.at : '';
    if (P.cur.who !== '교사' && P.cur.who !== '(미지정)' && !P.data.members.some(function (m) { return m.name === P.cur.who; })) P.cur.who = '(미지정)';
  }
  function presHtml() {
    if (!P.teams.length) return '<div class="card"><h2>발표 기록</h2><p>아직 확정된 조가 없어요. "조 구성" 탭에서 조를 확정해 주세요.</p></div>';
    let h = '<div class="card"><div class="row"><h2 class="grow" style="margin:0">발표 기록</h2><select id="ptid" style="width:auto" aria-label="조 선택"><option value="">조를 고르세요</option>' + P.teams.map(function (t) { return '<option value="' + esc(t.tid) + '"' + (t.tid === P.tid ? ' selected' : '') + '>' + esc(t.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + '</option>'; }).join('') + '</select>' +
      '<div class="sess-tabs" role="group" aria-label="발표 회차" style="margin:0">' + [1, 2].map(function (n) { return '<button data-pa="round" data-n="' + n + '" aria-pressed="' + (P.round === n) + '">' + n + '차 발표</button>'; }).join('') + '</div></div>' +
      '<p class="small muted">녹음은 파일로 저장하지 않고 <b>글로 바꾼 내용만</b> 저장해요(' + esc(PJ.STT.engineName) + ', 크롬·엣지에서 동작). 말하는 사람이 바뀔 때 <b>발언자 버튼</b>을, 발표·질문·피드백이 바뀔 때 <b>구간 버튼</b>을 눌러 주세요. 녹음 중에는 15초마다 자동 저장되고, 끝난 뒤 문단마다 고칠 수 있어요.</p></div>';
    if (!P.tid || !P.data) return h;
    return h + recorderHtml() + (P.listening ? '' : editorHtml()) + evalHtml('fb1') + evalHtml('chg2');
  }
  function recorderHtml() {
    const d = P.data, rec = d.rec[String(P.round)];
    const segBtns = d.segs.map(function (s) { return '<button class="btn sm' + (P.cur.seg === s ? '' : ' ghost') + '" data-pa="seg" data-v="' + esc(s) + '" aria-pressed="' + (P.cur.seg === s) + '">' + esc(s) + '</button>'; }).join('');
    const whoBtns = d.members.map(function (m) { return m.name; }).concat(['교사']).map(function (w) { return '<button class="btn sm' + (P.cur.who === w ? '' : ' ghost') + '" data-pa="who" data-v="' + esc(w) + '" aria-pressed="' + (P.cur.who === w) + '">' + esc(w) + '</button>'; }).join('');
    const tail = P.segs.slice(-6);
    return '<div class="card rec-card' + (P.listening ? ' on' : '') + '"><div class="row"><h3 class="grow" style="margin:0">' + esc(d.team.cls) + '반 ' + esc(d.team.no) + '조 · ' + P.round + '차 발표 ' + (rec ? '<span class="small muted">(녹음일 ' + esc(rec.date) + ')</span>' : '') + '</h3>' +
      '<span class="small muted" id="psave">' + (P.saving ? '저장 중…' : P.dirty ? '저장 안 된 내용 있음' : P.lastSave ? '저장됨 ' + esc(String(P.lastSave).slice(11, 16)) : '') + '</span>' +
      (PJ.STT.supported() ? '<button class="btn' + (P.listening ? ' danger' : '') + '" data-pa="mic">' + (P.listening ? '■ 녹음 끝내기' : (P.segs.length ? '● 이어서 녹음' : '● 녹음 시작')) + '</button>' : '') + '</div>' +
      (PJ.STT.supported() ? '' : '<div class="banner bad">이 브라우저는 음성 인식을 지원하지 않아요. 크롬이나 엣지에서 열어 주세요. (아래 편집 칸에 직접 입력할 수는 있어요)</div>') +
      '<div class="rec-ctl"><div><span class="small muted">구간</span> ' + segBtns + '</div><div><span class="small muted">발언자</span> ' + whoBtns + '</div></div>' +
      (P.listening ? '<div class="live" aria-live="polite">' + (tail.length ? tail.map(function (s) { return '<p><span class="badge">' + esc(s.seg) + '</span> <b>' + esc(s.who) + '</b> ' + esc(s.text) + '</p>'; }).join('') : '<p class="muted">말을 시작하면 여기에 글이 나타나요…</p>') + (P.interim ? '<p class="interim">' + esc(P.interim) + '</p>' : '') + '</div>' : '') + '</div>';
  }
  function editorHtml() {
    const d = P.data, whos = d.members.map(function (m) { return m.name; }).concat(['교사', '(미지정)']);
    return '<div class="card"><div class="row"><h3 class="grow" style="margin:0">기록 고치기 (' + P.segs.length + '문단)</h3><button class="btn ghost sm" data-pa="add">+ 문단 추가</button><button class="btn sm" data-pa="save"' + (P.dirty ? '' : ' disabled') + '>저장</button></div>' +
      '<p class="small muted">음성 인식이 틀린 단어, 잘못 누른 발언자·구간을 고쳐 주세요. 특히 학생 이름이 다르게 적혔다면 바로잡아야 AI에 보낼 때 가명으로 바뀌어요.</p>' +
      (P.segs.length ? '<div class="segs">' + P.segs.map(function (s, i) {
        return '<div class="segrow" data-i="' + i + '"><div class="seg-meta"><select class="sg-seg" data-i="' + i + '" aria-label="구간">' + d.segs.map(function (x) { return '<option' + (x === s.seg ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
          '<select class="sg-who" data-i="' + i + '" aria-label="발언자">' + whos.map(function (w) { return '<option' + (w === s.who ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select>' +
          '<button class="btn sm ghost" data-pa="del" data-i="' + i + '" aria-label="문단 삭제">삭제</button></div><textarea class="sg-text" data-i="' + i + '" rows="2">' + esc(s.text) + '</textarea></div>';
      }).join('') + '</div>' : '<p class="muted">아직 기록이 없어요.</p>') + '</div>';
  }
  function evState(stage) {
    const ev = P.data.evals[stage], keys = Object.keys(ev);
    return { any: keys.length > 0, approved: keys.filter(function (k) { return ev[k].approved; }).length, published: keys.some(function (k) { return ev[k].published; }), total: keys.length };
  }
  function evalHtml(stage) {
    const d = P.data, isFb = stage === 'fb1';
    const need = isFb ? d.rec['1'] && d.rec['1'].segments.length : d.rec['1'] && d.rec['2'] && d.rec['2'].segments.length;
    const title = isFb ? 'AI ① 1차 피드백 정리' : 'AI ② 2차 변화 서술';
    const desc = isFb ? '1차 발표 기록에서 선생님이 말로 한 피드백과 질문을 학생별·항목별 글로 정리해요. 고치고 승인한 뒤 공개하면 학생 팀홈에 보여요(조 전체 피드백은 조원 모두, 개인 피드백은 본인만).'
      : '1차 기록 · 승인한 1차 피드백 · 2차 기록을 비교해 항목마다 "1차 → 피드백 → 2차 → 변화"와 개선도를 서술해요. 점수는 매기지 않아요. 승인한 내용은 세특 초안의 근거가 돼요.';
    let h = '<div class="card"><h2>' + title + '</h2><p class="small">' + desc + '</p>' + aiNote(d.aiReady);
    if (!need) return h + '<p class="muted">' + (isFb ? '1차 발표를 먼저 기록해 주세요.' : '1차와 2차 발표를 모두 기록해야 해요.') + '</p></div>';
    const st = evState(stage);
    h += '<div class="row"><button class="btn" data-pa="ai" data-st="' + stage + '">' + (st.any ? 'AI 초안 다시 만들기' : 'AI 초안 만들기') + '</button><button class="btn ghost" data-pa="aipv" data-st="' + stage + '">AI에 보내는 내용 보기</button>' +
      (st.any ? '<span class="small muted">승인 ' + st.approved + '/' + st.total + '</span>' : '') +
      (isFb && st.any ? '<span class="grow"></span>' + (st.published ? '<span class="badge ok">학생에게 공개 중</span><button class="btn sm ghost" data-pa="pub" data-on="">공개 내리기</button>' : '<button class="btn sm" data-pa="pub" data-on="1"' + (st.approved ? '' : ' disabled title="먼저 승인해 주세요"') + '>승인한 피드백 학생에게 공개</button>') : '') + '</div>';
    if (!st.any) return h + '</div>';
    if (st.any && P.dirtyEval) h += '';
    const items = d.items.concat(isFb ? [] : [d.improve]);
    const box = function (sid, name, roles, e, fields) {
      const cur = (e && (e.final || e.ai)) || {}, changed = e && e.final && e.ai && JSON.stringify(e.final) !== JSON.stringify(e.ai);
      return '<details class="evbox" data-st="' + stage + '" data-sid="' + esc(sid) + '"' + (e && e.approved ? '' : ' open') + '><summary><b>' + esc(name) + '</b> <span class="small muted">' + esc(roles) + '</span> ' +
        (e && e.approved ? '<span class="badge ok">승인됨</span>' : e ? '<span class="badge warn">검토 필요</span>' : '<span class="badge">초안 없음</span>') + (e && e.published ? ' <span class="badge brand">공개</span>' : '') + (changed ? ' <span class="badge">교사 수정</span>' : '') + '</summary>' +
        fields.map(function (f) { return '<label class="f small">' + esc(f.label) + '</label><textarea data-item="' + f.id + '" rows="' + (isFb ? 2 : 4) + '">' + esc(cur[f.id] || '') + '</textarea>'; }).join('') +
        (e && e.ai && e.final ? '<details class="small"><summary>AI 초안 보기</summary>' + fields.map(function (f) { return '<p><b>' + esc(f.label) + '</b><br>' + nl(e.ai[f.id] || '') + '</p>'; }).join('') + '</details>' : '') +
        '<div class="row" style="margin-top:6px"><button class="btn sm ghost" data-pa="evsave" data-ap="">임시 저장</button><button class="btn sm" data-pa="evsave" data-ap="1">' + (e && e.approved ? '고쳐서 다시 승인' : '승인') + '</button>' + (e && e.approved ? '<button class="btn sm ghost" data-pa="evsave" data-ap="" data-unap="1">승인 취소</button>' : '') + '</div></details>';
    };
    const ev = d.evals[stage];
    if (isFb) h += box('', '조 전체 피드백', '', ev.team, [{ id: 'team', label: '모둠 전체에게' }]);
    h += d.members.map(function (m) { return box(m.sid, m.name, m.roles.join(' · '), ev[m.sid], items); }).join('');
    return h + '</div>';
  }
  function presRender() { const y = window.scrollY; V.main.innerHTML = presHtml(); window.scrollTo(0, y); }
  function presLive() {   // 녹음 중에는 기록 영역만 다시 그린다
    const c = $('.rec-card', V.main); if (!c) return presRender();
    const tmp = document.createElement('div'); tmp.innerHTML = recorderHtml(); c.replaceWith(tmp.firstChild);
  }
  function addText(t) {
    const last = P.segs[P.segs.length - 1];
    if (last && last.seg === P.cur.seg && last.who === P.cur.who && !P.forceNew) last.text = (last.text + ' ' + t).trim();
    else P.segs.push({ seg: P.cur.seg, who: P.cur.who, text: t, t: new Date().toTimeString().slice(0, 8) });
    P.forceNew = false; P.dirty = true; P.interim = '';
    presLive();
  }
  async function saveRec(final) {
    if (P.saving) { await P.saving; if (!P.dirty && !final) return; }
    const tid = P.tid, round = P.round, segs = P.segs.map(function (s) { return { seg: s.seg, who: s.who, text: s.text, t: s.t }; });
    const snapshot = JSON.stringify(segs);
    P.saving = (async function () {
      try {
        const r = await call('saveRecording', { tid: tid, round: round, segments: segs, final: !!final });
        if (tid === P.tid && round === P.round && JSON.stringify(P.segs.map(function (s) { return { seg: s.seg, who: s.who, text: s.text, t: s.t }; })) === snapshot) P.dirty = false;
        P.lastSave = r.at;
        if (P.data && P.data.team.tid === tid) { P.data.rec[String(round)] = { round: round, date: r.date, segments: segs, at: r.at }; }
      } catch (e) { toast('기록 저장 실패: ' + e.message, 'err'); }
      P.saving = null;
    })();
    await P.saving;
    const ps = $('#psave', V.main); if (ps) ps.textContent = P.dirty ? '저장 안 된 내용 있음' : '저장됨 ' + String(P.lastSave).slice(11, 16);
  }
  function startMic() {
    try {
      P.rec = PJ.STT.create({
        lang: 'ko-KR',
        onFinal: addText,
        onInterim: function (t) { P.interim = t; const el = $('.live', V.main); if (el) { let i = $('.interim', el); if (!i && t) { i = document.createElement('p'); i.className = 'interim'; el.appendChild(i); } if (i) i.textContent = t; } },
        onState: function (s) { if (s === 'stopped' && P.listening) { P.listening = false; presRender(); } },
        onError: function (m) { toast(m, 'err'); },
      });
    } catch (e) { toast(e.message, 'err'); return; }
    P.listening = true; P.forceNew = true;
    P.rec.start();
    clearInterval(P.saveTimer);
    P.saveTimer = setInterval(function () { if (P.dirty) saveRec(false); }, 15000);
    presRender();
  }
  async function stopMic() {
    P.listening = false;
    if (P.rec) P.rec.stop();
    clearInterval(P.saveTimer);
    P.interim = '';
    presRender();
    await saveRec(true);
    presRender();
    toast('녹음을 끝내고 저장했어요. 아래에서 기록을 고칠 수 있어요.', 'ok');
  }
  function readEval(boxEl) {
    const items = {};
    $$('textarea[data-item]', boxEl).forEach(function (t) { items[t.dataset.item] = t.value; });
    return items;
  }
  function presClick(e) {
    const b = e.target.closest('[data-pa]'); if (!b) return false;
    const a = b.dataset.pa;
    const run = function (fn, txt) { guard(async function () { busy(b, true, txt); try { await fn(); } finally { busy(b, false); } presRender(); })(); return true; };
    if (a === 'round') {
      const n = Number(b.dataset.n); if (n === P.round) return true;
      if (P.listening) { toast('녹음을 먼저 끝내 주세요.', 'err'); return true; }
      return run(async function () { if (P.dirty) await saveRec(true); P.round = n; await presTeamLoad(); });
    }
    if (a === 'seg') { if (P.cur.seg !== b.dataset.v) { P.cur.seg = b.dataset.v; P.forceNew = true; } presLive(); return true; }
    if (a === 'who') { if (P.cur.who !== b.dataset.v) { P.cur.who = b.dataset.v; P.forceNew = true; } presLive(); return true; }
    if (a === 'mic') { if (P.listening) stopMic(); else startMic(); return true; }
    if (a === 'add') { P.segs.push({ seg: P.cur.seg, who: P.cur.who, text: '', t: '' }); P.dirty = true; presRender(); const t = $$('.sg-text', V.main).pop(); if (t) t.focus(); return true; }
    if (a === 'del') { if (!confirm('이 문단을 지울까요?')) return true; P.segs.splice(Number(b.dataset.i), 1); P.dirty = true; presRender(); return true; }
    if (a === 'save') return run(async function () { await saveRec(true); toast('기록을 저장했어요', 'ok'); });
    if (a === 'aipv') return run(async function () { if (P.dirty) await saveRec(true); const r = await call('aiPresent', { tid: P.tid, stage: b.dataset.st, preview: true }); showPreview(r.preview); });
    if (a === 'ai') {
      const st = b.dataset.st;
      if (evState(st).any && !confirm('AI 초안을 다시 만들까요? 선생님이 고친 최종본은 지워지지 않고, AI 초안만 새로 바뀌어요.')) return true;
      return run(async function () { if (P.dirty) await saveRec(true); P.data = await call('aiPresent', { tid: P.tid, stage: st }); toast('AI 초안을 만들었어요. 검토하고 승인해 주세요.', 'ok'); }, 'AI가 작성 중… (최대 1분)');
    }
    if (a === 'evsave') {
      const box = b.closest('.evbox'), ap = b.dataset.ap === '1';
      return run(async function () { P.data = await call('saveEval', { tid: P.tid, stage: box.dataset.st, sid: box.dataset.sid, items: readEval(box), approve: ap }); toast(ap ? '승인했어요' : b.dataset.unap ? '승인을 취소했어요' : '저장했어요', 'ok'); });
    }
    if (a === 'pub') {
      const on = b.dataset.on === '1';
      if (!confirm(on ? '승인한 1차 피드백을 학생에게 공개할까요?\n조 전체 피드백은 조원 모두에게, 개인 피드백은 본인에게만 보여요.' : '공개를 내릴까요?')) return true;
      return run(async function () { P.data = await call('publishEval', { tid: P.tid, published: on }); toast(on ? P.data.publishedCount + '건을 공개했어요' : '공개를 내렸어요', 'ok'); });
    }
    return false;
  }
  function presChange(e) {
    if (e.target.id === 'ptid') {
      if (P.listening) { toast('녹음을 먼저 끝내 주세요.', 'err'); e.target.value = P.tid; return true; }
      const v = e.target.value;
      guard(async function () { if (P.dirty) await saveRec(true); P.tid = v; P.data = null; if (v) await presTeamLoad(); presRender(); })();
      return true;
    }
    const i = e.target.dataset ? Number(e.target.dataset.i) : NaN;
    if (e.target.classList.contains('sg-seg')) { P.segs[i].seg = e.target.value; P.dirty = true; markDirty(); return true; }
    if (e.target.classList.contains('sg-who')) { P.segs[i].who = e.target.value; P.dirty = true; markDirty(); return true; }
    if (e.target.classList.contains('sg-text')) { P.segs[i].text = e.target.value; P.dirty = true; markDirty(); return true; }
    return false;
  }
  function markDirty() { const b = $('[data-pa="save"]', V.main); if (b) b.disabled = false; const ps = $('#psave', V.main); if (ps) ps.textContent = '저장 안 된 내용 있음'; }

  /* ════════════════ 세특 ════════════════ */
  const ST = V.set;
  const FLAG_RES = [/[가-힣A-Za-z0-9]*(?:대학교|대학|학원|재단|연구원|연구소|협회|병원|주식회사|\(주\)|㈜)/g, /[가-힣]*(?:초등학교|중학교|고등학교)/g];
  function flagsOf(t) { const set = {}; FLAG_RES.forEach(function (re) { (String(t).match(re) || []).forEach(function (w) { set[w] = 1; }); }); const sc = (V.ctx.state.ov && V.ctx.state.ov.settings || {}).schoolName; if (sc && String(t).indexOf(sc) >= 0) set[sc] = 1; return Object.keys(set); }
  function neisBytes(s) { let b = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b += c === 10 ? 2 : c < 128 ? 1 : 3; } return b; }
  async function setLoad() {
    ST.data = await call('seteukList', {});
    if (!ST.cls || ST.data.classes.indexOf(ST.cls) < 0) ST.cls = ST.data.classes[0] || '';
  }
  function countHtml(t) {
    const n = String(t).length, b = neisBytes(t), len = ST.data.len, fl = flagsOf(t);
    return '<span class="' + (n > len * 1.1 ? 'warn-t' : '') + '">' + n + '자 / 목표 ' + len + '자</span> · <span class="' + (b > 1500 ? 'warn-t' : '') + '">' + b + '바이트</span> <span class="muted">(나이스 과목 세특 한도 1,500바이트)</span>' + (fl.length ? ' · <span class="badge bad">주의 단어: ' + esc(fl.join(', ')) + '</span>' : '');
  }
  function setHtml() {
    const d = ST.data;
    if (!d.classes.length) return '<div class="card"><h2>세특</h2><p>아직 확정된 조가 없어요.</p></div>';
    const teams = d.teams.filter(function (t) { return t.cls === ST.cls; });
    if (ST.tid && !teams.some(function (t) { return t.tid === ST.tid; })) ST.tid = '';
    const studs = d.students.filter(function (s) { return s.cls === ST.cls && (!ST.tid || s.tid === ST.tid); });
    const appr = d.students.filter(function (s) { return s.cls === ST.cls && s.approved; }).length, all = d.students.filter(function (s) { return s.cls === ST.cls; }).length;
    let h = '<div class="card"><div class="row"><h2 class="grow" style="margin:0">세특 (프로젝트 부분)</h2>' +
      '<select id="scls" style="width:auto" aria-label="반">' + d.classes.map(function (c) { return '<option value="' + esc(c) + '"' + (c === ST.cls ? ' selected' : '') + '>' + esc(c) + '반</option>'; }).join('') + '</select>' +
      '<select id="stid" style="width:auto" aria-label="조"><option value="">전체 조</option>' + teams.map(function (t) { return '<option value="' + esc(t.tid) + '"' + (t.tid === ST.tid ? ' selected' : '') + '>' + esc(t.no) + '조 · ' + esc(t.field) + '</option>'; }).join('') + '</select>' +
      '<button class="btn ghost sm" data-sa="csv">CSV로 저장</button></div>' +
      '<p class="small">승인 ' + appr + '/' + all + '명 · 목표 분량 ' + d.len + '자(설정 탭에서 바꿀 수 있어요). AI 초안은 <b>승인된 2차 변화 서술</b>, 역할, 학생이 쓴 "나의 기여"를 근거로 써요. 변화 서술을 먼저 승인해 두면 더 구체적인 초안이 나와요.</p>' +
      '<div class="banner warn small"><b>꼭 확인하세요.</b> AI 초안은 출발점일 뿐이에요. 학교생활기록부 기재요령(해당 학년도)에 맞는지, 사실과 다른 내용이 없는지 선생님이 직접 확인하고 고쳐서 승인해 주세요. 기관·대학·기업명 등 "주의 단어"는 간단한 규칙으로 찾은 것이라 놓칠 수 있어요.</div>' + aiNote(d.aiReady) + '</div>';
    const byTeam = {};
    studs.forEach(function (s) { (byTeam[s.tid] = byTeam[s.tid] || []).push(s); });
    teams.filter(function (t) { return byTeam[t.tid]; }).forEach(function (t) {
      h += '<div class="card"><div class="row"><h3 class="grow" style="margin:0">' + esc(t.no) + '조 · ' + esc(t.field) + '</h3><button class="btn ghost sm" data-sa="aipv" data-tid="' + esc(t.tid) + '">AI에 보내는 내용 보기</button><button class="btn sm" data-sa="ai" data-tid="' + esc(t.tid) + '">이 조 AI 초안 만들기</button></div>' +
        byTeam[t.tid].map(function (s) {
          const cur = s.final || s.ai;
          return '<div class="sbox" data-sid="' + esc(s.sid) + '"><div class="row"><b>' + esc(s.name) + '</b><span class="small muted">' + esc(s.sid) + ' · ' + esc(s.roles.join(' · ') || '역할 없음') + '</span>' +
            (s.hasChange ? '<span class="badge ok">변화 서술 승인됨</span>' : '<span class="badge warn" title="발표 기록 탭에서 2차 변화 서술을 승인하면 근거가 늘어나요">변화 서술 미승인</span>') +
            '<span class="grow"></span>' + (s.approved ? '<span class="badge ok">승인 ' + esc(s.approvedAt.slice(5, 16)) + '</span>' : cur ? '<span class="badge warn">검토 필요</span>' : '<span class="badge">초안 없음</span>') + '</div>' +
            '<details class="small"><summary>참고 자료: 학생이 쓴 "나의 기여"</summary><p><b>내가 맡아서 한 일</b><br>' + (s.contribDo ? nl(s.contribDo) : '<span class="muted">작성 안 함</span>') + '</p><p><b>배운 점과 어려웠던 점</b><br>' + (s.contribLearn ? nl(s.contribLearn) : '<span class="muted">작성 안 함</span>') + '</p><p class="muted">학생이 쓴 글을 그대로 옮기지 말고 교사가 관찰한 활동·변화 중심으로 쓰세요.</p></details>' +
            (s.ai && s.final && s.ai !== s.final ? '<details class="small"><summary>AI 초안 보기</summary><p>' + nl(s.ai) + '</p><button class="btn sm ghost" data-sa="useai">이 초안으로 되돌리기</button></details>' : '') +
            '<textarea class="stext" rows="5" placeholder="AI 초안을 만들거나 직접 써 주세요.">' + esc(cur) + '</textarea>' +
            '<div class="small scount">' + countHtml(cur) + '</div>' +
            '<div class="row" style="margin-top:6px"><button class="btn sm ghost" data-sa="save" data-ap="">임시 저장</button><button class="btn sm" data-sa="save" data-ap="1">' + (s.approved ? '고쳐서 다시 승인' : '승인') + '</button><button class="btn sm ghost" data-sa="copy">복사</button></div></div>';
        }).join('') + '</div>';
    });
    return h;
  }
  function setRender() { const y = window.scrollY; V.main.innerHTML = setHtml(); window.scrollTo(0, y); }
  function setClick(e) {
    const b = e.target.closest('[data-sa]'); if (!b) return false;
    const a = b.dataset.sa, box = b.closest('.sbox');
    const run = function (fn, txt) { guard(async function () { busy(b, true, txt); try { await fn(); } finally { busy(b, false); } setRender(); })(); return true; };
    if (a === 'aipv') return run(async function () { const r = await call('aiSeteuk', { tid: b.dataset.tid, preview: true }); showPreview(r.preview); });
    if (a === 'ai') {
      const has = ST.data.students.some(function (s) { return s.tid === b.dataset.tid && (s.ai || s.final); });
      if (has && !confirm('이 조의 AI 초안을 다시 만들까요? 선생님이 고친 최종본은 그대로 두고 AI 초안만 바뀌어요.')) return true;
      return run(async function () { const r = await call('aiSeteuk', { tid: b.dataset.tid }); const keep = ST.data.students.filter(function (s) { return s.tid !== b.dataset.tid; }); ST.data.students = keep.concat(r.students); ST.data.students.sort(function (x, y) { return (Number(x.cls) - Number(y.cls)) || (Number(x.no) - Number(y.no)) || (x.sid < y.sid ? -1 : 1); }); toast('AI 세특 초안을 만들었어요. 검토하고 승인해 주세요.', 'ok'); }, 'AI가 작성 중… (최대 1분)');
    }
    if (a === 'save') {
      const ap = b.dataset.ap === '1', text = $('.stext', box).value, sid = box.dataset.sid;
      if (ap && flagsOf(text).length && !confirm('주의 단어(' + flagsOf(text).join(', ') + ')가 있어요. 그래도 승인할까요?')) return true;
      return run(async function () {
        const r = await call('saveSeteuk', { sid: sid, text: text, approve: ap });
        const s = ST.data.students.filter(function (x) { return x.sid === sid; })[0];
        s.final = text.trim(); s.approved = r.approved; s.approvedAt = r.approvedAt || ''; s.flags = r.flags;
        toast(ap ? '승인했어요' : '저장했어요', 'ok');
      });
    }
    if (a === 'useai') { const s = ST.data.students.filter(function (x) { return x.sid === box.dataset.sid; })[0]; $('.stext', box).value = s.ai; $('.scount', box).innerHTML = countHtml(s.ai); return true; }
    if (a === 'copy') { const t = $('.stext', box).value; navigator.clipboard.writeText(t).then(function () { toast('복사했어요', 'ok'); }, function () { toast('복사하지 못했어요', 'err'); }); return true; }
    if (a === 'csv') {
      const rows = ST.data.students.filter(function (s) { return s.cls === ST.cls; });
      PJ.downloadCsv(ST.cls + '반_세특.csv', [['반', '조', '학번', '이름', '역할', '세특(최종본, 없으면 AI 초안)', '글자수', '바이트', '승인']].concat(rows.map(function (s) { const t = s.final || s.ai; return [s.cls, s.no, s.sid, s.name, s.roles.join(', '), t, t.length, neisBytes(t), s.approved ? 'Y' : '']; })));
      return true;
    }
    return false;
  }
  function setChange(e) {
    if (e.target.id === 'scls') { ST.cls = e.target.value; ST.tid = ''; setRender(); return true; }
    if (e.target.id === 'stid') { ST.tid = e.target.value; setRender(); return true; }
    return false;
  }
  document.addEventListener('input', function (e) {
    if (V.tab === 'seteuk' && e.target.classList && e.target.classList.contains('stext')) { const c = $('.scount', e.target.closest('.sbox')); if (c) c.innerHTML = countHtml(e.target.value); }
    if (V.tab === 'pres' && e.target.classList && e.target.classList.contains('sg-text')) { P.segs[Number(e.target.dataset.i)].text = e.target.value; P.dirty = true; markDirty(); }
  });
  window.addEventListener('beforeunload', function (e) { if (P.listening || P.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ════════════════ admin.js 와의 연결 ════════════════ */
  const TABS = {
    form: { load: formLoad, render: formRender, click: formClick, change: formChange },
    pres: { load: presLoad, render: presRender, click: presClick, change: presChange },
    seteuk: { load: setLoad, render: setRender, click: setClick, change: setChange },
  };
  PJ.adminV2 = {
    tabs: TABS,
    show: async function (t, main, ctx, alive) {
      V.ctx = ctx; V.main = main; V.tab = t;
      main.innerHTML = '<p class="muted">불러오는 중…</p>';
      if (!ctx.state.ov) { try { ctx.state.ov = await ctx.call('adminOverview', {}); } catch (e) { /* 설정값만 필요 */ } }
      await TABS[t].load();
      if (!alive()) return;
      TABS[t].render();
      if (t === 'form') startFormTimer();
    },
    click: function (t, e) { return TABS[t].click(e); },
    change: function (t, e) { return TABS[t].change(e); },
    leave: async function (t) {
      if (t === 'pres') {
        if (P.listening) { if (!confirm('녹음 중이에요. 녹음을 끝내고 저장한 뒤 다른 탭으로 갈까요?')) return false; await stopMic(); }
        else if (P.dirty) await saveRec(true);
      }
      if (t === 'form') clearInterval(V.form.timer);
      V.tab = '';
      return true;
    },
  };
})();

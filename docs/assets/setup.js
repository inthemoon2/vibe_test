/* 학생 화면 v2: 조가 확정되기 전 단계
 *   ① 진로·관심 분야 입력  ② 선생님이 조를 편성하는 동안 기다리기  ③ 공개된 조에서 역할 칸에 내 이름 끌어다 놓기
 * 조가 확정되면 opts.onReady() 로 활동지 화면을 연다.
 */
(function () {
  const { esc, $, $$, api, toast } = PJ;
  let T = null;   // 현재 화면 상태

  PJ.renderSetup = function (app, ms, opts) {
    if (T && T.timer) clearInterval(T.timer);
    T = { app: app, ms: ms, opts: opts, busy: false, timer: null };
    draw();
    T.timer = setInterval(function () { if (!document.hidden && !T.busy && !T.editing) refresh(); }, ms.team ? 4000 : 8000);
  };

  async function refresh() {
    try {
      const ms = await api('myStatus', {}, T.opts.token);
      if (ms.team && ms.team.status !== '조구성') { clearInterval(T.timer); T.opts.onReady(); return; }
      const changed = JSON.stringify(ms) !== JSON.stringify(T.ms);
      const interval = !!ms.team !== !!T.ms.team;
      T.ms = ms;
      if (changed) draw();
      if (interval) { clearInterval(T.timer); T.timer = setInterval(function () { if (!document.hidden && !T.busy && !T.editing) refresh(); }, ms.team ? 4000 : 8000); }
    } catch (e) { if (!T.opts.onFatal(e)) toast(e.message, 'err'); }
  }

  function shell(body) {
    const me = T.ms.me;
    return '<header class="top"><div class="wrap"><b>' + esc(me.cls) + '반 · ' + esc(me.name) + '</b><span class="grow"></span><button class="btn sm" id="lo">나가기</button></div></header>' +
      '<main class="wrap">' + steps() + body + '</main>';
  }
  function steps() {
    const ms = T.ms, at = !ms.team ? (ms.stage === '' ? 0 : 1) : 2;
    const names = ['관심 분야 쓰기', '조 편성 기다리기', '역할 고르기', '활동 시작'];
    return '<ol class="steps">' + names.map(function (n, i) { return '<li class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + esc(n) + '</li>'; }).join('') + '</ol>';
  }

  function draw() {
    const ms = T.ms;
    let body;
    if (!ms.team && ms.stage === '') body = interestHtml();
    else if (!ms.team) body = waitHtml();
    else body = boardHtml();
    T.app.innerHTML = shell(body);
    $('#lo').addEventListener('click', function () { clearInterval(T.timer); T.opts.onLogout(); });
    if (!ms.team && ms.stage === '') bindInterest();
    if (ms.team) bindBoard();
  }

  /* ① 관심 분야 */
  function interestHtml() {
    const me = T.ms.me;
    return '<div class="card"><h2>나의 진로 · 관심 분야</h2>' +
      '<p>선생님이 관심 분야가 비슷한 친구끼리 조를 만들어요. 되고 싶은 직업, 관심 있는 분야나 사회 문제를 자유롭게 적어 주세요.</p>' +
      '<p><label class="f" for="intr">진로 · 관심 분야</label><textarea id="intr" maxlength="300" rows="3" placeholder="예) 간호사가 되고 싶고, 노인 돌봄 문제에 관심이 있어요.">' + esc(me.interest) + '</textarea></p>' +
      '<div class="row"><button class="btn" id="saveI">' + (me.interest ? '고쳐서 저장' : '저장') + '</button>' +
      (me.interest ? '<span class="small muted">저장됨 · ' + esc(me.interestAt) + '</span>' : '<span class="small muted">아직 정하지 못했다면 "아직 모르겠어요"라고 적어도 괜찮아요.</span>') + '</div></div>' +
      '<div class="banner info small">선생님이 입력을 마감할 때까지 몇 번이든 고칠 수 있어요.</div>';
  }
  function bindInterest() {
    const ta = $('#intr');
    ta.addEventListener('focus', function () { T.editing = true; });
    ta.addEventListener('blur', function () { T.editing = false; });
    $('#saveI').addEventListener('click', async function () {
      const b = this; b.disabled = true;
      try { await api('saveInterest', { text: ta.value }, T.opts.token); T.ms.me.interest = ta.value.trim(); T.ms.me.interestAt = '방금'; T.editing = false; toast('저장했어요.'); draw(); }
      catch (e) { if (!T.opts.onFatal(e)) toast(e.message, 'err'); if (e.code === 'CLOSED') refresh(); b.disabled = false; }
    });
  }

  /* ② 기다리기 */
  function waitHtml() {
    return '<div class="card"><h2>선생님이 조를 편성하고 있어요</h2>' +
      '<p>관심 분야 입력이 마감되었어요. 조가 공개되면 이 화면이 저절로 바뀌어요.</p>' +
      '<p class="small"><b>내가 쓴 관심 분야</b><br>' + (T.ms.me.interest ? esc(T.ms.me.interest) : '<span class="muted">(쓰지 않았어요)</span>') + '</p>' +
      '<p class="small muted"><span class="dot"></span>기다리는 중…</p></div>';
  }

  /* ③ 역할 고르기 */
  function boardHtml() {
    const ms = T.ms, t = ms.team, me = t.members.filter(function (m) { return m.me; })[0] || { roles: [] };
    const full = me.roles.length >= ms.maxRoles;
    const slots = ms.roles.map(function (r) {
      const cap = ms.roleCap[r], holders = t.members.filter(function (m) { return m.roles.indexOf(r) >= 0; });
      const mine = me.roles.indexOf(r) >= 0, isFull = holders.length >= cap;
      const canAdd = !mine && !isFull && !full;
      return '<div class="slot' + (isFull ? ' full' : '') + (mine ? ' mine' : '') + '" data-role="' + esc(r) + '" data-can="' + (canAdd ? '1' : '') + '">' +
        '<div class="slot-h"><b>' + esc(r) + '</b><span class="small muted">' + holders.length + ' / ' + cap + '명</span></div>' +
        '<div class="slot-b">' + holders.map(function (m) {
          return m.me ? '<span class="nm me" draggable="true" data-from="' + esc(r) + '">' + esc(m.name) + ' <button class="x" data-off="' + esc(r) + '" aria-label="' + esc(r) + '에서 빼기">×</button></span>' : '<span class="nm">' + esc(m.name) + '</span>';
        }).join('') +
        (canAdd ? '<button class="btn ghost sm put" data-on="' + esc(r) + '">여기에 내 이름 넣기</button>' : '') + '</div></div>';
    }).join('');
    const noRole = t.members.filter(function (m) { return !m.roles.length; });
    return '<div class="card"><h2>' + esc(ms.me.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + '</h2>' +
      '<p>우리 조 친구들: ' + t.members.map(function (m) { return '<span class="chip">' + esc(m.name) + (m.me ? ' (나)' : '') + '</span>'; }).join(' ') + '</p>' +
      '<p>아래 <b>내 이름표</b>를 원하는 역할 칸으로 끌어다 놓으세요. (휴대폰은 칸 안의 "여기에 내 이름 넣기"를 누르세요)</p>' +
      '<ul class="small"><li>데이터 엔지니어는 ' + ms.roleCap['데이터 엔지니어'] + '명까지, 나머지 역할은 1명씩이에요.</li><li>한 사람이 역할을 ' + ms.maxRoles + '개까지 맡을 수 있어요. 조원이 5명보다 적으면 빈 역할을 나눠 맡아요.</li><li>선생님이 조를 확정하면 역할이 고정되고 활동지가 열려요.</li></ul>' +
      '<div class="tray">' + (full ? '<span class="small muted">역할을 ' + ms.maxRoles + '개 골랐어요. 바꾸려면 칸에서 × 를 눌러 빼세요.</span>' : '<span class="nm me big" draggable="true" data-from="">' + esc(ms.me.name) + ' (내 이름표)</span>') + '</div>' +
      '</div><div class="slots">' + slots + '</div>' +
      (noRole.length ? '<div class="banner warn small">아직 역할을 고르지 않은 친구: ' + noRole.map(function (m) { return esc(m.name); }).join(', ') + '</div>' : '<div class="banner ok small">모두 역할을 골랐어요. 선생님이 확정할 때까지 기다려 주세요.</div>');
  }

  async function pick(role, on) {
    T.busy = true;
    try { T.ms = await api('pickRole', { role: role, on: on }, T.opts.token); }
    catch (e) { if (!T.opts.onFatal(e)) toast(e.message, 'err'); if (e.code === 'CONFIRMED') { T.busy = false; return refresh(); } }
    T.busy = false;
    draw();
  }
  async function moveRole(from, to) {
    if (from === to) return;
    T.busy = true;
    try {
      if (from) T.ms = await api('pickRole', { role: from, on: false }, T.opts.token);
      try { T.ms = await api('pickRole', { role: to, on: true }, T.opts.token); }
      catch (e) { if (from) T.ms = await api('pickRole', { role: from, on: true }, T.opts.token); throw e; }
    } catch (e) { if (!T.opts.onFatal(e)) toast(e.message, 'err'); }
    T.busy = false;
    draw();
  }

  function bindBoard() {
    const main = T.app.querySelector('main');
    main.addEventListener('click', function (e) {
      const on = e.target.closest('[data-on]'), off = e.target.closest('[data-off]');
      if (on) pick(on.dataset.on, true);
      if (off) pick(off.dataset.off, false);
    });
    let from = null;
    $$('.nm.me[draggable]', main).forEach(function (el) {
      el.addEventListener('dragstart', function (e) { from = el.dataset.from; e.dataTransfer.setData('text/plain', 'me'); e.dataTransfer.effectAllowed = 'move'; T.busy = true; });
      el.addEventListener('dragend', function () { T.busy = false; $$('.slot', main).forEach(function (s) { s.classList.remove('over'); }); });
    });
    $$('.slot', main).forEach(function (s) {
      const ok = function () { return from !== null && (s.dataset.can === '1' || (from && !s.classList.contains('full') && !s.classList.contains('mine'))); };
      s.addEventListener('dragover', function (e) { if (ok()) { e.preventDefault(); s.classList.add('over'); } });
      s.addEventListener('dragleave', function () { s.classList.remove('over'); });
      s.addEventListener('drop', function (e) { e.preventDefault(); s.classList.remove('over'); const f = from; from = null; if (f) moveRole(f, s.dataset.role); else pick(s.dataset.role, true); });
    });
  }
})();

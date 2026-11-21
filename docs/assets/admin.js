/* 관리자 화면: 현황 · 명단 · 차시 점검 · 채점 · 채점표 · 동료평가 · 설정
 * (v2 탭 — 조 구성 · 발표 기록 · 세특 — 은 admin-v2.js) */
(function () {
  const { esc, $, $$, api, toast } = PJ;
  const app = document.getElementById('app');
  const A = { token: PJ.store.get('pj_admin') || '', tab: 'overview', ov: null, schema: null, team: null, filter: '', rosterUp: null, rosterList: null, peer: null, sess: { sub: 1, cls: '', q: {}, fbTid: '', fb: null, data: null } };

  const call = async function (action, payload) {
    try { return await api(action, payload, A.token); }
    catch (e) { if (e.code === 'BAD_TOKEN' || e.code === 'EXPIRED') { logout(e.message); } throw e; }
  };
  const guard = function (fn) { return async function () { try { return await fn.apply(this, arguments); } catch (e) { toast(e.message, 'err'); } }; };

  /* ───────── 로그인 ───────── */
  function renderLogin(msg) {
    app.innerHTML = '<div class="wrap login"><div class="card"><h1>관리자 로그인</h1>' +
      (PJ.apiReady() ? '' : '<div class="banner bad">config.js 의 API_URL 이 아직 설정되지 않았어요. (README 4단계)</div>') +
      (msg ? '<div class="banner warn" role="alert">' + esc(msg) + '</div>' : '') +
      '<form id="lf"><p><label class="f" for="pw">관리자 비밀번호</label><input id="pw" type="password" required></p><p><button class="btn" style="width:100%;justify-content:center">로그인</button></p></form>' +
      '<p class="small muted">비밀번호는 Apps Script 의 "스크립트 속성 ADMIN_PASSWORD" 에 정한 값입니다.</p><p class="small"><a href="index.html">← 학생 화면</a></p></div></div>';
    $('#lf').addEventListener('submit', async function (e) {
      e.preventDefault();
      try { const r = await api('adminLogin', { pw: $('#pw').value }); A.token = r.token; PJ.store.set('pj_admin', r.token); boot(); } catch (x) { renderLogin(x.message); }
    });
  }
  function logout(msg) { A.token = ''; PJ.store.del('pj_admin'); renderLogin(msg); }

  /* ───────── 틀 ───────── */
  async function boot() {
    if (!A.token) return renderLogin();
    try { A.schema = A.schema || await api('schema'); await loadOverview(); } catch (e) { if (e.code === 'BAD_TOKEN' || e.code === 'EXPIRED') return logout(e.message); app.innerHTML = '<div class="wrap"><div class="banner bad">' + esc(e.message) + '</div></div>'; return; }
    const tabs = [['overview', '진행 현황'], ['roster', '명단 · 비밀번호'], ['form', '조 구성'], ['sess', '차시별 점검'], ['score', '채점'], ['pres', '발표 기록'], ['seteuk', '세특'], ['table', '채점표'], ['peer', '동료평가 가져오기'], ['settings', '설정']];
    app.innerHTML = '<header class="top"><div class="wrap"><b>관리자 · 사회문제 해결 기계학습 프로젝트</b><span class="grow"></span><a class="btn sm" href="index.html">학생 화면</a><button class="btn sm" id="lo">로그아웃</button></div></header>' +
      '<nav class="nav" id="nav">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav><main class="wrap wide" id="main"></main>';
    $('#lo').onclick = function () { logout(''); };
    $('#nav').addEventListener('click', function (e) { const b = e.target.closest('[data-t]'); if (b) go(b.dataset.t); });
    $('#main').addEventListener('click', onClick);
    $('#main').addEventListener('change', onChange);
    go(A.tab);
  }
  let mouseDown = false;
  document.addEventListener('mousedown', function () { mouseDown = true; }, true);
  document.addEventListener('mouseup', function () { mouseDown = false; }, true);
  setInterval(async function () {
    if (A.tab !== 'overview' || !A.token || document.hidden || mouseDown) return;
    const ae = document.activeElement; if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.id !== 'clsf') return;
    try { await loadOverview(); if (A.tab === 'overview' && !mouseDown) { const m = $('#main'); const y = window.scrollY; m.innerHTML = overviewHtml(); window.scrollTo(0, y); } } catch (e) { /* 다음 주기에 다시 */ }
  }, 15000);

  async function go(t) {
    const my = (A.nav = (A.nav || 0) + 1);    // 탭을 빠르게 바꿨을 때 먼저 시작한 화면이 나중에 덮어쓰지 않도록
    A.tab = t;
    $$('#nav button').forEach(function (b) { if (b.dataset.t === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const main = $('#main');
    if (A.v2tab && A.v2tab !== t && PJ.adminV2.leave && !(await PJ.adminV2.leave(A.v2tab))) {
      A.tab = A.v2tab; $$('#nav button').forEach(function (b) { if (b.dataset.t === A.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      return;
    }
    A.v2tab = PJ.adminV2.tabs[t] ? t : null;
    try {
      if (PJ.adminV2.tabs[t]) { await PJ.adminV2.show(t, main, v2ctx, function () { return my === A.nav; }); return; }
      if (t === 'overview') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = overviewHtml(); }
      else if (t === 'sess') { await flushSess(); await loadSess(); if (my !== A.nav) return; main.innerHTML = sessHtml(); }
      else if (t === 'roster') { A.rosterList = await call('rosterList'); if (my !== A.nav) return; main.innerHTML = rosterHtml(); }
      else if (t === 'score') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = scoreShellHtml(); if (A.team) loadTeam(A.team.team ? A.team.team.tid : A.team); }
      else if (t === 'table') { main.innerHTML = '<p class="muted">채점표를 불러오는 중…</p>'; const r = await call('scoreTable'); if (my !== A.nav) return; A.table = r; main.innerHTML = tableHtml(); }
      else if (t === 'peer') main.innerHTML = peerHtml();
      else if (t === 'settings') { await loadOverview(); if (my !== A.nav) return; main.innerHTML = settingsHtml(); }
    } catch (e) { toast(e.message, 'err'); }
  }
  // admin-v2.js 에 넘기는 도구
  const v2ctx = { call: function (a, p) { return call(a, p); }, guard: guard, go: function (t) { return go(t); }, schema: function () { return A.schema; }, state: A };

  async function loadOverview() {
    const base = new URL('.', location.href).href.replace(/\/$/, '');
    A.ov = await call('adminOverview', { siteUrl: base });
  }

  /* ───────── 진행 현황 ───────── */
  function pageLabel(id) { if (!id || id === 'home') return '팀 홈'; if (id === 'rpt') return '보고서·피드백'; const pg = (A.ov.pages || []).filter(function (p) { return p.id === id; })[0]; return pg ? pg.no + '단계 ' + pg.title : id; }
  function fieldLabel(id) { if (!id) return ''; let r = ''; ((A.schema || {}).pages || []).forEach(function (p) { p.sections.forEach(function (s) { s.fields.forEach(function (f) { if (f.id === String(id).split('@')[0]) r = f.label; }); }); }); return r ? '보는 칸: ' + r : ''; }
  function overviewHtml() {
    const o = A.ov, classes = Array.from(new Set(o.teams.map(function (t) { return t.cls; })));
    const teams = o.teams.filter(function (t) { return !A.filter || t.cls === A.filter; });
    const sub = teams.filter(function (t) { return t.status === '제출완료'; }).length;
    if (!o.teams.length) return '<div class="card"><h2>아직 만들어진 조가 없어요</h2><ol><li>"명단 · 비밀번호" 탭에서 <b>반별 명단(학번·이름)</b>을 올려요.</li><li>학생들이 로그인해 비밀번호를 정하고 <b>진로·관심 분야</b>를 써요.</li><li>"조 구성" 탭에서 입력을 마감하고 <b>AI 조 편성안</b>을 만들어 고친 뒤 공개해요.</li><li>학생들이 역할을 고르면 <b>조 확정</b>을 눌러 활동지를 열어요.</li></ol><div class="row"><button class="btn" data-t2="roster">명단 올리러 가기</button><button class="btn ghost" data-t2="form">조 구성 보기</button></div></div>';
    return '<div class="card"><div class="row"><h2 class="grow" style="margin:0">진행 현황</h2>' +
      '<select id="clsf" style="width:auto"><option value="">전체 반</option>' + classes.map(function (c) { return '<option value="' + esc(c) + '"' + (A.filter === c ? ' selected' : '') + '>' + esc(c) + '반</option>'; }).join('') + '</select>' +
      '<button class="btn ghost sm" data-act="refresh">새로고침</button></div>' +
      '<p class="small muted">조 ' + teams.length + '개 · 제출 완료 ' + sub + '개. 단계별 숫자는 필수 항목 작성 비율(%)입니다. <b>접속 중</b>은 최근 40초 안에 화면을 연 학생과 그 위치이고, 15초마다 자동으로 갱신돼요.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>반-조</th><th>분야</th><th>상태</th><th>전체</th>' + o.pages.map(function (p) { return '<th title="' + esc(p.title) + '">' + p.no + '단계</th>'; }).join('') + '<th>발표 자료</th><th>접속 중 (위치)</th><th>마지막 수정</th><th>점검</th><th></th></tr></thead><tbody>' +
      teams.map(function (t) {
        const warn = []; if (t.nStudents < 3 || t.nStudents > 5) warn.push('<span class="badge warn">' + t.nStudents + '명</span>');
        return '<tr><td><b>' + esc(t.cls) + '-' + esc(t.no) + '</b></td><td>' + esc(t.field) + '</td><td>' + (t.status === '제출완료' ? '<span class="badge ok">제출 완료</span>' : t.status === '조구성' ? '<span class="badge warn">역할 고르는 중</span>' : '<span class="badge">작성 중</span>') + (t.late ? ' <span class="badge bad" title="마감 시각 이후에 제출했어요">마감 후 제출</span>' : '') + (t.scored ? ' <span class="badge brand">채점됨</span>' : '') + '</td>' +
          '<td style="min-width:90px"><div class="bar' + (t.progress === 100 ? ' full' : '') + '"><i style="width:' + t.progress + '%"></i></div><span class="small">' + t.progress + '%</span></td>' +
          o.pages.map(function (p) { const v = t.pages[p.id]; return '<td class="small">' + (v == null ? '-' : v + '%') + '</td>'; }).join('') +
          '<td class="small">' + (t.status !== '제출완료' ? '-' : t.ppt ? '<span class="badge ok">올림</span>' : '<span class="badge warn">미제출</span>') + '</td>' +
          '<td class="small">' + (t.online && t.online.length ? t.online.map(function (p) { return '<div title="' + esc(fieldLabel(p.field)) + '"><span class="dot"></span>' + esc(p.name) + ' · ' + esc(pageLabel(p.page)) + '</div>'; }).join('') : '<span class="muted">-</span>') + '</td><td class="small">' + esc(t.lastEdit || '-') + '<br><span class="muted">' + esc(t.lastBy || '') + '</span></td><td>' + warn.join(' ') + '</td>' +
          '<td style="white-space:nowrap"><button class="btn sm ghost" data-open="' + esc(t.tid) + '">채점·상세</button> <button class="btn sm ghost" data-view="' + esc(t.tid) + '">화면 보기</button> ' + (t.reportId ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="' + esc(PJ.reportLink(t.reportId)) + '">보고서</a> ' : '') + (t.status === '제출완료' ? '<button class="btn sm danger ghost" data-reopen="' + esc(t.tid) + '">수정 허용</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ───────── 명단 (반별 학번·이름) ───────── */
  function parseIds(rows) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); });
    let hi = -1, sc = -1, nc = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) { const a = rows[i].findIndex(function (c) { return /학번/.test(c); }), b = rows[i].findIndex(function (c) { return /^이름$|성명/.test(c); }); if (a >= 0 && b >= 0) { hi = i; sc = a; nc = b; break; } }
    const out = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]; let sid = '', nm = '';
      if (hi >= 0) { sid = r[sc]; nm = r[nc]; }
      else { r.forEach(function (c) { if (/^\d{3,10}$/.test(c) && !sid) sid = c; else if (/^[가-힣]{2,5}$/.test(c) && !nm) nm = c; }); }
      if (sid && nm) out.push({ sid: String(sid).replace(/\D/g, ''), name: nm });
    }
    return out;
  }
  function rosterHtml() {
    const L = A.rosterList || { classes: [] };
    let h = '<div class="card"><h2>① 반별 명단 올리기</h2>' +
      '<p class="small">반마다 <b>학번과 이름</b>이 있는 명부를 올려요. 엑셀(.xlsx)·CSV 파일 또는 표를 복사해 붙여넣기 모두 됩니다. 열 제목에 "학번", "이름"이 있으면 자동으로 찾아요. 조와 역할은 학생들이 직접 정하므로 여기서는 넣지 않아요. 같은 반을 다시 올리면 새 학생은 추가하고 기존 학생(같은 학번)은 이름만 고쳐요.</p>' +
      '<div class="row"><label class="f" for="rcls" style="margin:0">반</label><input id="rcls" type="number" min="1" max="99" style="width:90px" value="' + esc(L.classes.length ? L.classes[L.classes.length - 1].cls : 1) + '"><input type="file" id="rfile" accept=".csv,.tsv,.txt,.xlsx,.xls"></div>' +
      '<details><summary>또는 표를 복사해 붙여넣기</summary><textarea id="rpaste" placeholder="학번  이름 (한 줄에 한 명)"></textarea><button class="btn ghost sm" data-act="rparse-paste">붙여넣은 내용 확인</button></details>' +
      '<div id="rprev">' + rosterPrevHtml() + '</div></div>';
    h += '<div class="card"><h2>② 학생 명단 · 비밀번호</h2><p class="small">학생은 처음 로그인할 때 <b>학번 + 이름</b>으로 들어와 비밀번호를 직접 정해요. 비밀번호를 잊은 학생은 "비밀번호 초기화"를 누르면 다시 정할 수 있어요. 비밀번호는 시트에 암호화되어 저장되고 선생님도 볼 수 없어요.</p>';
    if (!L.classes.length) h += '<p class="muted">아직 올린 명단이 없어요.</p>';
    L.classes.forEach(function (c) {
      const n = c.students.length, pw = c.students.filter(function (s) { return s.hasPw; }).length, it = c.students.filter(function (s) { return s.interest; }).length;
      h += '<details class="card"' + (L.classes.length === 1 ? ' open' : '') + '><summary><b>' + esc(c.cls) + '반</b> · ' + n + '명 · 비밀번호 설정 ' + pw + '명 · 관심 분야 ' + it + '명 <span class="badge">' + esc(L.stages[c.stage] || '') + '</span></summary>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>학번</th><th>이름</th><th>비밀번호</th><th>조 / 역할</th><th>메모</th><th></th></tr></thead><tbody>' + c.students.map(function (s) {
          return '<tr><td>' + esc(s.sid) + '</td><td>' + esc(s.name) + '</td><td>' + (s.hasPw ? '<span class="badge ok">설정함</span>' : '<span class="badge">아직</span>') + '</td>' +
            '<td class="small">' + (s.tid ? esc(s.no) + '조 · ' + esc(s.roles.join(', ') || '역할 미정') : '<span class="muted">-</span>') + '</td>' +
            '<td><input type="text" class="memo" data-sid="' + esc(s.sid) + '" value="' + esc(s.memo) + '" maxlength="200" style="min-width:120px" aria-label="' + esc(s.name) + ' 메모"></td>' +
            '<td style="white-space:nowrap">' + (s.hasPw ? '<button class="btn sm ghost" data-pwreset="' + esc(s.sid) + '" data-nm="' + esc(s.name) + '">비밀번호 초기화</button> ' : '') + (s.tid ? '' : '<button class="btn sm ghost danger" data-rmstu="' + esc(s.sid) + '" data-nm="' + esc(s.name) + '">삭제</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    });
    return h + '</div>';
  }
  function rosterPrevHtml() {
    const U = A.rosterUp; if (!U) return '';
    if (U.result) {
      const r = U.result;
      return '<div class="banner ok">' + esc(U.cls) + '반: 새 학생 ' + r.added + '명 추가, ' + r.updated + '명 갱신.</div>' +
        (r.skipped.length ? '<div class="banner warn"><b>읽지 못한 줄</b> ' + esc(r.skipped.join(', ')) + '</div>' : '') +
        (r.warnings.length ? '<div class="banner warn"><ul class="small">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
        (r.notInList.length ? '<div class="banner info small"><b>이번 명단에 없는 기존 학생</b> ' + esc(r.notInList.join(', ')) + ' — 잘못 올린 학생이면 아래 목록에서 삭제하세요.</div>' : '') +
        '<p class="small">다음: 학생들에게 학생 화면 주소를 알려 주고, 학번·이름으로 로그인해 비밀번호와 관심 분야를 쓰게 하세요. → <button class="btn sm ghost" data-t2="form">조 구성 탭</button></p>';
    }
    return '<h3>미리보기: ' + esc(U.cls) + '반 · ' + U.rows.length + '명</h3><div class="tbl-wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th>학번</th><th>이름</th></tr></thead><tbody>' + U.rows.map(function (r) { return '<tr><td>' + esc(r.sid) + '</td><td>' + esc(r.name) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p><button class="btn" data-act="rsend">이 명단을 ' + esc(U.cls) + '반으로 올리기</button></p>';
  }
  function previewRoster(rows) {
    const list = parseIds(rows), cls = $('#rcls').value;
    if (!list.length) { A.rosterUp = null; $('#rprev').innerHTML = '<div class="banner bad">학번·이름을 찾지 못했어요. 열 제목이 "학번", "이름"인지 확인해 주세요.</div>'; return; }
    A.rosterUp = { cls: cls, rows: list };
    $('#rprev').innerHTML = rosterPrevHtml();
  }

  /* ───────── 채점 ───────── */
  function scoreShellHtml() {
    const o = A.ov;
    if (!o.teams.length) return '<div class="card">먼저 "조 구성" 탭에서 조를 만들어 주세요.</div>';
    const cur = A.team && A.team.team ? A.team.team.tid : '';
    return '<div class="card"><div class="row"><label class="f" for="tsel" style="margin:0">조 선택</label><select id="tsel" style="width:auto"><option value="">선택하세요</option>' + o.teams.map(function (t) { return '<option value="' + esc(t.tid) + '"' + (t.tid === cur ? ' selected' : '') + '>' + esc(t.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + (t.status === '제출완료' ? ' (제출)' : '') + '</option>'; }).join('') + '</select>' +
      '<button class="btn ghost sm" data-act="vall">전체 조 가상 채점을 시트에 기록</button></div>' +
      '<p class="small muted">가상 채점은 <b>글의 형식·완성도</b>(글자 수, 필수 항목, 문제 유형과 모델·지표의 짝, 테스트 데이터 사용 여부 등)만 규칙으로 점검한 <b>제안</b>이에요. 내용이 정확한지는 판단하지 못하므로 최종 점수는 선생님이 정합니다.</p></div><div id="tdetail"></div>';
  }
  async function loadTeam(tid) {
    if (!tid) { $('#tdetail').innerHTML = ''; A.team = null; return; }
    $('#tdetail').innerHTML = '<p class="muted">불러오는 중…</p>';
    A.team = await call('adminTeam', { tid: tid });
    $('#tdetail').innerHTML = teamHtml(A.team);
  }
  function teamHtml(d) {
    const t = d.team, E = A.schema.elems;
    let h = '<div class="card"><h2>' + esc(t.cls) + '반 ' + esc(t.no) + '조 · ' + esc(t.field) + ' ' + (t.status === '제출완료' ? '<span class="badge ok">제출 ' + esc(t.submitAt) + '</span>' : '<span class="badge">작성 중</span>') + '</h2><p class="small"><button class="btn sm ghost" data-view="' + esc(t.tid) + '">학생 작업 화면 보기(읽기 전용)</button> 작성 진행률 ' + t.progress + '% ' + (t.reportId ? '· <a target="_blank" rel="noopener" href="' + esc(PJ.reportLink(t.reportId)) + '">보고서 열기</a>' : '· 아직 보고서 없음') + '</p></div>';
    h += '<div class="card"><h2>조 점수 (기획안 · 전처리 · 모델 생성 · 모델 평가)</h2>';
    E.forEach(function (e) {
      const r = A.schema.rubric[e], v = d.virtual[e], ts = d.teamScore[e];
      h += '<div class="vs" data-e="' + e + '"><h3>' + esc(r.name) + ' <span class="badge brand">가상 채점 ' + '<span class="score">' + v.score + '</span>/' + r.max + '</span> <span class="small muted">충족 ' + v.passCount + '/' + v.total + '</span></h3>' +
        '<ul class="chk">' + v.checks.map(function (c) { return '<li class="' + (c.pass ? '' : 'no') + '">' + esc(c.label) + '<small>' + esc(c.detail) + '</small></li>'; }).join('') + '</ul>' +
        (v.flags.length ? '<div class="banner warn small">' + v.flags.map(function (f) { return '⚠ ' + esc(f); }).join('<br>') + '</div>' : '') +
        '<p class="small muted">산정 규칙: ' + esc(v.rule) + '</p>' +
        '<div><b class="small">교사 채점</b> <button class="btn sm ghost" data-use="' + e + '" data-v="' + v.score + '">가상 점수 적용</button></div>' +
        r.levels.map(function (l) { return '<label class="lv' + (ts.score === l.score ? ' sel' : '') + '"><input type="radio" name="lv_' + e + '" value="' + l.score + '"' + (ts.score === l.score ? ' checked' : '') + '><b>' + l.score + '점</b> <span class="small">' + esc(l.text) + '</span></label>'; }).join('') +
        '<label class="f small" for="rs_' + e + '">점수 사유 (선택, 시트에 기록)</label><input type="text" id="rs_' + e + '" value="' + esc(ts.reason || '') + '"></div>';
    });
    h += '<button class="btn" data-act="save-team">조 점수 저장</button></div>';

    h += '<div class="card"><h2>학생별 (개인 조정 · 결석 · 동료평가 환산)</h2><p class="small muted">조 점수에서 달라지는 학생만 "개인 조정"을 고르세요(비워 두면 조 점수 그대로). 조정하면 <b>사유가 꼭 필요</b>해요. 결석 학생은 기본 점수(' + d.base + '점)가 적용됩니다. 동료평가 환산(0~20)은 기준이 정해지면 직접 입력해요.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름 / 역할</th><th>학번</th><th>활동 기록</th><th>개인 조정</th><th>결석</th><th>조정 사유</th><th>동료평가</th><th>합계</th><th></th></tr></thead><tbody>' +
      d.members.map(function (m, i) {
        return '<tr data-m="' + i + '" data-name="' + esc(m.name) + '"><td><b>' + esc(m.name) + '</b><br><span class="small muted">' + esc(m.roles.map(function (r) { return r.replace(/\(.*\)/, ''); }).join('·')) + '</span></td>' +
          '<td class="small">' + esc(m.sid || '-') + '</td>' +
          '<td class="small">저장 ' + m.stat.saves + '회<br>+' + m.stat.chars + '자<br>' + esc(m.stat.last || '-') + '</td>' +
          '<td>' + E.map(function (e) { return '<div class="small">' + esc(A.schema.elemNames[e]) + ' <select class="adj" data-e="' + e + '" style="width:auto;padding:2px"><option value="">조 점수</option>' + A.schema.rubric[e].levels.map(function (l) { return '<option value="' + l.score + '"' + (m.adj[e] === l.score ? ' selected' : '') + '>' + l.score + '</option>'; }).join('') + '</select></div>'; }).join('') + '</td>' +
          '<td><input type="checkbox" class="abs"' + (m.absent ? ' checked' : '') + ' aria-label="' + esc(m.name) + ' 결석"></td>' +
          '<td><input type="text" class="rsn" value="' + esc(m.adjReason || '') + '" style="min-width:140px"></td>' +
          '<td class="small">원점수 ' + esc(m.peerRaw === '' || m.peerRaw == null ? '-' : m.peerRaw) + (m.peerN ? ' (' + m.peerN + '건)' : '') + '<br>환산 <input type="number" class="peer" min="0" max="20" step="0.1" value="' + (m.peerScaled == null ? '' : m.peerScaled) + '" style="width:70px"></td>' +
          '<td><b>' + (m.eff.total == null ? '-' : m.eff.total) + '</b><br><span class="badge ' + (m.absent ? 'bad' : m.eff.complete ? 'ok' : 'warn') + '">' + (m.absent ? '결석' : m.eff.complete ? '완료' : '채점 중') + '</span></td>' +
          '<td><button class="btn sm" data-save-stu="' + i + '">저장</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    h += '<div class="banner info small">세특 초안과 기재 주의 단어 점검은 <button class="btn sm ghost" data-t2="seteuk">세특 탭</button>으로 옮겼어요. 발표 피드백은 <button class="btn sm ghost" data-t2="pres">발표 기록 탭</button>에서 다룹니다.</div>';
    h += '<div class="card"><h2>학생이 쓴 전체 내용</h2><details><summary>펼쳐서 확인</summary>' + d.fields.map(function (f) {
      if (f.type === 'file') return '<p class="small"><b>' + esc(f.label) + '</b><br>' + (f.file ? '<a target="_blank" rel="noopener" href="' + esc(f.file.view) + '">' + esc(f.file.name) + '</a>' : '<span class="muted">없음</span>') + '</p>';
      const n = PJ.countChars(f.val);
      return '<p class="small"><b>' + f.page + '단계 · ' + esc(f.label) + '</b>' + (f.min ? ' <span class="badge ' + (n >= f.min ? 'ok' : 'warn') + '">' + n + '/' + f.min + '자</span>' : '') + '<br>' + (f.val ? esc(f.val).replace(/\n/g, '<br>') : '<span class="muted">비어 있음</span>') + '</p>';
    }).join('') + '</details></div>';
    return h;
  }
  const saveTeam = guard(async function () {
    const tid = A.team.team.tid, scores = {};
    A.schema.elems.forEach(function (e) { const r = $('input[name="lv_' + e + '"]:checked'); scores[e] = { score: r ? Number(r.value) : null, reason: $('#rs_' + e).value }; });
    await call('saveTeamScore', { tid: tid, scores: scores }); toast('조 점수를 저장했어요', 'ok'); await loadTeam(tid);
  });
  const saveStu = guard(async function (i) {
    const tr = $('tr[data-m="' + i + '"]'), tid = A.team.team.tid, name = tr.dataset.name, adj = {};
    $$('.adj', tr).forEach(function (s) { adj[s.dataset.e] = s.value === '' ? null : Number(s.value); });
    await call('saveStudentScore', { tid: tid, name: name, absent: $('.abs', tr).checked, adj: adj, reason: $('.rsn', tr).value, peerScaled: $('.peer', tr).value === '' ? null : Number($('.peer', tr).value) });
    toast(name + ' 저장 완료', 'ok'); await loadTeam(tid);
  });

  /* ───────── 채점표 ───────── */
  function tableHtml() {
    const t = A.table; if (!t) return '';
    return '<div class="card"><div class="row"><h2 class="grow" style="margin:0">채점표 (구글 시트 "채점표" 탭과 같은 내용)</h2><button class="btn ghost sm" data-act="tcsv">CSV로 저장</button></div><p class="small muted">조 점수 + 개인 조정 + 동료평가 환산을 합친 학생별 점수예요. "채점 중"은 아직 빈 항목이 있다는 뜻입니다.</p><div class="tbl-wrap"><table class="tbl"><thead><tr>' + t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + t.rows.map(function (r) { return '<tr>' + t.headers.map(function (h) { return '<td>' + esc(r[h]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
  }

  /* ───────── 동료평가 가져오기 ───────── */
  function peerHtml() {
    return '<div class="card"><h2>동료평가 파일 가져오기</h2><p class="small">엑셀(.xlsx)·CSV 파일을 올리면 <b>어느 열이 평가자 / 평가받는 학생 / 점수인지</b> 고르는 화면이 나와요. 한 줄이 "한 사람이 한 사람을 평가한 기록"인 형태를 기준으로 하며, 학생별 점수 평균을 구해 <b>원점수</b>로 저장합니다. 20점 만점으로의 <b>환산은 하지 않아요</b>(기준이 정해지면 채점 탭에서 입력).</p>' +
      '<input type="file" id="pfile" accept=".csv,.tsv,.txt,.xlsx,.xls"> <details style="display:inline-block"><summary>붙여넣기</summary><textarea id="ppaste" placeholder="표를 복사해서 붙여넣기"></textarea><button class="btn ghost sm" data-act="pparse-paste">확인</button></details><div id="pmap"></div><div id="pres"></div></div>';
  }
  function peerMap(rows) {
    if (rows.length < 2) { $('#pmap').innerHTML = '<div class="banner bad">데이터 줄이 부족해요.</div>'; return; }
    const head = rows[0].map(function (c, j) { return String(c || '').trim() || ('열' + (j + 1)); });
    A.peer = { head: head, rows: rows.slice(1) };
    const opt = function (sel, filter) { const hit = filter ? head.findIndex(function (h) { return filter.test(h); }) : -1; return '<option value="">(없음)</option>' + head.map(function (h, j) { return '<option value="' + j + '"' + (j === hit ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join(''); };
    const tgGuess = head.findIndex(function (h) { return /피평가|대상|평가받/.test(h); });
    const guessScore = head.map(function (h, j) { return /점수|평가|score|\d/.test(h) && !/평가자|피평가|대상/.test(h) ? j : -1; }).filter(function (j) { return j >= 0; });
    $('#pmap').innerHTML = '<h3>열 연결하기</h3><div class="row"><div><label class="f small">평가한 사람(평가자) 열</label><select id="pev">' + opt(0, /평가자|작성자|응답자|이름$/) + '</select></div>' +
      '<div><label class="f small">평가받은 학생 열</label><select id="ptg">' + opt(0, /피평가|대상|평가받/) + '</select></div>' +
      '<div><label class="f small">반 열(이름으로 찾을 때, 선택)</label><select id="pcl">' + opt(0, /^반$/) + '</select></div></div>' +
      '<p class="f small" style="margin-top:10px">평가받은 학생을 무엇으로 찾을까요?</p><label><input type="radio" name="pkey" value="sid"' + (tgGuess >= 0 && /이름|성명/.test(head[tgGuess]) ? '' : ' checked') + '> 학번</label> &nbsp; <label><input type="radio" name="pkey" value="name"' + (tgGuess >= 0 && /이름|성명/.test(head[tgGuess]) ? ' checked' : '') + '> 이름</label>' +
      '<p class="f small" style="margin-top:10px">점수 열 (여러 개 선택 → 줄마다 평균)</p><div class="opts" id="psc">' + head.map(function (h, j) { return '<label><input type="checkbox" value="' + j + '"' + (guessScore.indexOf(j) >= 0 ? ' checked' : '') + '>' + esc(h) + '</label>'; }).join('') + '</div>' +
      '<p><label><input type="checkbox" id="pself" checked> 자기 자신을 평가한 줄은 제외</label></p>' +
      '<h3>미리보기 (처음 5줄)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + A.peer.rows.slice(0, 5).map(function (r) { return '<tr>' + head.map(function (h, j) { return '<td>' + esc(r[j]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="small muted">전체 ' + A.peer.rows.length + '줄. 다시 가져오면 이전에 가져온 원점수는 새 내용으로 바뀌고, 입력해 둔 환산 점수는 유지돼요.</p><p><button class="btn" data-act="psend">가져오기</button></p>';
  }
  const peerSend = guard(async function () {
    const ev = $('#pev').value, tg = $('#ptg').value, cl = $('#pcl').value, sc = $$('#psc input:checked').map(function (i) { return Number(i.value); });
    if (tg === '') return toast('평가받은 학생 열을 골라 주세요.', 'err');
    if (!sc.length) return toast('점수 열을 하나 이상 골라 주세요.', 'err');
    const rows = A.peer.rows.map(function (r) { return { evaluator: ev === '' ? '' : r[ev], target: r[tg], cls: cl === '' ? '' : r[cl], scores: sc.map(function (j) { return parseFloat(String(r[j]).replace(/[^\d.\-]/g, '')); }).filter(function (x) { return !isNaN(x); }) }; });
    const res = await call('importPeer', { rows: rows, keyType: $('input[name="pkey"]:checked').value, excludeSelf: $('#pself').checked });
    $('#pres').innerHTML = '<div class="banner ok"><b>' + res.students + '명</b>의 원점수를 저장했어요 (사용한 줄 ' + res.used + ', 본인 평가 제외 ' + res.skippedSelf + ', 점수 없는 줄 ' + res.skippedEmpty + ').</div>' +
      (res.unmatched.length ? '<div class="banner warn"><b>명단에서 찾지 못한 대상</b> ' + esc(res.unmatched.join(', ')) + '</div>' : '') +
      (res.ambiguous.length ? '<div class="banner warn"><b>동명이인 등으로 구분하지 못함</b> ' + esc(res.ambiguous.join(', ')) + ' (반 열을 연결하거나 학번 기준으로 해 보세요)</div>' : '') +
      (res.noResponse.length ? '<details><summary>평가를 받지 못한 학생 ' + res.noResponse.length + '명</summary><p class="small">' + esc(res.noResponse.join(', ')) + '</p></details>' : '');
  });

  /* ───────── 설정 ───────── */
  function settingsHtml() {
    const s = A.ov.settings;
    return '<div class="card"><h2>설정</h2><p><label class="f" for="s_school">학교 이름 (세특 "주의 단어" 검사에 사용)</label><input id="s_school" type="text" value="' + esc(s.schoolName) + '" maxlength="40"></p>' +
      '<p><label class="f" for="s_base">결석 학생 기본 점수</label><input id="s_base" type="number" min="0" max="100" value="' + esc(s.baseScore) + '" style="width:120px"></p>' +
      '<p><label class="f" for="s_sl">세특 초안 분량 (공백 포함 글자 수)</label><input id="s_sl" type="number" min="50" max="1000" value="' + esc(s.seteukLen || '300') + '" style="width:120px"><span class="hint">이 프로젝트 부분만 쓰는 분량이에요. 나이스 과목 세특 전체 한도(500자 · 1,500바이트) 안에서 다른 활동과 나눠 쓰도록 정하세요.</span></p>' +
      '<p><label class="f" for="s_url">사이트 주소 (보고서 링크의 앞부분)</label><input id="s_url" type="text" value="' + esc(s.siteUrl) + '"><span class="hint">처음 관리자 로그인할 때 자동으로 채워져요. 주소를 바꾸면 이미 만든 보고서 링크도 함께 바뀝니다.</span></p>' +
      '<h3 style="margin-top:18px">최종 제출 마감과 제출 권한</h3>' +
      '<p><label class="f" for="s_s3">3차시(마지막 수행평가) 종료 일시</label><input id="s_s3" type="datetime-local" value="' + esc(s.session3At || '') + '" style="max-width:260px"><span class="hint">입력하면 이 시각부터 아래 시간 뒤가 "최종 제출 마감"이에요. 학생 화면에 마감 시각이 표시돼요.</span></p>' +
      '<p><label class="f" for="s_dh">마감까지 주는 시간 (시간)</label><input id="s_dh" type="number" min="1" max="720" value="' + esc(s.deadlineHours || '48') + '" style="width:120px"></p>' +
      '<p><label class="f" for="s_pd">발표 자료 올리는 기한 (선택)</label><input id="s_pd" type="datetime-local" value="' + esc(s.pptDue || '') + '" style="max-width:260px"><span class="hint">활동지를 제출한 조가 보고서를 보고 발표 자료를 올리는 기한이에요. 학생 화면에 표시되고, 아래 "마감 후 막기"를 켜면 이 시각 뒤에는 올릴 수 없어요. 비워 두면 기한이 없어요.</span></p>' +
      '<p><label><input type="checkbox" id="s_dl"' + (s.deadlineLock === '1' ? ' checked' : '') + '> 마감 시각이 지나면 수정·파일 올리기·제출을 막기</label><br><span class="small muted">끄면 마감 뒤에도 제출은 되지만 진행 현황에 "마감 후 제출"로 표시돼요.</span></p>' +
      '<p><label><input type="checkbox" id="s_ls"' + (s.leaderSubmit !== '0' ? ' checked' : '') + '> 최종 제출은 팀장(프로젝트 매니저)만 할 수 있게 하기</label></p>' +
      '<button class="btn" data-act="save-settings">저장</button></div>' +
      '<div class="card"><h2>구글 시트 안내</h2><p class="small">모든 데이터는 연결된 구글 시트에 있어요. 주요 탭: <b>학생</b>(명단·관심 분야·역할), <b>반상태</b>(조 편성 단계), <b>발표기록</b>(회차별 발표 글), <b>발표평가</b>(AI 초안과 교사 최종본), <b>세특</b>, <b>제출</b>(조별 보고서 한 줄), <b>채점표</b>(학생별 점수), <b>가상채점</b>(규칙 기반 제안과 근거), <b>조채점·개인채점</b>(교사 입력), <b>수정이력</b>(누가 언제 얼마나 썼는지), <b>로그</b>. 이 탭들은 화면에서 자동으로 갱신되니 <b>시트에서 직접 고치지 않는 것</b>을 권해요.</p></div>';
  }


  /* ───────── 차시별 점검 ───────── */
  const LV_TXT = { 1: '참여 미흡', 2: '소극적', 3: '보통', 4: '적극적', 5: '매우 적극적' };
  const CK_TXT = [['ok', '✓ 충족'], ['part', '△ 보완 필요'], ['no', '✗ 미흡'], ['', '점검 전']];
  async function loadSess() { A.sess.data = await call('adminSessions', {}); A.sess.cls = String(A.sess.cls || ''); const have = A.sess.data.teams.some(function (t) { return String(t.cls) === A.sess.cls; }); if (!A.sess.cls || !have) { const f = A.sess.data.teams[0]; A.sess.cls = f ? String(f.cls) : ''; } }
  async function flushSess() { const q = A.sess.q; await Promise.all(Object.keys(q).map(function (k) { return q[k]; })); }

  function sessHtml() {
    const S = A.sess, d = S.data;
    if (!d.teams.length) return '<div class="card"><h2>차시별 점검</h2><p>아직 확정된 조가 없어요. "조 구성" 탭에서 조를 만들어 주세요.</p></div>';
    const classes = Array.from(new Set(d.teams.map(function (t) { return String(t.cls); })));
    const teams = d.teams.filter(function (t) { return !S.cls || String(t.cls) === String(S.cls); });
    let h = '<div class="card"><div class="row"><h2 class="grow" style="margin:0">차시별 점검</h2><select id="sclf" style="width:auto" aria-label="반 선택">' + classes.map(function (c) { return '<option value="' + esc(c) + '"' + (S.cls === c ? ' selected' : '') + '>' + esc(c) + '반</option>'; }).join('') + '</select></div>' +
      '<p class="small muted">수업 중에 학생별 참여도를 누르고, 잘한 점과 질문·고민을 적어 두세요. <b>누르거나 입력하면 바로 저장</b>돼요. 기록은 마지막 "최종 피드백"에서 자동 정리됩니다.' +
      (d.deadline ? '<br>최종 제출 마감: <b>' + esc(d.deadline.at) + '</b> (3차시 ' + esc(d.deadline.baseAt) + ' + ' + d.deadline.hours + '시간' + (d.deadline.lock ? ', 마감 후 수정 잠금' : '') + ')' : '<br>최종 제출 마감이 아직 정해지지 않았어요. "설정" 탭에서 3차시 종료 일시를 입력하면 48시간 뒤가 자동으로 마감돼요.') + '</p>' +
      '<div class="sess-tabs" role="group" aria-label="차시 선택">' + [1, 2, 3].map(function (n) { return '<button data-sub="' + n + '" aria-pressed="' + (S.sub === n) + '">' + n + '차시</button>'; }).join('') + '<button data-sub="fb" aria-pressed="' + (S.sub === 'fb') + '">최종 피드백</button></div>';
    h += S.sub === 'fb' ? fbBody(teams) : sessBody(S.sub, teams);
    return h + '</div>';
  }
  function sessBody(n, teams) {
    const sess = A.sess.data.sessions[n - 1];
    return '<div class="banner info small"><b>' + esc(sess.title) + '</b> · ' + esc(sess.desc) + '</div>' +
      '<p class="small muted">참여도: ' + [5, 4, 3, 2, 1].map(function (k) { return k + ' ' + LV_TXT[k]; }).join(' · ') + ' — <b>기본값은 4(적극적)</b>이에요. 다른 학생만 바꿔 주세요.</p>' + teams.map(function (t) { try { return teamCard(t, n); } catch (e) { return '<div class="banner bad">' + esc(t.cls + '-' + t.no) + '조를 표시하지 못했어요: ' + esc(e.message) + '</div>'; } }).join('');
  }
  function hintHtml(h) { return !h ? '' : (typeof h === 'string' ? esc(h) : '<a href="' + esc(h.url) + '" target="_blank" rel="noopener">코랩 파일 열어 보기 ↗</a>'); }
  function teamCard(t, n) {
    const sess = A.sess.data.sessions[n - 1], tc = t.team[n], hs = (t.hints || {})[n] || {};
    let h = '<details class="card sesscard" open data-tid="' + esc(t.tid) + '" data-n="' + n + '"><summary><b>' + esc(t.cls) + '-' + esc(t.no) + '</b> ' + esc(t.field) +
      ' <span class="badge brand">팀장 ' + esc(t.leaders.join(', ') || '미지정') + '</span> <span class="small muted" data-sum></span><span class="grow"></span><span class="savestate" data-ss></span></summary><div class="sbody">';
    if (sess.checks.length) {
      h += '<h4 style="margin:6px 0 0">점검 항목</h4>' + sess.checks.map(function (c, i) {
        return '<div class="chkrow"><div><b>' + (i + 1) + '.</b> ' + esc(c.label) + '</div><div class="small muted">' + hintHtml(hs['c' + (i + 1)]) + '</div>' +
          '<div class="seg chk" role="radiogroup" aria-label="' + esc(c.short) + '">' + CK_TXT.map(function (o) { return '<label><input type="radio" name="ck_' + esc(t.tid) + '_' + n + '_' + i + '" value="' + o[0] + '"' + (tc.c[i] === o[0] ? ' checked' : '') + '>' + o[1] + '</label>'; }).join('') + '</div></div>';
      }).join('') + (hs.fix ? '<p class="small">팀장이 전달한 수정 완료 코랩: <a href="' + esc(hs.fix) + '" target="_blank" rel="noopener">열어 보기 ↗</a></p>' : '');
    }
    h += '<h4 style="margin:10px 0 0">학생별 참여도와 기록</h4>' + t.members.map(function (m, idx) {
      const r = m.rec[n], nm = 'pl_' + t.tid + '_' + n + '_' + idx;
      return '<div class="stu-grid" data-name="' + esc(m.name) + '"><div><b>' + esc(m.name) + '</b>' + (m.absent ? ' <span class="badge bad">결석</span>' : '') + '<div class="small muted">' + esc(m.roles.join(' · ') || '역할 미지정') + '</div></div><div>' +
        '<div class="seg" role="radiogroup" aria-label="' + esc(m.name) + ' 참여도 5단계">' + [5, 4, 3, 2, 1].map(function (k) { return '<label><input type="radio" name="' + nm + '" value="' + k + '"' + (r.level === k ? ' checked' : '') + '>' + k + ' ' + LV_TXT[k] + '</label>'; }).join('') + '<label title="기록 지우기"><input type="radio" name="' + nm + '" value="0"' + (!r.level ? ' checked' : '') + '>기록 없음</label></div>' +
        '<label class="f small" style="margin-top:6px">잘한 점 · 특이사항 (비고)</label><textarea data-f="note" rows="2" maxlength="1000" placeholder="예) 조원의 질문에 차분히 답하며 역할 분담을 이끌었다.">' + esc(r.note) + '</textarea>' +
        '<label class="f small">적극적으로 질문하거나 고민한 내용</label><textarea data-f="ask" rows="2" maxlength="1500" placeholder="예) 결측치를 평균으로 채워도 되는지 질문함.">' + esc(r.ask) + '</textarea></div></div>';
    }).join('') + '<div style="border-top:1px solid var(--line);padding-top:8px"><label class="f small">조 전체 메모 (이 차시에 대한 총평·특이사항)</label><textarea data-f="memo" rows="2" maxlength="1500">' + esc(tc.memo) + '</textarea></div></div></details>';
    return h;
  }
  function sessSummary(card) {
    const g = $$('.stu-grid', card), done = g.filter(function (x) { const r = x.querySelector('input[type=radio]:checked'); return r && Number(r.value) > 0; }).length;
    const ck = $$('.chkrow', card), ckd = ck.filter(function (x) { const r = x.querySelector('input:checked'); return r && r.value; }).length;
    const el = $('[data-sum]', card); if (el) el.textContent = '· 참여도 ' + done + '/' + g.length + '명' + (ck.length ? ' · 점검 ' + ckd + '/' + ck.length : '');
  }
  function sessPayload(card) {
    const tid = card.dataset.tid, n = Number(card.dataset.n);
    return {
      tid: tid, session: n,
      students: $$('.stu-grid', card).map(function (g) { const r = g.querySelector('input[type=radio]:checked'); return { name: g.dataset.name, level: r ? Number(r.value) : 0, note: g.querySelector('[data-f="note"]').value, ask: g.querySelector('[data-f="ask"]').value }; }),
      checks: [0, 1, 2].map(function (i) { const r = card.querySelector('input[name="ck_' + tid + '_' + n + '_' + i + '"]:checked'); return r ? r.value : ''; }),
      memo: card.querySelector('[data-f="memo"]').value,
    };
  }
  function sessSave(card) {
    sessSummary(card);
    const key = card.dataset.tid + '|' + card.dataset.n, ss = $('[data-ss]', card);
    if (ss) { ss.textContent = '저장 중…'; ss.classList.remove('err'); }
    const run = async function () {
      try { await call('saveSession', sessPayload(card)); if (ss) ss.textContent = '✓ 저장됨 ' + new Date().toTimeString().slice(0, 5); }
      catch (e) { if (ss) { ss.textContent = '저장 실패: ' + e.message; ss.classList.add('err'); } toast(e.message, 'err'); }
    };
    A.sess.q[key] = (A.sess.q[key] || Promise.resolve()).then(run);
    return A.sess.q[key];
  }

  /* 최종 피드백 */
  function fbBody(teams) {
    const S = A.sess;
    return '<p class="small muted">기록한 참여도·중간 점검·보고서 내용을 모아 <b>피드백 초안이 자동으로 만들어져요.</b> 문장을 고친 뒤 <b>공개</b>하면 학생 화면 6단계와 보고서 맨 끝에 나타납니다. 공개 전에는 학생에게 보이지 않아요.</p>' +
      '<div class="row" style="margin-bottom:8px"><button class="btn sm" data-act="fb-pub-all">이 반 전체 공개</button><button class="btn sm ghost" data-act="fb-unpub-all">이 반 전체 비공개</button></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>반-조</th><th>분야</th><th>학생에게</th><th>개인별 내용</th><th></th></tr></thead><tbody>' + teams.map(function (t) {
        return '<tr' + (S.fbTid === t.tid ? ' style="background:var(--brand-l)"' : '') + '><td><b>' + esc(t.cls) + '-' + esc(t.no) + '</b></td><td>' + esc(t.field) + '</td><td>' + (t.fb.published ? '<span class="badge ok">공개 중</span>' : '<span class="badge">비공개</span>') + (t.fb.edited ? ' <span class="badge brand">교사 수정</span>' : '') + '</td><td class="small">' + (t.fb.showIndividual ? '공개' : '비공개') + '</td><td><button class="btn sm ghost" data-fbopen="' + esc(t.tid) + '">미리보기 · 편집</button></td></tr>';
      }).join('') + '</tbody></table></div><div id="fbpane">' + (S.fb ? fbPane() : '') + '</div>';
  }
  function fbPane() {
    const f = A.sess.fb, tm = A.sess.data.teams.filter(function (t) { return t.tid === A.sess.fbTid; })[0];
    return '<div class="card" style="margin-top:14px"><h3>' + esc(tm ? tm.cls + '반 ' + tm.no + '조' : '') + ' 피드백 편집</h3>' +
      '<label class="f" for="fb_overall">총평 (자동 초안을 고쳐 써도 돼요)</label><textarea id="fb_overall" rows="5" maxlength="3000">' + esc(f.overall) + '</textarea>' +
      '<label class="f" for="fb_project">프로젝트 내용 평가 한 줄</label><textarea id="fb_project" rows="3" maxlength="3000">' + esc(f.project.comment) + '</textarea>' +
      '<label class="f" for="fb_note">선생님 한마디 (직접 쓰는 칸, 비워 두면 표시되지 않아요)</label><textarea id="fb_note" rows="3" maxlength="3000">' + esc(f.note) + '</textarea>' +
      '<p><label><input type="checkbox" id="fb_pub"' + (f.published ? ' checked' : '') + '> 학생에게 공개 (학생 화면 6단계 · 보고서 맨 끝)</label><br><label><input type="checkbox" id="fb_ind"' + (f.showIndividual ? ' checked' : '') + '> 개인별 참여도 표와 "잘한 점·질문·고민" 기록도 함께 공개 <span class="small muted">(보고서 링크를 가진 조원 모두가 볼 수 있어요)</span></label></p>' +
      '<div class="row"><button class="btn" data-act="fb-save">저장</button><button class="btn ghost" data-act="fb-reset">자동 초안으로 되돌리기</button></div></div>' +
      '<div style="margin-top:14px">' + PJ.feedbackHtml(f, { admin: true }) + '</div>';
  }
  async function openFb(tid) {
    A.sess.fbTid = tid; A.sess.fb = await call('adminFeedback', { tid: tid });
    $('#main').innerHTML = sessHtml(); const p = $('#fbpane'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function saveFb() {
    const tid = A.sess.fbTid;
    await call('saveFeedback', { tid: tid, overall: $('#fb_overall').value, project: $('#fb_project').value, note: $('#fb_note').value, published: $('#fb_pub').checked, showIndividual: $('#fb_ind').checked });
    toast('피드백을 저장했어요' + ($('#fb_pub').checked ? ' (학생에게 공개 중)' : ' (비공개)'), 'ok');
    await loadSess(); await openFb(tid);
  }
  async function bulkFb(pub) {
    const teams = A.sess.data.teams.filter(function (t) { return !A.sess.cls || String(t.cls) === String(A.sess.cls); });
    if (!confirm(teams.length + '개 조의 피드백을 ' + (pub ? '공개' : '비공개') + '로 바꿀까요?' + (pub ? '\n(자동 초안 그대로 공개돼요. 개인별 내용은 각 조에서 따로 켜야 보여요.)' : ''))) return;
    await call('setFeedbackPublish', { tids: teams.map(function (t) { return t.tid; }), published: pub });
    toast('바꿨어요', 'ok'); await loadSess(); $('#main').innerHTML = sessHtml();
  }

  /* ───────── 이벤트 ───────── */
  async function onClick(e) {
    const t2 = e.target.closest('[data-t2]'); if (t2) return go(t2.dataset.t2);
    if (A.v2tab && PJ.adminV2.click(A.v2tab, e)) return;
    const sb = e.target.closest('[data-sub]'); if (sb) return guard(async function () { await flushSess(); A.sess.sub = sb.dataset.sub === 'fb' ? 'fb' : Number(sb.dataset.sub); await loadSess(); $('#main').innerHTML = sessHtml(); })();
    const fo = e.target.closest('[data-fbopen]'); if (fo) return guard(function () { return openFb(fo.dataset.fbopen); })();
    const op = e.target.closest('[data-open]'); if (op) { A.team = { team: { tid: op.dataset.open } }; return go('score').then(function () { const s = $('#tsel'); if (s) s.value = op.dataset.open; }); }
    const vw = e.target.closest('[data-view]'); if (vw) { window.open('index.html?view=' + encodeURIComponent(vw.dataset.view), '_blank'); return; }   // noopener 를 쓰지 않아야 관리자 로그인 정보가 새 탭에 전달돼요
    const ro = e.target.closest('[data-reopen]'); if (ro) { if (!confirm('이 조가 다시 수정할 수 있게 할까요? (보고서 링크는 그대로 유지돼요)')) return; return guard(async function () { await call('reopenTeam', { tid: ro.dataset.reopen }); toast('수정을 허용했어요', 'ok'); go('overview'); })(); }
    const us = e.target.closest('[data-use]'); if (us) { const r = $('input[name="lv_' + us.dataset.use + '"][value="' + us.dataset.v + '"]'); if (r) { r.checked = true; $$('.lv', us.closest('.vs')).forEach(function (l) { l.classList.toggle('sel', l.contains(r)); }); } return; }
    const ss = e.target.closest('[data-save-stu]'); if (ss) return saveStu(Number(ss.dataset.saveStu));
    const pr = e.target.closest('[data-pwreset]'); if (pr) { if (!confirm(pr.dataset.nm + ' 학생의 비밀번호를 초기화할까요?\n학생이 다음에 로그인할 때 새 비밀번호를 정하게 돼요.')) return; return guard(async function () { await call('resetStudentPw', { sid: pr.dataset.pwreset }); toast('초기화했어요', 'ok'); A.rosterList = await call('rosterList'); $('#main').innerHTML = rosterHtml(); })(); }
    const rm = e.target.closest('[data-rmstu]'); if (rm) { if (!confirm(rm.dataset.nm + ' 학생을 명단에서 지울까요?')) return; return guard(async function () { await call('removeStudent', { sid: rm.dataset.rmstu }); toast('지웠어요', 'ok'); A.rosterList = await call('rosterList'); $('#main').innerHTML = rosterHtml(); })(); }
    const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('복사했어요', 'ok'); } catch (x) { toast('복사하지 못했어요', 'err'); } return; }
    const ac = e.target.closest('[data-act]'); if (!ac) return;
    const act = ac.dataset.act;
    if (act === 'refresh') return go('overview');
    if (act === 'fb-save') return guard(saveFb)();
    if (act === 'fb-pub-all') return guard(function () { return bulkFb(true); })();
    if (act === 'fb-unpub-all') return guard(function () { return bulkFb(false); })();
    if (act === 'fb-reset') { const f = A.sess.fb; $('#fb_overall').value = f.auto.overall; $('#fb_project').value = f.auto.comment; toast('자동 초안으로 되돌렸어요. 저장을 눌러야 반영돼요.', 'ok'); return; }
    if (act === 'save-team') return saveTeam();
    if (act === 'psend') return peerSend();
    if (act === 'rparse-paste') { const v = $('#rpaste').value; if (!v.trim()) return; return previewRoster(PJ.parseTable(v)); }
    if (act === 'pparse-paste') { const v = $('#ppaste').value; if (!v.trim()) return; return peerMap(PJ.parseTable(v)); }
    if (act === 'rsend') return guard(async function () {
      const U = A.rosterUp; if (!U || U.result) return;
      U.result = await call('importClassRoster', { cls: U.cls, rows: U.rows });
      A.rosterList = await call('rosterList'); $('#main').innerHTML = rosterHtml();
    })();
    if (act === 'vall') return guard(async function () { const r = await call('runVirtualAll'); toast(r.teams + '개 조의 가상 채점을 "가상채점" 시트에 기록했어요', 'ok'); })();
    if (act === 'tcsv') return PJ.downloadCsv('채점표.csv', [A.table.headers].concat(A.table.rows.map(function (r) { return A.table.headers.map(function (h) { return r[h]; }); })));
    if (act === 'save-settings') return guard(async function () { const r = await call('saveSettings', { schoolName: $('#s_school').value, baseScore: $('#s_base').value, siteUrl: $('#s_url').value, session3At: $('#s_s3').value, pptDue: $('#s_pd').value, deadlineHours: $('#s_dh').value, deadlineLock: $('#s_dl').checked, leaderSubmit: $('#s_ls').checked, seteukLen: $('#s_sl').value }); A.ov.settings = r.settings; toast('저장했어요', 'ok'); })();
  }
  async function onChange(e) {
    if (A.v2tab && PJ.adminV2.change(A.v2tab, e)) return;
    const sc = e.target.closest('.sesscard'); if (sc) return sessSave(sc);
    if (e.target.id === 'sclf') return guard(async function () { await flushSess(); A.sess.cls = String(e.target.value); A.sess.fbTid = ''; A.sess.fb = null; $('#main').innerHTML = sessHtml(); })();
    if (e.target.id === 'ptg' && A.peer) { const h = A.peer.head[Number(e.target.value)] || ''; const r = $('input[name="pkey"][value="' + (/이름|성명/.test(h) ? 'name' : 'sid') + '"]'); if (r) r.checked = true; return; }
    if (e.target.id === 'clsf') { A.filter = e.target.value; $('#main').innerHTML = overviewHtml(); return; }
    if (e.target.id === 'tsel') return guard(function () { return loadTeam(e.target.value); })();
    if (e.target.name && e.target.name.indexOf('lv_') === 0) { $$('.lv', e.target.closest('.vs')).forEach(function (l) { l.classList.toggle('sel', l.contains(e.target)); }); return; }
    if (e.target.id === 'rfile' && e.target.files[0]) return guard(async function () { previewRoster(await PJ.readTableFile(e.target.files[0])); })();
    if (e.target.classList.contains('memo') && e.target.dataset.sid) return guard(async function () { await call('setStudent', { sid: e.target.dataset.sid, memo: e.target.value }); toast('메모 저장', 'ok'); })();
    if (e.target.id === 'pfile' && e.target.files[0]) return guard(async function () { peerMap(await PJ.readTableFile(e.target.files[0])); })();
  }

  boot();
})();

/**
 * v2 추가 기능 — Code.gs 와 같은 Apps Script 프로젝트에 함께 넣는다.
 *
 *   A. 반별 명단 · 개인 비밀번호 로그인
 *   B. 관심 분야 입력 → AI 조 편성안 → 교사 조정 · 공개 → 역할 선택 → 조 확정 · 학생 이동
 *   C. 발표 기록(실시간 STT 결과 저장)
 *   D. AI 초안 3단계: 1차 피드백 정리 → 2차 변화 서술 → 세특
 *   E. AI 호출(Gemini 또는 Claude) · 가명 처리
 *
 * 이 파일의 맨 위(함수 밖)에서는 Code.gs 의 이름을 쓰지 않는다. 파일 실행 순서가 정해져 있지 않기 때문이다.
 */

const V2 = {
  TEAM_MAX: 5,                       // 한 조 최대 인원
  ROLE_CAP: { '데이터 엔지니어': 3 },   // 적혀 있지 않은 역할은 조당 1명
  MAX_ROLES: 2,                      // 학생 1명이 고를 수 있는 역할 수
  SEGS: ['발표', '질의응답', '피드백'],
  ROUNDS: [1, 2],
  ITEMS: [
    { id: 'explain', label: '설명 방법' },
    { id: 'theory', label: '이론 내용' },
    { id: 'practice', label: '실기 내용' },
    { id: 'slides', label: '발표 자료 구성' },
  ],
  IMPROVE: { id: 'improve', label: '개선도' },
  SETEUK_LEN: 300,
  STAGES: { '': '관심 분야 입력 중', '마감': '입력 마감 · 조 편성 중', '공개': '조 공개 · 역할 선택 중', '확정': '조 확정' },
};

function v2Schema_() {
  return { teamMax: V2.TEAM_MAX, roleCap: V2.ROLE_CAP, maxRoles: V2.MAX_ROLES, segs: V2.SEGS, items: V2.ITEMS, improve: V2.IMPROVE, stages: V2.STAGES, seteukLen: seteukLen_() };
}
function roleCap_(role) { return V2.ROLE_CAP[role] || 1; }
function seteukLen_() { const n = Number(settings_().seteukLen); return n >= 50 && n <= 1000 ? n : V2.SETEUK_LEN; }
function cleanSid_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function jsonOr_(s, d) { try { const v = JSON.parse(s || ''); return v == null ? d : v; } catch (e) { return d; } }

/* ════════════════ A. 명단 · 로그인 ════════════════ */

function pwHash2_(pw, salt) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(pw))); }

function studentBySid_(sid) { return readAll_('students').filter(function (r) { return String(r['학번']) === String(sid); })[0] || null; }

function studentToken_(stu) {
  return signToken_({ k: 's', sid: String(stu['학번']), n: stu['이름'], exp: Date.now() + SESSION_HOURS.s * 3600 * 1000 });
}

// 로그인: 학번 + 이름 (+ 비밀번호). 비밀번호를 아직 정하지 않은 학생에게는 needPw 를 돌려준다.
function login2_(p) {
  const sid = cleanSid_(p.sid), name = String(p.name || '').trim(), pw = String(p.pw || '');
  if (!sid || !name) throw fail_('BAD_INPUT', '학번과 이름을 입력해 주세요.');
  if (failCount_('s' + sid) >= 5) throw fail_('LOCKED_OUT', '여러 번 틀려서 10분 동안 로그인할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
  const generic = fail_('LOGIN_FAIL', '학번, 이름 또는 비밀번호가 올바르지 않습니다.');
  const stu = studentBySid_(sid);
  if (!stu || stu['이름'] !== name) { failAdd_('s' + sid); throw fail_('LOGIN_FAIL', '명단에서 학번과 이름을 찾지 못했어요. 띄어쓰기와 학번을 확인하고, 계속 안 되면 선생님께 말씀드려 주세요.'); }
  if (!stu['비번해시']) return { needPw: true };
  if (!pw) throw fail_('BAD_INPUT', '비밀번호를 입력해 주세요.');
  if (!safeEq_(pwHash2_(pw, stu['비번솔트']), stu['비번해시'])) { failAdd_('s' + sid); log_(sid + ' ' + name, '로그인 실패', ''); throw generic; }
  failClear_('s' + sid);
  log_(sid + ' ' + name, '로그인', stu['팀ID'] || '');
  return { token: studentToken_(stu) };
}

// 첫 로그인: 비밀번호 직접 정하기 (이미 정한 학생은 교사가 초기화해야 다시 정할 수 있다)
function setPassword2_(p) {
  const sid = cleanSid_(p.sid), name = String(p.name || '').trim(), pw = String(p.newPw || '');
  if (!sid || !name) throw fail_('BAD_INPUT', '학번과 이름을 입력해 주세요.');
  if (pw.length < 4 || pw.length > 20) throw fail_('BAD_INPUT', '비밀번호는 4~20자로 정해 주세요.');
  if (failCount_('s' + sid) >= 5) throw fail_('LOCKED_OUT', '여러 번 틀려서 10분 동안 로그인할 수 없어요.');
  return withLock_(function () {
    const stu = studentBySid_(sid);
    if (!stu || stu['이름'] !== name) { failAdd_('s' + sid); throw fail_('LOGIN_FAIL', '명단에서 학번과 이름을 찾지 못했어요.'); }
    if (stu['비번해시']) throw fail_('PW_EXISTS', '이미 비밀번호를 정했어요. 잊어버렸다면 선생님께 초기화를 부탁해 주세요.');
    const salt = Utilities.getUuid().slice(0, 12);
    writeRow_('students', stu._row, { 비번솔트: salt, 비번해시: pwHash2_(pw, salt) });
    log_(sid + ' ' + name, '비밀번호 설정', '');
    return { token: studentToken_(stu) };
  });
}

// 모든 학생 요청에서: 토큰의 학번으로 지금 속한 반·조를 찾는다
function studentAuth_(tok, needTeam) {
  if (!tok.sid) throw fail_('BAD_TOKEN', '다시 로그인해 주세요.');
  const stu = studentBySid_(tok.sid);
  if (!stu || stu['이름'] !== tok.n) throw fail_('BAD_TOKEN', '명단 정보가 바뀌었어요. 다시 로그인해 주세요.');
  const auth = { k: 's', sid: String(stu['학번']), n: stu['이름'], cls: String(stu['반']), tid: String(stu['팀ID'] || '') };
  if (needTeam) {
    if (!auth.tid) throw fail_('NO_TEAM', '아직 조가 정해지지 않았어요.');
    if (teamById_(auth.tid)['상태'] === '조구성') throw fail_('TEAM_FORMING', '조 확정 전이에요. 선생님이 조를 확정하면 활동지가 열려요.');
  }
  return auth;
}

/* ---- 관리자: 반별 명단 ---- */
function importClassRoster_(p) {
  const clsN = parseInt(p.cls, 10), rows = Array.isArray(p.rows) ? p.rows : [];
  if (!(clsN >= 1 && clsN <= 99)) throw fail_('BAD_INPUT', '반 번호를 올바르게 입력해 주세요.');
  if (!rows.length || rows.length > 60) throw fail_('BAD_INPUT', '명단이 비어 있거나 너무 많습니다(최대 60명).');
  const cls = String(clsN);
  return withLock_(function () {
    const stud = readAll_('students'), res = { added: 0, updated: 0, skipped: [], warnings: [], notInList: [] }, seen = {};
    rows.forEach(function (r) {
      const sid = cleanSid_(r.sid), nm = String(r.name || '').trim().slice(0, 20);
      if (!sid || !nm) { if (sid || nm) res.skipped.push((nm || '') + '(' + (sid || '학번 없음') + ')'); return; }
      if (sid.length < 3 || sid.length > 10) { res.skipped.push(nm + '(' + sid + '): 학번은 숫자 3~10자리'); return; }
      if (seen[sid]) { res.warnings.push('학번 ' + sid + '이(가) 명단에 두 번 있어요: ' + seen[sid] + ', ' + nm); return; }
      seen[sid] = nm;
      if (sid.length === 5 && Number(sid.slice(1, 3)) !== clsN) res.warnings.push(nm + ': 학번 ' + sid + '의 반 자리가 ' + cls + '반과 달라요.');
      const ex = stud.filter(function (s) { return String(s['학번']) === sid; })[0];
      if (ex) {
        if (String(ex['반']) !== cls && ex['팀ID']) { res.warnings.push(nm + '(' + sid + ')은(는) 이미 ' + ex['반'] + '반 조에 속해 있어 반을 바꾸지 않았어요.'); return; }
        writeRow_('students', ex._row, { 이름: nm, 반: cls });
        res.updated++;
      } else {
        appendObj_('students', { 팀ID: '', 반: cls, 조: '', 학번: sid, 이름: nm, 역할: '', 결석: '', 메모: '' });
        res.added++;
      }
    });
    stud.filter(function (s) { return String(s['반']) === cls && !seen[String(s['학번'])]; }).forEach(function (s) { res.notInList.push(s['이름'] + '(' + s['학번'] + ')'); });
    log_('관리자', '반 명단 업로드', cls + '반 추가 ' + res.added + ', 수정 ' + res.updated);
    return res;
  });
}

function rosterList_(p) {
  const st = classStates_(), out = {};
  readAll_('students').forEach(function (s) {
    const c = String(s['반']);
    (out[c] = out[c] || []).push({ sid: String(s['학번']), name: s['이름'], tid: String(s['팀ID'] || ''), no: String(s['조'] || ''), roles: rolesOf_(s), hasPw: !!s['비번해시'], interest: String(s['관심분야'] || ''), memo: String(s['메모'] || ''), absent: String(s['결석']) === 'Y' });
  });
  const classes = Object.keys(out).sort(function (a, b) { return Number(a) - Number(b); }).map(function (c) {
    out[c].sort(function (a, b) { return a.sid < b.sid ? -1 : 1; });
    return { cls: c, stage: st[c] ? st[c]['단계'] : '', students: out[c] };
  });
  return { classes: classes, stages: V2.STAGES };
}

function setStudent2_(p) {
  return withLock_(function () {
    const s = studentBySid_(cleanSid_(p.sid));
    if (!s) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    const upd = {};
    if (p.memo !== undefined) upd['메모'] = String(p.memo).slice(0, 200);
    if (p.name !== undefined) { const nm = String(p.name).trim().slice(0, 20); if (!nm) throw fail_('BAD_INPUT', '이름을 입력해 주세요.'); if (s['팀ID'] && nm !== s['이름']) throw fail_('BAD_INPUT', '조에 들어간 학생은 이름을 바꿀 수 없어요(활동 기록이 이름으로 연결되어 있어요).'); upd['이름'] = nm; }
    writeRow_('students', s._row, upd);
    return { ok: true };
  });
}

function resetStudentPw_(p) {
  return withLock_(function () {
    const s = studentBySid_(cleanSid_(p.sid));
    if (!s) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    writeRow_('students', s._row, { 비번해시: '', 비번솔트: '' });
    failClear_('s' + s['학번']);
    log_('관리자', '비밀번호 초기화', s['학번'] + ' ' + s['이름']);
    return { ok: true };
  });
}

function removeStudent_(p) {
  return withLock_(function () {
    const stud = readAll_('students'), s = stud.filter(function (x) { return String(x['학번']) === cleanSid_(p.sid); })[0];
    if (!s) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    if (s['팀ID']) throw fail_('HAS_TEAM', '이미 조에 들어간 학생은 지울 수 없어요. 먼저 다른 조로 옮기거나 그대로 두세요.');
    rewrite_('students', stud.filter(function (x) { return x !== s; }));
    log_('관리자', '학생 삭제', s['학번'] + ' ' + s['이름']);
    return { ok: true };
  });
}

/* ════════════════ B. 관심 분야 · 조 편성 ════════════════ */

function classStates_() { const m = {}; readAll_('classes').forEach(function (r) { m[String(r['반'])] = r; }); return m; }
function classState_(cls) { return classStates_()[String(cls)] || null; }
function setClassState_(cls, o) {
  const ex = classState_(cls);
  o['수정일시'] = now_();
  if (ex) writeRow_('classes', ex._row, o); else appendObj_('classes', Object.assign({ 반: String(cls), 단계: '' }, o));
}
function stageOf_(cls) { const r = classState_(cls); return r ? String(r['단계'] || '') : ''; }

// 학생 첫 화면: 지금 무엇을 해야 하는지
function myStatus_(p, auth) {
  const stu = studentBySid_(auth.sid), stage = stageOf_(auth.cls);
  const out = { me: { sid: auth.sid, name: auth.n, cls: auth.cls, interest: String(stu['관심분야'] || ''), interestAt: String(stu['관심분야수정'] || '') }, stage: stage, stageText: V2.STAGES[stage] || '', roles: ROLES, roleCap: ROLES.reduce(function (a, r) { a[r] = roleCap_(r); return a; }, {}), maxRoles: V2.MAX_ROLES };
  if (auth.tid) {
    const t = teamById_(auth.tid);
    out.team = { tid: auth.tid, no: String(t['조']), field: String(t['분야']), status: t['상태'], members: membersOf_(auth.tid).map(function (m) { return { name: m['이름'], roles: rolesOf_(m), me: String(m['학번']) === auth.sid }; }) };
  }
  return out;
}

function saveInterest_(p, auth) {
  const text = clip_(p.text, 300);
  if (!text) throw fail_('BAD_INPUT', '진로나 관심 분야를 적어 주세요.');
  return withLock_(function () {
    if (stageOf_(auth.cls) !== '') throw fail_('CLOSED', '관심 분야 입력이 마감되었어요. 고쳐야 한다면 선생님께 말씀드려 주세요.');
    const stu = studentBySid_(auth.sid);
    writeRow_('students', stu._row, { 관심분야: text, 관심분야수정: now_() });
    return { ok: true, interest: text };
  });
}

// 역할 규칙 검사: roles 를 고른 뒤의 상태가 규칙을 지키는지 (members: 같은 조 학생 행들, who: 바꾸는 학생 행)
function checkRoles_(members, who, roles) {
  if (roles.length > V2.MAX_ROLES) throw fail_('ROLE_MAX', '역할은 한 사람당 ' + V2.MAX_ROLES + '개까지 고를 수 있어요.');
  roles.forEach(function (r) {
    if (ROLES.indexOf(r) < 0) throw fail_('BAD_ROLE', '알 수 없는 역할입니다.');
    const others = members.filter(function (m) { return m !== who && rolesOf_(m).indexOf(r) >= 0; }).length;
    if (others + 1 > roleCap_(r)) throw fail_('ROLE_FULL', '"' + r + '" 자리는 이미 찼어요' + (roleCap_(r) > 1 ? '(최대 ' + roleCap_(r) + '명)' : '') + '.');
  });
}

// 학생: 자기 이름을 역할 칸에 넣기/빼기 (조 공개 후 ~ 확정 전)
function pickRole_(p, auth) {
  const role = String(p.role || '');
  if (ROLES.indexOf(role) < 0) throw fail_('BAD_ROLE', '알 수 없는 역할입니다.');
  return withLock_(function () {
    const a2 = studentAuth_({ sid: auth.sid, n: auth.n }, false);
    if (!a2.tid) throw fail_('NO_TEAM', '아직 조가 공개되지 않았어요.');
    const team = teamById_(a2.tid);
    if (team['상태'] !== '조구성') throw fail_('CONFIRMED', '조가 확정되어 역할을 바꿀 수 없어요. 바꿔야 한다면 선생님께 말씀드려 주세요.');
    const members = membersOf_(a2.tid), me = members.filter(function (m) { return String(m['학번']) === auth.sid; })[0];
    let roles = rolesOf_(me);
    if (p.on) { if (roles.indexOf(role) < 0) { checkRoles_(members, me, roles.concat([role])); roles.push(role); } }
    else roles = roles.filter(function (r) { return r !== role; });
    writeRow_('students', me._row, { 역할: roles.join(',') });
    me['역할'] = roles.join(',');
    return myStatus_({}, a2);
  });
}

/* ---- 관리자: 조 편성 화면 ---- */
function formation_(p) {
  const states = classStates_(), stud = readAll_('students'), teams = readAll_('teams');
  const classes = {};
  stud.forEach(function (s) { const c = String(s['반']); classes[c] = classes[c] || { cls: c, n: 0, interest: 0 }; classes[c].n++; if (String(s['관심분야']).trim()) classes[c].interest++; });
  const list = Object.keys(classes).sort(function (a, b) { return Number(a) - Number(b); }).map(function (c) { const o = classes[c]; o.stage = states[c] ? String(states[c]['단계'] || '') : ''; return o; });
  const cls = p.cls ? String(parseInt(p.cls, 10)) : (list[0] ? list[0].cls : '');
  const out = { classes: list, cls: cls, stages: V2.STAGES, aiReady: !!aiProvider_(), roles: ROLES, roleCap: ROLES.reduce(function (a, r) { a[r] = roleCap_(r); return a; }, {}), maxRoles: V2.MAX_ROLES, teamMax: V2.TEAM_MAX };
  if (!cls) return out;
  const st = states[cls];
  out.stage = st ? String(st['단계'] || '') : '';
  out.students = stud.filter(function (s) { return String(s['반']) === cls; }).sort(function (a, b) { return String(a['학번']) < String(b['학번']) ? -1 : 1; })
    .map(function (s) { return { sid: String(s['학번']), name: s['이름'], interest: String(s['관심분야'] || ''), interestAt: String(s['관심분야수정'] || ''), hasPw: !!s['비번해시'], tid: String(s['팀ID'] || ''), no: String(s['조'] || ''), roles: rolesOf_(s) }; });
  out.draft = st ? jsonOr_(st['분류안'], null) : null;
  const st2 = settings_();
  out.teams = teams.filter(function (t) { return String(t['반']) === cls; }).sort(sortTeams_).map(function (t) {
    const ms = out.students.filter(function (s) { return s.tid === t['팀ID']; });
    const empty = ROLES.filter(function (r) { return !ms.some(function (m) { return m.roles.indexOf(r) >= 0; }); });
    return { tid: t['팀ID'], no: String(t['조']), field: String(t['분야']), status: t['상태'], members: ms, emptyRoles: empty, noLeader: teamNoLeader_(t, stud.filter(function (s) { return s['팀ID'] === t['팀ID']; }), st2), noRole: ms.filter(function (m) { return !m.roles.length; }).map(function (m) { return m.name; }) };
  });
  return out;
}

function closeInterest_(p) {
  const cls = String(parseInt(p.cls, 10));
  return withLock_(function () {
    const stage = stageOf_(cls);
    if (p.closed) { if (stage !== '') throw fail_('BAD_STAGE', '이미 마감되었어요.'); setClassState_(cls, { 단계: '마감' }); }
    else { if (stage !== '마감') throw fail_('BAD_STAGE', '조를 공개한 뒤에는 입력을 다시 열 수 없어요.'); setClassState_(cls, { 단계: '' }); }
    log_('관리자', p.closed ? '관심 분야 마감' : '관심 분야 다시 열기', cls + '반');
    return formation_({ cls: cls });
  });
}

// 묶음 수 = 한 조 최대 인원으로 나눈 올림 (26~30명 → 6개, 31~35명 → 7개)
function groupCount_(n) { return Math.max(1, Math.ceil(n / V2.TEAM_MAX)); }

// AI 조 편성안 만들기 (preview: 보내는 내용만 보여 주기)
function aiGroup_(p) {
  const cls = String(parseInt(p.cls, 10));
  if (stageOf_(cls) !== '마감') throw fail_('BAD_STAGE', '먼저 관심 분야 입력을 마감해 주세요.');
  const stud = readAll_('students').filter(function (s) { return String(s['반']) === cls; });
  if (!stud.length) throw fail_('BAD_INPUT', '이 반의 명단이 없어요.');
  const ali = aliases_(stud.map(function (s) { return { sid: String(s['학번']), name: s['이름'] }; }));
  const k = groupCount_(stud.length);
  const lines = stud.map(function (s) { const a = ali.bySid[String(s['학번'])]; return a + ': ' + (ali.mask(String(s['관심분야'] || '').trim()) || '(입력 없음)'); });
  const system = '당신은 고등학교 1학년 인공지능 기초 수업의 모둠 편성을 돕는 조교입니다. 학생들이 적은 진로·관심 분야를 읽고, 비슷한 분야끼리 묶어 모둠을 만듭니다. 모둠마다 학생들이 공감할 수 있는 짧은 분야 이름(예: 의료·보건, 환경·에너지)을 붙입니다.';
  const user = '아래 ' + stud.length + '명을 정확히 ' + k + '개 모둠으로 나누세요.\n' +
    '규칙:\n- 모든 학생을 정확히 한 모둠에 넣습니다.\n- 한 모둠은 최대 ' + V2.TEAM_MAX + '명이고, 모둠별 인원은 최대한 고르게 맞춥니다.\n' +
    '- 관심 분야가 비슷한 학생끼리 묶습니다. 인기 분야에 사람이 몰리면 가장 가까운 다른 분야로 보냅니다.\n' +
    '- 관심 분야가 비었거나 "모르겠음"처럼 분명하지 않은 학생은 인원이 남는 모둠에 넣고 unclear 목록에도 적습니다.\n' +
    '- 학생은 아래 코드(학생01 등)로만 적습니다.\n\n' + lines.join('\n');
  if (p.preview) return { preview: { system: system, user: user } };
  const schema = { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } }, required: ['name', 'members'], additionalProperties: false } }, unclear: { type: 'array', items: { type: 'string' } } }, required: ['groups', 'unclear'], additionalProperties: false };
  const r = ai_(system, user, schema, { effort: 'low', purpose: cls + '반 조 편성' });
  const groups = repairGroups_(r.groups || [], Object.keys(ali.byAlias), k).map(function (g, i) {
    return { no: i + 1, name: clip_(g.name, 40) || ('분야 ' + (i + 1)), sids: g.members.map(function (a) { return ali.byAlias[a]; }) };
  });
  const unclear = (r.unclear || []).map(function (a) { return ali.byAlias[a]; }).filter(Boolean);
  return withLock_(function () {
    if (stageOf_(cls) !== '마감') throw fail_('BAD_STAGE', '조 편성 단계가 아니에요.');
    setClassState_(cls, { 분류안: JSON.stringify({ groups: groups, unclear: unclear, by: 'AI', at: now_() }) });
    log_('관리자', 'AI 조 편성안', cls + '반 ' + groups.length + '개');
    return formation_({ cls: cls });
  });
}

// AI 결과를 규칙에 맞게 다듬는다: 없는 코드 제거, 중복 제거, 빠진 학생 추가, 5명 초과분 이동
function repairGroups_(groups, all, k) {
  const used = {}, out = groups.slice(0, Math.max(k, groups.length)).map(function (g) {
    const ms = [];
    (g.members || []).forEach(function (a) { a = String(a).trim(); if (all.indexOf(a) >= 0 && !used[a]) { used[a] = 1; ms.push(a); } });
    return { name: g.name, members: ms };
  });
  while (out.length < k) out.push({ name: '', members: [] });
  const extra = all.filter(function (a) { return !used[a]; });
  out.forEach(function (g) { while (g.members.length > V2.TEAM_MAX) extra.push(g.members.pop()); });
  extra.forEach(function (a) {
    let t = out.filter(function (g) { return g.members.length < V2.TEAM_MAX; }).sort(function (x, y) { return x.members.length - y.members.length; })[0];
    if (!t) { t = { name: '', members: [] }; out.push(t); }
    t.members.push(a);
  });
  return out.filter(function (g) { return g.members.length; });
}

// 교사가 편성안을 고침 (공개 전)
function saveGroups_(p) {
  const cls = String(parseInt(p.cls, 10)), groups = Array.isArray(p.groups) ? p.groups : [];
  return withLock_(function () {
    if (stageOf_(cls) !== '마감') throw fail_('BAD_STAGE', '공개 전(마감 상태)에만 편성안을 고칠 수 있어요.');
    const sids = {}; readAll_('students').forEach(function (s) { if (String(s['반']) === cls) sids[String(s['학번'])] = 1; });
    const seen = {}, out = [];
    groups.forEach(function (g, i) {
      const ms = (g.sids || []).map(cleanSid_).filter(function (x) { return sids[x] && !seen[x]; });
      ms.forEach(function (x) { seen[x] = 1; });
      if (ms.length > V2.TEAM_MAX) throw fail_('TOO_MANY', '"' + (g.name || (i + 1) + '번') + '" 묶음이 ' + ms.length + '명이에요. 한 조는 최대 ' + V2.TEAM_MAX + '명입니다.');
      out.push({ no: out.length + 1, name: clip_(g.name, 40) || ('분야 ' + (out.length + 1)), sids: ms });
    });
    const prev = jsonOr_((classState_(cls) || {})['분류안'], {});
    setClassState_(cls, { 분류안: JSON.stringify({ groups: out, unclear: (prev.unclear || []).filter(function (x) { return sids[x]; }), by: prev.by === 'AI' ? 'AI+교사' : '교사', at: now_() }) });
    return formation_({ cls: cls });
  });
}

// 학생에게 공개: 묶음마다 조를 만들고 학생을 넣는다 (역할은 비운 채)
function publishGroups_(p) {
  const cls = String(parseInt(p.cls, 10));
  return withLock_(function () {
    if (stageOf_(cls) !== '마감') throw fail_('BAD_STAGE', '공개할 수 있는 단계가 아니에요.');
    const draft = jsonOr_((classState_(cls) || {})['분류안'], null);
    if (!draft || !draft.groups || !draft.groups.length) throw fail_('NO_DRAFT', '먼저 조 편성안을 만들어 주세요.');
    const stud = readAll_('students'), mine = stud.filter(function (s) { return String(s['반']) === cls; });
    const placed = {}; draft.groups.forEach(function (g) { g.sids.forEach(function (x) { placed[x] = 1; }); });
    const left = mine.filter(function (s) { return !placed[String(s['학번'])]; });
    if (left.length) throw fail_('UNPLACED', '아직 조에 넣지 않은 학생이 있어요: ' + left.map(function (s) { return s['이름']; }).join(', '));
    if (readAll_('teams').some(function (t) { return String(t['반']) === cls; })) throw fail_('EXISTS', '이 반에는 이미 조가 있어요.');
    const at = now_();
    draft.groups.forEach(function (g, i) {
      const no = String(i + 1), tid = teamId_(cls, no);
      appendObj_('teams', { 팀ID: tid, 반: cls, 조: no, 분야: g.name, 상태: '조구성', 변경번호: 0, 진행률: 0, 생성일시: at });
      g.sids.forEach(function (x) { const s = mine.filter(function (m) { return String(m['학번']) === x; })[0]; s['팀ID'] = tid; s['조'] = no; s['역할'] = ''; });
    });
    rewrite_('students', stud);
    setClassState_(cls, { 단계: '공개', 공개일시: at });
    log_('관리자', '조 공개', cls + '반 ' + draft.groups.length + '개 조');
    return formation_({ cls: cls });
  });
}

function confirmTeams_(p) {
  const cls = String(parseInt(p.cls, 10));
  return withLock_(function () {
    if (stageOf_(cls) !== '공개') throw fail_('BAD_STAGE', '조가 공개된 상태에서만 확정할 수 있어요.');
    readAll_('teams').forEach(function (t) { if (String(t['반']) === cls && t['상태'] === '조구성') writeRow_('teams', t._row, { 상태: '작성중' }); });
    setClassState_(cls, { 단계: '확정', 확정일시: now_() });
    log_('관리자', '조 확정', cls + '반');
    return formation_({ cls: cls });
  });
}

// 교사: 역할 직접 지정 (규칙은 학생과 같다)
function setRoles_(p) {
  const roles = (Array.isArray(p.roles) ? p.roles : []).map(String).filter(function (r, i, a) { return a.indexOf(r) === i; });
  return withLock_(function () {
    const s = studentBySid_(cleanSid_(p.sid));
    if (!s || !s['팀ID']) throw fail_('NOT_FOUND', '조에 속한 학생을 찾을 수 없습니다.');
    const members = membersOf_(s['팀ID']), me = members.filter(function (m) { return String(m['학번']) === String(s['학번']); })[0];
    checkRoles_(members, me, roles);
    writeRow_('students', me._row, { 역할: roles.join(',') });
    const team = teamById_(s['팀ID']);
    if (team['상태'] !== '조구성') commitTeam_(team, '관리자', contentOf_(s['팀ID']), membersOf_(s['팀ID']));
    log_('관리자', '역할 지정', s['학번'] + ' ' + s['이름'] + ': ' + roles.join(','));
    return formation_({ cls: s['반'] });
  });
}

// 교사: 학생을 다른 조로 옮기기 (언제든). 역할은 비우고, 개인 기록은 학생을 따라간다.
function moveStudent_(p) {
  return withLock_(function () {
    const stud = readAll_('students'), s = stud.filter(function (x) { return String(x['학번']) === cleanSid_(p.sid); })[0];
    if (!s) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    const from = String(s['팀ID'] || ''), to = String(p.toTid || '');
    if (!from) throw fail_('NO_TEAM', '아직 조에 들어가지 않은 학생입니다.');
    if (from === to) return formation_({ cls: s['반'] });
    const target = teamById_(to);
    if (String(target['반']) !== String(s['반'])) throw fail_('BAD_INPUT', '같은 반의 조로만 옮길 수 있어요.');
    const tm = stud.filter(function (x) { return x['팀ID'] === to; });
    if (tm.length >= V2.TEAM_MAX) throw fail_('TEAM_FULL', target['조'] + '조는 이미 ' + V2.TEAM_MAX + '명이에요.');
    if (tm.some(function (x) { return x['이름'] === s['이름']; })) throw fail_('DUP_NAME', '옮길 조에 이름이 같은 학생이 있어 옮길 수 없어요(활동 기록이 이름으로 구분돼요).');
    const nm = s['이름'];
    s['팀ID'] = to; s['조'] = String(target['조']); s['역할'] = '';
    rewrite_('students', stud);
    // 개인 기록(나의 기여 등 '항목@이름')을 새 조로 옮긴다. 조가 함께 쓴 내용은 원래 조에 남는다.
    let moved = 0;
    readAll_('content').forEach(function (r) {
      if (r['팀ID'] === from && String(r['필드']).split('@')[1] === nm) { writeRow_('content', r._row, { 팀ID: to, 키: to + '|' + r['필드'] }); moved++; }
    });
    ['checks', 'sscore'].forEach(function (k) { readAll_(k).forEach(function (r) { if (r['팀ID'] === from && r['이름'] === nm) writeRow_(k, r._row, { 팀ID: to }); }); });
    [from, to].forEach(function (tid) { const t = teamById_(tid); if (t['상태'] !== '조구성') commitTeam_(t, '관리자', contentOf_(tid), membersOf_(tid)); });
    log_('관리자', '학생 이동', s['학번'] + ' ' + nm + ': ' + from + ' → ' + to + ' (개인 기록 ' + moved + '개 이동)');
    return formation_({ cls: s['반'] });
  });
}

/* ════════════════ C. 발표 기록 ════════════════ */

function presRows_(tid) { return readAll_('pres').filter(function (r) { return r['팀ID'] === tid; }); }
function presOf_(tid) {
  const m = {};
  presRows_(tid).forEach(function (r) { m[String(r['회차'])] = { round: Number(r['회차']), date: String(r['녹음일'] || ''), segments: jsonOr_(r['구간목록'], []), at: String(r['수정일시'] || '') }; });
  return m;
}
function evalRows_(tid) { return readAll_('peval').filter(function (r) { return r['팀ID'] === tid; }); }
function evalMap_(tid) {
  const m = { fb1: {}, chg2: {} };
  evalRows_(tid).forEach(function (r) {
    const st = String(r['단계']); if (!m[st]) return;
    m[st][String(r['학번']) || 'team'] = { sid: String(r['학번']), name: r['이름'], ai: jsonOr_(r['AI초안'], null), final: jsonOr_(r['최종본'], null), approved: r['승인'] === 'Y', published: r['공개'] === 'Y', at: String(r['수정일시'] || '') };
  });
  return m;
}

function presTeam_(p) {
  const team = teamById_(p.tid), tid = team['팀ID'];
  const ms = membersOf_(tid).map(function (m) { return { sid: String(m['학번']), name: m['이름'], roles: rolesOf_(m) }; });
  return { team: { tid: tid, cls: String(team['반']), no: String(team['조']), field: String(team['분야']), status: team['상태'] }, members: ms, rec: presOf_(tid), evals: evalMap_(tid), segs: V2.SEGS, items: V2.ITEMS, improve: V2.IMPROVE, aiReady: !!aiProvider_() };
}

function transcriptText_(segs) {
  return segs.map(function (s) { return '[' + s.seg + '] ' + s.who + ': ' + s.text; }).join('\n');
}

// 녹음 글 저장 (녹음 중 자동 저장 · 편집 후 저장 모두). 같은 조·회차의 기록을 통째로 바꾼다.
function saveRecording_(p) {
  const round = Number(p.round);
  if (V2.ROUNDS.indexOf(round) < 0) throw fail_('BAD_INPUT', '회차는 1 또는 2여야 해요.');
  const team = teamById_(p.tid), tid = team['팀ID'];
  const names = membersOf_(tid).map(function (m) { return m['이름']; });
  const segs = (Array.isArray(p.segments) ? p.segments : []).slice(0, 600).map(function (s) {
    const seg = V2.SEGS.indexOf(String(s.seg)) >= 0 ? String(s.seg) : V2.SEGS[0];
    const who = String(s.who || '') === '교사' || names.indexOf(String(s.who)) >= 0 ? String(s.who) : '(미지정)';
    return { seg: seg, who: who, text: clip_(s.text, 4000), t: String(s.t || '').slice(0, 8) };
  }).filter(function (s) { return s.text; });
  let json = JSON.stringify(segs);
  if (json.length > 48000) throw fail_('TOO_LONG', '기록이 너무 길어요. 한 회차는 약 4만 자까지 저장할 수 있어요.');
  return withLock_(function () {
    const ex = presRows_(tid).filter(function (r) { return Number(r['회차']) === round; })[0], at = now_();
    const o = { 팀ID: tid, 반: team['반'], 조: team['조'], 회차: round, 녹음일: (ex && ex['녹음일']) || at.slice(0, 10), 구간목록: json, 전문: transcriptText_(segs).slice(0, 45000), 수정일시: at };
    if (ex) writeRow_('pres', ex._row, o); else appendObj_('pres', o);
    if (p.final) log_('관리자', '발표 기록 저장', tid + ' ' + round + '차 (' + segs.length + '문단)');
    return { at: at, count: segs.length, date: o['녹음일'] };
  });
}

/* ════════════════ D. AI 초안 ════════════════ */

const ITEM_SCHEMA_ = function (withImprove) {
  const props = {}, req = [];
  V2.ITEMS.concat(withImprove ? [V2.IMPROVE] : []).forEach(function (it) { props[it.id] = { type: 'string' }; req.push(it.id); });
  return { type: 'object', properties: props, required: req, additionalProperties: false };
};

// 조원 먼저(학생01~), 이어서 같은 반 다른 학생도 코드로 바꾼다 (녹음 글에 다른 조 학생 이름이 나올 수 있으므로)
function teamMembersAli_(tid) {
  const ms = membersOf_(tid), cls = String(teamById_(tid)['반']), mine = {};
  ms.forEach(function (m) { mine[String(m['학번'])] = 1; });
  const others = readAll_('students').filter(function (s) { return String(s['반']) === cls && !mine[String(s['학번'])]; });
  const ali = aliases_(ms.concat(others).map(function (m) { return { sid: String(m['학번']), name: m['이름'] }; }));
  return { ms: ms, ali: ali };
}
function maskSegs_(segs, ali) { return segs.map(function (s) { return { seg: s.seg, who: s.who === '교사' || s.who === '(미지정)' ? s.who : (ali.byName[s.who] || s.who), text: ali.mask(s.text) }; }); }
function evalText_(e) { const v = e && (e.final || e.ai); return v || null; }
function itemsText_(obj, withImprove) {
  if (!obj) return '(없음)';
  return V2.ITEMS.concat(withImprove ? [V2.IMPROVE] : []).map(function (it) { return '- ' + it.label + ': ' + (obj[it.id] || '(없음)'); }).join('\n');
}

// stage: 'fb1' 1차 피드백 정리 / 'chg2' 2차 변화 서술
function aiPresent_(p) {
  const stage = String(p.stage), team = teamById_(p.tid), tid = team['팀ID'];
  if (stage !== 'fb1' && stage !== 'chg2') throw fail_('BAD_INPUT', '알 수 없는 단계입니다.');
  const rec = presOf_(tid), x = teamMembersAli_(tid), ali = x.ali;
  if (!x.ms.length) throw fail_('BAD_INPUT', '조원이 없어요.');
  if (!rec['1'] || !rec['1'].segments.length) throw fail_('NO_REC', '먼저 1차 발표를 기록해 주세요.');
  const roster = x.ms.map(function (m) { return ali.bySid[String(m['학번'])] + ' (역할: ' + (rolesOf_(m).join(', ') || '없음') + ')'; }).join('\n');
  const itemsDesc = V2.ITEMS.map(function (it) { return it.id + '=' + it.label; }).join(', ');
  const base = '당신은 고등학교 정보 교사의 평가 기록을 돕는 조교입니다. 「인공지능 기초」 과목의 사회문제 해결 기계학습 프로젝트 발표를 다룹니다. ' +
    '녹음을 글로 옮긴 기록이라 잘못 인식된 단어가 있을 수 있으니 문맥으로 이해하되, 기록에 없는 내용을 지어내지 않습니다. 학생은 학생01 같은 코드로만 적고 실명을 추측하지 않습니다. 문장은 교사가 읽기 쉬운 간결한 한국어로 씁니다.';
  let system, user, schema;
  if (stage === 'fb1') {
    system = base;
    user = '아래는 한 모둠의 1차 발표 기록입니다. 각 문단 앞의 [구간]은 발표/질의응답/피드백, 그 뒤는 말한 사람입니다.\n' +
      '할 일: 교사가 말로 한 피드백과 질문(주로 [피드백]·[질의응답] 구간의 "교사" 발언)을 정리해 글로 된 피드백을 만듭니다.\n' +
      '- team: 모둠 전체에 대한 피드백(3~5문장).\n- students: 학생마다 항목별 피드백. 항목은 ' + itemsDesc + '.\n' +
      '  각 항목에는 그 학생의 1차 발표에서 관찰된 점과 교사가 고치라고 한 점을 1~2문장으로 씁니다. 해당 항목에 대한 발언이 전혀 없으면 빈 문자열("")로 둡니다.\n' +
      '- 학생에게 그대로 공개될 수 있으므로 존중하는 말투(~해 보세요, ~이 좋았어요)로 씁니다.\n\n' +
      '모둠원:\n' + roster + '\n\n1차 발표 기록:\n' + transcriptText_(maskSegs_(rec['1'].segments, ali));
    schema = { type: 'object', properties: { team: { type: 'string' }, students: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, items: ITEM_SCHEMA_(false) }, required: ['code', 'items'], additionalProperties: false } } }, required: ['team', 'students'], additionalProperties: false };
  } else {
    if (!rec['2'] || !rec['2'].segments.length) throw fail_('NO_REC', '먼저 2차 발표를 기록해 주세요.');
    const ev = evalMap_(tid).fb1;
    const fbLines = x.ms.map(function (m) { const e = ev[String(m['학번'])]; return ali.bySid[String(m['학번'])] + (e && e.approved ? '' : ' (교사 승인 전 초안)') + '\n' + ali.mask(itemsText_(evalText_(e), false)); }).join('\n\n');
    const teamFb = ev.team ? ali.mask(String((evalText_(ev.team) || {}).team || '')) : '';
    system = base;
    user = '아래는 한 모둠의 1차 발표 기록, 교사가 정리한 1차 피드백, 2차 발표 기록입니다.\n' +
      '할 일: 학생마다 항목별로 1차와 2차를 비교해 변화를 서술합니다. 점수나 등급은 매기지 않습니다.\n' +
      '- 항목 ' + itemsDesc + ' 은 다음 네 줄 형식으로 씁니다(각 줄 1~2문장):\n  1차: (1차 발표에서의 모습)\n  피드백: (교사가 준 피드백)\n  2차: (2차 발표에서의 모습)\n  변화: (무엇이 어떻게 달라졌는지, 근거가 된 발표 내용)\n' +
      '- improve(개선도): 1차 피드백을 2차에서 얼마나, 어떻게 반영했는지 2~3문장으로 종합합니다.\n' +
      '- 기록에서 확인되지 않는 부분은 "기록에서 확인되지 않음"이라고 씁니다.\n' +
      '- 이 글은 교사의 평가 자료와 세특 작성 근거로 쓰입니다.\n\n' +
      '모둠원:\n' + roster + '\n\n[1차 발표 기록]\n' + transcriptText_(maskSegs_(rec['1'].segments, ali)) +
      '\n\n[교사의 1차 피드백]\n' + (teamFb ? '모둠 전체: ' + teamFb + '\n\n' : '') + fbLines +
      '\n\n[2차 발표 기록]\n' + transcriptText_(maskSegs_(rec['2'].segments, ali));
    schema = { type: 'object', properties: { students: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, items: ITEM_SCHEMA_(true) }, required: ['code', 'items'], additionalProperties: false } } }, required: ['students'], additionalProperties: false };
  }
  if (p.preview) return { preview: { system: system, user: user } };
  const r = ai_(system, user, schema, { effort: 'medium', purpose: tid + ' ' + (stage === 'fb1' ? '1차 피드백' : '2차 변화') });
  return withLock_(function () {
    const rows = evalRows_(tid), at = now_(), withImp = stage === 'chg2';
    const put = function (sid, name, obj) {
      const ex = rows.filter(function (r0) { return String(r0['단계']) === stage && String(r0['학번']) === sid; })[0];
      const o = { 팀ID: tid, 단계: stage, 학번: sid, 이름: name, AI초안: JSON.stringify(obj), 수정일시: at };
      if (ex) writeRow_('peval', ex._row, o); else appendObj_('peval', Object.assign({ 최종본: '', 승인: '', 공개: '' }, o));
    };
    if (stage === 'fb1') put('', '(조 전체)', { team: ali.unmask(String(r.team || '')) });
    (r.students || []).forEach(function (s) {
      const sid = ali.byAlias[String(s.code).trim()]; if (!sid) return;
      const m = x.ms.filter(function (mm) { return String(mm['학번']) === sid; })[0], obj = {};
      if (!m) return;   // 조원이 아닌 코드는 무시
      V2.ITEMS.concat(withImp ? [V2.IMPROVE] : []).forEach(function (it) { obj[it.id] = ali.unmask(String((s.items || {})[it.id] || '')); });
      put(sid, m['이름'], obj);
    });
    log_('관리자', 'AI ' + (stage === 'fb1' ? '1차 피드백 정리' : '2차 변화 서술'), tid);
    return presTeam_({ tid: tid });
  });
}

// 교사: 최종본 저장 · 승인
function saveEval_(p) {
  const stage = String(p.stage), tid = String(p.tid);
  if (stage !== 'fb1' && stage !== 'chg2') throw fail_('BAD_INPUT', '알 수 없는 단계입니다.');
  const team = teamById_(tid), sid = cleanSid_(p.sid);
  let name = '(조 전체)', obj = {};
  if (sid) {
    const m = membersOf_(tid).filter(function (mm) { return String(mm['학번']) === sid; })[0];
    if (!m) throw fail_('NOT_FOUND', '이 조의 학생이 아닙니다.');
    name = m['이름'];
    V2.ITEMS.concat(stage === 'chg2' ? [V2.IMPROVE] : []).forEach(function (it) { obj[it.id] = clip_((p.items || {})[it.id], 2000); });
  } else {
    if (stage !== 'fb1') throw fail_('BAD_INPUT', '조 전체 피드백은 1차 피드백에만 있어요.');
    obj = { team: clip_((p.items || {}).team, 3000) };
  }
  return withLock_(function () {
    const ex = evalRows_(tid).filter(function (r) { return String(r['단계']) === stage && String(r['학번']) === sid; })[0], at = now_();
    const o = { 팀ID: team['팀ID'], 단계: stage, 학번: sid, 이름: name, 최종본: JSON.stringify(obj), 승인: p.approve ? 'Y' : '', 수정일시: at };
    if (!p.approve && ex) o['공개'] = '';   // 승인을 풀면 공개도 내린다
    if (ex) writeRow_('peval', ex._row, o); else appendObj_('peval', Object.assign({ AI초안: '', 공개: '' }, o));
    return presTeam_({ tid: tid });
  });
}

// 1차 피드백 공개/비공개 (승인된 것만 공개된다)
function publishEval_(p) {
  const tid = String(p.tid);
  teamById_(tid);
  return withLock_(function () {
    let n = 0;
    evalRows_(tid).forEach(function (r) {
      if (String(r['단계']) !== 'fb1') return;
      const v = p.published && r['승인'] === 'Y' ? 'Y' : '';
      if (v) n++;
      writeRow_('peval', r._row, { 공개: v });
    });
    log_('관리자', p.published ? '1차 피드백 공개' : '1차 피드백 비공개', tid + ' (' + n + '건)');
    const out = presTeam_({ tid: tid }); out.publishedCount = n; return out;
  });
}

// 학생: 공개된 1차 피드백 (조 전체 + 본인 것만)
function getPresFeedback_(p, auth) {
  const ev = evalMap_(auth.tid).fb1, pick = function (e) { return e && e.published && e.approved ? e.final : null; };
  const team = pick(ev.team), mine = auth.view ? null : pick(ev[auth.sid]);
  return { team: team ? team.team : '', mine: mine, items: V2.ITEMS };
}

/* ---- 세특 ---- */
function neisBytes_(s) {   // 나이스 기준: 한글 3바이트, 영문·숫자·기호 1바이트, 줄바꿈 2바이트
  let b = 0; s = String(s || '');
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b += c === 10 ? 2 : c < 128 ? 1 : 3; }
  return b;
}

function seteukList_(p) {
  const st = settings_(), rows = {}, teams = {};
  readAll_('seteuk').forEach(function (r) { rows[String(r['학번'])] = r; });
  readAll_('teams').forEach(function (t) { teams[t['팀ID']] = t; });
  const evals = {}, contrib = {};
  readAll_('peval').forEach(function (r) { if (String(r['단계']) === 'chg2' && r['승인'] === 'Y') evals[String(r['학번'])] = true; });
  readAll_('content').forEach(function (r) { const f = String(r['필드']).split('@'); if (f[1] && (f[0] === 'contrib_do' || f[0] === 'contrib_learn')) contrib[r['팀ID'] + '|' + f[1] + '|' + f[0]] = String(r['값']); });
  const cls = p.cls ? String(parseInt(p.cls, 10)) : '';
  const stud = readAll_('students').filter(function (s) { return s['팀ID'] && (!cls || String(s['반']) === cls) && (!p.tid || s['팀ID'] === p.tid); })
    .sort(function (a, b) { return (Number(a['반']) - Number(b['반'])) || (Number(a['조']) - Number(b['조'])) || (String(a['학번']) < String(b['학번']) ? -1 : 1); });
  return {
    len: seteukLen_(), classes: Object.keys(stud.reduce(function (a, s) { a[s['반']] = 1; return a; }, {})),
    aiReady: !!aiProvider_(),
    teams: Object.keys(teams).filter(function (k) { return !cls || String(teams[k]['반']) === cls; }).map(function (k) { return { tid: k, cls: String(teams[k]['반']), no: String(teams[k]['조']), field: String(teams[k]['분야']) }; }).sort(function (a, b) { return (Number(a.cls) - Number(b.cls)) || (Number(a.no) - Number(b.no)); }),
    students: stud.map(function (s) {
      const r = rows[String(s['학번'])] || {}, fin = String(r['최종본'] || ''), cur = fin || String(r['AI초안'] || '');
      return { sid: String(s['학번']), name: s['이름'], cls: String(s['반']), no: String(s['조']), tid: s['팀ID'], roles: rolesOf_(s), ai: String(r['AI초안'] || ''), final: fin, approved: r['승인'] === 'Y', approvedAt: String(r['승인일시'] || ''), chars: cur.length, bytes: neisBytes_(cur), flags: flagWords_(cur, st.schoolName), hasChange: !!evals[String(s['학번'])], contribDo: contrib[s['팀ID'] + '|' + s['이름'] + '|contrib_do'] || '', contribLearn: contrib[s['팀ID'] + '|' + s['이름'] + '|contrib_learn'] || '' };
    }),
  };
}

function aiSeteuk_(p) {
  const team = teamById_(p.tid), tid = team['팀ID'], x = teamMembersAli_(tid), ali = x.ali, len = seteukLen_();
  if (!x.ms.length) throw fail_('BAD_INPUT', '조원이 없어요.');
  const content = contentOf_(tid), g = function (id) { return content[id] ? String(content[id].val) : ''; };
  const ev = evalMap_(tid).chg2;
  const facts = ['주제 분야: ' + team['분야'], 'SDGs: ' + [g('sdg'), g('sdg2')].filter(Boolean).join(', '), '해결하려는 사회문제: ' + clip_(g('problem'), 300), '인공지능 목표: ' + clip_(g('goal'), 200), '문제 유형: ' + g('ml_type'), '사용한 모델: ' + g('algos').split('|').filter(Boolean).join(', '), '평가 결과: ' + clip_(g('metric_value'), 150)].join('\n');
  const pick = (Array.isArray(p.sids) && p.sids.length ? p.sids.map(cleanSid_) : null);
  const target = x.ms.filter(function (m) { return !pick || pick.indexOf(String(m['학번'])) >= 0; });
  const blocks = target.map(function (m) {
    const sid = String(m['학번']), nm = m['이름'], e = ev[sid];
    return '### ' + ali.bySid[sid] + '\n역할: ' + (rolesOf_(m).join(', ') || '없음') +
      '\n내가 맡아서 한 일: ' + ali.mask(clip_(g('contrib_do@' + nm), 800) || '(없음)') +
      '\n배운 점과 어려웠던 점: ' + ali.mask(clip_(g('contrib_learn@' + nm), 600) || '(없음)') +
      '\n발표 1차→2차 변화(' + (e && e.approved ? '교사 승인' : e ? '교사 승인 전 초안' : '없음') + '):\n' + ali.mask(itemsText_(evalText_(e), true));
  }).join('\n\n');
  const system = '당신은 고등학교 정보 교사가 학교생활기록부의 과목별 세부능력 및 특기사항(세특)을 쓰도록 돕는 조교입니다. 「인공지능 기초」 과목의 사회문제 해결 기계학습 프로젝트 부분만 씁니다.';
  const user = '학생마다 세특 초안을 쓰세요.\n규칙:\n' +
    '- 한 학생당 공백 포함 ' + len + '자 안팎(최대 ' + Math.round(len * 1.1) + '자)의 한 문단.\n' +
    '- 학생 이름이나 코드를 문장에 쓰지 않습니다(주어 생략). 문장은 "~함", "~임", "~보임"처럼 명사형으로 끝냅니다.\n' +
    '- 맡은 역할과 구체적인 활동, 1차 발표 뒤 피드백을 받아 2차 발표에서 개선한 과정과 성장을 중심으로 씁니다. 근거가 된 사실만 쓰고 과장하지 않습니다.\n' +
    '- 대학·기업·기관·학교 이름, 수상, 어학 성적, 부모의 직업은 쓰지 않습니다.\n' +
    '- code에는 학생 코드(학생01 등)를 그대로 적습니다.\n\n[모둠 프로젝트 정보]\n' + ali.mask(facts) + '\n\n[학생별 자료]\n' + blocks;
  if (p.preview) return { preview: { system: system, user: user } };
  const schema = { type: 'object', properties: { students: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, text: { type: 'string' } }, required: ['code', 'text'], additionalProperties: false } } }, required: ['students'], additionalProperties: false };
  const r = ai_(system, user, schema, { effort: 'medium', purpose: tid + ' 세특' });
  return withLock_(function () {
    const ex = {}, at = now_();
    readAll_('seteuk').forEach(function (row) { ex[String(row['학번'])] = row; });
    (r.students || []).forEach(function (s) {
      const sid = ali.byAlias[String(s.code).trim()]; if (!sid) return;
      const m = x.ms.filter(function (mm) { return String(mm['학번']) === sid; })[0];
      if (!m) return;
      const text = ali.unmask(String(s.text || '')).trim();
      const o = { 반: team['반'], 학번: sid, 이름: m['이름'], 팀ID: tid, AI초안: text, 수정일시: at };
      const old = ex[sid];
      if (!old || !old['최종본']) { o['글자수'] = text.length; o['바이트'] = neisBytes_(text); }
      if (old) writeRow_('seteuk', old._row, o); else appendObj_('seteuk', Object.assign({ 최종본: '', 승인: '', 승인일시: '' }, o));
    });
    log_('관리자', 'AI 세특 초안', tid);
    return seteukList_({ tid: tid });
  });
}

function saveSeteuk_(p) {
  const sid = cleanSid_(p.sid), text = String(p.text == null ? '' : p.text).replace(/\r/g, '').trim().slice(0, 1500);
  return withLock_(function () {
    const s = studentBySid_(sid);
    if (!s || !s['팀ID']) throw fail_('NOT_FOUND', '학생을 찾을 수 없습니다.');
    const ex = readAll_('seteuk').filter(function (r) { return String(r['학번']) === sid; })[0], at = now_();
    const o = { 반: s['반'], 학번: sid, 이름: s['이름'], 팀ID: s['팀ID'], 최종본: text, 글자수: text.length, 바이트: neisBytes_(text), 승인: p.approve ? 'Y' : '', 승인일시: p.approve ? at : '', 수정일시: at };
    if (ex) writeRow_('seteuk', ex._row, o); else appendObj_('seteuk', Object.assign({ AI초안: '' }, o));
    return { ok: true, chars: text.length, bytes: neisBytes_(text), flags: flagWords_(text, settings_().schoolName), approved: !!p.approve, approvedAt: p.approve ? at : '' };
  });
}

/* ════════════════ E. 가명 처리 · Claude API ════════════════ */

// 이름·학번을 '학생01' 같은 코드로 바꾸고, AI 결과를 다시 실명으로 되돌린다
function aliases_(list) {
  const bySid = {}, byAlias = {}, byName = {}, pairs = [];
  list.forEach(function (x, i) {
    const a = '학생' + ('0' + (i + 1)).slice(-2);
    bySid[x.sid] = a; byAlias[a] = x.sid; byName[x.name] = a;
    pairs.push([x.name, a]);
    if (x.sid) pairs.push([x.sid, a]);
    // 녹음 글에서는 이름만 부르는 경우가 많다(예: 홍길동 → 길동). 세 글자 이상 이름의 성 뺀 부분도 바꾼다.
    if (x.name.length >= 3) pairs.push([x.name.slice(1), a]);
  });
  pairs.sort(function (p, q) { return q[0].length - p[0].length; });
  const nameOf = {}; list.forEach(function (x) { nameOf[bySid[x.sid]] = x.name; });
  return {
    bySid: bySid, byAlias: byAlias, byName: byName,
    mask: function (t) { t = String(t || ''); pairs.forEach(function (pr) { if (pr[0]) t = t.split(pr[0]).join(pr[1]); }); return t; },
    unmask: function (t) { return String(t || '').replace(/학생\d{2}/g, function (a) { return nameOf[a] || a; }); },
  };
}

// 어떤 AI를 쓸지: 스크립트 속성 AI_PROVIDER(gemini|claude)가 있으면 그것, 없으면 키가 있는 쪽 (Gemini 우선)
function aiProvider_() {
  const want = String(prop_('AI_PROVIDER') || '').toLowerCase();
  if (want === 'gemini' || want === 'claude') return (want === 'gemini' ? prop_('GEMINI_API_KEY') : prop_('ANTHROPIC_API_KEY')) ? want : '';
  return prop_('GEMINI_API_KEY') ? 'gemini' : prop_('ANTHROPIC_API_KEY') ? 'claude' : '';
}

// 모든 AI 기능이 이 함수 하나로 부른다. schema: 돌려받을 JSON 모양(JSON Schema)
function ai_(system, user, schema, opt) {
  const pv = aiProvider_();
  if (pv === 'gemini') return gemini_(system, user, schema, opt || {});
  if (pv === 'claude') return claude_(system, user, schema, opt || {});
  throw fail_('NO_AI_KEY', 'AI를 쓰려면 Apps Script 스크립트 속성에 GEMINI_API_KEY(무료, Google AI Studio에서 발급)를 넣어 주세요. (README 참고)');
}

function aiFriendly_(code, name) {
  return code === 400 ? name + ' 요청 형식 오류예요.' : code === 401 || code === 403 ? 'API 키가 올바르지 않거나 권한이 없어요.' : code === 404 ? '모델 이름을 찾지 못했어요. 스크립트 속성의 모델 이름을 확인하세요.' : code === 429 ? '사용량 한도에 걸렸어요(무료 요금제는 분당·하루 요청 수가 제한돼요). 1분쯤 뒤, 또는 내일 다시 시도해 주세요.' : code >= 500 ? 'AI 서버가 바빠요. 잠시 뒤 다시 시도해 주세요.' : 'AI 요청이 실패했어요.';
}

// Google Gemini (generateContent + JSON Schema 구조화 출력)
function gemini_(system, user, schema, opt) {
  const key = prop_('GEMINI_API_KEY'), model = prop_('GEMINI_MODEL') || 'gemini-3.8-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const send = function (genCfg) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: genCfg };
    try {
      return UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body), headers: { 'x-goog-api-key': key } });
    } catch (e) { throw fail_('AI_NETWORK', 'AI 서버에 연결하지 못했어요(시간 초과 등). 잠시 뒤 다시 시도해 주세요.'); }
  };
  let res = send({ responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 16000 });
  let code = res.getResponseCode(), data = jsonOr_(res.getContentText(), {});
  // 이전 형식만 받는 경우를 위해 한 번 더 시도
  if (code === 400 && /responseJsonSchema|Unknown name/i.test(JSON.stringify(data))) {
    res = send({ responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: schema } }, maxOutputTokens: 16000 });
    code = res.getResponseCode(); data = jsonOr_(res.getContentText(), {});
  }
  if (code !== 200) {
    const msg = data.error && data.error.message ? data.error.message : ('HTTP ' + code);
    log_('AI', '오류', (opt.purpose || '') + ' gemini ' + code + ' ' + msg);
    throw fail_('AI_ERROR', aiFriendly_(code, 'Gemini') + ' (' + msg.slice(0, 160) + ')');
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) throw fail_('AI_REFUSED', 'AI가 이 요청을 처리하지 않았어요(' + data.promptFeedback.blockReason + '). 기록 내용을 확인한 뒤 다시 시도해 주세요.');
  const c = (data.candidates || [])[0] || {};
  if (c.finishReason === 'MAX_TOKENS') throw fail_('AI_TOO_LONG', 'AI 응답이 너무 길어 잘렸어요. 대상을 나눠서 다시 시도해 주세요.');
  if (c.finishReason && c.finishReason !== 'STOP') throw fail_('AI_REFUSED', 'AI가 응답을 끝내지 못했어요(' + c.finishReason + '). 다시 시도해 주세요.');
  const text = ((c.content || {}).parts || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('');
  const out = jsonOr_(text, null);
  if (!out) throw fail_('AI_BAD_JSON', 'AI 응답을 읽지 못했어요. 다시 시도해 주세요.');
  const u = data.usageMetadata || {};
  log_('AI', '호출', (opt.purpose || '') + ' · ' + (data.modelVersion || model) + ' · 입력 ' + (u.promptTokenCount || 0) + ' / 출력 ' + (u.candidatesTokenCount || 0) + ' 토큰');
  return out;
}

// Anthropic Claude (선택: ANTHROPIC_API_KEY 를 넣고 AI_PROVIDER=claude)
function claude_(system, user, schema, opt) {
  opt = opt || {};
  const key = prop_('ANTHROPIC_API_KEY');
  const body = {
    model: prop_('CLAUDE_MODEL') || 'claude-opus-5-5',
    max_tokens: 16000,
    system: system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: opt.effort || 'medium', format: { type: 'json_schema', schema: schema } },
    fallbacks: 'default',   // 안전 분류기가 요청을 거절하면 서버가 대체 모델로 다시 실행한다
  };
  let res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body),
      headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    });
  } catch (e) { throw fail_('AI_NETWORK', 'AI 서버에 연결하지 못했어요(시간 초과 등). 잠시 뒤 다시 시도해 주세요.'); }
  const code = res.getResponseCode(), data = jsonOr_(res.getContentText(), {});
  if (code !== 200) {
    const msg = data.error && data.error.message ? data.error.message : ('HTTP ' + code);
    const friendly = aiFriendly_(code, 'Claude');
    log_('AI', '오류', (opt.purpose || '') + ' ' + code + ' ' + msg);
    throw fail_('AI_ERROR', friendly + ' (' + msg.slice(0, 160) + ')');
  }
  if (data.stop_reason === 'refusal') throw fail_('AI_REFUSED', 'AI가 이 요청을 처리하지 않았어요. 기록 내용을 확인한 뒤 다시 시도해 주세요.');
  if (data.stop_reason === 'max_tokens') throw fail_('AI_TOO_LONG', 'AI 응답이 너무 길어 잘렸어요. 대상을 나눠서 다시 시도해 주세요.');
  const text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  const out = jsonOr_(text, null);
  if (!out) throw fail_('AI_BAD_JSON', 'AI 응답을 읽지 못했어요. 다시 시도해 주세요.');
  const u = data.usage || {};
  log_('AI', '호출', (opt.purpose || '') + ' · ' + (data.model || body.model) + ' · 입력 ' + (u.input_tokens || 0) + ' / 출력 ' + (u.output_tokens || 0) + ' 토큰');
  return out;
}

// v2 서버 기능 통합 테스트:  node tools/test-backend.js
'use strict';
const { createGas } = require('./gas-mock');

let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('  ✗ ' + msg); } }
function must(r, msg) { if (!r.ok) { fails++; console.log('  ✗ ' + msg + ' → ' + r.code + ' ' + r.message); throw new Error('stop'); } passes++; return r.data; }
function expectFail(r, code, msg) { ok(!r.ok && (!code || r.code === code), msg + ' (got ' + (r.ok ? 'ok' : r.code) + ')'); }

const NAMES = ['김민준', '이서연', '박도윤', '최지우', '정하준', '강서윤', '조이준', '윤하은', '장시우', '임지민', '한유진', '오건우'];
const INTEREST = ['간호사', '의사가 꿈', '환경공학', '기후 변화 연구', '초등 교사', '수학 선생님', '게임 개발', '모르겠음', '', '약사', '태양광 에너지', '교육 콘텐츠 기획'];
const realNames = NAMES.slice();

// Claude 응답 흉내: 보낸 내용에 실명이 없는지 검사하고, 학생 코드를 읽어 형식에 맞게 돌려준다
// Gemini(기본)·Claude 요청 모양을 모두 받는다
function fakeClaude(body) {
  const gem = !!body.contents;
  const user = gem ? body.contents[0].parts[0].text : body.messages[0].content;
  const leaked = realNames.filter(n => user.includes(n) || user.includes(n.slice(1)));
  ok(leaked.length === 0, 'AI로 보낸 내용에 실명이 없어야 함: ' + leaked.join(','));
  if (gem) ok(body.generationConfig && body.generationConfig.responseJsonSchema && body.generationConfig.responseMimeType === 'application/json', 'Gemini 구조화 출력 사용');
  else ok(body.model === 'claude-opus-5-5' && body.output_config.format.type === 'json_schema', 'Claude 구조화 출력 사용');
  const codes = Array.from(new Set(user.match(/학생\d{2}/g) || []));
  let out;
  if (user.includes('모둠으로 나누세요')) {
    // 일부러 규칙을 어긴 결과(6명 묶음, 중복, 누락)를 돌려줘 서버가 고치는지 본다
    out = { groups: [{ name: '의료·보건', members: codes.slice(0, 6) }, { name: '환경', members: [codes[0], codes[6]] }, { name: '교육', members: codes.slice(7, 9) }], unclear: [codes[7]] };
  } else if (user.includes('1차 발표 기록입니다')) {
    out = { team: '학생01 조는 문제 정의가 분명했어요.', students: codes.map(c => ({ code: c, items: { explain: c + '은 예시를 더 들어 보세요.', theory: '', practice: '코드 설명이 좋았어요.', slides: '글자를 줄여 보세요.' } })) };
  } else if (user.includes('1차와 2차를 비교')) {
    out = { students: codes.map(c => ({ code: c, items: { explain: '1차: a\n피드백: b\n2차: c\n변화: d', theory: '기록에서 확인되지 않음', practice: 'x', slides: 'y', improve: c + '은 피드백을 잘 반영함.' } })) };
  } else if (user.includes('세특 초안')) {
    out = { students: codes.map(c => ({ code: c, text: '모둠 프로젝트에서 데이터 전처리를 맡아 결측치를 처리함. 1차 발표 후 피드백을 반영하여 설명을 개선함.' })) };
  }
  if (gem) return { code: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }, modelVersion: 'gemini-3.8-flash' } };
  return { code: 200, json: { model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 100, output_tokens: 50 } } };
}

const gas = createGas({ props: { ADMIN_PASSWORD: 'teach', GEMINI_API_KEY: 'test-key' }, onFetch: fakeClaude });
const { call } = gas;

try {
  console.log('A. 관리자 · 명단');
  const admin = must(call('adminLogin', { pw: 'teach' }), '관리자 로그인').token;
  const sids = NAMES.map((n, i) => String(10301 + i));
  const imp = must(call('importClassRoster', { cls: 3, rows: NAMES.map((n, i) => ({ sid: sids[i], name: n })) }, admin), '반 명단 업로드');
  ok(imp.added === 12, '12명 추가');
  ok(must(call('importClassRoster', { cls: 3, rows: [{ sid: sids[0], name: NAMES[0] }] }, admin), '재업로드').updated === 1, '같은 학번은 수정');
  must(call('schema', {}), 'schema');

  console.log('B. 학생 로그인');
  expectFail(call('login', { sid: sids[0], name: '틀린이름' }), 'LOGIN_FAIL', '이름 틀리면 실패');
  ok(must(call('login', { sid: sids[0], name: NAMES[0] }), '첫 로그인').needPw === true, '비밀번호 설정 필요');
  expectFail(call('setPassword', { sid: sids[0], name: NAMES[0], newPw: '12' }), 'BAD_INPUT', '짧은 비밀번호 거부');
  const tok = {};
  NAMES.forEach((n, i) => { tok[i] = must(call('setPassword', { sid: sids[i], name: n, newPw: 'pw' + i + 'xx' }), '비밀번호 설정 ' + n).token; });
  expectFail(call('setPassword', { sid: sids[0], name: NAMES[0], newPw: 'again1' }), 'PW_EXISTS', '두 번 설정 불가');
  expectFail(call('login', { sid: sids[0], name: NAMES[0], pw: 'wrong' }), 'LOGIN_FAIL', '틀린 비밀번호');
  ok(!!must(call('login', { sid: sids[0], name: NAMES[0], pw: 'pw0xx' }), '정상 로그인').token, '토큰 발급');
  expectFail(call('loadProject', {}, tok[0]), 'NO_TEAM', '조 없으면 활동지 불가');

  console.log('C. 관심 분야 · 조 편성');
  INTEREST.forEach((t, i) => { if (t) must(call('saveInterest', { text: t }, tok[i]), '관심 분야 ' + i); });
  ok(must(call('myStatus', {}, tok[0]), 'myStatus').me.interest === '간호사', '관심 분야 저장');
  expectFail(call('aiGroup', { cls: 3 }, admin), 'BAD_STAGE', '마감 전 AI 편성 불가');
  must(call('closeInterest', { cls: 3, closed: true }, admin), '마감');
  expectFail(call('saveInterest', { text: 'x' }, tok[1]), 'CLOSED', '마감 후 입력 불가');
  const pv = must(call('aiGroup', { cls: 3, preview: true }, admin), '미리보기').preview;
  ok(pv.user.includes('학생01') && !pv.user.includes(NAMES[0]), '미리보기는 가명');
  ok(gas.fetchLog.length === 0, '미리보기는 AI를 부르지 않음');
  let f = must(call('aiGroup', { cls: 3 }, admin), 'AI 편성');
  const allPlaced = f.draft.groups.reduce((a, g) => a.concat(g.sids), []);
  ok(allPlaced.length === 12 && new Set(allPlaced).size === 12, '모두 한 번씩 배치: ' + allPlaced.length);
  ok(f.draft.groups.every(g => g.sids.length <= 5), '모든 묶음 5명 이하');
  ok(f.draft.unclear.length === 1, '불명확 표시');
  const fl = gas.fetchLog[0];
  ok(/models\/gemini-3\.8-flash:generateContent$/.test(fl.url) && fl.headers['x-goog-api-key'] === 'test-key', 'Gemini 주소·키 헤더');
  // 교사 조정: 3개 묶음 4명씩
  const groups = [{ name: '의료·보건', sids: [sids[0], sids[1], sids[9], sids[7]] }, { name: '환경·에너지', sids: [sids[2], sids[3], sids[10], sids[8]] }, { name: '교육·게임', sids: [sids[4], sids[5], sids[6], sids[11]] }];
  expectFail(call('saveGroups', { cls: 3, groups: [{ name: 'x', sids: sids.slice(0, 6) }] }, admin), 'TOO_MANY', '6명 묶음 거부');
  must(call('saveGroups', { cls: 3, groups: groups.slice(0, 2) }, admin), '일부 저장');
  expectFail(call('publishGroups', { cls: 3 }, admin), 'UNPLACED', '빠진 학생 있으면 공개 불가');
  must(call('saveGroups', { cls: 3, groups }, admin), '편성안 저장');
  f = must(call('publishGroups', { cls: 3 }, admin), '공개');
  ok(f.teams.length === 3 && f.teams[0].status === '조구성', '3개 조 생성(조구성)');
  ok(f.teams[0].field === '의료·보건', '분야 이름');

  console.log('D. 역할 선택');
  expectFail(call('loadProject', {}, tok[0]), 'TEAM_FORMING', '확정 전 활동지 불가');
  let st = must(call('myStatus', {}, tok[0]), 'myStatus 공개 후');
  ok(st.team && st.team.members.length === 4, '내 조 4명');
  must(call('pickRole', { role: '프로젝트 매니저', on: true }, tok[0]), 'PM 선택');
  expectFail(call('pickRole', { role: '프로젝트 매니저', on: true }, tok[1]), 'ROLE_FULL', 'PM 1명 제한');
  must(call('pickRole', { role: '데이터 엔지니어', on: true }, tok[0]), 'DE 선택(2번째 역할)');
  expectFail(call('pickRole', { role: '모델 개발자', on: true }, tok[0]), 'ROLE_MAX', '역할 3개 불가');
  must(call('pickRole', { role: '데이터 엔지니어', on: true }, tok[1]), 'DE 2명째');
  must(call('pickRole', { role: '데이터 엔지니어', on: true }, tok[9]), 'DE 3명째');
  expectFail(call('pickRole', { role: '데이터 엔지니어', on: true }, tok[7]), 'ROLE_FULL', 'DE 4명째 거부');
  must(call('pickRole', { role: '데이터 엔지니어', on: false }, tok[9]), 'DE 빼기');
  must(call('pickRole', { role: '모델 개발자', on: true }, tok[9]), '모델 개발자');
  must(call('pickRole', { role: '도메인 분석가', on: true }, tok[7]), '도메인 분석가');
  f = must(call('formation', { cls: 3 }, admin), '현황');
  ok(f.teams[0].emptyRoles.join() === 'AI 윤리·소통 담당', '빈 역할 표시: ' + f.teams[0].emptyRoles.join());
  must(call('setRoles', { sid: sids[1], roles: ['데이터 엔지니어', 'AI 윤리·소통 담당'] }, admin), '교사 역할 지정');
  f = must(call('confirmTeams', { cls: 3 }, admin), '확정');
  ok(f.teams.every(t => t.status === '작성중'), '확정 후 작성중');
  expectFail(call('pickRole', { role: '모델 개발자', on: true }, tok[2]), 'CONFIRMED', '확정 후 학생 역할 변경 불가');

  console.log('E. 활동지 · 이동');
  const lp = must(call('loadProject', {}, tok[0]), '확정 후 활동지');
  ok(lp.team.field === '의료·보건', '활동지 조 정보');
  must(call('saveFields', { fields: { ['contrib_do@' + NAMES[7]]: { val: '데이터를 모았다', baseV: 0 } } }, tok[7]), '개인 기록 저장');
  must(call('saveFields', { fields: { problem: { val: '조 공동 내용', baseV: 0 } } }, tok[7]), '조 기록 저장');
  must(call('moveStudent', { sid: sids[7], toTid: 'C3-2' }, admin), '2조로 이동');
  const lp2 = must(call('loadProject', {}, tok[7]), '이동 후 활동지');
  ok(lp2.team.no === '2', '이동한 조 = 2조 (got ' + lp2.team.no + ')');
  ok(lp2.content['contrib_do@' + NAMES[7]] && lp2.content['contrib_do@' + NAMES[7]].val === '데이터를 모았다', '개인 기록이 따라옴');
  ok(!lp2.content.problem, '조 공동 기록은 원래 조에 남음');
  ok(lp2.members.find(m => m.name === NAMES[7]).roles.length === 0, '이동 후 역할 비움');
  expectFail(call('moveStudent', { sid: sids[0], toTid: 'C3-2' }, admin), 'TEAM_FULL', '5명 조로 이동 불가');

  console.log('F. 발표 기록 · AI');
  const tid = 'C3-1';
  let pt = must(call('presTeam', { tid }, admin), '발표 팀');
  ok(pt.members.length === 3, '1조 3명');
  expectFail(call('aiPresent', { tid, stage: 'fb1' }, admin), 'NO_REC', '기록 없으면 AI 불가');
  const segs1 = [
    { seg: '발표', who: NAMES[0], text: '저희는 ' + NAMES[1] + '와 함께 간호 인력 문제를 다뤘습니다.' },
    { seg: '질의응답', who: '교사', text: '서연 학생, 결측치는 어떻게 처리했나요?' },
    { seg: '질의응답', who: NAMES[1], text: '평균으로 채웠습니다.' },
    { seg: '피드백', who: '교사', text: '도윤아 아니 민준, 예시를 더 들어 보세요.' },
    { seg: '발표', who: '누군지모름', text: '추가 설명' },
  ];
  const sv = must(call('saveRecording', { tid, round: 1, segments: segs1, final: true }, admin), '1차 기록 저장');
  ok(sv.count === 5, '5문단');
  pt = must(call('presTeam', { tid }, admin), '다시 읽기');
  ok(pt.rec['1'].segments[4].who === '(미지정)', '모르는 발언자는 (미지정)');
  const pv2 = must(call('aiPresent', { tid, stage: 'fb1', preview: true }, admin), 'fb1 미리보기').preview;
  ok(!pv2.user.includes('서연') && !pv2.user.includes(NAMES[0]), '녹음 글 속 이름도 가명');
  pt = must(call('aiPresent', { tid, stage: 'fb1' }, admin), 'AI 1차 피드백');
  const myFb = pt.evals.fb1[sids[0]];
  ok(myFb && myFb.ai.explain.indexOf(NAMES[0]) === 0, '결과는 실명으로 복원: ' + (myFb && myFb.ai.explain));
  ok(pt.evals.fb1.team.ai.team.includes(NAMES[0]), '조 전체 피드백 복원');
  ok(must(call('getPresFeedback', {}, tok[0]), '공개 전 학생 조회').mine === null, '공개 전엔 안 보임');
  must(call('saveEval', { tid, stage: 'fb1', sid: sids[0], items: { explain: '고친 피드백', theory: '', practice: 'p', slides: 's' }, approve: true }, admin), '승인');
  must(call('saveEval', { tid, stage: 'fb1', sid: '', items: { team: '조 전체 최종' }, approve: true }, admin), '조 전체 승인');
  pt = must(call('publishEval', { tid, published: true }, admin), '공개');
  ok(pt.publishedCount === 2, '승인된 2건만 공개');
  const g0 = must(call('getPresFeedback', {}, tok[0]), '학생 피드백');
  ok(g0.mine && g0.mine.explain === '고친 피드백' && g0.team === '조 전체 최종', '본인 + 조 전체 보임');
  ok(must(call('getPresFeedback', {}, tok[1]), '다른 학생').mine === null, '승인 안 된 학생 것은 안 보임');
  expectFail(call('aiPresent', { tid, stage: 'chg2' }, admin), 'NO_REC', '2차 기록 없으면 불가');
  must(call('saveRecording', { tid, round: 2, segments: [{ seg: '발표', who: NAMES[0], text: '예시 데이터로 설명하겠습니다.' }] }, admin), '2차 기록');
  pt = must(call('aiPresent', { tid, stage: 'chg2' }, admin), 'AI 2차 변화');
  ok(pt.evals.chg2[sids[0]].ai.improve.indexOf(NAMES[0]) === 0, '변화 서술 복원');
  must(call('saveEval', { tid, stage: 'chg2', sid: sids[0], items: Object.assign({}, pt.evals.chg2[sids[0]].ai), approve: true }, admin), '변화 승인');

  console.log('G. 세특');
  let sl = must(call('aiSeteuk', { tid }, admin), 'AI 세특');
  const s0 = sl.students.find(s => s.sid === sids[0]);
  ok(s0 && s0.ai.length > 10 && s0.chars === s0.ai.length, '세특 초안 + 글자수');
  ok(s0.hasChange === true, '변화 승인 표시');
  const saved = must(call('saveSeteuk', { sid: sids[0], text: '한국대학교 탐방 후 ' + s0.ai, approve: true }, admin), '세특 저장');
  ok(saved.flags.length > 0, '금지어 감지: ' + saved.flags.join(','));
  ok(saved.bytes > saved.chars, '바이트 계산');
  sl = must(call('seteukList', { cls: 3 }, admin), '세특 목록');
  ok(sl.students.length === 12 && sl.students.find(s => s.sid === sids[0]).approved, '목록·승인 상태');
  ok(sl.students.find(s => s.sid === sids[7]).contribDo === '데이터를 모았다', '세특 참고: 나의 기여(이동한 학생)');

  console.log('H. 기타');
  must(call('saveSettings', { seteukLen: 400 }, admin), '세특 분량 설정');
  ok(must(call('schema', {}), 'schema').v2.seteukLen === 400, '설정 반영');
  must(call('resetStudentPw', { sid: sids[3] }, admin), '비번 초기화');
  ok(must(call('login', { sid: sids[3], name: NAMES[3] }), '초기화 후').needPw === true, '다시 설정 필요');
  must(call('adminOverview', {}, admin), '진행 현황');
  must(call('adminSessions', {}, admin), '차시 점검');
  must(call('adminTeam', { tid }, admin), '채점');
  must(call('scoreTable', {}, admin), '채점표');
  must(call('rosterList', {}, admin), '명단 목록');

  console.log('I. AI 제공자 전환 · 오류');
  delete gas.props.GEMINI_API_KEY;
  expectFail(call('aiSeteuk', { tid }, admin), 'NO_AI_KEY', '키 없으면 안내');
  ok(must(call('seteukList', {}, admin), '키 없음 목록').aiReady === false, 'aiReady false');
  gas.props.ANTHROPIC_API_KEY = 'claude-key';
  must(call('aiSeteuk', { tid }, admin), 'Claude 로 전환');
  ok(gas.fetchLog[gas.fetchLog.length - 1].url.indexOf('anthropic.com') > 0, 'Claude 주소 사용');
  gas.props.GEMINI_API_KEY = 'test-key';
  must(call('aiSeteuk', { tid }, admin), '두 키 모두 있으면 Gemini 우선');
  ok(gas.fetchLog[gas.fetchLog.length - 1].url.indexOf('generativelanguage') > 0, 'Gemini 우선');

  console.log('J. 역할별 페이지와 새 역할 규칙 (티켓 14)');
  // 1조: 김민준(PM·DE), 이서연, 임지민 / 3조: 정하준·강서윤·조이준·오건우 — 3조는 아무도 역할을 고르지 않아 팀장이 없다
  let p0 = must(call('loadProject', {}, tok[0]), '역할 2개 학생 활동지');
  const me0 = p0.members.find(m => m.name === NAMES[0]);
  ok(me0.roles.length === 2 && me0.roles.indexOf('프로젝트 매니저') >= 0 && me0.roles.indexOf('데이터 엔지니어') >= 0, '역할 2개가 모두 전달됨: ' + me0.roles.join(','));
  ok(p0.submitRule.canSubmit === true && p0.submitRule.noLeader === false, '팀장은 제출 가능');
  const p1 = must(call('loadProject', {}, tok[1]), '데이터 엔지니어 학생');
  ok(p1.submitRule.canSubmit === false && p1.submitRule.noLeader === false, '팀장이 있으면 다른 조원은 제출 불가');

  const p3 = must(call('loadProject', {}, tok[4]), '팀장 없는 조 학생');
  ok(p3.submitRule.noLeader === true, '팀장 없음 표시');
  ok(p3.submitRule.canSubmit === false, '팀장 없는 조는 제출 불가');
  expectFail(call('submitProject', {}, tok[4]), 'NO_LEADER', '팀장 없는 조 제출 거부');
  f = must(call('formation', { cls: 3 }, admin), '현황');
  ok(f.teams.find(t => t.no === '3').noLeader === true, '교사 조 구성 화면에 팀장 없음');
  ok(must(call('adminOverview', {}, admin), '진행 현황').teams.find(t => t.no === '3').noLeader === true, '진행 현황에 팀장 없음');

  must(call('setRoles', { sid: sids[5], roles: ['프로젝트 매니저'] }, admin), '교사가 팀장 지정');
  ok(must(call('loadProject', {}, tok[5]), '지정된 팀장').submitRule.canSubmit === true, '지정된 팀장은 제출 가능');
  ok(must(call('loadProject', {}, tok[4]), '다른 조원').submitRule.canSubmit === false, '다른 조원은 여전히 불가');

  must(call('setRoles', { sid: sids[5], roles: [] }, admin), '팀장 다시 비움');
  must(call('saveSettings', { leaderSubmit: false }, admin), '팀장만 제출 끄기');
  const p3off = must(call('loadProject', {}, tok[4]), '설정 끈 뒤');
  ok(p3off.submitRule.canSubmit === true && p3off.submitRule.noLeader === false, '설정을 끄면 팀장 없어도 누구나 제출');
  must(call('saveSettings', { leaderSubmit: true }, admin), '설정 되돌리기');

  // 이동으로 역할이 비워진 학생(이서연을 3조로)
  must(call('moveStudent', { sid: sids[1], toTid: 'C3-3' }, admin), '역할 있는 학생 이동');
  const pm = must(call('loadProject', {}, tok[1]), '이동 후 활동지');
  ok(pm.members.find(m => m.name === NAMES[1]).roles.length === 0 && pm.submitRule.noLeader === true && pm.submitRule.canSubmit === false, '이동 후 역할 비움 · 새 조 규칙 적용');
} catch (e) { if (e.message !== 'stop') { fails++; console.log(e.stack); } }

console.log('\n통과 ' + passes + ' / 실패 ' + fails);
process.exit(fails ? 1 : 0);

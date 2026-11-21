// 로컬 확인용 서버:  node tools/dev-server.js [포트]
// docs/ 폴더(웹 화면)를 보여 주고, API 요청은 Apps Script 흉내(gas-mock)로 처리한다. AI 응답은 가짜로 만든다.
// 관리자 비밀번호: teach  ·  시연용 3반 명단 12명이 미리 들어 있다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const WEB = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function fakeClaude(body) {
  const gem = !!body.contents, user = gem ? body.contents[0].parts[0].text : body.messages[0].content, codes = Array.from(new Set(user.match(/학생\d{2}/g) || []));
  let out;
  if (user.includes('모둠으로 나누세요')) {
    const k = Number((user.match(/정확히 (\d+)개 모둠/) || [])[1] || 1), names = ['의료·보건', '환경·에너지', '교육', '게임·콘텐츠', '경제·금융', '공학·기술', '문화·예술'];
    const groups = Array.from({ length: k }, (_, i) => ({ name: names[i % names.length], members: [] }));
    codes.forEach((c, i) => groups[i % k].members.push(c));
    out = { groups, unclear: codes.slice(-1) };
  } else if (user.includes('1차 발표 기록입니다')) {
    const team = codes.filter(c => user.includes(c + ' (역할'));
    out = { team: '문제 정의가 분명하고 발표 흐름이 자연스러웠어요. 데이터 전처리 과정을 예시와 함께 보여 주면 더 좋아요.', students: team.map(c => ({ code: c, items: { explain: c + '은(는) 핵심을 잘 짚었어요. 청중에게 질문을 던지며 설명해 보세요.', theory: '결정트리의 분기 기준을 정확히 설명해 보세요.', practice: '코랩 실행 화면을 보여 준 점이 좋았어요.', slides: '한 슬라이드의 글자 수를 줄여 보세요.' } })) };
  } else if (user.includes('1차와 2차를 비교')) {
    const team = codes.filter(c => user.includes(c + ' (역할'));
    out = { students: team.map(c => ({ code: c, items: { explain: '1차: 슬라이드를 읽는 방식으로 설명함.\n피드백: 청중에게 질문을 던지며 설명해 보라는 피드백을 받음.\n2차: 질문으로 시작해 청중의 참여를 이끌어 냄.\n변화: 설명 방식이 일방향에서 상호작용형으로 바뀜.', theory: '1차: 분기 기준 설명이 모호함.\n피드백: 지니 불순도로 설명하라는 피드백.\n2차: 예시 데이터로 지니 불순도를 계산해 보임.\n변화: 이론 설명이 구체화됨.', practice: '기록에서 확인되지 않음', slides: '1차: 글자가 많음.\n피드백: 글자 수를 줄이라는 피드백.\n2차: 핵심 키워드와 그래프 중심으로 바꿈.\n변화: 가독성이 높아짐.', improve: c + '은(는) 1차 피드백 세 가지를 모두 2차 발표에 반영함.' } })) };
  } else {
    const team = codes.filter(c => user.includes('### ' + c));
    out = { students: team.map(c => ({ code: c, text: '사회문제 해결 기계학습 프로젝트에서 데이터 엔지니어를 맡아 공공데이터의 결측치와 이상치를 처리하는 과정을 주도함. 1차 발표 후 전처리 근거를 구체화하라는 피드백을 받고, 2차 발표에서 처리 전후의 분포를 그래프로 비교하여 설명하는 등 피드백을 적극 반영하는 모습을 보임.' })) };
  }
  if (gem) return { code: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 400 } } };
  return { code: 200, json: { model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 1200, output_tokens: 400 } } };
}

const gas = createGas({ props: { ADMIN_PASSWORD: 'teach', GEMINI_API_KEY: 'dev-fake' }, onFetch: fakeClaude });
// 시연용 명단
(function seed() {
  const tok = gas.call('adminLogin', { pw: 'teach' }).data.token;
  const names = ['김민준', '이서연', '박도윤', '최지우', '정하준', '강서윤', '조이준', '윤하은', '장시우', '임지민', '한유진', '오건우'];
  gas.call('importClassRoster', { cls: 3, rows: names.map((n, i) => ({ sid: String(10301 + i), name: n })) }, tok);
})();

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try { out = gas.ctx.doPost({ postData: { contents: body } }).text; } catch (e) { out = JSON.stringify({ ok: false, code: 'DEV', message: e.message }); }
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out); }, 150);
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end("window.APP_CONFIG = { API_URL: 'http://localhost:" + PORT + "/api' };"); return; }
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('dev server: http://localhost:' + PORT + '  (관리자 비밀번호 teach)'));

// 음성 인식 모듈(stt.js) 시험:  node tools/test-stt.js
// 크롬 Web Speech API 의 알려진 동작(시간 제한으로 끊김, 침묵 후 끊김, 네트워크 오류)을 흉내 내는 가짜 엔진으로
// "다시 켜질 때까지 듣지 못하는 시간(공백)"과 "글자가 사라지는지"를 잰다. 가상 시계를 쓰므로 몇 초 안에 끝난다.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function run(scenario) {
  let now = 0; const timers = [];
  const clock = {
    setTimeout(fn, ms) { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    advance(ms) { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); } now = end; },
  };
  const log = { starts: [], ends: [], finals: [], errors: [], states: [] };
  let live = null;   // 지금 듣고 있는 가짜 엔진
  class FakeRec {
    start() {
      if (live === this) throw new Error('InvalidStateError: already started');
      live = this; log.starts.push(now);
      scenario.onStart(this, { now: () => now, clock });
    }
    stop() { if (live === this) this._end(); }
    _end() { if (live !== this) return; live = null; log.ends.push(now); this.onend && this.onend(); }
    _final(t) { if (live === this) this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); }
    _error(e) { if (live === this) this.onerror({ error: e }); }
  }
  const window = { SpeechRecognition: FakeRec };
  const ctx = { window, PJ: {}, Date: { now: () => now }, setTimeout: clock.setTimeout, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'assets', 'stt.js'), 'utf8'), ctx);
  const eng = ctx.PJ.STT.create({ lang: 'ko-KR', onFinal: t => log.finals.push([now, t]), onInterim() {}, onState: s => log.states.push([now, s]), onError: m => log.errors.push([now, m]) });
  eng.start();
  clock.advance(scenario.duration);
  // 공백: 끊긴 시각 → 다음으로 다시 듣기 시작한 시각
  const gaps = log.ends.map(e => { const s = log.starts.find(x => x >= e); return s === undefined ? scenario.duration - e : s - e; });
  return { log, gaps, maxGap: Math.max(0, ...gaps), totalGap: gaps.reduce((a, b) => a + b, 0), listening: !!live };
}

let fails = 0;
function check(name, cond, detail) { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; }

// A. 크롬은 계속 말해도 약 60초마다 세션을 끝낸다
let r = run({ duration: 5 * 60000, onStart(rec, t) { t.clock.setTimeout(() => rec._final('문장'), 1000); t.clock.setTimeout(() => rec._end(), 60000); } });
console.log('A. 60초마다 세션 종료 (5분)');
check('계속 듣고 있다', r.listening);
check('재시작 공백이 0.5초 이하', r.maxGap <= 500, '최대 ' + r.maxGap + 'ms');

// B. 말이 없으면 약 8초 뒤 no-speech 오류 후 끝남 (발표 중 잠깐 멈출 때)
r = run({ duration: 3 * 60000, onStart(rec, t) { t.clock.setTimeout(() => { rec._error('no-speech'); rec._end(); }, 8000); } });
console.log('B. 침묵 8초마다 종료 (3분)');
check('계속 듣고 있다', r.listening);
check('재시작 공백이 0.5초 이하', r.maxGap <= 500, '최대 ' + r.maxGap + 'ms');
check('사용자에게 오류를 띄우지 않는다', r.log.errors.length === 0, r.log.errors.length + '번');

// C. 짧게 말하고 바로 끝나는 세션이 이어짐 (학생이 짧게 답하고 멈추는 질의응답)
r = run({ duration: 2 * 60000, onStart(rec, t) { t.clock.setTimeout(() => rec._final('네'), 300); t.clock.setTimeout(() => rec._end(), 1200); } });
console.log('C. 1.2초짜리 세션이 연달아 (2분)');
check('계속 듣고 있다', r.listening);
check('재시작 공백이 0.5초 이하', r.maxGap <= 500, '최대 ' + r.maxGap + 'ms, 듣지 못한 시간 합계 ' + Math.round(r.totalGap / 1000) + '초 / 120초');

// D. 일시적 네트워크 오류 한 번 (학교 와이파이)
let once = false;
r = run({ duration: 60000, onStart(rec, t) { if (!once) { once = true; t.clock.setTimeout(() => { rec._error('network'); rec._end(); }, 5000); } } });
console.log('D. 네트워크 오류 1번');
check('다시 듣고 있다', r.listening);
check('오류 안내는 한 번', r.log.errors.length <= 1, r.log.errors.length + '번');

// E. 진짜 고장(아무 글자 없이 바로 끝나는 세션이 계속됨, 예: 마이크를 다른 프로그램이 쓰는 중) — 쉬지 않고 다시 켜며 서버를 두드리면 안 된다
r = run({ duration: 60000, onStart(rec, t) { t.clock.setTimeout(() => rec._end(), 50); } });
console.log('E. 글자 없이 0.05초 만에 끝나는 세션이 계속 (1분)');
check('재시작 횟수가 과하지 않다(1분에 60번 이하)', r.log.starts.length <= 60, r.log.starts.length + '번');

console.log(fails ? '\n실패 ' + fails : '\n모두 통과');
process.exit(fails ? 1 : 0);

/* 실시간 음성 인식(STT) 모듈
 * 지금은 브라우저 내장 Web Speech API(크롬·엣지)를 쓴다. 오디오는 저장하지 않고 글자만 넘긴다.
 * 나중에 클라우드 STT로 바꿀 때는 같은 모양(create → start/stop, onFinal/onInterim/onState/onError)으로
 * 새 엔진을 만들어 PJ.STT.engine 만 바꾸면 된다.
 */
(function () {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  function webSpeech(o) {
    let rec = null, want = false, restarts = 0, lastStart = 0;
    function make() {
      rec = new Rec();
      rec.lang = o.lang || 'ko-KR';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i], t = r[0].transcript;
          if (r.isFinal) { if (t.trim()) o.onFinal(t.trim()); } else interim += t;
        }
        o.onInterim(interim.trim());
      };
      rec.onerror = function (e) {
        if (e.error === 'no-speech' || e.error === 'aborted') return;   // 조용한 구간 — 자동으로 다시 시작
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; o.onError('마이크 사용이 허용되지 않았어요. 주소창 왼쪽의 자물쇠 아이콘에서 마이크를 "허용"으로 바꿔 주세요.'); return; }
        if (e.error === 'audio-capture') { want = false; o.onError('마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.'); return; }
        if (e.error === 'network') { o.onError('음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요. 자동으로 다시 시도합니다.'); return; }
        o.onError('음성 인식 오류: ' + e.error);
      };
      rec.onend = function () {
        o.onInterim('');
        if (!want) { o.onState('stopped'); return; }
        // 침묵이나 시간 제한으로 끊기면 다시 켠다. 너무 자주 끊기면 잠깐 쉬었다가.
        const quick = Date.now() - lastStart < 1500;
        restarts = quick ? restarts + 1 : 0;
        setTimeout(function () { if (want) begin(); }, quick ? Math.min(3000, 300 * restarts) : 100);
      };
    }
    function begin() {
      if (!rec) make();
      try { lastStart = Date.now(); rec.start(); o.onState('listening'); }
      catch (e) { /* 이미 켜져 있으면 무시 */ }
    }
    return {
      start: function () { want = true; restarts = 0; begin(); },
      stop: function () { want = false; try { rec && rec.stop(); } catch (e) { /* 무시 */ } },
      get running() { return want; },
    };
  }

  PJ.STT = {
    supported: function () { return !!Rec; },
    engineName: 'Web Speech API (브라우저 내장)',
    // o: { lang, onFinal(text), onInterim(text), onState('listening'|'stopped'), onError(msg) }
    create: function (o) {
      if (!Rec) throw new Error('이 브라우저는 음성 인식을 지원하지 않아요. 크롬이나 엣지를 사용해 주세요.');
      return webSpeech(o);
    },
  };
})();

// autostory.js — 自动剧情推进器: 循环触发当前任务链并处理对话
(function () {
  if (window.__AUTOSTORY__) { clearInterval(window.__AUTOSTORY__.timer); }
  var AS = window.__AUTOSTORY__ = {
    started: Date.now(), lastMiss: 0, stuckCount: 0, history: [],
    timer: 0, log: []
  };
  function lg(m) { AS.log.push('[' + new Date().toTimeString().substring(0, 8) + '] ' + m); if (AS.log.length > 200) AS.log.shift(); console.log('[autostory]', m); }

  function getModel() {
    return Laya.__classmap['com.game.exploreMission.model.ExploreMissModel'].ins;
  }
  function getEMC() {
    return Laya.__classmap['com.game.exploreMission.control.ExploreMissControl'];
  }

  function advanceTalk() {
    try {
      var MST = Laya.__classmap['com.game.movie.movieView.MovieScreenTalkPanel'];
      var ins = MST._ins;
      if (ins && ins.parent) { ins.playNext(); return true; }
    } catch (e) { }
    return false;
  }

  function trigger() {
    var M = getModel();
    var id = M.mainMiss ? M.mainMiss.id : -2;
    if (id <= 0) { lg('无当前任务, 停止'); clearInterval(AS.timer); return; }
    if (id === AS.lastMiss) {
      AS.stuckCount++;
      if (AS.stuckCount % 4 === 0) lg('任务 ' + id + ' 停滞 x' + AS.stuckCount);
      if (AS.stuckCount > 60) { lg('任务 ' + id + ' 卡死, 停止'); clearInterval(AS.timer); }
      return;
    }
    AS.lastMiss = id; AS.stuckCount = 0;
    var tw = M.getTraceWork(id);
    var arr = (typeof tw === 'string') ? tw.split(',') : tw;
    AS.history.push(id);
    lg('触发任务 ' + id + ' track=' + arr.join(','));
    try { getEMC().funcExec(id, arr); } catch (e) { lg('funcExec异常: ' + e); }
  }

  AS.timer = setInterval(function () {
    if (advanceTalk()) return;   // 对话优先推进
    trigger();
  }, 2500);

  lg('自动剧情推进器启动');
  return 'autostory started';
})()

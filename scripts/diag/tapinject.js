(function(){
  window.__tap = function(x, y, hold) {
    const cv = document.querySelector('canvas'); if (!cv) return 'NO CANVAS';
    const r = cv.getBoundingClientRect();
    const sc = (window.Laya && Laya.stage) ? (Laya.stage._canvasWidth / (Laya.stage.designWidth || Laya.stage.width) || 1) : 1;
    const cx = r.left + x, cy = r.top + y;
    const common = {bubbles:true, cancelable:true, composed:true, pointerId:1, pointerType:'touch', isPrimary:true, clientX:cx, clientY:cy, screenX:cx, screenY:cy, button:0, buttons:1};
    cv.dispatchEvent(new PointerEvent('pointerdown', common));
    if (hold) { /* long press could go here */ }
    cv.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, common, {buttons:0})));
    cv.dispatchEvent(new MouseEvent('mousedown', common));
    cv.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, {buttons:0})));
    cv.dispatchEvent(new MouseEvent('click', Object.assign({}, common, {buttons:0})));
    const st = (window.Laya && Laya.stage) ? {w:Laya.stage.width, h:Laya.stage.height, designW:Laya.stage.designWidth, designH:Laya.stage.designHeight, cw:Laya.stage._canvasWidth, ch:Laya.stage._canvasHeight} : null;
    return 'tap('+Math.round(x)+','+Math.round(y)+') stage=' + JSON.stringify(st);
  };
  return 'injected';
})()

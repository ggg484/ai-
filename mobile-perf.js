// 渲染分辨率上限：只由宿主下发的 ?dpr= 决定，页面不做设备判断。
// 必须在渲染器创建 canvas 之前执行（放在 <head>，先于任何模块）。
(function () {
  try {
    var m = (location.search || "").match(/[?&]dpr=(-?[0-9.]+)/);
    if (!m) return;
    var cap = parseFloat(m[1]);
    if (!(cap > 0)) return;
    var real = window.devicePixelRatio || 1;
    if (real > cap) {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: function () { return cap; },
        set: function () {}
      });
    }
  } catch (e) {}
})();

(function () {
  // Shows a survey inside your page and resizes to fit it:
  //   <script src="https://YOUR-APP/embed.js" data-survey="https://YOUR-APP/embed/s/..." async></script>
  var me = document.currentScript;
  if (!me) return;
  var src = me.getAttribute("data-survey") || "";
  if (
    !/^https:\/\//.test(src) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(src)
  )
    return;
  var frame = document.createElement("iframe");
  frame.src = src;
  frame.title = me.getAttribute("data-title") || "Survey";
  frame.style.cssText = "width:100%;border:0;min-height:420px";
  if (me.parentNode && me.parentNode.nodeName !== "HEAD") {
    me.parentNode.insertBefore(frame, me.nextSibling);
  } else {
    // placed in the page head: show it at the top of the body once there is one
    document.addEventListener("DOMContentLoaded", function () {
      document.body.insertBefore(frame, document.body.firstChild);
    });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (
      d &&
      d.type === "feedback-survey-height" &&
      typeof d.height === "number" &&
      d.height > 0 &&
      d.height < 20000
    ) {
      frame.style.height = Math.ceil(d.height) + "px";
    }
  });
})();

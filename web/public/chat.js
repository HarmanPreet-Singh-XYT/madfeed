(function () {
  // Shows a chat button on your page that opens the chat in a small window:
  //   <script src="https://YOUR-APP/chat.js" data-widget="c.…" async></script>
  var me = document.currentScript;
  if (!me) return;
  var token = me.getAttribute("data-widget") || "";
  if (!/^c\.[A-Za-z0-9._-]{10,110}$/.test(token)) return;
  var base;
  try {
    base = new URL(me.src).origin;
  } catch (e) {
    return;
  }
  var open = false;
  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open chat");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "Chat";
  button.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483000;min-height:48px;min-width:72px;padding:0 18px;border:0;border-radius:24px;background:#1d4ed8;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)";
  var frame = null;
  function show() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Chat";
      frame.src =
        base + "/chat/" + token + "?o=" + encodeURIComponent(location.origin);
      frame.style.cssText =
        "position:fixed;right:16px;bottom:76px;z-index:2147483000;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 100px));border:1px solid #ccc;border-radius:12px;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3)";
      document.body.appendChild(frame);
    }
    frame.style.display = "block";
  }
  button.addEventListener("click", function () {
    open = !open;
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) show();
    else if (frame) frame.style.display = "none";
  });
  function add() {
    document.body.appendChild(button);
  }
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
})();

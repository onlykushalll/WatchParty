// Popup — reads current room context from chrome.storage.session
chrome.storage.session.get([
  "wp:roomId", "wp:userName", "wp:syncUrl"
], (ctx) => {
  const status = document.getElementById("status");
  const room = document.getElementById("room");
  const viewers = document.getElementById("viewers");
  const drift = document.getElementById("drift");

  if (ctx["wp:roomId"]) {
    status.textContent = "Active";
    status.className = "val ok";
    room.textContent = ctx["wp:roomId"].slice(0, 16);
    viewers.textContent = "—";
    drift.textContent = "—";
  } else {
    status.textContent = "No room";
    status.className = "val off";
    room.textContent = "—";
  }
});

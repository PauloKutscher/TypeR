const PS_EVENT_SELECT = 1936483188; // 'slct'
const PS_EVENT_SET = 1936028772; // 'setd'
const PS_EVENT_MOVE = 1836021349; // 'move'

const eventContainsId = (event, eventId) => {
  const data = event && event.data;
  if (typeof data !== "string" || !data) return false;
  return data.indexOf(String(eventId)) !== -1;
};

// Missing CEP payloads must still be treated as selections so a real layer
// click is never dropped. More specific event checks fail closed instead.
const isPhotoshopSelectEvent = (event) => {
  const data = event && event.data;
  if (typeof data !== "string" || !data) return true;
  return eventContainsId(event, PS_EVENT_SELECT);
};

const isPhotoshopMoveEvent = (event) => eventContainsId(event, PS_EVENT_MOVE);

// Marquee tools emit a burst of 'setd' events that address the document's
// selection channel. Those cannot have changed any layer's text or style, and
// answering each drag with a full layer read costs ~95 ms of Photoshop's main
// thread. Text and layer edits address a textLayer/layer reference instead, so
// they still take the full path; unreadable payloads fail closed and do too.
const isPhotoshopSelectionOnlyEvent = (event) => {
  const data = event && event.data;
  if (typeof data !== "string" || !data) return false;
  if (!eventContainsId(event, PS_EVENT_SET)) return false;
  if (data.indexOf("textLayer") !== -1) return false;
  if (data.indexOf('"_ref":"layer"') !== -1) return false;
  return data.indexOf('"channel"') !== -1 || data.indexOf('"_property":"selection"') !== -1;
};

export {
  PS_EVENT_SELECT,
  PS_EVENT_SET,
  PS_EVENT_MOVE,
  isPhotoshopSelectEvent,
  isPhotoshopMoveEvent,
  isPhotoshopSelectionOnlyEvent,
};

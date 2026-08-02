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

export {
  PS_EVENT_SELECT,
  PS_EVENT_SET,
  PS_EVENT_MOVE,
  isPhotoshopSelectEvent,
  isPhotoshopMoveEvent,
};

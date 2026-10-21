export const REQUEST_STATUS: Record<string, string> = {
  RECEIVED: 'Received — our team will plan it',
  BEING_PLANNED: 'Being planned',
  PLAN_READY: 'Your plan is ready',
  BOOKED: 'Booked',
  CLOSED: 'Closed',
};

/** NAV-AI-008: say plainly what is confirmed and what is still being arranged. */
export const BOOKING_STATUS: Record<string, string> = {
  REQUESTED: 'Requested',
  PENDING_CONFIRMATION: 'Booked — being confirmed',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

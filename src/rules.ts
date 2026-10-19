// Business rules shared by several features.

// The 10-minute window around an appointment's start time: clients can message the
// consultant, reschedule in one click, or cancel from 5 minutes before the start until
// 5 minutes after it. After that the appointment counts as started.
export const WINDOW_MINUTES_BEFORE_START = 5;
export const WINDOW_MINUTES_AFTER_START = 5;

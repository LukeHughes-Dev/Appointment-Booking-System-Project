// Business rules shared by several features.

// The 10-minute window around an appointment's start time: clients can message the
// consultant, reschedule in one click, or cancel from 5 minutes before the start until
// 5 minutes after it. After that the appointment counts as started.
export const WINDOW_MINUTES_BEFORE_START = 5;
export const WINDOW_MINUTES_AFTER_START = 5;

// When the window opens and closes for an appointment starting at `startsAt`.
export function windowBounds(startsAt: Date): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(startsAt.getTime() - WINDOW_MINUTES_BEFORE_START * 60_000),
    closesAt: new Date(startsAt.getTime() + WINDOW_MINUTES_AFTER_START * 60_000),
  };
}

export type WindowState = 'upcoming' | 'open' | 'closed';

// Where "now" sits relative to an appointment's 10-minute window. The only place the
// window is calculated, so the API, chat and reschedule can never disagree about it.
export function windowState(startsAt: Date, now: Date): WindowState {
  const opens = startsAt.getTime() - WINDOW_MINUTES_BEFORE_START * 60_000;
  const closes = startsAt.getTime() + WINDOW_MINUTES_AFTER_START * 60_000;
  if (now.getTime() < opens) return 'upcoming';
  if (now.getTime() > closes) return 'closed';
  return 'open';
}

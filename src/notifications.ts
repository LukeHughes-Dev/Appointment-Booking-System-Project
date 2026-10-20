import type { FastifyBaseLogger } from 'fastify';
import type { Booking } from './bookings.js';
import { WINDOW_MINUTES_BEFORE_START, windowBounds } from './rules.js';

export interface Confirmation {
  channel: 'email';
  to: string;
  message: string;
}

// What a confirmation needs to say about an appointment.
export type AppointmentSummary = Pick<
  Booking,
  'reference' | 'branch' | 'consultant' | 'service' | 'clientEmail' | 'startsAt'
>;

export type ConfirmationKind = 'booked' | 'moved' | 'cancelled';

// Simulated: nothing is really sent. A real version would hand this message to an
// email or SMS service. The text is written in the branch's own timezone. Booking, moving
// and cancelling an appointment each send one, so the client always has it in writing.
export function sendConfirmation(
  log: FastifyBaseLogger,
  appointment: AppointmentSummary,
  kind: ConfirmationKind = 'booked',
): Confirmation {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: appointment.branch.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(appointment.startsAt));

  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: appointment.branch.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const { opensAt, closesAt } = windowBounds(new Date(appointment.startsAt));
  const chat =
    ` You can chat with ${appointment.consultant.name} from ${clock.format(opensAt)}, ` +
    `${WINDOW_MINUTES_BEFORE_START} minutes before your appointment, until ${clock.format(closesAt)}.`;

  const what = `Your ${appointment.service} appointment at ${appointment.branch.name} with ${appointment.consultant.name}`;
  const text = {
    booked: `${what} is booked for ${when}.${chat}`,
    moved: `${what} has moved to ${when}.${chat}`,
    cancelled: `${what} on ${when} is cancelled.`,
  }[kind];

  const confirmation: Confirmation = {
    channel: 'email',
    to: appointment.clientEmail,
    message: `${text} Reference: ${appointment.reference}.`,
  };
  log.info({ to: confirmation.to, reference: appointment.reference, kind }, 'simulated confirmation sent');
  return confirmation;
}

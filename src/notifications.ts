import type { FastifyBaseLogger } from 'fastify';
import type { Booking } from './bookings.js';

export interface Confirmation {
  channel: 'email';
  to: string;
  message: string;
}

// Simulated: nothing is really sent. A real version would hand this message to an
// email or SMS service. The text is written in the branch's own timezone.
export function sendConfirmation(log: FastifyBaseLogger, booking: Booking): Confirmation {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: booking.branch.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(booking.startsAt));

  const confirmation: Confirmation = {
    channel: 'email',
    to: booking.clientEmail,
    message:
      `Your ${booking.service} appointment at ${booking.branch.name} with ` +
      `${booking.consultant.name} is booked for ${when}. Reference: ${booking.reference}.`,
  };
  log.info({ to: confirmation.to, reference: booking.reference }, 'simulated confirmation sent');
  return confirmation;
}

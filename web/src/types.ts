export interface Closure {
  from: string // YYYY-MM-DD
  to: string
  reason: string | null
}

export interface Branch {
  id: string
  name: string
  timezone: string
  latitude: number
  longitude: number
  distanceKm: number | null // only when the client's position was sent
  closure: Closure | null // set while the branch is closed today
}

export interface Slot {
  startsAt: string
  endsAt: string
  available: boolean
  consultants: { id: string; name: string }[]
}

// The simulated message the API "sends" when an appointment is booked, moved or cancelled.
export interface Confirmation {
  to: string
  message: string
}

export interface Booking {
  reference: string
  branch: { id: string; name: string; timezone: string }
  consultant: { id: string; name: string }
  service: string
  startsAt: string
  endsAt: string
  confirmation: Confirmation
}

// Where "now" sits relative to the 10-minute window around the start (see src/rules.ts).
export type WindowState = 'upcoming' | 'open' | 'closed'

export interface Appointment {
  reference: string
  branch: { id: string; name: string; timezone: string }
  consultant: { id: string; name: string }
  service: string
  startsAt: string
  endsAt: string
  window: WindowState
}

export type Outcome = 'attended' | 'no_show' | null

export interface StaffAppointment {
  reference: string
  status: 'booked' | 'cancelled'
  outcome: Outcome
  clientEmail: string
  branch: { id: string; name: string; timezone: string }
  service: string
  startsAt: string
  endsAt: string
  window: WindowState
}

export interface Counts {
  upcoming: number
  attended: number
  noShow: number
  notRecorded: number
  cancelled: number
}

export interface BranchSummary {
  branch: { id: string; name: string }
  totals: Counts
  consultants: ({ consultant: { id: string; name: string } } & Counts)[]
}

export interface ChatMessage {
  id: string
  from: 'client' | 'consultant'
  body: string
  sentAt: string
}

export interface BreakPiece {
  start: string // HH:MM, the branch's local time
  end: string
}

export interface BreakDay {
  date: string
  timezone: string
  totalMinutes: number
  breaks: (BreakPiece & { source: 'scheduled' | 'edited' })[]
  clashes: { reference: string; service: string; startsAt: string; endsAt: string }[]
}

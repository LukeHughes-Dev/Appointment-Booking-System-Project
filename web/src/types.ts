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

export interface Booking {
  reference: string
  branch: { id: string; name: string; timezone: string }
  consultant: { id: string; name: string }
  service: string
  startsAt: string
  endsAt: string
  confirmation: { to: string; message: string }
}

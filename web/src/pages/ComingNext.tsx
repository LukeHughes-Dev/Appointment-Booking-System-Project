import { useParams } from 'react-router-dom'

// Placeholders for screens that are built in the next steps.
export function BookingComingNext() {
  const { id } = useParams()
  return (
    <>
      <h1>Choose a time</h1>
      <p className="notice">The booking screen for branch {id} is the next thing we build.</p>
    </>
  )
}

export function AppointmentsComingNext() {
  return (
    <>
      <h1>My appointments</h1>
      <p className="notice">This screen is built after booking.</p>
    </>
  )
}

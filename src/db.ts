import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string) {
    return new Pool({connectionString});
}

// Runs some work in a transaction while holding the consultant's row lock. Bookings (and
// moves) for the same consultant therefore queue up instead of racing: the second one waits,
// then sees the first one's appointment and is refused cleanly. Without this, two
// simultaneous inserts can each wait for the other, and Postgres has to cancel one after a
// delay (a deadlock). The exclusion constraint still decides; this only keeps it quick.
export async function withConsultantLock<T>(
  pool: Pool,
  consultantId: string,
  work: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT 1 FROM consultants WHERE id = $1 FOR UPDATE', [consultantId]);
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

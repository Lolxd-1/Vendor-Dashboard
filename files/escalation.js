/**
 * escalation.js — SERVER SIDE. Runs on your backend, not in the browser.
 *
 * This is the part that actually solves the business problem. Everything in
 * the client reduces the failure rate; this is what happens when it fails
 * anyway. A client-side escalation is worthless -- if the client is dead,
 * nothing runs.
 *
 * Shown with BullMQ. The same shape works with Sidekiq, Celery, Temporal,
 * or a `scheduled_at` column with a worker polling it. Requirements:
 *
 *   - delays must be DURABLE (survive a server restart, not setTimeout)
 *   - jobs must be CANCELLABLE by order id when acknowledgement arrives
 *   - jobs must be IDEMPOTENT (a retry must not send two SMSes)
 */

const { Queue, Worker } = require('bullmq');

const connection = { host: process.env.REDIS_HOST, port: 6379 };
const escalations = new Queue('order-escalations', { connection });

/**
 * The ladder. Each rung is a DIFFERENT CHANNEL ON A DIFFERENT DEVICE, so a
 * single point of failure cannot swallow the whole chain.
 *
 * Tune the delays to your business. The structure is what matters.
 */
const LADDER = [
  { at:  45_000, action: 'sms_vendor' },
  { at:  90_000, action: 'call_vendor' },
  { at: 150_000, action: 'contact_backup' },
  { at: 240_000, action: 'alert_ops' },
];

/* ── Scheduling ─────────────────────────────────────────────────────────── */

async function onOrderCreated(order) {
  // Schedule every rung up front. Each one re-checks acknowledgement state
  // before firing, so cancelling is best-effort rather than load-bearing.
  await Promise.all(LADDER.map(rung =>
    escalations.add(
      'escalate',
      { orderId: order.id, vendorId: order.vendorId, action: rung.action },
      {
        delay: rung.at,
        jobId: `esc:${order.id}:${rung.action}`,  // idempotency key
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }
    )
  ));
}

async function onOrderAcknowledged(orderId) {
  // Cancel the remaining rungs. If one has already started, the
  // acknowledgement check inside the worker catches it.
  await Promise.all(LADDER.map(async rung => {
    const job = await escalations.getJob(`esc:${orderId}:${rung.action}`);
    if (job) await job.remove().catch(() => {});
  }));
}

/* ── Execution ──────────────────────────────────────────────────────────── */

new Worker('order-escalations', async (job) => {
  const { orderId, vendorId, action } = job.data;

  // ALWAYS re-check against the database. Never trust that cancellation
  // won the race -- it often doesn't.
  const order = await db.orders.findById(orderId);
  if (!order || order.acknowledgedAt || order.cancelledAt) return;

  const vendor = await db.vendors.findById(vendorId);
  const elapsed = Math.round((Date.now() - order.createdAt) / 1000);

  await db.escalationEvents.insert({ orderId, action, at: new Date() });

  switch (action) {
    case 'sms_vendor':
      await sms.send(vendor.mobile,
        `New order #${order.number} is waiting (${elapsed}s). Open the dashboard to accept.`);
      break;

    case 'call_vendor':
      // A ringing phone in a pocket beats every browser API ever written.
      await voice.call(vendor.mobile, {
        script: `You have an unaccepted order, number ${order.number}. ` +
                `Press 1 to accept it now, or open your dashboard.`,
        onDigit: { '1': () => acknowledgeOrder(orderId, 'phone') },
      });
      break;

    case 'contact_backup':
      if (vendor.backupMobile) {
        await sms.send(vendor.backupMobile,
          `Order #${order.number} at ${vendor.name} has been unaccepted for ${elapsed}s.`);
        await voice.call(vendor.backupMobile, { script: `...` });
      }
      break;

    case 'alert_ops':
      await ops.page({
        severity: 'high',
        title: `Order ${order.number} unaccepted for ${elapsed}s`,
        vendor: vendor.name,
        // Include the last heartbeat so ops immediately know WHY
        lastHeartbeat: await db.heartbeats.latest(vendorId),
      });
      break;
  }
}, { connection });

/* ── Health metric ──────────────────────────────────────────────────────────
 *
 * Track the percentage of orders reaching each rung. It is the single best
 * summary of whether the whole system works.
 *
 * If more than ~5% of orders reach sms_vendor, your sound is not working or
 * your accept flow is too slow. Fix that rather than escalating harder --
 * if vendors get a text for every order they will mute the thread, and you
 * will have lost that channel permanently.
 *
 *   SELECT action, COUNT(DISTINCT order_id)::float
 *          / (SELECT COUNT(*) FROM orders WHERE created_at > now() - interval '7 days')
 *   FROM escalation_events
 *   WHERE at > now() - interval '7 days'
 *   GROUP BY action;
 */

module.exports = { onOrderCreated, onOrderAcknowledged };

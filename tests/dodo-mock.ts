/**
 * Test double for the `dodopayments` package: the real client (so webhooks.unwrap does real
 * Standard Webhooks signature verification) with its network resources replaced by in-memory fakes.
 */
// @ts-ignore resolved by the esbuild alias in tests/run-payments.mjs
import RealDodo from "dodopayments-real";

type Payment = Record<string, unknown> & { payment_id: string };

export const dodoState = {
  sessionsCreated: [] as {
    body: Record<string, unknown>;
    idempotencyKey?: string;
  }[],
  sessions: new Map<
    string,
    { payment_id: string | null; payment_status: string | null }
  >(),
  payments: new Map<string, Payment>(),
  failCreate: false,
  failRetrieve: 0, // number of upcoming payments.retrieve calls that throw
  reset() {
    this.sessionsCreated = [];
    this.sessions.clear();
    this.payments.clear();
    this.failCreate = false;
    this.failRetrieve = 0;
  },
};

let seq = 0;

export default class DodoPayments extends RealDodo {
  constructor(opts: Record<string, unknown>) {
    super(opts);
    (this as unknown as Record<string, unknown>).checkoutSessions = {
      async create(
        body: Record<string, unknown>,
        options?: { idempotencyKey?: string },
      ) {
        if (dodoState.failCreate) throw new Error("Dodo 500 (mock)");
        // Real Dodo dedupes on the idempotency key: same key → same session.
        const prior = dodoState.sessionsCreated.find(
          (s) =>
            s.idempotencyKey && s.idempotencyKey === options?.idempotencyKey,
        );
        dodoState.sessionsCreated.push({
          body,
          idempotencyKey: options?.idempotencyKey,
        });
        const id = prior
          ? `cks_replay_${options?.idempotencyKey}`
          : `cks_${++seq}`;
        if (!dodoState.sessions.has(id))
          dodoState.sessions.set(id, {
            payment_id: null,
            payment_status: null,
          });
        return {
          session_id: id,
          checkout_url: `https://test.checkout.dodopayments.com/session/${id}`,
        };
      },
      async retrieve(id: string) {
        const s = dodoState.sessions.get(id);
        if (!s) throw new Error(`session ${id} not found (mock)`);
        return {
          id,
          created_at: new Date().toISOString(),
          customer_email: null,
          customer_name: null,
          ...s,
        };
      },
    };
    (this as unknown as Record<string, unknown>).payments = {
      async retrieve(id: string) {
        if (dodoState.failRetrieve > 0) {
          dodoState.failRetrieve--;
          throw new Error("Dodo API timeout (mock)");
        }
        const p = dodoState.payments.get(id);
        if (!p) throw new Error(`payment ${id} not found (mock)`);
        return p;
      },
    };
  }
}

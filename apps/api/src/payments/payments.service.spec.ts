import { describe, expect, it } from 'vitest';
import { payOrderSchema } from './payments.dto';
import { toPayOrderTenders } from './payments.service';

const body = (tenders: object[]) => ({
  orderId: '98000000-0000-0000-0000-000000000001',
  cashRegisterId: '98000000-0000-0000-0000-0000000000a1',
  tipAmount: 0,
  tenders,
  idempotencyKey: '98000000-0000-4000-8000-0000000000c1',
});
const method = '98000000-0000-0000-0000-0000000000f1';
/** The p_tenders jsonb text pay_order receives for a request body. */
const rpcTenders = (tenders: object[]) => JSON.stringify(toPayOrderTenders(payOrderSchema.parse(body(tenders)).tenders));

describe('pay_order p_tenders argument', () => {
  it('is byte-identical to the pre-reference shape for an old payload', () => {
    expect(rpcTenders([{ paymentMethodId: method, amount: 5000, cashReceived: 10000 }, { paymentMethodId: method, amount: 3000 }])).toBe(
      `[{"payment_method_id":"${method}","amount":5000,"cash_received":10000},{"payment_method_id":"${method}","amount":3000,"cash_received":null}]`,
    );
    expect(rpcTenders([{ paymentMethodId: method, amount: 3000, cashReceived: null, reference: null }])).toBe(
      `[{"payment_method_id":"${method}","amount":3000,"cash_received":null}]`,
    );
  });

  it('appends the normalized reference last when one is sent', () => {
    expect(rpcTenders([{ paymentMethodId: method, amount: 3000, cashReceived: null, reference: ' NQ\t77\r\n9 ' }])).toBe(
      `[{"payment_method_id":"${method}","amount":3000,"cash_received":null,"reference":"NQ 77 9"}]`,
    );
  });
});

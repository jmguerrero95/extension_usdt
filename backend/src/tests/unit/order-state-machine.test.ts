import { describe, expect, it } from 'vitest';

import {
  assertValidTransition,
  canTransition,
  listValidTransitions,
} from '../../domain/state-machine/order-state-machine';

describe('order-state-machine', () => {
  it('permite transiciones validas para SELL y BUY', () => {
    expect(canTransition('SELL', 'WAITING_DEPOSIT', 'DEPOSIT_DETECTED')).toBe(true);
    expect(listValidTransitions('SELL', 'ENERGY_CONFIRMED')).toContain('FORWARD_REQUESTED');

    expect(canTransition('BUY', 'ENERGY_CONFIRMED', 'SEND_REQUESTED')).toBe(true);
    expect(listValidTransitions('BUY', 'SEND_ACCEPTED')).toContain('DELIVERY_CONFIRMED');
  });

  it('rechaza transiciones invalidas', () => {
    expect(() =>
      assertValidTransition('SELL', 'WAITING_DEPOSIT', 'FORWARD_REQUESTED'),
    ).toThrowError(/No se permite la transicion|No se permite la transición|No se permite la transiciÃ³n/);

    expect(() =>
      assertValidTransition('BUY', 'WAITING_DEPOSIT', 'SEND_REQUESTED'),
    ).toThrowError(/No se permite la transicion|No se permite la transición|No se permite la transiciÃ³n/);
  });
});

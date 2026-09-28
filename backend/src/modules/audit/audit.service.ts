import type { OrderStateTransition } from '../../domain/entities/order-state-transition.entity';
import type { OrderStateTransitionRepository } from '../../domain/repositories/order-state-transition.repository';
import type { ProviderEventRepository } from '../../domain/repositories/provider-event.repository';

export interface TimelineItem {
  type: 'state_transition' | 'provider_event';
  occurredAt: Date;
  summary: string;
  details: Record<string, unknown>;
}

export class AuditService {
  public constructor(
    private readonly transitionRepository: OrderStateTransitionRepository,
    private readonly providerEventRepository: ProviderEventRepository,
  ) {}

  public async recordTransition(transition: OrderStateTransition): Promise<OrderStateTransition> {
    return this.transitionRepository.create(transition);
  }

  public async getTimeline(orderId: string): Promise<TimelineItem[]> {
    const [transitions, providerEvents] = await Promise.all([
      this.transitionRepository.listByOrderId(orderId),
      this.providerEventRepository.listByOrderId(orderId),
    ]);

    const transitionItems: TimelineItem[] = transitions.map((transition) => ({
      type: 'state_transition',
      occurredAt: transition.createdAt,
      summary: `${transition.fromStatus} -> ${transition.toStatus}`,
      details: {
        reason: transition.reason,
        actorType: transition.actorType,
        actorId: transition.actorId,
        metadata: transition.metadata,
      },
    }));

    const eventItems: TimelineItem[] = providerEvents.map((event) => ({
      type: 'provider_event',
      occurredAt: event.createdAt,
      summary: `${event.provider}:${event.eventType}`,
      details: {
        provider: event.provider,
        processed: event.processed,
        signatureValid: event.signatureValid,
        error: event.error,
      },
    }));

    return [...transitionItems, ...eventItems].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
  }
}

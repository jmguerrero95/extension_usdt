import type { AdminSessionRepository } from '../../../domain/repositories/admin-session.repository';
import type { AdminSession } from '../../../domain/entities/admin-session.entity';
import { AdminSessionModel } from '../models/admin-session.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoAdminSessionRepository implements AdminSessionRepository {
  public async create(session: AdminSession): Promise<AdminSession> {
    const document = await AdminSessionModel.create(session);
    return toDomainEntity<AdminSession>(document);
  }

  public async findById(id: string): Promise<AdminSession | null> {
    const document = await AdminSessionModel.findById(id)
      .select('+sessionTokenHash +csrfToken')
      .exec();
    return document ? toDomainEntity<AdminSession>(document) : null;
  }

  public async findByTokenHash(sessionTokenHash: string): Promise<AdminSession | null> {
    const document = await AdminSessionModel.findOne({
      sessionTokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .select('+sessionTokenHash +csrfToken')
      .exec();

    return document ? toDomainEntity<AdminSession>(document) : null;
  }

  public async listActiveByUserId(userId: string): Promise<AdminSession[]> {
    const documents = await AdminSessionModel.find({
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastSeenAt: -1 })
      .exec();

    return documents.map((document) => toDomainEntity<AdminSession>(document));
  }

  public async updateById(
    id: string,
    patch: Partial<AdminSession>,
  ): Promise<AdminSession | null> {
    const document = await AdminSessionModel.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
    })
      .select('+sessionTokenHash +csrfToken')
      .exec();

    return document ? toDomainEntity<AdminSession>(document) : null;
  }

  public async revokeOtherSessions(userId: string, sessionId: string): Promise<void> {
    await AdminSessionModel.updateMany(
      {
        userId,
        _id: { $ne: sessionId },
        revokedAt: null,
      },
      {
        revokedAt: new Date(),
      },
    ).exec();
  }

  public async revokeAllByUserId(userId: string): Promise<void> {
    await AdminSessionModel.updateMany(
      {
        userId,
        revokedAt: null,
      },
      {
        revokedAt: new Date(),
      },
    ).exec();
  }
}

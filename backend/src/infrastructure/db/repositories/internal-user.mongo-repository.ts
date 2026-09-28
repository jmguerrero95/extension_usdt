import type { InternalUserRepository } from '../../../domain/repositories/internal-user.repository';
import type { InternalUser } from '../../../domain/entities/internal-user.entity';
import { InternalUserModel } from '../models/internal-user.model';
import { toDomainEntity } from './mongo-mappers';

export class MongoInternalUserRepository implements InternalUserRepository {
  public async count(): Promise<number> {
    return InternalUserModel.countDocuments({}).exec();
  }

  public async create(user: InternalUser): Promise<InternalUser> {
    const document = await InternalUserModel.create(user);
    return toDomainEntity<InternalUser>(document);
  }

  public async findById(id: string): Promise<InternalUser | null> {
    const document = await InternalUserModel.findById(id).select('+passwordHash +twoFactorSecretEncrypted +pendingTwoFactorSecretEncrypted').exec();
    return document ? toDomainEntity<InternalUser>(document) : null;
  }

  public async findByEmail(email: string): Promise<InternalUser | null> {
    const document = await InternalUserModel.findOne({ email: email.toLowerCase() })
      .select('+passwordHash +twoFactorSecretEncrypted +pendingTwoFactorSecretEncrypted')
      .exec();

    return document ? toDomainEntity<InternalUser>(document) : null;
  }

  public async list(): Promise<InternalUser[]> {
    const documents = await InternalUserModel.find({}).sort({ email: 1 }).exec();
    return documents.map((document) => toDomainEntity<InternalUser>(document));
  }

  public async updateById(id: string, patch: Partial<InternalUser>): Promise<InternalUser | null> {
    const document = await InternalUserModel.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
    })
      .select('+passwordHash +twoFactorSecretEncrypted +pendingTwoFactorSecretEncrypted')
      .exec();

    return document ? toDomainEntity<InternalUser>(document) : null;
  }
}

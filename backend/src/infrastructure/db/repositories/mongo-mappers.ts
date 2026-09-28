const serializeDocument = <T>(document: {
  toObject(): unknown;
  _id: unknown;
}): T & { id: string } =>
  ({
    ...(document.toObject() as object),
    id: String(document._id),
  }) as T & { id: string };

export const toDomainEntity = serializeDocument;

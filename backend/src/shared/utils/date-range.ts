export type DateRangePreset = 'today' | 'week' | 'month' | 'year' | 'custom';

interface ResolveDateRangeInput {
  preset?: DateRangePreset;
  dateFrom?: string;
  dateTo?: string;
  timezoneOffsetMinutes?: number;
  now?: Date;
}

interface Boundaries {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcFromLocalParts = (
  year: number,
  month: number,
  day: number,
  offsetMinutes: number,
): Date => new Date(Date.UTC(year, month, day) + offsetMinutes * 60_000);

const getLocalNow = (now: Date, offsetMinutes: number): Date =>
  new Date(now.getTime() - offsetMinutes * 60_000);

const resolvePresetBoundaries = (
  preset: Exclude<DateRangePreset, 'custom'>,
  offsetMinutes: number,
  now: Date,
): Boundaries => {
  const localNow = getLocalNow(now, offsetMinutes);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();

  if (preset === 'today') {
    const start = toUtcFromLocalParts(year, month, day, offsetMinutes);
    return {
      start,
      end: new Date(start.getTime() + DAY_MS - 1),
    };
  }

  if (preset === 'week') {
    const weekday = localNow.getUTCDay();
    const daysFromMonday = (weekday + 6) % 7;
    const monday = new Date(Date.UTC(year, month, day - daysFromMonday));
    const start = toUtcFromLocalParts(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate(),
      offsetMinutes,
    );

    return {
      start,
      end: new Date(start.getTime() + 7 * DAY_MS - 1),
    };
  }

  if (preset === 'month') {
    const start = toUtcFromLocalParts(year, month, 1, offsetMinutes);
    const nextMonthStart = toUtcFromLocalParts(year, month + 1, 1, offsetMinutes);
    return {
      start,
      end: new Date(nextMonthStart.getTime() - 1),
    };
  }

  const start = toUtcFromLocalParts(year, 0, 1, offsetMinutes);
  const nextYearStart = toUtcFromLocalParts(year + 1, 0, 1, offsetMinutes);
  return {
    start,
    end: new Date(nextYearStart.getTime() - 1),
  };
};

const buildPresetLabel = (preset: DateRangePreset): string => {
  switch (preset) {
    case 'today':
      return 'Hoy';
    case 'week':
      return 'Esta semana';
    case 'month':
      return 'Este mes';
    case 'year':
      return 'Este ano';
    case 'custom':
    default:
      return 'Rango personalizado';
  }
};

export const resolveDateRange = (input: ResolveDateRangeInput) => {
  const preset = input.preset ?? 'custom';
  const timezoneOffsetMinutes = Number.isFinite(input.timezoneOffsetMinutes)
    ? Number(input.timezoneOffsetMinutes)
    : 0;
  const now = input.now ?? new Date();

  if (preset !== 'custom') {
    const boundaries = resolvePresetBoundaries(preset, timezoneOffsetMinutes, now);
    return {
      preset,
      label: buildPresetLabel(preset),
      timezoneOffsetMinutes,
      dateFrom: boundaries.start.toISOString(),
      dateTo: boundaries.end.toISOString(),
      from: boundaries.start,
      to: boundaries.end,
    };
  }

  const from = input.dateFrom ? new Date(input.dateFrom) : null;
  const to = input.dateTo ? new Date(input.dateTo) : null;

  return {
    preset,
    label: buildPresetLabel('custom'),
    timezoneOffsetMinutes,
    dateFrom: from?.toISOString() ?? null,
    dateTo: to?.toISOString() ?? null,
    from,
    to,
  };
};

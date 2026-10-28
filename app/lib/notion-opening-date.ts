const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_PATTERN = /^([01]?\d|2[0-3])(?:(?::|h)([0-5]\d))?(?::([0-5]\d))?$/i;

const saoPauloOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  timeZoneName: "longOffset",
  year: "numeric",
});

export type OpeningClock = {
  hour: number;
  minute: number;
  second: number;
};

export function isDateOnly(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value);
}

export function parseOpeningClock(value: string): OpeningClock | null {
  const normalized = value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "");
  const match = CLOCK_PATTERN.exec(normalized);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2] ?? "0"),
    second: Number(match[3] ?? "0"),
  };
}

function offsetMinutesAt(value: Date): number | null {
  const timeZoneName = saoPauloOffsetFormatter
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2}):?(\d{2})?$/.exec(timeZoneName ?? "");
  if (!match) return null;
  const magnitude = Number(match[2]) * 60 + Number(match[3] ?? "0");
  return match[1] === "+" ? magnitude : -magnitude;
}

export function combineOpeningDateAndTime(dateValue: string, timeValue: string): string | null {
  const dateMatch = DATE_ONLY_PATTERN.exec(dateValue);
  const clock = parseOpeningClock(timeValue);
  if (!dateMatch || !clock) return null;

  const localAsUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    clock.hour,
    clock.minute,
    clock.second,
  );
  let offsetMinutes = offsetMinutesAt(new Date(localAsUtc));
  if (offsetMinutes === null) return null;
  let instant = localAsUtc - offsetMinutes * 60_000;

  const resolvedOffset = offsetMinutesAt(new Date(instant));
  if (resolvedOffset === null) return null;
  if (resolvedOffset !== offsetMinutes) {
    offsetMinutes = resolvedOffset;
    instant = localAsUtc - offsetMinutes * 60_000;
  }
  return new Date(instant).toISOString();
}

export function parseAnalyticalDate(value: string): Date | null {
  const candidate = isDateOnly(value) ? `${value}T12:00:00Z` : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

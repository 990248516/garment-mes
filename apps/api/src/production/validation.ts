import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new BadRequestException(`${name} must contain ${min}-${max} characters`);
  }
  return normalized;
}

export function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, name, max);
}

export function uuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID`);
  }
  return value;
}

export function optionalUuid(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, name);
}

export function integer(value: unknown, name: string, minimum = 0, maximum = 2_147_483_647): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new BadRequestException(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

export function optionalInteger(value: unknown, name: string, minimum = 0): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, name, minimum);
}

export function calendarDate(value: unknown, name: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} must be a real calendar date`);
  }
  return parsed;
}

export function optionalDate(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return calendarDate(value, name);
}

export function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function pageLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 50;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return integer(parsed, 'limit', 1, 200);
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException('cursor must be a string');
  try {
    return uuid(Buffer.from(value, 'base64url').toString('utf8'), 'cursor');
  } catch {
    throw new BadRequestException('cursor is invalid');
  }
}

export function idempotencyKey(value: string | string[] | undefined): string {
  if (Array.isArray(value)) throw new BadRequestException('Idempotency-Key must occur once');
  return uuid(value, 'Idempotency-Key');
}

export function isoDate(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

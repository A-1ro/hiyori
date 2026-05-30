import type { ClientResponse } from 'hono/client'
import type { $ZodIssue } from 'zod/v4/core'
import { createApi } from '../../shared/api'

const api = createApi()

export class ApiError extends Error {
  issues?: $ZodIssue[]
  status: number

  constructor(message: string, status: number, issues?: $ZodIssue[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

async function handleResponse<T>(res: ClientResponse<unknown>): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }
  let body: { error?: string; issues?: $ZodIssue[] } = {}
  try {
    body = (await res.json()) as { error?: string; issues?: $ZodIssue[] }
  } catch {}
  throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.issues)
}

export interface EventResponse {
  id: string
  organizerDiscordId: string
  title: string
  description?: string
  defaultDurationMinutes: number
  status: string
  deadline?: string
  timezone: string
  discordChannelId?: string
  createdAt: string
}

export interface CandidateResponse {
  id: string
  eventId: string
  startAt: string
  endAt: string
}

export interface CreateEventInput {
  organizerDiscordId: string
  title: string
  description?: string
  defaultDurationMinutes: number
  deadline?: string
  timezone?: string
  discordChannelId?: string
  candidates: Array<{ startAt: string; endAt?: string }>
}

export interface UpdateEventInput {
  title?: string
  description?: string
  deadline?: string | null
  defaultDurationMinutes?: number
  timezone?: string
  discordChannelId?: string | null
}

export async function createEvent(
  input: CreateEventInput,
): Promise<{ event: EventResponse; candidates: CandidateResponse[] }> {
  const res = await api.api.events.$post({ json: input })
  return handleResponse(res)
}

export async function fetchEvent(
  id: string,
): Promise<{ event: EventResponse; candidates: CandidateResponse[] }> {
  const res = await api.api.events[':id'].$get({ param: { id } })
  return handleResponse(res)
}

export async function updateEvent(
  id: string,
  input: UpdateEventInput,
): Promise<{ event: EventResponse }> {
  const res = await api.api.events[':id'].$patch({ param: { id }, json: input })
  return handleResponse(res)
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await api.api.events[':id'].$delete({ param: { id } })
  return handleResponse(res)
}

export async function addCandidate(
  eventId: string,
  input: { startAt: string; endAt?: string },
): Promise<{ candidate: CandidateResponse }> {
  const res = await api.api.events[':id'].candidates.$post({
    param: { id: eventId },
    json: input,
  })
  return handleResponse(res)
}

export async function deleteCandidate(eventId: string, candidateId: string): Promise<void> {
  const res = await api.api.events[':id'].candidates[':candidateId'].$delete({
    param: { id: eventId, candidateId },
  })
  return handleResponse(res)
}

export interface ParticipantResponse {
  id: string
  eventId: string
  kind: string
  displayName: string
  createdAt: string
}

export interface VoteResponse {
  id: string
  candidateId: string
  participantId: string
  choice: string
  comment?: string
  updatedAt: string
}

export interface RegisterParticipantInput {
  kind: 'guest'
  displayName: string
}

export interface PutVoteInput {
  candidateId: string
  choice: 'yes' | 'maybe' | 'no'
  comment?: string
}

export async function registerParticipant(
  eventId: string,
  input: RegisterParticipantInput,
): Promise<{ participant: ParticipantResponse }> {
  const res = await api.api.events[':id'].participants.$post({
    param: { id: eventId },
    json: input,
  })
  return handleResponse(res)
}

export async function fetchMyVotes(
  eventId: string,
): Promise<{ participant: ParticipantResponse | null; votes: VoteResponse[] }> {
  const res = await api.api.events[':id'].votes.me.$get({
    param: { id: eventId },
  })
  return handleResponse(res)
}

export async function putVotes(
  eventId: string,
  votes: PutVoteInput[],
): Promise<{ votes: VoteResponse[] }> {
  const res = await api.api.events[':id'].votes.$put({
    param: { id: eventId },
    json: { votes },
  })
  return handleResponse(res)
}

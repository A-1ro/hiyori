import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import type { $ZodIssue } from 'zod/v4/core'
import { createEvent, ApiError } from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { Button, Icon } from '../components/primitives'
import { EventForm, type EventFormState } from '../components/events/EventForm'

export function EventCreatePage() {
  const navigate = useNavigate()
  const [issues, setIssues] = useState<$ZodIssue[] | undefined>()

  const mutation = useMutation({
    mutationFn: (state: EventFormState) => {
      const candidatesInput = state.candidates
        .filter((c) => c.startAt)
        .map((c) => ({
          startAt: new Date(c.startAt).toISOString(),
          endAt: c.endAt ? new Date(c.endAt).toISOString() : undefined,
        }))

      return createEvent({
        // TODO(F-06): organizerDiscordId はセッションから取得する
        organizerDiscordId: 'placeholder',
        title: state.title,
        description: state.description || undefined,
        defaultDurationMinutes: state.defaultDurationMinutes,
        deadline: state.deadline ? new Date(state.deadline).toISOString() : undefined,
        timezone: state.timezone || 'UTC',
        discordChannelId: state.discordChannelId || undefined,
        candidates: candidatesInput,
      })
    },
    onSuccess: (result) => {
      navigate('/events/' + result.event.id)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setIssues(err.issues)
      }
    },
  })

  return (
    <div>
      <AppHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevron-left" size={16} />}
            onClick={() => navigate('/')}
          >
            戻る
          </Button>
        }
      />
      <main
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '40px 24px 80px',
        }}
      >
        <h1
          style={{
            margin: '0 0 24px',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--color-fg1)',
          }}
        >
          日程調整をつくる
        </h1>

        {mutation.error && !(mutation.error instanceof ApiError && mutation.error.issues) && (
          <div
            style={{
              marginBottom: 16,
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-no-soft)',
              color: 'var(--color-no-ink)',
              fontSize: 13,
            }}
          >
            {mutation.error.message}
          </div>
        )}

        <EventForm
          onSubmit={(state) => {
            setIssues(undefined)
            mutation.mutate(state)
          }}
          submitLabel="作成する"
          isSubmitting={mutation.isPending}
          issues={issues}
          showCandidates={true}
        />
      </main>
    </div>
  )
}
